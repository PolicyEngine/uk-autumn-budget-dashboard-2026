"""A measure the certified data cannot cost is never published as a figure.

It is staged only as ``not_computable``, listed with its reason; every level
that would show a figure refuses it, approval refuses it, and the checks the
page and the briefing exports rely on keep it that way.
"""

import itertools

import pytest
from policyengine_uk import Simulation
from pydantic import ValidationError

from tests.fixed_shape_measures import (
    raise_additional_dwelling_rates,
    sdlt_from_purchases_read_at_build,
)
from tests.publication_support import World, make_household_rows, make_tables
from uk_budget_data.data_limits import DATA_LIMITS, record
from uk_budget_data.models import DataConfig, Reform, ReformResult
from uk_budget_data.publication import generate as generate_module
from uk_budget_data.publication import manifest as m
from uk_budget_data.publication.artifacts import read_receipt
from uk_budget_data.publication.generate import generate_artifacts
from uk_budget_data.publication.publish import (
    PublishError,
    approve,
    check,
    gate_problems,
    stage,
)
from uk_budget_data.publication.receipt import dashboard_problems

SURCHARGE_RATE = (
    "gov.hmrc.stamp_duty.residential.purchase.additional.rate[1].rate"
)
NON_RESIDENTIAL_RATE = "gov.hmrc.stamp_duty.non_residential.purchase[1].rate"
BY_KEY = {limit.key: limit for limit in DATA_LIMITS}
SURCHARGE = record(BY_KEY["additional_dwelling_purchases"], [SURCHARGE_RATE])
NON_RESIDENTIAL = record(
    BY_KEY["non_residential_purchases"], [NON_RESIDENTIAL_RATE]
)
VALUES = {2027: -1.0, 2028: -2.0}
ZERO = {2027: 0.0, 2028: 0.0}
YEARS = [2027, 2028]


@pytest.fixture
def world(monkeypatch):
    instance = World()
    monkeypatch.setattr(
        generate_module, "code_revision", lambda root: instance.revision()
    )
    yield instance
    instance.close()


def staged(world, manifest, key, values, limits, **kwargs):
    reference = world.write(key, values, data_limits=limits)
    stage(
        manifest,
        reference.path,
        data_root=world.data_root,
        inputs=world.inputs,
        **kwargs,
    )
    return reference


# --- staging ---------------------------------------------------------------


@pytest.mark.parametrize("provisional", [False, True])
def test_a_data_limited_measure_is_staged_as_not_computable(
    world, provisional
):
    """Whatever was asked for, and though it is inert (the data give it
    £0), it is listed with its reason and no figure."""
    manifest = m.Manifest()
    staged(
        world, manifest, "alpha", ZERO, [SURCHARGE], provisional=provisional
    )
    entry = manifest.measures["alpha"]
    assert entry.status == m.NOT_COMPUTABLE
    assert entry.data_limits == ["additional_dwelling_purchases"]
    assert entry.reason == SURCHARGE["reason"]
    assert entry.approval is None and entry.reconciliation is None
    assert m.NOT_COMPUTABLE not in m.DISPLAYABLE
    assert m.NOT_COMPUTABLE in m.LISTED


def test_its_reasons_are_joined_when_it_touches_two_limits(world):
    manifest = m.Manifest()
    staged(world, manifest, "alpha", ZERO, [SURCHARGE, NON_RESIDENTIAL])
    entry = manifest.measures["alpha"]
    assert entry.data_limits == [
        "additional_dwelling_purchases",
        "non_residential_purchases",
    ]
    assert entry.reason == f"{SURCHARGE['reason']} {NON_RESIDENTIAL['reason']}"


# Every non-empty set of limits, at every level that shows a figure, with
# the £0 the data give it and with a figure that only looks plausible (what
# the engine gave before policyengine-uk #2241).
LIMIT_SETS = [[SURCHARGE], [NON_RESIDENTIAL], [SURCHARGE, NON_RESIDENTIAL]]


@pytest.mark.parametrize(
    "limits, level, values",
    list(
        itertools.product(
            LIMIT_SETS,
            [m.STAGED, m.PROVISIONAL, m.APPROVED],
            [ZERO, VALUES],
        )
    ),
)
def test_no_level_that_shows_a_figure_accepts_a_data_limited_artifact(
    world, limits, level, values
):
    world.costing("alpha", values)
    world.expect("alpha", "negative", 2027)
    reference = world.write("alpha", values, data_limits=limits)
    world.reconcile(reference)
    problems, _ = gate_problems(
        "alpha",
        reference.path,
        m.Manifest(),
        level=level,
        data_root=world.data_root,
        inputs=world.inputs,
    )
    assert any(
        f"not computable on current data, so it cannot be {level}" in p
        for p in problems
    ), problems


def test_an_artifact_with_no_data_limit_cannot_be_not_computable(world):
    reference = world.write("alpha", VALUES)
    problems, _ = gate_problems(
        "alpha",
        reference.path,
        m.Manifest(),
        level=m.NOT_COMPUTABLE,
        data_root=world.data_root,
        inputs=world.inputs,
    )
    assert any("records no data limit" in p for p in problems)


def test_a_not_computable_entry_still_needs_a_publishable_receipt(world):
    reference = world.write(
        "alpha", ZERO, data_limits=[SURCHARGE], clean=False
    )
    with pytest.raises(PublishError, match="not publishable"):
        stage(
            m.Manifest(),
            reference.path,
            data_root=world.data_root,
            inputs=world.inputs,
        )


# --- approval, checks and exports ------------------------------------------


def test_a_not_computable_entry_cannot_be_approved(world):
    manifest = m.Manifest()
    staged(world, manifest, "alpha", ZERO, [SURCHARGE])
    with pytest.raises(PublishError, match="no figure to approve"):
        approve(
            manifest,
            "alpha",
            "Reviewer",
            data_root=world.data_root,
            inputs=world.inputs,
        )
    assert manifest.measures["alpha"].status == m.NOT_COMPUTABLE


def test_check_passes_a_not_computable_entry(world):
    manifest = m.Manifest()
    staged(world, manifest, "alpha", ZERO, [SURCHARGE])
    assert (
        check(manifest, data_root=world.data_root, inputs=world.inputs) == []
    )


def test_check_refuses_a_data_limited_artifact_relabelled_to_show_figures(
    world,
):
    """Edited by hand to provisional, with its limits dropped from the
    entry, the artifact still records them: check refuses it."""
    manifest = m.Manifest()
    staged(world, manifest, "alpha", ZERO, [SURCHARGE])
    entry = manifest.measures["alpha"]
    entry.status, entry.data_limits, entry.reason = m.PROVISIONAL, [], None
    failures = check(manifest, data_root=world.data_root, inputs=world.inputs)
    assert any("cannot be provisional" in f for f in failures), failures


def test_check_refuses_an_entry_whose_reason_is_not_its_artifacts(world):
    manifest = m.Manifest()
    staged(world, manifest, "alpha", ZERO, [SURCHARGE])
    manifest.measures["alpha"].reason = "costed in the Red Book"
    failures = check(manifest, data_root=world.data_root, inputs=world.inputs)
    assert any("reason is not the artifact's" in f for f in failures)


def test_check_refuses_an_entry_naming_other_limits_than_its_artifact(world):
    manifest = m.Manifest()
    staged(world, manifest, "alpha", ZERO, [SURCHARGE])
    manifest.measures["alpha"].data_limits = ["non_residential_purchases"]
    failures = check(manifest, data_root=world.data_root, inputs=world.inputs)
    assert any("data limits are not the artifact's" in f for f in failures)


def test_the_briefing_exports_refuse_a_not_computable_entry(world):
    from uk_budget_data.publication.exports import load_approved

    manifest = m.Manifest()
    staged(world, manifest, "alpha", ZERO, [SURCHARGE])
    m.save_manifest(manifest, world.data_root)
    with pytest.raises(PublishError, match="not_computable, not approved"):
        load_approved(
            ["alpha"], data_root=world.data_root, inputs=world.inputs
        )


# --- the manifest and receipt models ---------------------------------------


def entry_fields(**overrides):
    fields = dict(
        name="Alpha",
        status=m.NOT_COMPUTABLE,
        artifact="artifacts/alpha/0123456789abcdef",
        outputs_sha256="a" * 64,
        receipt_sha256="b" * 64,
        execution_identity_sha256="c" * 64,
        artifact_sha256="d" * 64,
        years=YEARS,
        data_limits=["additional_dwelling_purchases"],
        reason=SURCHARGE["reason"],
    )
    fields.update(overrides)
    return fields


def test_the_manifest_model_accepts_a_well_formed_not_computable_entry():
    m.Entry(**entry_fields())


@pytest.mark.parametrize(
    "overrides",
    [
        {"data_limits": []},
        {"reason": None},
        {
            "approval": {
                "by": "R",
                "at": "now",
                "outputs_sha256": "a" * 64,
                "artifact_sha256": "d" * 64,
            }
        },
        {"status": m.APPROVED, "reason": None},
        {"status": m.PROVISIONAL},
        {"status": m.STAGED},
    ],
)
def test_the_manifest_model_refuses_a_data_limited_entry_with_figures(
    overrides,
):
    with pytest.raises(ValidationError):
        m.Entry(**entry_fields(**overrides))


def test_a_receipt_without_recorded_limits_is_a_problem(world):
    reference = world.write("alpha", VALUES)
    document = read_receipt(reference.path)
    del document["dashboard"]["data_limits"]
    assert "its data limits are not recorded" in dashboard_problems(document)


def test_a_receipt_from_another_registry_is_a_problem(world):
    """An artifact generated before a limit was added (or after one was
    lifted) must be regenerated: its recorded limits may be wrong."""
    reference = world.write("alpha", VALUES)
    document = read_receipt(reference.path)
    document["dashboard"]["data_limits_registry_sha256"] = "0" * 64
    assert any(
        "another data-limit registry" in p
        for p in dashboard_problems(document)
    )


def test_a_receipt_with_an_edited_reason_is_a_problem(world):
    reference = world.write("alpha", ZERO, data_limits=[SURCHARGE])
    document = read_receipt(reference.path)
    document["dashboard"]["data_limits"][0]["reason"] = "costed elsewhere"
    assert any("not the registry's" in p for p in dashboard_problems(document))


# --- combined runs -----------------------------------------------------------


def combined(world, manifest, members, values, limits):
    records = []
    for member in sorted(members):
        receipt = read_receipt(
            world.data_root / manifest.measures[member].artifact
        )["execution_receipt"]
        records.append(
            {
                "id": member,
                "reform": receipt["reform"],
                "baseline": receipt["baseline"],
            }
        )
    return world.write(
        "combined--" + "+".join(sorted(members)),
        values,
        members=records,
        measure_ids=sorted(members),
        member_outputs={
            member: manifest.measures[member].outputs_sha256
            for member in sorted(members)
        },
        data_limits=limits,
    )


def test_a_combined_run_with_a_data_limited_member_is_not_computable(world):
    """Its total would silently leave the member's effect out."""
    manifest = m.Manifest()
    staged(world, manifest, "alpha", ZERO, [SURCHARGE])
    world.costing("beta", VALUES)
    staged(world, manifest, "beta", VALUES, [])
    reference = combined(
        world, manifest, ["alpha", "beta"], VALUES, [SURCHARGE]
    )
    stage(
        manifest,
        reference.path,
        data_root=world.data_root,
        inputs=world.inputs,
    )
    entry = manifest.combined["combined--alpha+beta"]
    assert entry.status == m.NOT_COMPUTABLE
    assert entry.data_limits == ["additional_dwelling_purchases"]


def test_a_combined_run_showing_figures_refuses_a_not_computable_member(
    world,
):
    manifest = m.Manifest()
    staged(world, manifest, "alpha", ZERO, [SURCHARGE])
    world.costing("beta", VALUES)
    staged(world, manifest, "beta", VALUES, [])
    reference = combined(world, manifest, ["alpha", "beta"], VALUES, [])
    with pytest.raises(PublishError, match="member alpha is not"):
        stage(
            manifest,
            reference.path,
            data_root=world.data_root,
            inputs=world.inputs,
        )


def test_a_member_becoming_not_computable_stales_an_approved_combined_run(
    world,
):
    """Review of #51: with unchanged outputs, a combined approval survived
    its member becoming not computable."""
    manifest = m.Manifest()
    for key in ("alpha", "beta"):
        world.costing(key, VALUES)
        world.expect(key, "negative", 2027)
        reference = world.write(key, VALUES)
        world.reconcile(reference)
        stage(
            manifest,
            reference.path,
            data_root=world.data_root,
            inputs=world.inputs,
        )
        approve(
            manifest,
            key,
            "Reviewer",
            data_root=world.data_root,
            inputs=world.inputs,
        )
    reference = combined(world, manifest, ["alpha", "beta"], VALUES, [])
    stage(
        manifest,
        reference.path,
        data_root=world.data_root,
        inputs=world.inputs,
    )
    approve(
        manifest,
        "combined--alpha+beta",
        "Reviewer",
        data_root=world.data_root,
        inputs=world.inputs,
    )
    outputs = manifest.measures["alpha"].outputs_sha256
    # The same figures, now recorded as touching a data limit.
    staged(world, manifest, "alpha", VALUES, [SURCHARGE])
    assert manifest.measures["alpha"].outputs_sha256 == outputs
    entry = manifest.combined["combined--alpha+beta"]
    assert entry.status == m.STALE and entry.approval is None


def test_restaging_an_unchanged_not_computable_member_keeps_its_combined_run(
    world,
):
    """Review of #51 round 2: an identical restage staled the combined run."""
    manifest = m.Manifest()
    staged(world, manifest, "alpha", ZERO, [SURCHARGE])
    world.costing("beta", VALUES)
    staged(world, manifest, "beta", VALUES, [])
    reference = combined(
        world, manifest, ["alpha", "beta"], VALUES, [SURCHARGE]
    )
    stage(
        manifest,
        reference.path,
        data_root=world.data_root,
        inputs=world.inputs,
    )
    staged(world, manifest, "alpha", ZERO, [SURCHARGE])
    assert manifest.combined["combined--alpha+beta"].status == m.NOT_COMPUTABLE


# --- generation records the limits ------------------------------------------


def fake_process(values):
    def process(reform, config, baseline, reformed, baseline_scenario):
        tables = make_tables(reform.id, values)
        tables.pop("household_scatter_binned")
        return ReformResult(
            household_scatter=make_household_rows(reform.id, values),
            reform_id=reform.id,
            reform_name=reform.name,
            constituency=[],
            demographic_constituency=[],
            **tables,
        )

    return process


def household():
    return {
        "people": {"p": {"age": {2027: 40}}},
        "benunits": {"b": {"members": ["p"]}},
        "households": {"h": {"members": ["p"]}},
    }


def built(world):
    """Stand-in simulations carrying a real parameter tree, built with the
    scenario, so generation compares the trees as it does on a real run."""

    def build(dataset, scenario=None):
        sim = world.sim()
        sim.tax_benefit_system = Simulation(
            situation=household(), scenario=scenario
        ).tax_benefit_system
        return sim

    return build


def generated_limits(world, reform, build):
    report = generate_artifacts(
        [reform],
        DataConfig(years=YEARS),
        artifacts_root=world.artifacts,
        generator_argv=["test"],
        build=build,
        process=fake_process(ZERO),
    )
    assert not report.refused, report.refused
    return read_receipt(report.written[0].path)["dashboard"]["data_limits"]


def test_generation_records_a_parameter_change_on_a_limited_rate(world):
    reform = Reform(
        id="surcharge",
        name="Surcharge",
        parameter_changes={SURCHARGE_RATE: {"2027": 0.07, "2028": 0.07}},
    )
    # From the scenarios alone (stand-ins with no parameter tree) ...
    assert generated_limits(
        world, reform, lambda dataset, scenario=None: world.sim()
    ) == [SURCHARGE]
    # ... and from the built trees.
    assert generated_limits(world, reform, built(world)) == [SURCHARGE]


def test_generation_records_a_modifier_on_a_limited_rate(world):
    reform = Reform(
        id="surcharge",
        name="Surcharge",
        simulation_modifier=raise_additional_dwelling_rates,
    )
    assert generated_limits(world, reform, built(world)) == [SURCHARGE]


def test_generation_records_a_limited_input_read_while_the_measure_is_built(
    world,
):
    """Review of #51 round 17: a bindable modifier set SDLT as an input,
    priced on purchases it read while its simulation was built, and the
    receipt recorded no limit. Generation watches the build."""
    reform = Reform(
        id="captured",
        name="Captured",
        simulation_modifier=sdlt_from_purchases_read_at_build,
    )
    assert generated_limits(world, reform, built(world)) == [
        record(
            BY_KEY["non_residential_purchases"],
            ["build:non_residential_property_purchased"],
        )
    ]


def test_generation_records_nothing_for_a_change_to_the_current_value(world):
    """Review of #51: the scenarios declare a change, but the built trees
    show it changes nothing, and the trees decide."""
    from policyengine_uk.system import system

    rate = system.parameters.get_child(SURCHARGE_RATE)
    current = rate("2027-06-01")
    assert rate("2027-01-01") == current == rate("2028-12-31")
    reform = Reform(
        id="same",
        name="Same",
        parameter_changes={SURCHARGE_RATE: {"2027": current}},
    )
    assert generated_limits(world, reform, built(world)) == []


def test_generation_records_nothing_for_an_unrelated_measure(world):
    reform = Reform(
        id="alpha",
        name="Alpha",
        parameter_changes={
            "gov.hmrc.income_tax.rates.uk[0].rate": {"2027": 0.21}
        },
    )
    assert generated_limits(world, reform, built(world)) == []
