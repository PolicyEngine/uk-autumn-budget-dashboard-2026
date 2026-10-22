"""The ``uk-budget-data demographics`` command.

As ``geography`` does, it publishes only measures the publication manifest
approves, refuses a measure the data can't cost, writes its public tables
only once the disclosure layer validates them, keeps the layer's audit in a
private directory outside any repository, and labels Microcosm runs
uncertified. Synthetic people only, through stand-in simulations.
"""

import csv
import hashlib
import importlib.util
import json
import subprocess
from pathlib import Path

import h5py
import numpy as np
import pandas as pd
import pytest
from policyengine.disclosure import validate_public

from tests.test_demographics import FakePersonSimulation
from tests.test_geography import publication_manifest
from uk_budget_data import cli
from uk_budget_data import demographics as d
from uk_budget_data import geography as g
from uk_budget_data.budget_years import POLICY_YEARS
from uk_budget_data.models import Reform
from uk_budget_data.private_outputs import AUDIT_DIR_ENV

REPO = Path(__file__).resolve().parent.parent
YEAR = 2029
CHECKER = REPO / "scripts" / "check_public_data.py"


def synthetic_world():
    """600 Microcosm households of three people (an adult, a child and an 18
    to 24-year-old), every tenth a copy of the one before. Invented."""
    count = 600
    household = pd.DataFrame(
        {
            "household_id": np.arange(1, count + 1),
            "household_weight": np.full(count, 1_000.0),
            "source_household_id": [
                h if h % 10 else h - 1 for h in range(1, count + 1)
            ],
            "household_is_capital_gains_clone": [
                h % 10 == 0 for h in range(1, count + 1)
            ],
        }
    )
    members, people = [], {
        name: []
        for name in (
            "age",
            "employment_status",
            "current_education",
            "is_in_approved_training",
            "person_weight",
            "household_net_income",
            "in_poverty_bhc",
        )
    }
    for index in range(count):
        not_in_work = index % 3 == 0
        for age, status, school in (
            (25 + index % 40, "FT_EMPLOYED", "NOT_IN_EDUCATION"),
            (index % 16, "CHILD", "PRIMARY"),
            (
                18 + index % 7,
                "UNEMPLOYED" if not_in_work else "STUDENT",
                "NOT_IN_EDUCATION" if not_in_work else "TERTIARY",
            ),
        ):
            members.append(index)
            people["age"].append(age)
            people["employment_status"].append(status)
            people["current_education"].append(school)
            people["is_in_approved_training"].append(False)
            people["person_weight"].append(1_000.0)
            people["household_net_income"].append(25_000.0 + 10 * index)
            people["in_poverty_bhc"].append(index % 5 == 0)
    return (
        household,
        np.asarray(members),
        {k: np.asarray(v) for k, v in people.items()},
    )


def run_command(
    monkeypatch,
    tmp_path,
    reforms=("alpha",),
    approved=("alpha", "beta"),
    packages=None,
    extra=(),
):
    household, members, people = synthetic_world()
    gains = {
        "alpha": 50.0 + 25 * (np.arange(len(household)) % 9),
        "beta": 80.0 + 10 * (np.arange(len(household)) % 5),
    }
    gains["pkg"] = gains["alpha"] + gains["beta"]

    def simulate(reform, dataset, years):
        reformed = dict(people)
        reformed["household_net_income"] = (
            people["household_net_income"] + gains[reform.id][members]
        )
        reformed["in_poverty_bhc"] = np.zeros(len(members), dtype=bool)
        return (
            FakePersonSimulation(household, pd.DataFrame(), members, people),
            FakePersonSimulation(household, pd.DataFrame(), members, reformed),
        )

    registry = {
        key: Reform(id=key, name=key, parameter_changes={})
        for key in ("alpha", "beta", "pkg")
    }
    monkeypatch.setattr(g, "simulate_reform", simulate)
    monkeypatch.setattr(g, "get_reform", registry.get)
    monkeypatch.setattr(g, "PACKAGES", packages or {})
    manifest = publication_manifest(
        tmp_path, [key for key in approved], packages=packages
    )
    local = tmp_path / "local.h5"
    with h5py.File(local, "w") as handle:
        handle.attrs[g.MICROCOSM_EXPORT_ATTRIBUTE] = "household"
    monkeypatch.setenv(AUDIT_DIR_ENV, str(tmp_path / "audit"))
    out = tmp_path / "out"
    code = cli.main(
        [
            "demographics",
            "--manifest",
            str(manifest),
            "--dataset-kind",
            "microcosm",
            "--dataset",
            str(local),
            "--years",
            str(YEAR),
            "--reforms",
            *reforms,
            "--out-dir",
            str(out),
            *extra,
        ]
    )
    return code, out, tmp_path / "audit" / "demographics"


def test_demographics_arguments():
    parsed = cli.parse_args(["demographics"])
    assert parsed.command == "demographics"
    assert parsed.dataset is None and parsed.dataset_kind == "efrs"
    assert parsed.reforms is None
    assert parsed.years == POLICY_YEARS
    assert parsed.out_dir == Path("public/data")
    assert parsed.employment_reviewer is None


def test_without_a_private_directory_nothing_runs(monkeypatch):
    monkeypatch.delenv(AUDIT_DIR_ENV, raising=False)
    assert cli.main(["demographics"]) == 1


def test_a_measure_the_manifest_does_not_approve_is_refused(
    monkeypatch, tmp_path, capsys
):
    code, out, _ = run_command(
        monkeypatch, tmp_path, reforms=("beta",), approved=("alpha",)
    )
    assert code == 1
    assert "beta" in capsys.readouterr().out
    assert not out.exists() or not any(out.iterdir())


def test_a_package_and_its_own_measures_are_not_published_together(
    monkeypatch, tmp_path, capsys
):
    code, out, _ = run_command(
        monkeypatch,
        tmp_path,
        reforms=("pkg", "alpha"),
        approved=("alpha", "beta", "pkg"),
        packages={"pkg": ("alpha", "beta")},
    )
    assert code == 1
    assert "a package or its measures" in capsys.readouterr().out
    assert not out.exists() or not any(out.iterdir())


@pytest.fixture
def published(monkeypatch, tmp_path, capsys):
    code, out, audit = run_command(monkeypatch, tmp_path)
    # Line wrapping is the console's, not the command's
    return code, out, audit, " ".join(capsys.readouterr().out.split())


def test_it_writes_both_tables_and_a_private_audit(published):
    code, out, audit, printed = published
    assert code == 0, printed
    table = pd.read_csv(
        out / "demographics.csv", dtype=str, keep_default_na=False
    )
    assert validate_public(out / "demographics.csv") == []
    assert set(table["level"]) == set(d.AGE_LEVELS)
    rates = pd.read_csv(out / "poverty_by_age.csv")
    assert list(rates.columns) == d.POVERTY_COLUMNS
    assert set(rates["age_group"]) <= set(d.GROUP_NAMES[d.AGE_GROUP])
    (summary_path,) = audit.rglob("summary.json")
    summary = json.loads(summary_path.read_text())
    assert summary["levels"] == list(d.AGE_LEVELS)
    assert summary["employment_reviewer"] is None
    assert summary["reforms"] == ["alpha"] and summary["years"] == [YEAR]


def test_microcosm_runs_are_labelled_uncertified(published):
    code, _, audit, printed = published
    assert code == 0, printed
    assert printed.startswith(g.MICROCOSM_UNCERTIFIED)
    assert printed.endswith(g.MICROCOSM_UNCERTIFIED)
    assert printed.count(g.MICROCOSM_UNCERTIFIED) == 2
    (summary_path,) = audit.rglob("summary.json")
    summary = json.loads(summary_path.read_text())
    assert summary["certified"] is False
    assert summary["certification_reason"] == g.MICROCOSM_UNCERTIFIED


def test_employment_is_published_only_with_a_named_reviewer(
    monkeypatch, tmp_path
):
    code, out, audit = run_command(
        monkeypatch, tmp_path, extra=("--employment-reviewer", "A reviewer")
    )
    assert code == 0
    table = pd.read_csv(
        out / "demographics.csv", dtype=str, keep_default_na=False
    )
    assert d.EMPLOYMENT in set(table["level"])
    (summary_path,) = audit.rglob("summary.json")
    assert (
        json.loads(summary_path.read_text())["employment_reviewer"]
        == "A reviewer"
    )


def _checker():
    spec = importlib.util.spec_from_file_location("check_public_data", CHECKER)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_the_public_data_check_accepts_both_files_once_reviewed(
    published, tmp_path
):
    """demographics.csv is a disclosure table and poverty_by_age.csv a
    national table; each passes once a reviewer lists it."""
    _, out, _, _ = published
    checker = _checker()
    root = tmp_path / "repository"
    rows = []
    for name, kind in (
        ("demographics.csv", "disclosure_table"),
        ("poverty_by_age.csv", "national_table"),
    ):
        target = root / "public" / "data" / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes((out / name).read_bytes())
        digest = hashlib.sha256(target.read_bytes()).hexdigest()
        rows.append(
            [
                f"public/data/{name}",
                kind,
                digest,
                "reviewer",
                "2026-10-22",
                "",
                "B.",
            ]
        )
    review = root / checker.REVIEW_FILE
    review.parent.mkdir(parents=True, exist_ok=True)
    with review.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle, lineterminator="\n")
        writer.writerow(checker.REVIEW_COLUMNS)
        writer.writerows(rows)
    subprocess.run(["git", "init", "-q"], cwd=root, check=True)
    subprocess.run(["git", "add", "-A"], cwd=root, check=True)
    assert checker.check(root).problems == []
