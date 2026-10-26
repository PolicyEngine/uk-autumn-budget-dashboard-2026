#!/usr/bin/env python
"""Precompute the Household impact examples' results.

Reads the requests the page builds for its example households
(scripts/household-preset-requests.mjs), runs each through the household
API's own validation and calculation (no server, no dataset), and writes
public/data/household_presets.json. The page shows these answers at once
when an example is chosen with the default measures; anything else goes to
the live API.

    bun scripts/household-preset-requests.mjs > /tmp/requests.json
    uv run python scripts/precompute_household_presets.py /tmp/requests.json

Re-run whenever the measures, their receipts, the engine bundle or the
examples change; a test fails when the file's engine or requests no longer
match. The file records each measure's definition at its receipt's commit
(``uk_budget_data.definitions``), as the household API reports one beside a
live answer, and the page uses the file only when every one is the one its
receipt approved (#136); this refuses, before any calculation, to write a
file it would not use.
"""

import argparse
import json
import sys
import time
from concurrent.futures import ProcessPoolExecutor
from datetime import date
from pathlib import Path

OUT = Path("public/data/household_presets.json")


def _run(entry: dict) -> dict:
    from uk_budget_data import household_impact
    from uk_budget_data.api import HouseholdImpactRequest

    data = HouseholdImpactRequest.model_validate(entry["request"])
    started = time.perf_counter()
    response = household_impact.calculate_household_impact(
        data.household.answers(),
        data.policies or household_impact.measure_ids(),
        data.year,
        include=tuple(data.include),
    )
    print(
        f"{entry['preset_id']} {entry['year']}: "
        f"{time.perf_counter() - started:.1f}s",
        file=sys.stderr,
        flush=True,
    )
    return {**entry, "response": response}


def _definitions(data_root: Path, policies: list) -> dict:
    """Each measure's definition at its receipt's commit, from this code.

    Bound before any calculation, as the API binds them: the calculations
    run in the pool's own processes, so no warning they raise leaves a
    bound module unbindable (``uk_budget_data.definitions``). Exits when
    one has no receipt to check it against or is not the approved one: the
    page would never use the file.
    """
    from uk_budget_data import definitions, household_impact

    approved = definitions.approved_definitions(data_root, policies)
    recorded = definitions.definitions_for(
        {key: definition["git_sha"] for key, definition in approved.items()},
        household_impact.measure_ids(),
    )
    problems = {
        key: ["no published receipt with a full commit to check it against"]
        for key in policies
        if key not in approved
    }
    for key, definition in approved.items():
        differ = definitions.differences(definition, recorded.get(key))
        if differ:
            problems[key] = differ
    if problems:
        for key, lines in sorted(problems.items()):
            print(f"{key}:", file=sys.stderr)
            for line in lines:
                print(f"  - {line}", file=sys.stderr)
        sys.exit(
            "The page would not use these answers: each measure's definition "
            f"must be its receipt's (publish definitions; {data_root})"
        )
    return recorded


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("requests", type=Path)
    parser.add_argument("--jobs", type=int, default=2)
    parser.add_argument("--out", type=Path, default=OUT)
    parser.add_argument(
        "--data-root",
        type=Path,
        default=Path("public/data"),
        help="the publication whose receipts the definitions are checked by",
    )
    args = parser.parse_args()
    entries = json.loads(args.requests.read_text())
    recorded = _definitions(args.data_root, entries[0]["request"]["policies"])
    with ProcessPoolExecutor(max_workers=args.jobs) as pool:
        done = list(pool.map(_run, entries))
    engine = done[0]["response"]["engine"]
    for entry in done:
        # One engine for the whole file; the page reads it from the top
        entry["response"].pop("engine", None)
    payload = {
        "description": (
            "Household impact examples: the household API's answer for each "
            "example household over the form's defaults, with every measure "
            "selected, for each year a reader can choose. Hypothetical "
            "households; no survey records."
        ),
        "generated_on": date.today().isoformat(),
        "engine": engine,
        "policies": done[0]["request"]["policies"],
        # Each measure's, as the API reports them beside a live answer
        "definitions": recorded,
        "years": sorted({entry["year"] for entry in done}),
        "entries": done,
    }
    args.out.write_text(
        json.dumps(payload, separators=(",", ":"), sort_keys=False) + "\n"
    )
    print(f"Wrote {args.out} ({args.out.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
