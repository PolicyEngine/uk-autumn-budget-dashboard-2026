"""Archived fake comparisons never change the active native contract."""

import hashlib
import inspect

import pytest
from policyengine_uk.utils.scenario import Scenario

from tests import archived_publication
from tests.fixed_shape_measures import module_level_modifier
from tests.publication_support import World
from uk_budget_data.publication import receipt
from uk_budget_data.publication.artifacts import read_receipt


def test_archived_composer_is_the_exact_reviewed_source():
    source = inspect.getsource(
        archived_publication.combined_identities
    ).rstrip("\n")
    assert (
        hashlib.sha256(source.encode()).hexdigest()
        == archived_publication.ARCHIVED_COMPOSER_SHA256
    )
    assert (
        archived_publication.ARCHIVED_SOURCE_COMMIT
        == "683dd8c2330d0e7fe018dda0d3696500130d7434"
    )


@pytest.mark.parametrize("raise_inside", [False, True])
def test_archived_callables_restore_even_after_an_exception(raise_inside):
    originals = archived_publication.current_bindings()

    def archived_run():
        world = World(historical=True, archived_pipeline=True)
        try:
            assert all(
                getattr(module, name) is replacement
                for module, name, replacement in archived_publication.comparison_targets()
            )
            if raise_inside:
                raise RuntimeError("synthetic fixture exception")
        finally:
            world.close()

    if raise_inside:
        with pytest.raises(RuntimeError, match="synthetic fixture exception"):
            archived_run()
    else:
        archived_run()
    assert all(
        getattr(module, name) is original
        for module, name, original in originals
    )

    # New work after teardown still binds the actual native common policy
    # and refuses national structural recipes, regardless of household API
    # phased identity support.
    native = World()
    try:
        document = read_receipt(native.write("native", {2027: -1.0}).path)
        assert document["execution_receipt"]["model"]["version"] == "2.174.1"
        assert document["dashboard"]["policy_comparison"][
            "common_policy_reference"
        ]
        del document["dashboard"]["policy_comparison"]
        assert any(
            "requires an explicit common-policy" in p
            for p in receipt.document_problems(document)
        )
        with pytest.raises(receipt.ReceiptUnavailable, match="structural"):
            receipt.comparison_scenario(
                Scenario(simulation_modifier=module_level_modifier)
            )
    finally:
        native.close()


def test_archived_mode_requires_explicit_historical_metadata():
    with pytest.raises(ValueError, match="explicit historical metadata"):
        World(archived_pipeline=True)


def test_attached_archived_context_restores_without_deleting_the_shared_root():
    owner = World(historical=True, archived_pipeline=True)
    try:
        attached = World.attach(owner.root)
        assert attached.archived_pipeline and attached.historical
        attached.close()
        assert owner.root.is_dir()
        assert all(
            getattr(module, name) is replacement
            for module, name, replacement in archived_publication.comparison_targets()
        )
    finally:
        owner.close()
