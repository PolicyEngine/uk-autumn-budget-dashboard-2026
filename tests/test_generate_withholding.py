"""Generation binds withheld decile bytes and carries member withholding."""

from types import SimpleNamespace

import numpy as np
import pytest

from tests.publication_support import World
from tests.test_publication_flow import (
    HIGHER_RATE_PATH,
    YEARS,
    fake_process,
    reform,
)
from uk_budget_data.models import DataConfig, Reform
from uk_budget_data.publication import combine, generate
from uk_budget_data.publication import disclosure_floor as floor
from uk_budget_data.publication import manifest as m
from uk_budget_data.publication.artifacts import (
    file_problems,
    read_receipt,
    read_tables,
)
from uk_budget_data.publication.publish import approve, stage
from uk_budget_data.publication.receipt import document_problems


@pytest.mark.parametrize("from_manifest", [False, True])
def test_package_inherits_withheld_cells_from_member_receipts(
    monkeypatch, from_manifest
):
    """Fresh members and manifest members use the same receipt labels."""
    from uk_budget_data import pipeline

    world = World()
    monkeypatch.setattr(
        generate, "code_revision", lambda root: world.revision()
    )
    monkeypatch.setattr(combine, "check_consistency", lambda *args: None)
    monkeypatch.setattr(generate, "_built_from_a_dataset", lambda sim: True)
    monkeypatch.setattr(
        pipeline, "scatter_survey_households", lambda sim, path: np.arange(10)
    )
    monkeypatch.setattr(
        floor,
        "thin_cells_and_extra_ages",
        lambda baseline, reformed, years, survey, inherited=None: (
            baseline.thin,
            {},
        ),
    )
    alpha = reform("alpha")
    beta = Reform(
        id="beta",
        name="Beta",
        parameter_changes={HIGHER_RATE_PATH: {str(y): 0.41 for y in YEARS}},
    )
    key = "combined--alpha+beta"
    values = {
        "alpha": {2027: -1.0, 2028: -2.0},
        "beta": {2027: -0.5, 2028: -0.6},
        key: {2027: -1.4, 2028: -2.5},
    }
    thin_label = {"alpha": "5", "beta": "7", key: "9"}
    make_result = fake_process(values)

    def process(measure, config, baseline, reformed, baseline_scenario):
        baseline.thin = {
            (table, 2027): [thin_label[measure.id]]
            for table in floor.DECILE_TABLES
        }
        baseline.calculate = lambda *args, **kwargs: SimpleNamespace(
            values=np.arange(1, 11)
        )
        return make_result(
            measure, config, baseline, reformed, baseline_scenario
        )

    arguments = dict(data_root=world.data_root, inputs=world.inputs)
    manifest = m.Manifest()

    def publish_member(reference):
        world.costing(reference.key, values[reference.key])
        world.reconcile(reference)
        stage(manifest, reference.path, **arguments)
        approve(manifest, reference.key, "María", **arguments)

    def run(members, combined):
        return generate.generate_artifacts(
            members,
            DataConfig(years=YEARS),
            combined_sets=combined,
            artifacts_root=world.artifacts,
            build=lambda dataset, scenario=None: world.sim(),
            process=process,
        )

    try:
        if from_manifest:
            members = run([alpha, beta], [])
            assert members.refused == {}
            for reference in members.written:
                publish_member(reference)
            m.save_manifest(manifest, world.data_root)
            report = run([], [[beta, alpha]])
        else:
            report = run([alpha, beta], [[beta, alpha]])
            for reference in report.written[:2]:
                publish_member(reference)
        assert report.refused == {}
        reference = report.written[-1]
        assert reference.key == key
        document = read_receipt(reference.path)
        record = document["dashboard"]["disclosure_floor"]
        assert record["thin_cells_in_tables"] is False
        assert record["withheld_cells"] == [
            {
                "table": "distributional_impact",
                "year": 2027,
                "groups": ["5", "7", "9"],
            },
            {
                "table": "winners_losers",
                "year": 2027,
                "groups": ["5", "7", "9", "all"],
            },
        ]
        tables = read_tables(reference.path)
        for table in floor.DECILE_TABLES:
            column = (
                "value" if table == "distributional_impact" else "avg_change"
            )
            for row in tables[table]:
                withheld = row["year"] == 2027 and floor.decile_label(
                    row["decile"]
                ) in {"5", "7", "9", "all"}
                assert (row[column] is None) is withheld
        # The receipt's file and output digests bind the bytes after blanking.
        assert file_problems(reference.path, document) == []
        assert document_problems(document) == []
        stage(manifest, reference.path, **arguments)
        approve(manifest, key, "María", **arguments)
        assert manifest.combined[key].status == m.APPROVED
    finally:
        world.close()


AGE_LABELS = ["0-15", "16-24", "25-34", "35-49", "50-64", "65+", "all"]
AGE_SINGLES = ["40", "70", "90+"]


def _age_rows(measure, year):
    return [
        {
            "reform_id": measure.id,
            "reform_name": measure.name,
            "year": year,
            "age_band": label,
            "people": 1_000.0,
            "sample_size": 500,
            "mean_change": -1.0,
            "mean_equivalised_change": -1.0,
            "pct_better_off": 0.0,
            "pct_worse_off": 50.0,
            "pct_unchanged": 50.0,
            "people_directly_affected": 500.0,
        }
        for label in AGE_LABELS + AGE_SINGLES
    ]


@pytest.mark.parametrize("from_manifest", [False, True])
def test_package_leaves_out_the_age_rows_its_members_leave_out(
    monkeypatch, from_manifest
):
    """#340: a member's thin single age (70) leaves the member's table,
    with the single age its survey households add to clear the floor
    (90+, #358). The package must leave out the same rows, or its row less
    the other members' gives the member's back."""
    from uk_budget_data import pipeline

    world = World()
    monkeypatch.setattr(
        generate, "code_revision", lambda root: world.revision()
    )
    monkeypatch.setattr(combine, "check_consistency", lambda *args: None)
    monkeypatch.setattr(generate, "_built_from_a_dataset", lambda sim: True)
    monkeypatch.setattr(
        pipeline, "scatter_survey_households", lambda sim, path: np.arange(10)
    )
    # What each run passes as its members' ages: the package must count its
    # own survey households with the ages it inherits (#358)
    inherited_by_run = []

    def counted(baseline, reformed, years, survey, inherited=None):
        inherited_by_run.append((baseline.measure_id, inherited))
        return baseline.thin, baseline.extra

    monkeypatch.setattr(floor, "thin_cells_and_extra_ages", counted)
    alpha = reform("alpha")
    beta = Reform(
        id="beta",
        name="Beta",
        parameter_changes={HIGHER_RATE_PATH: {str(y): 0.41 for y in YEARS}},
    )
    key = "combined--alpha+beta"
    values = {
        "alpha": {2027: -1.0, 2028: -2.0},
        "beta": {2027: -0.5, 2028: -0.6},
        key: {2027: -1.4, 2028: -2.5},
    }
    # Only alpha has a thin cell, and only in the age table
    thin = {"alpha": {("age_impact", 2027): ["70"]}, "beta": {}, key: {}}
    # 70 with 65+'s ages without a row is still thin, so 90+ joins it
    extra = {"alpha": {2027: {"65+": ["90+"]}}, "beta": {}, key: {}}
    make_result = fake_process(values)

    def process(measure, config, baseline, reformed, baseline_scenario):
        baseline.measure_id = measure.id
        baseline.thin = thin[measure.id]
        baseline.extra = extra[measure.id]
        baseline.calculate = lambda *args, **kwargs: SimpleNamespace(
            values=np.arange(1, 11)
        )
        result = make_result(
            measure, config, baseline, reformed, baseline_scenario
        )
        result.age_impact = [
            row for year in YEARS for row in _age_rows(measure, year)
        ]
        return result

    arguments = dict(data_root=world.data_root, inputs=world.inputs)
    manifest = m.Manifest()

    def publish_member(reference):
        world.costing(reference.key, values[reference.key])
        world.reconcile(reference)
        stage(manifest, reference.path, **arguments)
        approve(manifest, reference.key, "María", **arguments)

    def run(members, combined):
        return generate.generate_artifacts(
            members,
            DataConfig(years=YEARS),
            combined_sets=combined,
            artifacts_root=world.artifacts,
            build=lambda dataset, scenario=None: world.sim(),
            process=process,
        )

    withheld_age = {
        "table": "age_impact",
        "year": 2027,
        "groups": ["70", "90+"],
    }
    try:
        if from_manifest:
            members = run([alpha, beta], [])
            assert members.refused == {}
            for reference in members.written:
                publish_member(reference)
            m.save_manifest(manifest, world.data_root)
            report = run([], [[beta, alpha]])
        else:
            report = run([alpha, beta], [[beta, alpha]])
            for reference in report.written[:2]:
                publish_member(reference)
        assert report.refused == {}
        reference = report.written[-1]
        assert reference.key == key
        document = read_receipt(reference.path)
        record = document["dashboard"]["disclosure_floor"]
        # The package's own cells are not thin: it withholds alpha's
        assert record["thin_cells"] == []
        assert record["thin_cells_in_tables"] is False
        assert record["withheld_cells"] == [withheld_age]
        published = {
            (row["year"], row["age_band"])
            for row in read_tables(reference.path)["age_impact"]
        }
        assert published == {
            (year, label)
            for year in YEARS
            for label in AGE_LABELS + AGE_SINGLES
        } - {(2027, "70"), (2027, "90+")}
        # The member's own receipt records the rows it left out the same way
        if not from_manifest:
            member = next(r for r in report.written if r.key == "alpha")
            member_record = read_receipt(member.path)["dashboard"][
                "disclosure_floor"
            ]
            assert member_record["withheld_cells"] == [withheld_age]
            assert member_record["age_extra_cells"] == [
                {
                    "table": "age_impact",
                    "year": 2027,
                    "band": "65+",
                    "groups": ["90+"],
                }
            ]
        # The package added no age of its own, and it counted its own
        # survey households with alpha's thin age and extra age
        assert "age_extra_cells" not in record
        package_runs = [
            ages for run_id, ages in inherited_by_run if run_id == key
        ]
        assert package_runs == [{2027: ["70", "90+"]}]
        assert file_problems(reference.path, document) == []
        assert document_problems(document) == []
        stage(manifest, reference.path, **arguments)
        approve(manifest, key, "María", **arguments)
        assert manifest.combined[key].status == m.APPROVED
    finally:
        world.close()
