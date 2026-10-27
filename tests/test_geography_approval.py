"""Area runs select only the national publication manifest's approvals.

The starting entries are staged and approved through the real publication
gates, with certified receipts over World's dummy dataset. No area dataset
is downloaded or simulated here.
"""

from pathlib import Path
from types import SimpleNamespace

import h5py
import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from tests.publication_support import World
from uk_budget_data import geography as g
from uk_budget_data import model_limits
from uk_budget_data.cli import main, parse_args
from uk_budget_data.data_limits import DATA_LIMITS, record
from uk_budget_data.models import DataConfig, Reform
from uk_budget_data.private_outputs import AUDIT_DIR_ENV
from uk_budget_data.publication import manifest as m
from uk_budget_data.publication.artifacts import read_receipt
from uk_budget_data.publication.combine import combined_key
from uk_budget_data.publication.publish import approve, stage, withdraw

# A data limit in force: the PIP points thresholds (the purchase limits
# these tests first used lifted at the a6299504 cut).
PIP_POINTS = next(
    limit for limit in DATA_LIMITS if limit.key == "pip_daily_living_points"
)
PIP_THRESHOLD = "gov.dwp.pip.daily_living.points_thresholds.enhanced"

PACKAGE = "pkg_alpha_beta"
MEMBERS = ("beta", "alpha")
STATUSES = (
    m.APPROVED,
    m.STAGED,
    m.PROVISIONAL,
    m.STALE,
    m.WITHDRAWN,
    m.NOT_COMPUTABLE,
)
NOTHING_APPROVED = "nothing the national page may publish yet"


@pytest.fixture(scope="module")
def publication():
    """A real manifest with approved, held and combined artifacts."""
    world = World()
    try:
        manifest = m.Manifest()
        args = dict(data_root=world.data_root, inputs=world.inputs)
        references = {}
        for index, key in enumerate(
            ("beta", "alpha", "staged", "provisional", "withdrawn")
        ):
            references[key] = world.ready(
                key, {2027: -1.0 - index}, rate=0.21 + index * 0.01
            )
            stage(
                manifest,
                references[key].path,
                provisional=key == "provisional",
                **args,
            )
            if key in ("beta", "alpha"):
                approve(manifest, key, "Reviewer", **args)
        withdraw(manifest, "withdrawn", "The measure has been withdrawn")
        # Staleness records a later change to the execution or basis. The
        # selector reads that status, without rerunning publication gates.
        manifest.measures["stale"] = manifest.measures["staged"].model_copy(
            update={"status": m.STALE, "reason": "The execution changed"}
        )

        limit = record(PIP_POINTS, [PIP_THRESHOLD])
        limited = world.write(
            "not_computable", {2027: 0.0}, rate=0.27, data_limits=[limit]
        )
        stage(manifest, limited.path, **args)
        model_limit = model_limits.record(
            next(
                limit
                for limit in model_limits.MODEL_LIMITS
                if limit.key == "pc_minimum_guarantee_uprating"
            ),
            [
                "gov.dwp.pension_credit.guarantee_credit.minimum_guarantee"
                ".SINGLE"
            ],
        )
        model_limited = world.ready(
            "model_limited",
            {2027: 0.9},
            rate=0.28,
            model_limits=[model_limit],
        )
        stage(manifest, model_limited.path, provisional=True, **args)

        records = []
        for key in sorted(MEMBERS):
            receipt = read_receipt(references[key].path)["execution_receipt"]
            records.append(
                {
                    "id": key,
                    "reform": receipt["reform"],
                    "baseline": receipt["baseline"],
                }
            )
        combined = world.write(
            combined_key(list(MEMBERS)),
            {2027: -3.0},
            members=records,
            measure_ids=sorted(MEMBERS),
            rate=0.3,
            member_outputs={
                key: manifest.measures[key].outputs_sha256 for key in MEMBERS
            },
        )
        world.reconcile(combined)
        stage(manifest, combined.path, **args)
        approve(manifest, combined_key(list(MEMBERS)), "Reviewer", **args)
        m.save_manifest(manifest, world.data_root)
        yield world, manifest
    finally:
        world.close()


def with_status(entry, status):
    """A valid status assignment over a real publication entry."""
    fields = entry.model_dump()
    fields.update(status=status, approval=None, data_limits=[], reason=None)
    if status == m.NOT_COMPUTABLE:
        fields.update(
            data_limits=[PIP_POINTS.key],
            reason="The certified dataset cannot cost this measure",
        )
    return m.Entry.model_validate(fields)


def test_default_is_approved_single_measures_in_manifest_order(publication):
    _, manifest = publication
    assert g.approved_reforms(manifest) == ["beta", "alpha"]


@pytest.mark.parametrize(
    ("key", "status"),
    [
        ("staged", "staged"),
        ("provisional", "provisional"),
        ("stale", "stale"),
        ("withdrawn", "withdrawn"),
        ("not_computable", "not computable"),
        ("absent", "absent from the manifest"),
    ],
)
def test_each_nonapproved_status_is_refused_and_named(
    publication, key, status
):
    _, manifest = publication
    with pytest.raises(ValueError) as raised:
        g.approved_reforms(manifest, ["alpha", key])
    assert key in str(raised.value)
    assert status in str(raised.value)


def test_all_refused_ids_are_reported_together(publication):
    _, manifest = publication
    requested = ["staged", "provisional", "withdrawn", "absent"]
    with pytest.raises(ValueError) as raised:
        g.approved_reforms(manifest, requested)
    assert all(key in str(raised.value) for key in requested)


def test_missing_manifest_is_refused_before_other_planning(tmp_path):
    parsed = parse_args(
        [
            "geography",
            "--manifest",
            str(tmp_path / "missing.json"),
            "--levels",
            "region",
        ]
    )
    with pytest.raises(ValueError, match=NOTHING_APPROVED):
        g._plan(parsed)


@pytest.mark.parametrize("requested", [None, ["alpha"]])
def test_empty_manifest_is_refused(requested):
    with pytest.raises(ValueError, match=NOTHING_APPROVED):
        g.approved_reforms(m.Manifest(), requested)


def test_a_manifest_without_approved_entries_is_refused(publication):
    _, manifest = publication
    held = manifest.model_copy(deep=True)
    held.measures = {"provisional": held.measures["provisional"]}
    held.combined = {}
    with pytest.raises(ValueError, match=NOTHING_APPROVED):
        g.approved_reforms(held)


def test_model_limited_provisional_measure_is_refused(publication):
    _, manifest = publication
    assert manifest.measures["model_limited"].status == m.PROVISIONAL
    with pytest.raises(ValueError) as raised:
        g.approved_reforms(manifest, ["model_limited"])
    assert "model_limited" in str(raised.value)
    assert "provisional" in str(raised.value)


@pytest.fixture
def package(monkeypatch):
    monkeypatch.setattr(g, "PACKAGES", {PACKAGE: MEMBERS})


def test_package_uses_approved_combined_key(publication, package):
    _, manifest = publication
    assert g.approved_reforms(manifest, [PACKAGE]) == [PACKAGE]
    assert g.approved_reforms(manifest) == ["beta", "alpha", PACKAGE]


@pytest.mark.parametrize("status", STATUSES[1:])
def test_package_refuses_each_unapproved_combined_status(
    publication, package, status
):
    _, original = publication
    manifest = original.model_copy(deep=True)
    key = combined_key(list(MEMBERS))
    manifest.combined[key] = with_status(manifest.combined[key], status)
    assert g.approved_reforms(manifest) == ["beta", "alpha"]
    with pytest.raises(ValueError) as raised:
        g.approved_reforms(manifest, [PACKAGE])
    assert PACKAGE in str(raised.value)
    assert status.replace("_", " ") in str(raised.value)


def test_package_alias_approval_cannot_replace_combined_approval(
    publication, package
):
    _, original = publication
    manifest = original.model_copy(deep=True)
    manifest.measures[PACKAGE] = manifest.measures["alpha"].model_copy()
    manifest.combined = {}
    assert g.approved_reforms(manifest) == ["beta", "alpha"]
    with pytest.raises(ValueError) as raised:
        g.approved_reforms(manifest, [PACKAGE])
    assert PACKAGE in str(raised.value)
    assert "absent from the manifest" in str(raised.value)


def test_package_combined_entry_must_name_exact_members(publication, package):
    _, original = publication
    manifest = original.model_copy(deep=True)
    key = combined_key(list(MEMBERS))
    manifest.combined[key].measures = ["alpha", "another_measure"]
    assert g.approved_reforms(manifest) == ["beta", "alpha"]
    with pytest.raises(ValueError) as raised:
        g.approved_reforms(manifest, [PACKAGE])
    assert PACKAGE in str(raised.value)


@pytest.mark.parametrize("status", STATUSES[1:])
def test_a_package_needs_each_member_approved(publication, package, status):
    """Combined approval cannot authorise a member the page withholds."""
    _, original = publication
    manifest = original.model_copy(deep=True)
    manifest.measures["alpha"] = with_status(
        manifest.measures["alpha"], status
    )
    assert g.approved_reforms(manifest) == ["beta"]
    with pytest.raises(ValueError) as raised:
        g.approved_reforms(manifest, [PACKAGE])
    assert "alpha" in str(raised.value)
    assert status.replace("_", " ") in str(raised.value)


@pytest.fixture
def package_plan(publication, package, tmp_path, monkeypatch):
    """Plan approved package runs without loading survey data."""
    _, manifest = publication
    inputs = Path(__file__).resolve().parents[1] / "data_inputs"
    (tmp_path / g.SEAT_WEIGHTS_FILE).touch()
    (tmp_path / g.SEATS_FILE).write_bytes((inputs / g.SEATS_FILE).read_bytes())
    monkeypatch.setattr(
        g,
        "_bundle_dataset",
        lambda: (
            "enhanced_frs_2024_25",
            "policyengine/policyengine-uk-data-private",
        ),
    )
    reforms = {key: Reform(id=key, name=key) for key in (*MEMBERS, PACKAGE)}
    monkeypatch.setattr(g, "get_reform", reforms.get)

    def plan(chosen_manifest=manifest, *arguments):
        path = tmp_path / "publication.json"
        path.write_text(chosen_manifest.model_dump_json(by_alias=True))
        return g._plan(
            parse_args(
                [
                    "geography",
                    "--manifest",
                    str(path),
                    "--years",
                    "2027",
                    "--data-dir",
                    str(tmp_path),
                    "--data-inputs-dir",
                    str(inputs),
                    *arguments,
                ]
            )
        )

    return plan


def test_default_includes_approved_package_and_publishes_only_it_by_seat(
    package_plan,
):
    plan = package_plan()
    assert [reform.id for reform in plan.reforms] == ["beta", "alpha", PACKAGE]
    assert plan.packages == {PACKAGE: MEMBERS}
    assert plan.seat_reforms == [PACKAGE]


def test_constituencies_without_a_package_require_explicit_seat_reforms(
    publication, package_plan
):
    _, original = publication
    manifest = original.model_copy(deep=True)
    manifest.combined = {}
    with pytest.raises(
        ValueError, match="No approved package.*--seat-reforms"
    ):
        package_plan(manifest)
    plan = package_plan(manifest, "--seat-reforms", "alpha")
    assert plan.seat_reforms == ["alpha"]
    assert plan.packages == {}


@pytest.mark.parametrize("alias_body", ["parameters", "modifier"])
def test_package_simulates_the_approved_composition(
    package_plan, monkeypatch, alias_body
):
    """A divergent registered alias never supplies either simulated side."""
    events = []

    def modifier(label):
        def apply(sim):
            events.append(label)
            return sim

        return apply

    reforms = {
        "alpha": Reform(
            id="alpha",
            name="Alpha",
            parameter_changes={"alpha.reform": {"2027": 1}},
            baseline_parameter_changes={"alpha.baseline": {"2027": 2}},
            simulation_modifier=modifier("alpha reform"),
            baseline_simulation_modifier=modifier("alpha baseline"),
        ),
        "beta": Reform(
            id="beta",
            name="Beta",
            parameter_changes={"beta.reform": {"2027": 3}},
            simulation_modifier=modifier("beta reform"),
        ),
    }
    alias = Reform(
        id=PACKAGE,
        name="Outdated package",
        parameter_changes=(
            {"outdated.reform": {"2027": 99}}
            if alias_body == "parameters"
            else None
        ),
        baseline_parameter_changes={"outdated.baseline": {"2027": 99}},
        simulation_modifier=(
            modifier("outdated reform") if alias_body == "modifier" else None
        ),
        baseline_simulation_modifier=modifier("outdated baseline"),
    )
    reforms[PACKAGE] = alias
    config = DataConfig(
        years=[2027], baseline_parameter_changes={"configured": {"2027": 4}}
    )
    monkeypatch.setattr(g, "DataConfig", lambda **kwargs: config)
    monkeypatch.setattr(g, "get_reform", reforms.get)
    plan = package_plan()
    checks = []
    monkeypatch.setattr(
        g.combine,
        "check_consistency",
        lambda combined, members, checked_config, years: checks.append(
            (combined, members, checked_config, years)
        ),
    )
    builds = []

    def build(dataset, scenario=None):
        builds.append((dataset, scenario))
        if scenario.simulation_modifier is not None:
            scenario.simulation_modifier(None)
        return SimpleNamespace()

    monkeypatch.setattr(g, "build_microsimulation", build)
    package = next(reform for reform in plan.reforms if reform.id == PACKAGE)
    assert package is alias
    g.simulate_reform(package, "approved.h5", plan.years)
    assert [dataset for dataset, _ in builds] == ["approved.h5"] * 2
    assert builds[0][1].parameter_changes == {
        "alpha.baseline": {"2027": 2},
        "configured": {"2027": 4},
    }
    assert builds[1][1].parameter_changes == {
        "alpha.reform": {"2027": 1},
        "beta.reform": {"2027": 3},
    }
    assert events == ["alpha baseline", "alpha reform", "beta reform"]
    assert len(checks) == 1
    combined, members, checked_config, years = checks[0]
    assert combined.id == combined_key(list(MEMBERS))
    assert [member.id for member in members] == ["alpha", "beta"]
    assert checked_config is config
    assert years == [2027]


def test_empty_custom_package_baselines_do_not_use_the_configured_baseline(
    package, monkeypatch
):
    """All-custom empty baselines stay current law, as in the generator."""
    reforms = {
        key: Reform(id=key, name=key, baseline_parameter_changes={})
        for key in MEMBERS
    }
    monkeypatch.setattr(g, "get_reform", reforms.get)
    config = DataConfig(
        years=[2027], baseline_parameter_changes={"configured": {"2027": 4}}
    )
    monkeypatch.setattr(g, "DataConfig", lambda **kwargs: config)
    monkeypatch.setattr(g.combine, "check_consistency", lambda *args: None)
    builds = []
    monkeypatch.setattr(
        g,
        "build_microsimulation",
        lambda dataset, scenario=None: builds.append(scenario),
    )
    g.simulate_reform(Reform(id=PACKAGE, name=PACKAGE), None, [2027])
    assert builds[0] is None


def test_refused_microcosm_command_has_banners_and_builds_nothing(
    publication, tmp_path, monkeypatch, capsys
):
    """A publication refusal still tells readers the dataset is uncertified."""
    _, manifest = publication
    path = tmp_path / "publication.json"
    path.write_text(manifest.model_dump_json(by_alias=True))
    local = tmp_path / "local.h5"
    with h5py.File(local, "w") as handle:
        handle.attrs[g.MICROCOSM_EXPORT_ATTRIBUTE] = "household"
    out = tmp_path / "out"
    audit = tmp_path / "audit"
    monkeypatch.setenv(AUDIT_DIR_ENV, str(audit))
    builds = []

    def build(*args, **kwargs):
        builds.append((args, kwargs))
        pytest.fail("A refused publication must not build a simulation")

    monkeypatch.setattr(g, "build_microsimulation", build)
    code = main(
        [
            "geography",
            "--manifest",
            str(path),
            "--dataset-kind",
            "microcosm",
            "--dataset",
            str(local),
            "--reforms",
            "provisional",
            "--levels",
            "region",
            "--out-dir",
            str(out),
        ]
    )
    printed = " ".join(capsys.readouterr().out.split())
    assert code == 1
    assert "provisional: provisional" in printed
    assert printed.startswith(g.MICROCOSM_UNCERTIFIED)
    assert printed.endswith(g.MICROCOSM_UNCERTIFIED)
    assert printed.count(g.MICROCOSM_UNCERTIFIED) == 2
    assert builds == []
    assert not out.exists()
    assert not list(audit.rglob("summary.json"))


def test_seat_reforms_requires_approved_combined_entry(
    publication, package, tmp_path
):
    """An approved member cannot authorise an unapproved seat package."""
    _, original = publication
    manifest = original.model_copy(deep=True)
    manifest.combined = {}
    path = tmp_path / "publication.json"
    path.write_text(manifest.model_dump_json(by_alias=True))
    parsed = parse_args(
        [
            "geography",
            "--manifest",
            str(path),
            "--reforms",
            "alpha",
            "beta",
            "--seat-reforms",
            PACKAGE,
        ]
    )
    with pytest.raises(ValueError) as raised:
        g._plan(parsed)
    assert PACKAGE in str(raised.value)
    assert "absent from the manifest" in str(raised.value)


@settings(max_examples=80, deadline=None)
@given(
    statuses=st.lists(st.sampled_from(STATUSES), min_size=3, max_size=3),
    requested=st.one_of(
        st.none(),
        st.lists(st.sampled_from(("beta", "alpha", "third")), min_size=1),
    ),
)
def test_selection_never_simulates_an_unapproved_id(
    publication, statuses, requested
):
    """Every status assignment preserves exactly the approved selection."""
    world, original = publication
    manifest = original.model_copy(deep=True)
    keys = ("beta", "alpha", "third")
    manifest.measures = {
        key: with_status(original.measures["alpha"], status)
        for key, status in zip(keys, statuses)
    }
    manifest.combined = {}
    approved = [
        key for key, status in zip(keys, statuses) if status == m.APPROVED
    ]
    chosen = list(dict.fromkeys(requested)) if requested else approved
    refused = [key for key in chosen if key not in approved]
    path = world.root / "geography-manifest.json"
    path.write_text(manifest.model_dump_json(by_alias=True))
    arguments = ["geography", "--manifest", str(path), "--levels", "region"]
    if requested is not None:
        arguments.extend(["--reforms", *requested])
    with pytest.MonkeyPatch.context() as patch:
        patch.setattr(
            g,
            "_bundle_dataset",
            lambda: (
                "enhanced_frs_2024_25",
                "policyengine/policyengine-uk-data-private",
            ),
        )
        patch.setattr(g, "get_reform", lambda key: SimpleNamespace(id=key))
        if not approved or refused:
            with pytest.raises(ValueError) as raised:
                g._plan(parse_args(arguments))
            if approved:
                for key in refused:
                    assert key in str(raised.value)
                    assert manifest.measures[key].status.replace(
                        "_", " "
                    ) in str(raised.value)
        else:
            plan = g._plan(parse_args(arguments))
            assert [reform.id for reform in plan.reforms] == chosen


def test_area_provenance_records_the_approved_artifact_and_scenarios(
    publication,
):
    from unittest.mock import patch

    from tests.publication_support import RATE_PATH
    from uk_budget_data.publication.release_index import identity_core

    world, manifest = publication
    definition = Reform(
        id="alpha",
        name="Alpha",
        parameter_changes={RATE_PATH: {"2027": 0.22}},
    )
    with (
        patch.object(g, "get_reform", lambda key: definition),
        patch.object(g.publication_receipt, "code_revision", world.revision),
    ):
        provenance = g.area_provenance(
            manifest,
            manifest.model_dump_json(by_alias=True).encode(),
            ["alpha"],
            data_root=world.data_root,
            years=[2027],
        )
    entry = manifest.measures["alpha"]
    record = provenance["reforms"]["alpha"]
    receipt = read_receipt(world.data_root / entry.artifact)
    assert record["artifact"] == entry.artifact
    for field in (
        "artifact_sha256",
        "receipt_sha256",
        "outputs_sha256",
        "execution_identity_sha256",
    ):
        assert record[field] == getattr(entry, field)
    for side in ("baseline", "reform"):
        assert record[side] == identity_core(
            receipt["execution_receipt"][side]
        )


@given(
    side=st.sampled_from(["baseline", "reform"]),
    rate=st.integers(min_value=1, max_value=99).filter(
        lambda value: value != 22
    ),
)
@settings(max_examples=20, deadline=None)
def test_changed_area_definition_is_refused_before_simulation(
    publication, side, rate
):
    """Changing current parameters cannot borrow an earlier approval."""
    from unittest.mock import Mock, patch

    from tests.publication_support import RATE_PATH

    world, manifest = publication
    definition = Reform(
        id="alpha",
        name="Alpha",
        parameter_changes={
            RATE_PATH: {"2027": rate / 100 if side == "reform" else 0.22}
        },
        baseline_parameter_changes=(
            {RATE_PATH: {"2027": rate / 100}} if side == "baseline" else None
        ),
    )
    simulate = Mock(side_effect=AssertionError("simulation must not start"))
    with (
        patch.object(g, "get_reform", lambda key: definition),
        patch.object(g.publication_receipt, "code_revision", world.revision),
        patch.object(g, "simulate_reform", simulate),
    ):
        with pytest.raises(
            ValueError, match=f"current {side} identity differs"
        ):
            g.area_provenance(
                manifest,
                manifest.model_dump_json(by_alias=True).encode(),
                ["alpha"],
                data_root=world.data_root,
                years=[2027],
            )
    simulate.assert_not_called()


def test_area_command_refuses_a_changed_definition_before_building(
    publication,
):
    import os
    from unittest.mock import Mock, patch

    from tests.publication_support import RATE_PATH

    world, manifest = publication
    definition = Reform(
        id="alpha",
        name="Alpha",
        parameter_changes={RATE_PATH: {"2027": 0.35}},
    )
    plan = SimpleNamespace(
        manifest=manifest,
        manifest_bytes=manifest.model_dump_json(by_alias=True).encode(),
        reforms=[definition],
        years=[2027],
        provenance=None,
    )
    parsed = SimpleNamespace(
        manifest=world.data_root / "manifest.json",
        dataset_kind="efrs",
    )
    simulate = Mock(side_effect=AssertionError("simulation must not start"))
    with (
        patch.dict(os.environ, {AUDIT_DIR_ENV: str(world.root / "private")}),
        patch.object(g, "_plan", lambda parsed: plan),
        patch.object(g, "get_reform", lambda key: definition),
        patch.object(g.publication_receipt, "code_revision", world.revision),
        patch.object(g, "simulate_reform", simulate),
    ):
        assert g._run_geography(parsed, certification_reason=None) == 1
    simulate.assert_not_called()


# -- the registered package: the seven kept measures (27 October 2026) ------


def _seven_manifest(combined_key_, members):
    from uk_budget_data.reforms import AUTUMN_BUDGET_2026_COMBINED_COMPONENTS

    seven = sorted(AUTUMN_BUDGET_2026_COMBINED_COMPONENTS)
    return SimpleNamespace(
        measures={i: SimpleNamespace(status=m.APPROVED) for i in seven},
        combined={
            combined_key_: SimpleNamespace(status=m.APPROVED, measures=members)
        },
    )


def test_the_area_run_takes_the_seven_package_under_its_key():
    from uk_budget_data.reforms import (
        AUTUMN_BUDGET_2026_COMBINED_COMPONENTS,
        AUTUMN_BUDGET_2026_COMBINED_ID,
    )

    seven = sorted(AUTUMN_BUDGET_2026_COMBINED_COMPONENTS)
    key = "combined--5c77771791661e11"
    assert g.manifest_key(AUTUMN_BUDGET_2026_COMBINED_ID) == key
    manifest = _seven_manifest(key, seven)
    package = [AUTUMN_BUDGET_2026_COMBINED_ID]
    assert g.approved_reforms(manifest, package) == package
    assert g.approved_reforms(manifest)[-1] == AUTUMN_BUDGET_2026_COMBINED_ID


def test_the_area_run_refuses_the_withdrawn_nine_measure_package():
    from uk_budget_data.reforms import (
        AUTUMN_BUDGET_2026_COMBINED_COMPONENTS,
        AUTUMN_BUDGET_2026_COMBINED_ID,
    )

    nine = sorted(
        [
            *AUTUMN_BUDGET_2026_COMBINED_COMPONENTS,
            "badr_lifetime_limit_cut",
            "employer_ni_relief_under_25s",
        ]
    )
    manifest = _seven_manifest(combined_key(nine), nine)
    assert AUTUMN_BUDGET_2026_COMBINED_ID not in g.approved_reforms(manifest)
    with pytest.raises(ValueError, match="combined--5c77771791661e11"):
        g.approved_reforms(manifest, [AUTUMN_BUDGET_2026_COMBINED_ID])
