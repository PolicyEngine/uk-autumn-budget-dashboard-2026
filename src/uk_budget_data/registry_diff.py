"""Which measures a change to the registry added or changed (#105).

The publish-measure workflow runs on a push to ``main`` that touches the
package, the lockfile or ``pyproject.toml``. It must publish exactly the
measures that push added or changed, so it compares the registry on two
revisions, by what each measure *is*, not by the lines of the diff:

- its name and description;
- its reform and baseline parameter changes;
- the code of its simulation modifiers, with every function and data value
  they reach in any ``uk_budget_data`` module (so a change to
  ``RAIL_FARE_INCREASES``, to a modifier in ``budget_measures.py`` or to a
  measure template it calls changes exactly the measures that use it).

Each revision's whole ``src/uk_budget_data`` is loaded in a subprocess of
its own, from that revision's files, so a change made only in
``budget_measures.py`` or ``measure_templates.py`` is seen, and the two
revisions never share module state or lazy caches. A change to code every
measure runs through (``CORE_PATHS``: the pipeline, the publication code,
the lockfile) publishes every measure and the combined run. Otherwise the
combined run is not a measure here: ``refresh-combined`` handles it.

Usage::

    uv run python -m uk_budget_data.registry_diff fingerprint FILE
    uv run uk-budget-data changed-measures --base HEAD^ --head HEAD
"""

from __future__ import annotations

import argparse
import functools
import hashlib
import importlib.util
import inspect
import io
import json
import math
import shutil
import subprocess
import sys
import tarfile
import tempfile
import types
from pathlib import Path
from typing import Any, Optional

REGISTRY_PATH = "src/uk_budget_data/reforms.py"
REGISTRY_FUNCTION = "get_autumn_budget_2026_reforms"
PACKAGE = "uk_budget_data"
PACKAGE_PATH = f"src/{PACKAGE}"
# Code every measure runs through, rather than code a measure's definition
# reaches: a change here publishes every measure and the combined run.
CORE_PATHS = (
    "src/uk_budget_data/pipeline.py",
    "src/uk_budget_data/parallel.py",
    "src/uk_budget_data/models.py",
    "src/uk_budget_data/publication/",
    "uv.lock",
    "pyproject.toml",
)
_DATA = (str, int, float, bool, type(None), list, tuple, dict, set, frozenset)


def _canonical(value: Any) -> Any:
    """A JSON-safe value that compares equal exactly when ``value`` does."""
    if isinstance(value, float):
        if math.isnan(value) or math.isinf(value):
            return f"float:{value}"
        return value
    if isinstance(value, dict):
        return {str(key): _canonical(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_canonical(item) for item in value]
    if isinstance(value, (set, frozenset)):
        return sorted(_canonical(item) for item in value)
    if hasattr(value, "item") and callable(value.item):  # numpy scalars
        return _canonical(value.item())
    return value


def _code_names(code: types.CodeType) -> set[str]:
    names = set(code.co_names)
    for const in code.co_consts:
        if isinstance(const, types.CodeType):
            names |= _code_names(const)
    return names


def _ours(value, module_name: str) -> bool:
    """Whether ``value`` is defined in the registry or the package."""
    owner = getattr(value, "__module__", None) or getattr(
        value, "__name__", ""
    )
    return (
        owner == module_name
        or owner == PACKAGE
        or owner.startswith(f"{PACKAGE}.")
    )


def _source_file(func) -> Optional[str]:
    try:
        return inspect.getsourcefile(func)
    except TypeError:
        return None


def _function_fingerprint(
    func, module_name: str, seen: set, files: Optional[set] = None
) -> Any:
    """A function's source, and what it reaches in the package."""
    if isinstance(func, functools.partial):
        return {
            "partial": _function_fingerprint(
                func.func, module_name, seen, files
            ),
            "args": _canonical(list(func.args)),
            "keywords": _canonical(dict(func.keywords)),
        }
    func = inspect.unwrap(func)
    if func in seen:
        return "<seen>"
    seen.add(func)
    if files is not None and (path := _source_file(func)):
        files.add(path)
    try:
        source = inspect.getsource(func)
    except (OSError, TypeError):
        code = getattr(func, "__code__", None)
        source = code.co_code.hex() if code else repr(func)
    reached = {}
    code = getattr(func, "__code__", None)
    module_globals = getattr(func, "__globals__", {})
    if code is not None:
        names = sorted(_code_names(code))
        for name in names:
            if name not in module_globals:
                continue
            value = module_globals[name]
            if inspect.isfunction(value) and _ours(value, module_name):
                reached[name] = _function_fingerprint(
                    value, module_name, seen, files
                )
            elif isinstance(value, _DATA) and not name.startswith("__"):
                reached[name] = _canonical(value)
            elif inspect.ismodule(value) and _ours(value, module_name):
                # ``budget_measures.helper``: the attribute's name is in the
                # same code's names, so follow those the module defines
                for attribute in names:
                    member = getattr(value, attribute, None)
                    key = f"{name}.{attribute}"
                    if inspect.isfunction(member) and _ours(
                        member, module_name
                    ):
                        reached[key] = _function_fingerprint(
                            member, module_name, seen, files
                        )
                    elif (
                        isinstance(member, _DATA)
                        and not attribute.startswith("__")
                        and attribute in vars(value)
                    ):
                        reached[key] = _canonical(member)
        closure = getattr(func, "__closure__", None) or ()
        for name, cell in zip(code.co_freevars, closure):
            try:
                value = cell.cell_contents
            except ValueError:
                continue
            if inspect.isfunction(value):
                reached[f"closure:{name}"] = _function_fingerprint(
                    value, module_name, seen, files
                )
            elif isinstance(value, _DATA):
                reached[f"closure:{name}"] = _canonical(value)
    return {"source": source, "reaches": reached}


def reform_fingerprint(
    reform, module_name: str, files: Optional[set] = None
) -> str:
    """One measure's identity as a SHA-256 of what it is.

    ``files``, when given, collects the source files the measure's
    modifiers reach, for the report of what each measure depends on.
    """
    document = {
        "name": reform.name,
        "description": reform.description,
        "parameter_changes": _canonical(reform.parameter_changes),
        "baseline_parameter_changes": _canonical(
            reform.baseline_parameter_changes
        ),
    }
    for key in ("simulation_modifier", "baseline_simulation_modifier"):
        modifier = getattr(reform, key)
        document[key] = (
            None
            if modifier is None
            else _function_fingerprint(modifier, module_name, set(), files)
        )
    text = json.dumps(document, sort_keys=True, default=repr)
    return hashlib.sha256(text.encode()).hexdigest()


def fingerprints(registry_file: Path) -> dict[str, str]:
    """Every measure's fingerprint in a registry file, in this process.

    Loads the file as a module of its own name, so call it in a fresh
    process (``fingerprints_in_subprocess``) to keep revisions apart.
    """
    module_name = "_registry_snapshot"
    spec = importlib.util.spec_from_file_location(
        module_name, Path(registry_file)
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    reforms = getattr(module, REGISTRY_FUNCTION)()
    return {
        reform.id: reform_fingerprint(reform, module_name)
        for reform in reforms
    }


def fingerprints_in_subprocess(registry_file: Path) -> dict[str, str]:
    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "uk_budget_data.registry_diff",
            "fingerprint",
            str(registry_file),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(result.stdout.strip().splitlines()[-1])


def package_fingerprints(src_dir: Path) -> dict[str, Any]:
    """Every measure's fingerprint, and the files it reaches, from one tree.

    Imports ``uk_budget_data.reforms`` from ``src_dir`` (a revision's
    ``src``), so call it in a fresh process
    (``package_fingerprints_in_subprocess``).
    """
    import importlib

    src_dir = Path(src_dir).resolve()
    sys.path.insert(0, str(src_dir))
    module = importlib.import_module(f"{PACKAGE}.reforms")
    origin = Path(module.__file__).resolve()
    if src_dir not in origin.parents:
        raise RuntimeError(f"imported {origin}, not the tree in {src_dir}")
    prints, files = {}, {}
    for reform in getattr(module, REGISTRY_FUNCTION)():
        reached: set = {str(origin)}
        prints[reform.id] = reform_fingerprint(
            reform, module.__name__, reached
        )
        files[reform.id] = sorted(
            f"src/{Path(path).resolve().relative_to(src_dir)}"
            for path in reached
            if src_dir in Path(path).resolve().parents
        )
    return {"fingerprints": prints, "files": files}


def package_fingerprints_in_subprocess(src_dir: Path) -> dict[str, Any]:
    # Run this file by path: the revision's package must be the only
    # ``uk_budget_data`` the process imports
    result = subprocess.run(
        [
            sys.executable,
            str(Path(__file__).resolve()),
            "fingerprint-package",
            str(src_dir),
        ],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"fingerprinting {src_dir} failed:\n{result.stderr[-2000:]}"
        )
    return json.loads(result.stdout.strip().splitlines()[-1])


def changed_ids(
    before: dict[str, str],
    after: dict[str, str],
    combined_id: Optional[str] = None,
) -> list[str]:
    """Measures added or changed between two fingerprint maps.

    In ``after``'s order. Removed measures are not listed: nothing is
    published for them (``removed_ids`` names them).
    """
    return [
        measure
        for measure, digest in after.items()
        if measure != combined_id and before.get(measure) != digest
    ]


def removed_ids(before: dict[str, str], after: dict[str, str]) -> list[str]:
    return [measure for measure in before if measure not in after]


def _exists(revision: str, path: str, repo: Path) -> bool:
    return (
        subprocess.run(
            ["git", "cat-file", "-e", f"{revision}:{path}"],
            cwd=repo,
            capture_output=True,
        ).returncode
        == 0
    )


def _fingerprints_at(
    revision: str, repo: Path, directory: Path
) -> dict[str, Any]:
    """Every measure's fingerprint, and its files, at ``revision``.

    A revision with the whole package is fingerprinted from its own tree:
    the installed package is laid down first and the revision's files over
    it, so a module the revision lacks still imports. A revision with only
    a registry file (the tests' repositories) is fingerprinted from that
    file alone; one with no registry (an unborn base) has no measures.
    """
    empty = {"fingerprints": {}, "files": {}}
    if not _exists(revision, REGISTRY_PATH, repo):
        return empty
    folder = Path(tempfile.mkdtemp(dir=directory))
    if not _exists(revision, f"{PACKAGE_PATH}/__init__.py", repo):
        registry = folder / "reforms.py"
        registry.parent.mkdir(parents=True)
        registry.write_text(
            subprocess.run(
                ["git", "show", f"{revision}:{REGISTRY_PATH}"],
                cwd=repo,
                capture_output=True,
                text=True,
                check=True,
            ).stdout
        )
        return {
            "fingerprints": fingerprints_in_subprocess(registry),
            "files": {},
        }
    src = folder / "src"
    shutil.copytree(
        Path(__file__).resolve().parent,
        src / PACKAGE,
        ignore=shutil.ignore_patterns("__pycache__"),
    )
    archive = subprocess.run(
        ["git", "archive", revision, PACKAGE_PATH],
        cwd=repo,
        capture_output=True,
        check=True,
    )
    with tarfile.open(fileobj=io.BytesIO(archive.stdout)) as tar:
        tar.extractall(folder, filter="data")
    return package_fingerprints_in_subprocess(src)


def changed_files(base: str, head: str, repo: Path) -> Optional[list[str]]:
    """Paths changed from ``base`` to ``head``, or None if base is unborn."""
    diff = subprocess.run(
        ["git", "diff", "--name-only", base, head],
        cwd=repo,
        capture_output=True,
        text=True,
    )
    if diff.returncode != 0:
        return None
    return [line for line in diff.stdout.splitlines() if line]


def core_changes(paths: list[str]) -> list[str]:
    """The changed paths every measure runs through (``CORE_PATHS``)."""
    return [
        path
        for path in paths
        if any(
            path == core or (core.endswith("/") and path.startswith(core))
            for core in CORE_PATHS
        )
    ]


def changed_between(
    base: str, head: str, repo: Path = Path(".")
) -> dict[str, Any]:
    """What a push from ``base`` to ``head`` publishes.

    ``changed``: the measures to run, in the registry's order; ``removed``:
    measures gone at ``head``; ``combined``: whether the combined run is
    out of date too; ``core``: the changed paths every measure runs through
    (if any, every measure is in ``changed``); ``files``: each measure's
    files at ``head``, for the log.
    """
    from uk_budget_data.reforms import AUTUMN_BUDGET_2026_COMBINED_ID

    repo = Path(repo)
    with tempfile.TemporaryDirectory() as directory:
        directory = Path(directory)
        results = {
            name: _fingerprints_at(revision, repo, directory)
            for name, revision in (("before", base), ("after", head))
        }
    before = results["before"]["fingerprints"]
    after = results["after"]["fingerprints"]
    paths = changed_files(base, head, repo)
    core = core_changes(paths) if paths is not None else []
    if core:
        changed = [m for m in after if m != AUTUMN_BUDGET_2026_COMBINED_ID]
    else:
        changed = changed_ids(before, after, AUTUMN_BUDGET_2026_COMBINED_ID)
    return {
        "changed": changed,
        "removed": removed_ids(before, after),
        "combined": bool(core or changed or removed_ids(before, after)),
        "core": core,
        "files": {
            measure: results["after"]["files"].get(measure, [])
            for measure in changed
        },
    }


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="command", required=True)
    one = sub.add_parser("fingerprint", help="Fingerprint one registry file")
    one.add_argument("file", type=Path)
    package = sub.add_parser(
        "fingerprint-package", help="Fingerprint a revision's package tree"
    )
    package.add_argument("src", type=Path)
    arguments = parser.parse_args(argv)
    if arguments.command == "fingerprint-package":
        print(json.dumps(package_fingerprints(arguments.src)))
        return 0
    print(json.dumps(fingerprints(arguments.file), sort_keys=False))
    return 0


if __name__ == "__main__":
    # Run by path (package_fingerprints_in_subprocess), this file's folder
    # leads sys.path; drop it so the package's modules never shadow others
    here = str(Path(__file__).resolve().parent)
    sys.path[:] = [entry for entry in sys.path if entry != here]
    sys.exit(main())
