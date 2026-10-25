"""Which measures a change to the registry added or changed (#105).

The publish-measure workflow runs on a push to ``main`` that touches
``src/uk_budget_data/reforms.py``. It must publish exactly the measures that
push added or changed, so it compares the registry on two revisions, by
what each measure *is*, not by the lines of the diff:

- its name and description;
- its reform and baseline parameter changes;
- the code of its simulation modifiers, with every module-level function
  and data value they reach (so a change to ``RAIL_FARE_INCREASES`` changes
  the rail fares freeze).

Each revision's ``reforms.py`` is loaded in a subprocess of its own, from a
file, so the two registries never share module state or lazy caches. The
combined run is not a measure here: ``refresh-combined`` handles it.

Usage::

    uv run python -m uk_budget_data.registry_diff fingerprint FILE
    uv run uk-budget-data changed-measures --base HEAD^ --head HEAD
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import inspect
import json
import math
import subprocess
import sys
import tempfile
import types
from pathlib import Path
from typing import Any, Optional

REGISTRY_PATH = "src/uk_budget_data/reforms.py"
REGISTRY_FUNCTION = "get_autumn_budget_2026_reforms"
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


def _function_fingerprint(func, module_name: str, seen: set) -> Any:
    """A function's source, and what it reaches in its own module."""
    func = inspect.unwrap(func)
    if func in seen:
        return "<seen>"
    seen.add(func)
    try:
        source = inspect.getsource(func)
    except (OSError, TypeError):
        code = getattr(func, "__code__", None)
        source = code.co_code.hex() if code else repr(func)
    reached = {}
    code = getattr(func, "__code__", None)
    module_globals = getattr(func, "__globals__", {})
    if code is not None:
        for name in sorted(_code_names(code)):
            if name not in module_globals:
                continue
            value = module_globals[name]
            if (
                inspect.isfunction(value)
                and getattr(value, "__module__", None) == module_name
            ):
                reached[name] = _function_fingerprint(value, module_name, seen)
            elif isinstance(value, _DATA) and not name.startswith("__"):
                reached[name] = _canonical(value)
        closure = getattr(func, "__closure__", None) or ()
        for name, cell in zip(code.co_freevars, closure):
            try:
                value = cell.cell_contents
            except ValueError:
                continue
            if inspect.isfunction(value):
                reached[f"closure:{name}"] = _function_fingerprint(
                    value, module_name, seen
                )
            elif isinstance(value, _DATA):
                reached[f"closure:{name}"] = _canonical(value)
    return {"source": source, "reaches": reached}


def reform_fingerprint(reform, module_name: str) -> str:
    """One measure's identity as a SHA-256 of what it is."""
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
            else _function_fingerprint(modifier, module_name, set())
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


def _registry_at(revision: str, repo: Path, directory: Path) -> Path:
    """The registry file at ``revision`` (empty if it did not exist)."""
    target = directory / f"reforms_{len(list(directory.iterdir()))}.py"
    shown = subprocess.run(
        ["git", "show", f"{revision}:{REGISTRY_PATH}"],
        cwd=repo,
        capture_output=True,
        text=True,
    )
    target.write_text(
        shown.stdout
        if shown.returncode == 0
        else f"def {REGISTRY_FUNCTION}():\n    return []\n"
    )
    return target


def changed_between(
    base: str, head: str, repo: Path = Path(".")
) -> dict[str, list[str]]:
    """``{"changed": [...], "removed": [...]}`` between two revisions."""
    from uk_budget_data.reforms import AUTUMN_BUDGET_2026_COMBINED_ID

    with tempfile.TemporaryDirectory() as directory:
        directory = Path(directory)
        before = fingerprints_in_subprocess(
            _registry_at(base, repo, directory)
        )
        after = fingerprints_in_subprocess(_registry_at(head, repo, directory))
    return {
        "changed": changed_ids(before, after, AUTUMN_BUDGET_2026_COMBINED_ID),
        "removed": removed_ids(before, after),
    }


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="command", required=True)
    one = sub.add_parser("fingerprint", help="Fingerprint one registry file")
    one.add_argument("file", type=Path)
    arguments = parser.parse_args(argv)
    print(json.dumps(fingerprints(arguments.file), sort_keys=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
