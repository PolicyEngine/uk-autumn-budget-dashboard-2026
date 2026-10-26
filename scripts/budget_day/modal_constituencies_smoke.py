"""Smoke test for ``constituencies --backend modal``: the plumbing only.

Runs ``modal_constituencies.smoke_app``: ten stand-in units fanned out one
container each, writing synthetic arrays to the smoke Volume, then one
release container reading them all back. No secret, no cut, no survey data.
It checks the fan-out, the Volume's commits being visible to another
container, the write-back of the table's bytes, and the timings.

    uv run --with modal==1.6.2 python scripts/budget_day/modal_constituencies_smoke.py
"""

import time
import uuid

import modal

from uk_budget_data import modal_constituencies as mc

UNITS = [f"measure_{i}" for i in range(1, 10)] + ["package"]
YEARS = [2026, 2027, 2028, 2029, 2030, 2031]
HOUSEHOLDS = 50_000


def main() -> None:
    run_id = f"smoke-{uuid.uuid4().hex[:8]}"
    started = time.perf_counter()
    with modal.enable_output(), mc.smoke_app.run():
        units = list(
            mc.smoke_unit.starmap(
                [(run_id, unit, HOUSEHOLDS, YEARS) for unit in UNITS],
                order_outputs=True,
            )
        )
        fanned = time.perf_counter() - started
        release = mc.smoke_release.remote(run_id, UNITS, YEARS)
    total = time.perf_counter() - started
    walls = [u["container"]["wall_s"] for u in units]
    table = release["files"]["smoke_constituency.csv"].decode()
    assert len(table.splitlines()) == 1 + len(UNITS) * len(YEARS), table
    print(
        f"run {run_id}: {len(units)} units, all {set(u['status'] for u in units)}"
    )
    print(
        f"units: fan-out {fanned:.1f} s end to end; each container {min(walls):.1f}-{max(walls):.1f} s"
    )
    print(
        f"release: {release['container']['wall_s']:.1f} s in its container; table {len(table.splitlines())} lines"
    )
    print(f"total {total:.1f} s")


if __name__ == "__main__":
    main()
