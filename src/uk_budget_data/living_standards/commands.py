"""``uk-budget-data living-standards`` and ``uk-budget-data obr-forecast``."""

import argparse
import json
from pathlib import Path

from rich.console import Console

from uk_budget_data.living_standards import INPUTS_DIR, OUTPUT_PATH
from uk_budget_data.living_standards.forecast import (
    DEFAULT_POST_LABEL,
    OBR_FORECAST_URL,
    POST_FILE_NAME,
    apply_post,
    read_post_document,
    read_saved_post,
    save_post,
)
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
    """Register the living-standards and obr-forecast commands."""
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

    fc = subparsers.add_parser(
        "obr-forecast",
        help=(
            "Load a new OBR forecast (EFO detailed forecast tables, "
            "economy) into the Living standards forecast series"
        ),
    )
    _common(fc)
    fc.add_argument(
        "--efo",
        type=Path,
        required=True,
        help="The new EFO detailed forecast tables: economy (.xlsx)",
    )
    fc.add_argument(
        "--label",
        default=None,
        help='Name of the new forecast (default: "OBR October 2026 '
        '(Autumn Budget)")',
    )
    fc.add_argument(
        "--url",
        default=None,
        help="The OBR page the file comes from (default: obr.uk/efo/)",
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
    post = read_saved_post(inputs / POST_FILE_NAME)
    apply_post(outlook, post)
    if post:
        console.print(f"Budget forecast kept from {inputs / POST_FILE_NAME}")
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
            f"{meta['headline_end_year']}. Unvalidated. No "
            "area below the UK."
        ),
    )
    return 0


def run_obr_forecast(parsed: argparse.Namespace) -> int:
    """Read the new EFO into the outlook's post series (forecast block)."""
    from uk_budget_data.living_standards.build import outlook_text
    from uk_budget_data.living_standards.obr import ForecastTableError

    if not parsed.efo.is_file():
        console.print(f"[red]No such file: {parsed.efo}[/red]")
        return 1
    outlook = json.loads(parsed.output.read_text())
    label = parsed.label or DEFAULT_POST_LABEL
    try:
        post = read_post_document(
            parsed.efo, outlook, label, parsed.url or OBR_FORECAST_URL
        )
    except ForecastTableError as error:
        console.print(f"[red]Not loaded: {error}[/red]")
        return 1
    before = {k: v for k, v in outlook.items() if k != "forecast"}
    apply_post(outlook, post)
    assert {k: v for k, v in outlook.items() if k != "forecast"} == before

    save_post(post, parsed.inputs_dir / POST_FILE_NAME)
    text = outlook_text(outlook)
    parsed.output.write_text(text)

    source = post["source"]
    console.print(f"Loaded {source['file']} (sha256 {source['file_sha256']})")
    for key, series in post["series"].items():
        values = ", ".join(
            f"{y} {v * 100:.2f}%" for y, v in series["values"].items()
        )
        console.print(f"  {key}: {values}")
        if series["carried"]:
            console.print(
                f"  [yellow]{key}: {', '.join(series['carried'])} kept at "
                "the pre-Budget value[/yellow]"
            )
    console.print(f"Wrote {parsed.inputs_dir / POST_FILE_NAME}")
    console.print(f"Wrote {parsed.output} (forecast block only)")
    _mark_pending(
        parsed,
        text,
        (
            "Living standards view data: UK-level baseline projections and "
            f"OBR forecast series; Budget forecast loaded by uk-budget-data "
            f"obr-forecast from {source['file']} "
            f"({source['file_sha256'][:8]}), {label}. Baseline projections "
            f"unchanged (policyengine {outlook['meta']['policyengine']}, "
            f"policyengine-uk {outlook['meta']['policyengine_uk']}). "
            "Unvalidated. No area below the UK."
        ),
    )
    return 0
