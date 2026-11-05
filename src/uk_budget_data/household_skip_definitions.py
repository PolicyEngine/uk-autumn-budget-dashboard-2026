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
- every registered measure's pre-Budget side, where it has one of its own,
  because each measure's own run holds the other selected measures there
  (the savings income rule depends on the planned cash ISA limit, for one);
- the source of the code modifiers call in another module (``SHARED_CODE``),
  which a receipt binds only through its commit.

It does not cover the household calculation, the forecast or the engine. The
differential test in ``tests/test_household_skips.py`` runs the rules that are
current against the engine on every CI run, so a change to any of them that
breaks a rule for a household it runs fails there.

A definition the code can't work out counts as changed: a rule is on only when
the code knows its digest matches. As in ``definitions``, a warning attributed
to a bound module leaves it unbindable, so the code works out every digest
together on first use, before the process runs anything, and keeps them. It
keeps a refusal too: for a speed-up, the answer stays right, and the process
logs it once.
"""

import hashlib
import json
import logging
from collections.abc import Iterable
from functools import lru_cache
from importlib.resources import files
from pathlib import Path

from uk_budget_data import measure_templates
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

# The modules of this package that modifiers call, which a measure's identity
# leaves out. tests/test_household_skips.py walks the modifiers' imports and
# fails on one this doesn't name.
SHARED_CODE = (measure_templates,)

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


def _shared_code() -> dict:
    return {
        module.__name__: hashlib.sha256(
            Path(module.__file__).read_bytes()
        ).hexdigest()
        for module in SHARED_CODE
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
    shared_code = _shared_code()
    return {
        id_: _digest(
            {
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
    clear_definition_cache()
    return path
