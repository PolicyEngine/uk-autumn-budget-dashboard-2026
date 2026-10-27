"""The Policies tab's "What changes" tables (public/data/policy_parameters.json),
read from the model by ``uk-budget-data policy-table``."""

import math
from pathlib import Path

import pytest
from policyengine_uk.system import system

from uk_budget_data import reforms as registry
from uk_budget_data.budget_measures.zero_vat_on_domestic_electricity import (
    WINTER_SHARE,
)
from uk_budget_data.cli import main
from uk_budget_data.policy_table import (
    OUTPUT_FILE,
    YEAR_WEIGHTS,
    build,
    in_force_rate_change,
    render,
)

PUBLISHED = (
    Path(__file__).resolve().parents[1] / "public" / "data" / OUTPUT_FILE
)
PARAMETERS = system.parameters


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

    factory = {registry.FUEL_VAT_ID: registry._create_road_fuel_vat_cut}
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
    # 52.95p held through 2027-28, then RPI from April 2028 on 52.95p:
    # 61.54p x 52.95 / 59.75 = 54.54p
    assert dated["2027-01-01"] == (55.95, 52.95)
    assert dated["2027-03-01"] == (57.95, 52.95)
    assert dated["2027-04-01"] == (59.75, 52.95)
    assert dated["2028-04-01"] == (61.54, 54.54)
    assert "2027-09-01" not in dated
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
        assert after == pytest.approx(rates[str(year)] * 100, abs=1e-4)
    # The dated current law is the engine's, day-weighted
    means = registry.fiscal_year_means(registry.FUEL_DUTY_CURRENT_LAW)
    for year in range(2026, 2032):
        assert yearly[str(year)][0] == pytest.approx(
            means[str(year)] * 100, abs=1e-3
        )


def test_the_state_pension_allowance_is_the_full_state_pension_rounded_up(
    document,
):
    row = by_key(
        rows(document, "state_pension_income_tax_protection")[
            "Income tax allowance over State Pension age"
        ]
    )
    assert row["2026"] == (12_570, 12_570)
    for year in range(2027, 2032):
        weekly = PARAMETERS.gov.dwp.state_pension.new_state_pension.amount(
            f"{year}-04-06"
        )
        assert row[str(year)][1] == math.ceil(weekly * 52)
    assert row["2027"] == (12_570, 13_037)
    assert row["2031"] == (12_830, 14_391)


def test_warm_home_discount(document):
    row = rows(document, "warm_home_discount_top_up")["Warm Home Discount"]
    assert by_key(row) == {"2026": (150, 250)}
    assert row["source"]["before"]["kind"] == "documented"


def test_vat_rates_while_in_force(document):
    electricity = rows(document, "domestic_electricity_zero_vat")
    (point,) = electricity["VAT on domestic electricity in Great Britain"][
        "points"
    ]
    assert (point["label"], point["before"], point["after"]) == (
        "October 2026 to March 2028",
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
    """Electricity's 2026-27 constant is the zero rate weighted by the
    October to March share of a year's use, not by its 182 days of 365;
    the road fuel cut stays weighted by its days."""
    yearly = rows(document, "domestic_electricity_zero_vat")[
        "VAT on domestic electricity in Great Britain, averaged over the year"
    ]
    averages = by_key(yearly)
    assert averages["2026"] == (0.05, round(0.05 - 0.05 * WINTER_SHARE, 6))
    assert averages["2027"] == (0.05, 0.0)
    assert "2026-27 by the October to March share" in yearly["note"]
    fuel = withdrawn_rows(registry.FUEL_VAT_ID)[
        "VAT on petrol and diesel, averaged over the year"
    ]
    assert "weighted by the days it is in force" in fuel["note"]
    # Weighted by its days, electricity's 2026 constant no longer fits
    with pytest.raises(ValueError, match="do not fit"):
        in_force_rate_change(
            registry.ELECTRICITY_VAT_ID,
            {2026: -0.05 * 182 / 365, 2027: -0.05},
        )


def test_a_weight_for_a_year_not_in_force_fails(monkeypatch):
    monkeypatch.setitem(YEAR_WEIGHTS, registry.FUEL_VAT_ID, {2028: 0.5})
    with pytest.raises(ValueError, match="not in force"):
        in_force_rate_change(registry.FUEL_VAT_ID, {2028: -0.025})


def test_the_table_covers_the_nine_package_measures_only(document):
    # BADR, employer NI relief and the road fuel VAT cut are withdrawn
    # (27 October 2026)
    assert list(document["measures"]) == list(
        registry.AUTUMN_BUDGET_2026_COMBINED_COMPONENTS
    )
    assert len(document["measures"]) == 9
    assert registry.CARERS_ALLOWANCE_TAPER_ID not in document["measures"]
    assert registry.FUEL_VAT_ID not in document["measures"]
    assert registry.BADR_ID not in document["measures"]
    assert registry.EMPLOYER_NI_ID not in document["measures"]


def test_threshold_freeze(document):
    table = rows(document, "threshold_freeze_2031_32")
    assert by_key(table["Personal allowance"])["2031"] == (12_830, 12_570)
    assert by_key(table["Higher rate threshold"])["2031"] == (51_330, 50_270)
    assert by_key(table["Basic rate band"])["2031"] == (38_500, 37_700)
    for year in range(2026, 2031):
        assert by_key(table["Personal allowance"])[str(year)] == (
            12_570,
            12_570,
        )


def test_plan_2(document):
    plan_2 = by_key(
        rows(document, "plan_2_threshold_unfreeze")[
            "Plan 2 repayment threshold"
        ]
    )
    assert plan_2["2026"] == (29_385, 29_385)
    assert plan_2["2027"] == (29_385, 30_267)
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
        "warm_home_discount_top_up": "switch",
        "domestic_electricity_zero_vat": "switch",
        "threshold_freeze_2031_32": "table",
        "plan_2_threshold_unfreeze": "path",
        "lha_unfreeze_2027": "before-after",
        "employer_nics_secondary_threshold_raise": "path",
        "unearned_income_rates_up": "before-after",
    }


def test_lha_unfreeze(document):
    row = by_key(
        rows(document, "lha_unfreeze_2027")[
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
        rows(document, "employer_nics_secondary_threshold_raise")[
            "Employer National Insurance threshold"
        ]
    )
    assert row["2026"] == (5_000, 5_000)
    for year in range(2027, 2031):
        assert row[str(year)] == (5_000, 9_100)
    # 2031-32: both raised by current law's CPI rise (2%)
    assert row["2031"] == (5_100, 9_282)


def test_unearned_income_rates(document):
    table = rows(document, "unearned_income_rates_up")
    expected = {
        "Dividend ordinary rate": (0.1075, 0.1275),
        "Dividend upper rate": (0.3575, 0.3775),
        "Dividend additional rate": (0.3935, 0.4135),
        "Savings basic rate": (0.22, 0.24),
        "Savings higher rate": (0.42, 0.44),
        "Savings additional rate": (0.47, 0.49),
        "Property basic rate": (0.22, 0.24),
        "Property higher rate": (0.42, 0.44),
        "Property additional rate": (0.47, 0.49),
    }
    for label, values in expected.items():
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
