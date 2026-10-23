"""Tests for uk_budget_data.area_routing, the page's area routing status."""

import importlib.util
import json
import subprocess
from datetime import date
from pathlib import Path
from typing import get_args

import pytest
from policyengine.provenance.certification import LOCAL_AREA_REGION_TYPES
from policyengine.provenance.manifest import (
    ArtifactPathTemplate,
    RegionalReleaseKind,
    get_release_manifest,
)

from uk_budget_data import area_routing

REPO = Path(__file__).resolve().parents[1]
SCRIPT = REPO / "scripts" / "check_public_data.py"

spec = importlib.util.spec_from_file_location("check_public_data", SCRIPT)
check_public_data = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check_public_data)

NATIONAL = {"national": ArtifactPathTemplate(path_template="national.h5")}
AREAS = {
    region_type: ArtifactPathTemplate(path_template="local.h5")
    for region_type in ("constituency", "local_authority")
}


def manifest(kind, region_datasets):
    """The installed UK release manifest, with its routing replaced."""
    return get_release_manifest("uk").model_copy(
        update={
            "regional_release_kind": kind,
            "region_datasets": region_datasets,
        }
    )


def test_the_committed_file_matches_the_installed_bundle():
    path = REPO / area_routing.PATH
    committed = path.read_bytes() if path.is_file() else None
    expected = area_routing.render(area_routing.installed_routing()).encode()
    assert committed == expected, (
        f"{area_routing.PATH} does not match the installed bundle's area "
        f"routing. Regenerate it: {area_routing.COMMAND}"
    )


def test_a_local_area_release_is_available():
    routing = area_routing.area_routing(
        manifest("local_area", {**NATIONAL, **AREAS})
    )
    assert routing == {
        "area_views": "available",
        "regional_release_kind": "local_area",
    }


def test_a_dropped_routing_is_not_available():
    # What --drop-regional-release leaves: no kind, the national template.
    routing = area_routing.area_routing(manifest(None, NATIONAL))
    assert routing == {
        "area_views": "not_available",
        "regional_release_kind": None,
    }


def test_templates_without_a_kind_are_not_a_routing():
    routing = area_routing.area_routing(manifest(None, {**NATIONAL, **AREAS}))
    assert routing["area_views"] == "not_available"


def test_an_area_coded_national_release_is_available():
    # The area run serves it as --dataset-kind efrs with the seat weights.
    routing = area_routing.area_routing(
        manifest("area_coded_national", {**NATIONAL, **AREAS})
    )
    assert routing == {
        "area_views": "available",
        "regional_release_kind": "area_coded_national",
    }


@pytest.mark.parametrize("kind", ["local_area", "area_coded_national"])
@pytest.mark.parametrize("missing", ["constituency", "local_authority"])
def test_a_routing_without_both_templates_is_not_available(kind, missing):
    datasets = {**NATIONAL, **AREAS}
    del datasets[missing]
    assert (
        area_routing.area_views_status(manifest(kind, datasets))
        == "not_available"
    )


def test_every_kind_policyengine_routes_has_a_decision():
    # A new kind reads as not available. Check what the area run can serve
    # from it, then add it to SERVED_KINDS or to UNSERVED_KINDS.
    served = set(area_routing.SERVED_KINDS)
    unserved = set(area_routing.UNSERVED_KINDS)
    assert not served & unserved
    assert set(get_args(RegionalReleaseKind)) == served | unserved
    assert area_routing.AREA_REGION_TYPES == LOCAL_AREA_REGION_TYPES["uk"]


@pytest.mark.parametrize("kind", get_args(RegionalReleaseKind))
def test_a_kind_is_available_only_if_the_area_run_serves_it(kind):
    status = area_routing.area_views_status(
        manifest(kind, {**NATIONAL, **AREAS})
    )
    expected = (
        "available" if kind in area_routing.SERVED_KINDS else "not_available"
    )
    assert status == expected


def test_the_file_is_two_sorted_fields_and_a_newline():
    text = area_routing.render(
        {"regional_release_kind": None, "area_views": "not_available"}
    )
    assert text == (
        '{\n  "area_views": "not_available",\n'
        '  "regional_release_kind": null\n}\n'
    )
    assert json.loads(text) == {
        "area_views": "not_available",
        "regional_release_kind": None,
    }


def test_check_names_the_command_until_the_file_matches(
    tmp_path, monkeypatch, capsys
):
    path = tmp_path / "data" / "area-routing.json"
    path.parent.mkdir()
    monkeypatch.setattr(
        area_routing,
        "installed_routing",
        lambda: area_routing.area_routing(manifest(None, NATIONAL)),
    )
    assert area_routing.main(["--check", "--path", str(path)]) == 1
    assert area_routing.COMMAND in capsys.readouterr().err

    assert area_routing.main(["--write", "--path", str(path)]) == 0
    assert path.read_bytes() == (
        b'{\n  "area_views": "not_available",\n'
        b'  "regional_release_kind": null\n}\n'
    )
    assert area_routing.main(["--check", "--path", str(path)]) == 0

    path.write_text(
        area_routing.render(
            area_routing.area_routing(manifest("local_area", AREAS))
        )
    )
    assert area_routing.main(["--check", "--path", str(path)]) == 1
    error = capsys.readouterr().err
    assert "area views not_available" in error
    assert f"{area_routing.COMMAND} --path {path}" in error


@pytest.mark.parametrize("action", ["--write", "--check"])
def test_a_missing_directory_is_refused_and_nothing_is_written(
    tmp_path, monkeypatch, capsys, action
):
    # As from a subdirectory of the repository: public/data is not there.
    monkeypatch.chdir(tmp_path)
    assert area_routing.main([action]) == 1
    assert "run this from the repository root" in capsys.readouterr().err
    assert list(tmp_path.iterdir()) == []


@pytest.mark.parametrize("action", ["--write", "--check"])
def test_a_missing_directory_given_by_path_is_refused_as_given(
    tmp_path, capsys, action
):
    path = tmp_path / "missing" / "area-routing.json"
    assert area_routing.main([action, "--path", str(path)]) == 1
    assert capsys.readouterr().err == (f"{path.parent} is not a directory\n")
    assert list(tmp_path.iterdir()) == []


def possible_routings():
    """Every file the module can write for the kinds policyengine knows."""
    routings = []
    for kind in (None, *get_args(RegionalReleaseKind)):
        for datasets in (NATIONAL, {**NATIONAL, **AREAS}):
            routing = area_routing.area_routing(manifest(kind, datasets))
            if routing not in routings:
                routings.append(routing)
    return routings


def test_the_public_data_check_knows_every_file_the_module_writes():
    contents = {area_routing.render(r).encode() for r in possible_routings()}
    assert contents == check_public_data.AREA_ROUTING_CONTENTS


@pytest.mark.parametrize(
    "routing",
    possible_routings(),
    ids=lambda r: "-".join(map(str, r.values())),
)
def test_the_public_data_check_accepts_the_file_unreviewed(tmp_path, routing):
    review = tmp_path / check_public_data.REVIEW_FILE
    review.parent.mkdir(parents=True)
    review.write_text(",".join(check_public_data.REVIEW_COLUMNS) + "\n")
    path = tmp_path / area_routing.PATH
    path.parent.mkdir(parents=True)
    path.write_text(area_routing.render(routing))
    subprocess.run(["git", "init", "-q"], cwd=tmp_path, check=True)
    subprocess.run(["git", "add", "-A"], cwd=tmp_path, check=True)
    report = check_public_data.check(tmp_path, today=date(2026, 10, 24))
    assert report.problems == []
