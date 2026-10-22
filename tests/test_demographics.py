"""Results by demographic group, through the disclosure layer.

Synthetic people only: invented ages, statuses and incomes, never survey
records. The groups are policyengine.py's AGE_GROUPS, age bands within them,
18 to 24-year-olds in or not in work or education, and, when a reviewer
accepts the layer's unchecked overlap, employment status; every figure goes
through policyengine.disclosure, counted by survey household.
"""

import json
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pandas as pd
import pytest
from policyengine.disclosure import DisclosureSettings, validate_public
from policyengine.outputs import AGE_GROUPS

from uk_budget_data import demographics as d
from uk_budget_data.geography import NATIONAL

REPO = Path(__file__).resolve().parent.parent
FAST = DisclosureSettings(n_replicates=200)
YEAR = 2029
REFORM = "two_child_limit"

# --- groups ------------------------------------------------------------------


def test_age_bands_cover_every_age_to_the_oldest():
    ages = [0, 17, 18, 24, 25, 34, 35, 49, 50, 64, 65, 79, 80, 97]
    assert list(d.age_band_labels(ages)) == [
        "AGE_0_17",
        "AGE_0_17",
        "AGE_18_24",
        "AGE_18_24",
        "AGE_25_34",
        "AGE_25_34",
        "AGE_35_49",
        "AGE_35_49",
        "AGE_50_64",
        "AGE_50_64",
        "AGE_65_79",
        "AGE_65_79",
        "AGE_80_PLUS",
        "AGE_80_PLUS",
    ]


def test_each_age_band_lies_inside_one_of_policyengine_pys_age_groups():
    assert d.band_groups() == {
        "AGE_0_17": "child",
        "AGE_18_24": "adult",
        "AGE_25_34": "adult",
        "AGE_35_49": "adult",
        "AGE_50_64": "adult",
        "AGE_65_79": "senior",
        "AGE_80_PLUS": "senior",
    }


def test_age_groups_are_policyengine_pys():
    labels = d.age_group_labels([0, 17, 18, 64, 65, 97])
    assert list(labels) == [
        "child",
        "child",
        "adult",
        "adult",
        "senior",
        "senior",
    ]
    assert set(labels) == set(AGE_GROUPS)
    assert set(d.GROUP_NAMES[d.AGE_GROUP]) == set(AGE_GROUPS)


def test_employment_groups_take_every_status_and_name_children():
    statuses = [
        "FT_EMPLOYED",
        "PT_EMPLOYED",
        "FT_SELF_EMPLOYED",
        "PT_SELF_EMPLOYED",
        "UNEMPLOYED",
        "RETIRED",
        "STUDENT",
        "CARER",
        "LONG_TERM_DISABLED",
        "SHORT_TERM_DISABLED",
        "OTHER_INACTIVE",
        "CHILD",
    ]
    assert list(d.employment_labels(statuses)) == [
        "EMPLOYEE",
        "EMPLOYEE",
        "SELF_EMPLOYED",
        "SELF_EMPLOYED",
        "UNEMPLOYED",
        "RETIRED",
        "STUDENT",
        "CARER",
        "SICK_OR_DISABLED",
        "SICK_OR_DISABLED",
        "OTHER_INACTIVE",
        "CHILD",
    ]
    with pytest.raises(ValueError, match="UNKNOWN_STATUS"):
        d.employment_labels(["UNKNOWN_STATUS"])


@pytest.mark.parametrize(
    "age, status, education, training, label",
    [
        (
            20,
            "UNEMPLOYED",
            "NOT_IN_EDUCATION",
            False,
            "NOT_IN_WORK_OR_EDUCATION",
        ),
        (19, "CHILD", "NOT_IN_EDUCATION", True, "IN_WORK_OR_EDUCATION"),
        (19, "STUDENT", "TERTIARY", False, "IN_WORK_OR_EDUCATION"),
        (23, "PT_EMPLOYED", "NOT_IN_EDUCATION", False, "IN_WORK_OR_EDUCATION"),
        (24, "CARER", "NOT_IN_EDUCATION", False, "NOT_IN_WORK_OR_EDUCATION"),
        (25, "UNEMPLOYED", "NOT_IN_EDUCATION", False, ""),
        (17, "UNEMPLOYED", "NOT_IN_EDUCATION", False, ""),
    ],
)
def test_young_people_are_in_or_not_in_work_or_education(
    age, status, education, training, label
):
    """Approved training counts as training; outside 18 to 24, no label
    (the groups nest in policyengine.py's adult age group)."""
    assert list(
        d.young_people_labels([age], [status], [education], [training])
    ) == [label]


# --- people and their survey households ----------------------------------------


class FakeDataset:
    def __init__(self, year, household, person):
        self.years = [year, year + 1]
        self._tables = SimpleNamespace(household=household, person=person)

    def __getitem__(self, year):
        assert year == self.years[0]
        return self._tables


class FakePersonSimulation:
    """The parts of a Microsimulation the demographic code reads."""

    def __init__(self, household, person, members, people):
        self.dataset = FakeDataset(2024, household, person)
        self.populations = {
            "household": SimpleNamespace(
                ids=household["household_id"].to_numpy(),
                members_entity_id=np.asarray(members),
            )
        }
        self.household_weight = household["household_weight"].to_numpy(
            np.float32
        )
        self.people = people

    def calculate(self, variable, period=None, map_to=None, unweighted=False):
        assert unweighted
        if map_to == "household":
            assert variable == "household_weight"
            return self.household_weight
        assert map_to == "person"
        return np.asarray(self.people[variable])


def microcosm_people(net_income=(30_000.0, 30_000.0, 20_000.0)):
    """Three Microcosm households (the second a copy of the first) and
    their five people."""
    household = pd.DataFrame(
        {
            "household_id": [1, 2, 3],
            "household_weight": [10.0, 10.0, 10.0],
            "source_household_id": [1, 1, 3],
            "household_is_capital_gains_clone": [False, True, False],
        }
    )
    members = [0, 0, 1, 1, 2]
    people = {
        "age": [40, 8, 40, 8, 70],
        "employment_status": [
            "FT_EMPLOYED",
            "CHILD",
            "FT_EMPLOYED",
            "CHILD",
            "RETIRED",
        ],
        "current_education": [
            "NOT_IN_EDUCATION",
            "PRIMARY",
            "NOT_IN_EDUCATION",
            "PRIMARY",
            "NOT_IN_EDUCATION",
        ],
        "is_in_approved_training": [False] * 5,
        "person_weight": [10.0] * 5,
        "household_net_income": [net_income[h] for h in members],
        "in_poverty_bhc": [False, False, False, False, True],
    }
    return FakePersonSimulation(household, pd.DataFrame(), members, people)


def test_each_person_carries_their_survey_household():
    collector = d.DemographicCollector.from_simulation(
        microcosm_people(), kind="microcosm", microcosm_export=True
    )
    # The copy's members count as the original's survey household
    assert list(collector.source_ids) == [1, 1, 1, 1, 3]


def test_the_collector_reads_both_runs_and_each_persons_groups():
    baseline = microcosm_people()
    reformed = microcosm_people(net_income=(30_500.0, 30_500.0, 20_000.0))
    collector = d.DemographicCollector.from_simulation(
        baseline, kind="microcosm", microcosm_export=True
    )
    collector.collect(REFORM, YEAR, baseline, reformed)
    run = collector.run(REFORM, YEAR)
    assert list(run.reformed - run.baseline) == [500.0] * 4 + [0.0]
    assert list(collector.labels(YEAR)[d.AGE_BAND]) == [
        "AGE_35_49",
        "AGE_0_17",
        "AGE_35_49",
        "AGE_0_17",
        "AGE_65_79",
    ]
    reformed.people["person_weight"] = [20.0] * 5
    with pytest.raises(ValueError, match="between the runs"):
        collector.collect("other", YEAR, baseline, reformed)


# --- estimates, the release and the public table ---------------------------


def synthetic_collector(old_households=3):
    """600 survey households of three people (an adult, a child and an 18
    to 24-year-old), plus a few households of one person over 80, too few
    to publish. Invented incomes and changes."""
    ages, statuses, education, training = [], [], [], []
    source_ids, baseline, change = [], [], []
    for household in range(600):
        young_not_in_work = household % 3 == 0
        for age, status, school in (
            (25 + household % 40, "FT_EMPLOYED", "NOT_IN_EDUCATION"),
            (household % 16, "CHILD", "PRIMARY"),
            (
                18 + household % 7,
                "UNEMPLOYED" if young_not_in_work else "STUDENT",
                "NOT_IN_EDUCATION" if young_not_in_work else "TERTIARY",
            ),
        ):
            ages.append(age)
            statuses.append(status)
            education.append(school)
            training.append(False)
            source_ids.append(household)
            baseline.append(30_000.0 + 10 * household)
            # Gains of varying size, so no group's change cancels to nothing
            change.append(50.0 + 25 * (household % 9))
    for household in range(600, 600 + old_households):
        ages.append(85)
        statuses.append("RETIRED")
        education.append("NOT_IN_EDUCATION")
        training.append(False)
        source_ids.append(household)
        baseline.append(18_000.0)
        change.append(300.0)
    count = len(ages)
    collector = d.DemographicCollector(source_ids=np.asarray(source_ids))
    baseline = np.asarray(baseline)
    poverty = np.asarray([income < 20_000 for income in baseline])
    collector.add(
        REFORM,
        YEAR,
        baseline=baseline,
        reformed=baseline + np.asarray(change),
        weight=np.full(count, 1_000.0),
        labels=d.group_labels(ages, statuses, education, training),
        poverty_before=poverty,
        poverty_after=poverty & (np.asarray(ages) >= 18),
    )
    return collector


@pytest.fixture(scope="module")
def built():
    return d.build_release(synthetic_collector(), settings=FAST)


@pytest.fixture(scope="module")
def table(built):
    return d.public_table(built)


def test_the_release_has_nothing_left_to_resolve(built):
    assert [f for f in built.release.check() if f.blocking] == []


def test_the_public_table_has_the_disclosure_layers_columns(table, tmp_path):
    columns = json.loads(
        (REPO / "scripts" / "disclosure_public_columns.json").read_text()
    )
    assert set(columns["required"]) <= set(table.columns)
    assert set(table.columns) <= set(columns["required"]) | set(
        columns["optional"]
    )
    path = tmp_path / "demographics.csv"
    table.to_csv(path, index=False)
    assert validate_public(path) == []


def test_it_publishes_the_age_levels_and_not_the_national_figure(table):
    assert set(table["level"]) == set(d.AGE_LEVELS)
    assert NATIONAL not in set(table["level"])
    assert set(table["outcome"]) == {"average_change", "relative_change"}
    assert table["area_name"].notna().all()


def test_a_group_with_too_few_survey_households_is_withheld(table):
    old = table[
        (table["level"] == d.AGE_BAND) & (table["area_code"] == "AGE_80_PLUS")
    ]
    assert set(old["tier"]) == {"withheld"}
    assert old["value"].isna().all()


def _withheld(table, level, code):
    rows = table[
        (table["level"] == level)
        & (table["area_code"] == code)
        & (table["outcome"] == "average_change")
    ]
    return bool((rows["tier"] == "withheld").all())


def test_no_withheld_group_can_be_recovered_by_subtraction(table):
    """The over-80s are withheld; pensioners are 65 to 79 plus 80 and over,
    so the 65 to 79s or the pensioners' figure is withheld too, and so on
    up to the national figure, which is public."""
    assert _withheld(table, d.AGE_BAND, "AGE_80_PLUS")
    seniors = d.GROUP_NAMES[d.AGE_BAND]
    assert seniors  # the bands exist
    assert _withheld(table, d.AGE_BAND, "AGE_65_79") or _withheld(
        table, d.AGE_GROUP, "senior"
    )
    if _withheld(table, d.AGE_GROUP, "senior"):
        assert (
            sum(_withheld(table, d.AGE_GROUP, group) for group in AGE_GROUPS)
            >= 2
        )


def test_young_people_nest_inside_the_18_to_24_band(table):
    young = table[table["level"] == d.YOUNG_PEOPLE]
    assert set(young["area_code"]) == {
        "NOT_IN_WORK_OR_EDUCATION",
        "IN_WORK_OR_EDUCATION",
    }


def test_employment_is_left_out_without_a_reviewer(built):
    assert d.EMPLOYMENT not in built.levels
    assert built.employment_reviewer is None


def test_employment_joins_when_a_reviewer_accepts_the_overlap():
    reviewed = d.build_release(
        synthetic_collector(), settings=FAST, employment_reviewer="A reviewer"
    )
    assert d.EMPLOYMENT in reviewed.levels
    assert reviewed.employment_reviewer == "A reviewer"
    table = d.public_table(reviewed)
    assert d.EMPLOYMENT in set(table["level"])
    findings = reviewed.release.check()
    assert [f for f in findings if f.blocking] == []
    assert any(f.code == "unchecked_overlap" for f in findings)


def test_a_blank_reviewer_is_refused():
    with pytest.raises(d.DemographicsError, match="reviewer"):
        d.build_release(
            synthetic_collector(), settings=FAST, employment_reviewer="  "
        )


def test_a_finding_withholding_cannot_answer_is_refused(monkeypatch):
    """Noise against a public reference: no withholding answers it."""
    unresolvable = SimpleNamespace(
        blocking=True,
        suggested=None,
        code="noise_reference_public",
        relation="release",
        level="age_band",
    )
    monkeypatch.setattr(d.Release, "check", lambda self: [unresolvable])
    with pytest.raises(d.DemographicsError, match="noise_reference_public"):
        d.build_release(synthetic_collector(), settings=FAST)


# --- poverty by age group ---------------------------------------------------------


def test_poverty_by_age_group_is_rates_only():
    collector = d.DemographicCollector(source_ids=np.arange(4))
    ages = [10, 30, 70, 40]
    collector.add(
        REFORM,
        YEAR,
        baseline=np.zeros(4),
        reformed=np.zeros(4),
        weight=np.asarray([1.0, 1.0, 2.0, 1.0]),
        labels=d.group_labels(
            ages,
            ["CHILD", "FT_EMPLOYED", "RETIRED", "FT_EMPLOYED"],
            ["PRIMARY"] + ["NOT_IN_EDUCATION"] * 3,
            [False] * 4,
        ),
        poverty_before=np.asarray([True, False, True, True]),
        poverty_after=np.asarray([False, False, True, True]),
    )
    rates = d.poverty_by_age(collector)
    assert list(rates.columns) == [
        "reform",
        "year",
        "age_group",
        "baseline_rate",
        "reform_rate",
        "change_pp",
    ]
    by_group = rates.set_index("age_group")
    assert by_group.loc["child", "baseline_rate"] == 100.0
    assert by_group.loc["child", "reform_rate"] == 0.0
    assert by_group.loc["child", "change_pp"] == -100.0
    assert by_group.loc["adult", "baseline_rate"] == 50.0
    assert by_group.loc["senior", "reform_rate"] == 100.0
