"""Receipted briefing metrics using the 2025 combined-analysis definitions.

The reference is Vahid Ahmadi's ``generate_combined_metrics`` gist, revision
6b9f8b7. Calculations retain full precision in artifacts; the gist rounded
its presentation rows to two decimals, which can make shares miss 100%.
"""

import numpy as np

DECILES = tuple(str(decile) for decile in range(1, 11)) + ("all",)
CATEGORIES = (
    "gain_more_5",
    "gain_less_5",
    "no_change",
    "lose_less_5",
    "lose_more_5",
)
POVERTY_VARIABLES = {
    ("absolute", "bhc"): "in_poverty_bhc",
    ("absolute", "ahc"): "in_poverty_ahc",
    ("relative", "bhc"): "in_relative_poverty_bhc",
    ("relative", "ahc"): "in_relative_poverty_ahc",
}
GROUP_VARIABLES = {
    "child": "is_child",
    "working_age": "is_WA_adult",
    "pensioner": "is_SP_age",
}


def _values(simulation, variable: str, year: int, entity: str):
    return simulation.calculate(variable, period=year, map_to=entity).values


def _weights(values, label: str):
    weights = np.asarray(values, dtype=float)
    if not np.isfinite(weights).all() or (weights < 0).any():
        raise ValueError(f"{label}: weights must be finite and non-negative")
    return weights


def _denominator(weights, mask, label: str) -> float:
    denominator = float(weights[mask].sum())
    if denominator <= 0:
        raise ValueError(f"{label}: no positive weighted population")
    return denominator


def _households(baseline, reformed, year: int):
    # Gist lines 64–86 and 313–330: baseline deciles and person counts,
    # household net income, weighted by household_weight × people.
    baseline_income = np.asarray(
        _values(baseline, "household_net_income", year, "household"),
        dtype=float,
    )
    reform_income = np.asarray(
        _values(reformed, "household_net_income", year, "household"),
        dtype=float,
    )
    deciles = _values(baseline, "household_income_decile", year, "household")
    counts = _weights(
        _values(baseline, "household_count_people", year, "household"),
        "household_count_people",
    )
    weights = _weights(
        _values(baseline, "household_weight", year, "household"),
        "household_weight",
    )
    if not (
        np.isfinite(baseline_income).all() and np.isfinite(reform_income).all()
    ):
        raise ValueError("household_net_income must be finite")
    return (
        baseline_income,
        reform_income,
        deciles,
        _weights(weights * counts, "weighted people"),
    )


def _decile_masks(deciles):
    # Gist lines 90–94 and 333–347: All excludes invalid deciles below 1.
    for decile in DECILES:
        yield decile, (
            deciles >= 1 if decile == "all" else deciles == int(decile)
        )


def calculate_distributional_impact(
    baseline, reformed, year: int, reform_id: str
) -> list[dict]:
    """Person-weighted annual household income change, gist lines 311–357."""
    original, reform, deciles, weights = _households(baseline, reformed, year)
    change = reform - original
    rows = []
    for decile, mask in _decile_masks(deciles):
        total = _denominator(weights, mask, f"decile {decile}, {year}")
        rows.append(
            {
                "reform_id": reform_id,
                "year": year,
                "decile": decile,
                "avg_change_gbp": float(
                    (change[mask] * weights[mask]).sum() / total
                ),
            }
        )
    return rows


def calculate_winners_losers_by_decile(
    baseline, reformed, year: int, reform_id: str
) -> list[dict]:
    """Five person-weighted income-change shares, gist lines 51–142."""
    original, reform, deciles, weights = _households(baseline, reformed, year)
    # Gist lines 80–83: cap baseline at £1 before computing percent change.
    change_pct = (reform - original) / np.maximum(original, 1) * 100
    # These are percent thresholds: no change is ±0.01%, not ±1%.
    # Gist lines 103–127 include exactly ±5% in the smaller-change groups.
    categories = (
        change_pct > 5,
        (change_pct > 0.01) & (change_pct <= 5),
        np.abs(change_pct) <= 0.01,
        (change_pct < -0.01) & (change_pct >= -5),
        change_pct < -5,
    )
    rows = []
    for decile, mask in _decile_masks(deciles):
        total = _denominator(weights, mask, f"decile {decile}, {year}")
        for category, category_mask in zip(CATEGORIES, categories):
            share = float(weights[mask & category_mask].sum() / total * 100)
            rows.append(
                {
                    "reform_id": reform_id,
                    "year": year,
                    "decile": decile,
                    "category": category,
                    "share_pct": min(100.0, max(0.0, share)),
                }
            )
    return rows


def calculate_poverty_rates(
    baseline, reformed, year: int, reform_id: str
) -> list[dict]:
    """Person-weighted poverty rates for the gist's demographic masks."""
    # Gist lines 192–203 use baseline person_weight, is_child, is_WA_adult
    # and is_SP_age for both baseline and reform, including all persons.
    weights = _weights(
        _values(baseline, "person_weight", year, "person"), "person_weight"
    )
    groups = {"overall": np.ones(len(weights), dtype=bool)}
    groups.update(
        {
            group: np.asarray(
                _values(baseline, variable, year, "person"), dtype=bool
            )
            for group, variable in GROUP_VARIABLES.items()
        }
    )
    rows = []
    # The gist (lines 205–219) calculated only in_poverty_bhc/ahc. The
    # relative series is new here. In policyengine-uk 2.125.1, in_poverty_*
    # is absolute poverty: 60% of a reference-year median held constant in
    # real terms (FYE 2025 from FYE 2022 onward). in_relative_poverty_* is
    # 60% of the contemporary median.
    for (measure, housing), variable in POVERTY_VARIABLES.items():
        original = np.asarray(
            _values(baseline, variable, year, "person"), dtype=bool
        )
        reform = np.asarray(
            _values(reformed, variable, year, "person"), dtype=bool
        )
        for group, mask in groups.items():
            total = _denominator(weights, mask, f"{group}, {year}")
            # Gist lines 221–224: sum weights of poor people / group weight.
            baseline_rate = float(weights[original & mask].sum() / total * 100)
            reform_rate = float(weights[reform & mask].sum() / total * 100)
            rows.append(
                {
                    "reform_id": reform_id,
                    "year": year,
                    "measure": measure,
                    "housing": housing,
                    "group": group,
                    "baseline_rate_pct": baseline_rate,
                    "reform_rate_pct": reform_rate,
                    "change_pp": reform_rate - baseline_rate,
                }
            )
    return rows


class BriefingCalculator:
    """Compute the three briefing tables for each simulation and year."""

    def calculate(
        self, baseline, reformed, reform_id: str, year: int
    ) -> dict[str, list[dict]]:
        return {
            "briefing_deciles": calculate_distributional_impact(
                baseline, reformed, year, reform_id
            ),
            "briefing_winners_losers": calculate_winners_losers_by_decile(
                baseline, reformed, year, reform_id
            ),
            "briefing_poverty": calculate_poverty_rates(
                baseline, reformed, year, reform_id
            ),
        }
