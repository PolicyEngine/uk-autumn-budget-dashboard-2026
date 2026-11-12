"""Area definitions bind the same actual policy package as national runs.

This checks scenario assembly and public receipt identities, without data
or population calculations.
"""

from uk_budget_data import geography, reforms
from uk_budget_data.forecast import with_forecast
from uk_budget_data.models import DataConfig
from uk_budget_data.publication import receipt
from uk_budget_data.publication.combine import combine_measures, member_order
from uk_budget_data.publication.generate import _combined_run_identities

REVISION = receipt.CodeRevision("a" * 40, tree_clean=True)


def _core(identity):
    return receipt._identity_core(identity.model_dump(mode="json"))


def test_real_area_package_matches_national_and_effective_runtime_identities():
    years = [2026, 2027, 2031]
    config = DataConfig(years=years)
    package_id = reforms.AUTUMN_BUDGET_2026_COMBINED_ID
    members = member_order(
        [
            reforms.get_reform(member_id)
            for member_id in geography.PACKAGES[package_id]
        ]
    )
    combined = combine_measures(members, config)
    uses_config = any(not member.has_custom_baseline() for member in members)

    area = geography._area_identities(package_id, years, REVISION)
    national = _combined_run_identities(
        combined, members, config, REVISION, uses_config
    )[:2]
    effective = (
        with_forecast(combined.baseline_scenario_for(config, uses_config)),
        with_forecast(combined.to_scenario()),
    )

    assert all(scenario.applied_before_data_load for scenario in effective)
    assert [_core(identity) for identity in area] == [
        _core(identity) for identity in national
    ]
    assert [_core(identity) for identity in area] == [
        _core(
            receipt.scenario_identity(scenario, name=side, revision=REVISION)
        )
        for side, scenario in zip(("baseline", "reform"), effective)
    ]
    assert geography.definition_digests(package_id, years) == {
        side: identity.model_dump()["reform_sha256"]
        for side, identity in zip(("baseline", "reform"), area)
    }
