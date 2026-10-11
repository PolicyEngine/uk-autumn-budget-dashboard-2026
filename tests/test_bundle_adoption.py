"""Tests for verifying a policyengine release against its dispatch."""

import json
from pathlib import Path

import pytest
import yaml
from hypothesis import given
from hypothesis import strategies as st

from uk_budget_data.bundle_adoption import (
    REQUIRED_FIELDS,
    check_release,
    installed_identity,
    main,
)

CERTIFICATE = "c" * 64

MANIFEST = {
    "bundle_version": "6.3.0",
    "packages": {
        "policyengine-uk": {"version": "2.130.0"},
        "policyengine-core": {"version": "3.34.0"},
    },
    "data_releases": {
        "uk": {
            "default_dataset": "enhanced_frs_2024_25",
            "data_package": {"version": "1.60.0"},
            "certified_data_artifact": {"sha256": "d" * 64},
            "certification": {"compatibility_basis": "built_with_model"},
        }
    },
}

INSTALLED = {
    "policyengine": "6.3.0",
    "policyengine-uk": "2.130.0",
    "policyengine-core": "3.34.0",
}


def dispatch(**changes) -> dict:
    payload = {
        **installed_identity(MANIFEST),
        "certificate_sha256": CERTIFICATE,
    }
    payload.update(changes)
    return payload


def check(
    version="6.3.0", bundle=None, installed=INSTALLED, digest=CERTIFICATE
):
    return check_release(
        version,
        bundle if bundle is not None else dispatch(),
        manifest=MANIFEST,
        installed_version=installed.__getitem__,
        certificate_digest=(lambda record: digest) if digest else None,
    )


def test_a_matching_release_has_no_problems():
    assert check() == []


@pytest.mark.parametrize(
    "field, value",
    [
        ("model_version", "2.129.0"),
        ("core_version", "3.33.0"),
        ("data_release_version", "1.59.0"),
        ("dataset", "frs_2024_25"),
        ("dataset_sha256", "e" * 64),
        ("certificate_sha256", "f" * 64),
        ("compatibility_basis", "legacy_compatible_model_package"),
    ],
)
def test_each_announced_field_is_checked(field, value):
    problems = check(bundle=dispatch(**{field: value}))
    assert len(problems) == 1
    assert field in problems[0]


def test_wrong_installed_wrapper_is_refused():
    problems = check(installed={**INSTALLED, "policyengine": "6.2.6"})
    assert any("installed policyengine is 6.2.6" in p for p in problems)


def test_installed_model_must_be_the_one_the_bundle_names():
    problems = check(installed={**INSTALLED, "policyengine-uk": "2.125.1"})
    assert problems == [
        "installed policyengine-uk is 2.125.1, but the bundle names 2.130.0"
    ]


def test_packaged_bundle_must_be_the_announced_version():
    problems = check(
        version="6.3.1", installed={**INSTALLED, "policyengine": "6.3.1"}
    )
    assert problems == ["the packaged bundle is 6.3.0, not 6.3.1"]


@pytest.mark.parametrize(
    "version", ["", "6.3", "6.3.0rc1", "main", "6.3.0; rm -rf /"]
)
def test_only_plain_release_versions_are_accepted(version):
    assert "not a plain release version" in check(version=version)[0]


@pytest.mark.parametrize("field", REQUIRED_FIELDS)
def test_a_dispatch_missing_a_field_is_refused(field):
    bundle = dispatch()
    del bundle[field]
    assert check(bundle=bundle) == [f"the dispatch omits {field}"]


def test_a_malformed_digest_is_refused():
    problems = check(bundle=dispatch(dataset_sha256="abc"))
    assert "dataset_sha256 is not a SHA-256" in problems


def test_release_without_a_receipt_module_cannot_be_verified():
    problems = check(digest=None)
    # The installed 6.2.6 has no receipt module, so nothing recomputes it.
    assert problems == [
        "this policyengine release has no receipt module, so the "
        "certificate digest cannot be recomputed"
    ]


@given(
    field=st.sampled_from(sorted(installed_identity(MANIFEST))),
    value=st.text(min_size=1, max_size=20),
)
def test_any_disagreement_with_the_packaged_bundle_is_reported(field, value):
    truth = str(installed_identity(MANIFEST)[field])
    problems = check(bundle=dispatch(**{field: value}))
    if value == truth:
        assert problems == []
    else:
        assert problems


def test_cli_reports_every_problem(capsys):
    bundle = dispatch(model_version="0.0.1")
    code = main(["--version", "6.3.0", "--bundle-uk-json", json.dumps(bundle)])
    assert code == 1
    assert "::error::" in capsys.readouterr().err
    assert main(["--version", "6.3.0", "--bundle-uk-json", "not json"]) == 1
    assert main(["--version", "6.3.0", "--bundle-uk-json", "[]"]) == 1


WORKFLOW = Path(".github/workflows/adopt-policyengine-release.yml")


def test_workflow_never_interpolates_the_dispatch_into_a_script():
    """Dispatch values reach the shell only through environment variables."""
    workflow = yaml.safe_load(WORKFLOW.read_text())
    job = workflow["jobs"]["open-upgrade-pr"]
    for step in job["steps"]:
        script = step.get("run", "")
        assert "github.event" not in script, step.get("name")
        assert "inputs." not in script, step.get("name")


def test_workflow_opens_a_draft_and_never_merges():
    text = WORKFLOW.read_text()
    assert "gh pr create --draft" in text
    assert "gh pr merge" not in text
    assert "--auto" not in text
    assert "pull_request_target" not in text
    workflow = yaml.safe_load(text)
    # PyYAML reads the bare key `on` as the boolean True.
    triggers = workflow.get("on", workflow.get(True))
    assert set(triggers) == {"repository_dispatch", "workflow_dispatch"}
    assert triggers["repository_dispatch"]["types"] == ["policyengine-release"]
