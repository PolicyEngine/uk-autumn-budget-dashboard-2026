"""Smoke-test the Modal route without the licensed data.

1. ``generate --artifacts --backend modal`` on the synthetic dataset
   (``synthetic:<households>:<seed>``): the image builds, one container
   per measure runs the receipted path (simulations, tables, limits) up to
   the receipt, which the gate refuses because the synthetic dataset is not
   a bundle dataset. That refusal is the expected outcome.
2. The return path: ``SmokeGenerator.transport_check`` packs an
   artifact-shaped directory in a container, and the runner's
   ``assemble`` writes it under a local root, write-once.

Run from the repository root:

    uv run --with modal==1.6.2 python scripts/budget_day/modal_smoke.py \\
        --root /tmp/modal-smoke road_fuel_vat_cut fuel_duty_rise_deferral

No secret is needed and no dataset is sent: each container builds the
synthetic dataset itself.
"""

import argparse
import subprocess
import sys
import time
from dataclasses import replace
from pathlib import Path

EXPECTED_REFUSAL = "cannot resolve dataset"


def generation(root: Path, measures: list[str], years: list[str]) -> float:
    command = [
        "uk-budget-data",
        "generate",
        "--artifacts",
        "--backend",
        "modal",
        "--dataset",
        "synthetic:300:2026",
        "--artifacts-root",
        str(root / "artifacts"),
        "--skip-input-check",
        "--reforms",
        *measures,
        "--years",
        *years,
    ]
    started = time.perf_counter()
    run = subprocess.run(command, capture_output=True, text=True)
    elapsed = time.perf_counter() - started
    lines = (run.stdout + run.stderr).splitlines()
    for line in lines:
        if "Modal container" in line or "REFUSED" in line[:80]:
            print(line[:160])
    refused = [line for line in lines if line.startswith("REFUSED ")]
    unexpected = [line for line in refused if EXPECTED_REFUSAL not in line]
    if len(refused) != len(measures) or unexpected:
        print("\n".join(lines[-40:]))
        raise SystemExit("generation smoke failed: see the output above")
    print(f"generation: {len(measures)} measures in {elapsed:.0f} s")
    return elapsed


def transport(root: Path, key: str) -> float:
    import modal

    from uk_budget_data import modal_generate
    from uk_budget_data.modal_runner import assemble
    from uk_budget_data.publication.artifacts import ArtifactRef
    from uk_budget_data.publication.generate import ArtifactOutcome

    started = time.perf_counter()
    with modal.enable_output(), modal_generate.smoke_app.run():
        relative, files = (
            modal_generate.SmokeGenerator().transport_check.remote(key)
        )
    container = Path("/container") / relative
    outcome = ArtifactOutcome(
        key=key,
        reference=ArtifactRef(
            key=key,
            path=container,
            outputs_sha256="0" * 64,
            receipt_sha256="0" * 64,
            execution_identity_sha256="0" * 64,
            artifact_sha256="0" * 64,
            created=True,
        ),
        progress=[f"{key}: wrote {container}"],
    )
    for attempt in ("first", "again"):
        written = assemble(outcome, relative, files, root / "transport")
        print(f"transport ({attempt}): {written.progress[0]}")
        outcome.reference = replace(written.reference, path=container)
        outcome.progress = [f"{key}: wrote {container}"]
    elapsed = time.perf_counter() - started
    print(f"transport: {elapsed:.0f} s")
    return elapsed


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--years", nargs="+", default=["2026", "2027"])
    parser.add_argument("measures", nargs="+")
    parsed = parser.parse_args(argv)
    generation(parsed.root, parsed.measures, parsed.years)
    transport(parsed.root, parsed.measures[0])
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
