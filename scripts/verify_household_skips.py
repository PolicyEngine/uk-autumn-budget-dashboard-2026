"""Which household skip rules are on, and the check that turns one back on.

A skip rule (``household_impact.rule_says_unaffected``) applies only to the
definition its last check ran on (``household_skip_definitions``): once a
measure's definition changes, its rule is off and the calculator runs the
measure in full. See docs/budget-day-runbook.md, "Fewer runs".

    uv run python scripts/verify_household_skips.py --status

prints each measure's rule and exits 1 if a registered measure's rule is off.

    uv run python scripts/verify_household_skips.py --recheck [MEASURE ...]

runs the rules that are off (or the ones named) against the engine, for the
named households and generated ones (``--households``, ``--seed``), in every
policy year, in every selection whose before side differs. A rule that holds
everywhere gets the running code's digest in
``src/uk_budget_data/household_skip_rules.json``: commit that file. A rule
that fails loses any digest it had, so it is off whatever its definition, and
the command prints the smallest household showing it and exits 1: correct the
rule, or leave the measure running in full.
"""

import argparse
import sys
import time
from concurrent.futures import ProcessPoolExecutor


def case(args):
    """One (household, year) through the calculator itself, every measure
    run, for ``modal_verify_household_skips.py``: the measures whose rule
    says £0 and whose run shows otherwise, as (id, change, status)."""
    import os

    os.environ.pop("HOUSEHOLD_RUNNER", None)
    from uk_budget_data import household_impact as hi

    answers, year = args
    ids = hi.measure_ids()
    hi.clear_runs()
    full = hi.calculate_household_impact(
        answers, ids, year, include=("by_policy",), skip_unaffected=False
    )
    claimed = [i for i in ids if hi.rule_says_unaffected(i, answers, year)]
    bad = [
        (measure["id"], measure["change"], measure["status"])
        for measure in full["by_policy"]["measures"]
        if measure["id"] in claimed and measure["status"] != "not_affected"
    ]
    return year, claimed, bad


def gen(count, seed=2026):
    from uk_budget_data.household_skip_check import generated_households

    return generated_households(count, seed)


def _check_one_year(args):
    from uk_budget_data import household_skip_check as check

    year, count, seed = args
    households = list(check.NAMED_HOUSEHOLDS.values()) + (
        check.generated_households(count, seed + year)
    )
    result = check.check_year(households, year)
    counterexamples = [
        (effect, *check.smallest_counterexample(effect, households))
        for effect in {
            (effect.selection, effect.measure): effect
            for effect in result.broken()
        }.values()
    ]
    covered = {}
    for effect in result.effects:
        covered.setdefault(effect.measure, [0, 0])
        covered[effect.measure][effect.rule_says_unaffected] += 1
    return year, covered, counterexamples


def status() -> int:
    from uk_budget_data import household_impact as hi
    from uk_budget_data import household_skip_definitions as definitions

    statuses = definitions.rule_statuses(hi.SKIP_REASONS)
    checked = definitions.checked_definitions()
    current = definitions.current_definitions()
    width = max(len(id_) for id_ in statuses)
    off = []
    for id_, state in statuses.items():
        print(
            f"{id_:<{width}}  {state}"
            f"  (checked {checked.get(id_, 'never')[:12]},"
            f" now {current.get(id_, 'none')[:12]})"
        )
        if state not in (
            definitions.CURRENT,
            definitions.NO_RULE,
            definitions.NOT_REGISTERED,
        ):
            off.append(id_)
    if off:
        print(
            f"\n{len(off)} registered measure(s) run in full until rechecked: "
            f"{', '.join(off)}\nThe answers stay right; they only take "
            "longer. To check a rule again:\n"
            "  uv run python scripts/verify_household_skips.py --recheck "
            f"{' '.join(off)}\nthen commit "
            "src/uk_budget_data/household_skip_rules.json."
        )
    return 1 if off else 0


def recheck(measures, households, seed, processes) -> int:
    from uk_budget_data import household_impact as hi
    from uk_budget_data import household_skip_check as check
    from uk_budget_data import household_skip_definitions as definitions
    from uk_budget_data.budget_years import POLICY_YEARS

    statuses = definitions.rule_statuses(hi.SKIP_REASONS)
    unknown = [id_ for id_ in measures if id_ not in hi.SKIP_REASONS]
    unregistered = [
        id_
        for id_ in measures
        if statuses.get(id_) == definitions.NOT_REGISTERED
    ]
    refused = [
        *(f"{id_} has no rule" for id_ in unknown),
        *(f"{id_} isn't registered" for id_ in unregistered),
    ]
    if refused:
        print(f"No rule to check: {'; '.join(refused)}.")
        return 2
    wanted = measures or [
        id_
        for id_, state in statuses.items()
        if state
        not in (
            definitions.CURRENT,
            definitions.NO_RULE,
            definitions.NOT_REGISTERED,
        )
    ]
    if not wanted:
        print("Every registered measure's rule is current; nothing to check.")
        return 0
    unavailable = [
        id_ for id_ in wanted if id_ not in definitions.current_definitions()
    ]
    if unavailable:
        print(f"No definition to record for: {', '.join(unavailable)}")
        return 2
    print(
        f"Checking {', '.join(wanted)}: {len(check.NAMED_HOUSEHOLDS)} named "
        f"and {households} generated households a year, "
        f"{len(POLICY_YEARS)} years, {processes} processes."
    )
    started = time.perf_counter()
    covered = {id_: [0, 0] for id_ in wanted}
    failures = {}
    with ProcessPoolExecutor(processes) as pool:
        for year, year_covered, counterexamples in pool.map(
            _check_one_year,
            [(year, households, seed) for year in POLICY_YEARS],
        ):
            for id_ in wanted:
                ran, skipped = year_covered.get(id_, (0, 0))
                covered[id_][0] += ran
                covered[id_][1] += skipped
            for effect, answers, change in counterexamples:
                if effect.measure in wanted:
                    failures.setdefault(effect.measure, []).append(
                        (effect.selection, year, answers, change)
                    )
    print(f"Took {time.perf_counter() - started:.0f} s.")
    for id_ in wanted:
        print(
            f"{id_}: the rule says £0 for {covered[id_][1]} household-years "
            f"in all and leaves {covered[id_][0]} to the run"
        )
    # A rule that said £0 for no one was not checked at all.
    never_applied = [id_ for id_ in wanted if not covered[id_][1]]
    if never_applied:
        print(f"Checked nothing, so not recorded: {', '.join(never_applied)}")
    for id_, found in failures.items():
        print(f"\n{id_}: the rule is wrong, so it is off.")
        for selection, year, answers, change in found:
            print(
                f"  {year}, selection {selection}: says £0, the run shows "
                f"{change!r}, for {check.describe(answers)}"
            )
    if failures:
        # A rule on before this check has the digest still, and the digest
        # doesn't cover the engine: a wrong rule must not stay on.
        path = definitions.forget_checked(failures)
        print(f"\nRemoved {', '.join(failures)} from {path}. Commit it.")
    clean = [
        id_
        for id_ in wanted
        if id_ not in failures and id_ not in never_applied
    ]
    if clean:
        path = definitions.record_checked(clean)
        print(f"\nRecorded {', '.join(clean)} in {path}. Commit it.")
    return 1 if failures or never_applied else 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--status", action="store_true")
    mode.add_argument("--recheck", nargs="*", metavar="MEASURE")
    parser.add_argument("--households", type=int, default=200)
    parser.add_argument("--seed", type=int, default=2026)
    parser.add_argument(
        "--processes",
        type=int,
        default=4,
        help="at most 4 on a shared host",
    )
    args = parser.parse_args()
    if args.status:
        return status()
    return recheck(args.recheck, args.households, args.seed, args.processes)


if __name__ == "__main__":
    sys.exit(main())
