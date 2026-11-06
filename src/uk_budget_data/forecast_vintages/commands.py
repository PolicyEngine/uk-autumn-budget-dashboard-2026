"""``uk-budget-data forecast-vintages``."""

import argparse
from pathlib import Path

from rich.console import Console

from uk_budget_data.forecast_vintages.build import OUTPUT_PATH

console = Console()

DEFAULT_REVIEWER = "vahid-ahmadi"


def add_forecast_vintages_parser(subparsers) -> None:
    parser = subparsers.add_parser(
        "forecast-vintages",
        help=(
            "Write public/data/obr_forecast_vintages.json: every OBR "
            "forecast since June 2010 beside ONS outturn"
        ),
    )
    parser.add_argument(
        "--fetch",
        action="store_true",
        help=(
            "Download the ONS series and UK House Price Index first (and "
            "any missing OBR file, from its Internet Archive capture)"
        ),
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=OUTPUT_PATH,
        help=f"File to write (default: {OUTPUT_PATH})",
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


def run_forecast_vintages(parsed: argparse.Namespace) -> int:
    from uk_budget_data.forecast_vintages.build import (
        BuildError,
        build,
        output_text,
    )

    if parsed.fetch:
        from uk_budget_data.forecast_vintages.fetch import (
            FetchError,
            fetch_all,
        )

        try:
            fetch_all(log=console.print)
        except FetchError as error:
            console.print(f"[red]Not fetched: {error}[/red]")
            return 1
    try:
        doc = build()
    except BuildError as error:
        console.print(f"[red]Not built: {error}[/red]")
        return 1
    text = output_text(doc)
    parsed.output.parent.mkdir(parents=True, exist_ok=True)
    parsed.output.write_text(text)
    console.print(f"Wrote {parsed.output}")
    for variable in doc["variables"]:
        for name in ("level", "share"):
            measure = variable[name]
            if measure is None:
                continue
            check = measure["check"]
            console.print(
                f"  {variable['id']} {name}: {len(measure['vintages'])} "
                f"forecasts; outturn to {list(measure['outturn'])[-1]}; "
                f"largest gap {check['largest_gap']} "
                f"({check['largest_gap_period']})"
            )
    if not parsed.reviewer:
        console.print(
            "[yellow]Review row not updated: the public-file checks fail "
            "until it is.[/yellow]"
        )
        return 0
    from uk_budget_data.forecast_vintages.sources import EFO_TABLES
    from uk_budget_data.living_standards.review import set_pending

    ons = doc["meta"]["sources"]["ons"]
    set_pending(
        parsed.output.as_posix(),
        text.encode(),
        parsed.reviewer,
        (
            "Forecast vintages view data: OBR forecasts June 2010 to March "
            "2026 from the Historical official forecasts database (Spring "
            "2026, sha256 "
            f"{doc['meta']['sources']['obr'][0]['sha256'][:8]}) and "
            f"Table 1.5 of {len(EFO_TABLES)} forecasts' economy tables "
            "(Internet Archive captures and the Living standards inputs' "
            "March 2026 copy, each pinned by sha256), beside ONS outturn "
            "(latest release "
            f"{max(s['release_date'] for s in ons)}) and the UK House "
            "Price Index. No PolicyEngine figures. Unvalidated."
        ),
    )
    console.print(
        f"Review row for {parsed.output} set to pending ({parsed.reviewer})"
    )
    return 0
