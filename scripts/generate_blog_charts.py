"""Generate per-measure Plotly JSON from approved publication artifacts.

Usage:
    uv run python scripts/generate_blog_charts.py \
        --manifest public/data/manifest.json --keys measure-a measure-b \
        --out-dir public/briefing/3/measures/
"""

import argparse
import json
from pathlib import Path

import pandas as pd

from uk_budget_data.publication import briefing_export as export
from uk_budget_data.publication.publish import PublishError
from uk_budget_data.publication.reconcile import fiscal_year_label

# PolicyEngine app-v2 design system
# See: policyengine-app-v2/app/src/designTokens/colors.ts
COLORS = {
    # Primary teal palette
    "primary": "#319795",  # Teal-500 (main)
    "primary_light": "#4FD1C5",  # Teal-300
    "primary_dark": "#285E61",  # Teal-700
    # Gray palette
    "gray_light": "#9CA3AF",  # Gray-400
    "gray": "#6B7280",  # Gray-500
    "gray_dark": "#344054",  # Gray-700
    # Semantic
    "success": "#22C55E",
    "error": "#EF4444",
    # UI
    "neutral": "#F2F4F7",  # Gray-100
    "background": "#FFFFFF",
    "text": "#000000",
}

# Inter is PolicyEngine's official font
FONT_FAMILY = "Inter, sans-serif"


def create_distributional_chart(
    df: pd.DataFrame,
    reform_id: str,
    years: list,
    labels: list[str] | None = None,
) -> dict:
    """Create distributional impact chart (relative %) with year slider.

    Args:
        df: DataFrame with distributional_impact.csv data
        reform_id: The reform ID to filter for
        years: List of years to include

    Returns:
        Plotly JSON chart specification with slider
    """
    reform_data = df[df["reform_id"] == reform_id].copy()

    if reform_data.empty:
        raise ValueError(f"No data found for {reform_id}")

    # Sort by decile order
    decile_order = [
        f"{i}{'st' if i == 1 else 'nd' if i == 2 else 'rd' if i == 3 else 'th'}"
        for i in range(1, 11)
    ]
    reform_data["decile_num"] = reform_data["decile"].apply(
        lambda x: decile_order.index(x) + 1 if x in decile_order else 0
    )

    labels = labels or [fiscal_year_label(year) for year in years]
    # Create traces for each year
    traces = []
    for i, year in enumerate(years):
        year_data = reform_data[reform_data["year"] == year].sort_values(
            "decile_num"
        )
        if year_data.empty:
            continue

        values = year_data["value"].tolist()
        values_pct = [v / 100 for v in values]
        text_labels = [f"{v:+.2%}" for v in values_pct]

        traces.append(
            {
                "x": ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"],
                "y": values_pct,
                "type": "bar",
                "marker": {"color": COLORS["primary"], "line": {"width": 0}},
                "hovertemplate": "Decile %{x}<br>Change: %{y:.2%}<extra></extra>",
                "text": text_labels,
                "textposition": "outside",
                "textfont": {
                    "family": FONT_FAMILY,
                    "size": 14,
                    "color": COLORS["text"],
                },
                "visible": i == 0,
                "name": labels[i],
            }
        )

    # Create slider steps
    steps = []
    for i, year in enumerate(years):
        visibility = [j == i for j in range(len(years))]
        steps.append(
            {
                "method": "update",
                "args": [{"visible": visibility}],
                "label": labels[i],
            }
        )

    return {
        "data": traces,
        "layout": {
            "xaxis": {
                "title": {
                    "text": "Income decile",
                    "font": {"family": FONT_FAMILY, "size": 14},
                },
                "tickfont": {"family": FONT_FAMILY},
                "showgrid": True,
                "gridcolor": "#e0e0e0",
                "gridwidth": 1,
                "tickmode": "linear",
                "tick0": 1,
                "dtick": 1,
            },
            "yaxis": {
                "title": {
                    "text": "Relative change in net income",
                    "font": {"family": FONT_FAMILY, "size": 14},
                },
                "tickfont": {"family": FONT_FAMILY},
                "tickformat": ".2%",
                "showgrid": True,
                "gridcolor": "#e0e0e0",
                "gridwidth": 1,
                "zeroline": True,
                "zerolinecolor": COLORS["gray_dark"],
                "zerolinewidth": 2,
            },
            "height": 550,
            "margin": {"l": 100, "r": 40, "b": 120, "t": 40, "pad": 4},
            "plot_bgcolor": COLORS["background"],
            "paper_bgcolor": COLORS["background"],
            "font": {"family": FONT_FAMILY},
            "sliders": [
                {
                    "active": 0,
                    "currentvalue": {
                        "prefix": "Year: ",
                        "font": {"family": FONT_FAMILY, "size": 16},
                    },
                    "pad": {"t": 50, "b": 10},
                    "steps": steps,
                    "x": 0.1,
                    "len": 0.8,
                    "xanchor": "left",
                    "y": 0,
                    "yanchor": "top",
                }
            ],
        },
    }


def create_winners_losers_chart(
    df: pd.DataFrame,
    reform_id: str,
    years: list,
    labels: list[str] | None = None,
) -> dict:
    """Create winners/losers chart (absolute £) with year slider.

    Args:
        df: DataFrame with winners_losers.csv data
        reform_id: The reform ID to filter for
        years: List of years to include

    Returns:
        Plotly JSON chart specification with slider
    """
    reform_data = df[df["reform_id"] == reform_id].copy()

    if reform_data.empty:
        raise ValueError(f"No data found for {reform_id}")

    # Filter out 'all' decile
    reform_data = reform_data[reform_data["decile"] != "all"]

    labels = labels or [fiscal_year_label(year) for year in years]
    # Create traces for each year
    traces = []
    for i, year in enumerate(years):
        year_data = reform_data[reform_data["year"] == year].copy()
        year_data["decile_num"] = year_data["decile"].astype(int)
        year_data = year_data.sort_values("decile_num")
        if year_data.empty:
            continue

        values = year_data["avg_change"].tolist()
        bar_colors = [
            COLORS["primary"] if v >= 0 else COLORS["error"] for v in values
        ]
        text_labels = [f"£{v:+,.0f}" for v in values]

        traces.append(
            {
                "x": ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"],
                "y": values,
                "type": "bar",
                "marker": {"color": bar_colors, "line": {"width": 0}},
                "hovertemplate": "Decile %{x}<br>Avg change: £%{y:,.0f}<extra></extra>",
                "text": text_labels,
                "textposition": "outside",
                "textfont": {
                    "family": FONT_FAMILY,
                    "size": 12,
                    "color": COLORS["text"],
                },
                "visible": i == 0,
                "name": labels[i],
            }
        )

    # Create slider steps
    steps = []
    for i, year in enumerate(years):
        visibility = [j == i for j in range(len(years))]
        steps.append(
            {
                "method": "update",
                "args": [{"visible": visibility}],
                "label": labels[i],
            }
        )

    return {
        "data": traces,
        "layout": {
            "xaxis": {
                "title": {
                    "text": "Income decile",
                    "font": {"family": FONT_FAMILY, "size": 14},
                },
                "tickfont": {"family": FONT_FAMILY},
                "showgrid": True,
                "gridcolor": "#e0e0e0",
                "gridwidth": 1,
            },
            "yaxis": {
                "title": {
                    "text": "Average change in household income (£/year)",
                    "font": {"family": FONT_FAMILY, "size": 14},
                },
                "tickfont": {"family": FONT_FAMILY},
                "tickprefix": "£",
                "showgrid": True,
                "gridcolor": "#e0e0e0",
                "gridwidth": 1,
                "zeroline": True,
                "zerolinecolor": COLORS["gray_dark"],
                "zerolinewidth": 2,
            },
            "height": 550,
            "margin": {"l": 100, "r": 40, "b": 120, "t": 40, "pad": 4},
            "plot_bgcolor": COLORS["background"],
            "paper_bgcolor": COLORS["background"],
            "font": {"family": FONT_FAMILY},
            "sliders": [
                {
                    "active": 0,
                    "currentvalue": {
                        "prefix": "Year: ",
                        "font": {"family": FONT_FAMILY, "size": 16},
                    },
                    "pad": {"t": 50, "b": 10},
                    "steps": steps,
                    "x": 0.1,
                    "len": 0.8,
                    "xanchor": "left",
                    "y": 0,
                    "yanchor": "top",
                }
            ],
        },
    }


def create_revenue_chart(
    df: pd.DataFrame,
    reform_id: str,
    reconciliation: dict | None = None,
    labels: dict[int, str] | None = None,
) -> dict:
    """Fiscal costing, with only passed or accepted receipted comparators."""
    reform_data = df[df["reform_id"] == reform_id].copy()
    if labels is not None:
        # Only the years the caller may show: never an unsupported one.
        reform_data = reform_data[reform_data["year"].isin(list(labels))]
    if reform_data.empty:
        raise ValueError(f"No data found for {reform_id}")
    reform_data = reform_data.sort_values("year")
    years = reform_data["year"].tolist()
    labels = labels or {year: fiscal_year_label(year) for year in years}
    traces = [
        {
            "x": [labels[year] for year in years],
            "y": reform_data["value"].tolist(),
            "type": "bar",
            "name": "PolicyEngine",
            "marker": {"color": COLORS["primary"]},
            "hovertemplate": "Year %{x}<br>PolicyEngine: £%{y:.2f}bn<extra></extra>",
        }
    ]
    comparators = {}
    for row in (reconciliation or {}).get("rows", []):
        if row["status"] not in ("pass", "accepted"):
            continue
        for kind in ("comparator", "alongside"):
            comparator = row.get(kind)
            if not comparator:
                continue
            sources = ", ".join(
                f"{source['source_id']}/{source['row_id']}"
                for source in comparator["rows"]
            )
            basis = comparator["basis"]
            name = f"Treasury {sources} ({basis})"
            trace = comparators.setdefault(
                name,
                {
                    "x": [],
                    "y": [],
                    "customdata": [],
                    "type": "bar",
                    "name": name,
                    "marker": {
                        "color": (
                            COLORS["gray_light"]
                            if kind == "comparator"
                            else COLORS["gray"]
                        )
                    },
                    "hovertemplate": "Year %{x}<br>%{customdata}<br>£%{y:.2f}bn<extra></extra>",
                },
            )
            trace["x"].append(labels[row["year"]])
            trace["y"].append(comparator["value_bn"])
            trace["customdata"].append(name)
    traces.extend(comparators.values())

    return {
        "data": traces,
        "layout": {
            "xaxis": {
                "title": {
                    "text": "Year",
                    "font": {"family": FONT_FAMILY, "size": 14},
                },
                "tickfont": {"family": FONT_FAMILY},
            },
            "yaxis": {
                "title": {
                    "text": "Budgetary impact (£bn)",
                    "font": {"family": FONT_FAMILY, "size": 14},
                },
                "tickfont": {"family": FONT_FAMILY},
                "ticksuffix": "bn",
                "tickprefix": "£",
                "showgrid": True,
                "gridcolor": "#e0e0e0",
                "zeroline": True,
                "zerolinecolor": "#333",
                "zerolinewidth": 2,
            },
            "height": 450,
            "margin": {"l": 100, "r": 40, "b": 80, "t": 40, "pad": 4},
            "plot_bgcolor": COLORS["background"],
            "paper_bgcolor": COLORS["background"],
            "font": {"family": FONT_FAMILY},
            "barmode": "group",
            "legend": {
                "orientation": "h",
                "yanchor": "bottom",
                "y": 1.02,
                "xanchor": "center",
                "x": 0.5,
            },
        },
    }


def generate(
    manifest: Path,
    keys: list[str],
    out_dir: Path,
    *,
    inputs: Path = Path("data_inputs/treasury"),
) -> dict:
    """Gate the complete requested set before preparing or writing files."""
    loaded = export.load(manifest, keys, inputs=inputs)
    for key, artifact in loaded["entries"].items():
        if artifact["entry"].measures:
            raise PublishError(
                "export", [f"{key} is not a standalone measure"]
            )
        export.require_tables(
            key,
            artifact,
            ("distributional_impact", "winners_losers", "budgetary_impact"),
        )
    outputs = {}
    for key, artifact in loaded["entries"].items():
        tables = artifact["tables"]
        years = export.supported_years(artifact)
        labels = export.year_labels(artifact, years)
        source = export.source_line(artifact, loaded["stamp"])
        reconciliation = export.treasury_comparison(artifact, inputs)
        charts = {
            "distributional": create_distributional_chart(
                pd.DataFrame(tables["distributional_impact"]),
                key,
                years,
                labels,
            ),
            "winners_losers": create_winners_losers_chart(
                pd.DataFrame(tables["winners_losers"]), key, years, labels
            ),
            "revenue": create_revenue_chart(
                pd.DataFrame(tables["budgetary_impact"]),
                key,
                reconciliation,
                dict(zip(years, labels, strict=True)),
            ),
        }
        for name, chart in charts.items():
            stamped = export.stamp_plotly(chart, source, loaded["stamp"])
            outputs[f"{key}/{name}.json"] = (
                json.dumps(stamped, indent=2, allow_nan=False) + "\n"
            )
    return export.write_export(out_dir, outputs, loaded, inputs=inputs)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--keys", nargs="+", required=True)
    parser.add_argument("--out-dir", type=Path, required=True)
    parser.add_argument(
        "--inputs", type=Path, default=Path("data_inputs/treasury")
    )
    args = parser.parse_args(argv)
    try:
        receipt = generate(
            args.manifest, args.keys, args.out_dir, inputs=args.inputs
        )
    except (PublishError, ValueError, OSError) as error:
        print(f"Briefing export refused: {error}")
        return 1
    print(
        f"Exported {len(receipt['files'])} charts from publication manifest "
        f"rev {receipt['manifest_revision']} to {args.out_dir}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
