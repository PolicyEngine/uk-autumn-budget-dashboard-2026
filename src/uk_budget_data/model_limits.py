"""Measures the installed model mis-costs until a known fix lands.

Some parameters reach more of the model than the law gives them, until a
known fix is in the installed model. A measure that changes one of them
gets a figure, but not one to approve: it is staged provisional at most,
with the reason, and never approved (``publication.publish``).

Each limit names the parameters it covers, any variables it covers, the
fix and a test of the model for it. A measure touches a limit when the
model either simulation runs lacks the fix and its two built simulations
differ under one of those parameters, compared as
``uk_budget_data.data_limits`` compares them (the stored trees by position
and effective value, and what formulas read at each year's start), or in
one of those variables: its formulas or what decides how they run, or the
values stored for it (recorded as ``variable:<name>``). A limit may opt
into explicit-input-only stored comparisons while retaining full behavior
checks; unknown input bookkeeping remains conservative. A limit expires on
its own: once the model has the fix, nothing is recorded, and its tripwire
test fails so the limit is removed.
"""

import hashlib
import inspect
import json
import types
from dataclasses import dataclass
from typing import Callable, Iterable

import numpy

from uk_budget_data import data_limits


@dataclass(frozen=True)
class ModelLimit:
    """Parameters, and variables, the installed model mis-costs until
    ``fixed_by`` lands."""

    key: str
    parameters: tuple[str, ...]
    fixed_by: str
    reason: str
    # Whether a tax-benefit system has the fix, and whether the installed
    # model does (read from its source, for the templates and stand-ins).
    fixed: Callable[[object], bool]
    installed_fixed: Callable[[], bool]
    # Compare effective values only from this fiscal year, if specified.
    from_year: int | None = None
    # Variables a measure can change the limit through without changing a
    # covered parameter: a replaced formula, or a value stored on one side.
    variables: tuple[str, ...] = ()
    # Opt in only when native derived values may legitimately differ under
    # supported parameters. Formula/metadata and explicit input differences
    # remain covered; unknown input bookkeeping falls back to all known.
    stored_inputs_only: bool = False


# How a receipt records a covered variable that differs.
VARIABLE_PATH = "variable:"


def variable_path(name: str) -> str:
    """A covered variable as a limit's record names it."""
    return f"{VARIABLE_PATH}{name}"


# Household casino incidence is not the statutory operator-band calculation.
# This review hold survives retirement of the missing-losses data limit.
# No native implementation has reviewed positive support evidence yet.
# Entries must bind (native identity, independent review reference); changing
# this set requires a reviewed native statutory-band/incidence witness.
_CASINO_REVIEWED_NATIVE_SUPPORT: tuple[tuple[str, str], ...] = ()
_CASINO_KNOWN_UNSUPPORTED_SOURCE = (
    "178341b62d98f955740163c1d10289425b61570e45a6089c9f3b860e4f7ee239"
)


def _casino_native_source_digest(system) -> str | None:
    """Source identity for the native-source review/expiry tripwire."""
    try:
        variable = system.get_variable("gaming_duty")
        source = inspect.getsource(type(variable)).strip()
    except (AttributeError, KeyError, OSError, TypeError, ValueError):
        return None
    return hashlib.sha256(source.encode()).hexdigest()


def _casino_code_identity(code):
    """Content identity, excluding installation paths and line numbers."""
    return [
        code.co_code.hex(),
        list(code.co_names),
        list(code.co_freevars),
        list(code.co_cellvars),
        code.co_argcount,
        code.co_kwonlyargcount,
        [
            (
                _casino_code_identity(value)
                if isinstance(value, types.CodeType)
                else repr(value)
            )
            for value in code.co_consts
        ],
    ]


def _casino_native_identity(system) -> str | None:
    """Bind source and active callable content; never infer capability."""
    source = _casino_native_source_digest(system)
    if source is None:
        return None
    try:
        variable = system.get_variable("gaming_duty")
        formulas = []
        for date, function in sorted(variable.formulas.items()):
            if (
                not isinstance(function, types.FunctionType)
                or function.__closure__
            ):
                return None
            formulas.append(
                [
                    str(date),
                    _casino_code_identity(function.__code__),
                    repr(function.__defaults__),
                    repr(function.__kwdefaults__),
                ]
            )
        if not formulas:
            return None
    except (AttributeError, KeyError, TypeError, ValueError):
        return None
    return hashlib.sha256(
        json.dumps([source, formulas], separators=(",", ":")).encode()
    ).hexdigest()


def _casino_statutory_bands_reviewed(system) -> bool:
    """A conservative review hold, not an automatic capability detector.

    The reviewed positive set is empty. Neither parameter presence, package
    version, model attributes nor a measure's replacement can establish a
    fix. A future positive entry also needs independent native behaviour
    evidence and an updated source/expiry tripwire in that adoption.
    """
    identity = _casino_native_identity(system)
    return identity is not None and any(
        identity == reviewed and bool(reference.strip())
        for reviewed, reference in _CASINO_REVIEWED_NATIVE_SUPPORT
    )


def _installed_casino_statutory_bands_reviewed() -> bool:
    from policyengine_uk.system import system

    return _casino_statutory_bands_reviewed(system)


# Four historical limits have retired: State Pension/September CPI/VAT at
# policyengine-uk 2.151.0, and the minimum guarantee's earnings fix from
# 2.151.2 (the adopted 2.165.1 pair). Tests retain their explicit stand-ins.
# The casino statutory-band/incidence review hold remains active, including
# its fail-closed checks, input-only comparison and real registry digest.
MODEL_LIMITS = (
    ModelLimit(
        key="casino_statutory_gaming_bands",
        parameters=("gov.hmrc.gambling_duty.gaming",),
        variables=("gaming_duty",),
        stored_inputs_only=True,
        fixed_by="independently reviewed native statutory-band household-incidence support",
        reason=(
            "The installed household model charges casino losses at one "
            "effective rate and does not read the statutory operator gaming "
            "bands. The data carrying casino losses do not establish a "
            "mapping from those bands to household incidence. Changes to "
            "the statutory bands, or to the casino-duty calculation, are "
            "held at provisional until native support is independently "
            "reviewed. The supported household effective-rate parameter "
            "is not a statutory-band costing."
        ),
        fixed=_casino_statutory_bands_reviewed,
        installed_fixed=_installed_casino_statutory_bands_reviewed,
    ),
)


def _registry_digest(limits: Iterable[ModelLimit]) -> str:
    """A digest of what a registry records and decides by: every field of
    each limit but its checks for the fix."""
    return hashlib.sha256(
        json.dumps(
            [
                [
                    limit.key,
                    list(limit.parameters),
                    list(limit.variables),
                    limit.fixed_by,
                    limit.reason,
                    limit.from_year,
                    limit.stored_inputs_only,
                ]
                for limit in limits
            ],
            separators=(",", ":"),
        ).encode()
    ).hexdigest()


# A digest of the registry, recorded in every receipt: an artifact
# generated against another registry is refused until it is regenerated.
REGISTRY_SHA256 = _registry_digest(MODEL_LIMITS)


def _covers(limit: ModelLimit, path: str) -> bool:
    """Whether a recorded path is under a limit: a parameter path under one
    of its prefixes, or ``variable:<name>`` for a variable it covers."""
    if path.startswith(VARIABLE_PATH):
        return path[len(VARIABLE_PATH) :] in limit.variables
    return any(data_limits._under(path, prefix) for prefix in limit.parameters)


def limits_for_paths(paths: Iterable[str]) -> list[ModelLimit]:
    """The limits any of these paths fall under (parameter paths, or
    ``variable:<name>``), in registry order, whether or not the installed
    model has the fix."""
    paths = list(paths)
    return [
        limit
        for limit in MODEL_LIMITS
        if any(_covers(limit, path) for path in paths)
    ]


def record(limit: ModelLimit, parameters: Iterable[str]) -> dict:
    """A limit as the receipt records it: its parameter paths and covered
    variables (``variable:<name>``) that differ, under ``parameters``."""
    return {
        "key": limit.key,
        "reason": limit.reason,
        "parameters": sorted(set(parameters)),
    }


def limits_touched(sim_baseline, sim_reform) -> list[dict]:
    """The model limits a measure touches, as its receipt records them.

    A limit is touched when either simulation's model lacks its fix and,
    under one of its parameters, the two simulations' stored parameters
    differ by position and effective value, or only what formulas read
    there differs, or a node on the way is not the one formulas reach by
    attribute (a node rebound by assignment; recorded as the limit's own
    prefix, failing closed). A dated limit ignores earlier effective
    values, but retains earlier changes still in force from its first year.
    Rebound nodes fail closed even if their dates cannot be established.
    A limit is touched too when one of its variables differs between the
    two simulations (:func:`_variables_differing`), in any year.
    """
    base_system = sim_baseline.tax_benefit_system
    reform_system = sim_reform.tax_benefit_system
    # One reading of behaviour for both sides, as data_limits compares.
    behaviour = data_limits._Behaviour(
        main_systems=(base_system, reform_system)
    )
    touched = []
    with (
        data_limits._caches_left_as_found(base_system),
        data_limits._caches_left_as_found(reform_system),
    ):
        for limit in MODEL_LIMITS:
            if limit.fixed(base_system) and limit.fixed(reform_system):
                continue
            differing = []
            for prefix in limit.parameters:
                differing += _differing(
                    base_system,
                    reform_system,
                    prefix,
                    behaviour,
                    from_year=limit.from_year,
                )
            differing += _variables_differing(
                sim_baseline,
                sim_reform,
                limit.variables,
                behaviour,
                inputs_only=limit.stored_inputs_only,
            )
            if differing:
                touched.append(record(limit, differing))
    return touched


def _differing(
    base_system, reform_system, prefix: str, behaviour, *, from_year=None
) -> list:
    """Where two built systems' parameters differ at or under ``prefix``:
    the stored leaves that differ by position and effective value; with
    none, the prefix itself if what formulas read there differs; and the
    prefix itself if a node on the way is rebound (failing closed). Run
    inside :func:`data_limits._caches_left_as_found` for both systems."""
    if _rebound(base_system, prefix) or _rebound(reform_system, prefix):
        return [prefix]
    before = data_limits._structure(base_system.parameters, prefix)
    after = data_limits._structure(reform_system.parameters, prefix)
    found = [
        path
        for path in before.keys() | after.keys()
        if not data_limits._same_effect(
            before.get(path), after.get(path), from_year=from_year
        )
    ]
    if not found and not data_limits._equal(
        data_limits._views(
            base_system, prefix, behaviour, from_year=from_year
        ),
        data_limits._views(
            reform_system, prefix, behaviour, from_year=from_year
        ),
    ):
        found = [prefix]
    return found


def parameters_differing(sim_baseline, sim_reform, prefixes) -> list:
    """Where two built simulations' parameters differ under any of
    ``prefixes``, compared as :func:`limits_touched` compares a limit's
    parameters in every year: sorted, each path once."""
    base_system = sim_baseline.tax_benefit_system
    reform_system = sim_reform.tax_benefit_system
    behaviour = data_limits._Behaviour(
        main_systems=(base_system, reform_system)
    )
    with (
        data_limits._caches_left_as_found(base_system),
        data_limits._caches_left_as_found(reform_system),
    ):
        return sorted(
            {
                path
                for prefix in prefixes
                for path in _differing(
                    base_system, reform_system, prefix, behaviour
                )
            }
        )


# What, beside its formulas and what the fingerprint reads, decides how a
# variable is calculated: the date its formulas stop, the variable masking
# them, carrying an input forward, and how an input is spread over periods.
_VARIABLE_METADATA = ("end", "defined_for", "uprating", "set_input")


def _variables_differing(
    sim_baseline, sim_reform, names, behaviour, *, inputs_only=False
):
    """The covered variables that differ between two simulations, as a
    record names them (``variable:<name>``).

    A variable differs when it is in one system only, or its behaviour
    differs: each dated formula by content (its code's fingerprint, as
    ``uk_budget_data.data_limits`` reads it, with its defaults, the values
    it closes over and the globals it looks up, so a template applied with
    other arguments shows), whether it is neutralised, what it adds and
    subtracts, its default and :data:`_VARIABLE_METADATA`; or when the
    values stored for it differ (:func:`_stored`). With inputs_only,
    compare explicit input records only, not ordinary derived caches;
    unknown input bookkeeping remains conservative. What can't be read
    counts as different.
    """
    systems = (sim_baseline.tax_benefit_system, sim_reform.tax_benefit_system)
    found = []
    for name in names:
        pair = [
            (getattr(system, "variables", None) or {}).get(name)
            for system in systems
        ]
        if pair[0] is None and pair[1] is None:
            continue
        try:
            same_values = _same_stored(
                _stored(sim_baseline, name),
                _stored(sim_reform, name),
                inputs_only=inputs_only,
            )
        except Exception:  # noqa: BLE001 - unreadable means different
            same_values = False
        if _behaves_differently(*pair, behaviour) or not same_values:
            found.append(variable_path(name))
    return found


def _behaves_differently(base, reform, behaviour) -> bool:
    if base is None or reform is None:
        return True
    try:
        return any(
            behaviour.of(getattr(base, field, None))
            != behaviour.of(getattr(reform, field, None))
            for field in _VARIABLE_METADATA
        ) or behaviour.of(base) != behaviour.of(reform)
    except Exception:  # noqa: BLE001 - unreadable means different
        return True


def _stored(sim, name):
    """What ``sim`` stores for ``name``: the values the engine records as
    inputs, and every value its holder keeps, calculated or cached, each by
    branch and period. None for a simulation without the engine's holders
    (a stand-in), which is not compared.

    Detection runs after the figures are made, so one side can hold a value
    the other never calculated: inputs are compared slot for slot, and other
    values only where both sides hold one (:func:`_same_stored`). An engine
    that records no inputs has all it holds compared as inputs.
    """
    get_holder = getattr(sim, "get_holder", None)
    if get_holder is None:
        return None
    if name not in sim.tax_benefit_system.variables:
        return {}, {}
    holder = get_holder(name)
    known = {
        (branch, str(period)): holder.get_array(period, branch)
        for branch, period in holder.get_known_branch_periods()
    }
    keys = getattr(sim, "_user_input_keys", None)
    if keys is None:
        return known, known
    inputs = {
        (branch, str(period)): holder.get_array(period, branch)
        for variable, branch, period in keys
        if variable == name
    }
    return inputs, known


def _same_stored(base, reform, *, inputs_only=False) -> bool:
    """Whether two simulations store the same for a variable (NaN equal to
    NaN): the same inputs in the same slots, and the same value in every
    slot both hold. With inputs_only, compare the input slots alone;
    _stored still treats all known slots as inputs when bookkeeping is
    unavailable. True for stand-ins without holders."""
    if base is None or reform is None:
        return True
    (base_inputs, base_known), (reform_inputs, reform_known) = base, reform
    return (
        base_inputs.keys() == reform_inputs.keys()
        and all(
            _same_array(base_inputs[slot], reform_inputs[slot])
            for slot in base_inputs
        )
        and (
            inputs_only
            or all(
                _same_array(base_known[slot], reform_known[slot])
                for slot in base_known.keys() & reform_known.keys()
            )
        )
    )


def _same_array(a, b) -> bool:
    if a is None or b is None:
        return a is b
    a, b = numpy.asarray(a), numpy.asarray(b)
    try:
        return bool(numpy.array_equal(a, b, equal_nan=True))
    except TypeError:  # no NaN in this dtype (text, say)
        return bool(numpy.array_equal(a, b))


def _rebound(system, prefix: str) -> bool:
    """Whether a node on the way to ``prefix`` is not the one formulas reach
    by attribute: a modifier rebound it (``node.amount = other``), so the
    stored tree that detection walks is not what formulas read."""
    node = system.parameters
    for part in prefix.split("."):
        children = getattr(node, "children", None)
        child = children.get(part) if isinstance(children, dict) else None
        if child is None:
            return False
        if getattr(node, part, None) is not child:
            return True
        node = child
    return False


def limits_for_scenarios(baseline_scenario, reform_scenario) -> list[dict]:
    """The limits a measure touches, read from its two scenarios' parameter
    changes, against the installed model. Only for simulations with no
    parameter tree to compare (stand-ins): :func:`limits_touched` decides
    wherever the trees exist."""
    touched = []
    for limit in MODEL_LIMITS:
        base = _changes_from_year(baseline_scenario, limit.from_year)
        reform = _changes_from_year(reform_scenario, limit.from_year)
        differing = [
            path
            for path in base.keys() | reform.keys()
            if base.get(path) != reform.get(path)
            and any(
                data_limits._under(path, prefix) for prefix in limit.parameters
            )
        ]
        if differing and not limit.installed_fixed():
            touched.append(record(limit, differing))
    return touched


def _changes_from_year(scenario, from_year):
    """Ignore earlier bare fiscal-year assignments in a stand-in scenario.

    Scalar changes and unrecognised dated syntax are conservatively kept;
    only the built trees can establish their effective dates reliably.
    """
    changes = data_limits._changes(scenario)
    if from_year is None:
        return changes
    found = {}
    for path, value in changes.items():
        if isinstance(value, dict):
            value = {
                key: amount
                for key, amount in value.items()
                if not (str(key).isdigit() and len(str(key)) == 4)
                or int(key) >= from_year
            }
            if not value:
                continue
        found[path] = value
    return found


def record_problems(records) -> list[str]:
    """Ways a recorded list of model limits is not one this registry
    produced."""
    if not isinstance(records, list):
        return ["model_limits must be a list"]
    known = {limit.key: limit for limit in MODEL_LIMITS}
    order = list(known)
    problems = []
    keys = [r.get("key") if isinstance(r, dict) else None for r in records]
    if (
        any(key not in known for key in keys)
        or len(set(keys)) != len(keys)
        or keys != sorted(keys, key=order.index)
    ):
        problems.append(
            "model_limits must list known limits once each, in registry order"
        )
    for item in records:
        if not isinstance(item, dict) or item.get("key") not in known:
            continue
        limit = known[item["key"]]
        if item.get("reason") != limit.reason:
            problems.append(f"{limit.key}: its reason is not the registry's")
        paths = item.get("parameters")
        if (
            not isinstance(paths, list)
            or not paths
            or paths != sorted(set(paths))
            or any(
                not isinstance(path, str)
                or limit not in limits_for_paths([path])
                for path in paths
            )
        ):
            problems.append(
                f"{limit.key}: its parameters must be a sorted, non-empty "
                "list of paths under that limit"
            )
    return problems
