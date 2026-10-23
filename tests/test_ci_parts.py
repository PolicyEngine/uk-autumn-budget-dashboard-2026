"""CI runs the Python suite in parts; together they must run every test once.

Each matrix entry of `python-test-parts` in .github/workflows/ci.yml names
test files, except "the rest", which runs `tests/` and ignores every file
another part names. A file named in no part therefore runs in "the rest",
and a part that names a missing file, or two parts that name one file,
would skip or double-run tests without failing anything else.
"""

from pathlib import Path

import yaml

REPO = Path(__file__).resolve().parent.parent
WORKFLOW = yaml.safe_load(
    (REPO / ".github" / "workflows" / "ci.yml").read_text()
)
JOB = WORKFLOW["jobs"]["python-test-parts"]
RAW = {
    entry["part"]: entry["tests"]
    for entry in JOB["strategy"]["matrix"]["include"]
}
PARTS = {part: tests.split() for part, tests in RAW.items()}
REST = "the rest"


def _named(part: str) -> list[str]:
    return PARTS[part]


def _ignored() -> list[str]:
    tokens = PARTS[REST]
    assert tokens[0] == "tests/", "the rest must run tests/ itself"
    assert all(token.startswith("--ignore=") for token in tokens[1:])
    return [token.removeprefix("--ignore=") for token in tokens[1:]]


def test_every_named_file_exists_and_is_a_test_module():
    for part, files in PARTS.items():
        if part == REST:
            continue
        for name in files:
            path = REPO / name
            assert path.is_file(), f"{part}: {name} does not exist"
            assert path.parent == REPO / "tests"
            assert path.name.startswith("test_") and path.suffix == ".py"


def test_no_file_is_named_by_two_parts():
    named = [name for part in PARTS if part != REST for name in _named(part)]
    assert len(named) == len(set(named))


def test_the_rest_ignores_exactly_the_files_other_parts_run():
    named = {name for part in PARTS if part != REST for name in _named(part)}
    ignored = _ignored()
    assert len(ignored) == len(set(ignored))
    assert set(ignored) == named


def test_the_parts_together_run_every_test_module_once():
    """The partition: each test module runs in exactly one part."""
    modules = {
        f"tests/{path.name}" for path in (REPO / "tests").glob("test_*.py")
    }
    named = {part: set(_named(part)) for part in PARTS if part != REST}
    rest = modules - set(_ignored())
    runs = {module: [] for module in modules}
    for part, files in named.items():
        for module in files:
            runs[module].append(part)
    for module in rest:
        runs[module].append(REST)
    assert {
        module: parts for module, parts in runs.items() if len(parts) != 1
    } == {}


def test_the_required_check_waits_for_every_part():
    aggregate = WORKFLOW["jobs"]["python-tests"]
    assert aggregate["name"] == "Python tests"
    assert aggregate["needs"] == "python-test-parts"
    assert aggregate["if"] == "always()"
    assert 'test "$PARTS" = success' in aggregate["steps"][0]["run"]


def test_each_part_is_one_line_of_arguments():
    """A part written with `|` or `>` instead of `>-` keeps newlines, which
    the shell's line breaks would turn into separate commands in CI."""
    assert {part: tests for part, tests in RAW.items() if "\n" in tests} == {}


def test_the_run_line_takes_its_paths_from_the_part_only():
    """The test step passes the part's arguments and adds no paths of its
    own, so the partition above is what CI runs."""
    run = next(
        step["run"]
        for step in JOB["steps"]
        if "pytest" in str(step.get("run", ""))
    )
    assert "${{ matrix.tests }}" in run
    words = run.replace("${{ matrix.tests }}", "").split()
    assert not [word for word in words if "tests" in word]
