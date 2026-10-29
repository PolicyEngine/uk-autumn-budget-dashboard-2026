"""The Policies tab's "What changes" tables (public/data/policy_parameters.json),
read from the model by ``uk-budget-data policy-table``."""

import math
from pathlib import Path

import pytest

from uk_budget_data import reforms as registry
from uk_budget_data.budget_measures.zero_vat_on_domestic_electricity import (
    SPRING_SHARE,
    WINTER_SHARE,
)
from uk_budget_data.cli import main
from uk_budget_data.forecast import forecast_parameters
from uk_budget_data.policy_table import (
    BUILDERS,
    OUTPUT_FILE,
    YEAR_WEIGHTS,
    build,
    in_force_rate_change,
    render,
)

PUBLISHED = (
    Path(__file__).resolve().parents[1] / "public" / "data" / OUTPUT_FILE
)
# Current law on the OBR October 2026 forecast, as every run builds it.
PARAMETERS = forecast_parameters()


@pytest.fixture(scope="module")
def document():
    return build()


def rows(document, measure_id):
    return {
        row["label"]: row for row in document["measures"][measure_id]["rows"]
    }


def withdrawn_rows(measure_id):
    """A withdrawn measure's rows, from its builder (not in the file)."""
    from uk_budget_data.policy_table import BUILDERS

    factory = {
        registry.FUEL_VAT_ID: registry._create_road_fuel_vat_cut,
        registry.LHA_UNFREEZE_ID: registry._create_lha_unfreeze_2027,
        # Withdrawn on Budget day
        registry.WARM_HOME_DISCOUNT_ID: registry._create_warm_home_discount_top_up,
        registry.THRESHOLD_FREEZE_ID: registry._create_threshold_freeze_2031_32,
        registry.PLAN_2_ID: registry._create_plan_2_threshold_unfreeze,
        registry.EMPLOYER_NI_THRESHOLD_ID: (
            registry._create_employer_nics_secondary_threshold_raise
        ),
        # Split into the property and savings measures on Budget day
        registry.UNEARNED_INCOME_RATES_ID: (
            registry._create_unearned_income_rates_up
        ),
        # Held back from the release (e151a865; María, 28 October)
        registry.SAVINGS_INCOME_RATES_ID: (
            registry._create_savings_income_rates_up
        ),
    }
    reform = factory[measure_id]()
    return {row["label"]: row for row in BUILDERS[measure_id](reform)}


def by_key(row):
    return {
        point["key"]: (point["before"], point["after"])
        for point in row["points"]
    }


def test_the_published_file_is_what_the_model_gives_now(document):
    """A change to a measure, a modifier's constants or the engine fails
    here until the file is regenerated (and reviewed again)."""
    assert PUBLISHED.read_text(encoding="utf-8") == render(document)


def test_the_command_writes_the_file(tmp_path, document):
    assert main(["policy-table", "--output-dir", str(tmp_path)]) == 0
    assert (tmp_path / OUTPUT_FILE).read_text(encoding="utf-8") == render(
        document
    )


def test_every_candidate_has_a_table_with_its_published_description(document):
    """The page shows a table only for the description it was built from."""
    measures = document["measures"]
    assert list(measures) == list(
        registry.AUTUMN_BUDGET_2026_COMBINED_COMPONENTS
    )
    for measure_id, table in measures.items():
        assert (
            table["description"] == registry.get_reform(measure_id).description
        )
        assert table["rows"] and any(row["primary"] for row in table["rows"])
        for row in table["rows"]:
            assert (
                row["source"]["before"]["kind"]
                and row["source"]["after"]["kind"]
            )
            assert any(p["before"] != p["after"] for p in row["points"]), row[
                "label"
            ]
            assert "unit_words" in row
            for point in row["points"]:
                assert 2026 <= point["year"] <= 2031


def test_fuel_duty_by_date(document):
    dated = by_key(rows(document, "fuel_duty_rise_deferral")["Fuel duty"])
    # 52.95p held to 30 June 2027, then current law's 60.59p (the OBR's
    # rate, EFO October 2026 paragraph 3.19) and its RPI
    assert dated["2027-01-01"] == (55.95, 52.95)
    assert dated["2027-03-01"] == (57.95, 52.95)
    assert dated["2027-04-01"] == (60.59, 52.95)
    assert dated["2027-07-01"] == (60.59, 60.59)
    assert dated["2028-04-01"] == (63.21, 63.21)
    assert "2032-04-01" not in dated  # after the timeline
    assert dated["2026-04-01"] == (52.95, 52.95)  # the timeline's first day


def test_fuel_duty_averages_are_the_engine_and_the_measure(document):
    yearly = by_key(
        rows(document, "fuel_duty_rise_deferral")[
            "Fuel duty, averaged over the year"
        ]
    )
    rates = registry.fuel_duty_deferral_rates()
    for year in range(2026, 2032):
        before, after = yearly[str(year)]
        engine = PARAMETERS.gov.hmrc.fuel_duty.petrol_and_diesel(
            f"{year}-04-06"
        )
        assert before == pytest.approx(engine * 100, abs=1e-4)
        assert after == pytest.approx(
            rates.get(str(year), engine) * 100, abs=1e-4
        )
    # The dated current law is the engine's, day-weighted
    means = registry.fiscal_year_means(registry.FUEL_DUTY_CURRENT_LAW)
    for year in range(2026, 2032):
        assert yearly[str(year)][0] == pytest.approx(
            means[str(year)] * 100, abs=1e-3
        )


def test_the_pension_tax_allowance_is_the_largest_reduction(document):
    """Budget 2026: up to £94 in 2027-28, rising with the full new State
    Pension (OBR October 2026 forecast: £182, £250), to 2029-30."""
    row = by_key(
        rows(document, "state_pension_income_tax_protection")[
            "Pension Tax Allowance, the largest tax reduction"
        ]
    )
    assert row["2026"] == (0, 0)
    assert row["2027"] == (0, 94)
    weekly = PARAMETERS.gov.dwp.state_pension.new_state_pension.amount
    for year in (2028, 2029):
        full = round(
            math.floor(weekly(f"{year}-04-06") / 0.05 + 1e-9) * 0.05 * 52, 2
        )
        assert row[str(year)] == (
            0,
            math.ceil(round(0.2 * (full - 12_570), 6)),
        )
    assert row["2030"] == (0, 0)


def test_warm_home_discount(document):
    row = withdrawn_rows(registry.WARM_HOME_DISCOUNT_ID)["Warm Home Discount"]
    assert by_key(row) == {"2026": (150, 250)}
    assert row["source"]["before"]["kind"] == "documented"


def test_vat_rates_while_in_force(document):
    electricity = rows(document, "domestic_electricity_zero_vat")
    (point,) = electricity["VAT on domestic electricity"]["points"]
    assert (point["label"], point["before"], point["after"]) == (
        "October 2026 to June 2027",
        0.05,
        0.0,
    )
    # The road fuel VAT cut is withdrawn, but its builder still reads it
    fuel = withdrawn_rows(registry.FUEL_VAT_ID)
    (point,) = fuel["VAT on petrol and diesel"]["points"]
    assert (point["label"], point["before"], point["after"]) == (
        "December 2026 to May 2027",
        0.2,
        0.15,
    )


def test_in_force_dates_that_do_not_fit_the_constants_fail():
    with pytest.raises(ValueError, match="do not fit"):
        in_force_rate_change(registry.FUEL_VAT_ID, {2026: -0.05, 2027: -0.05})


def test_electricity_2026_carries_the_winter_share(document):
    """Budget 2026 scores the whole zero rate, 1 October 2026 to 30 June
    2027: 2026-27 weighted by the October to March share of a year's use,
    2027-28 by the April to June share."""
    yearly = rows(document, "domestic_electricity_zero_vat")[
        "VAT on domestic electricity, averaged over the year"
    ]
    averages = by_key(yearly)
    assert averages["2026"] == (0.05, round(0.05 - 0.05 * WINTER_SHARE, 6))
    assert averages["2027"] == (0.05, round(0.05 - 0.05 * SPRING_SHARE, 6))
    assert "2026-27 by the October to March share" in yearly["note"]
    (point,) = rows(document, "domestic_electricity_zero_vat")[
        "VAT on domestic electricity"
    ]["points"]
    assert point["label"] == "October 2026 to June 2027"


def test_electricity_says_where_and_what_it_is_scored_against(document):
    """#290 (Max, 19:32): Great Britain from October 2026, Northern Ireland
    from April 2027 only as the Budget expects; and current law's 5% for
    October to March is the scoring baseline, the zero rate already being
    law (SI 2026/987)."""
    note = rows(document, "domestic_electricity_zero_vat")[
        "VAT on domestic electricity"
    ]["card_note"]
    assert note.startswith(
        "0% instead of 5% in Great Britain from 1 October 2026."
    )
    assert (
        "expects the zero rate to apply in Northern Ireland too from April 2027"
        in note
    )
    assert "SI 2026/987" in note
    assert "scores the whole period against 5%" in note
    assert "UK-wide from April" not in note


def test_a_weight_for_a_year_not_in_force_fails(monkeypatch):
    monkeypatch.setitem(YEAR_WEIGHTS, registry.FUEL_VAT_ID, {2028: 0.5})
    with pytest.raises(ValueError, match="not in force"):
        in_force_rate_change(registry.FUEL_VAT_ID, {2028: -0.025})


def test_the_table_covers_the_eight_package_measures_only(document):
    # BADR, employer NI relief and the road fuel VAT cut are withdrawn
    # (27 October 2026)
    assert list(document["measures"]) == list(
        registry.AUTUMN_BUDGET_2026_COMBINED_COMPONENTS
    )
    # Seven on Budget day: the savings and property rates split in two
    # (Table 6.1 rows 61 and 62), and the savings rates held back until the
    # corrected savings data are in (e151a865); eight with the £2 bus fare
    # cap (29 October 2026)
    assert len(document["measures"]) == 8
    assert registry.BUS_FARE_CAP_ID in document["measures"]
    assert registry.SAVINGS_INCOME_RATES_ID not in document["measures"]
    assert registry.UNEARNED_INCOME_RATES_ID not in document["measures"]
    assert registry.CARERS_ALLOWANCE_TAPER_ID in document["measures"]
    assert registry.LHA_UNFREEZE_ID not in document["measures"]
    assert registry.FUEL_VAT_ID not in document["measures"]
    assert registry.BADR_ID not in document["measures"]
    assert registry.EMPLOYER_NI_ID not in document["measures"]


def test_threshold_freeze(document):
    table = withdrawn_rows(registry.THRESHOLD_FREEZE_ID)
    assert by_key(table["Personal allowance"])["2031"] == (12_830, 12_570)
    assert by_key(table["Higher rate threshold"])["2031"] == (51_330, 50_270)
    assert by_key(table["Basic rate band"])["2031"] == (38_500, 37_700)
    for year in range(2026, 2031):
        assert by_key(table["Personal allowance"])[str(year)] == (
            12_570,
            12_570,
        )


# Plan 2 is not in the Budget; its factory stays as a household-calculator
# fixture (pre_budget_registry), so its table rows are still checked.
@pytest.mark.usefixtures("pre_budget_registry")
def test_plan_2(document):
    plan_2 = by_key(
        withdrawn_rows(registry.PLAN_2_ID)["Plan 2 repayment threshold"]
    )
    assert plan_2["2026"] == (29_385, 29_385)
    assert plan_2["2027"] == (29_385, 30_654)
    assert {
        year: after for year, (_, after) in plan_2.items() if year != "2026"
    } == {
        year: value
        for year, value in registry.plan_2_unfrozen_thresholds().items()
    }


def test_each_measure_gets_the_display_its_shape_calls_for(document):
    assert {
        measure_id: table["display"]
        for measure_id, table in document["measures"].items()
    } == {
        "fuel_duty_rise_deferral": "schedule",
        "state_pension_income_tax_protection": "path",
        "domestic_electricity_zero_vat": "switch",
        "property_income_rates_up": "path",
        "carers_allowance_earnings_taper": "path",
        "household_energy_payment_2026": "switch",
        "trading_allowance_raise": "before-after",
        "bus_fare_cap_2027": "switch",
    }


def test_bus_fare_cap():
    rows = {
        row["label"]: row
        for row in BUILDERS[registry.BUS_FARE_CAP_ID](
            registry.get_reform(registry.BUS_FARE_CAP_ID)
        )
    }
    (cap,) = rows["Single bus fare cap"]["points"]
    assert (cap["key"], cap["year"], cap["before"], cap["after"]) == (
        "2027-01-01/2027-12-31",
        2026,
        3,
        2,
    )
    assert rows["Single bus fare cap"]["source"]["before"]["where"] == (
        "budget_measures/bus_fare_cap_2027.py "
        "bus_fare_cap_2027(counterfactual_cap)"
    )


def test_lha_unfreeze():
    # Withdrawn (thin cells), but its builder still reads it
    row = by_key(
        withdrawn_rows(registry.LHA_UNFREEZE_ID)[
            "Local rents the LHA rates are re-set to each April, percentile"
        ]
    )
    # Frozen in current law every year; re-set to the 30th percentile from
    # 2027 with the measure
    assert row["2026"] == (None, None)
    for year in range(2027, 2032):
        assert row[str(year)] == (None, 0.3)


def test_employer_ni_threshold(document):
    row = by_key(
        withdrawn_rows(registry.EMPLOYER_NI_THRESHOLD_ID)[
            "Employer National Insurance threshold"
        ]
    )
    assert row["2026"] == (5_000, 5_000)
    for year in range(2027, 2031):
        assert row[str(year)] == (5_000, 9_100)
    # 2031-32: both raised by current law's CPI rise (2%)
    assert row["2031"] == (5_100, 9_282)


RATES_UP = {
    "Savings basic rate": (0.22, 0.24),
    "Savings higher rate": (0.42, 0.44),
    "Savings additional rate": (0.47, 0.49),
    "Property basic rate": (0.22, 0.24),
    "Property higher rate": (0.42, 0.44),
    "Property additional rate": (0.47, 0.49),
}


@pytest.mark.parametrize(
    "measure_id, income",
    [
        ("property_income_rates_up", "Property"),
        ("savings_income_rates_up", "Savings"),
    ],
)
def test_property_and_savings_income_rates(document, measure_id, income):
    # Each measure shows its own income's three rates, and only those
    table = (
        rows(document, measure_id)
        if measure_id in document["measures"]
        else withdrawn_rows(measure_id)
    )
    expected = {
        label: values
        for label, values in RATES_UP.items()
        if label.startswith(income)
    }
    assert set(table) == set(expected)
    for label, values in expected.items():
        row = by_key(table[label])
        for year in range(2027, 2032):
            assert row[str(year)] == values, (label, year)


def test_unearned_income_rates_withdrawn():
    # Withdrawn (split in two), but its builder still reads it
    table = withdrawn_rows(registry.UNEARNED_INCOME_RATES_ID)
    for label, values in RATES_UP.items():
        row = by_key(table[label])
        for year in range(2027, 2032):
            assert row[str(year)] == values, (label, year)


def test_the_display_follows_the_shape_not_the_measure():
    from uk_budget_data.policy_table import display_for

    def row(points, primary=True):
        return {"primary": primary, "points": points}

    def yearly(pairs):
        return [
            {"key": str(2026 + i), "year": 2026 + i, "before": b, "after": a}
            for i, (b, a) in enumerate(pairs)
        ]

    assert (
        display_for([row(yearly([(1, 1), (1, 2), (1, 2)]))]) == "before-after"
    )
    assert display_for([row(yearly([(1, 1), (1, 2), (1, 3)]))]) == "path"
    assert display_for([row(yearly([(1, 1), (2, 1)]))]) == "path"
    assert display_for([row(yearly([(1, 1), (2, 1)]))] * 3) == "table"


def test_current_law_thresholds_are_the_engine_alone(document):
    """The Frozen thresholds card reads current law from its own block,
    whichever measures the package holds."""
    table = {row["label"]: row for row in document["current_law"]["rows"]}
    assert list(table) == [
        "Personal allowance",
        "Higher rate threshold",
        "Plan 2 repayment threshold",
    ]
    for row in table.values():
        assert all(p["before"] == p["after"] for p in row["points"])
    allowance = by_key(table["Personal allowance"])
    for year in range(2026, 2031):
        assert allowance[str(year)] == (12_570, 12_570)
        assert by_key(table["Higher rate threshold"])[str(year)] == (
            50_270,
            50_270,
        )
    assert by_key(table["Plan 2 repayment threshold"])["2026"] == (
        29_385,
        29_385,
    )


def test_carers_allowance_shows_the_cliff_it_removes(document):
    """#290 (Anthony, 19:20): the measure does not move the earnings limit,
    so the card shows the allowance £1 over it, nothing in current law and
    the weekly rate less £1 with the taper, and the note gives the limit
    (16 hours at the OBR's National Living Wage, rounded up to the pound,
    as efcda9c5) and where the allowance runs out."""
    from uk_budget_data.budget_measures.carers_allowance_earnings_taper import (
        OBR_NATIONAL_LIVING_WAGE_BY_APRIL,
    )
    from uk_budget_data.policy_table import carers_allowance_limit

    table = rows(document, registry.CARERS_ALLOWANCE_TAPER_ID)
    assert list(table) == [
        "Carer's Allowance at £1 a week over the earnings limit"
    ]
    row = table["Carer's Allowance at £1 a week over the earnings limit"]
    assert row["primary"] and row["unit_words"] == "£ a week"
    rate = PARAMETERS.gov.dwp.carers_allowance.rate
    wages = dict(OBR_NATIONAL_LIVING_WAGE_BY_APRIL)
    points = by_key(row)
    for year in range(2026, 2030):
        assert points[str(year)] == (0, 0)
    for year in (2030, 2031):
        weekly = rate(f"{year}-04-06")
        assert points[str(year)] == (0, round(weekly - 1, 2))
        limit = math.ceil(round(16 * wages[year], 6))
        assert carers_allowance_limit(year) == limit
    assert (carers_allowance_limit(2030), carers_allowance_limit(2031)) == (
        228,
        234,
    )
    note = row["card_note"]
    assert "£228 a week in 2030-31 and £234 in 2031-32" in note
    ends = [
        f"£{228 + rate('2030-04-06'):,.0f} a week in 2030-31",
        f"£{234 + rate('2031-04-06'):,.0f} in 2031-32",
    ]
    assert f"runs out at {ends[0]} and {ends[1]}" in note
    assert "Earnings limit" not in row["label"]
