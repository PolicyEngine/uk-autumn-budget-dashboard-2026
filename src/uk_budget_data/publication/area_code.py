"""The code results by area are computed with, and whether it has changed.

Results by area (``regional.csv``, ``constituency.csv``) depend on three
things: each reform's definition, the local-area dataset, and the code that
turns them into area figures. ``publish index`` binds the tables to those
(``release_index.area_problems``), not to the national artifacts, so a
national rerun that leaves all three unchanged keeps the map published.

This module answers the code question: did any file that can change an area
figure change since the commit the area run was made at? The answer comes
from ``AREA_CODE_PATHS`` and ``AREA_CODE_SYMBOLS`` below, a reviewed list.
It is deliberately the opposite of ``receipt.is_non_calculation_path``: that
lists what cannot change a national calculation and counts everything else,
because a refused national run costs minutes. Here a refused area run costs
a 45-minute Modal run, so the list names what can change an area figure, and
everything else does not count. When in doubt a path is listed: missing one
would publish a map made with other code than the page's national figures.
"""

import ast
import re
import subprocess
from pathlib import Path
from typing import Optional

# Each path (a file, or a directory ending in "/") that can change an area
# figure, and why. A change to any file under a directory counts.
AREA_CODE_PATHS = {
    # -- the area run itself -------------------------------------------------
    "src/uk_budget_data/geography.py": (
        "The area run: per-area simulations, the estimator's inputs, the "
        "disclosure release, the public tables and the package aliases "
        "(PACKAGES)."
    ),
    "src/uk_budget_data/constituencies.py": (
        "Results by constituency on the local-area cut: the plan, each "
        "measure's unit, its reuse key and the release."
    ),
    "src/uk_budget_data/constituencies_remote.py": (
        "A measure's unit as it runs in a Modal container."
    ),
    "src/uk_budget_data/modal_constituencies.py": (
        "The Modal app the constituency run uses."
    ),
    "src/uk_budget_data/modal_constituencies_runner.py": (
        "Starts the Modal units and reads their results back."
    ),
    "src/uk_budget_data/area_routing.py": (
        "Which dataset the installed bundle routes constituencies to."
    ),
    "src/uk_budget_data/certified_data.py": (
        "Reads the bundle manifest and resolves the datasets a run loads."
    ),
    "src/uk_budget_data/runtime_identity.py": (
        "The installed package versions, part of a unit's reuse key: a "
        "change could reuse a unit made with another model."
    ),
    "src/uk_budget_data/parallel.py": (
        "Runs measures in worker processes and resolves each reform there "
        "(resolve_reform, portable_combined)."
    ),
    "src/uk_budget_data/__init__.py": ("Runs on every import of the package."),
    # -- what a reform is ------------------------------------------------------
    "src/uk_budget_data/budget_measures/": (
        "Each measure's definition: its parameter changes and its simulation "
        "modifier. A modifier's own module is also in its definition digest, "
        "but the modules it imports are not."
    ),
    "src/uk_budget_data/reforms.py": (
        "The measure registry (get_reform) and the parameter changes written "
        "there."
    ),
    "src/uk_budget_data/measure_templates.py": (
        "The templates the modifiers call (rate and threshold changes, "
        "formula replacement)."
    ),
    "src/uk_budget_data/forecast/": (
        "The forecast every scenario runs with (with_forecast), baseline "
        "and reform."
    ),
    "src/uk_budget_data/budget_years.py": (
        "The policy years a reform's parameter changes cover."
    ),
    "src/uk_budget_data/budget_years.json": "Read by budget_years.py.",
    "src/uk_budget_data/publication/combine.py": (
        "How a package's members are composed into one run."
    ),
    # -- what the area run withholds -------------------------------------------
    "src/uk_budget_data/data_limits.py": (
        "Data limits: a measure touching one writes no area tables."
    ),
    "src/uk_budget_data/model_limits.py": (
        "Model limits: which area rows are held."
    ),
    # -- inputs read from the repository ---------------------------------------
    "data_inputs/regions.csv": "The region lookup (geography.REGIONS_FILE).",
    "data_inputs/constituencies_2024.csv": (
        "The seat lookup and each seat's region (geography.SEATS_FILE)."
    ),
    # -- the installed model ---------------------------------------------------
    "uv.lock": (
        "The installed policyengine-uk, policyengine (its disclosure layer "
        "and estimator) and policyengine-core: a new model changes area "
        "figures."
    ),
    "pyproject.toml": "The dependency pins uv.lock is resolved from.",
}

# Files the area run uses only part of. A change to one of these counts when
# it changes a named top-level definition or anything at module level that
# definition uses, directly or through another such name (an import, a
# constant, a helper), or any top-level statement that binds no name. The
# rest of the file is the national pipeline, which the area run never calls:
# #320 added the official-basis table there and to ReformResult.
AREA_CODE_SYMBOLS = {
    "src/uk_budget_data/pipeline.py": {
        "build_microsimulation": (
            "Builds every simulation the area run makes, on the installed "
            "bundle, with the forecast applied."
        ),
    },
    "src/uk_budget_data/models.py": {
        "DataConfig": "The years and dataset a reform is built for.",
        "Reform": (
            "How a measure becomes a scenario (to_scenario) and which "
            "baseline it runs against (baseline_scenario_for)."
        ),
    },
}

# Modules the area run's code imports that cannot change an area figure,
# and why. Every uk_budget_data module the listed files import must be
# listed, sliced or named here (test_area_code_revision.py checks it), so a
# new import is a reviewed choice. These are not followed further.
AREA_CODE_EXEMPT = {
    "src/uk_budget_data/modal_runner.py": (
        "The national generator's Modal runner. parallel.make_runner "
        "imports it only for backend='modal', and the area run's one call "
        "(geography._geography_runner) passes no backend, so it runs "
        "locally; the constituency run's Modal backend is "
        "modal_constituencies.py, which is listed. A test checks the call."
    ),
    "src/uk_budget_data/private_outputs.py": (
        "Picks and creates the private audit directory (owner-only, never "
        "inside a git repository). No figure passes through it: a unit's "
        "reuse is decided by its key (constituencies._key, code_digest), "
        "not by where it is kept."
    ),
    "src/uk_budget_data/sign_off.py": (
        "REQUIRED only decides whether the run prints the tables' review "
        "rows, and whether hand-written modifiers need attestations to be "
        "staged nationally; neither changes a table."
    ),
    "src/uk_budget_data/publication/__init__.py": "Empty package marker.",
    "src/uk_budget_data/publication/area_code.py": (
        "This list: it decides when the area run must be rerun, not what "
        "it computes."
    ),
    "src/uk_budget_data/publication/manifest.py": (
        "Reads the publication manifest (which reforms are approved); the "
        "approvals are checked by status and key, not through this code's "
        "figures."
    ),
    "src/uk_budget_data/publication/receipt.py": (
        "Binds scenario identities and checks the approved commit. A change "
        "in how it hashes changes the recorded definitions, which publish "
        "index recomputes and compares, so it refuses rather than passes."
    ),
    "src/uk_budget_data/publication/release_index.py": (
        "Writes and checks area_provenance.json: the record, not the tables."
    ),
    "src/uk_budget_data/publication/artifacts.py": (
        "Reads the approved artifacts' receipts for combine.py's checks; "
        "the package is composed from the members' definitions."
    ),
}

_FULL_COMMIT = re.compile(r"[0-9a-f]{40}\Z|[0-9a-f]{64}\Z")


def is_area_path(path: str) -> bool:
    """Whether a change to ``path`` can change an area figure, whatever it
    changes (``AREA_CODE_PATHS``). Sliced files are not area paths: see
    :func:`area_changes_between`."""
    parts = path.split("/")
    if not path or any(part in ("", ".", "..") for part in parts):
        return False
    return any(
        path.startswith(listed) if listed.endswith("/") else path == listed
        for listed in AREA_CODE_PATHS
    )


def _git(repo_root: Path, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git", *args], cwd=repo_root, capture_output=True, text=True
    )


def _bound_names(statement: ast.stmt) -> list[str]:
    """The module-level names a simple binding statement binds."""
    if isinstance(statement, (ast.FunctionDef, ast.AsyncFunctionDef)):
        return [statement.name]
    if isinstance(statement, ast.ClassDef):
        return [statement.name]
    if isinstance(statement, (ast.Import, ast.ImportFrom)):
        return [
            (alias.asname or alias.name).split(".")[0]
            for alias in statement.names
        ]
    targets = []
    if isinstance(statement, ast.Assign):
        targets = statement.targets
    elif isinstance(statement, (ast.AnnAssign, ast.AugAssign)):
        targets = [statement.target]
    return [
        node.id
        for target in targets
        for node in ast.walk(target)
        if isinstance(node, ast.Name)
    ]


def _plain_target(target: ast.expr) -> bool:
    """Whether an assignment target only binds names (``x``, ``x, y``)."""
    if isinstance(target, ast.Name):
        return True
    if isinstance(target, ast.Starred):
        return _plain_target(target.value)
    if isinstance(target, (ast.Tuple, ast.List)):
        return all(_plain_target(element) for element in target.elts)
    return False


def _has_side_effect(statement: ast.stmt) -> bool:
    """An assignment to anything but a plain name: ``os.environ["X"] = ...``
    or ``module.X = ...`` changes state other modules see when this module
    is imported, whichever names the sliced definitions use (María, #362)."""
    if isinstance(statement, ast.Assign):
        targets = statement.targets
    elif isinstance(statement, (ast.AnnAssign, ast.AugAssign)):
        targets = [statement.target]
    else:
        return False
    return not all(_plain_target(target) for target in targets)


def _imported_modules(tree: ast.Module) -> list[str]:
    """The modules a module imports at its top level, sorted: importing one
    runs it, so a new or dropped import can change what the sliced
    definitions see even if they use none of its names."""
    modules = set()
    for statement in tree.body:
        if isinstance(statement, ast.Import):
            modules.update(alias.name for alias in statement.names)
        elif isinstance(statement, ast.ImportFrom):
            modules.add("." * statement.level + (statement.module or ""))
    return sorted(modules)


def _slice(source: Optional[str], wanted) -> Optional[str]:
    """What the named top-level definitions of a module depend on, as a
    comparable string, or None when the file is absent.

    Each import is reduced to the alias a used name comes from, so adding
    an unused name to an import does not count. Positions and comments do
    not count; docstrings do. Always counted, whatever the definitions use:
    a top-level statement that binds no name, an assignment to anything
    but a plain name (``_has_side_effect``), and the set of modules the
    file imports (``_imported_modules``).
    """
    if source is None:
        return None
    try:
        tree = ast.parse(source)
    except SyntaxError:
        # Not comparable: always a change
        return f"unparsable:{source}"
    bindings: dict[str, list[str]] = {}
    always = []
    for index, statement in enumerate(tree.body):
        if (
            index == 0
            and isinstance(statement, ast.Expr)
            and isinstance(statement.value, ast.Constant)
            and isinstance(statement.value.value, str)
        ):
            continue  # the module docstring
        bound_here = _bound_names(statement)
        if not bound_here or _has_side_effect(statement):
            always.append(ast.dump(statement))
            continue
        if isinstance(statement, (ast.Import, ast.ImportFrom)):
            module = getattr(statement, "module", None)
            level = getattr(statement, "level", 0)
            for alias in statement.names:
                bound = (alias.asname or alias.name).split(".")[0]
                bindings.setdefault(bound, []).append(
                    f"import {level}:{module}:{alias.name}:{alias.asname}"
                )
        else:
            for name in bound_here:
                bindings.setdefault(name, []).append(ast.dump(statement))
    used, pending = set(), list(wanted)
    parts = []
    while pending:
        name = pending.pop()
        if name in used:
            continue
        used.add(name)
        for dumped in bindings.get(name, []):
            parts.append(f"{name}={dumped}")
            if dumped.startswith("import "):
                continue
            # Every name the binding mentions may be another binding
            pending.extend(
                re.findall(r"id='([A-Za-z_][A-Za-z0-9_]*)'", dumped)
            )
        if name in wanted and name not in bindings:
            parts.append(f"{name}=<missing>")
    modules = "modules=" + ",".join(_imported_modules(tree))
    return "\n".join(sorted(parts) + always + [modules])


def _source_at(
    revision: Optional[str], path: str, repo_root: Path
) -> Optional[str]:
    """A file's text at a commit, or in the working tree for None."""
    if revision is None:
        file = Path(repo_root) / path
        return file.read_text() if file.is_file() else None
    shown = _git(repo_root, "show", f"{revision}:{path}")
    return shown.stdout if shown.returncode == 0 else None


def _changed(old: str, new: Optional[str], repo_root: Path) -> list[str]:
    """Paths whose bytes differ between commit ``old`` and commit ``new``
    (the working tree, untracked files included, for None)."""
    if new is None:
        listed = _git(
            repo_root, "diff", "--name-only", "--no-renames", "-z", old
        )
        untracked = _git(
            repo_root, "ls-files", "--others", "--exclude-standard", "-z"
        )
        if listed.returncode != 0 or untracked.returncode != 0:
            raise ValueError(
                f"git could not list the changes since {old[:12]}: "
                + (listed.stderr or untracked.stderr).strip()
            )
        output = listed.stdout + untracked.stdout
    else:
        listed = _git(
            repo_root, "diff", "--name-only", "--no-renames", "-z", old, new
        )
        if listed.returncode != 0:
            raise ValueError(
                f"git could not compare {old[:12]} and {new[:12]}: "
                + listed.stderr.strip()
            )
        output = listed.stdout
    return sorted({path for path in output.split("\0") if path})


def _area_paths(old: str, new: Optional[str], repo_root: Path) -> list[str]:
    """The changed paths that can change an area figure, a sliced file
    named with the definitions whose slice changed."""
    found = []
    for path in _changed(old, new, repo_root):
        if is_area_path(path):
            found.append(path)
        elif path in AREA_CODE_SYMBOLS:
            names = AREA_CODE_SYMBOLS[path]
            if _slice(_source_at(old, path, repo_root), names) != _slice(
                _source_at(new, path, repo_root), names
            ):
                found.append(f"{path} ({', '.join(sorted(names))})")
    return found


def _require_commit(git_sha: str, label: str, repo_root: Path) -> None:
    if not isinstance(git_sha, str) or not _FULL_COMMIT.fullmatch(git_sha):
        raise ValueError(f"{label} records no full commit sha ({git_sha!r})")
    if (
        _git(
            repo_root, "merge-base", "--is-ancestor", git_sha, "HEAD"
        ).returncode
        != 0
    ):
        raise ValueError(
            f"{label} commit {git_sha[:12]} is not an ancestor of HEAD"
        )


def area_changes_between(
    old: str, new: str, repo_root: Path = Path(".")
) -> list[str]:
    """The area-relevant paths that differ between two commits HEAD
    descends from, in either order.

    A rename counts as both of its paths. A sliced file
    (``AREA_CODE_SYMBOLS``) counts only when what its named definitions
    use changed.
    """
    _require_commit(old, "the area run", repo_root)
    _require_commit(new, "the approved receipt", repo_root)
    if old == new:
        return []
    return _area_paths(old, new, repo_root)


def area_changes_since(git_sha: str, repo_root: Path = Path(".")) -> list[str]:
    """The area-relevant paths changed since the area run's commit, in the
    commits since and in the working tree (uncommitted and untracked).

    ``git_sha`` must be a full commit sha that HEAD descends from, as for
    ``receipt.calculation_changes_since``. Raises ValueError otherwise.
    """
    _require_commit(git_sha, "the area run", repo_root)
    return _area_paths(git_sha, None, repo_root)
