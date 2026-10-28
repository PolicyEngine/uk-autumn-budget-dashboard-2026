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
        "thin_cells",
        lambda baseline, reformed, years, survey: baseline.thin,
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
