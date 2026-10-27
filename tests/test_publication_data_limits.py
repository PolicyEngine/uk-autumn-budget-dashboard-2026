"""A measure the certified data cannot cost is never published as a figure.

It is staged only as ``not_computable``, listed with its reason; every level
that would show a figure refuses it, approval refuses it, and the checks the
page and the briefing exports rely on keep it that way.
"""

import itertools
import json
import shutil

import pytest
from policyengine_uk import Simulation
from pydantic import ValidationError

from tests.data_limit_stand_ins import STAND_IN_DATA_LIMITS
from tests.fixed_shape_measures import (
    raise_additional_dwelling_rates,
    sdlt_from_purchases_read_at_build,
)
from tests.publication_support import World, make_household_rows, make_tables
from tests.purchase_helpers import RAISED_SURCHARGE
from uk_budget_data.data_limits import record
from uk_budget_data.models import DataConfig, Reform, ReformResult
from uk_budget_data.publication import generate as generate_module
from uk_budget_data.publication import manifest as m
from uk_budget_data.publication.artifacts import (
    ArtifactError,
    read_receipt,
    write_artifact,
)
from uk_budget_data.publication.generate import generate_artifacts
from uk_budget_data.publication.publish import (
    PublishError,
    _name_problems,
    approve,
    check,
    gate_problems,
    stage,
)
from uk_budget_data.publication.receipt import (
    artifact_sha256,
    dashboard_problems,
    receipt_api,
)
from uk_budget_data.publication.reconcile import (
    ReconciliationInputError,
    reconcile_artifact,
)
from uk_budget_data.publication.tables import canonical_csv

SURCHARGE_RATE = (
    "gov.hmrc.stamp_duty.residential.purchase.additional.rate[1].rate"
)
NON_RESIDENTIAL_RATE = "gov.hmrc.stamp_duty.non_residential.purchase[1].rate"
BY_KEY = {limit.key: limit for limit in STAND_IN_DATA_LIMITS}

# Written around the purchase limits, registered as stand-ins.
pytestmark = pytest.mark.usefixtures("stand_in_data_limits")

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


# Every non-empty set of limits, at every level that shows a figure: as
# generation writes it (its receipt alone), and as it was written before
# not-computable artifacts became receipt-only, holding a figure that only
# looks plausible (what the engine gave before policyengine-uk #2241).
LIMIT_SETS = [[SURCHARGE], [NON_RESIDENTIAL], [SURCHARGE, NON_RESIDENTIAL]]


@pytest.mark.parametrize(
    "limits, level, with_tables",
    list(
        itertools.product(
            LIMIT_SETS,
            [m.STAGED, m.PROVISIONAL, m.APPROVED],
            [False, True],
        )
    ),
)
def test_no_level_that_shows_a_figure_accepts_a_data_limited_artifact(
    world, limits, level, with_tables
):
    world.costing("alpha", VALUES)
    world.expect("alpha", "negative", 2027)
    reference = world.write(
        "alpha", VALUES, data_limits=limits, with_tables=with_tables
    )
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
    # The same measure, now recorded as touching a data limit: its
    # artifact is its receipt alone.
    staged(world, manifest, "alpha", VALUES, [SURCHARGE])
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


def test_restaging_another_not_computable_artifact_stales_its_combined_run(
    world,
):
    """Every receipt-only artifact has the outputs digest of no files, so
    unchanged outputs and limits do not make a restage unchanged: another
    artifact (here a different rate) stales the combined runs using it."""
    manifest = m.Manifest()
    first = staged(world, manifest, "alpha", ZERO, [SURCHARGE])
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
    second = world.write("alpha", ZERO, data_limits=[SURCHARGE], rate=0.3)
    assert second.outputs_sha256 == first.outputs_sha256
    assert second.artifact_sha256 != first.artifact_sha256
    stage(
        manifest,
        second.path,
        data_root=world.data_root,
        inputs=world.inputs,
    )
    entry = manifest.combined["combined--alpha+beta"]
    assert entry.status == m.STALE
    assert entry.reason == "member alpha changed"


# --- generation records the limits ------------------------------------------


def fake_process(values):
    def process(reform, config, baseline, reformed, baseline_scenario):
        tables = make_tables(reform.id, values, reform.name)
        tables.pop("household_scatter_binned")
        return ReformResult(
            household_scatter=make_household_rows(
                reform.id, values, reform.name
            ),
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
    """Stand-ins carrying a real parameter tree and input holders, built with
    the scenario, so generation compares them as it does on a real run."""

    def build(dataset, scenario=None):
        sim = world.sim()
        underlying = Simulation(situation=household(), scenario=scenario)
        sim.tax_benefit_system = underlying.tax_benefit_system
        sim.get_holder = underlying.get_holder
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
        parameter_changes={
            SURCHARGE_RATE: {
                "2027": RAISED_SURCHARGE,
                "2028": RAISED_SURCHARGE,
            }
        },
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
            [
                "build:non_residential_property_purchased",
                "input:sdlt_on_non_residential_property_transactions",
            ],
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


# --- a not-computable artifact is its receipt alone ------------------------


def table_vocabulary() -> set[str]:
    """Every table file name and column name an artifact's tables use."""
    from uk_budget_data.publication.tables import TABLES

    return {spec.filename for spec in TABLES.values()} | {
        column for spec in TABLES.values() for column, _ in spec.columns
    }


def words(value) -> set[str]:
    """Every key and string value anywhere in a JSON document."""
    if isinstance(value, dict):
        return set(value) | {w for item in value.values() for w in words(item)}
    if isinstance(value, list):
        return {w for item in value for w in words(item)}
    return {value} if isinstance(value, str) else set()


def test_generation_writes_only_the_receipt_of_a_data_limited_measure(world):
    """The measure is still processed (its limits are observed while it
    runs), but nothing it computed is written: no table, and no figure
    field in its receipt."""
    processed = []

    def process(reform, config, baseline, reformed, baseline_scenario):
        processed.append(reform.id)
        return fake_process(VALUES)(
            reform, config, baseline, reformed, baseline_scenario
        )

    reform = Reform(
        id="surcharge",
        name="Higher rates surcharge",
        parameter_changes={
            SURCHARGE_RATE: {
                "2027": RAISED_SURCHARGE,
                "2028": RAISED_SURCHARGE,
            }
        },
    )
    report = generate_artifacts(
        [reform],
        DataConfig(years=YEARS),
        artifacts_root=world.artifacts,
        generator_argv=["test"],
        build=lambda dataset, scenario=None: world.sim(),
        process=process,
    )
    assert not report.refused, report.refused
    assert processed == ["surcharge"]
    path = report.written[0].path
    assert sorted(p.name for p in path.iterdir()) == ["receipt.json"]
    document = read_receipt(path)
    api, _ = receipt_api()
    assert document["dashboard"]["files"] == {}
    assert document["dashboard"]["data_limits"] == [SURCHARGE]
    assert document["dashboard"]["name"] == "Higher rates surcharge"
    assert document["execution_receipt"]["outputs_sha256"] == (
        api.content_sha256({})
    )
    assert words(document) & table_vocabulary() == set()


def test_a_combined_run_with_a_data_limited_member_is_written_receipt_only(
    world,
):
    members = [
        Reform(
            id="alpha",
            name="Alpha",
            parameter_changes={SURCHARGE_RATE: {"2027": RAISED_SURCHARGE}},
        ),
        Reform(
            id="beta",
            name="Beta",
            parameter_changes={
                "gov.hmrc.income_tax.rates.uk[0].rate": {"2027": 0.21}
            },
        ),
    ]
    report = generate_artifacts(
        [],
        DataConfig(years=YEARS),
        combined_sets=[members],
        artifacts_root=world.artifacts,
        generator_argv=["test"],
        build=lambda dataset, scenario=None: world.sim(),
        process=fake_process(VALUES),
    )
    assert not report.refused, report.refused
    path = report.written[0].path
    assert sorted(p.name for p in path.iterdir()) == ["receipt.json"]
    dashboard = read_receipt(path)["dashboard"]
    assert dashboard["files"] == {}
    assert dashboard["name"] == "Combined: Alpha, Beta"


def test_write_artifact_never_writes_tables_for_a_data_limited_receipt(world):
    with pytest.raises(ArtifactError, match="write it receipt-only"):
        write_artifact(
            make_tables("alpha", ZERO),
            "alpha",
            lambda digests: limited_receipt(world, digests),
            world.artifacts,
        )
    with pytest.raises(ArtifactError, match="without its tables"):
        world.write("alpha", VALUES, with_tables=False)
    assert not world.artifacts.exists() or not any(world.artifacts.iterdir())


def limited_receipt(world, digests):
    """A data-limited receipt listing ``digests``, as a generator that
    wrote a not-computable measure's tables would."""
    reference = world.write("scratch", ZERO, data_limits=[SURCHARGE])
    document = read_receipt(reference.path)
    shutil.rmtree(reference.path.parent)
    document["dashboard"]["files"] = dict(sorted(digests.items()))
    return document


def stray_bytes(name: str) -> bytes:
    if not name.endswith(".csv"):
        return b"{}\n"
    rows = make_tables("alpha", ZERO)["budgetary_impact"]
    return canonical_csv("budgetary_impact", rows)


@pytest.mark.parametrize(
    "stray",
    ["budgetary_impact.csv", "reconciliation.json", "notes.csv", "notes"],
)
def test_anything_beside_a_not_computable_receipt_fails_check_and_stage(
    world, stray
):
    """A stray table, a reconciliation record, any other file or a
    directory: the artifact holds its receipt alone, so publish check and
    stage refuse it."""
    manifest = m.Manifest()
    reference = staged(world, manifest, "alpha", ZERO, [SURCHARGE])
    assert (
        check(manifest, data_root=world.data_root, inputs=world.inputs) == []
    )
    if stray == "notes":
        (reference.path / stray).mkdir()
    else:
        (reference.path / stray).write_bytes(stray_bytes(stray))
    failures = check(manifest, data_root=world.data_root, inputs=world.inputs)
    assert failures and all(stray in f for f in failures), failures
    with pytest.raises(PublishError) as refused:
        stage(
            m.Manifest(),
            reference.path,
            data_root=world.data_root,
            inputs=world.inputs,
        )
    assert any(stray in problem for problem in refused.value.problems)


def test_a_not_computable_artifact_written_with_its_tables_is_refused(world):
    """As generation wrote it before not-computable artifacts became
    receipt-only: its receipt binds figures, so no level accepts it."""
    reference = world.write(
        "alpha", ZERO, data_limits=[SURCHARGE], with_tables=True
    )
    with pytest.raises(PublishError) as refused:
        stage(
            m.Manifest(),
            reference.path,
            data_root=world.data_root,
            inputs=world.inputs,
        )
    assert (
        "its receipt lists files, but a not-computable artifact binds no "
        "figures" in refused.value.problems
    )


def test_a_not_computable_receipt_must_be_a_regular_file(world, tmp_path):
    manifest = m.Manifest()
    reference = staged(world, manifest, "alpha", ZERO, [SURCHARGE])
    receipt = reference.path / "receipt.json"
    outside = tmp_path / "receipt.json"
    shutil.copyfile(receipt, outside)
    receipt.unlink()
    receipt.symlink_to(outside)
    failures = check(manifest, data_root=world.data_root, inputs=world.inputs)
    assert "alpha: its receipt.json is not a regular file" in failures


def test_an_artifact_with_no_data_limit_must_list_its_files(world):
    reference = world.write("alpha", ZERO, data_limits=[SURCHARGE])
    document = read_receipt(reference.path)
    document["dashboard"]["data_limits"] = []
    path = world.artifacts / "alpha" / artifact_sha256(document)[:16]
    path.mkdir()
    (path / "receipt.json").write_text(
        json.dumps(document, indent=2, sort_keys=True) + "\n"
    )
    problems, _ = gate_problems(
        "alpha",
        path,
        m.Manifest(),
        level=m.STAGED,
        data_root=world.data_root,
        inputs=world.inputs,
    )
    assert (
        "its receipt lists no files, which only a not-computable artifact may"
        in problems
    )


# --- the name comes from the receipt, never the key ------------------------


def test_a_not_computable_entry_takes_its_name_from_its_receipt(world):
    manifest = m.Manifest()
    reference = world.write(
        "alpha", ZERO, data_limits=[SURCHARGE], name="Higher rates surcharge"
    )
    stage(
        manifest,
        reference.path,
        data_root=world.data_root,
        inputs=world.inputs,
    )
    assert manifest.measures["alpha"].name == "Higher rates surcharge"


@pytest.mark.parametrize("limits", [[], [SURCHARGE]])
def test_check_refuses_an_entry_whose_name_is_not_its_receipts(world, limits):
    manifest = m.Manifest()
    world.costing("alpha", VALUES)
    world.expect("alpha", "negative", 2027)
    reference = world.write("alpha", VALUES, data_limits=limits)
    stage(
        manifest,
        reference.path,
        data_root=world.data_root,
        inputs=world.inputs,
        provisional=True,
    )
    manifest.measures["alpha"].name = "alpha"
    failures = check(manifest, data_root=world.data_root, inputs=world.inputs)
    assert failures == ["alpha: the entry's name is not the artifact's"]


def test_tables_naming_the_measure_otherwise_than_its_receipt_are_refused(
    world,
):
    world.costing("alpha", VALUES)
    world.expect("alpha", "negative", 2027)
    reference = world.write(
        "alpha", VALUES, tables=make_tables("alpha", VALUES), name="Other"
    )
    with pytest.raises(PublishError) as refused:
        stage(
            m.Manifest(),
            reference.path,
            data_root=world.data_root,
            inputs=world.inputs,
            provisional=True,
        )
    assert any(
        problem.startswith(
            "its tables name it differently from its receipt: "
            "budgetary_impact"
        )
        for problem in refused.value.problems
    )


@pytest.mark.parametrize("limits", [[], [SURCHARGE]])
def test_a_receipt_recording_no_name_is_refused(world, limits):
    """Never the key in its place, with tables or without."""
    world.costing("alpha", VALUES)
    world.expect("alpha", "negative", 2027)
    reference = world.write("alpha", VALUES, data_limits=limits, name=" ")
    with pytest.raises(PublishError) as refused:
        stage(
            m.Manifest(),
            reference.path,
            data_root=world.data_root,
            inputs=world.inputs,
            provisional=True,
        )
    assert "its receipt records no name for the page to show" in (
        refused.value.problems
    )


def nameless(reference):
    """``reference``'s artifact as generated before receipts recorded the
    name: the same files, its receipt without ``dashboard.name``, in the
    directory its new digest names. Returns the path and the digest."""
    document = read_receipt(reference.path)
    del document["dashboard"]["name"]
    digest = artifact_sha256(document)
    path = reference.path.parent / digest[:16]
    shutil.copytree(reference.path, path)
    (path / "receipt.json").write_text(
        json.dumps(document, indent=2, sort_keys=True) + "\n"
    )
    return path, digest


@pytest.mark.parametrize("limits", [[], [SURCHARGE]])
def test_a_receipt_with_no_name_field_fails_stage_and_check(world, limits):
    """As every receipt written before receipts recorded the name: stage
    and publish check refuse it, never taking the key in its place."""
    manifest = m.Manifest()
    world.costing("alpha", VALUES)
    world.expect("alpha", "negative", 2027)
    reference = world.write("alpha", VALUES, data_limits=limits)
    stage(
        manifest,
        reference.path,
        data_root=world.data_root,
        inputs=world.inputs,
        provisional=True,
    )
    path, digest = nameless(reference)
    with pytest.raises(PublishError) as refused:
        stage(
            m.Manifest(),
            path,
            data_root=world.data_root,
            inputs=world.inputs,
            provisional=True,
        )
    assert "its receipt records no name for the page to show" in (
        refused.value.problems
    )
    entry = manifest.measures["alpha"]
    entry.artifact = path.relative_to(world.data_root).as_posix()
    entry.artifact_sha256 = digest
    failures = check(manifest, data_root=world.data_root, inputs=world.inputs)
    assert "alpha: its receipt records no name for the page to show" in (
        failures
    )
    assert "alpha: the entry's name is not the artifact's" in failures


def test_tables_with_no_reform_name_column_are_not_checked_for_the_name():
    """Only a table that carries the name can disagree with the receipt."""
    dashboard = {"name": "Alpha"}
    assert (
        _name_problems(dashboard, {"constituency": [{"reform_id": "a"}]}) == []
    )
    assert _name_problems(
        dashboard, {"metrics": [{"reform_name": "Other"}]}
    ) == ["its tables name it differently from its receipt: metrics"]


# --- reconciliation ----------------------------------------------------------


def test_publish_reconcile_skips_a_not_computable_artifact(world, capsys):
    from uk_budget_data.cli import main

    reference = world.write("alpha", ZERO, data_limits=[SURCHARGE])
    code = main(
        [
            "publish",
            "--data-root",
            str(world.data_root),
            "--inputs",
            str(world.inputs),
            "reconcile",
            str(reference.path),
        ]
    )
    assert code == 0
    assert capsys.readouterr().out.splitlines() == [
        "alpha: not computable on current data; nothing to reconcile"
    ]
    assert sorted(p.name for p in reference.path.iterdir()) == ["receipt.json"]
    with pytest.raises(ReconciliationInputError, match="nothing to"):
        reconcile_artifact(reference.path, world.inputs)
