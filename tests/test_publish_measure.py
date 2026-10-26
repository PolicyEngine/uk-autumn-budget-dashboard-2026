"""publish-measure on #104's receipted artifacts, without a simulation (#105).

A measure's artifact is staged, never approved, with its new files' review
rows pending; "live" is what the manifest approves; approval is the
Reconciler's step (sign-measures); the combined run is current only when
its members are exactly the displayable measures.
"""

import csv
import importlib.util
from datetime import date
from pathlib import Path

import pytest

from tests.publication_support import World, other_dataset_name
from uk_budget_data import publish_measure as pm
from uk_budget_data.publication import generate as generate_module
from uk_budget_data.publication import manifest as m

VALUES = {2027: -1.0, 2028: -2.0}
REVIEW_HEADER = "path,kind,sha256,reviewer,reviewed_on,expires_on,basis\n"


@pytest.fixture
def world(monkeypatch):
    instance = World()
    monkeypatch.setattr(
        generate_module, "code_revision", lambda root: instance.revision()
    )
    review = instance.root / pm.REVIEW_CSV
    review.parent.mkdir(parents=True, exist_ok=True)
    review.write_text(REVIEW_HEADER)
    yield instance
    instance.close()


def collect(world, paths, **kwargs):
    return pm.collect(
        paths,
        root=world.root,
        data_root=world.data_root,
        inputs=world.inputs,
        on="2026-10-28",
        **kwargs,
    )


def review(world):
    with (world.root / pm.REVIEW_CSV).open() as handle:
        return {row["path"]: row for row in csv.DictReader(handle)}


def combined_artifact(world, members):
    from uk_budget_data.publication.artifacts import read_receipt

    manifest = m.load_manifest(world.data_root)
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
        {2027: -2.0, 2028: -4.0},
        members=records,
        measure_ids=sorted(members),
        member_outputs={
            member: manifest.measures[member].outputs_sha256
            for member in members
        },
    )


def sign(world, **kwargs):
    return pm.sign_measures(
        by="María Juaristi",
        reviewer="juaristi22",
        root=world.root,
        data_root=world.data_root,
        inputs=world.inputs,
        on="2026-10-28",
        **kwargs,
    )


# ---------------------------------------------------------------------------
# Staging
# ---------------------------------------------------------------------------


def test_a_measure_is_staged_never_approved(world):
    world.costing("alpha", VALUES)
    reference = world.write("alpha", VALUES)
    result = collect(world, [reference.path])
    assert result.staged == {"alpha": m.STAGED}
    assert result.refused == {}
    assert result.failures == []
    entry = m.load_manifest(world.data_root).measures["alpha"]
    assert entry.status == m.STAGED and entry.approval is None
    assert pm.live_measure_ids(world.data_root) == []
    assert result.revenue["alpha"] == VALUES


def test_provisional_staging_is_displayable_but_not_live(world):
    world.costing("alpha", VALUES)
    reference = world.write("alpha", VALUES)
    result = collect(world, [reference.path], provisional=True)
    assert result.staged == {"alpha": m.PROVISIONAL}
    assert pm.displayable_measure_ids(world.data_root) == ["alpha"]
    assert pm.live_measure_ids(world.data_root) == []


def test_new_files_go_pending_and_nothing_is_signed(world):
    world.costing("alpha", VALUES)
    reference = world.write("alpha", VALUES)
    result = collect(world, [reference.path])
    rows = review(world)
    assert result.pending and set(result.pending) == set(rows)
    manifest = str(m.manifest_path(world.data_root).relative_to(world.root))
    assert manifest in rows
    for row in rows.values():
        assert row["kind"] == "pending"
        assert row["reviewer"] == pm.RECONCILER
        assert row["expires_on"] == "2026-11-04"
        assert "alpha" in row["basis"]


def test_pending_rows_pass_the_public_data_check(world):
    world.costing("alpha", VALUES)
    collect(world, [world.write("alpha", VALUES).path])
    script = Path(__file__).resolve().parent.parent / "scripts"
    spec = importlib.util.spec_from_file_location(
        "check_public_data", script / "check_public_data.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    entries, problems = module.read_review(world.root)
    assert problems == []
    assert {entry.expires_on for entry in entries.values()} == {
        date(2026, 11, 4)
    }


def test_reconciliation_stays_outside_the_artifact(world, tmp_path):
    world.costing("alpha", VALUES)
    reference = world.write("alpha", VALUES)
    private = tmp_path / "private"
    result = collect(world, [reference.path], private_dir=private)
    assert not (reference.path / "reconciliation.json").exists()
    assert (private / "alpha" / "reconciliation.json").is_file()
    assert result.reconciliation["alpha"] == "pass"


def test_a_refused_artifact_leaves_the_manifest_alone(world):
    # Staged on another execution identity: refused, and reported
    world.costing("alpha", VALUES)
    collect(world, [world.write("alpha", VALUES).path])
    before = m.manifest_path(world.data_root).read_bytes()
    other_name = other_dataset_name()
    dataset = world.root / f"{other_name}.h5"
    dataset.write_bytes(b"another dataset")
    world.register(other_name, dataset)
    other = world.write(
        "beta", VALUES, dataset=dataset, dataset_name=other_name
    )
    result = collect(world, [other.path])
    assert "beta" in result.refused and result.staged == {}
    assert m.manifest_path(world.data_root).read_bytes() == before


def test_only_the_artifacts_given_are_staged(world):
    # Restaging an artifact main already holds would supersede its entry
    world.costing("alpha", VALUES)
    world.costing("beta", VALUES)
    alpha = world.write("alpha", VALUES)
    collect(world, [alpha.path])
    sign(world)
    beta = world.write("beta", VALUES)
    result = collect(world, [beta.path])
    assert list(result.staged) == ["beta"]
    manifest = m.load_manifest(world.data_root)
    assert manifest.measures["alpha"].status == m.APPROVED
    assert manifest.superseded == []


def test_no_artifact_is_refused(world):
    with pytest.raises(pm.PublishMeasureError, match="no artifact"):
        collect(world, [world.root / "nothing"])


# ---------------------------------------------------------------------------
# Approving, and what "live" means
# ---------------------------------------------------------------------------


def test_sign_measures_approves_then_writes_review_rows(world):
    world.costing("alpha", VALUES)
    collect(world, [world.write("alpha", VALUES).path])
    approved, report = sign(world)
    assert approved == ["alpha"]
    entry = m.load_manifest(world.data_root).measures["alpha"]
    assert entry.status == m.APPROVED
    assert entry.approval.by == "María Juaristi"
    assert pm.live_measure_ids(world.data_root) == ["alpha"]
    kinds = {row["kind"] for row in review(world).values()}
    assert "pending" not in kinds
    assert report.revision == m.load_manifest(world.data_root).revision


def test_sign_measures_refuses_a_failed_reconciliation(world):
    from uk_budget_data.publication.publish import PublishError

    world.costing("alpha", {2027: -9.0, 2028: -9.0})
    collect(world, [world.write("alpha", VALUES).path])
    with pytest.raises(PublishError):
        sign(world)
    entry = m.load_manifest(world.data_root).measures["alpha"]
    assert entry.status == m.STAGED


def test_nothing_staged_nothing_to_sign(world):
    with pytest.raises(pm.PublishMeasureError, match="no staged entry"):
        sign(world)


def test_sign_needs_both_names(world):
    with pytest.raises(pm.PublishMeasureError, match="--by and --reviewer"):
        pm.sign_measures(by=" ", reviewer="x", root=world.root)


# ---------------------------------------------------------------------------
# The combined run
# ---------------------------------------------------------------------------


def test_no_manifest_means_nothing_live(tmp_path):
    assert pm.live_measure_ids(tmp_path) == []
    assert pm.combined_status(tmp_path) == {"members": [], "current": None}


def test_the_package_is_current_only_with_exactly_the_displayable_measures(
    world,
):
    for key in ("alpha", "beta"):
        world.costing(key, VALUES)
        collect(world, [world.write(key, VALUES).path])
    sign(world)
    status = pm.combined_status(world.data_root)
    assert status == {"members": ["alpha", "beta"], "current": None}

    combined = combined_artifact(world, ["alpha", "beta"])
    collect(world, [combined.path])
    sign(world)
    assert pm.combined_status(world.data_root)["current"] == (
        "combined--alpha+beta"
    )

    # A new displayable measure makes the package out of date
    world.costing("gamma", VALUES)
    collect(world, [world.write("gamma", VALUES).path], provisional=True)
    assert pm.combined_status(world.data_root) == {
        "members": ["alpha", "beta", "gamma"],
        "current": None,
    }


def test_compute_combined_needs_members():
    with pytest.raises(pm.PublishMeasureError, match="no approved measure"):
        pm.compute_combined([], None, Path("."))


def test_the_combined_run_is_not_a_measure():
    from types import SimpleNamespace

    with pytest.raises(pm.PublishMeasureError, match="refresh-combined"):
        pm.compute_measure(
            SimpleNamespace(id="combined--alpha+beta"), None, Path(".")
        )


def test_compute_reports_a_refusal():
    from types import SimpleNamespace

    def refused(*args, **kwargs):
        return SimpleNamespace(written=[], refused={"alpha": "data limit"})

    with pytest.raises(pm.PublishMeasureError, match="alpha: data limit"):
        pm.compute_measure(
            SimpleNamespace(id="alpha"), None, Path("."), generate=refused
        )


def test_compute_generates_one_measure_alone(tmp_path):
    from types import SimpleNamespace

    calls = []

    def generate(reforms, config, *, combined_sets, **kwargs):
        calls.append(([r.id for r in reforms], combined_sets))
        return SimpleNamespace(written=["ref"], refused={})

    reform = SimpleNamespace(id="alpha")
    assert pm.compute_measure(reform, None, tmp_path, generate) == "ref"
    assert pm.compute_combined(["a", "b"], None, tmp_path, generate) == "ref"
    assert calls == [(["alpha"], []), ([], [["a", "b"]])]


# ---------------------------------------------------------------------------
# The command line
# ---------------------------------------------------------------------------


def test_an_unknown_measure_is_refused():
    from uk_budget_data.cli import main

    assert main(["publish-measure", "no_such_measure", "--no-stage"]) == 1


def test_measure_status_prints_json(tmp_path, capsys):
    import json

    from uk_budget_data.cli import main

    assert main(["measure-status", "--data-root", str(tmp_path)]) == 0
    assert json.loads(capsys.readouterr().out) == {
        "members": [],
        "current": None,
        "live": [],
    }


def test_the_old_flat_commands_are_gone():
    from uk_budget_data.publish_measure_cli import PUBLISH_MEASURE_COMMANDS

    assert "apply-rows" not in PUBLISH_MEASURE_COMMANDS
    assert "sign-pending" not in PUBLISH_MEASURE_COMMANDS
    assert {"stage-artifacts", "sign-measures"} <= PUBLISH_MEASURE_COMMANDS
