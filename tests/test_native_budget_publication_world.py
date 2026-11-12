"""Synthetic publication fixtures exercise the real native receipt contract.

All values, parameter paths, simulations and dataset bytes below are test
inputs. No policy or population calculation produces these numbers.
"""

import copy

import pytest
from policyengine_uk.utils.scenario import Scenario

from tests.fixed_shape_measures import module_level_modifier
from tests.publication_support import HISTORICAL_VERSIONS, World
from uk_budget_data.publication import manifest, receipt
from uk_budget_data.publication.artifacts import read_receipt
from uk_budget_data.publication.publish import approve, check, stage


@pytest.fixture
def world():
    instance = World()
    try:
        yield instance
    finally:
        instance.close()


def test_native_world_stages_and_approves_a_source_bound_package(world):
    publication = manifest.Manifest()
    args = {"data_root": world.data_root, "inputs": world.inputs}
    records, references = [], {}
    for key, value in (("alpha", -1.0), ("beta", -2.0)):
        references[key] = world.ready(key, {2027: value, 2028: value})
        document = read_receipt(references[key].path)
        assert document["execution_receipt"]["model"]["version"] == "2.174.1"
        assert (
            document["dashboard"]["policy_comparison"]["baseline_delta"][
                "parameter_changes"
            ]
            is None
        )
        assert receipt.document_problems(document) == []
        stage(publication, references[key].path, **args)
        approve(publication, key, "Synthetic test reviewer", **args)
        records.append(
            {
                "id": key,
                **{
                    side: document["execution_receipt"][side]
                    for side in ("baseline", "reform")
                },
            }
        )

    key = "combined--alpha+beta"
    combined = world.write(
        key,
        {2027: -3.0, 2028: -3.0},
        members=records,
        measure_ids=["alpha", "beta"],
        member_outputs={
            key: value.outputs_sha256 for key, value in references.items()
        },
    )
    document = read_receipt(combined.path)
    dashboard = document["dashboard"]
    assert dashboard["composition"]["method"] == receipt.RESOLVED_COMMON_POLICY
    assert "policy_comparison" not in dashboard
    assert (
        len(
            {
                next(iter(member["reform_delta"]["parameter_changes"]))
                for member in dashboard["members"]
            }
        )
        == 2
    )
    assert receipt.document_problems(document) == []
    world.costing(key, {2027: -3.0, 2028: -3.0})
    world.reconcile(combined)
    stage(publication, combined.path, **args)
    approve(publication, key, "Synthetic test reviewer", **args)
    assert check(publication, **args) == []


def test_native_world_cannot_drop_its_comparison_recipe(world):
    document = read_receipt(world.write("alpha", {2027: -1.0}).path)
    document = copy.deepcopy(document)
    del document["dashboard"]["policy_comparison"]
    document["dashboard"]["basis"].pop("policy", None)
    assert any(
        "requires an explicit common-policy comparison" in problem
        for problem in receipt.document_problems(document)
    )


def test_native_world_binds_explicit_parameter_inputs_with_a_custom_baseline(
    world,
):
    path = "gov.hmrc.income_tax.rates.uk[0].rate"
    before = {path: {"2027": 0.19}}
    after = {path: {"2027": 0.21}}
    reference = world.write(
        "explicit",
        {2027: -1.0},
        parameter_changes=after,
        baseline_parameter_changes=before,
        baseline_identity=receipt.comparison_identity(
            Scenario(parameter_changes=before),
            name="before",
            revision=world.revision(),
        ),
        reform_identity=receipt.comparison_identity(
            Scenario(parameter_changes=after),
            name="after",
            revision=world.revision(),
        ),
    )
    document = read_receipt(reference.path)
    recipe = document["dashboard"]["policy_comparison"]
    assert recipe["baseline_delta"]["parameter_changes"] == before
    assert recipe["reform_delta"]["parameter_changes"] == after
    assert receipt.document_problems(document) == []


def test_explicit_historical_world_keeps_legacy_modifier_evidence():
    api, source = receipt.receipt_api()
    original_package_identity = api.installed_package_identity
    world = World(historical=True)
    try:
        identity = receipt.scenario_identity(
            Scenario(simulation_modifier=module_level_modifier),
            name="legacy modifier",
            revision=world.revision(),
        )
        document = read_receipt(
            world.write("legacy", {2027: -1.0}, reform_identity=identity).path
        )
        execution = document["execution_receipt"]
        for field, package in (
            ("wrapper", "policyengine"),
            ("model", "policyengine-uk"),
            ("core", "policyengine-core"),
        ):
            assert execution[field]["version"] == HISTORICAL_VERSIONS[package]
        assert (
            "synthetic historical" in execution["certificate"]["certified_by"]
        )
        assert "policy_comparison" not in document["dashboard"]
        assert receipt.document_problems(document) == []
    finally:
        world.close()
    assert receipt.receipt_api() == (api, source)
    assert api.installed_package_identity is original_package_identity
