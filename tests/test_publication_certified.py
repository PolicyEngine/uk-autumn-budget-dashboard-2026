"""End-to-end publication on real simulations (needs the certified data)."""

import pytest

from tests.publication_support import (
    DATASET_NAME,
    SMALL_DATASET_NAME,
    SOURCE_HEADER,
)
from uk_budget_data.models import DataConfig, Reform
from uk_budget_data.pipeline import build_microsimulation
from uk_budget_data.publication import manifest as m
from uk_budget_data.publication.artifacts import read_receipt, read_tables
from uk_budget_data.publication.generate import generate_artifacts
from uk_budget_data.publication.publish import PublishError, approve, stage
from uk_budget_data.publication.receipt import (
    ReceiptInputs,
    build_receipt_document,
    code_revision,
    dataset_years,
    load_basis,
    projection_end_year,
    scenario_identity,
)
from uk_budget_data.publication.reconcile import reconcile_artifact
from uk_budget_data.publication.validate import table_problems

BASIC_RATE = "gov.hmrc.income_tax.rates.uk[0].rate"


# The installed model's horizon: 2030 up to policyengine-uk 2.126.12, 2032
# from 2.130.1. A year past it is unsupported.
END = projection_end_year()


@pytest.mark.certified_data
def test_the_certified_dataset_yields_a_certified_receipt():
    """The bundle's default dataset is certified by bytes and versions."""
    sim = build_microsimulation(None)
    revision = code_revision()
    current_law = scenario_identity(
        None, name="current law", revision=revision
    )
    document = build_receipt_document(
        sim,
        sim,
        ReceiptInputs(
            key="current_law",
            measure_ids=["current_law"],
            years=[END - 1, END, END + 1],
            baseline_identity=current_law,
            reform_identity=current_law,
            file_digests={"budgetary_impact.csv": "0" * 64},
            basis=load_basis(),
            revision=revision,
        ),
    )
    receipt = document["execution_receipt"]
    assert receipt["certification_status"] == "certified"
    assert receipt["data"]["dataset"] == DATASET_NAME
    reasons = document["dashboard"]["reasons"]
    assert not [r for r in reasons if "uncommitted" not in r]
    years = dataset_years(sim)
    assert END in years and END + 1 not in years
    assert document["dashboard"]["unsupported_years"] == [END + 1]


@pytest.mark.certified_data
def test_generate_reconcile_and_stage_on_a_real_simulation(tmp_path):
    """A real run on a small dataset the bundle pins, through to staging.

    The small dataset is not the certified default, so the artifact can be
    staged but never shown or approved.
    """
    measure = Reform(
        id="basic_rate_21p",
        name="Basic rate 21p",
        parameter_changes={BASIC_RATE: {"2027": 0.21}},
    )
    config = DataConfig(
        years=[2027],
        dataset_path=SMALL_DATASET_NAME,
        data_dir=tmp_path / "no-weights",
    )
    data_root = tmp_path / "public" / "data"
    report = generate_artifacts(
        [measure], config, artifacts_root=data_root / "artifacts"
    )
    assert report.refused == {}
    reference = report.written[0]

    tables = read_tables(reference.path)
    assert table_problems(tables, key="basic_rate_21p", years=[2027]) == []
    impact = tables["budgetary_impact"][0]["value"]
    assert impact > 0  # a higher basic rate improves the government balance

    document = read_receipt(reference.path)
    assert (
        document["execution_receipt"]["certification_status"] == "uncertified"
    )
    assert document["dashboard"]["publishable"] is False
    assert document["execution_receipt"]["reform"]["binding"] == "content"

    inputs = tmp_path / "treasury"
    (inputs / "sources").mkdir(parents=True)
    (inputs / "sources" / "S.csv").write_text(
        SOURCE_HEADER
        + f"S,Test,costings,1,Basic rate,2027-28,{impact},static_costing,"
        "exchequer_positive,tax,\n"
    )
    (inputs / "mapping.csv").write_text(
        "measure_id,source_id,row_id,scale,year_offset,status,reason,reviewer\n"
        "basic_rate_21p,S,1,,,,,\n"
    )
    result = reconcile_artifact(reference.path, inputs)
    assert result["summary"]["status"] == "pass"
    assert result["responsiveness"]["status"] == "responsive"
    import json

    (reference.path / "reconciliation.json").write_text(json.dumps(result))

    manifest = m.Manifest()
    stage(manifest, reference.path, data_root=data_root, inputs=inputs)
    assert manifest.measures["basic_rate_21p"].status == m.STAGED
    with pytest.raises(PublishError, match="not certified"):
        approve(
            manifest,
            "basic_rate_21p",
            "Reviewer",
            data_root=data_root,
            inputs=inputs,
        )
