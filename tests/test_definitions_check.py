"""``uk-budget-data publish definitions``: each displayed measure's
definition in this code, compared with its approved receipt.

Run before a deploy, it lists the measures Personal impact would show as
unavailable once the household API runs this code.
"""

import json

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from uk_budget_data import definitions, household_impact
from uk_budget_data.cli import main
from uk_budget_data.publication import manifest as m

MEASURES = household_impact.measure_ids()
COMMIT = "0123456789abcdef" * 2 + "01234567"
DIGEST = "0" * 64
CHANGES_HEADING = (
    "Calculation paths committed since each receipt's commit (no "
    "definition shows them; runbook G5, step 1):"
)


@pytest.fixture(autouse=True)
def _fresh_cache():
    definitions._definition.cache_clear()
    yield
    definitions._definition.cache_clear()


def _receipt(measure_id, git_sha=COMMIT):
    definition = definitions.measure_definition(measure_id, git_sha)
    return {
        "execution_receipt": {
            "baseline": {**definition["baseline"], "name": "b"},
            "reform": {**definition["reform"], "name": "r"},
        },
        "dashboard": {"key": measure_id, "git_sha": git_sha},
    }


def _entry(key, status=m.APPROVED):
    return m.Entry(
        name=key,
        status=status,
        artifact=f"artifacts/{key}/{DIGEST[:16]}",
        outputs_sha256=DIGEST,
        receipt_sha256=DIGEST,
        execution_identity_sha256=DIGEST,
        artifact_sha256=DIGEST,
        years=[2027],
    )


def _publish(data_root, receipts, statuses=None, combined=()):
    statuses = statuses or {}
    manifest = m.Manifest()
    for key, document in receipts.items():
        entry = _entry(key, statuses.get(key, m.APPROVED))
        directory = data_root / entry.artifact
        directory.mkdir(parents=True)
        if document is not None:
            (directory / "receipt.json").write_text(json.dumps(document))
        manifest.measures[key] = entry
    for key in combined:
        manifest.combined[key] = _entry(key)
    m.save_manifest(manifest, data_root)


def _none_since(git_sha):
    return []


def _run(data_root, changes_since=_none_since):
    lines = []
    code = definitions.run_check(
        data_root, lines.append, changes_since=changes_since
    )
    return code, lines


def test_with_no_manifest_there_is_nothing_to_compare(tmp_path):
    assert _run(tmp_path) == (
        0,
        ["no manifest yet: no published measure to compare"],
    )


def test_receipts_made_from_this_code_are_the_same(tmp_path):
    _publish(tmp_path, {key: _receipt(key) for key in MEASURES})
    code, lines = _run(tmp_path)
    assert code == 0, lines
    assert lines[-1] == (
        f"{len(MEASURES)} of {len(MEASURES)} displayed measures have the "
        "approved definition in this code"
    )


def test_a_changed_definition_is_listed_and_fails(tmp_path):
    changed = _receipt(MEASURES[0])
    changed["execution_receipt"]["reform"]["reform_sha256"] = "1" * 64
    _publish(
        tmp_path, {MEASURES[0]: changed, MEASURES[1]: _receipt(MEASURES[1])}
    )
    code, lines = _run(tmp_path)
    assert code == 1
    assert f"DIFFERS {MEASURES[0]} (approved, receipt {COMMIT[:12]}):" in lines
    assert "  - its reform reform_sha256 differs" in lines
    assert f"same    {MEASURES[1]} (approved, receipt {COMMIT[:12]})" in lines


def test_only_displayed_single_measures_are_compared(tmp_path):
    changed = _receipt(MEASURES[0])
    changed["execution_receipt"]["reform"]["reform_sha256"] = "1" * 64
    _publish(
        tmp_path,
        {MEASURES[0]: changed, MEASURES[1]: _receipt(MEASURES[1])},
        statuses={MEASURES[0]: m.WITHDRAWN, MEASURES[1]: m.PROVISIONAL},
        combined=["combined--x+y"],
    )
    code, lines = _run(tmp_path)
    assert code == 0, lines
    assert lines == [
        f"same    {MEASURES[1]} (provisional, receipt {COMMIT[:12]})",
        CHANGES_HEADING,
        f"  since {COMMIT[:12]} ({MEASURES[1]}): none",
        "1 of 1 displayed measures have the approved definition in this code",
    ]


@pytest.mark.parametrize(
    "key, document, problem",
    [
        ("not_registered", {"dashboard": {"git_sha": COMMIT}}, "registers"),
        (MEASURES[0], None, "no receipt"),
        (MEASURES[0], {"dashboard": {"git_sha": "abc"}}, "no full commit"),
        (MEASURES[0], {"dashboard": {}}, "no full commit"),
    ],
)
def test_a_measure_that_cannot_be_compared_fails(
    tmp_path, key, document, problem
):
    _publish(tmp_path, {key: document})
    code, lines = _run(tmp_path)
    assert code == 1
    assert any(problem in line for line in lines), lines


def test_the_command_line_runs_it(tmp_path, capsys):
    _publish(tmp_path, {MEASURES[0]: _receipt(MEASURES[0])})
    assert main(["publish", "--data-root", str(tmp_path), "definitions"]) == 0
    assert "1 of 1 displayed measures" in capsys.readouterr().out


# --- --api: the definitions a deployed revision serves ----------------------


class _Answer:
    def __init__(self, status_code, body):
        self.status_code = status_code
        self._body = body

    def json(self):
        if isinstance(self._body, Exception):
            raise self._body
        return self._body


class _Recording:
    """The real household route (its calculation faked: definitions don't
    depend on it), recording what it was asked."""

    def __init__(self, monkeypatch):
        from fastapi.testclient import TestClient

        from uk_budget_data import api

        monkeypatch.setattr(
            household_impact,
            "calculate_household_impact",
            lambda *args, **kwargs: {"net_income": {}},
        )
        api._cached_household_impact.cache_clear()
        self.client = TestClient(api.app)
        self.calls = []

    def request(self, method, route, **kwargs):
        self.calls.append((method, route))
        return self.client.request(method, route, **kwargs)


def _api_run(data_root, client):
    lines = []
    code = definitions.run_check(
        data_root,
        lines.append,
        definitions.api_reporter("https://api.example", client=client),
        where="the API at https://api.example",
        changes_since=_none_since,
    )
    return code, lines


def _local_lines(lines):
    return lines[:-1], lines[-1]


@pytest.mark.parametrize("changed", [None, 0, -1])
def test_the_api_reports_what_the_running_code_does(
    tmp_path, monkeypatch, changed
):
    """Differential: through the real route, the API mode prints the local
    check's report line for line, a changed definition included."""
    receipts = {key: _receipt(key) for key in MEASURES}
    if changed is not None:
        reform = receipts[MEASURES[changed]]["execution_receipt"]["reform"]
        reform["reform_sha256"] = "1" * 64
    _publish(tmp_path, receipts)
    local_code, local = _run(tmp_path)
    definitions._definition.cache_clear()
    api_code, served = _api_run(tmp_path, _Recording(monkeypatch))
    assert api_code == local_code == (0 if changed is None else 1)
    assert served[:-1] == local[:-1]
    assert served[-1] == local[-1].replace(
        "in this code", "in the API at https://api.example"
    )


def test_it_asks_once_for_every_compared_measure(tmp_path, monkeypatch):
    _publish(tmp_path, {key: _receipt(key) for key in MEASURES})
    client = _Recording(monkeypatch)
    assert _api_run(tmp_path, client)[0] == 0
    [(method, route)] = client.calls
    assert method == "POST"
    named = sorted(route.partition("?")[2].split("&"))
    assert named == sorted(f"definition={key}%3A{COMMIT}" for key in MEASURES)


def test_a_measure_the_api_does_not_register_differs(tmp_path, monkeypatch):
    """The API reports a measure added after its revision per measure; the
    check lists it rather than refusing the rest."""
    added = {
        "execution_receipt": {"baseline": {}, "reform": {}},
        "dashboard": {"key": "added_since", "git_sha": COMMIT},
    }
    _publish(
        tmp_path, {"added_since": added, MEASURES[0]: _receipt(MEASURES[0])}
    )
    code, lines = _api_run(tmp_path, _Recording(monkeypatch))
    assert code == 1
    assert f"DIFFERS added_since (approved, receipt {COMMIT[:12]}):" in lines
    assert (
        f"  - the running code cannot bind it: {definitions.UNREGISTERED}"
        in lines
    )
    assert f"same    {MEASURES[0]} (approved, receipt {COMMIT[:12]})" in lines


NO_DEFINITIONS = "no definitions in its answer (a revision without them)"


class _Fixed:
    def __init__(self, answer):
        self.answer = answer

    def request(self, method, route, **kwargs):
        if isinstance(self.answer, Exception):
            raise self.answer
        return self.answer


@pytest.mark.parametrize(
    "answer, reason",
    [
        (_Answer(404, {"detail": "Not Found"}), "HTTP 404"),
        (_Answer(503, {}), "HTTP 503"),
        (_Answer(200, {"net_income": {}}), NO_DEFINITIONS),
        (_Answer(200, {"definitions": []}), NO_DEFINITIONS),
        (_Answer(200, ValueError("not JSON")), NO_DEFINITIONS),
        (TimeoutError("timed out"), "no answer: TimeoutError: timed out"),
    ],
)
def test_an_api_that_gives_no_definitions_fails(tmp_path, answer, reason):
    _publish(tmp_path, {MEASURES[0]: _receipt(MEASURES[0])})
    code, lines = _api_run(tmp_path, _Fixed(answer))
    assert code == 1
    assert lines == [
        "REFUSED the API at https://api.example gave no definitions to "
        f"compare: {reason}"
    ]


def test_with_nothing_to_compare_the_api_is_not_asked(tmp_path):
    _publish(tmp_path, {MEASURES[0]: None})
    code, lines = _api_run(tmp_path, _Fixed(AssertionError("asked")))
    assert code == 1
    assert any("no receipt" in line for line in lines)


def test_the_command_line_asks_the_named_api(tmp_path, monkeypatch, capsys):
    from uk_budget_data import deploy_smoke

    recording = _Recording(monkeypatch)
    opened = []

    def client(base_url, timeout):
        opened.append((base_url, timeout))
        return recording

    monkeypatch.setattr(deploy_smoke, "StdlibClient", client)
    _publish(tmp_path, {MEASURES[0]: _receipt(MEASURES[0])})
    argv = ["publish", "--data-root", str(tmp_path), "definitions"]
    assert main([*argv, "--api", "https://tag---api.run.app"]) == 0
    assert opened == [("https://tag---api.run.app", 300.0)]
    assert main([*argv, "--api", "https://x", "--timeout", "30"]) == 0
    assert opened[-1] == ("https://x", 30.0)
    out = capsys.readouterr().out
    assert (
        "1 of 1 displayed measures have the approved definition in the "
        "API at https://tag---api.run.app" in out
    )


# --- what no definition shows: calculation paths committed since ----------


def _git(repo, *args):
    import subprocess

    done = subprocess.run(
        ["git", *args], cwd=repo, capture_output=True, text=True, check=True
    )
    return done.stdout.strip()


def _commit(repo, files, message):
    for path, text in files.items():
        target = repo / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text)
    _git(repo, "add", "-A")
    _git(repo, "commit", "-q", "-m", message)
    return _git(repo, "rev-parse", "HEAD")


@pytest.fixture
def repo(tmp_path):
    root = tmp_path / "repo"
    root.mkdir()
    _git(root, "init", "-q", "-b", "main")
    _git(root, "config", "user.email", "test@example.com")
    _git(root, "config", "user.name", "Test")
    return root


def _since(repo):
    from uk_budget_data.publication.receipt import calculation_changes_since

    return lambda git_sha: calculation_changes_since(git_sha, repo)


def test_the_calculation_paths_since_a_receipt_are_listed(tmp_path, repo):
    """A change outside the measures' own modules leaves every definition
    the same, so the check lists it; docs and the page's own files are not
    calculation paths."""
    approved = _commit(repo, {"src/uk_budget_data/x.py": "a = 1\n"}, "a")
    _commit(
        repo,
        {
            "src/uk_budget_data/measure_templates.py": "b = 2\n",
            "docs/notes.md": "words\n",
            "src/App.jsx": "export {};\n",
        },
        "b",
    )
    data_root = tmp_path / "data"
    _publish(data_root, {key: _receipt(key, approved) for key in MEASURES})
    code, lines = _run(data_root, _since(repo))
    assert code == 0, lines
    at = lines.index(CHANGES_HEADING)
    assert lines[at + 1 :] == [
        f"  since {approved[:12]} ({', '.join(sorted(MEASURES))}):",
        "    src/uk_budget_data/measure_templates.py",
        f"{len(MEASURES)} of {len(MEASURES)} displayed measures have the "
        "approved definition in this code",
    ]


def test_each_receipt_commit_is_listed_once_with_its_measures(tmp_path, repo):
    first = _commit(repo, {"src/uk_budget_data/x.py": "a = 1\n"}, "a")
    second = _commit(repo, {"src/uk_budget_data/x.py": "a = 2\n"}, "b")
    _commit(repo, {"uv.lock": "locked\n"}, "c")
    data_root = tmp_path / "data"
    _publish(
        data_root,
        {
            MEASURES[0]: _receipt(MEASURES[0], first),
            MEASURES[1]: _receipt(MEASURES[1], second),
            MEASURES[2]: _receipt(MEASURES[2], first),
        },
    )
    code, lines = _run(data_root, _since(repo))
    assert code == 0, lines
    at = lines.index(CHANGES_HEADING)
    assert lines[at + 1 : -1] == [
        f"  since {first[:12]} ({MEASURES[0]}, {MEASURES[2]}):",
        "    src/uk_budget_data/x.py",
        "    uv.lock",
        f"  since {second[:12]} ({MEASURES[1]}):",
        "    uv.lock",
    ]


def test_a_commit_the_checkout_does_not_descend_from_says_so(tmp_path, repo):
    _commit(repo, {"README.md": "x\n"}, "root")
    _git(repo, "checkout", "-q", "-b", "side")
    elsewhere = _commit(repo, {"src/uk_budget_data/x.py": "a = 1\n"}, "side")
    _git(repo, "checkout", "-q", "main")
    data_root = tmp_path / "data"
    _publish(data_root, {MEASURES[0]: _receipt(MEASURES[0], elsewhere)})
    code, lines = _run(data_root, _since(repo))
    assert code == 0, lines
    assert lines[-2] == (
        f"  since {elsewhere[:12]} ({MEASURES[0]}): cannot list them: the "
        f"approved commit {elsewhere[:12]} is not an ancestor of HEAD"
    )


def test_a_commit_the_checkout_lacks_says_to_fetch_it(tmp_path, repo):
    """Review of 0608183, finding 5: a receipt commit this checkout hasn't
    fetched (or a shallow clone lacks) read as one HEAD doesn't descend
    from. The command's own lister tells the two apart."""
    _commit(repo, {"README.md": "x\n"}, "root")
    _git(repo, "checkout", "-q", "-b", "side")
    elsewhere = _commit(repo, {"src/uk_budget_data/x.py": "a = 1\n"}, "s")
    _git(repo, "checkout", "-q", "main")
    missing = "f" * 40
    data_root = tmp_path / "data"
    _publish(
        data_root,
        {
            MEASURES[0]: _receipt(MEASURES[0], missing),
            MEASURES[1]: _receipt(MEASURES[1], elsewhere),
        },
    )
    code, lines = _run(
        data_root,
        lambda git_sha: definitions._changes_in_checkout(git_sha, repo),
    )
    assert code == 0, lines
    listed = lines[lines.index(CHANGES_HEADING) + 1 : -1]
    assert sorted(listed) == sorted(
        [
            f"  since {missing[:12]} ({MEASURES[0]}): cannot list them: "
            f"this checkout has no commit {missing[:12]}: fetch it (git fetch "
            "origin), or unshallow a shallow clone",
            f"  since {elsewhere[:12]} ({MEASURES[1]}): cannot list them: the "
            f"approved commit {elsewhere[:12]} is not an ancestor of HEAD",
        ]
    )


def test_a_listed_path_does_not_fail_the_check_and_a_difference_still_does(
    tmp_path, repo
):
    approved = _commit(repo, {"README.md": "x\n"}, "a")
    _commit(repo, {"src/uk_budget_data/models.py": "m = 1\n"}, "b")
    data_root = tmp_path / "data"
    changed = _receipt(MEASURES[0], approved)
    changed["execution_receipt"]["reform"]["reform_sha256"] = "1" * 64
    _publish(
        data_root,
        {MEASURES[0]: changed, MEASURES[1]: _receipt(MEASURES[1], approved)},
    )
    code, lines = _run(data_root, _since(repo))
    assert code == 1
    assert "    src/uk_budget_data/models.py" in lines


def test_rows_without_a_full_commit_are_not_listed(tmp_path):
    _publish(
        tmp_path,
        {
            MEASURES[0]: None,
            MEASURES[1]: {"dashboard": {"git_sha": "abc"}},
        },
    )
    asked = []
    code, lines = _run(tmp_path, lambda git_sha: asked.append(git_sha) or [])
    assert code == 1
    assert asked == []
    assert CHANGES_HEADING not in lines


def test_the_command_line_lists_them_from_the_working_directory(
    tmp_path, repo, monkeypatch, capsys
):
    approved = _commit(repo, {"README.md": "x\n"}, "a")
    _commit(repo, {"pyproject.toml": "[project]\n"}, "b")
    data_root = tmp_path / "data"
    _publish(data_root, {MEASURES[0]: _receipt(MEASURES[0], approved)})
    monkeypatch.chdir(repo)
    argv = ["publish", "--data-root", str(data_root), "definitions"]
    assert main(argv) == 0
    out = capsys.readouterr().out.splitlines()
    assert out[out.index(CHANGES_HEADING) + 1 :] == [
        f"  since {approved[:12]} ({MEASURES[0]}):",
        "    pyproject.toml",
        "1 of 1 displayed measures have the approved definition in this code",
    ]


@settings(max_examples=60, deadline=None)
@given(
    st.lists(
        st.tuples(
            st.sampled_from(["a", "b", "c", "d", "e"]),
            st.sampled_from(["1" * 40, "2" * 40, "3" * 64, "abc", None]),
        ),
        unique_by=lambda row: row[0],
        max_size=5,
    )
)
def test_every_row_with_a_full_commit_is_listed_under_its_commit_once(rows):
    """Property: the headings name each full commit once, and partition the
    rows that have one."""
    rows = [
        {"key": key, "git_sha": git_sha, "problems": []}
        for key, git_sha in rows
    ]
    lines = definitions.changes_lines(rows, lambda git_sha: [])
    full = [
        row
        for row in rows
        if isinstance(row["git_sha"], str)
        and definitions.FULL_COMMIT.fullmatch(row["git_sha"])
    ]
    if not full:
        assert lines == []
        return
    assert lines[0] == CHANGES_HEADING
    named = {}
    for line in lines[1:]:
        assert line.endswith(": none")
        commit, keys = line[len("  since ") :].split(" (", 1)
        assert commit not in named
        named[commit] = keys[: -len("): none")].split(", ")
    assert sorted(key for keys in named.values() for key in keys) == sorted(
        row["key"] for row in full
    )
    for row in full:
        assert row["key"] in named[row["git_sha"][:12]]
