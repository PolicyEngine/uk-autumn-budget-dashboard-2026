"""``uk-budget-data living-standards``."""

import argparse
import json
from pathlib import Path

from rich.console import Console

from uk_budget_data.living_standards import INPUTS_DIR, OUTPUT_PATH
from uk_budget_data.living_standards.hbai import (
    OUTPUT_NAME as HBAI_OUTPUT,
)
from uk_budget_data.living_standards.hbai import (
    write_hbai,
)
from uk_budget_data.living_standards.obr import (
    RHDI_OUTPUT_NAME,
    write_rhdi,
)

console = Console()

DEFAULT_REVIEWER = "vahid-ahmadi"


def add_living_standards_parsers(subparsers) -> None:
    """Register the living-standards command."""
    ls = subparsers.add_parser(
        "living-standards",
        help=(
            "Write public/data/living_standards_outlook.json: baseline "
            "projections on the bundle's certified dataset, HBAI outturn "
            "and OBR series (needs HUGGING_FACE_TOKEN)"
        ),
    )
    _common(ls)
    ls.add_argument(
        "--hbai-ods",
        type=Path,
        default=None,
        help=(
            "Re-extract hbai_outturn.json from this HBAI summary tables "
            "file first (default: use the committed extract)"
        ),
    )
    ls.add_argument(
        "--rhdi-efo",
        type=Path,
        default=None,
        help=(
            "Re-extract obr_rhdi.json from this EFO economy tables file "
            "first (default: use the committed extract)"
        ),
    )
    ls.add_argument(
        "--projections",
        type=Path,
        default=None,
        help=(
            "Build from projections saved by --save-projections instead "
            "of running the simulation (they must match the installed "
            "engine and dataset)"
        ),
    )
    ls.add_argument(
        "--save-projections",
        type=Path,
        default=None,
        help="Also write the projections (aggregates only) to this file",
    )


def _common(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--output",
        type=Path,
        default=OUTPUT_PATH,
        help=f"Outlook file to write (default: {OUTPUT_PATH})",
    )
    parser.add_argument(
        "--inputs-dir",
        type=Path,
        default=INPUTS_DIR,
        help=f"Living standards inputs (default: {INPUTS_DIR})",
    )
    parser.add_argument(
        "--reviewer",
        default=DEFAULT_REVIEWER,
        help=(
            "Who decides the pending review of the rewritten file "
            f"(default: {DEFAULT_REVIEWER}); --reviewer '' leaves "
            "data_inputs/public_data_review.csv alone"
        ),
    )


def _mark_pending(parsed, text: str, basis: str) -> None:
    from uk_budget_data.living_standards.review import set_pending

    if not parsed.reviewer:
        console.print(
            "[yellow]Review row not updated: the public-file checks fail "
            "until it is.[/yellow]"
        )
        return
    set_pending(
        parsed.output.as_posix(), text.encode(), parsed.reviewer, basis
    )
    console.print(
        f"Review row for {parsed.output} set to pending ({parsed.reviewer})"
    )


def run_living_standards(parsed: argparse.Namespace) -> int:
    from uk_budget_data.living_standards.build import (
        build_outlook,
        outlook_text,
    )

    inputs = parsed.inputs_dir
    if parsed.hbai_ods:
        write_hbai(parsed.hbai_ods, inputs / HBAI_OUTPUT)
        console.print(f"Wrote {inputs / HBAI_OUTPUT}")
    if parsed.rhdi_efo:
        write_rhdi(parsed.rhdi_efo, inputs / RHDI_OUTPUT_NAME)
        console.print(f"Wrote {inputs / RHDI_OUTPUT_NAME}")

    if parsed.projections:
        projections = json.loads(parsed.projections.read_text())
    else:
        from uk_budget_data.living_standards.projections import (
            run_projections,
        )

        projections = run_projections(log=console.print)
    if parsed.save_projections:
        parsed.save_projections.write_text(json.dumps(projections, indent=2))
        console.print(f"Wrote {parsed.save_projections}")

    outlook = build_outlook(
        projections,
        json.loads((inputs / HBAI_OUTPUT).read_text()),
        json.loads((inputs / RHDI_OUTPUT_NAME).read_text()),
    )
    text = outlook_text(outlook)
    parsed.output.parent.mkdir(parents=True, exist_ok=True)
    parsed.output.write_text(text)
    console.print(f"Wrote {parsed.output}")
    meta = outlook["meta"]
    _mark_pending(
        parsed,
        text,
        (
            "Living standards view data: UK-level baseline projections and "
            "OBR forecast series, from uk-budget-data living-standards on "
            f"policyengine {meta['policyengine']} (policyengine-uk "
            f"{meta['policyengine_uk']}) with the bundle's certified "
            f"Microcosm {meta['dataset']['tag']} "
            f"({meta['dataset']['sha256'][:8]}), "
            f"{meta['headline_start_year']} base year and prices, to "
            f"{meta['headline_end_year']}. Demo output, unvalidated. No "
            "area below the UK."
        ),
    )
    return 0
