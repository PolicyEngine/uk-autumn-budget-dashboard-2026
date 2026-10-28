"""Personal impact calculator using PolicyEngine-UK.

This module calculates how Autumn Budget 2026 policies affect individual
households over time (2025-2029).
"""

import copy
import json
import logging
import multiprocessing
import os
import pickle
import threading
import time
import traceback
from collections import deque
from dataclasses import dataclass, field
from multiprocessing.connection import wait
from pathlib import Path
from typing import Callable, Optional

from policyengine_uk import Simulation
from policyengine_uk.utils.scenario import Scenario

from uk_budget_data.models import DataConfig, Reform
from uk_budget_data.reforms import (
    get_autumn_budget_2026_reforms,
)


@dataclass
class HouseholdInput:
    """Input parameters for a household."""

    employment_income: float
    income_growth_rate: float = 0.0
    is_married: bool = False
    partner_income: float = 0.0
    children_ages: list[int] = field(default_factory=list)
    property_income: float = 0.0
    savings_income: float = 0.0
    dividend_income: float = 0.0
    pension_contributions_salary_sacrifice: float = 0.0
    fuel_spending: float = 0.0
    rail_spending: float = 0.0


# Years to calculate (2025 is base year, 2026-2029 are policy years)
YEARS = [2025, 2026, 2027, 2028, 2029, 2030]

# Policies to analyse (excluding combined which would double-count)
POLICY_IDS = [
    "fuel_duty_rise_deferral",
    "state_pension_income_tax_protection",
    "domestic_electricity_zero_vat",
    "unearned_income_rates_up",
    "carers_allowance_earnings_taper",
    "household_energy_payment_2026",
    "trading_allowance_raise",
]


def build_situation(household: HouseholdInput, year: int) -> dict:
    """Build a PolicyEngine situation dict for a given year.

    Ages children appropriately for the year (relative to 2025 base).
    Applies income growth to employment income.

    Args:
        household: Household input parameters.
        year: The year to build the situation for.

    Returns:
        PolicyEngine situation dictionary.
    """
    years_from_base = year - 2025
    growth_factor = (1 + household.income_growth_rate) ** years_from_base

    # Build people
    people = {
        "adult": {
            "age": {year: 35 + years_from_base},
            "employment_income": {
                year: household.employment_income * growth_factor
            },
            "savings_interest_income": {year: household.savings_income},
            "property_income": {year: household.property_income},
            "dividend_income": {year: household.dividend_income},
        }
    }

    # Add salary sacrifice pension contributions if specified
    if household.pension_contributions_salary_sacrifice > 0:
        people["adult"]["pension_contributions_via_salary_sacrifice"] = {
            year: household.pension_contributions_salary_sacrifice
        }

    benunit_members = ["adult"]
    household_members = ["adult"]

    # Add partner if married
    if household.is_married:
        people["partner"] = {
            "age": {year: 33 + years_from_base},
            "employment_income": {
                year: household.partner_income * growth_factor
            },
        }
        benunit_members.append("partner")
        household_members.append("partner")

    # Add children (age them each year)
    for i, child_age_2025 in enumerate(household.children_ages):
        child_age = child_age_2025 + years_from_base
        # Only include children under 25 (after which they're not dependents)
        if child_age < 25:
            child_id = f"child_{i + 1}"
            people[child_id] = {
                "age": {year: child_age},
                "employment_income": {year: 0},
            }
            benunit_members.append(child_id)
            household_members.append(child_id)

    return {
        "people": people,
        "benunits": {"benunit": {"members": benunit_members}},
        "households": {
            "household": {
                "members": household_members,
                "region": {year: "LONDON"},  # Default to London
            }
        },
    }


def build_situations(
    household: HouseholdInput, years: list[int]
) -> list[tuple[list[int], dict]]:
    """The household's situations for ``years``, each holding every one of
    its years' inputs, so a scenario is simulated once for all of them
    rather than once a year.

    Each year's inputs are exactly ``build_situation``'s for that year. A
    situation's people are fixed, and a child leaves the household at 25,
    so years with different people are in different situations.

    Every year's inputs stay visible while any year is read, which a
    single-year situation never has. That is safe for today's inputs: the
    formulas that read another year read nothing set here except
    ``current_education``, restored before each read (``AsBuilt``), and
    ``region``, the same every year. An input that varied by year in a way
    a formula reads across years (a household that moves region) would
    need its own situation: ``AsBuilt`` restores calculated values, not
    inputs.

    Returns:
        ``(years, situation)`` pairs, in the order of ``years``.
    """
    groups: dict[tuple, tuple[list[int], dict]] = {}
    for year in years:
        single = build_situation(household, year)
        people = tuple(single["people"])
        if people not in groups:
            groups[people] = ([year], copy.deepcopy(single))
            continue
        group_years, merged = groups[people]
        group_years.append(year)
        for person, variables in single["people"].items():
            for variable, values in variables.items():
                merged["people"][person].setdefault(variable, {}).update(
                    values
                )
        for variable, values in single["households"]["household"].items():
            if variable != "members":
                merged["households"]["household"][variable].update(values)
    return list(groups.values())


def _frozen(value):
    """A field value as something hashable that compares by content, in
    order: policyengine-uk reads parameter changes in order (where two paths
    name one parameter, the later wins), so the same changes in another
    order are kept apart. A modifier (a function) compares by identity."""
    if value is None or callable(value):
        return value
    return json.dumps(value, default=repr)


def scenario_key(scenario: Optional[Scenario]):
    """What a scenario does, as a key: scenarios with the same key have the
    same field values, in the same order, and the same modifier, so share a
    simulation. Every field of the model counts, so a field a later engine
    adds keeps scenarios apart. A scenario that changes nothing is current
    law."""
    scenario = effective(scenario)
    if scenario is None:
        return None
    return tuple(
        (name, _frozen(getattr(scenario, name)))
        for name in type(scenario).model_fields
    )


class AsBuilt:
    """A simulation's state as built, restored before each year is read.

    A formula can read a value for another year once one is stored:
    ``current_education`` returns last year's stage when it has one, and
    otherwise derives it from age. Read in a simulation of its own, a year
    never has one; read after the year before in a simulation covering
    both, it would, and a child of 17 would keep their stage at 18 (with
    Child Benefit and the Universal Credit child element). So every value
    calculated since the simulation was built is deleted before each year,
    in the simulation and in the baseline simulations it holds (which
    formulas can read), and branches created since are dropped (an
    existing branch keeps the values it has calculated). The calculator's
    reads leave nothing in the baseline simulations and no branch behind
    today: the engine creates one branch during a read
    (``uc_non_dep_pension_credit``) and deletes it before the read ends.
    Those parts are there for a metric that would leave one.
    """

    def __init__(self, sim: Simulation):
        self.states = []
        seen = set()
        while sim is not None and id(sim) not in seen:
            seen.add(id(sim))
            known = {
                name: set(sim.get_holder(name).get_known_periods())
                for name in sim.tax_benefit_system.variables
            }
            self.states.append((sim, known, set(sim.branches)))
            sim = getattr(sim, "baseline", None)

    def restore(self) -> None:
        for sim, known, branches in self.states:
            for name, periods in known.items():
                holder = sim.get_holder(name)
                for period in list(holder.get_known_periods()):
                    if period not in periods:
                        holder.delete_arrays(period)
            for name in list(sim.branches):
                if name not in branches:
                    del sim.branches[name]


def create_simulation(
    situation: dict,
    year: int,
    reform_param_changes: dict | None = None,
    simulation_modifier: Callable | None = None,
) -> Simulation:
    """Create a PolicyEngine simulation with optional reform.

    Args:
        situation: PolicyEngine situation dictionary.
        year: The year to simulate.
        reform_param_changes: Parameter changes for the reform.
        simulation_modifier: Function to modify the simulation.

    Returns:
        Configured Simulation object.
    """
    # The changes go in as the national run applies them, through
    # policyengine-uk's Scenario: before fiscal-year conversion and the
    # parameters derived from them. Writing a value on 1 January afterwards
    # reached only what reads that one day: a monthly variable such as
    # fuel_duty saw 1/12 of a change, a duty kept on its statutory dates
    # (alcohol) saw none, and derived thresholds were not recomputed.
    # The modifier goes in the same Scenario, so the engine runs it where
    # the national run does and ignores what it returns: taking its return
    # as the simulation turned a modifier that returns nothing into None.
    scenario = {}
    if reform_param_changes:
        scenario["parameter_changes"] = reform_param_changes
    if simulation_modifier is not None:
        scenario["simulation_modifier"] = simulation_modifier
    return Simulation(
        situation=situation,
        scenario=Scenario(**scenario) if scenario else None,
    )


def household_simulations(
    situation: dict,
    reform: Reform,
    config: DataConfig,
    uses_config: Optional[bool] = None,
) -> tuple[Simulation, Simulation]:
    """The baseline and reformed simulations of a household under a
    measure, from the scenarios the national pipeline uses: the baseline
    from ``reform.baseline_scenario_for(config, uses_config)`` (the
    measure's own baseline, else the configured one, else current law) and
    the reform from ``reform.to_scenario()``. A side whose scenario changes
    nothing is built with none (``effective``), with the same results.

    Args:
        situation: PolicyEngine situation dictionary.
        reform: The measure.
        config: The configuration the national figures were generated with.
        uses_config: For a combined measure, whether any member uses the
            configured baseline, as publication passes it: members that
            each bring an empty baseline merge into an empty one, which on
            its own reads as none. Leave it None for a single measure.

    Returns:
        ``(baseline, reformed)``.
    """
    return (
        Simulation(
            situation=situation,
            scenario=effective(
                reform.baseline_scenario_for(config, uses_config)
            ),
        ),
        Simulation(
            situation=situation, scenario=effective(reform.to_scenario())
        ),
    )


# Scenario fields that change nothing on their own.
_INERT_FIELDS = ("applied_before_data_load",)
# Every Scenario field this code has read. A scenario with any other field
# is kept, whatever its value: what a new field does is unknown here.
_KNOWN_FIELDS = frozenset(
    _INERT_FIELDS
    + ("parameter_changes", "dated_reforms", "simulation_modifier")
)


def effective(scenario: Optional[Scenario]) -> Optional[Scenario]:
    """The scenario, or None when it changes nothing.

    Given any scenario, policyengine-uk builds a second, scenario-free
    simulation from the situation as the simulation's ``baseline``; given
    none, it clones itself. A scenario with no parameter changes, dated
    reforms or modifier applies nothing (an empty parameter rebuild returns
    at once), so it would only add that build: most registered measures
    keep current law on the reform side as ``parameter_changes={}``. A
    scenario with a field not in ``_KNOWN_FIELDS`` (one a later engine
    adds) is kept, whatever that field holds.
    """
    if scenario is None:
        return None
    if set(type(scenario).model_fields) - _KNOWN_FIELDS:
        return scenario
    if any(
        getattr(scenario, field) not in (None, {}, [])
        for field in type(scenario).model_fields
        if field not in _INERT_FIELDS
    ):
        return scenario
    return None


def calculate_household_metrics(sim: Simulation, year: int) -> dict:
    """Calculate key metrics for a household.

    Args:
        sim: PolicyEngine simulation.
        year: The year to calculate for.

    Returns:
        Dictionary of metric values.
    """
    # Get household net income (main metric)
    household_net_income = float(
        sim.calculate("household_net_income", year)[0]
    )

    # Get individual-level taxes (sum across all people)
    income_tax = float(sim.calculate("income_tax", year).sum())
    national_insurance = float(sim.calculate("national_insurance", year).sum())

    # Get benefit unit level benefits
    child_benefit = float(sim.calculate("child_benefit", year).sum())

    # Universal credit is at benefit unit level
    try:
        universal_credit = float(sim.calculate("universal_credit", year).sum())
    except Exception:
        universal_credit = 0.0

    # Council tax is at household level
    try:
        council_tax = float(
            sim.calculate("council_tax", year, map_to="household")[0]
        )
    except Exception:
        council_tax = 0.0

    return {
        "household_net_income": household_net_income,
        "income_tax": income_tax,
        "national_insurance": national_insurance,
        "child_benefit": child_benefit,
        "universal_credit": universal_credit,
        "council_tax": council_tax,
    }


def simulate_years(situation: dict, years: list[int], scenario) -> dict:
    """One simulation's metrics for each of ``years``: built once, and each
    year read from it as built (``AsBuilt``). Runs in a worker process when
    the calculator has more than one."""
    sim = Simulation(situation=situation, scenario=scenario)
    built = AsBuilt(sim)
    metrics = {}
    for year in years:
        built.restore()
        metrics[year] = calculate_household_metrics(sim, year)
    return metrics


# Where cgroup v2 states this process's CPU quota.
CGROUP_CPU_MAX = Path("/sys/fs/cgroup/cpu.max")


def household_workers() -> int:
    """How many worker processes a calculation uses.

    ``HOUSEHOLD_WORKERS`` if set (the deploy sets it with the instance's
    vCPUs), else the CPU quota of this process's cgroup (``cpu.max``), else
    1. Not the CPUs the process may be scheduled on: a Cloud Run instance
    can see more CPUs than its quota lets it use, and more workers than
    that would only share them and use more memory. With 1, every
    simulation is built in this process, one at a time.
    """
    configured = os.environ.get("HOUSEHOLD_WORKERS")
    if configured:
        try:
            return max(1, int(configured))
        except ValueError:
            # A misconfigured server, not a bad request: fall back.
            logging.getLogger(__name__).warning(
                "HOUSEHOLD_WORKERS=%r is not a whole number; ignoring it",
                configured,
            )
    try:
        quota, period = CGROUP_CPU_MAX.read_text().split()[:2]
    except (OSError, ValueError):
        return 1
    if quota == "max":
        return 1
    return max(1, int(int(quota) // int(period)))


_workers = set()
_workers_lock = threading.Lock()
_workers_generation = 0

# How long one household calculation's jobs may take, from before the first
# is started (a cold forkserver's start counts), before the calculation is
# abandoned and its workers stopped (Cloud Run's request limit is 300 s), so
# a hung worker can't hold every later calculation. Time a request spends
# waiting for the API's one-at-a-time limiter is not counted.
CALCULATION_TIMEOUT_SECONDS = float(
    os.environ.get("HOUSEHOLD_CALCULATION_TIMEOUT", "280")
)


def _worker_context():
    """Fork from a preloaded engine, or spawn where forkserver is absent."""
    methods = multiprocessing.get_all_start_methods()
    context = multiprocessing.get_context(
        "forkserver" if "forkserver" in methods else "spawn"
    )
    # Set before starting the forkserver (or a spawned worker). This
    # process has already imported numexpr, so it is unaffected. Set,
    # rather than default: inherited values above 1 exceed the maximum.
    for name in (
        "NUMEXPR_NUM_THREADS",
        "NUMEXPR_MAX_THREADS",
        "OMP_NUM_THREADS",
    ):
        os.environ[name] = "1"
    if context.get_start_method() == "forkserver":
        context.set_forkserver_preload(["uk_budget_data.personal_impact"])
    return context


_lifeline = None


def _server_lifeline():
    """The read end of a pipe whose only write end this process holds, for
    its workers to watch. A process's descriptors close as it exits,
    however it exits, so the read end sees end-of-file the moment it has
    gone: a PID check would not (a killed process stays a zombie until its
    parent reaps it, and its PID can be reused)."""
    global _lifeline
    if _lifeline is None:
        _lifeline = multiprocessing.Pipe(duplex=False)
    return _lifeline[0]


def _exit_with_server(lifeline) -> None:
    """Run in each worker as it starts: exit once the server process has
    gone, however it went. A worker holds the forkserver's lifeline, so a
    worker orphaned by a server killed outright (no shutdown hook runs)
    would otherwise keep itself and the forkserver alive."""

    def watch():
        try:
            lifeline.recv_bytes()
        except (EOFError, OSError):
            pass
        os._exit(0)

    threading.Thread(target=watch, daemon=True).start()


class WorkerDied(RuntimeError):
    """A worker exited without returning its call's result."""


class WorkerError(RuntimeError):
    """A call failed in a worker; the message is its traceback there."""


def live_workers() -> list:
    """A snapshot of the processes currently owned by worker runners."""
    with _workers_lock:
        return list(_workers)


def stop_workers(wait_seconds: float = 5) -> None:
    """Kill every tracked worker and wait up to ``wait_seconds`` for them.

    The API calls this from its lifespan shutdown, which uvicorn runs once
    in-flight requests have finished, so normally there is nothing left to
    kill. A worker of a run that is still starting is killed by that run as
    soon as it sees the shutdown. Where the server is killed before its
    shutdown runs (Cloud Run sends SIGKILL 10 s after SIGTERM), each
    worker's lifeline stops it instead.
    """
    global _workers_generation
    deadline = time.monotonic() + wait_seconds
    with _workers_lock:
        # A run that starts a process after this snapshot sees the new
        # generation when it registers it, and kills it itself.
        _workers_generation += 1
        processes = list(_workers)
    for process in processes:
        # Kill only: each run joins its own processes. A second joiner
        # would race the forkserver's one-shot exit-status pipe and could
        # read 255 for a process killed by SIGKILL (review of #49).
        try:
            process.kill()
        except (OSError, ValueError):
            pass
    while time.monotonic() < deadline:
        with _workers_lock:
            if _workers.isdisjoint(processes):
                return
        time.sleep(0.01)
    with _workers_lock:
        _workers.difference_update(processes)


def _run_call(writer, lifeline, function, args) -> None:
    """Run one call in a child, with its own result pipe and lifeline."""
    _exit_with_server(lifeline)
    try:
        try:
            writer.send(("ok", function(*args)))
        except BaseException as error:
            text = "".join(traceback.format_exception(error))
            try:
                # Sent pre-pickled, so the parent can unpickle it on its own
                # and fall back to the traceback text (see
                # _raise_worker_error).
                blob = pickle.dumps(error)
            except Exception:
                blob = None
            writer.send(("error", (blob, text)))
    finally:
        writer.close()


def _raise_worker_error(blob, text):
    """Re-raise a worker's exception, chained to its traceback there. An
    exception that pickles but cannot be rebuilt (policyengine-core's
    VariableNotFoundError, say) would otherwise surface here as an
    unrelated TypeError; it arrives as a WorkerError with its traceback."""
    remote = WorkerError(f"in the worker:\n{text}")
    error = None
    if blob is not None:
        try:
            error = pickle.loads(blob)
        except Exception:
            error = None
    if error is None:
        raise remote
    raise error from remote


class FairSlots:
    """The instance's worker processes, shared by every calculation at once.

    ``size`` processes run at a time across all calculations, so CPU and
    memory stay bounded however many requests the API admits. A
    calculation with no process running waits in a queue, first come first
    served (``acquire``); one already running may start another only when
    nobody is queued (``try_acquire``). So a new visitor's two-run headline
    starts as soon as any process finishes, between another visitor's
    per-policy runs, instead of after that whole calculation, and a
    calculation that holds slots never waits for one (no deadlock).
    """

    def __init__(self, size: int):
        if size < 1:
            raise ValueError("size must be at least one")
        self.size = size
        self._cond = threading.Condition()
        self._free = size
        self._queue: deque = deque()

    def try_acquire(self) -> bool:
        with self._cond:
            if self._free > 0 and not self._queue:
                self._free -= 1
                return True
            return False

    def acquire(self, timeout: float) -> bool:
        ticket = object()
        with self._cond:
            self._queue.append(ticket)
            try:
                got = self._cond.wait_for(
                    lambda: self._free > 0 and self._queue[0] is ticket,
                    timeout,
                )
                if got:
                    self._free -= 1
                return got
            finally:
                self._queue.remove(ticket)
                self._cond.notify_all()

    def release(self) -> None:
        with self._cond:
            self._free += 1
            self._cond.notify_all()

    @property
    def free(self) -> int:
        with self._cond:
            return self._free


_slots: Optional[FairSlots] = None
_slots_lock = threading.Lock()


def household_slots() -> FairSlots:
    """The instance's shared worker slots, ``household_workers()`` of
    them."""
    global _slots
    with _slots_lock:
        if _slots is None:
            _slots = FairSlots(household_workers())
        return _slots


# While a calculation waits for its own processes with calls still to
# start, how often it looks for a slot another calculation freed.
SLOT_POLL_SECONDS = 0.2


def run_in_workers(
    workers: int,
    calls: list[tuple[Callable, tuple]],
    timeout: float,
    slots: Optional[FairSlots] = None,
) -> list:
    """Run each picklable-by-reference call in its own process, in order.

    At most ``workers`` processes run at once, and startup counts towards
    ``timeout``. Each invocation owns its processes and pipes, so concurrent
    invocations are safe. With ``slots``, each process also holds one of
    the instance's shared slots (``FairSlots``), so concurrent invocations
    share the instance's processes fairly; time waiting for a slot counts
    towards ``timeout``.
    Every process is stopped and joined before this function returns or
    raises, including when another call fails or the deadline expires.
    """
    deadline = time.monotonic() + timeout
    if workers < 1:
        raise ValueError("workers must be at least one")
    with _workers_lock:
        lifeline = _server_lifeline()
        generation = _workers_generation
    context = _worker_context()
    active = {}
    results = [None] * len(calls)
    next_call = 0

    def remaining():
        seconds = deadline - time.monotonic()
        if seconds <= 0:
            raise TimeoutError(
                f"The worker calls took more than {timeout:g} s"
            )
        return seconds

    try:
        while next_call < len(calls) or active:
            while next_call < len(calls) and len(active) < workers:
                remaining()
                if slots is not None:
                    if active:
                        if not slots.try_acquire():
                            break
                    elif not slots.acquire(remaining()):
                        remaining()
                        raise TimeoutError(
                            f"No worker was free within {timeout:g} s"
                        )
                function, args = calls[next_call]
                reader, writer = context.Pipe(duplex=False)
                try:
                    process = context.Process(
                        target=_run_call,
                        args=(writer, lifeline, function, args),
                        daemon=True,
                    )
                    with _workers_lock:
                        cancelled = generation != _workers_generation
                    if cancelled:
                        raise WorkerDied(
                            f"Worker for call {next_call} cancelled by server "
                            "shutdown"
                        )
                    remaining()
                    # Started outside the lock: a cold forkserver can take
                    # the engine's whole preload, and stop_workers must not
                    # wait behind it.
                    try:
                        process.start()
                    finally:
                        writer.close()
                    with _workers_lock:
                        _workers.add(process)
                        cancelled = generation != _workers_generation
                    active[reader] = (next_call, process)
                    if cancelled:
                        # Shutdown's snapshot may have missed it.
                        raise WorkerDied(
                            f"Worker for call {next_call} cancelled by server "
                            "shutdown"
                        )
                except BaseException:
                    reader.close()
                    writer.close()
                    if slots is not None and reader not in active:
                        slots.release()
                    raise
                next_call += 1
            waiting = (
                slots is not None
                and next_call < len(calls)
                and len(active) < workers
            )
            ready = wait(
                list(active),
                timeout=(
                    min(remaining(), SLOT_POLL_SECONDS)
                    if waiting
                    else remaining()
                ),
            )
            remaining()
            for reader in ready:
                index, process = active[reader]
                try:
                    try:
                        status, value = reader.recv()
                    except (EOFError, OSError) as error:
                        raise WorkerDied(
                            f"Worker for call {index} died without a result"
                        ) from error
                finally:
                    reader.close()
                    process.join(timeout=5)
                    if process.is_alive():
                        process.kill()
                    process.join()
                    with _workers_lock:
                        _workers.discard(process)
                    del active[reader]
                    if slots is not None:
                        slots.release()
                if status == "error":
                    _raise_worker_error(*value)
                remaining()
                results[index] = value
        return results
    finally:
        # Kill all siblings before joining any: no job survives a failure.
        for _, process in active.values():
            if process.is_alive():
                process.kill()
        for reader, (_, process) in active.items():
            process.join()
            reader.close()
            if slots is not None:
                slots.release()
        with _workers_lock:
            _workers.difference_update(p for _, p in active.values())


def run_jobs(workers: int, jobs: list) -> list:
    """Each job's metrics, computed in worker processes.

    Concurrent calls are safe because each owns its processes, and their
    processes take the instance's shared slots (``household_slots``), so
    this route and the household route never run more processes between
    them than the instance has workers.
    """
    return run_in_workers(
        workers,
        [
            (simulate_years, (situation, years, scenario))
            for years, situation, _, scenario in jobs
        ],
        CALCULATION_TIMEOUT_SECONDS,
        slots=household_slots(),
    )


class PersonalImpactCalculator:
    """Calculator for personal household impact from budget policies."""

    def __init__(
        self,
        config: Optional[DataConfig] = None,
        workers: Optional[int] = None,
    ):
        """Initialize the calculator by loading reforms.

        Args:
            config: The configuration the national figures were generated
                with, whose baseline a measure without its own is compared
                against. The default is ``generate``'s, which sets no
                global baseline.
            workers: Worker processes per calculation; the default is
                ``household_workers()``. With one, every simulation is
                built in this process, one at a time.
        """
        self.config = config if config is not None else DataConfig()
        self.workers = workers if workers is not None else household_workers()
        self.reforms = {
            reform.id: reform
            for reform in get_autumn_budget_2026_reforms()
            if reform.id in POLICY_IDS
        }

    def calculate(self, household: HouseholdInput) -> dict:
        """Calculate the impact of all policies on a household.

        Args:
            household: Household input parameters.

        Returns:
            Dictionary with year-by-year breakdown per policy.
        """
        results = {
            "household_input": {
                "employment_income": household.employment_income,
                "income_growth_rate": household.income_growth_rate,
                "is_married": household.is_married,
                "partner_income": household.partner_income,
                "children_ages": household.children_ages,
                "property_income": household.property_income,
                "savings_income": household.savings_income,
                "dividend_income": household.dividend_income,
                "pension_contributions_salary_sacrifice": (
                    household.pension_contributions_salary_sacrifice
                ),
                "fuel_spending": household.fuel_spending,
                "rail_spending": household.rail_spending,
            },
            "years": {},
            "policies": {},
            "totals": {
                "by_year": {},
                "cumulative": 0,
            },
        }

        # Every simulation the results need, keyed by what its scenario does:
        # the configured baseline, and each measure's two sides. Most
        # measures share a side (current law, for one), and a simulation
        # answers every year, so each distinct scenario is built once per
        # set of people, not once per measure and year: construction, not
        # calculation, is what takes the time.
        reforms = [
            (policy_id, self.reforms[policy_id])
            for policy_id in POLICY_IDS
            if policy_id in self.reforms
        ]
        scenarios = {}

        def needed(scenario):
            key = scenario_key(scenario)
            scenarios.setdefault(key, effective(scenario))
            return key

        configured = needed(self.config.get_baseline_scenario())
        sides = {
            policy_id: (
                needed(reform.baseline_scenario_for(self.config)),
                needed(reform.to_scenario()),
            )
            for policy_id, reform in reforms
        }
        # One job per situation and distinct scenario. With several
        # workers they run in parallel, each simulation in a process of its
        # own; with one, here, one at a time, so memory stays that of one
        # simulation (with the baseline simulation the engine builds inside
        # it).
        jobs = [
            (years, situation, key, scenario)
            for years, situation in build_situations(household, YEARS)
            for key, scenario in scenarios.items()
        ]
        if self.workers > 1 and len(jobs) > 1:
            outputs = run_jobs(self.workers, jobs)
        else:
            outputs = [
                simulate_years(situation, years, scenario)
                for years, situation, _, scenario in jobs
            ]
        metrics = {}
        for (years, _, key, _), output in zip(jobs, outputs):
            for year in years:
                metrics[key, year] = output[year]

        for year in YEARS:
            results["years"][year] = {
                "baseline": dict(metrics[configured, year]),
                "policies": {},
            }

        # Calculate impact of each policy
        for policy_id, reform in reforms:
            policy_results = {
                "name": reform.name,
                "description": reform.description,
                "years": {},
                "total_impact": 0,
            }
            baseline_key, reform_key = sides[policy_id]

            for year in YEARS:
                baseline_metrics = dict(metrics[baseline_key, year])
                reform_metrics = dict(metrics[reform_key, year])

                # Calculate the impact (positive = household gains)
                net_income_change = (
                    reform_metrics["household_net_income"]
                    - baseline_metrics["household_net_income"]
                )

                policy_results["years"][year] = {
                    "baseline_net_income": baseline_metrics[
                        "household_net_income"
                    ],
                    "reformed_net_income": reform_metrics[
                        "household_net_income"
                    ],
                    "net_income_change": net_income_change,
                    "baseline_metrics": baseline_metrics,
                    "reformed_metrics": reform_metrics,
                }

                policy_results["total_impact"] += net_income_change
                results["years"][year]["policies"][policy_id] = {
                    "net_income_change": net_income_change
                }

            results["policies"][policy_id] = policy_results

        # Calculate totals
        for year in YEARS:
            year_total = sum(
                results["policies"][pid]["years"][year]["net_income_change"]
                for pid in POLICY_IDS
                if pid in results["policies"]
            )
            results["totals"]["by_year"][year] = year_total

        results["totals"]["cumulative"] = sum(
            results["totals"]["by_year"].values()
        )

        return results
