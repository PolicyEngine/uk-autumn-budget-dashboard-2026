"""Generate Plotly JSON charts for blog posts from dashboard data.

This script reads the dashboard CSV outputs and generates Plotly JSON files
that can be directly embedded in policyengine-app-v2 blog posts.

Charts include:
- Distributional impact (relative %) with year slider
- Winners and losers (absolute £) with year slider
- Revenue comparison across years

Usage:
    python scripts/generate_blog_charts.py --all
    python scripts/generate_blog_charts.py fuel_duty_rise_deferral

Examples:
    python scripts/generate_blog_charts.py --all
    python scripts/generate_blog_charts.py fuel_duty_rise_deferral
"""

import argparse
import json
from pathlib import Path

import pandas as pd

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
    df: pd.DataFrame, reform_id: str, years: list
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
                "name": str(year),
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
                "label": str(year),
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
    df: pd.DataFrame, reform_id: str, years: list
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

    # Create traces for each year
    traces = []
    for i, year in enumerate(years):
        year_data = reform_data[reform_data["year"] == year].sort_values(
            "decile"
        )
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
                "name": str(year),
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
                "label": str(year),
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
    df: pd.DataFrame, reform_id: str, obr_df: pd.DataFrame = None
) -> dict:
    """Create a revenue comparison bar chart across years.

    Args:
        df: DataFrame with budgetary_impact.csv data
        reform_id: The reform ID to filter for
        obr_df: Optional DataFrame with OBR estimates

    Returns:
        Plotly JSON chart specification
    """
    reform_data = df[df["reform_id"] == reform_id].copy()

    if reform_data.empty:
        raise ValueError(f"No data found for {reform_id}")

    reform_data = reform_data.sort_values("year")
    years = reform_data["year"].tolist()
    pe_values = reform_data["value"].tolist()

    traces = [
        {
            "x": [str(y) for y in years],
            "y": pe_values,
            "type": "bar",
            "name": "PolicyEngine",
            "marker": {"color": COLORS["primary"]},
            "hovertemplate": "Year %{x}<br>PolicyEngine: £%{y:.2f}bn<extra></extra>",
        }
    ]

    # Add OBR comparison if available
    if obr_df is not None:
        obr_data = obr_df[obr_df["reform_id"] == reform_id]
        if not obr_data.empty:
            obr_data = obr_data.sort_values("year")
            obr_years = obr_data["year"].tolist()

            # OBR static
            if "obr_static_value" in obr_data.columns:
                traces.append(
                    {
                        "x": [str(y) for y in obr_years],
                        "y": obr_data["obr_static_value"].tolist(),
                        "type": "bar",
                        "name": "OBR (static)",
                        "marker": {"color": COLORS["gray_light"]},
                        "hovertemplate": "Year %{x}<br>OBR static: £%{y:.2f}bn<extra></extra>",
                    }
                )

            # OBR behavioural
            if "obr_post_behavioural_value" in obr_data.columns:
                traces.append(
                    {
                        "x": [str(y) for y in obr_years],
                        "y": obr_data["obr_post_behavioural_value"].tolist(),
                        "type": "bar",
                        "name": "OBR (behavioural)",
                        "marker": {"color": COLORS["gray"]},
                        "hovertemplate": "Year %{x}<br>OBR behavioural: £%{y:.2f}bn<extra></extra>",
                    }
                )

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


def generate_charts_for_reform(
    reform_id: str,
    output_dir: Path,
    distributional_df: pd.DataFrame,
    winners_losers_df: pd.DataFrame,
    budgetary_df: pd.DataFrame,
    obr_df: pd.DataFrame = None,
    years: list = None,
) -> None:
    """Generate all charts for a single reform."""
    reform_output_dir = output_dir / reform_id
    reform_output_dir.mkdir(parents=True, exist_ok=True)

    print(f"Generating charts for {reform_id}...")

    # Get available years for this reform
    if years is None:
        years = sorted(
            distributional_df[distributional_df["reform_id"] == reform_id][
                "year"
            ]
            .unique()
            .tolist()
        )

    try:
        dist_chart = create_distributional_chart(
            distributional_df, reform_id, years
        )
        with open(reform_output_dir / "distributional.json", "w") as f:
            json.dump(dist_chart, f, indent=2)
        print("  + Distributional chart (relative %): distributional.json")
    except ValueError as e:
        print(f"  - Distributional chart: {e}")

    try:
        wl_chart = create_winners_losers_chart(
            winners_losers_df, reform_id, years
        )
        with open(reform_output_dir / "winners_losers.json", "w") as f:
            json.dump(wl_chart, f, indent=2)
        print("  + Winners/losers chart (absolute £): winners_losers.json")
    except ValueError as e:
        print(f"  - Winners/losers chart: {e}")

    try:
        revenue_chart = create_revenue_chart(budgetary_df, reform_id, obr_df)
        with open(reform_output_dir / "revenue.json", "w") as f:
            json.dump(revenue_chart, f, indent=2)
        print("  + Revenue chart: revenue.json")
    except ValueError as e:
        print(f"  - Revenue chart: {e}")


def main():
    parser = argparse.ArgumentParser(
        description="Generate Plotly JSON charts for blog posts"
    )
    parser.add_argument(
        "reform_id",
        nargs="?",
        help="Reform ID to generate charts for (omit for all reforms)",
    )
    parser.add_argument(
        "--all",
        action="store_true",
        help="Generate charts for all reforms in the data",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("public/data/blog_charts"),
        help="Output directory for JSON files",
    )

    args = parser.parse_args()

    if not args.reform_id and not args.all:
        parser.error("Either provide a reform_id or use --all")

    # Read data: each published measure's and package's approved artifact,
    # as the manifest names them (the page reads the same files)
    data_dir = Path("public/data")
    manifest = json.loads((data_dir / "manifest.json").read_text())
    artifacts = [
        data_dir / entry["artifact"]
        for group in ("measures", "combined")
        for entry in manifest[group].values()
    ]

    def published(name):
        return pd.concat(
            [pd.read_csv(artifact / name) for artifact in artifacts],
            ignore_index=True,
        )

    distributional_df = published("distributional_impact.csv")
    winners_losers_df = published("winners_losers.csv")
    budgetary_df = published("budgetary_impact.csv")

    obr_path = Path("data_inputs/obr_estimates.csv")
    obr_df = pd.read_csv(obr_path) if obr_path.exists() else None

    # Determine which reforms to process
    if args.all:
        reform_ids = budgetary_df["reform_id"].unique().tolist()
        # Exclude combined policies
        reform_ids = [r for r in reform_ids if "combined" not in r]
    else:
        reform_ids = [args.reform_id]

    # Generate charts
    args.output_dir.mkdir(parents=True, exist_ok=True)

    for reform_id in reform_ids:
        generate_charts_for_reform(
            reform_id=reform_id,
            output_dir=args.output_dir,
            distributional_df=distributional_df,
            winners_losers_df=winners_losers_df,
            budgetary_df=budgetary_df,
            obr_df=obr_df,
        )
        print()

    print(f"\nAll charts saved to {args.output_dir}/")
    print(
        "To embed in a blog post, copy the JSON content into a ```plotly code block."
    )


if __name__ == "__main__":
    main()
