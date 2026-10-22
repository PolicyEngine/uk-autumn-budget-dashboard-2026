"""Area runs select only the national publication manifest's approvals.

The starting entries are staged and approved through the real publication
gates, with certified receipts over World's dummy dataset. No area dataset
is downloaded or simulated here.
"""

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
from uk_budget_data.private_outputs import AUDIT_DIR_ENV
from uk_budget_data.publication import manifest as m
from uk_budget_data.publication.artifacts import read_receipt
from uk_budget_data.publication.combine import combined_key
from uk_budget_data.publication.publish import approve, stage, withdraw

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

        limit = record(
            DATA_LIMITS[0],
            [
                "gov.hmrc.stamp_duty.residential.purchase.additional."
                "rate[1].rate"
            ],
        )
        limited = world.write(
            "not_computable", {2027: 0.0}, rate=0.27, data_limits=[limit]
        )
        stage(manifest, limited.path, **args)
        model_limit = model_limits.record(
            model_limits.MODEL_LIMITS[0],
            ["gov.dwp.state_pension.new_state_pension.amount"],
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
        yield world, manifest
    finally:
        world.close()


def with_status(entry, status):
    """A valid status assignment over a real publication entry."""
    fields = entry.model_dump()
    fields.update(status=status, approval=None, data_limits=[], reason=None)
    if status == m.NOT_COMPUTABLE:
        fields.update(
            data_limits=[DATA_LIMITS[0].key],
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
    # Approval of a combined run does not make it a default single measure.
    assert g.approved_reforms(manifest) == ["beta", "alpha"]


@pytest.mark.parametrize("status", STATUSES[1:])
def test_package_refuses_each_unapproved_combined_status(
    publication, package, status
):
    _, original = publication
    manifest = original.model_copy(deep=True)
    key = combined_key(list(MEMBERS))
    manifest.combined[key] = with_status(manifest.combined[key], status)
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
    with pytest.raises(ValueError) as raised:
        g.approved_reforms(manifest, [PACKAGE])
    assert PACKAGE in str(raised.value)


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
