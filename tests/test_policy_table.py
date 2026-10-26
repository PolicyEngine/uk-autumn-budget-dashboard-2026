"""The Policies tab's "What changes" tables (public/data/policy_parameters.json),
read from the model by ``uk-budget-data policy-table``."""

import math
from pathlib import Path

import pytest
from policyengine_uk.system import system

from uk_budget_data import reforms as registry
from uk_budget_data.cli import main
from uk_budget_data.policy_table import (
    OUTPUT_FILE,
    build,
    in_force_rate_change,
    render,
)

PUBLISHED = Path(__file__).resolve().parents[1] / "public" / "data" / OUTPUT_FILE
PARAMETERS = system.parameters


@pytest.fixture(scope="module")
def document():
    return build()


def rows(document, measure_id):
    return {row["label"]: row for row in document["measures"][measure_id]["rows"]}


def by_key(row):
    return {point["key"]: (point["before"], point["after"]) for point in row["points"]}


def test_the_published_file_is_what_the_model_gives_now(document):
    """A change to a measure, a modifier's constants or the engine fails
    here until the file is regenerated (and reviewed again)."""
    assert PUBLISHED.read_text(encoding="utf-8") == render(document)


def test_the_command_writes_the_file(tmp_path, document):
    assert main(["policy-table", "--output-dir", str(tmp_path)]) == 0
    assert (tmp_path / OUTPUT_FILE).read_text(encoding="utf-8") == render(document)


def test_every_candidate_has_a_table_with_its_published_description(document):
    """The page shows a table only for the description it was built from."""
    measures = document["measures"]
    assert list(measures) == list(registry.AUTUMN_BUDGET_2026_COMBINED_COMPONENTS)
    for measure_id, table in measures.items():
        assert table["description"] == registry.get_reform(measure_id).description
        assert table["rows"] and any(row["primary"] for row in table["rows"])
        for row in table["rows"]:
            assert row["source"]["before"]["kind"] and row["source"]["after"]["kind"]
            assert any(p["before"] != p["after"] for p in row["points"]), row["label"]
            assert "unit_words" in row
            for point in row["points"]:
                assert 2026 <= point["year"] <= 2031


def test_fuel_duty_by_date(document):
    dated = by_key(rows(document, "fuel_duty_rise_deferral")["Fuel duty"])
    assert dated["2027-01-01"] == (55.95, 52.95)
    assert dated["2027-03-01"] == (57.95, 52.95)
    assert dated["2027-09-01"] == (59.75, 55.95)
    assert dated["2027-12-01"] == (59.75, 57.95)
    assert "2032-04-01" not in dated  # after the timeline
    assert dated["2026-04-01"] == (52.95, 52.95)  # the timeline's first day


def test_fuel_duty_averages_are_the_engine_and_the_measure(document):
    yearly = by_key(rows(document, "fuel_duty_rise_deferral")["Fuel duty, averaged over the year"])
    rates = registry.fuel_duty_deferral_rates()
    for year in range(2026, 2032):
        before, after = yearly[str(year)]
        engine = PARAMETERS.gov.hmrc.fuel_duty.petrol_and_diesel(f"{year}-04-06")
        assert before == pytest.approx(engine * 100, abs=1e-4)
        assert after == pytest.approx(rates[str(year)] * 100, abs=1e-4)
    # The dated current law is the engine's, day-weighted
    means = registry.fiscal_year_means(registry.FUEL_DUTY_CURRENT_LAW)
    for year in range(2026, 2032):
        assert yearly[str(year)][0] == pytest.approx(means[str(year)] * 100, abs=1e-3)


def test_the_state_pension_allowance_is_the_full_state_pension_rounded_up(document):
    row = by_key(rows(document, "state_pension_income_tax_protection")["Income tax allowance over State Pension age"])
    assert row["2026"] == (12_570, 12_570)
    for year in range(2027, 2032):
        weekly = PARAMETERS.gov.dwp.state_pension.new_state_pension.amount(f"{year}-04-06")
        assert row[str(year)][1] == math.ceil(weekly * 52 / 10) * 10
    assert row["2027"] == (12_570, 13_040)
    assert row["2031"] == (12_830, 14_400)


def test_warm_home_discount(document):
    row = rows(document, "warm_home_discount_top_up")["Warm Home Discount"]
    assert by_key(row) == {"2026": (150, 250)}
    assert row["source"]["before"]["kind"] == "documented"


def test_vat_rates_while_in_force(document):
    electricity = rows(document, "domestic_electricity_zero_vat")
    (point,) = electricity["VAT on domestic electricity in Great Britain"]["points"]
    assert (point["label"], point["before"], point["after"]) == ("October 2026 to March 2028", 0.05, 0.0)
    fuel = rows(document, "road_fuel_vat_cut")
    (point,) = fuel["VAT on petrol and diesel"]["points"]
    assert (point["label"], point["before"], point["after"]) == ("December 2026 to May 2027", 0.2, 0.15)


def test_in_force_dates_that_do_not_fit_the_constants_fail():
    with pytest.raises(ValueError, match="do not fit"):
        in_force_rate_change(registry.FUEL_VAT_ID, {2026: -0.05, 2027: -0.05})


def test_employer_ni(document):
    table = rows(document, "employer_ni_relief_under_25s")
    rate = by_key(table["Employer National Insurance rate, employees aged 21 to 24"])
    assert rate["2026"] == (0.15, 0.15)
    assert all(rate[str(year)] == (0.15, 0.0) for year in range(2027, 2032))
    limit = by_key(table["Earnings relieved for ages 21 to 24, up to"])
    assert limit["2027"] == (None, 50_270)
    assert limit["2031"] == (None, 51_330)


def test_threshold_freeze(document):
    table = rows(document, "threshold_freeze_2031_32")
    assert by_key(table["Personal allowance"])["2031"] == (12_830, 12_570)
    assert by_key(table["Higher rate threshold"])["2031"] == (51_330, 50_270)
    assert by_key(table["Basic rate band"])["2031"] == (38_500, 37_700)
    for year in range(2026, 2031):
        assert by_key(table["Personal allowance"])[str(year)] == (12_570, 12_570)


def test_badr_and_plan_2(document):
    limit = by_key(rows(document, "badr_lifetime_limit_cut")["Business Asset Disposal Relief lifetime limit"])
    assert limit["2026"] == (1_000_000, 1_000_000)
    assert limit["2027"] == (1_000_000, 500_000)
    plan_2 = by_key(rows(document, "plan_2_threshold_unfreeze")["Plan 2 repayment threshold"])
    assert plan_2["2026"] == (29_385, 29_385)
    assert plan_2["2027"] == (29_385, 30_267)
    assert {year: after for year, (_, after) in plan_2.items() if year != "2026"} == {
        year: value for year, value in registry.plan_2_unfrozen_thresholds().items()
    }
