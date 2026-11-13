"""Policy tables read actual pre-Budget and native dated settings."""

import json

import pytest

from uk_budget_data import policy_table, reforms
from uk_budget_data.budget_policy import policy_record


@pytest.fixture(scope="module")
def document():
    return policy_table.build()


def _row(document, measure_id, path):
    return next(
        row
        for row in document["measures"][measure_id]["rows"]
        if row["source"]["before"]["path"] == path
    )


def _on(row, instant):
    return max(
        (point for point in row["points"] if point["key"] <= instant),
        key=lambda point: point["key"],
    )


def test_property_table_uses_pre_budget_rates_and_native_rates_once(document):
    for suffix, before, after in (
        ("basic", 0.22, 0.24),
        ("higher", 0.42, 0.44),
        ("additional", 0.47, 0.49),
    ):
        path = f"gov.hmrc.income_tax.rates.property.{suffix}"
        point = _on(
            _row(document, reforms.PROPERTY_INCOME_RATES_ID, path),
            "2027-04-06",
        )
        assert (point["before"], point["after"]) == (before, after)


def test_household_energy_payment_table_has_one_hundred_pounds_once(document):
    row = _row(
        document,
        reforms.HOUSEHOLD_ENERGY_PAYMENT_ID,
        "gov.treasury.household_energy_payment.amount",
    )
    assert (
        _on(row, "2026-04-06")["before"],
        _on(row, "2026-04-06")["after"],
    ) == (0, 100)
    assert _on(row, "2027-04-06")["after"] == 0
    assert max(point["after"] for point in row["points"]) == 100
    assert "bands A, B, C, D" in row["note"]


def test_electricity_reference_keeps_the_existing_winter_zero_rate(document):
    prefix = "gov.hmrc.vat.domestic_electricity_rate."
    gb = _row(document, reforms.ELECTRICITY_VAT_ID, prefix + "great_britain")
    ni = _row(
        document, reforms.ELECTRICITY_VAT_ID, prefix + "northern_ireland"
    )
    assert (
        _on(gb, "2026-10-01")["before"],
        _on(gb, "2026-10-01")["after"],
    ) == (0, 0)
    assert (
        _on(ni, "2026-10-01")["before"],
        _on(ni, "2026-10-01")["after"],
    ) == (0.05, 0.05)
    for row in (gb, ni):
        april = _on(row, "2027-04-01")
        assert (april["before"], april["after"]) == (0.05, 0)
        july = _on(row, "2027-07-01")
        assert (july["before"], july["after"]) == (0.05, 0.05)


def test_bus_table_keeps_the_previously_announced_january_cap_on_both_sides(
    document,
):
    row = _row(document, reforms.BUS_FARE_CAP_ID, "gov.dft.bus.fares.cap")
    january = _on(row, "2027-01-01")
    assert january["key"] == "2027-01-01"
    assert (january["before"], january["after"]) == (2, 2)
    assert not any(policy_table._differs(point) for point in row["points"])
    assert row["null_label"] == "no cap"
    assert row["unit_words"] == "£ a single fare"
    assert _on(row, "2026-12-31")["before"] == 3
    assert _on(row, "2028-01-01")["after"] is None


def test_unchanged_yearly_policy_has_a_valid_display():
    row = {
        "primary": True,
        "points": [
            {
                "key": str(year),
                "label": str(year),
                "year": year,
                "before": 2,
                "after": 2,
            }
            for year in (2026, 2027)
        ],
    }
    assert policy_table.display_for([row]) == policy_table.BEFORE_AFTER


def test_fuel_table_preserves_actual_reference_and_physical_units(document):
    petrol = _row(document, reforms.FUEL_DUTY_DEFERRAL_ID, reforms.FUEL_DUTY)
    april = _on(petrol, "2027-04-01")
    assert (april["before"], april["after"]) == (60.03, 52.95)
    assert petrol["unit_words"] == "pence a litre"
    # A 1 April change contributes the last five days of the preceding
    # model tax year, including the terminal scored year.
    terminal = _on(petrol, "2032-04-01")
    assert terminal["key"] == "2032-04-01"
    assert terminal["year"] == 2031
    assert petrol["points"][0]["key"] == "2026-04-06"
    assert all(
        "2026-04-06" <= p["key"] <= "2032-04-05" for p in petrol["points"]
    )
    for fuel in ("lpg", "natural_gas"):
        row = _row(
            document,
            reforms.FUEL_DUTY_DEFERRAL_ID,
            f"gov.hmrc.fuel_duty.{fuel}",
        )
        assert row["unit"] == "pence"
        assert row["unit_words"] == "pence a kilogram"
        assert row["source"]["after"]["parameter_unit"] == "currency-GBP"


def test_native_rows_bind_both_policy_sources_and_do_not_read_retired_modifiers(
    document,
):
    record = policy_record()
    for table in document["measures"].values():
        for row in table["rows"]:
            before, after = row["source"]["before"], row["source"]["after"]
            assert before["kind"] == "pre_budget_parameter"
            assert "budget_policy.json" in before["where"]
            assert before["model_commit"] == record["pre_budget_model_commit"]
            assert after["kind"] in ("engine_parameter", "native_formula")
            assert after["model_commit"] == record["native_model_commit"]
            assert before["references"]


def test_native_table_is_strict_json_without_infinity(document):
    text = json.dumps(document, allow_nan=False)
    assert "Infinity" not in text
    assert json.loads(text) == document


def test_build_routes_native_measures_around_historical_builders(monkeypatch):
    def historical_builder_must_not_run(_):
        raise AssertionError("native policy used a historical formula table")

    for measure_id in reforms.AUTUMN_BUDGET_2026_COMBINED_COMPONENTS:
        monkeypatch.setitem(
            policy_table.BUILDERS, measure_id, historical_builder_must_not_run
        )
    assert policy_table.build()["measures"]
