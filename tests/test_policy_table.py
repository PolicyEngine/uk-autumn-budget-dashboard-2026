"""The Policies tab's "What changes" tables (public/data/policy_parameters.json),
read from the model by ``uk-budget-data policy-table``."""

import math
from pathlib import Path

import pytest

from tests.test_native_budget_policy_table import _on as on_date
from uk_budget_data import reforms as registry
from uk_budget_data.budget_measures.pre_budget_vat_on_domestic_electricity import (
    pre_budget_vat_on_domestic_electricity,
)
from uk_budget_data.budget_policy import policy_record
from uk_budget_data.cli import main
from uk_budget_data.forecast import forecast_parameters
from uk_budget_data.policy_table import (
    BUILDERS,
    OUTPUT_FILE,
    YEAR_WEIGHTS,
    _check_electricity_where,
    _electricity_baseline_rate,
    build,
    constants,
    in_force_rate_change,
    render,
    zero_vat_on_domestic_electricity,
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
    measures = document["measures"]
    assert list(measures) == list(
        registry.AUTUMN_BUDGET_2026_COMBINED_COMPONENTS
    )
    record = policy_record()
    for measure_id, table in measures.items():
        assert (
            table["description"] == registry.get_reform(measure_id).description
        )
        assert table["rows"] and any(row["primary"] for row in table["rows"])
        changed = any(
            point["before"] != point["after"]
            for row in table["rows"]
            for point in row["points"]
        )
        assert changed is (measure_id != registry.BUS_FARE_CAP_ID)
        for row in table["rows"]:
            before, after = row["source"]["before"], row["source"]["after"]
            assert before["kind"] == "pre_budget_parameter"
            assert before["model_commit"] == record["pre_budget_model_commit"]
            assert after["model_commit"] == record["native_model_commit"]
            assert "unit_words" in row
            assert all(
                2026 <= point["year"] <= 2031 for point in row["points"]
            )


def test_fuel_duty_by_date(document):
    dated = by_key(rows(document, registry.FUEL_DUTY_DEFERRAL_ID)["Fuel duty"])
    assert dated["2027-01-01"] == (55.95, 52.95)
    assert dated["2027-03-01"] == (57.95, 52.95)
    assert dated["2027-04-01"] == (60.03, 52.95)
    assert dated["2027-07-01"] == (60.03, 60.59)
    native = PARAMETERS.baseline.get_child(registry.FUEL_DUTY)
    assert dated["2028-04-01"][1] == pytest.approx(native("2028-04-01") * 100)
    assert dated["2028-04-01"][0] != dated["2028-04-01"][1]
    assert dated["2026-04-06"] == (52.95, 52.95)
    assert "2032-04-01" in dated


def test_fuel_table_keeps_dated_statutory_rates_and_physical_units(document):
    table = rows(document, registry.FUEL_DUTY_DEFERRAL_ID)
    assert set(table) == {
        "Fuel duty",
        "Fuel duty on LPG",
        "Fuel duty on natural gas",
    }
    for label, row in table.items():
        assert "averaged" not in label
        assert all(len(point["key"]) == 10 for point in row["points"])
        assert row["unit_words"] == (
            "pence a litre" if label == "Fuel duty" else "pence a kilogram"
        )


def test_the_pension_tax_allowance_is_the_largest_reduction(document):
    """Budget 2026: up to £94 in 2027-28, rising with the full new State
    Pension, to 2029-30."""
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
            math.floor(round(weekly(f"{year}-04-06") / 0.05, 6) + 0.5)
            * 0.05
            * 52,
            2,
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
    table = rows(document, registry.ELECTRICITY_VAT_ID)
    assert set(table) == {
        "VAT rate on domestic electricity, Great Britain",
        "VAT rate on domestic electricity, Northern Ireland",
    }
    for row in table.values():
        assert (
            on_date(row, "2027-04-01")["before"],
            on_date(row, "2027-04-01")["after"],
        ) == (0.05, 0)
        assert (
            on_date(row, "2027-07-01")["before"],
            on_date(row, "2027-07-01")["after"],
        ) == (0.05, 0.05)
    # The withdrawn road-fuel VAT builder remains an archived helper.
    (point,) = withdrawn_rows(registry.FUEL_VAT_ID)[
        "VAT on petrol and diesel"
    ]["points"]
    assert (point["label"], point["before"], point["after"]) == (
        "December 2026 to May 2027",
        0.2,
        0.15,
    )


def test_in_force_dates_that_do_not_fit_the_constants_fail():
    with pytest.raises(ValueError, match="do not fit"):
        in_force_rate_change(registry.FUEL_VAT_ID, {2026: -0.05, 2027: -0.05})


def test_electricity_table_preserves_pre_budget_winter_relief(document):
    table = rows(document, registry.ELECTRICITY_VAT_ID)
    for label, row in table.items():
        winter = 0.05 if "Northern Ireland" in label else 0
        point = on_date(row, "2026-10-01")
        assert (point["before"], point["after"]) == (winter, winter)
        assert "averaged" not in label
        assert row["source"]["before"]["kind"] == "pre_budget_parameter"


def test_archived_electricity_geography_validation():
    values = constants(zero_vat_on_domestic_electricity)
    _check_electricity_where(values)
    with pytest.raises(ValueError, match="Great Britain"):
        _check_electricity_where({**values, "geography_2027": "GB"})


def test_archived_electricity_builder_requires_its_historical_reference():
    native = registry.get_reform(registry.ELECTRICITY_VAT_ID)
    historical = native.model_copy(
        update={
            "simulation_modifier": zero_vat_on_domestic_electricity,
            "baseline_simulation_modifier": pre_budget_vat_on_domestic_electricity,
            "parameter_changes": None,
        }
    )
    values = constants(zero_vat_on_domestic_electricity)
    assert _electricity_baseline_rate(historical, values) == 0.05
    with pytest.raises(ValueError, match="does not apply its pre-Budget"):
        _electricity_baseline_rate(native, values)
    with pytest.raises(ValueError, match="differ on baseline_rate"):
        _electricity_baseline_rate(
            historical, {**values, "baseline_rate": 0.08}
        )
    with pytest.raises(ValueError, match="its Budget side changes"):
        _electricity_baseline_rate(
            historical, {**values, "rate_change_2028": -0.01}
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
    # Seven on Budget day: the savings and property rates split in two
    # (Table 6.1 rows 61 and 62), and the savings rates held back until the
    # corrected savings data were in (e151a865); eight with the £2 bus fare
    # cap (29 October 2026); nine with the savings rates (11 November 2026)
    assert len(document["measures"]) == 9
    assert registry.BUS_FARE_CAP_ID in document["measures"]
    assert registry.SAVINGS_INCOME_RATES_ID in document["measures"]
    # Beside the property rates, as the registry lists them
    assert list(document["measures"]).index(
        registry.SAVINGS_INCOME_RATES_ID
    ) == (
        list(document["measures"]).index(registry.PROPERTY_INCOME_RATES_ID) + 1
    )
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
    rpi = PARAMETERS.gov.economic_assumptions.indices.obr.rpi
    expected = round(29_385 * rpi("2027-04-06") / rpi("2026-04-06"))
    assert plan_2["2027"] == (29_385, expected)
    assert {
        year: after for year, (_, after) in plan_2.items() if year != "2026"
    } == {
        year: value
        for year, value in registry.plan_2_unfrozen_thresholds().items()
    }


def test_each_measure_gets_the_display_its_native_shape_calls_for(document):
    for measure_id, table in document["measures"].items():
        expected = (
            "path"
            if measure_id == registry.STATE_PENSION_ALLOWANCE_ID
            else (
                "before-after"
                if measure_id == registry.BUS_FARE_CAP_ID
                else "schedule"
            )
        )
        assert table["display"] == expected


def test_archived_bus_allocation_builder_is_separate_from_native_policy():
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
    assert rows["Single bus fare cap"]["source"]["before"]["kind"] == (
        "documented"
    )
    note = rows["Single bus fare cap"]["note"]
    assert "10.0% of spending at £3 fares" in note
    assert "bus_fare_cap_2027(fall)" in note
    assert "London residents get £0" in note


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
    table = rows(document, measure_id)
    expected = {
        label: values
        for label, values in RATES_UP.items()
        if label.startswith(income)
    }
    assert set(table) == set(expected)
    for label, values in expected.items():
        for year in range(2027, 2032):
            point = on_date(table[label], f"{year}-04-06")
            assert (point["before"], point["after"]) == values, (label, year)


def test_withdrawn_unearned_builder_does_not_add_the_native_rise_again():
    table = withdrawn_rows(registry.UNEARNED_INCOME_RATES_ID)
    for label, (_, native) in RATES_UP.items():
        for year in range(2027, 2032):
            assert by_key(table[label])[str(year)] == (native, native)


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


def test_carers_allowance_table_shows_the_provisional_native_start(document):
    (row,) = rows(document, registry.CARERS_ALLOWANCE_TAPER_ID).values()
    assert row["label"] == "Earnings taper in force"
    assert (
        row["source"]["after"]["path"]
        == "gov.dwp.carers_allowance.earnings_taper.applies"
    )
    assert (
        on_date(row, "2030-10-05")["before"],
        on_date(row, "2030-10-05")["after"],
    ) == (0, 0)
    assert (
        on_date(row, "2030-10-06")["before"],
        on_date(row, "2030-10-06")["after"],
    ) == (0, 1)
    assert "until DWP confirms the date" in row["note"]
    assert "figures" not in row
