"""The definition each household skip rule's last check ran on.

``household_impact.rule_says_unaffected`` says a measure is exactly £0 for a
household and year. That is a statement about the measure as it stood when
the rule last passed a check against full runs, so
``household_skip_rules.json`` records, for each rule, the digest of that
definition.
``rule_is_current`` compares that with the running code's digest. A rule
whose digest differs is off: the household calculation runs the measure in
full, so the answer stays right and only gets slower, until
``scripts/verify_household_skips.py --recheck`` checks the rule again and
records the new digest (docs/budget-day-runbook.md, "Fewer runs").

A digest covers what a measure's own run reads from the definitions:

- the measure's two sides, as a publication receipt binds them
  (``publication.receipt.measure_identities`` at ``DEFINITION_REVISION``, so
  no commit is in it): parameter changes by content, a modifier by its
  source, its module's source and its default arguments. A measure's name
  and description are labels, not part of it;
- the sides as its own run takes them (``household_impact.measure_sides``,
  with every measure selected), because a receipt and a run reach a measure's
  baseline by different code. These keep their order, which a receipt's digest
  sorts away: the engine applies writes in order, and a later one for the same
  dates replaces an earlier one;
- every registered measure's pre-Budget side, where it has one of its own,
  because each measure's own run holds the other selected measures there
  (the savings income rule depends on the planned cash ISA limit, for one);
- the source of every module of this package that a modifier's module imports,
  directly or through another, and of every package initializer those imports
  run (``_imported_code``), which a receipt binds only through its commit.
  ``CANNOT_CHANGE_A_NUMBER`` names the exceptions;
- the source of this package's own initializer, which every import of it runs.
  What that initializer imports counts only for a module that names the package
  (``from uk_budget_data import x``, ``import uk_budget_data.x``). It imports
  most of the package, so following it from every import would turn every rule
  off at any edit to anything.

It does not cover the rest of the household calculation, the forecast or the
engine. The differential test in ``tests/test_household_skips.py`` runs the
rules that are current against the engine on every CI run, so a change to any
of them that breaks a rule for a household it runs fails there. The walk reads
import statements, so it doesn't see a module loaded by name or a file a
modifier opens: no modifier does either today, and that test is what would show
one that broke a rule.

A definition the code can't work out counts as changed: a rule is on only when
the code knows its digest matches. As in ``definitions``, a warning attributed
to a bound module leaves it unbindable, so the code works out every digest
together on first use, before the process runs anything, and keeps them. It
keeps a refusal too: for a speed-up, the answer stays right, and the process
logs it once.
"""

import ast
import hashlib
import importlib
import json
import logging
from collections.abc import Iterable, Mapping
from functools import lru_cache
from importlib.resources import files
from importlib.util import resolve_name
from pathlib import Path
from typing import Optional

from uk_budget_data.definitions import identity_core
from uk_budget_data.models import DataConfig
from uk_budget_data.publication.receipt import (
    DEFINITION_REVISION,
    measure_identities,
)
from uk_budget_data.reforms import (
    AUTUMN_BUDGET_2026_COMBINED_ID,
    get_autumn_budget_2026_reforms,
)

logger = logging.getLogger(__name__)

CHECKED_FILE = "household_skip_rules.json"

# The package whose modules a digest reads when a modifier imports them.
PACKAGE = "uk_budget_data"
# Modules a modifier's code imports that a digest leaves out. measure_templates
# reads them only to warn about a limit on a change (_warn_if_data_limited and
# the like) and to refuse a wealth tax scale, and their lists change with every
# review of a data cut.
CANNOT_CHANGE_A_NUMBER = frozenset(
    {"uk_budget_data.data_limits", "uk_budget_data.model_limits"}
)

# What ``rule_statuses`` reports for a measure.
CURRENT = "current"
CHANGED = "changed since its last check"
NEVER_CHECKED = "never checked"
NO_DEFINITION = "definition unavailable"
NO_RULE = "no rule"
NOT_REGISTERED = "not a registered measure"


def checked_definitions() -> dict:
    """``{measure id: the digest of the definition its rule's last check ran
    on}``, as committed. Unreadable, it is empty: every rule off, the answers
    right."""
    return _read_checked()


@lru_cache(maxsize=1)
def _read_checked() -> dict:
    try:
        checked = json.loads(
            files("uk_budget_data").joinpath(CHECKED_FILE).read_text()
        )
        if not isinstance(checked, dict):
            raise ValueError(f"{CHECKED_FILE} is not an object")
    except (OSError, ValueError) as error:
        logger.warning("Household skip rules are all off: %s", error)
        return {}
    return checked


def _digest(content: dict) -> str:
    return hashlib.sha256(
        json.dumps(content, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def _source_file(module: str) -> Optional[Path]:
    """The file of a module of this package, or None for anything else: a
    name that is not in the package, or that names something in a module."""
    top, *rest = module.split(".")
    if top != PACKAGE:
        return None
    base = Path(importlib.import_module(top).__file__).parent.joinpath(*rest)
    for path in (base / "__init__.py", base.with_suffix(".py")):
        if path.is_file():
            return path
    return None


def _imports_of(module: str, path: Path) -> set:
    """The modules of this package that the import statements in a module's
    source name or bind, wherever in the file they sit."""
    package = (
        module if path.name == "__init__.py" else module.rpartition(".")[0]
    )
    named = set()
    for node in ast.walk(ast.parse(path.read_bytes())):
        if isinstance(node, ast.Import):
            for alias in node.names:
                named.add(alias.name)
                if alias.asname is None:
                    # "import a.b" binds a
                    named.add(alias.name.partition(".")[0])
        elif isinstance(node, ast.ImportFrom):
            base = resolve_name(
                "." * node.level + (node.module or ""), package
            )
            # "from a import b" runs a, which can bind b itself whether or
            # not there is a module a.b
            named.add(base)
            named.update(f"{base}.{alias.name}" for alias in node.names)
    return {name for name in named if _source_file(name)}


def _packages_above(module: str) -> set:
    """The packages Python runs on its way to a module, but for the top one:
    every import of this package runs that, and ``_shared_code`` reads it."""
    parts = module.split(".")
    return {
        name
        for name in (".".join(parts[:end]) for end in range(2, len(parts)))
        if _source_file(name)
    }


def _imported_code(modules: Iterable[str]) -> set:
    """Every module of this package these modules import, directly or through
    another, and the packages above them, but for ``CANNOT_CHANGE_A_NUMBER``.
    A module only in ``modules`` isn't in it: its own measure's identity reads
    its source."""
    found, stack = set(), list(modules)
    while stack:
        module = stack.pop()
        path = _source_file(module)
        if path is None:
            continue
        reached = _imports_of(module, path) | _packages_above(module)
        for name in reached - CANNOT_CHANGE_A_NUMBER - found:
            found.add(name)
            stack.append(name)
    return found


def _modifier_modules(measures: list) -> set:
    return {
        modifier.__module__
        for measure in measures
        for modifier in (
            measure.simulation_modifier,
            measure.baseline_simulation_modifier,
        )
        if modifier is not None
    }


def _shared_code(measures: list) -> dict:
    """``{module: the digest of its source}``, for the code the measures'
    modifiers import and this package's own initializer."""
    modules = {PACKAGE, *_imported_code(_modifier_modules(measures))}
    return {
        module: hashlib.sha256(_source_file(module).read_bytes()).hexdigest()
        for module in modules
    }


def _in_the_order_they_run(side: dict) -> dict:
    """A side with its parameter changes as lists, which ``_digest`` keeps in
    order as it wouldn't an object's keys. The engine applies them in this
    order (``read_parameter_changes``), so reordering them can change a run."""
    return {
        **side,
        "parameter_changes": [
            [
                path,
                (
                    list(periods.items())
                    if isinstance(periods, Mapping)
                    else periods
                ),
            ]
            for path, periods in side["parameter_changes"].items()
        ],
    }


def _as_run(measure_ids: list, config: DataConfig) -> dict:
    """``{measure id: its own run's two sides}``, with every measure selected:
    parameter changes by content and in order, modifiers by name, as the
    calculation composes them."""
    # Here, not at the top: household_impact imports this module.
    from uk_budget_data.household_impact import measure_sides

    sides = measure_sides(measure_ids, config)
    before = _in_the_order_they_run(sides.before)
    return {
        id_: {"before": before, "own_run": _in_the_order_they_run(own_run)}
        for id_, own_run in sides.singles.items()
    }


def _definitions_now() -> dict:
    config = DataConfig()
    measures = [
        measure
        for measure in get_autumn_budget_2026_reforms()
        if measure.id != AUTUMN_BUDGET_2026_COMBINED_ID
    ]
    with_pre_budget_side = {
        measure.id
        for measure in measures
        if measure.baseline_scenario_for(config) is not None
    }
    sides = {}
    for measure in measures:
        try:
            baseline, reform = measure_identities(
                measure, config, DEFINITION_REVISION
            )
        except Exception as error:
            logger.warning(
                "%s has no definition, so its skip rule is off: %s",
                measure.id,
                error,
            )
            continue
        sides[measure.id] = {
            "baseline": identity_core(baseline),
            "reform": identity_core(reform),
        }
    if not with_pre_budget_side <= set(sides):
        # Every measure's own run holds these sides, so no digest is known.
        return {}
    pre_budget_sides = {
        id_: sides[id_]["baseline"] for id_ in with_pre_budget_side
    }
    as_run = _as_run([measure.id for measure in measures], config)
    shared_code = _shared_code(measures)
    return {
        id_: _digest(
            {
                "as_run": as_run[id_],
                "measure": side,
                "pre_budget_sides": pre_budget_sides,
                "shared_code": shared_code,
            }
        )
        for id_, side in sides.items()
    }


@lru_cache(maxsize=1)
def current_definitions() -> dict:
    """``{measure id: its definition digest}``, for every registered measure
    whose definition the running code can work out."""
    try:
        return _definitions_now()
    except Exception as error:
        logger.warning("Household skip rules are all off: %s", error)
        return {}


def clear_definition_cache() -> None:
    """For a test that changes the registry or the checked digests."""
    _read_checked.cache_clear()
    current_definitions.cache_clear()


def rule_is_current(measure_id: str) -> bool:
    """Whether the last check of the rule for ``measure_id`` ran on the
    definition the running code has. False for a measure with no recorded
    check, a measure the registry doesn't have, and a definition unavailable.
    """
    current = current_definitions()
    checked = checked_definitions().get(measure_id)
    return checked is not None and current.get(measure_id) == checked


def rule_statuses(rules: Iterable[str]) -> dict:
    """``{measure id: status}``: every registered measure, and every rule or
    recorded check naming a measure the registry doesn't have."""
    rules = set(rules)
    checked = checked_definitions()
    current = current_definitions()
    registered = [
        measure.id
        for measure in get_autumn_budget_2026_reforms()
        if measure.id != AUTUMN_BUDGET_2026_COMBINED_ID
    ]

    def status(id_: str) -> str:
        if id_ not in registered:
            return NOT_REGISTERED
        if id_ not in rules:
            return NO_RULE
        if id_ not in checked:
            return NEVER_CHECKED
        if id_ not in current:
            return NO_DEFINITION
        return CURRENT if current[id_] == checked[id_] else CHANGED

    named = {*registered, *rules, *checked}
    return {id_: status(id_) for id_ in sorted(named)}


def record_checked(measure_ids: Iterable[str]) -> Path:
    """Record the running code's digests as checked for ``measure_ids``,
    leaving the others' as they are. Returns the file written."""
    current = current_definitions()
    checked = dict(checked_definitions())
    for id_ in measure_ids:
        checked[id_] = current[id_]
    return _write_checked(checked)


def forget_checked(measure_ids: Iterable[str]) -> Path:
    """Turn these rules off whatever their digests say: a check found them
    wrong. Returns the file written."""
    wrong = set(measure_ids)
    return _write_checked(
        {
            id_: digest
            for id_, digest in checked_definitions().items()
            if id_ not in wrong
        }
    )


def _write_checked(checked: dict) -> Path:
    path = Path(str(files("uk_budget_data").joinpath(CHECKED_FILE)))
    path.write_text(json.dumps(checked, indent=2, sort_keys=True) + "\n")
    # Only the record: this process keeps the digests it worked out, so a
    # recheck records the definition it started on, not one edited since.
    _read_checked.cache_clear()
    return path
