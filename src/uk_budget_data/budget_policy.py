"""Dated pre-Budget policy and native current-law restoration.

``budget_policy.json`` records the reviewed policy counterfactual separately
from model, data and forecast changes. Its pre-Budget fuel schedule comes
from the last model before #2719, on the native October forecast. The
electricity counterfactual retains the zero rate already enacted before the
Budget; it does not use Table 6.1's different costing reference.

Changes use statutory date intervals, before the engine's fiscal-year
conversion. Both sides partition each path at the same boundaries. This
matters because Scenario addition replaces equal period keys: restoring a
native policy must replace every counterfactual interval, including native
rate changes that fall inside an older interval.
"""

import copy
import json
import math
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal
from functools import lru_cache
from importlib import metadata, resources

RPI = "gov.economic_assumptions.yoy_growth.obr.rpi"


class UnsupportedBudgetModel(ValueError):
    """The installed model does not match the reviewed policy record."""


@lru_cache(maxsize=1)
def _stored_record() -> dict:
    return json.loads(
        resources.files("uk_budget_data")
        .joinpath("budget_policy.json")
        .read_text()
    )


def policy_record() -> dict:
    """Return an independent copy of the source-bound policy record."""
    return copy.deepcopy(_stored_record())


def _decode(value):
    return math.inf if value == "infinity" else value


def _value_at(values: dict, instant: str):
    candidates = [day for day in values if day <= instant]
    if not candidates:
        raise UnsupportedBudgetModel(
            f"Policy timeline has no value on {instant}"
        )
    return _decode(values[max(candidates)])


def _node(parameters, path: str):
    try:
        return parameters.get_child(path)
    except (AttributeError, KeyError, ValueError) as error:
        raise UnsupportedBudgetModel(
            f"Native Budget parameter is missing: {path}"
        ) from error


@lru_cache(maxsize=1)
def _native_parameters():
    expected = _stored_record()["native_model_version"]
    try:
        installed = metadata.version("policyengine-uk")
    except metadata.PackageNotFoundError as error:
        raise UnsupportedBudgetModel(
            "The Budget policy record requires policyengine-uk " + expected
        ) from error
    if installed != expected:
        raise UnsupportedBudgetModel(
            f"The Budget policy record covers policyengine-uk {expected}; "
            f"{installed} is installed. Review the record before upgrading."
        )
    from policyengine_uk import CountryTaxBenefitSystem

    system = CountryTaxBenefitSystem()
    # This copy retains projected values on their statutory dates. Reading
    # the annualised gov tree would lose the January/April/July boundaries.
    try:
        return system.parameters.baseline
    except AttributeError as error:
        raise UnsupportedBudgetModel(
            "The native model has no unannualised baseline parameter tree"
        ) from error


def _pre_budget_values(spec: dict, parameters) -> dict:
    values = dict(spec["pre_budget_values"])
    if spec.get("extend_pre_budget_by_native_rpi"):
        # The reviewed petrol/diesel snapshot ends in April 2031. Extend
        # its own last rate, not the post-Budget rate, using the same native
        # October RPI and the model's 0.01p half-up rounding. This covers the
        # terminal 2032 household year without reverting to current law.
        last = max(values)
        rate = Decimal(str(values[last]))
        for year in range(int(last[:4]) + 1, int(spec["stop"][:4]) + 1):
            day = f"{year}-04-01"
            if day > spec["stop"]:
                break
            growth = Decimal(str(_node(parameters, RPI)(f"{year - 1}-01-01")))
            rate = (rate * (1 + growth)).quantize(
                Decimal("0.0001"), rounding=ROUND_HALF_UP
            )
            values[day] = float(rate)
    return values


def _changes_for(record: dict, parameters, side: str, measure_ids) -> dict:
    changes = {}
    for measure_id in measure_ids:
        if measure_id not in record["measures"]:
            raise ValueError(f"Unknown native Budget measure: {measure_id}")
        for path, spec in record["measures"][measure_id]["paths"].items():
            if path in changes:
                raise ValueError(f"Two Budget measures own {path}")
            node = _node(parameters, path)
            # An exact package pin is necessary but not sufficient: refuse a
            # mutated tree or an installation whose policy differs from the
            # source snapshot, rather than constructing a silent substitute.
            for instant, expected in spec["native_values"].items():
                actual = node(instant)
                if type(actual) is not type(_decode(expected)) or (
                    actual != _decode(expected)
                ):
                    raise UnsupportedBudgetModel(
                        f"Native Budget parameter {path} at {instant} is "
                        f"{actual!r}; the reviewed value is {_decode(expected)!r}"
                    )
            pre = _pre_budget_values(spec, parameters)
            end = (
                date.fromisoformat(spec["stop"]) + timedelta(days=1)
            ).isoformat()
            boundaries = {spec["start"], end}
            boundaries.update(day for day in pre if spec["start"] < day < end)
            boundaries.update(
                item.instant_str
                for item in node.values_list
                if spec["start"] < item.instant_str < end
            )
            ordered = sorted(boundaries)
            changes[path] = {
                f"{start}.{(date.fromisoformat(stop) - timedelta(days=1)).isoformat()}": (
                    _value_at(pre, start)
                    if side == "pre_budget"
                    else node(start)
                )
                for start, stop in zip(ordered, ordered[1:])
            }
    return changes


def pre_budget_policy_changes() -> dict:
    """Undo all eleven native measures, without changing macro assumptions.

    The nine national measures and the two calculator-only measures share
    this counterfactual. Selecting a measure restores only its native paths.
    """
    record = _stored_record()
    return _changes_for(
        record, _native_parameters(), "pre_budget", record["measures"]
    )


def native_policy_changes(measure_id: str) -> dict:
    """Restore one selected measure to the native current-law timeline."""
    changes = _changes_for(
        _stored_record(), _native_parameters(), "native", (measure_id,)
    )
    # Preserve the existing registry's model/data limitations. A native
    # implementation alone does not establish that the certified data can
    # cost a path or that a known model limitation has been fixed.
    from uk_budget_data.measure_templates import (
        _warn_if_data_limited,
        _warn_if_model_limited,
    )

    for path in changes:
        _warn_if_data_limited(path)
        _warn_if_model_limited(path)
    return changes


def pre_budget_policy_timeline(path: str) -> dict:
    """Return a tracked path's dated pre-Budget values for read-only tables."""
    for measure in _stored_record()["measures"].values():
        if path in measure["paths"]:
            return {
                day: _decode(value)
                for day, value in _pre_budget_values(
                    measure["paths"][path], _native_parameters()
                ).items()
            }
    raise ValueError(f"Not a tracked pre-Budget parameter: {path}")
