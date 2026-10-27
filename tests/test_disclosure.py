"""One disclosure rule for every published figure (publication/disclosure.py).

Synthetic records only: no survey data, and a test key.
"""

import numpy as np
import pandas as pd
import pytest
from policyengine.disclosure import DisclosureKeyError, noise_factors

from uk_budget_data.calculators import (
    AgeImpactCalculator,
    DistributionalImpactCalculator,
    WinnersLosersCalculator,
    poverty_change,
)
from uk_budget_data.publication import disclosure

KEY = b"a-test-key-for-disclosure-unit-tests"
YEAR = 2027
NAMES = {"reform_id": "r", "reform_name": "R", "year": YEAR}
EXACT = disclosure.Policy(noise=False)
NOISED = disclosure.Policy()


def households(survey_households=200, records_each=3, seed=0):
    """Records built from survey households, ``records_each`` per survey
    household (Microcosm's clones), every decile holding the same number of
    survey households."""
    rng = np.random.default_rng(seed)
    survey = np.repeat(np.arange(survey_households), records_each)
    decile = (survey % 10) + 1.0
    baseline = rng.uniform(10_000, 80_000, survey.size)
    return {
        "survey": survey,
        "weight": rng.uniform(100, 400, survey.size),
        "people": rng.integers(1, 5, survey.size).astype(float),
        "decile": decile,
        "baseline_income": baseline,
        "reform_income": baseline + rng.normal(200, 150, survey.size),
        "gov_change": rng.normal(-150, 50, survey.size),
    }


def test_bands_print_counts_only_in_three_bands():
    assert [disclosure.band(n) for n in (0, 9, 10, 29, 30, 500)] == [
        "<10",
        "<10",
        "10–29",
        "10–29",
        "30+",
        "30+",
    ]


def test_the_key_is_named_by_a_fingerprint_never_shown():
    fingerprint = disclosure.key_fingerprint(KEY)
    assert fingerprint == disclosure.key_fingerprint(KEY)
    assert fingerprint != disclosure.key_fingerprint(KEY + b"x")
    assert len(fingerprint) == 16 and KEY.decode() not in fingerprint
    record = NOISED.record(KEY)
    assert record == {
        "noise": True,
        "floor_survey_households": 3,
        "key_fingerprint": fingerprint,
    }


def test_publication_needs_the_key_only_with_noise(monkeypatch):
    monkeypatch.delenv("POLICYENGINE_DISCLOSURE_NOISE_KEY", raising=False)
    assert EXACT.key() is None
    with pytest.raises(DisclosureKeyError):
        NOISED.key()
    monkeypatch.setenv("POLICYENGINE_DISCLOSURE_NOISE_KEY", KEY.decode())
    assert NOISED.key() == KEY


def test_factors_are_fixed_per_survey_household():
    survey = np.array([5, 5, 7, 9, 9, 9])
    factors = disclosure.record_factors(survey, KEY)
    assert factors[0] == factors[1] and factors[3] == factors[5]
    assert np.all(
        (np.abs(factors - 1) >= 0.08) & (np.abs(factors - 1) <= 0.12)
    )
    assert np.all(disclosure.record_factors(survey, None) == 1.0)


def test_a_figure_moved_by_one_or_two_survey_households_is_withheld():
    # Six records, but only two survey households: clones count once.
    survey = np.array([1, 1, 1, 2, 2, 2])
    parts = np.ones(6)
    moving = np.ones(6, dtype=bool)
    thin = disclosure.figure(parts, 1.0, moving, survey, parts, floor=3)
    assert thin.withheld and thin.households == 2
    survey[-1] = 3
    shown = disclosure.figure(parts, 1.0, moving, survey, parts, floor=3)
    assert shown.value == 6.0 and shown.households == 3
    still = disclosure.figure(parts, 1.0, ~moving, survey, parts, floor=3)
    assert still.value == 0.0 and still.households == 0


def test_noise_goes_on_the_numerator_only():
    survey = np.array([1, 2, 3, 3])
    parts = np.array([10.0, 20.0, 30.0, 40.0])
    factors = noise_factors(survey, KEY)
    noised = disclosure.figure(
        parts, 4.0, np.ones(4, dtype=bool), survey, factors, floor=3
    )
    assert noised.value == pytest.approx((factors * parts).sum() / 4.0)
    assert noised.value != pytest.approx(parts.sum() / 4.0)


def test_without_noise_the_decile_tables_are_the_calculators():
    frame = households()
    distributional, winners, withheld = disclosure.decile_tables(
        frame, np.ones(frame["survey"].size), EXACT, **NAMES
    )
    exact = pd.DataFrame(
        {
            "household_income_decile": frame["decile"],
            "baseline_income": frame["baseline_income"],
            "reform_income": frame["reform_income"],
            "income_change": frame["reform_income"] - frame["baseline_income"],
            "household_weight": frame["weight"],
        }
    )
    expected_winners = WinnersLosersCalculator().calculate_from_dataframe(
        "r", "R", YEAR, exact
    )
    expected_relative = (
        DistributionalImpactCalculator().calculate_from_dataframe(
            "r", "R", YEAR, exact
        )
    )
    assert withheld == []
    assert [r["avg_change"] for r in winners] == pytest.approx(
        [r["avg_change"] for r in expected_winners]
    )
    assert [r["value"] for r in distributional] == pytest.approx(
        [r["value"] for r in expected_relative]
    )
    assert [r["decile"] for r in distributional] == [
        r["decile"] for r in expected_relative
    ]


def test_a_thin_decile_is_withheld_alone_and_the_run_goes_on():
    frame = households()
    third = frame["decile"] == 3
    # Only two survey households of the third decile change.
    keep = third & np.isin(frame["survey"], [2, 12])
    frame["reform_income"] = np.where(
        third & ~keep, frame["baseline_income"], frame["reform_income"]
    )
    factors = disclosure.record_factors(frame["survey"], KEY)
    distributional, winners, withheld = disclosure.decile_tables(
        frame, factors, NOISED, **NAMES
    )
    assert withheld == ["decile 3"]
    assert winners[2]["avg_change"] is None
    assert distributional[2]["value"] is None
    assert all(
        r["avg_change"] is not None for r in winners if r is not winners[2]
    )


def test_the_cost_is_the_noised_change_in_the_government_balance():
    frame = households()
    factors = disclosure.record_factors(frame["survey"], KEY)
    row, withheld = disclosure.budgetary_row(frame, factors, NOISED, **NAMES)
    expected = (factors * frame["weight"] * frame["gov_change"]).sum() / 1e9
    assert withheld == [] and row["value"] == pytest.approx(expected)


def people(frame, per_record=2, seed=1):
    """Two people for each household record, aged 0 to 95."""
    rng = np.random.default_rng(seed)
    index = np.repeat(np.arange(frame["survey"].size), per_record)
    before = rng.random(index.size) < 0.2
    return {
        "survey": frame["survey"][index],
        "weight": rng.uniform(100, 400, index.size),
        "age": rng.integers(0, 96, index.size).astype(float),
        "decile": frame["decile"][index],
        "baseline_income": frame["baseline_income"][index],
        "reform_income": frame["reform_income"][index],
        "baseline_equivalised": frame["baseline_income"][index] / 1.5,
        "reform_equivalised": frame["reform_income"][index] / 1.5,
        "own_change": rng.choice([0.0, 50.0], index.size),
        **{
            f"{side}_{measure}": flag
            for measure in ("abs_bhc", "abs_ahc", "rel_bhc", "rel_ahc")
            for side, flag in (
                ("before", before),
                ("after", before & (rng.random(index.size) < 0.5)),
            )
        },
        "in_child_group": rng.random(index.size) < 0.3,
    }


def test_without_noise_the_age_rows_are_the_calculators_rows():
    frame = people(households(survey_households=2_000, records_each=1))
    rows, withheld = disclosure.age_rows(
        frame, np.ones(frame["survey"].size), EXACT, **NAMES
    )
    expected = AgeImpactCalculator().calculate_from_dataframe(
        "r", "R", YEAR, pd.DataFrame(frame)
    )
    ours = {row["age_band"]: row for row in rows}
    columns = (
        "people",
        "mean_change",
        "mean_equivalised_change",
        "pct_better_off",
        "pct_worse_off",
        "pct_unchanged",
        "people_directly_affected",
    )
    for row in expected:
        mine = ours[row["age_band"]]
        assert "sample_size" not in mine
        for column in columns:
            assert mine[column] == pytest.approx(row[column]), (
                row["age_band"],
                column,
            )


def test_a_thin_age_cell_is_withheld_with_what_gives_it_back():
    frame = people(households())
    # Nobody aged 40 is worse off except the people of two survey
    # households, so that share and the unchanged share go.
    age40 = frame["age"] == 40
    frame["reform_income"] = np.where(
        age40, frame["baseline_income"] + 100, frame["reform_income"]
    )
    two = age40 & np.isin(
        frame["survey"], np.unique(frame["survey"][age40])[:2]
    )
    frame["reform_income"] = np.where(
        two, frame["baseline_income"] - 100, frame["reform_income"]
    )
    factors = disclosure.record_factors(frame["survey"], KEY)
    rows, withheld = disclosure.age_rows(frame, factors, NOISED, **NAMES)
    row = next(r for r in rows if r["age_band"] == "40")
    assert row["pct_worse_off"] is None and row["pct_unchanged"] is None
    assert row["pct_better_off"] is not None and row["mean_change"] is not None
    assert "age 40 pct_worse_off" in withheld


def test_poverty_rests_on_the_households_that_cross_a_line():
    frame = households()
    persons = people(frame)
    weights = np.ones(frame["survey"].size)
    row, withheld = disclosure.poverty_row(
        persons,
        frame,
        np.ones(persons["survey"].size),
        weights,
        EXACT,
        **NAMES,
    )
    pp, pct = poverty_change(
        persons["before_abs_bhc"], persons["after_abs_bhc"], persons["weight"]
    )
    assert withheld == []
    assert row["poverty_abs_bhc_change_pp"] == pytest.approx(pp)
    assert row["poverty_abs_bhc_change_pct"] == pytest.approx(pct)
    assert row["poverty_change_pp"] == row["poverty_abs_bhc_change_pp"]
    # Now only two survey households' people cross the line.
    crossers = np.isin(persons["survey"], [4, 7])
    for measure in ("abs_bhc", "abs_ahc", "rel_bhc", "rel_ahc"):
        persons[f"after_{measure}"] = np.where(
            crossers,
            ~persons[f"before_{measure}"],
            persons[f"before_{measure}"],
        )
    row, withheld = disclosure.poverty_row(
        persons,
        frame,
        disclosure.record_factors(persons["survey"], KEY),
        disclosure.record_factors(frame["survey"], KEY),
        NOISED,
        **NAMES,
    )
    assert row["poverty_abs_bhc_change_pp"] is None
    assert row["poverty_abs_bhc_change_pct"] is None
    assert "poverty_abs_bhc" in withheld


class Simulation:
    """A stand-in with the engine's calculate(variable, period, map_to)."""

    def __init__(self, arrays):
        self.arrays = arrays

    def calculate(self, variable, period, map_to):
        class Values:
            values = np.asarray(self.arrays[(variable, map_to)], dtype=float)

        return Values()


def test_the_frames_name_each_persons_survey_household():
    base = {
        ("household_id", "household"): [10, 20, 30],
        ("household_id", "person"): [30, 10, 10, 20],
        ("household_weight", "household"): [1, 2, 3],
        ("household_count_people", "household"): [2, 1, 1],
        ("household_income_decile", "household"): [1, 2, 3],
        ("household_net_income", "household"): [100, 200, 300],
        ("gov_balance", "household"): [5, 5, 5],
        ("student_loan_repayment", "household"): [0, 0, 0],
    }
    reformed = dict(base)
    reformed[("household_net_income", "household")] = [110, 200, 300]
    reformed[("gov_balance", "household")] = [4, 5, 6]
    reformed[("student_loan_repayment", "household")] = [0, 7, 0]
    frame = disclosure.household_frame(
        Simulation(base), Simulation(reformed), YEAR, ["a", "b", "c"]
    )
    assert list(frame["gov_change"]) == [-1, 0, 1]
    loans = disclosure.household_frame(
        Simulation(base),
        Simulation(reformed),
        YEAR,
        ["a", "b", "c"],
        reform_id="plan_2_threshold_unfreeze",
    )
    assert list(loans["gov_change"]) == [0, 7, 0]
    person = {
        (variable, "person"): [1, 2, 3, 4]
        for variable in (
            "person_weight",
            "age",
            "household_income_decile",
            "household_net_income",
            "equiv_household_net_income",
            "income_tax",
            "national_insurance",
            "student_loan_repayment",
            "employment_income",
            "in_poverty_bhc",
            "in_poverty_ahc",
            "in_relative_poverty_bhc",
            "in_relative_poverty_ahc",
            "is_hbai_dependent_child",
        )
    }
    persons = disclosure.person_frame(
        Simulation({**base, **person}),
        Simulation({**reformed, **person}),
        YEAR,
        np.array(["a", "b", "c"]),
    )
    assert list(persons["survey"]) == ["c", "a", "a", "b"]
