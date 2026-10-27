"""Run independent generation units side by side, within the machine's memory.

A *unit* is one measure: its baseline and reformed microsimulations, built
once and read for every year. A unit is the smallest piece of work whose
gates hold on their own: the data-limit watch (``data_limits.observing``),
the model-limit check and the receipt all read one pair of simulations
across every year, so a measure is never split across processes. The one
exception is income_distribution and income_growth on Modal, whose rows are
made a year at a time: there each measure's years run as units of their own
and are merged back (``pipeline.flat_units`` with ``by_year``).

Runners map a picklable function over units and return the results **in
unit order**, whatever order they finish in, so the files written from them
are the same bytes as a serial run's:

- :class:`SerialRunner` runs them here, one after another (``--jobs 1``, the
  default, and what the tests' stand-ins need).
- :class:`ProcessRunner` runs them in worker processes started from a
  forkserver that has already imported the engine, one fresh worker per
  unit, so a finished unit's memory goes back to the machine. Before it
  starts a unit it checks that the machine still has that unit's memory
  free, and otherwise waits for a running unit to finish: other jobs on the
  machine are allowed for, and the machine is never driven into swap by
  this run.
- ``uk_budget_data.modal_runner.ModalRunner`` (``--backend modal``) runs
  them in Modal containers.

``--jobs auto`` picks the number of workers from the free memory and the
per-unit peak (:func:`plan_jobs`).
"""

from __future__ import annotations

import multiprocessing
import os
import platform
import re
import subprocess
import time
from concurrent.futures import FIRST_COMPLETED, Future, ProcessPoolExecutor
from concurrent.futures import wait as wait_futures
from dataclasses import dataclass
from typing import Callable, Optional, Protocol, Sequence

GB = 1024**3

# Peak memory footprint of one unit (a measure's two simulations, in a
# process of its own; macOS's footprint counts compressed pages, which
# resident size leaves out), measured on 24 October 2026 with policyengine
# 6.10.2 and the pinned Microcosm national dataset (``/usr/bin/time -l``):
# 19.1 GB over two years and 22.5 GB over six. The peak grows a little with
# the years read, so it is estimated per year. Area runs (geography), which
# have not been measured side by side, still hold a unit back for this much.
FOOTPRINT_BASE_GB = 17.4
FOOTPRINT_PER_YEAR_GB = 0.85
# What a flat-table unit holds in physical memory at its peak while others
# run beside it: the full run (nine measures and the combined package, six
# years) measured on 25 October 2026 on an 18-core, 64 GB Mac reached 12.8
# GB resident across two units (6.4 GB each) at --jobs 2 and 16.4 GB across
# three at --jobs 4, with swap rising no more than in the serial run. The
# footprint above is most of a unit's pages compressed or swapped, and
# holding a unit back for it kept auto and --jobs 2 to one unit at a time
# on a machine with 21 GB free.
UNIT_GB = 6.5
# A unit's memory grows over its first minutes (the two builds, then the
# calculation), so a unit that started less than this long ago still counts
# as needing its whole estimate when the next is admitted.
RAMP_S = 180.0
# Memory left for the system and everything else running.
RESERVE_GB = 6.0
# How often a waiting unit re-reads the free memory.
ADMISSION_POLL_S = 5.0
# With no unit running, how long a run waits for a unit's memory before it
# starts the unit alone anyway, as a serial run would: the free figure may
# never reach the estimate on a busy machine (another process holding
# memory), and waiting for it without end would make --jobs N slower than
# --jobs 1. Waited once per run: after that, a unit with none running starts
# at once.
ALONE_WAIT_S = 60.0

# The modules each worker needs, imported once in the forkserver so that a
# worker starts with the engine and its parameters already loaded.
PRELOAD = ["uk_budget_data.pipeline", "policyengine_uk.system"]


def unit_memory_gb(years: int) -> float:
    """Estimated peak resident memory of one flat-table measure (any number
    of years up to the six measured)."""
    return UNIT_GB


def footprint_memory_gb(years: int) -> float:
    """Estimated peak footprint of one measure over ``years`` years: what an
    area run holds a unit back for."""
    return FOOTPRINT_BASE_GB + FOOTPRINT_PER_YEAR_GB * max(1, int(years))


# -- the machine's memory ----------------------------------------------------


def _sysctl(name: str) -> str:
    return subprocess.run(
        ["sysctl", "-n", name], capture_output=True, text=True, check=True
    ).stdout.strip()


def available_memory_bytes() -> int:
    """Memory the system can give a new process without swapping.

    Linux: ``MemAvailable``. macOS: free, inactive, speculative and
    purgeable pages (what Activity Monitor counts as available). Elsewhere,
    the total physical memory, halved.
    """
    system = platform.system()
    if system == "Linux":
        with open("/proc/meminfo") as meminfo:
            for line in meminfo:
                if line.startswith("MemAvailable:"):
                    return int(line.split()[1]) * 1024
    if system == "Darwin":
        out = subprocess.run(
            ["vm_stat"], capture_output=True, text=True, check=True
        ).stdout
        page = int(re.search(r"page size of (\d+) bytes", out).group(1))
        pages = {
            key.strip().lower(): int(value.strip().rstrip("."))
            for key, value in (
                line.split(":", 1)
                for line in out.splitlines()[1:]
                if ":" in line
            )
            if value.strip().rstrip(".").isdigit()
        }
        free = sum(
            pages.get(name, 0)
            for name in (
                "pages free",
                "pages inactive",
                "pages speculative",
                "pages purgeable",
            )
        )
        return free * page
    return os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES") // 2


def swap_used_bytes() -> int:
    """Swap in use (0 where it cannot be read)."""
    try:
        if platform.system() == "Darwin":
            used = re.search(r"used = ([\d.]+)M", _sysctl("vm.swapusage"))
            return int(float(used.group(1)) * 1024**2) if used else 0
        if platform.system() == "Linux":
            values = {}
            with open("/proc/meminfo") as meminfo:
                for line in meminfo:
                    key, rest = line.split(":", 1)
                    values[key] = int(rest.split()[0]) * 1024
            return values.get("SwapTotal", 0) - values.get("SwapFree", 0)
    except (OSError, subprocess.SubprocessError, ValueError, AttributeError):
        pass
    return 0


@dataclass(frozen=True)
class JobPlan:
    """How many units run at once, and why."""

    jobs: int
    unit_gb: float
    available_gb: float
    reason: str


def plan_jobs(
    jobs: str | int,
    units: int,
    unit_gb: float,
    *,
    available: Optional[int] = None,
    cpus: Optional[int] = None,
    reserve_gb: float = RESERVE_GB,
) -> JobPlan:
    """The number of workers for ``--jobs``.

    A number is taken as given (at most one per unit). ``auto`` takes as
    many as the free memory holds at ``unit_gb`` each after ``reserve_gb``
    is kept back, at most one per core (less one) and one per unit, and at
    least one.
    """
    units = max(1, int(units))
    available = available_memory_bytes() if available is None else available
    available_gb = available / GB
    if str(jobs) != "auto":
        count = int(jobs)
        if count < 1:
            raise ValueError("--jobs must be at least 1, or auto")
        count = min(count, units)
        return JobPlan(count, unit_gb, available_gb, f"--jobs {jobs}")
    cpus = cpus or os.cpu_count() or 1
    by_memory = int((available_gb - reserve_gb) // unit_gb)
    count = max(1, min(by_memory, max(1, cpus - 1), units))
    return JobPlan(
        count,
        unit_gb,
        available_gb,
        f"auto: {available_gb:.0f} GB free, {reserve_gb:.0f} GB kept back, "
        f"{unit_gb:.1f} GB per unit, {cpus} cores, {units} units",
    )


# -- runners -----------------------------------------------------------------


class Runner(Protocol):
    """Maps ``function`` over ``units``, returning results in unit order."""

    def map(
        self,
        function: Callable,
        units: Sequence,
        on_result: Callable[[int, object], None] = lambda i, r: None,
    ) -> list: ...


class SerialRunner:
    """One unit after another, in this process."""

    jobs = 1
    # Its units never leave this process, so a measure need not pickle.
    in_process = True

    def map(self, function, units, on_result=lambda i, r: None) -> list:
        results = []
        for index, unit in enumerate(units):
            result = function(unit)
            results.append(result)
            on_result(index, result)
        return results


def _context():
    """A forkserver that has imported the engine, or spawn without one."""
    methods = multiprocessing.get_all_start_methods()
    context = multiprocessing.get_context(
        "forkserver" if "forkserver" in methods else "spawn"
    )
    if context.get_start_method() == "forkserver":
        context.set_forkserver_preload(PRELOAD)
    return context


class ProcessRunner:
    """Units in worker processes, ``jobs`` at a time, within free memory.

    Each unit gets a fresh worker forked from the preloaded forkserver
    (``max_tasks_per_child=1``), so its simulations' memory is returned when
    it ends. A unit starts only when ``unit_gb`` (plus the reserve) is free;
    otherwise it waits for a running one to finish, or, with none running,
    for memory to free up, for at most ``alone_wait_s`` in the whole run,
    after which such a unit starts alone at once, as a serial run would. Results come back in unit order.
    """

    def __init__(
        self,
        jobs: int,
        unit_gb: float,
        *,
        reserve_gb: float = RESERVE_GB,
        available: Callable[[], int] = available_memory_bytes,
        poll_s: float = ADMISSION_POLL_S,
        ramp_s: float = RAMP_S,
        alone_wait_s: float = ALONE_WAIT_S,
        on_wait: Callable[[str], None] = lambda message: None,
        context=None,
    ):
        if jobs < 1:
            raise ValueError("jobs must be at least 1")
        self.jobs = jobs
        self.unit_gb = unit_gb
        self.reserve_gb = reserve_gb
        self.available = available
        self.poll_s = poll_s
        self.ramp_s = ramp_s
        self.alone_wait_s = alone_wait_s
        self.on_wait = on_wait
        self.context = context

    def _room(self, ramping: int = 0) -> bool:
        """Whether one more unit fits: the free memory, less the reserve
        and the whole estimate of each unit still ramping up (whose memory
        the free figure does not show yet), holds one more unit."""
        free = self.available() / GB - self.reserve_gb
        return free - ramping * self.unit_gb >= self.unit_gb

    def map(self, function, units, on_result=lambda i, r: None) -> list:
        units = list(units)
        results: list = [None] * len(units)
        done = [False] * len(units)
        reported = 0
        pending = list(enumerate(units))
        running: dict[Future, int] = {}
        started: dict[Future, float] = {}
        context = self.context or _context()
        alone_wait_left = self.alone_wait_s
        with ProcessPoolExecutor(
            max_workers=self.jobs,
            mp_context=context,
            max_tasks_per_child=1,
        ) as pool:
            try:
                while pending or running:
                    while pending and len(running) < self.jobs:
                        now = time.monotonic()
                        ramping = sum(
                            1
                            for future in running
                            if now - started[future] < self.ramp_s
                        )
                        if running and not self._room(ramping):
                            break
                        if not running:
                            waited = 0.0
                            while alone_wait_left > 0 and not self._room():
                                if waited >= alone_wait_left:
                                    self.on_wait(
                                        f"starting the next unit alone after "
                                        f"{waited:.0f} s: "
                                        f"{self.available() / GB:.0f} GB "
                                        "free, as a serial run would; later "
                                        "units with none running start at "
                                        "once"
                                    )
                                    alone_wait_left = 0.0
                                    break
                                if waited == 0.0:
                                    self.on_wait(
                                        f"waiting for {self.unit_gb:.0f} GB "
                                        "of free memory before the next unit"
                                    )
                                time.sleep(self.poll_s)
                                waited += self.poll_s
                        index, unit = pending.pop(0)
                        future = pool.submit(function, unit)
                        running[future] = index
                        started[future] = time.monotonic()
                    # Wake on a finished unit, or to look at the memory
                    # again once a unit may have finished ramping up.
                    finished, _ = wait_futures(
                        list(running),
                        timeout=self.poll_s if pending else None,
                        return_when=FIRST_COMPLETED,
                    )
                    for future in finished:
                        started.pop(future, None)
                        index = running.pop(future)
                        results[index] = future.result()
                        done[index] = True
                    # Report in unit order, as a serial run would.
                    while reported < len(units) and done[reported]:
                        on_result(reported, results[reported])
                        reported += 1
            except BaseException:
                for future in running:
                    future.cancel()
                raise
        return results


def make_runner(
    jobs: str | int,
    units: int,
    years: int,
    *,
    backend: str = "local",
    say: Callable[[str], None] = print,
    unit_gb: Optional[float] = None,
    swap_limit_gb: float = 30.0,
    **modal_options,
) -> Runner:
    """The runner for ``--jobs`` and ``--backend``.

    ``local`` with one job is the serial runner. With more, the process
    runner, which refuses to start while the machine already has more than
    ``swap_limit_gb`` in swap. ``modal`` sends units to Modal
    (``uk_budget_data.modal_runner``), which needs Modal credentials.
    """
    if backend == "modal":
        from uk_budget_data.modal_runner import ModalRunner

        return ModalRunner(say=say, **modal_options)
    if backend != "local":
        raise ValueError(f"unknown backend {backend!r}")
    unit_gb = unit_memory_gb(years) if unit_gb is None else unit_gb
    plan = plan_jobs(jobs, units, unit_gb)
    if plan.jobs == 1:
        if str(jobs) == "auto":
            say(f"Jobs: 1 ({plan.reason})")
        return SerialRunner()
    swap_gb = swap_used_bytes() / GB
    if swap_gb > swap_limit_gb:
        say(
            f"Jobs: 1: {swap_gb:.0f} GB of swap is in use already, above "
            f"{swap_limit_gb:.0f} GB, so units run one at a time"
        )
        return SerialRunner()
    say(f"Jobs: {plan.jobs} ({plan.reason})")
    return ProcessRunner(plan.jobs, unit_gb, on_wait=say)


def add_jobs_arguments(parser, modal: bool = False) -> None:
    """``--jobs`` (and ``--backend``): run measures side by side."""
    parser.add_argument(
        "--jobs",
        default="1",
        metavar="N|auto",
        help=(
            "Measures to run at once, each in its own worker process "
            "(default: 1, one after another). auto picks as many as the "
            "free memory holds at --unit-memory-gb each. The files written "
            "are the same bytes as a serial run's."
        ),
    )
    parser.add_argument(
        "--unit-memory-gb",
        type=float,
        default=None,
        help=(
            "Peak memory of one measure, for --jobs auto and for holding a "
            "measure back until that much is free (default: estimated from "
            "the number of years)"
        ),
    )
    if modal:
        parser.add_argument(
            "--backend",
            choices=["local", "modal"],
            default="local",
            help=(
                "Where measures run: local (default) or modal, one Modal "
                "container per measure (flat CSVs and --only only; needs "
                "Modal credentials and the HF token secret, see "
                "docs/budget-day-runbook.md)"
            ),
        )


# -- carrying a measure to a worker ------------------------------------------


@dataclass(frozen=True)
class RegisteredReform:
    """A registered measure, sent by id: some registered measures carry
    simulation modifiers defined inside functions, which cannot be pickled.
    The worker looks the id up in the same registry (``reforms.get_reform``),
    from the same code."""

    id: str


def portable(reform, runner=None):
    """``reform`` itself if it can be pickled, else its registered id.

    A runner that keeps its units in this process (``in_process``, as
    :class:`SerialRunner` does) takes ``reform`` as it is, so a serial run
    still takes a measure that neither pickles nor is registered.

    Raises ValueError for an unpicklable measure the registry does not
    hold under its id, since a worker could not rebuild it.
    """
    import pickle

    if getattr(runner, "in_process", False):
        return reform

    try:
        pickle.dumps(reform)
        return reform
    except (pickle.PicklingError, AttributeError, TypeError):
        from uk_budget_data.reforms import get_reform

        if get_reform(reform.id) is None:
            raise ValueError(
                f"{reform.id} cannot be sent to a worker: it cannot be "
                "pickled and is not a registered measure"
            ) from None
        return RegisteredReform(reform.id)


@dataclass(frozen=True)
class CombinedMeasures:
    """A combined run of several measures, sent as its members: a composed
    measure's modifiers cannot be pickled, so it is composed again where it
    runs (``publication.combine.combine_measures``), as a combined
    artifact's run is. ``id`` is the combined key of its members
    (``combine.combined_key``), the key the publication manifest gives that
    combined run, so its rows in a flat file name exactly its members."""

    id: str
    members: tuple


def portable_combined(members, runner=None) -> CombinedMeasures:
    """A combined run of ``members`` (Reforms) that a worker can rebuild."""
    from uk_budget_data.publication import combine

    ordered = combine.member_order(list(members))
    return CombinedMeasures(
        id=combine.combined_key([member.id for member in ordered]),
        members=tuple(portable(member, runner) for member in ordered),
    )


def resolve_reform(reference, config=None):
    """The measure a :func:`portable` reference stands for. A combined run
    is composed from its members on ``config``'s baseline."""
    if isinstance(reference, RegisteredReform):
        from uk_budget_data.reforms import get_reform

        return get_reform(reference.id)
    if isinstance(reference, CombinedMeasures):
        from uk_budget_data.models import DataConfig
        from uk_budget_data.publication import combine

        members = [resolve_reform(member) for member in reference.members]
        combined = combine.combine_measures(members, config or DataConfig())
        if combined.id != reference.id:
            raise ValueError(
                f"{reference.id}: its members compose to {combined.id}"
            )
        return combined
    return reference
