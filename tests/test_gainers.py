"""The gainers table: the people who gain and lose on a measure's own
basis, by year, with the records and survey households behind them.

Three measures carry it (``calculators.GAINER_BASES``), so the page's notes
can set our count of gainers beside the official one. The calculator counts
people; the artifact counts the survey households behind them and leaves a
row's figures blank when a group rests on fewer than the floor.
"""

from types import SimpleNamespace

import numpy as np
import pytest
from hypothesis import given, settings
from hypothesis import strategies as st
from microdf import MicroSeries

from uk_budget_data.calculators import (
    DIRECT_EFFECT_MIN_GBP,
    GAINER_BASES,
    GAINER_HOUSEHOLD_KEYS,
    GainersCalculator,
)
from uk_budget_data.publication import disclosure_floor as floor
from uk_budget_data.publication.tables import (
    GAINER_GROUPS,
    GAINERS_MIN_HOUSEHOLDS,
    SCATTER_MIN_HOUSEHOLDS,
    TABLES,
    canonical_csv,
    gainer_rows,
    normalise,
    parse_csv,
)
from uk_budget_data.publication.validate import _gainer_problems

YEAR = 2028
FLOOR = GAINERS_MIN_HOUSEHOLDS
KEYS = {"reform_id": "m", "reform_name": "M", "year": YEAR}
FIGURES = TABLES["gainers"].nullable


class _Simulation:
    """One value per person for each variable, the same in every year."""

    def __init__(self, **person):
        self.weights = person.pop("person_weight", [])
        self.person = person
        self.calls = []

    def calculate(self, variable, period, map_to):
        assert map_to == "person"
        self.calls.append(variable)
        if variable.endswith("_weight"):
            raise AssertionError("calculate must not fetch weight variables")
        return MicroSeries(self.person[variable], weights=self.weights)


def _row(gain, weight=None, household_id=None, variables="income_tax"):
    """The calculator's row for one person per value of ``gain``: each
    weighs 100 and lives alone, in households 1,000 upwards, unless
    given."""
    gain = np.asarray(gain, dtype=float)
    if weight is None:
        weight = np.full(len(gain), 100.0)
    if household_id is None:
        household_id = np.arange(len(gain)) + 1_000
    (row,) = GainersCalculator().calculate_from_arrays(
        "m", "M", YEAR, variables, gain, weight, household_id
    )
    return row


def _gaining(households, records_each=1, losers=0):
    """The calculator's row for ``households`` households of
    ``records_each`` people who each gain £300, and ``losers`` households
    of one person who loses £40."""
    gain = np.concatenate(
        [np.full(households * records_each, 300.0), np.full(losers, -40.0)]
    )
    household_id = np.concatenate(
        [
            np.repeat(np.arange(households), records_each),
            np.arange(losers) + 10_000,
        ]
    )
    return _row(gain, household_id=household_id)


# -- the calculator ----------------------------------------------------------


def test_counts_gainers_and_losers_with_their_means():
    """Two people gain (£400 and £300), one loses £50; changes under £1 a
    year and a person with no weight count on neither side."""
    row = _row(
        gain=[400.0, 300.0, 0.5, -0.99, 0.0, -50.0, 2.0],
        weight=[100.0, 300.0, 10.0, 10.0, 10.0, 20.0, 0.0],
        household_id=[1, 2, 3, 4, 5, 6, 7],
    )
    assert row == {
        **KEYS,
        "variables": "income_tax",
        "gainers": 400.0,
        "gainer_records": 2,
        # (100 x 400 + 300 x 300) / 400
        "mean_gain": 325.0,
        "gainer_household_ids": [1, 2],
        "losers": 20.0,
        "loser_records": 1,
        "mean_loss": 50.0,
        "loser_household_ids": [6],
    }


def test_a_pound_a_year_is_the_line():
    """The test AgeImpactCalculator uses for a person directly affected."""
    row = _row(
        gain=[
            DIRECT_EFFECT_MIN_GBP,
            DIRECT_EFFECT_MIN_GBP - 0.01,
            -DIRECT_EFFECT_MIN_GBP + 0.01,
            -DIRECT_EFFECT_MIN_GBP,
        ]
    )
    assert row["gainer_household_ids"] == [1_000]
    assert row["loser_household_ids"] == [1_003]
    assert (row["gainer_records"], row["loser_records"]) == (1, 1)
    assert (row["mean_gain"], row["mean_loss"]) == (1.0, 1.0)


def test_two_gainers_in_one_household_are_two_records_in_one_household():
    row = _row(gain=[10.0, 10.0], household_id=[5, 5])
    assert row["gainer_records"] == 2
    assert row["gainer_household_ids"] == [5]


def test_a_year_in_which_nobody_gains_or_loses_counts_nobody():
    """As before a measure starts: zero people, no mean."""
    row = _row(gain=[0.0, 0.0, 0.0])
    for count, prefix, mean in GAINER_GROUPS:
        assert row[count] == 0.0
        assert row[f"{prefix}_records"] == 0
        assert row[mean] is None
        assert row[f"{prefix}_household_ids"] == []


def test_the_arrays_are_one_value_each_per_person():
    with pytest.raises(ValueError, match="one each per person"):
        GainersCalculator().calculate_from_arrays(
            "m", "M", YEAR, "income_tax", [1.0, 2.0], [1.0], [1, 2]
        )


def _people():
    """Three people in households 10 to 12, before and after: the first
    pays £400 less income tax, the second £10 less National Insurance, and
    the third gets £500 less Carer's Allowance."""
    shared = dict(person_weight=[2.0, 3.0, 5.0], household_id=[10, 11, 12])
    baseline = _Simulation(
        **shared,
        income_tax=[1_000.0, 500.0, 0.0],
        national_insurance=[100.0, 50.0, 0.0],
        carers_allowance=[0.0, 0.0, 2_000.0],
    )
    reformed = _Simulation(
        **shared,
        income_tax=[600.0, 500.0, 0.0],
        national_insurance=[100.0, 40.0, 0.0],
        carers_allowance=[0.0, 0.0, 1_500.0],
    )
    return baseline, reformed


def test_a_tax_cut_is_a_gain_summed_over_the_basis():
    """Through policyengine-uk's own lists of taxes and spending
    (``exchequer_signs``): less income tax and less National Insurance are
    each a gain, and the row names what it sums."""
    baseline, reformed = _people()
    (row,) = GainersCalculator().calculate(
        baseline,
        reformed,
        "m",
        "M",
        YEAR,
        ("income_tax", "national_insurance"),
    )
    assert row == {
        **KEYS,
        "variables": "income_tax;national_insurance",
        "gainers": 5.0,
        "gainer_records": 2,
        # (2 x 400 + 3 x 10) / 5
        "mean_gain": 166.0,
        "gainer_household_ids": [10, 11],
        "losers": 0.0,
        "loser_records": 0,
        "mean_loss": None,
        "loser_household_ids": [],
    }


def test_a_benefit_cut_is_a_loss_and_a_rise_a_gain():
    baseline, reformed = _people()
    (cut,) = GainersCalculator().calculate(
        baseline, reformed, "m", "M", YEAR, ("carers_allowance",)
    )
    assert (cut["gainers"], cut["losers"], cut["mean_loss"]) == (0.0, 5.0, 500)
    assert cut["loser_household_ids"] == [12]
    # The same two simulations the other way round: the allowance rises
    (rise,) = GainersCalculator().calculate(
        reformed, baseline, "m", "M", YEAR, ("carers_allowance",)
    )
    assert (rise["gainers"], rise["losers"], rise["mean_gain"]) == (
        5.0,
        0,
        500,
    )
    assert rise["gainer_household_ids"] == [12]


def test_no_rows_without_a_basis():
    assert (
        GainersCalculator().calculate(
            _Simulation(), _Simulation(), "m", "M", YEAR, ()
        )
        == []
    )


def test_a_basis_variable_of_a_benefit_unit_is_refused():
    """Read from a benefit unit's variable, every member would count as a
    gainer, so the calculator asks the simulation's system first."""
    baseline, reformed = _people()
    baseline.tax_benefit_system = SimpleNamespace(
        get_variable=lambda name: SimpleNamespace(
            entity=SimpleNamespace(key="benunit")
        )
    )
    with pytest.raises(ValueError, match="belongs to a benunit"):
        GainersCalculator().calculate(
            baseline, reformed, "m", "M", YEAR, ("universal_credit",)
        )


def test_the_gainer_bases():
    """The trading allowance's gainers are the people whose tax bill falls
    (HMRC's count), the Pension Tax Allowance's the people whose income tax
    falls (HMRC's count) and the Carer's Allowance taper's the carers whose
    allowance rises (the Budget's count); no other measure has a basis.
    Each names a registered measure and distinct variables that the
    installed policyengine-uk gives an Exchequer sign and keeps on the
    person."""
    from policyengine_uk.system import system

    from uk_budget_data.calculators import exchequer_signs
    from uk_budget_data.reforms import get_all_reforms

    assert GAINER_BASES == {
        "trading_allowance_raise": ("income_tax", "national_insurance"),
        "state_pension_income_tax_protection": ("income_tax",),
        "carers_allowance_earnings_taper": ("carers_allowance",),
    }
    assert set(GAINER_BASES) <= {reform.id for reform in get_all_reforms()}
    for variables in GAINER_BASES.values():
        assert len(set(variables)) == len(variables)
        assert set(exchequer_signs(variables)) == set(variables)
        for name in variables:
            assert system.get_variable(name).entity.key == "person", name
    assert exchequer_signs(("income_tax", "national_insurance")) == {
        "income_tax": 1,
        "national_insurance": 1,
    }
    assert exchequer_signs(("carers_allowance",)) == {"carers_allowance": -1}


# -- the published rows and their floor ---------------------------------------


def test_the_floor_is_the_binned_scatters():
    """Ten survey households, the floor the scatter keeps for its counts."""
    assert GAINERS_MIN_HOUSEHOLDS == SCATTER_MIN_HOUSEHOLDS == 10


def test_the_table_counts_households_and_leaves_their_lists_out():
    (row,) = gainer_rows([_gaining(FLOOR, records_each=2)])
    assert row == {
        **KEYS,
        "variables": "income_tax",
        "gainers": FLOOR * 2 * 100.0,
        "gainer_records": FLOOR * 2,
        "gainer_survey_households": FLOOR,
        "mean_gain": 300.0,
        "losers": 0.0,
        "loser_records": 0,
        "loser_survey_households": 0,
        "mean_loss": None,
    }
    assert tuple(row) == TABLES["gainers"].column_names
    assert not set(row) & set(GAINER_HOUSEHOLD_KEYS)


@pytest.mark.parametrize(
    "gainers, losers",
    [
        (FLOOR - 1, 0),
        (1, 0),
        (0, 1),
        (FLOOR, 1),
        (FLOOR + 5, FLOOR - 1),
        (FLOOR - 1, FLOOR - 1),
    ],
)
def test_a_group_under_the_floor_blanks_every_figure_in_its_row(
    gainers, losers
):
    """Both groups go, so neither the row nor another table's total gives
    the thin group back by difference."""
    (row,) = gainer_rows([_gaining(gainers, losers=losers)])
    assert row == {
        **KEYS,
        "variables": "income_tax",
        **dict.fromkeys(FIGURES),
    }


@pytest.mark.parametrize(
    "gainers, losers", [(FLOOR, 0), (FLOOR, FLOOR), (0, FLOOR), (0, 0)]
)
def test_groups_at_the_floor_and_empty_groups_are_shown(gainers, losers):
    (row,) = gainer_rows([_gaining(gainers, losers=losers)])
    assert row["gainer_survey_households"] == gainers
    assert row["loser_survey_households"] == losers
    assert row["gainers"] == gainers * 100.0
    assert row["losers"] == losers * 100.0
    assert row["mean_gain"] == (300.0 if gainers else None)
    assert row["mean_loss"] == (40.0 if losers else None)


def test_naming_survey_households_can_take_a_row_under_the_floor():
    """Twelve gaining records from three survey households: shown when
    their own households are counted, blank once each is named by its
    survey household (as ``test_scatter_rows_name_their_survey_household``
    shows for the scatter)."""
    household_ids = np.arange(12) + 500
    survey = np.repeat([7, 8, 9], 4)
    raw = _row(np.full(12, 300.0), household_id=household_ids)
    (by_record,) = gainer_rows([raw])
    assert by_record["gainer_survey_households"] == 12
    (named,) = floor.survey_gainer_rows([raw], household_ids, survey)
    assert named["gainer_household_ids"] == [7, 8, 9]
    assert named["loser_household_ids"] == []
    assert {
        name: value
        for name, value in named.items()
        if name not in GAINER_HOUSEHOLD_KEYS
    } == {
        name: value
        for name, value in raw.items()
        if name not in GAINER_HOUSEHOLD_KEYS
    }
    (published,) = gainer_rows([named])
    assert published["gainers"] is None


def test_households_the_run_does_not_have_are_refused():
    household_ids = np.arange(12) + 500
    survey = np.repeat([7, 8, 9], 4)
    raw = _row(np.full(12, 300.0), household_id=household_ids)
    with pytest.raises(ValueError, match="not among the households"):
        floor.survey_gainer_rows([raw], household_ids[:-1], survey[:-1])
    with pytest.raises(ValueError, match="11 survey households for 12"):
        floor.survey_gainer_rows([raw], household_ids, survey[:-1])
    with pytest.raises(ValueError, match="share an id"):
        floor.survey_gainer_rows([raw], np.full(12, 500), survey)


def test_records_and_households_that_disagree_are_refused():
    raw = _gaining(FLOOR)
    with pytest.raises(ValueError, match="records in"):
        gainer_rows([{**raw, "gainer_household_ids": []}])
    with pytest.raises(ValueError, match="records in"):
        gainer_rows([{**raw, "gainer_records": FLOOR - 1}])


def test_the_rows_write_and_read_back_as_a_canonical_table():
    shown = gainer_rows([_gaining(FLOOR + 2)])[0]
    withheld = {**gainer_rows([_gaining(FLOOR - 1)])[0], "year": YEAR + 1}
    data = canonical_csv("gainers", [withheld, shown])
    assert data == (
        b"reform_id,reform_name,year,variables,gainers,gainer_records,"
        b"gainer_survey_households,mean_gain,losers,loser_records,"
        b"loser_survey_households,mean_loss\n"
        b"m,M,2028,income_tax,1200.0,12,12,300.0,0.0,0,0,\n"
        b"m,M,2029,income_tax,,,,,,,,\n"
    )
    assert parse_csv("gainers", data) == [shown, withheld]
    assert _gainer_problems(parse_csv("gainers", data)) == []


def test_result_tables_carry_the_published_rows_only():
    """An artifact's tables hold the counted rows; a result with no
    gainers, or one from before the table, gives none, so no file is
    written (``artifacts.table_files``)."""
    from uk_budget_data.publication.generate import result_tables

    def result(**more):
        return SimpleNamespace(
            budgetary_impact=[],
            distributional_impact=[],
            winners_losers=[],
            metrics=[],
            income_curve=[],
            household_scatter=[],
            age_impact=[],
            official_basis=[],
            **more,
        )

    raw = _gaining(FLOOR)
    assert result_tables(result(gainers=[raw]))["gainers"] == gainer_rows(
        [raw]
    )
    assert result_tables(result(gainers=[]))["gainers"] == []
    assert result_tables(result())["gainers"] == []


@pytest.mark.parametrize(
    "gaining, warned",
    [
        (12, []),
        (
            9,
            [
                "gainers: no figures for 2027, where the gainers or the "
                "losers rest on fewer than 10 survey households"
            ],
        ),
    ],
)
def test_generation_counts_the_survey_households_behind_the_gainers(
    gaining, warned, monkeypatch
):
    """A run on a dataset names each group's survey households before its
    tables are made: three records gain for each survey household, and the
    table counts the households. Under the floor the run says so and
    writes the row blank."""
    from tests.test_disclosure_floor import _Dataset, _job, _population
    from uk_budget_data import pipeline
    from uk_budget_data.publication import generate

    year = 2027
    baseline, reformed, survey = _population(set(range(40)))
    baseline.dataset = reformed.dataset = _Dataset()
    monkeypatch.setattr(
        pipeline, "scatter_survey_households", lambda sim, path: survey
    )
    (raw,) = GainersCalculator().calculate_from_arrays(
        "a",
        "A",
        year,
        "income_tax",
        np.where(survey < gaining, 300.0, 0.0),
        np.full(len(survey), 50.0),
        baseline.arrays["person"]["household_id"],
    )
    assert raw["gainer_records"] == gaining * 3
    assert len(raw["gainer_household_ids"]) == gaining * 3
    result = SimpleNamespace(household_scatter=[], gainers=[raw])
    warnings, _ = generate._apply_disclosure_floor(
        "a", _job(), baseline, reformed, result
    )
    assert warnings == warned
    assert result.gainers[0]["gainer_household_ids"] == list(range(gaining))
    (row,) = gainer_rows(result.gainers)
    if warned:
        assert row == {
            "reform_id": "a",
            "reform_name": "A",
            "year": year,
            "variables": "income_tax",
            **dict.fromkeys(FIGURES),
        }
    else:
        assert row["gainers"] == gaining * 3 * 50.0
        assert row["gainer_records"] == gaining * 3
        assert row["gainer_survey_households"] == gaining
        assert row["mean_gain"] == 300.0


# -- the validator -------------------------------------------------------------

SHOWN = {
    **KEYS,
    "variables": "income_tax",
    "gainers": 5_000.0,
    "gainer_records": 40,
    "gainer_survey_households": 12,
    "mean_gain": 300.0,
    "losers": 0.0,
    "loser_records": 0,
    "loser_survey_households": 0,
    "mean_loss": None,
}
WITHHELD = {**KEYS, "variables": "income_tax", **dict.fromkeys(FIGURES)}


def test_the_validator_accepts_a_shown_row_and_a_withheld_one():
    assert _gainer_problems([SHOWN, WITHHELD]) == []


@pytest.mark.parametrize(
    "change, problem",
    [
        ({"gainer_records": None}, "is blank in part"),
        ({"gainers": None}, "is blank in part"),
        (
            {**dict.fromkeys(FIGURES), "mean_gain": 3.0},
            "gives a mean in a withheld row",
        ),
        (
            {"gainer_survey_households": FLOOR - 1},
            "shows gainers resting on fewer than 10 survey households",
        ),
        (
            {"gainer_records": 5},
            "more survey households than records behind its gainers",
        ),
        (
            {"gainer_records": 0, "gainer_survey_households": 0},
            "counts gainers without the records and survey households",
        ),
        ({"loser_records": -1}, "has a negative losers"),
        ({"mean_loss": 4.0}, "gives a mean_loss for nobody"),
        ({"mean_gain": None}, "none for its gainers"),
        ({"mean_gain": 0.0}, "has a mean_gain of zero or less"),
    ],
)
def test_the_validator_refuses_a_row_that_breaks_the_tables_rules(
    change, problem
):
    (found,) = _gainer_problems([{**SHOWN, **change}])
    assert found.startswith(f"gainers: {YEAR} ")
    assert problem in found


# -- properties ----------------------------------------------------------------
#
# Gains are quarter pounds and weights whole numbers, so every sum below is
# exact in floating point and the comparisons need no tolerance.


@st.composite
def populations(draw):
    """Up to 60 people in up to 30 households: each person's gain (£ a
    year, in quarters), weight (some zero) and household, and the survey
    household behind each household (up to four households each)."""
    size = draw(st.integers(0, 60))
    exact = st.sampled_from([0.0, 0.75, 1.0, -0.75, -1.0, 250.25, -80.5])
    quarters = st.integers(-2_000, 2_000).map(lambda n: n / 4)
    gain = draw(
        st.lists(st.one_of(exact, quarters), min_size=size, max_size=size)
    )
    weight = draw(st.lists(st.integers(0, 50), min_size=size, max_size=size))
    household = draw(
        st.lists(st.integers(0, 29), min_size=size, max_size=size)
    )
    copies = draw(st.integers(1, 4))
    households = np.arange(30)
    return (
        np.asarray(gain, dtype=float),
        np.asarray(weight, dtype=float),
        np.asarray(household, dtype=int),
        households,
        households // copies,
    )


def _reference(gain, weight, household):
    """The row's figures, person by person in plain Python."""
    groups = {"gainer": [], "loser": []}
    for g, w, h in zip(gain.tolist(), weight.tolist(), household.tolist()):
        if w > 0 and g >= 1:
            groups["gainer"].append((g, w, h))
        elif w > 0 and g <= -1:
            groups["loser"].append((-g, w, h))
    figures = {}
    for group, mean in (("gainer", "mean_gain"), ("loser", "mean_loss")):
        people = sum(w for _, w, _ in groups[group])
        amount = sum(g * w for g, w, _ in groups[group])
        figures[f"{group}s"] = float(people)
        figures[f"{group}_records"] = len(groups[group])
        figures[mean] = amount / people if people else None
        figures[f"{group}_household_ids"] = sorted(
            {h for _, _, h in groups[group]}
        )
    return figures


@settings(deadline=None, max_examples=200)
@given(populations())
def test_the_calculator_agrees_with_a_count_person_by_person(population):
    """Differential: the array calculation against a plain loop."""
    gain, weight, household, _, _ = population
    assert _row(gain, weight, household) == {
        **KEYS,
        "variables": "income_tax",
        **_reference(gain, weight, household),
    }


@settings(deadline=None, max_examples=200)
@given(populations(), st.randoms(use_true_random=False))
def test_the_row_adds_up_and_ignores_the_order_of_people(population, random):
    gain, weight, household, _, _ = population
    row = _row(gain, weight, household)
    # Bounds: nobody counts twice, and nobody without a weight counts
    assert row["gainers"] >= 0 and row["losers"] >= 0
    assert row["gainers"] + row["losers"] <= weight.sum()
    assert row["gainer_records"] + row["loser_records"] <= (weight > 0).sum()
    for count, prefix, mean in GAINER_GROUPS:
        assert len(row[f"{prefix}_household_ids"]) <= row[f"{prefix}_records"]
        assert (row[mean] is None) == (row[count] == 0)
        # Everyone in a group moved by at least £1, so their mean did
        assert row[mean] is None or row[mean] >= DIRECT_EFFECT_MIN_GBP
    # Accounting: each group's people times its mean is the group's total,
    # and the gains less the losses are the whole change of the people who
    # moved by £1 or more
    counted = weight > 0
    gained = float(
        (weight * gain)[counted & (gain >= DIRECT_EFFECT_MIN_GBP)].sum()
    )
    lost = float(
        (weight * -gain)[counted & (gain <= -DIRECT_EFFECT_MIN_GBP)].sum()
    )
    assert row["gainers"] * (row["mean_gain"] or 0) == pytest.approx(
        gained, rel=1e-12
    )
    assert row["losers"] * (row["mean_loss"] or 0) == pytest.approx(
        lost, rel=1e-12
    )
    moved = counted & (np.abs(gain) >= DIRECT_EFFECT_MIN_GBP)
    assert gained - lost == float((weight * gain)[moved].sum())
    # Determinism: the same people in another order give the same row
    order = list(range(len(gain)))
    random.shuffle(order)
    assert _row(gain[order], weight[order], household[order]) == row
    # Doubling every weight doubles the people and nothing else
    doubled = _row(gain, weight * 2, household)
    for count, prefix, mean in GAINER_GROUPS:
        assert doubled[count] == 2 * row[count]
        assert doubled[mean] == row[mean]
        assert doubled[f"{prefix}_records"] == row[f"{prefix}_records"]


@settings(deadline=None, max_examples=200)
@given(populations())
def test_no_published_group_rests_on_fewer_than_the_floor(population):
    """Whatever the people, a published row shows no group of 1 to 9 survey
    households, a blank row has one, and the validator accepts both."""
    gain, weight, household, households, survey = population
    raw = _row(gain, weight, household)
    (named,) = floor.survey_gainer_rows([raw], households, survey)
    (row,) = gainer_rows([named])
    assert tuple(row) == TABLES["gainers"].column_names
    behind = {}
    for group, members in (
        ("gainer", (weight > 0) & (gain >= DIRECT_EFFECT_MIN_GBP)),
        ("loser", (weight > 0) & (gain <= -DIRECT_EFFECT_MIN_GBP)),
    ):
        behind[group] = len(set(survey[household[members]].tolist()))
        # Naming survey households never adds support
        assert behind[group] <= len(raw[f"{group}_household_ids"])
    thin = any(0 < count < FLOOR for count in behind.values())
    if thin:
        assert all(row[name] is None for name in FIGURES)
    else:
        for count, prefix, mean in GAINER_GROUPS:
            assert row[f"{prefix}_survey_households"] == behind[prefix]
            assert row[f"{prefix}_survey_households"] in (0, *range(FLOOR, 31))
            assert row[count] == raw[count]
            assert row[f"{prefix}_records"] == raw[f"{prefix}_records"]
            assert row[mean] == raw[mean]
    assert _gainer_problems([row]) == []
    data = canonical_csv("gainers", [row])
    assert parse_csv("gainers", data) == normalise("gainers", [row])
    assert canonical_csv("gainers", parse_csv("gainers", data)) == data


# Runtime regressions use the actual weighted-series library, not .values
# stand-ins. The existing array fixtures remain synthetic input adapters.
def test_runtime_preserves_weighted_series_without_fetching_weights():
    baseline = _Simulation(
        person_weight=[2.0, 3.0, 5.0, 0.0, 7.0],
        household_id=[10, 10, 12, 13, 14],
        income_tax=[1000.0, 500.0, 0.0, 1000.0, 10.0],
        national_insurance=[100.0, 50.0, 0.0, 0.0, 0.0],
    )
    reformed = _Simulation(
        person_weight=[2.0, 3.0, 5.0, 0.0, 7.0],
        household_id=[10, 10, 12, 13, 14],
        income_tax=[600.0, 500.0, 500.0, 700.0, 9.5],
        national_insurance=[100.0, 40.0, 0.0, 0.0, 0.0],
    )
    (row,) = GainersCalculator().calculate(
        baseline,
        reformed,
        "m",
        "M",
        YEAR,
        ("income_tax", "national_insurance"),
    )
    assert (row["gainers"], row["gainer_records"], row["mean_gain"]) == (
        5.0,
        2,
        166.0,
    )
    assert row["gainer_household_ids"] == [10]
    assert (row["losers"], row["loser_records"], row["mean_loss"]) == (
        5.0,
        1,
        500.0,
    )
    assert row["loser_household_ids"] == [12]
    assert not any(name.endswith("_weight") for name in baseline.calls)
    assert not any(name.endswith("_weight") for name in reformed.calls)


def test_runtime_empty_groups_keep_zero_counts_and_no_means():
    baseline = _Simulation(
        person_weight=[2.0, 0.0],
        household_id=[10, 11],
        income_tax=[500.0, 500.0],
    )
    reformed = _Simulation(
        person_weight=[2.0, 0.0],
        household_id=[10, 11],
        income_tax=[500.0, 100.0],
    )
    (row,) = GainersCalculator().calculate(
        baseline,
        reformed,
        "m",
        "M",
        YEAR,
        ("income_tax",),
    )
    for count, prefix, mean in GAINER_GROUPS:
        assert row[count] == 0.0
        assert row[f"{prefix}_records"] == 0
        assert row[mean] is None
        assert row[f"{prefix}_household_ids"] == []


@pytest.mark.parametrize("mean", ["mean_gain", "mean_loss"])
@pytest.mark.parametrize(
    "amount, allowed",
    [
        (DIRECT_EFFECT_MIN_GBP / 2, False),
        (DIRECT_EFFECT_MIN_GBP - 1e-8, False),
        (DIRECT_EFFECT_MIN_GBP - 5e-13, True),
        (DIRECT_EFFECT_MIN_GBP, True),
    ],
)
def test_group_means_respect_the_shared_minimum_change(mean, amount, allowed):
    row = {**SHOWN, mean: amount}
    if mean == "mean_loss":
        row.update(losers=500.0, loser_records=20, loser_survey_households=10)
    problems = _gainer_problems([row])
    if allowed:
        assert problems == []
    else:
        assert len(problems) == 1
        assert f"{mean} below the" in problems[0]
