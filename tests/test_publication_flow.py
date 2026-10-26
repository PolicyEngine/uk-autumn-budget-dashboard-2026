"""Tests for artifact generation, the publish commands and their invariants."""

import hashlib
from pathlib import Path

import hypothesis.strategies as st
import pytest
from hypothesis import settings
from hypothesis.stateful import (
    RuleBasedStateMachine,
    invariant,
    precondition,
    rule,
)

from tests.fixed_shape_measures import module_level_modifier
from tests.publication_support import (
    RATE_PATH,
    World,
    make_household_rows,
    make_tables,
)
from uk_budget_data.cli import main
from uk_budget_data.models import DataConfig, Reform, ReformResult
from uk_budget_data.publication import generate as generate_module
from uk_budget_data.publication import manifest as m
from uk_budget_data.publication.artifacts import read_receipt, read_tables
from uk_budget_data.publication.generate import generate_artifacts
from uk_budget_data.publication.publish import (
    PublishError,
    approve,
    check,
    stage,
    withdraw,
)

YEARS = [2027, 2028]


@pytest.fixture
def world(monkeypatch):
    instance = World()
    monkeypatch.setattr(
        generate_module, "code_revision", lambda root: instance.revision()
    )
    yield instance
    instance.close()


def reform(key: str, rate: float = 0.21, **extra) -> Reform:
    return Reform(
        id=key,
        name=key.title(),
        parameter_changes={RATE_PATH: {str(y): rate for y in YEARS}},
        **extra,
    )


def fake_process(values_by_key):
    def process(reform, config, baseline, reformed, baseline_scenario):
        tables = make_tables(reform.id, values_by_key[reform.id], reform.name)
        tables.pop("household_scatter_binned")
        return ReformResult(
            household_scatter=make_household_rows(
                reform.id, values_by_key[reform.id], reform.name
            ),
            reform_id=reform.id,
            reform_name=reform.name,
            constituency=[],
            demographic_constituency=[],
            **tables,
        )

    return process


def run_generate(world, reforms, values):
    return generate_artifacts(
        reforms,
        DataConfig(years=YEARS),
        artifacts_root=world.artifacts,
        generator_argv=["test"],
        build=lambda dataset, scenario=None: world.sim(),
        process=fake_process(values),
    )


def snapshot(directory: Path) -> dict[str, str]:
    return {
        str(path.relative_to(directory)): hashlib.sha256(
            path.read_bytes()
        ).hexdigest()
        for path in sorted(directory.rglob("*"))
        if path.is_file() and path.name != "reconciliation.json"
    }


# --- generation -----------------------------------------------------------


def test_each_measure_gets_its_own_receipted_artifact(world):
    values = {
        "alpha": {2027: -1.0, 2028: -2.0},
        "beta": {2027: 3.0, 2028: 4.0},
    }
    report = run_generate(
        world, [reform("alpha"), reform("beta", 0.22)], values
    )
    assert [r.key for r in report.written] == ["alpha", "beta"]
    assert report.refused == {}
    for reference in report.written:
        tables = read_tables(reference.path)
        assert {row["reform_id"] for row in tables["budgetary_impact"]} == {
            reference.key
        }
        document = read_receipt(reference.path)
        assert document["dashboard"]["measure_ids"] == [reference.key]
        assert document["dashboard"]["publishable"] is True
        assert document["execution_receipt"]["reform"]["kind"] == "reform"
        assert (
            document["execution_receipt"]["baseline"]["kind"] == "current_law"
        )
        assert document["execution_receipt"]["years"] == YEARS
    alpha, beta = (read_receipt(r.path) for r in report.written)
    assert (
        alpha["execution_receipt"]["reform"]["reform_sha256"]
        != beta["execution_receipt"]["reform"]["reform_sha256"]
    )


@pytest.mark.parametrize(
    "description", ["", "Alpha, as published.", "Zero-rated £\nsecond line"]
)
def test_generated_receipts_carry_the_registry_metadata(
    world, monkeypatch, description
):
    # The page names and describes each measure from its receipt (#104),
    # and staging copies the description and personal mapping from it, so a
    # generator that stops writing them fails nothing downstream: the
    # catalogue just shows its placeholder. Pin them where receipts are made.
    personal = {"key": "impact_alpha"}
    monkeypatch.setitem(
        generate_module.PUBLIC_PERSONAL_SERIES, "alpha", personal
    )
    values = {
        "alpha": {2027: -1.0, 2028: -2.0},
        "beta": {2027: 3.0, 2028: 4.0},
    }
    report = run_generate(
        world,
        [reform("alpha", description=description), reform("beta", 0.22)],
        values,
    )
    alpha, beta = (read_receipt(r.path) for r in report.written)
    assert alpha["dashboard"]["name"] == "Alpha"
    assert alpha["dashboard"]["description"] == description
    assert alpha["dashboard"]["personal"] == personal
    assert beta["dashboard"]["description"] == ""
    assert "personal" not in beta["dashboard"]


def test_a_single_measure_run_leaves_the_others_untouched(world):
    values = {
        "alpha": {2027: -1.0, 2028: -2.0},
        "beta": {2027: 3.0, 2028: 4.0},
    }
    run_generate(world, [reform("alpha"), reform("beta", 0.22)], values)
    before = snapshot(world.artifacts)
    values["beta"] = {2027: 3.5, 2028: 4.5}
    run_generate(world, [reform("beta", 0.22)], values)
    after = snapshot(world.artifacts)
    assert {k: v for k, v in after.items() if k in before} == before
    assert len(after) > len(before)


def test_an_unbindable_measure_is_refused_and_the_rest_still_written(world):
    def closure(sim):
        return sim

    values = {"alpha": {2027: -1.0, 2028: -2.0}, "bad": {2027: 1.0, 2028: 1.0}}
    report = run_generate(
        world,
        [
            Reform(id="bad", name="Bad", simulation_modifier=closure),
            reform("alpha"),
        ],
        values,
    )
    assert [r.key for r in report.written] == ["alpha"]
    assert "bad" in report.refused
    assert not (world.artifacts / "bad").exists()


def test_a_module_level_structural_measure_is_bound_by_code_revision(world):
    values = {"structural": {2027: -1.0, 2028: -2.0}}
    report = run_generate(
        world,
        [
            Reform(
                id="structural",
                name="Structural",
                simulation_modifier=module_level_modifier,
            )
        ],
        values,
    )
    reform_identity = read_receipt(report.written[0].path)[
        "execution_receipt"
    ]["reform"]
    assert reform_identity["binding"] == "code_revision"


def test_configured_baseline_is_recorded(world):
    config = DataConfig(
        years=YEARS,
        baseline_parameter_changes={RATE_PATH: {"2027": 0.2, "2028": 0.2}},
    )
    report = generate_artifacts(
        [reform("alpha")],
        config,
        artifacts_root=world.artifacts,
        generator_argv=["test"],
        build=lambda dataset, scenario=None: world.sim(),
        process=fake_process({"alpha": {2027: -1.0, 2028: -2.0}}),
    )
    document = read_receipt(report.written[0].path)
    assert document["dashboard"]["config_baseline"]["kind"] == "reform"
    assert document["execution_receipt"]["baseline"]["kind"] == "reform"


HIGHER_RATE_PATH = "gov.hmrc.income_tax.rates.uk[1].rate"


def test_a_combined_set_is_one_artifact_bound_to_its_members(world):
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
    report = generate_artifacts(
        [alpha, beta],
        DataConfig(years=YEARS),
        combined_sets=[[beta, alpha]],
        artifacts_root=world.artifacts,
        generator_argv=["test"],
        build=lambda dataset, scenario=None: world.sim(),
        process=fake_process(values),
    )
    assert report.refused == {}
    assert [r.key for r in report.written] == ["alpha", "beta", key]
    document = read_receipt(report.written[2].path)
    receipt = document["execution_receipt"]
    assert receipt["reform"]["representation"] == (
        "policyengine-uk.scenario_composition/v1"
    )
    assert receipt["baseline"]["kind"] == "current_law"
    assert document["dashboard"]["measure_ids"] == ["alpha", "beta"]
    members = document["dashboard"]["members"]
    assert [member["id"] for member in members] == ["alpha", "beta"]
    standalone = read_receipt(report.written[0].path)["execution_receipt"]
    assert members[0]["reform"]["reform_sha256"] == (
        standalone["reform"]["reform_sha256"]
    )

    # The whole flow: members approved, then the combined run.
    manifest = m.Manifest()
    arguments = dict(data_root=world.data_root, inputs=world.inputs)
    for reference in report.written[:2]:
        world.costing(reference.key, values[reference.key])
        world.reconcile(reference)
        stage(manifest, reference.path, **arguments)
        approve(manifest, reference.key, "María", **arguments)
    stage(manifest, report.written[2].path, **arguments)
    approve(manifest, key, "María", **arguments)
    assert manifest.combined[key].status == m.APPROVED
    assert check(manifest, **arguments) == []


def test_conflicting_members_are_refused_before_simulating(world):
    built = []

    def build(dataset, scenario=None):
        built.append(scenario)
        return world.sim()

    report = generate_artifacts(
        [],
        DataConfig(years=YEARS),
        combined_sets=[[reform("alpha", 0.21), reform("beta", 0.22)]],
        artifacts_root=world.artifacts,
        generator_argv=["test"],
        build=build,
        process=fake_process({}),
    )
    assert report.written == []
    assert "combined--alpha+beta" in report.refused
    assert built == []


# --- the publish commands -------------------------------------------------


def publish(world, *arguments) -> int:
    return main(
        [
            "publish",
            "--data-root",
            str(world.data_root),
            "--inputs",
            str(world.inputs),
            *arguments,
        ]
    )


def test_command_line_flow_from_artifact_to_published(world, capsys):
    values = {2027: -1.0, 2028: -2.0}
    world.costing("alpha", values)
    reference = world.write("alpha", values)
    path = str(reference.path)

    assert publish(world, "check") == 0
    assert "no manifest yet" in capsys.readouterr().out

    assert publish(world, "reconcile", path) == 0
    assert "reconciliation pass, responsiveness responsive" in (
        capsys.readouterr().out
    )
    assert publish(world, "stage", path) == 0
    assert publish(world, "approve", "alpha", "--by", "María") == 0
    assert publish(world, "check") == 0
    assert publish(world, "status") == 0
    output = capsys.readouterr().out
    assert "alpha: approved by María" in output
    assert "publication manifest passes every gate" in output

    manifest = m.load_manifest(world.data_root)
    assert manifest.revision == 2
    assert manifest.measures["alpha"].status == m.APPROVED

    assert publish(world, "withdraw", "alpha", "--reason", "Changed") == 0
    assert m.load_manifest(world.data_root).measures["alpha"].status == (
        m.WITHDRAWN
    )


def test_a_refused_operation_leaves_the_manifest_file_untouched(world, capsys):
    values = {2027: -1.0, 2028: -2.0}
    reference = world.ready("alpha", values)
    assert publish(world, "stage", str(reference.path)) == 0
    before = m.manifest_path(world.data_root).read_bytes()
    # Costing changes: reconciliation now fails, so approval is refused.
    world.costing("alpha", {2027: -9.0, 2028: -2.0})
    world.reconcile(reference)
    assert publish(world, "approve", "alpha", "--by", "María") == 1
    assert "reconciliation is failed" in capsys.readouterr().out
    assert m.manifest_path(world.data_root).read_bytes() == before


def test_check_fails_when_an_approved_entry_stops_passing(world, capsys):
    values = {2027: -1.0, 2028: -2.0}
    reference = world.ready("alpha", values)
    publish(world, "stage", str(reference.path))
    publish(world, "approve", "alpha", "--by", "María")
    (reference.path / "metrics.csv").write_text("tampered\n")
    capsys.readouterr()
    assert publish(world, "check") == 1
    assert "FAIL alpha: metrics.csv does not match" in capsys.readouterr().out


# --- invariants over arbitrary operation sequences ------------------------

MEASURES = ("alpha", "beta", "gamma")
# Fiscal impact variants: the costing is always -1.0 a year, so variants 0
# and 1 reconcile, 2 fails reconciliation, and 3 is inert.
VARIANTS = (-1.0, -1.05, -3.0, 0.0)
# Valid outputs are drawn more often, so sequences reach approved combined
# runs and then disturb them.
WEIGHTED_VARIANTS = (-1.0, -1.0, -1.05, -1.05, -3.0, 0.0)


class PublicationMachine(RuleBasedStateMachine):
    """Random generate, reconcile, stage, approve and withdraw sequences."""

    def __init__(self):
        super().__init__()
        self.world = World()
        self.manifest = m.Manifest()
        self.latest = {}
        self.frozen = {}
        for measure in MEASURES:
            self.world.costing(measure, {2027: -1.0, 2028: -1.0})

    def teardown(self):
        self.world.close()

    def _args(self):
        return dict(data_root=self.world.data_root, inputs=self.world.inputs)

    @rule(
        measure=st.sampled_from(MEASURES),
        variant=st.sampled_from(WEIGHTED_VARIANTS),
    )
    def generate(self, measure, variant):
        reference = self.world.write(measure, {2027: variant, 2028: variant})
        self.world.reconcile(reference)
        self.latest[measure] = reference
        self.frozen.update(snapshot(self.world.artifacts))

    @precondition(lambda self: self.latest)
    @rule(data=st.data(), provisional=st.booleans())
    def stage_measure(self, data, provisional):
        measure = data.draw(st.sampled_from(sorted(self.latest)))
        try:
            stage(
                self.manifest,
                self.latest[measure].path,
                provisional=provisional,
                **self._args(),
            )
        except PublishError:
            pass

    @precondition(lambda self: self.manifest.entries())
    @rule(data=st.data())
    def approve_entry(self, data):
        key = data.draw(st.sampled_from(sorted(self.manifest.entries())))
        try:
            approve(self.manifest, key, "Reviewer", **self._args())
        except PublishError:
            pass

    @precondition(lambda self: self.manifest.entries())
    @rule()
    def approve_everything_approvable(self):
        """Measures first, then combined runs, as on the day."""
        for group in (self.manifest.measures, self.manifest.combined):
            for key in sorted(group):
                try:
                    approve(self.manifest, key, "Reviewer", **self._args())
                except PublishError:
                    pass

    @precondition(lambda self: self.latest)
    @rule()
    def stage_everything_generated(self):
        for measure in sorted(self.latest):
            try:
                stage(self.manifest, self.latest[measure].path, **self._args())
            except PublishError:
                pass

    @precondition(lambda self: self.manifest.entries())
    @rule(data=st.data())
    def withdraw_entry(self, data):
        key = data.draw(st.sampled_from(sorted(self.manifest.entries())))
        withdraw(self.manifest, key, "test")

    @precondition(lambda self: len(self.latest) >= 2)
    @rule()
    def publish_the_package(self):
        """The day's happy path: members, then their combined run."""
        self.stage_everything_generated()
        self.approve_everything_approvable()
        approved = sorted(
            key
            for key, entry in self.manifest.measures.items()
            if entry.status == m.APPROVED
        )
        if len(approved) >= 2:
            self._stage_combined(approved)
            self.approve_everything_approvable()

    @precondition(lambda self: len(self.manifest.measures) >= 2)
    @rule(data=st.data())
    def stage_combined(self, data):
        self._stage_combined(
            sorted(
                data.draw(
                    st.sets(
                        st.sampled_from(sorted(self.manifest.measures)),
                        min_size=2,
                    )
                )
            )
        )

    def _stage_combined(self, members):
        records = []
        for member in members:
            receipt = read_receipt(
                self.world.data_root / self.manifest.measures[member].artifact
            )["execution_receipt"]
            records.append(
                {
                    "id": member,
                    "reform": receipt["reform"],
                    "baseline": receipt["baseline"],
                }
            )
        reference = self.world.write(
            "combined--" + "+".join(members),
            {2027: -2.0, 2028: -2.0},
            members=records,
            measure_ids=members,
        )
        self.frozen.update(snapshot(self.world.artifacts))
        try:
            stage(self.manifest, reference.path, **self._args())
        except PublishError:
            pass

    @invariant()
    def displayable_entries_pass_every_gate(self):
        assert check(self.manifest, **self._args()) == []

    @invariant()
    def approvals_name_the_current_outputs(self):
        for entry in self.manifest.entries().values():
            if entry.status == m.APPROVED:
                assert entry.approval.outputs_sha256 == entry.outputs_sha256
            else:
                assert entry.approval is None or entry.status == m.APPROVED

    @invariant()
    def no_displayable_measure_is_inert_or_failed(self):
        for entry in self.manifest.measures.values():
            if entry.status in m.DISPLAYABLE:
                assert (
                    entry.reconciliation.responsiveness_status == "responsive"
                )
            if entry.status == m.APPROVED:
                assert entry.reconciliation.summary_status in (
                    "pass",
                    "accepted",
                )

    @invariant()
    def displayable_combined_runs_match_their_members(self):
        for entry in self.manifest.combined.values():
            if entry.status not in m.DISPLAYABLE and entry.status != m.STAGED:
                continue
            for member in entry.measures:
                current = self.manifest.measures[member]
                assert current.outputs_sha256 == (
                    entry.member_outputs_sha256[member]
                )
                assert current.status not in (m.STALE, m.WITHDRAWN) or (
                    entry.status == m.STAGED
                )
            if entry.status == m.APPROVED:
                assert all(
                    self.manifest.measures[member].status == m.APPROVED
                    for member in entry.measures
                )

    @invariant()
    def one_execution_identity(self):
        if self.manifest.execution is None:
            return
        for entry in self.manifest.entries().values():
            if entry.status in m.DISPLAYABLE:
                assert entry.execution_identity_sha256 == (
                    self.manifest.execution.execution_identity_sha256
                )

    @invariant()
    def artifacts_are_never_changed(self):
        current = snapshot(self.world.artifacts)
        for name, digest in self.frozen.items():
            assert current.get(name) == digest


PublicationMachine.TestCase.settings = settings(
    max_examples=40, stateful_step_count=20, deadline=None
)
TestPublicationMachine = PublicationMachine.TestCase
