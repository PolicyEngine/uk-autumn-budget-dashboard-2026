"""Gas standing charges abolished, in the household calculation (#355).

A household-only measure: the household API accepts it beside the
registered measures, takes one answer for it (the home's gas use in kWh a
year; 0 is no mains gas), works out the household's gas bill change
(``gas_standing_charges``) and counts it in net income as an equal and
opposite amount, after the policyengine-uk runs. It adds no run and changes
none, so no tax, benefit or government total moves. It has its own row in
the split by policy, a "Gas bill" group in the programme table, and a part
of net income at every point of the earnings sweep, where it moves net
income by the same amount and leaves the marginal rates as they were.
"""

import json

import pytest
from fastapi.testclient import TestClient

from uk_budget_data import api, household_impact
from uk_budget_data import gas_standing_charges as gas

GAS = gas.GAS_STANDING_CHARGES_ID
PROPERTY = "property_income_rates_up"
YEAR = 2028
EVERY_PART = ("by_policy", "sweep")
# Ofgem's typical 9,500 kWh, a full year: £108.332 × (9,500 / 11,359 − 1)
TYPICAL_BILL_CHANGE = -17.73
# Net income and the change are each rounded to the penny, and the bill
# change is £17.7337 before rounding
ROUNDING = 0.015
# The programme table's groups as net income counts them
GROUP_SIGN = {"income": 1, "benefit": 1, "tax": -1, "bills": -1}

client = TestClient(api.app)
ROUTE = "/api/household-impact"


@pytest.fixture(autouse=True)
def _fresh_runs():
    household_impact.clear_runs()
    api._cached_household_impact.cache_clear()
    yield
    household_impact.clear_runs()
    api._cached_household_impact.cache_clear()


def answers(**values):
    """A landlord on £35,000 with £5,000 of property income, salary
    entered for the year calculated; otherwise the form's typical home."""
    values.setdefault("salary_year", YEAR)
    values.setdefault("property_income", 5_000)
    return household_impact.HouseholdAnswers(**values)


def calculate(household, measures, year=YEAR, include=EVERY_PART, **kwargs):
    return household_impact.calculate_household_impact(
        household, measures, year, include=include, **kwargs
    )


def gas_row(result):
    (row,) = [m for m in result["by_policy"]["measures"] if m["id"] == GAS]
    return row


def programme(result, row_id):
    (row,) = [row for row in result["programmes"] if row["id"] == row_id]
    return row


@pytest.fixture
def stand_in_engine(monkeypatch):
    """policyengine-uk replaced by a stand-in that records every run it is
    asked for and answers each side with its own net income."""
    calls = []

    def run_scenario(
        people,
        benunit,
        household,
        year,
        side,
        axes=None,
        net_income_only=False,
        parts=False,
    ):
        calls.append(
            json.dumps(
                [people, benunit, household, year, side, axes, parts],
                sort_keys=True,
            )
        )
        net = 30_000.0 + len(json.dumps(side, sort_keys=True))
        if axes is not None:
            return {
                "household_net_income": [
                    net + 250.0 * point for point in range(axes[0]["count"])
                ]
            }
        if net_income_only:
            return {"household_net_income": net}
        return {
            "household_net_income": net,
            "rows": {row.id: 0.0 for row in household_impact._all_rows()},
            "dependants": [
                {name: True for name in household_impact.DEPENDANT_VARIABLES}
                for _ in people
            ],
            "brma": "X",
            "local_authority": "Y",
        }

    monkeypatch.setattr(household_impact, "run_scenario", run_scenario)
    return calls


def test_the_calculation_accepts_the_measure_and_the_registry_does_not_hold_it():
    """It is accepted beside the registered measures, but it is not one:
    nothing national (the pipeline, the manifest, the combined run) knows
    it."""
    assert GAS in household_impact.accepted_measure_ids()
    assert GAS not in household_impact.measure_ids()
    assert set(household_impact.measure_ids()) < set(
        household_impact.accepted_measure_ids()
    )
    with pytest.raises(ValueError, match="Not a measure"):
        household_impact.measure_sides([GAS])


def test_one_answer_starting_at_ofgems_typical_use():
    """The household is asked its gas use alone: no mains-gas question (0
    kWh is no mains gas) and no payment method (one standing charge)."""
    household = household_impact.HouseholdAnswers()
    assert household.gas_use_kwh == 9_500
    assert not hasattr(household, "has_mains_gas")
    assert not hasattr(household, "gas_payment_method")


def test_it_adds_no_engine_run_and_changes_none(stand_in_engine):
    """Every run asked for with the measure is one asked for without it,
    in the same order, so the engine's figures are untouched."""
    calculate(answers(), [PROPERTY], skip_unaffected=False)
    without = list(stand_in_engine)
    household_impact.clear_runs()
    stand_in_engine.clear()
    calculate(answers(), [PROPERTY, GAS], skip_unaffected=False)
    assert stand_in_engine == without


def test_net_income_moves_by_the_bill_change_on_the_budget_side(
    stand_in_engine,
):
    without = calculate(answers(), [PROPERTY])
    result = calculate(answers(), [PROPERTY, GAS])
    assert result["included"] == [PROPERTY, GAS]
    assert (
        result["net_income"]["baseline"] == without["net_income"]["baseline"]
    )
    assert result["net_income"]["reform"] == pytest.approx(
        without["net_income"]["reform"] - TYPICAL_BILL_CHANGE, abs=ROUNDING
    )
    assert result["net_income"]["change"] == pytest.approx(
        without["net_income"]["change"] - TYPICAL_BILL_CHANGE, abs=ROUNDING
    )


def test_the_split_by_policy_has_its_own_row_and_note(stand_in_engine):
    without = calculate(answers(), [PROPERTY])
    result = calculate(answers(), [PROPERTY, GAS])
    split, before = result["by_policy"], without["by_policy"]
    assert [m["id"] for m in split["measures"]] == [PROPERTY, GAS]
    assert split["measures"][0] == before["measures"][0]
    row = gas_row(result)
    assert row["name"] == "Gas standing charges abolished"
    assert row["change"] == pytest.approx(-TYPICAL_BILL_CHANGE, abs=0.005)
    assert row["status"] == "affected"
    assert row["note_kind"] == "bill_change"
    assert row["note"] == gas.HOUSEHOLD_NOTE
    # A bill change interacts with no tax or benefit
    assert split["residual"] == before["residual"]
    assert split["combined"] == pytest.approx(
        before["combined"] - TYPICAL_BILL_CHANGE, abs=ROUNDING
    )
    assert split["sum_of_singles"] == pytest.approx(
        before["sum_of_singles"] - TYPICAL_BILL_CHANGE, abs=ROUNDING
    )


def test_the_programme_table_has_a_gas_bill_group(stand_in_engine):
    result = calculate(answers(), [PROPERTY, GAS], include=())
    row = programme(result, "gas_bill_change")
    assert row == {
        "id": "gas_bill_change",
        "label": "Gas bill change",
        "group": "bills",
        "baseline": 0.0,
        "reform": TYPICAL_BILL_CHANGE,
        "change": TYPICAL_BILL_CHANGE,
        "note": row["note"],
    }
    assert "standing charge" in row["note"]
    without = calculate(answers(), [PROPERTY], include=())
    assert "gas_bill_change" not in {r["id"] for r in without["programmes"]}


def test_what_the_change_was_worked_from_is_in_the_answer(stand_in_engine):
    used = calculate(answers(), [PROPERTY, GAS], include=())["gas_bill_used"]
    assert used == {
        "applies": True,
        "reason": None,
        "gas_use_kwh": 9_500,
        "standing_charge": 108.33,
        "unit_rate_rise_pence": 0.9537,
        "mean_gas_use_kwh": 11_359,
        "day_share": 1.0,
        "use_share": 1.0,
        "bill_change": TYPICAL_BILL_CHANGE,
        "abolished_from": "2028-01-01",
        "abolished_from_assumed": True,
        "price_period": "1 October to 31 December 2026",
        "note": used["note"],
    }
    assert (
        calculate(answers(), [PROPERTY], include=())["gas_bill_used"] is None
    )


def test_every_sweep_point_moves_by_the_change_and_no_rate_moves(
    stand_in_engine,
):
    without = calculate(answers(), [PROPERTY], include=("sweep",))["sweep"]
    sweep = calculate(answers(), [PROPERTY, GAS], include=("sweep",))["sweep"]
    for point, before in zip(sweep["points"], without["points"]):
        assert point["baseline"] == before["baseline"]
        assert point["reform"] == pytest.approx(
            before["reform"] - TYPICAL_BILL_CHANGE, abs=ROUNDING
        )
    assert sweep["marginal_rates"] == pytest.approx(without["marginal_rates"])
    own, own_before = sweep["own_point"], without["own_point"]
    assert own["reform"] == pytest.approx(
        own_before["reform"] - TYPICAL_BILL_CHANGE, abs=ROUNDING
    )
    assert own["reform_marginal_rate"] == own_before["reform_marginal_rate"]


@pytest.mark.parametrize(
    "gas_answers, year, bill_change, status",
    [
        ({"gas_use_kwh": 9_500, "salary_year": 2027}, 2027, 7.04, "affected"),
        ({"gas_use_kwh": 3_000}, YEAR, -79.72, "affected"),
        ({"gas_use_kwh": 20_000}, YEAR, 82.41, "affected"),
        ({"gas_use_kwh": 0}, YEAR, 0.0, "not_affected"),
        ({"region": "NORTHERN_IRELAND"}, YEAR, 0.0, "not_affected"),
        ({"salary_year": 2026}, 2026, 0.0, "not_affected"),
    ],
    ids=[
        "2027-28, typical use",
        "light use",
        "heavy use",
        "0 kWh, no mains gas",
        "Northern Ireland",
        "2026-27, before the start",
    ],
)
def test_the_change_by_household(
    stand_in_engine, gas_answers, year, bill_change, status
):
    result = calculate(answers(**gas_answers), [PROPERTY, GAS], year=year)
    row = gas_row(result)
    assert row["change"] == pytest.approx(-bill_change, abs=0.005)
    assert row["status"] == status
    assert programme(result, "gas_bill_change")["reform"] == pytest.approx(
        bill_change, abs=0.005
    )
    if status == "not_affected":
        # Its reason, in place of the note that explains a change
        assert row["note"] == result["gas_bill_used"]["reason"]
        assert row["note_kind"] == "bill_change"


def test_at_average_use_the_zero_is_calculated_and_says_so(stand_in_engine):
    """At the mean use the bill neither rises nor falls. The measure
    applies, and its note says the £0 is the result, not a gap."""
    result = calculate(answers(gas_use_kwh=gas.MEAN_GAS_USE_KWH), [GAS])
    row = gas_row(result)
    assert row["change"] == 0
    assert row["status"] == "not_affected"
    assert result["gas_bill_used"]["applies"] is True
    assert result["gas_bill_used"]["reason"] is None
    assert row["note"] == household_impact.GAS_AT_AVERAGE_NOTE
    assert "£0" in row["note"] and "11,359 kWh" in row["note"]


def test_the_measure_alone_needs_no_registered_measure(stand_in_engine):
    """Only the gas measure: both sides are current law, run once."""
    result = calculate(answers(), [GAS])
    assert len(stand_in_engine) == 3
    assert result["included"] == [GAS]
    assert result["net_income"]["change"] == pytest.approx(
        -TYPICAL_BILL_CHANGE, abs=0.005
    )
    assert [m["id"] for m in result["by_policy"]["measures"]] == [GAS]
    assert result["by_policy"]["residual"] == 0
    with pytest.raises(ValueError, match="at least one measure"):
        calculate(answers(), [])


def test_a_typical_home_in_2028_29_on_the_engine():
    """On policyengine-uk: the table, gas row included, adds up to net
    income on both sides; the parts of net income add up at every sweep
    point, with the gas bill as a part of its own; and the rates and
    their parts are the same with and without the measure."""
    without = calculate(answers(), [PROPERTY])
    result = calculate(answers(), [PROPERTY, GAS])
    assert result["net_income"]["reform"] == pytest.approx(
        without["net_income"]["reform"] - TYPICAL_BILL_CHANGE, abs=ROUNDING
    )
    for side in ("baseline", "reform"):
        table = sum(
            GROUP_SIGN[row["group"]] * row[side]
            for row in result["programmes"]
        )
        assert table == pytest.approx(result["net_income"][side], abs=0.05)
    sweep, before = result["sweep"], without["sweep"]
    parts = sweep["net_income_parts"]
    assert "gas_bill_change" in parts["parts"]
    for side in ("baseline", "reform"):
        for point, split in zip(sweep["points"], parts[side]):
            assert sum(split.values()) == pytest.approx(point[side], abs=0.01)
    assert {split["gas_bill_change"] for split in parts["baseline"]} == {0.0}
    assert {split["gas_bill_change"] for split in parts["reform"]} == {
        -TYPICAL_BILL_CHANGE
    }
    for split, split_before in zip(
        parts["reform"], before["net_income_parts"]["reform"]
    ):
        assert split["other_taxes"] == pytest.approx(
            split_before["other_taxes"], abs=0.01
        )
    assert sweep["marginal_rates"] == before["marginal_rates"]
    assert sweep["marginal_rate_parts"] == before["marginal_rate_parts"]


# --- the route ----------------------------------------------------------------


@pytest.mark.parametrize(
    "household, field",
    [
        ({"gas_use_kwh": -1}, "gas_use_kwh"),
        ({"gas_use_kwh": 200_000}, "gas_use_kwh"),
        ({"gas_use_kwh": "lots"}, "gas_use_kwh"),
    ],
)
def test_the_route_refuses_gas_answers_out_of_range(
    household, field, monkeypatch
):
    def never(*args, **kwargs):
        raise AssertionError("a refused request reached the calculation")

    monkeypatch.setattr(household_impact, "calculate_household_impact", never)
    response = client.post(
        ROUTE,
        json={"year": YEAR, "policies": [GAS], "household": household},
    )
    assert response.status_code == 422, response.text
    # Refused for its value, not as a field the route doesn't know
    assert [
        error["type"]
        for error in response.json()["detail"]
        if error["loc"] == ["body", "household", field]
    ] not in ([], ["extra_forbidden"])


@pytest.mark.parametrize(
    "household",
    [{"has_mains_gas": True}, {"gas_payment_method": "PREPAYMENT"}],
)
def test_the_route_asks_nothing_else_about_gas(household):
    """No mains-gas or payment-method answer: the route refuses them as
    fields it does not know."""
    response = client.post(
        ROUTE,
        json={"year": YEAR, "policies": [GAS], "household": household},
    )
    assert response.status_code == 422, response.text
    assert {error["type"] for error in response.json()["detail"]} == {
        "extra_forbidden"
    }


def test_the_route_takes_the_measure_and_the_gas_answer(monkeypatch):
    calls = []

    def calculate_stand_in(household, policies, year, include, workers):
        calls.append((household, policies))
        return {"year": year}

    monkeypatch.setattr(
        household_impact, "calculate_household_impact", calculate_stand_in
    )
    response = client.post(
        ROUTE,
        json={
            "year": YEAR,
            "policies": [PROPERTY, GAS],
            "household": {"gas_use_kwh": 12_000},
        },
    )
    assert response.status_code == 200, response.text
    ((household, policies),) = calls
    assert policies == [PROPERTY, GAS]
    assert household.gas_use_kwh == 12_000
    refused = client.post(ROUTE, json={"year": YEAR, "policies": ["no_such"]})
    assert refused.status_code == 422
