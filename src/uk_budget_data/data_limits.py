"""Measures the certified data cannot cost.

Some parameters act only through a quantity the survey data do not hold.
A measure that changes one of them scores nothing, or something wrong, and
a £0 can pass for a plausible costing. Such a measure is published as not
computable on current data, with the reason, and never as a figure.

Each limit names the parameters it covers, the input the data lack and why.
A measure touches a limit when its reform and its baseline differ anywhere
under one of those parameters, however the difference was made: parameter
changes or a simulation modifier, on either side; or when a variable
behaves differently between them and the code that differs reads what the
limit covers (a structural measure, through a template's formula helper,
``update_variable`` or ``neutralize_variable``). On built simulations two
things are compared for parameters: what formulas read under those parameters at the start
of each year (the system's cached views, which a modifier can change
without touching the stored parameters), and the stored trees by position
and effective value, so a reordered, replaced, re-typed or added parameter
shows, and a redundant breakpoint or a label does not.

A limit lifts when certified data carry the input:
``tests/test_certified_data.py`` fails once they do, so the limit is removed
in the bundle-adoption PR that brings them.
"""

import __future__

import ast
import enum
import functools
import hashlib
import inspect
import json
import linecache
import operator
import sys
import sysconfig
import textwrap
import types
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Iterable, Mapping

import numpy


@dataclass(frozen=True)
class DataLimit:
    """Parameters whose effect the certified data cannot show."""

    key: str
    parameters: tuple[str, ...]
    missing_input: str
    reason: str


DATA_LIMITS = (
    DataLimit(
        key="additional_dwelling_purchases",
        parameters=(
            # SDLT higher rates for additional dwellings (FA 2003 Sch. 4ZA).
            "gov.hmrc.stamp_duty.residential.purchase.additional",
            # LBTT additional dwelling supplement.
            "gov.revenue_scotland.lbtt.residential.additional_residence_surcharge",
            # LTT higher residential rates.
            "gov.wra.land_transaction_tax.residential.higher_rate",
        ),
        missing_input="additional_residential_property_purchased",
        reason=(
            "The survey data record no purchases of additional dwellings, "
            "only the property households already own, so the higher rates "
            "cannot be costed. From policyengine-uk's fix for issue #2238 "
            "they apply to nothing; before it, to a buyer's whole stock of "
            "other property. The purchase imputation (policyengine-uk-data "
            "#573) would lift this."
        ),
    ),
    DataLimit(
        key="non_residential_purchases",
        parameters=(
            "gov.hmrc.stamp_duty.non_residential.purchase",
            "gov.revenue_scotland.lbtt.non_residential",
            "gov.wra.land_transaction_tax.non_residential",
        ),
        missing_input="non_residential_property_purchased",
        reason=(
            "The survey data record no purchases of non-residential property, "
            "only the property households already own, so the non-residential "
            "purchase rates cannot be costed. From policyengine-uk's fix for "
            "issue #2238 they apply to nothing; before it, to a buyer's whole "
            "stock of non-residential property. The purchase imputation "
            "(policyengine-uk-data #573) would lift this."
        ),
    ),
)


# A digest of the registry, recorded in every receipt: an artifact
# generated against another registry (a limit added since, say) is
# refused until it is regenerated, by the gate and by the page.
REGISTRY_SHA256 = hashlib.sha256(
    json.dumps(
        [
            [
                limit.key,
                list(limit.parameters),
                limit.missing_input,
                limit.reason,
            ]
            for limit in DATA_LIMITS
        ],
        separators=(",", ":"),
    ).encode()
).hexdigest()


def _under(path: str, prefix: str) -> bool:
    """Whether a parameter path is ``prefix`` or lies below it."""
    return path == prefix or path.startswith((prefix + ".", prefix + "["))


def limits_for_paths(paths: Iterable[str]) -> list[DataLimit]:
    """The limits any of these parameter paths fall under, in registry
    order."""
    paths = list(paths)
    return [
        limit
        for limit in DATA_LIMITS
        if any(_under(p, prefix) for p in paths for prefix in limit.parameters)
    ]


def limits_for_scenarios(baseline_scenario, reform_scenario) -> list[dict]:
    """The limits a measure touches, read from its two scenarios' parameter
    changes: the paths where they differ. Only for simulations with no
    parameter tree to compare (stand-ins): a simulation modifier is
    invisible here, and a declared change can be undone or respelled, so
    :func:`limits_touched` decides wherever the trees exist."""
    base = _changes(baseline_scenario)
    reform = _changes(reform_scenario)
    differing = [
        p for p in base.keys() | reform.keys() if base.get(p) != reform.get(p)
    ]
    return [
        record(
            limit,
            [
                path
                for path in differing
                if any(_under(path, prefix) for prefix in limit.parameters)
            ],
        )
        for limit in limits_for_paths(differing)
    ]


def _changes(scenario) -> Mapping[str, object]:
    return (
        (getattr(scenario, "parameter_changes", None) or {})
        if scenario
        else {}
    )


# The instants formulas read parameters at for yearly results: each year's
# start. Wider than the model's years, so a change just outside them shows.
VIEW_YEARS = range(2015, 2041)


def _equal(a, b) -> bool:
    """Equality for what detection compares: numbers by value (40000 equals
    40000.0; NaN equals NaN), sequences and mappings item by item, methods
    by identity, anything else by ==."""
    if callable(a) or callable(b):
        return a is b
    if isinstance(a, dict) and isinstance(b, dict):
        return a.keys() == b.keys() and all(_equal(a[k], b[k]) for k in a)
    if isinstance(a, (list, tuple)) and isinstance(b, (list, tuple)):
        return len(a) == len(b) and all(_equal(x, y) for x, y in zip(a, b))
    numbers = (int, float, numpy.number)
    if isinstance(a, numbers) and isinstance(b, numbers):
        return bool(a == b) or bool(a != a and b != b)
    if isinstance(a, numpy.ndarray) or isinstance(b, numpy.ndarray):
        return numpy.array_equal(
            numpy.asarray(a), numpy.asarray(b), equal_nan=True
        )
    try:
        return bool(a == b)
    except Exception:  # noqa: BLE001 - incomparable means different
        return False


def _flatten(view, behaviour=None):
    """A view of the parameters at one instant, as plain data, read the way
    formulas read it: a scale by its class and any method set on the
    instance (both by content, see :class:`_Behaviour`), and its arrays; a
    node by its children, reached by attribute as formulas reach them; a
    leaf by its value."""
    behaviour = behaviour or _Behaviour()
    if view is None:
        return None
    if hasattr(view, "thresholds"):
        return {
            "scale": behaviour.of(type(view)),
            "own_methods": {
                name: behaviour.of(value)
                for name, value in vars(view).items()
                if callable(value)
            },
            **{
                name: list(getattr(view, name))
                for name in ("thresholds", "rates", "amounts")
                if hasattr(view, name)
            },
        }
    children = getattr(view, "_children", None)
    if children is not None:
        return {
            key: _flatten(getattr(view, key), behaviour)
            for key in sorted(children)
        }
    return view


def _caches(system) -> list:
    """Every at-instant cache formulas can read through: the system's own,
    and each parameter node's (a new view reuses its children's)."""
    found = []
    own = getattr(system, "_parameters_at_instant_cache", None)
    if isinstance(own, dict):
        found.append(own)
    stack = [system.parameters]
    while stack:
        node = stack.pop()
        cache = getattr(node, "_at_instant_cache", None)
        if isinstance(cache, dict):
            found.append(cache)
        stack.extend(getattr(node, "brackets", None) or [])
        children = getattr(node, "children", None)
        if isinstance(children, dict):
            stack.extend(children.values())
    return found


@contextmanager
def _caches_left_as_found(system):
    """Remove whatever the block adds to the system's caches, so detection
    never leaves a view that formulas later read."""
    caches = _caches(system)
    keys = [set(cache) for cache in caches]
    try:
        yield
    finally:
        for cache, before in zip(caches, keys):
            for key in set(cache) - before:
                del cache[key]


def _view_at(parameters, prefix: str, instant: str):
    """What a formula reads under ``prefix`` at ``instant``. Formulas call
    the tree's root, and a new view of a node is built from its children's
    cached views, so the first cached view on the way down from the root
    is what they read; with none, the view built at ``prefix`` itself."""
    parts = prefix.split(".")
    levels, node = [parameters], parameters
    for part in parts:
        children = getattr(node, "children", None)
        if not isinstance(children, dict) or part not in children:
            return None
        node = children[part]
        levels.append(node)
    for depth, level in enumerate(levels):
        cache = getattr(level, "_at_instant_cache", None)
        view = cache.get(instant) if isinstance(cache, dict) else None
        if view is not None:
            try:
                for part in parts[depth:]:
                    view = getattr(view, part)
            except AttributeError:
                return None
            return view
    return node.get_at_instant(instant)


def _views(system, prefix: str, behaviour=None) -> list:
    """What formulas read under ``prefix`` at the start of each year. Run
    inside :func:`_caches_left_as_found`: building a view caches it."""
    behaviour = behaviour or _Behaviour()
    return [
        _flatten(
            _view_at(system.parameters, prefix, f"{year}-01-01"), behaviour
        )
        for year in VIEW_YEARS
    ]


def _structure(parameters, prefix: str) -> dict:
    """Every leaf at or under ``prefix``, keyed by its position in the tree
    (child keys and bracket indices), not by the names the objects carry."""
    try:
        node = parameters.get_child(prefix)
    except Exception:  # noqa: BLE001 - absent in this model version
        return {}
    found: dict = {}

    def walk(node, path):
        if hasattr(node, "brackets"):
            for index, bracket in enumerate(node.brackets):
                walk(bracket, f"{path}[{index}]")
        elif hasattr(node, "values_list"):
            found[path] = node
        elif hasattr(node, "children"):
            for key in sorted(node.children):
                walk(node.children[key], f"{path}.{key}")

    walk(node, prefix)
    return found


def _same_effect(before, after) -> bool:
    """Whether two leaves from :func:`_structure` have the same value at
    every breakpoint of either side."""
    if before is None or after is None:
        return before is after
    instants = sorted(
        {v.instant_str for v in before.values_list}
        | {v.instant_str for v in after.values_list}
    )
    return all(_equal(before(i), after(i)) for i in instants)


_MODEL_PACKAGES = ("policyengine_uk", "uk_budget_data")
_STDLIB = sysconfig.get_paths()["stdlib"]
# How deep plain objects held by a formula are read, field by field.
_OBJECT_DEPTH = 4


def _library_path(path: str) -> bool:
    """Whether code from ``path`` is installed library code (the standard
    library, or a site package other than the model's), which is compared
    by name; the model's code, and code written for a measure, by content."""
    if path.startswith("<frozen"):
        return True
    if path.startswith("<"):
        return False
    if any(f"/{package}/" in path for package in _MODEL_PACKAGES):
        return False
    return (
        "site-packages" in path
        or "dist-packages" in path
        or path.startswith(_STDLIB)
    )


def _library_module(name) -> bool:
    top = (name or "").split(".")[0]
    if top in _MODEL_PACKAGES:
        return False
    if top in sys.stdlib_module_names:
        return True
    path = getattr(sys.modules.get(top), "__file__", None)
    return bool(path) and _library_path(path)


def _library_class(kind) -> bool:
    """A class from library code whose own methods are all library code: a
    subclass made to carry a library class's module and name, overriding a
    method, is not one."""
    return _library_module(kind.__module__) and all(
        _library_path(function.__code__.co_filename)
        for function in map(_function_of, vars(kind).values())
        if function is not None
    )


def _function_of(value):
    """The Python function behind a class member, if it has one."""
    if isinstance(value, (classmethod, staticmethod)):
        value = value.__func__
    return value if isinstance(value, types.FunctionType) else None


def _is_variable(value) -> bool:
    return (
        not isinstance(value, type)
        and hasattr(value, "formulas")
        and hasattr(value, "is_neutralized")
    )


def _cell_is_set(cell) -> bool:
    try:
        cell.cell_contents
    except ValueError:
        return False
    return True


def _safe_repr(value):
    try:
        text = repr(value)
    except Exception:  # noqa: BLE001 - no stable text, the type stands
        return None
    return None if " at 0x" in text or len(text) > 2000 else text


def _fingerprint(code):
    """A code object by content: its instructions, the names it uses, its
    parameters' names and kinds, and its constants (nested code by content
    too)."""
    return (
        code.co_code,
        code.co_names,
        # Parameter names and kinds: a keyword call binds by name.
        code.co_varnames[: code.co_argcount + code.co_kwonlyargcount],
        code.co_flags & (inspect.CO_VARARGS | inspect.CO_VARKEYWORDS),
        tuple(
            _fingerprint(c) if hasattr(c, "co_code") else repr(c)
            for c in code.co_consts
        ),
    )


def _global_names(code) -> set:
    """The names a code object, and any code nested in it, looks up."""
    found = set(code.co_names)
    for const in code.co_consts:
        if hasattr(const, "co_names"):
            found |= _global_names(const)
    return found


def _code_names(code) -> set:
    """The names and string constants a code object, and any code nested in
    it, uses: how a formula names the variables it reads."""
    found = set(code.co_names)
    for const in code.co_consts:
        if isinstance(const, str):
            found.add(const)
        elif hasattr(const, "co_consts"):
            found |= _code_names(const)
    return found


class _Behaviour:
    """What code does, by content, so the same behaviour matches across
    systems and a different one does not.

    The model compiles its formulas afresh for each system, into modules
    with generated names, so the same formula is a different object in
    each. A function is read as its code, its default arguments, the values
    it closes over and the globals its code looks up; a variable as its
    formulas, whether it is neutralised, what it adds and subtracts and its
    default; a class as its own members (methods and data alike), its bases
    and any enum members; a plain object as its class and its fields, slots
    included; a mapping in its order; a container subclass with its type,
    factory and fields. Numbers compare by value (40000 matches 40000.0).
    Installed library code is read by qualified name. Results are memoised
    by object for one comparison, which keeps the objects alive.
    """

    def __init__(self):
        self._memo: dict = {}
        self._kept: list = []
        self._active: set = set()

    # --- fingerprints

    def of(self, value, depth: int = 0):
        """A hashable fingerprint of ``value``'s behaviour."""
        if isinstance(value, enum.Enum):
            kind = type(value)
            return (
                "member",
                kind.__qualname__,
                value.name,
                self.of(value.value),
            )
        if isinstance(value, (bool, str, bytes, complex)) or value is None:
            return repr(value)
        if isinstance(value, numpy.generic):
            return self.of(value.item(), depth)
        if isinstance(value, (int, float)):
            if isinstance(value, int) and abs(value) >= 2**53:
                return repr(value)
            number = float(value)
            return "nan" if number != number else repr(number)
        if isinstance(value, types.ModuleType):
            return ("module", value.__name__)
        containers = (list, tuple, set, frozenset, dict, numpy.ndarray)
        if isinstance(value, containers):
            return self._guarded(value, self._container, depth)
        key = id(value)
        if key in self._memo:
            return self._memo[key]
        found = self._guarded(value, self._component, depth)
        if found[0] != "cycle":
            self._memo[key] = found
            self._kept.append(value)
        return found

    def _guarded(self, value, read, depth):
        key = id(value)
        if key in self._active:
            name = getattr(value, "__qualname__", type(value).__qualname__)
            return ("cycle", str(name))
        self._active.add(key)
        try:
            return read(value, depth)
        finally:
            self._active.discard(key)

    def _container(self, value, depth):
        if isinstance(value, numpy.ndarray):
            if value.dtype.hasobject:
                items = tuple(self.of(item, depth) for item in value.ravel())
                return ("array", value.shape, items)
            return ("array", value.dtype.str, value.shape, value.tobytes())
        kind = type(value)
        extra = ()
        if kind not in (dict, list, tuple, set, frozenset):
            # A subclass can carry behaviour (a defaultdict's factory).
            extra = (
                self.of(kind),
                self.of(getattr(value, "default_factory", None)),
                self._fields(value, depth),
            )
        if isinstance(value, dict):
            # In order: a formula can read a mapping's first entry.
            pairs = tuple(
                (self.of(k, depth), self.of(v, depth))
                for k, v in value.items()
            )
            return ("map", pairs, *extra)
        if isinstance(value, (set, frozenset)):
            items = (self.of(item, depth) for item in value)
            return ("set", tuple(sorted(items, key=repr)), *extra)
        name = kind.__name__ if kind in (list, tuple) else "seq"
        return (name, tuple(self.of(item, depth) for item in value), *extra)

    def _fields(self, value, depth):
        """A plain object's state: its ``__dict__`` and its slots."""
        if _library_class(type(value)):
            return ()
        return tuple(
            (name, self.of(field, depth + 1))
            for name, field in sorted(_fields_of(value).items())
        )

    def _component(self, value, depth):
        if _is_variable(value):
            formulas = sorted(
                (value.formulas or {}).items(), key=lambda item: str(item[0])
            )
            return (
                "variable",
                getattr(value, "name", None),
                bool(value.is_neutralized),
                self.of(getattr(value, "adds", None)),
                self.of(getattr(value, "subtracts", None)),
                self.of(getattr(value, "default_value", None)),
                tuple((str(start), self.of(f)) for start, f in formulas),
            )
        if isinstance(value, types.FunctionType):
            code = value.__code__
            if _library_path(code.co_filename):
                return ("library", value.__module__, value.__qualname__)
            closure = tuple(
                (
                    name,
                    (
                        self.of(cell.cell_contents)
                        if _cell_is_set(cell)
                        else "unset"
                    ),
                )
                for name, cell in zip(
                    code.co_freevars, value.__closure__ or ()
                )
            )
            looked_up = tuple(
                (name, self.of(value.__globals__[name]))
                for name in sorted(_global_names(code))
                if name in value.__globals__
            )
            return (
                "function",
                _fingerprint(code),
                self.of(value.__defaults__),
                self.of(value.__kwdefaults__),
                closure,
                looked_up,
            )
        if isinstance(value, functools.partial):
            return (
                "partial",
                self.of(value.func),
                self.of(value.args),
                self.of(value.keywords),
            )
        if isinstance(value, types.MethodType):
            return ("method", self.of(value.__func__), self.of(value.__self__))
        if isinstance(value, (classmethod, staticmethod)):
            return (type(value).__name__, self.of(value.__func__))
        if isinstance(value, property):
            return (
                "property",
                self.of(value.fget),
                self.of(value.fset),
                self.of(value.fdel),
            )
        engine = _engine(value)
        if engine is not None:
            return ("engine", *engine, self._parameter_content(value))
        if isinstance(value, type):
            if _library_class(value):
                return ("library", value.__module__, value.__qualname__)
            members = tuple(
                (name, self.of(member))
                for name, member in sorted(vars(value).items())
                if name not in _CLASS_BOOKKEEPING
            )
            enum_members = (
                tuple((m.name, self.of(m.value)) for m in value)
                if issubclass(value, enum.Enum)
                else ()
            )
            bases = tuple(self.of(base) for base in value.__bases__)
            return ("class", value.__qualname__, members, bases, enum_members)
        kind = type(value)
        rebuilt = _rebuilt_from(value)
        if rebuilt is not None:
            name = f"{kind.__module__}.{kind.__qualname__}"
            return ("object", name, self.of(rebuilt, depth + 1))
        if callable(value) and _library_class(kind):
            name = getattr(value, "__qualname__", None) or getattr(
                value, "__name__", kind.__qualname__
            )
            module = getattr(value, "__module__", None) or kind.__module__
            return ("library", module, str(name))
        if _library_class(kind):
            name = f"{kind.__module__}.{kind.__qualname__}"
            return ("object", name, _safe_repr(value))
        if depth >= _OBJECT_DEPTH:
            return ("deep", kind.__qualname__)
        return ("object", self.of(kind), self._fields(value, depth))

    def _parameter_content(self, value):
        """What a held parameter object gives: a view or scale as formulas
        read it, a stored leaf by its values; a stored node by name only (its
        tree is compared under the limits directly)."""
        if hasattr(value, "thresholds") or hasattr(value, "_children"):
            return self.of(_flatten(value, self))
        if hasattr(value, "values_list"):
            return tuple(
                (item.instant_str, self.of(item.value))
                for item in value.values_list
            )
        return None

    # --- what code names and holds

    def _parts(self, value) -> tuple[set, list]:
        """A component's own names (strings its code and values carry) and
        the components it holds."""
        names, held = set(), []
        if _is_variable(value):
            self._collect(getattr(value, "adds", None), names, held)
            self._collect(getattr(value, "subtracts", None), names, held)
            held.extend((value.formulas or {}).values())
        elif isinstance(value, types.FunctionType):
            code = value.__code__
            if _library_path(code.co_filename):
                return names, held
            names |= _code_names(code)
            self._collect(value.__defaults__, names, held)
            self._collect(value.__kwdefaults__, names, held)
            for cell in value.__closure__ or ():
                if _cell_is_set(cell):
                    self._collect(cell.cell_contents, names, held)
            for name in sorted(_global_names(code)):
                if name in value.__globals__:
                    self._collect(value.__globals__[name], names, held)
        elif isinstance(value, functools.partial):
            self._collect(
                (value.func, value.args, value.keywords), names, held
            )
        elif isinstance(value, types.MethodType):
            self._collect((value.__func__, value.__self__), names, held)
        elif isinstance(value, (classmethod, staticmethod)):
            self._collect(value.__func__, names, held)
        elif isinstance(value, property):
            self._collect((value.fget, value.fset, value.fdel), names, held)
        elif isinstance(value, type):
            if not _library_class(value):
                members = [
                    member
                    for name, member in vars(value).items()
                    if name not in _CLASS_BOOKKEEPING
                ]
                self._collect((members, value.__bases__), names, held)
        elif not _library_class(type(value)):
            # Its class too: a method can read what the fields don't name.
            fields = list(_fields_of(value).values())
            self._collect([*fields, type(value)], names, held)
        return names, held

    def _collect(self, value, names, held, active=None):
        active = set() if active is None else active
        engine = _engine(value)
        if engine is not None:
            if engine[1]:
                names.add(engine[1])
        elif isinstance(value, str):
            names.add(value)
        elif isinstance(value, (list, tuple, set, frozenset, dict)):
            if id(value) in active:
                return
            active.add(id(value))
            items = value.items() if isinstance(value, dict) else value
            for item in items:
                self._collect(item, names, held, active)
            if type(value) not in (dict, list, tuple, set, frozenset):
                extra = [getattr(value, "default_factory", None)]
                if not _library_class(type(value)):
                    # Its class too: a method can read what items don't.
                    extra += [*_fields_of(value).values(), type(value)]
                self._collect(extra, names, held, active)
        elif _rebuilt_from(value) is not None:
            if id(value) not in active and len(active) < _COLLECT_DEPTH:
                active.add(id(value))
                self._collect(_rebuilt_from(value), names, held, active)
        elif _is_component(value):
            held.append(value)

    def uses_as_results(self, function, formulas) -> dict:
        """What ``function`` holds and only ever calls for the result it
        gives on ``function``'s own arguments, by id.

        Read from ``function``'s source, when that is the code that runs
        (see :func:`_source_tree`): a call of the templates' helper,
        ``_call_formula``, with a held variable, or of a held formula (its
        fingerprint in ``formulas``), whose entity, period and parameters
        are ``function``'s own first three parameters, never rebound.
        Positional, keyword, ``*`` and ``**`` arguments are bound as Python
        binds them, through names assigned once. The result must be used,
        not discarded. A held object read any other way, rebound, or read
        from nested code is not used for its result alone; nor is anything,
        without matching source.
        """
        node = _source_tree(function)
        if node is None:
            return {}
        return _ResultUses(function, node, formulas, self).found()

    def chain(self, variable, formulas) -> set:
        """The results ``variable`` is built from: its own fingerprint and,
        following each formula's uses of what it holds for its result alone
        (see :meth:`uses_as_results`), those variables' and formulas'."""
        if variable is None:
            return set()
        found = {self.of(variable)}
        stack = [variable]
        seen = set()
        while stack:
            value = stack.pop()
            if id(value) in seen:
                continue
            seen.add(id(value))
            if _is_variable(value):
                if not value.is_neutralized:
                    stack.extend((value.formulas or {}).values())
                continue
            if not isinstance(value, types.FunctionType):
                continue
            for used in self.uses_as_results(value, formulas).values():
                found.add(self.of(used))
                stack.append(used)
        return found

    def names(self, variable, unchanged, formulas, installed) -> set:
        """The names a variable's own code reads, following the code and
        values its formulas hold. Left out: what a formula holds and uses
        for its result alone (see :meth:`uses_as_results`) whose
        fingerprint is in ``unchanged``, and the model's own formulas (in
        ``installed``) as members of a class a formula names."""
        names, held = self._parts(variable)
        stack = list(held)
        seen = set()
        while stack:
            value = stack.pop()
            if id(value) in seen:
                continue
            seen.add(id(value))
            own, inner = self._parts(value)
            names |= own
            if isinstance(value, types.FunctionType):
                results = self.uses_as_results(value, formulas)
                inner = [
                    h
                    for h in inner
                    if not (id(h) in results and self.of(h) in unchanged)
                ]
            elif isinstance(value, type):
                inner = [
                    h
                    for h in inner
                    if not (
                        isinstance(h, types.FunctionType)
                        and self.of(h) in installed
                    )
                ]
            stack.extend(inner)
        return names

    def variables_held(self, variable) -> list:
        """Every variable a variable's formulas hold, at any depth."""
        if variable is None:
            return []
        stack = list((variable.formulas or {}).values())
        found, seen = [], set()
        while stack:
            value = stack.pop()
            if id(value) in seen:
                continue
            seen.add(id(value))
            if _is_variable(value):
                found.append(value)
            stack.extend(self._parts(value)[1])
        return found


def _wrapped(behaviour, variable, chain) -> bool:
    """Whether another side's ``chain`` (see :meth:`_Behaviour.chain`) uses
    ``variable`` for its own result: the variable itself, or every formula
    of one that is not neutralised and adds and subtracts nothing."""
    if behaviour.of(variable) in chain:
        return True
    formulas = list((variable.formulas or {}).values())
    plain = not (
        variable.is_neutralized
        or getattr(variable, "adds", None)
        or getattr(variable, "subtracts", None)
    )
    return (
        plain
        and bool(formulas)
        and all(behaviour.of(f) in chain for f in formulas)
    )


_MISSING = object()
# How many containers and rebuilt objects one walk follows, at most.
_COLLECT_DEPTH = 500

# Class members that are bookkeeping, not behaviour (the generated module
# name differs between systems).
_CLASS_BOOKKEEPING = frozenset(
    {
        "__module__",
        "__qualname__",
        "__doc__",
        "__dict__",
        "__weakref__",
        "__annotations__",
        "__annotate__",
        "__firstlineno__",
        "__static_attributes__",
        "__orig_bases__",
        "__parameters__",
        "__slotnames__",
        "__abstractmethods__",
        "_abc_impl",
    }
)
_FUTURE_FLAGS = functools.reduce(
    operator.or_,
    (
        getattr(__future__, name).compiler_flag
        for name in __future__.all_feature_names
    ),
)
_NESTED_SCOPES = (
    ast.FunctionDef,
    ast.AsyncFunctionDef,
    ast.Lambda,
    ast.ClassDef,
    ast.ListComp,
    ast.SetComp,
    ast.DictComp,
    ast.GeneratorExp,
)
_HELPER_SIGNATURE = ("variable", "entity", "period", "parameters")


def _source_tree(function):
    """The syntax tree of ``function``'s definition, when its source is the
    code that runs: compiled again inside a function holding its free
    variables, it must give the same instructions, names and constants.
    ``None`` otherwise (no source, a lambda, a decorated function, source
    edited since import)."""
    code = getattr(function, "__code__", None)
    if code is None:
        return None
    try:
        lines, _ = inspect.getsourcelines(function)
    except (OSError, TypeError):
        return None
    text = textwrap.dedent("".join(lines))
    try:
        tree = ast.parse(text)
    except SyntaxError:
        return None
    if len(tree.body) != 1:
        return None
    node = tree.body[0]
    if (
        not isinstance(node, ast.FunctionDef)
        or node.decorator_list
        or node.name != code.co_name
    ):
        return None
    # The module's imports first: the compiler treats a name an import
    # binds differently (a call of ``np.ones`` takes no method form).
    holder = [*_module_imports(code.co_filename), "def __holder__():"]
    holder += [f"    {name} = None" for name in code.co_freevars]
    holder.append(textwrap.indent(text, "    ").rstrip("\n"))
    holder.append(f"    return {node.name}")
    try:
        compiled = compile(
            "\n".join(holder) + "\n",
            code.co_filename,
            "exec",
            flags=code.co_flags & _FUTURE_FLAGS,
            dont_inherit=True,
        )
    except SyntaxError:
        return None
    outer = next(c for c in compiled.co_consts if hasattr(c, "co_code"))
    inner = next(
        (
            c
            for c in outer.co_consts
            if hasattr(c, "co_code") and c.co_name == node.name
        ),
        None,
    )
    if inner is None or _fingerprint(inner) != _fingerprint(code):
        return None
    return node


@functools.lru_cache(maxsize=256)
def _module_imports(path: str) -> tuple:
    """The top-level import statements of the module at ``path``, future
    imports first."""
    text = "".join(linecache.getlines(path))
    try:
        tree = ast.parse(text)
    except SyntaxError:
        return ()
    imports = [
        node
        for node in tree.body
        if isinstance(node, (ast.Import, ast.ImportFrom))
    ]
    future = [
        node
        for node in imports
        if isinstance(node, ast.ImportFrom) and node.module == "__future__"
    ]
    rest = [node for node in imports if node not in future]
    return tuple(ast.unparse(node) for node in future + rest)


class _ResultUses:
    """One function's calls that use a held variable's, or a held formula's,
    own result (see :meth:`_Behaviour.uses_as_results`)."""

    def __init__(self, function, node, formulas, behaviour):
        self.function, self.node = function, node
        self.formulas, self.behaviour = formulas, behaviour
        self.code = function.__code__
        args = node.args
        self.positional = [a.arg for a in args.posonlyargs + args.args]
        self.vararg = args.vararg.arg if args.vararg else None
        self.parents, self.nested = {}, set()
        for parent in ast.walk(node):
            for child in ast.iter_child_nodes(parent):
                self.parents[id(child)] = parent
                inside = parent is not node and isinstance(
                    parent, _NESTED_SCOPES
                )
                if inside or id(parent) in self.nested:
                    self.nested.add(id(child))
        self.stores = self._stores()
        self.aliases = self._aliases()

    def _stores(self) -> dict:
        """How often each name is bound in the body, nested scopes too."""
        stores: dict = {}

        def bind(name):
            stores[name] = stores.get(name, 0) + 1

        for child in ast.walk(self.node):
            if child is self.node:
                continue
            if isinstance(child, ast.Name) and not isinstance(
                child.ctx, ast.Load
            ):
                bind(child.id)
            elif isinstance(
                child, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)
            ):
                bind(child.name)
            elif isinstance(child, (ast.Global, ast.Nonlocal)):
                for name in child.names:
                    bind(name)
            elif isinstance(child, (ast.Import, ast.ImportFrom)):
                for alias in child.names:
                    bind((alias.asname or alias.name).split(".")[0])
            elif isinstance(child, ast.ExceptHandler) and child.name:
                bind(child.name)
            elif isinstance(child, ast.arg) and id(child) in self.nested:
                bind(child.arg)
        return stores

    def _aliases(self) -> dict:
        """Names assigned once, at the top of the body, from a name, a tuple
        or a literal mapping: ``call = _call_formula``, ``args = (entity,
        period, parameters)``. ``entity = entity`` rebinds nothing."""
        aliases = {}
        for statement in self.node.body:
            if not (
                isinstance(statement, ast.Assign)
                and len(statement.targets) == 1
                and isinstance(statement.targets[0], ast.Name)
            ):
                continue
            target, value = statement.targets[0].id, statement.value
            if isinstance(value, ast.Name) and value.id == target:
                self.stores[target] -= 1
                aliases.setdefault("__identity__", set()).add(id(value))
                continue
            if self.stores.get(target) == 1 and isinstance(
                value, (ast.Name, ast.Tuple, ast.Dict)
            ):
                aliases[target] = value
        return aliases

    def base(self, name: str) -> str:
        """The name a chain of aliases leads back to."""
        seen = set()
        while name in self.aliases and isinstance(
            self.aliases[name], ast.Name
        ):
            if name in seen:
                break
            seen.add(name)
            name = self.aliases[name].id
        return name

    def value(self, name: str):
        """What a name means here: a closed-over value, a parameter's
        default, or a global (builtins too); ``_MISSING`` for a local."""
        code, function = self.code, self.function
        if self.stores.get(name):
            # Rebound in the body (a default replaced, a nonlocal
            # assigned): not what its default or cell held.
            return _MISSING
        if name in code.co_freevars:
            cell = function.__closure__[code.co_freevars.index(name)]
            return cell.cell_contents if _cell_is_set(cell) else _MISSING
        defaults = function.__defaults__ or ()
        with_defaults = self.positional[len(self.positional) - len(defaults) :]
        if name in with_defaults:
            return defaults[with_defaults.index(name)]
        if name in (function.__kwdefaults__ or {}):
            return function.__kwdefaults__[name]
        if name in self.positional or name == self.vararg:
            return _MISSING
        if name in function.__globals__:
            return function.__globals__[name]
        builtins = function.__globals__.get("__builtins__", {})
        if isinstance(builtins, types.ModuleType):
            builtins = vars(builtins)
        return builtins.get(name, _MISSING)

    def _own(self) -> list:
        """The formula's own entity, period and parameters, as markers."""
        if len(self.positional) >= 3:
            own = self.positional[:3]
            if any(self.stores.get(name) for name in own):
                return []
            return own
        if not self.positional and self.vararg:
            if self.stores.get(self.vararg):
                return []
            return ["*0", "*1", "*2"]
        return []

    def _star(self, value) -> list | None:
        if isinstance(value, ast.Name):
            name = self.base(value.id)
            if name == self.vararg and not self.positional:
                return [ast.Name(id=f"*{i}") for i in range(3)]
            alias = self.aliases.get(name)
            return list(alias.elts) if isinstance(alias, ast.Tuple) else None
        if isinstance(value, (ast.Tuple, ast.List)):
            return list(value.elts)
        return None

    def _double_star(self, value) -> dict | None:
        if isinstance(value, ast.Name):
            value = self.aliases.get(self.base(value.id))
        if isinstance(value, ast.Dict) and all(
            isinstance(k, ast.Constant) and isinstance(k.value, str)
            for k in value.keys
        ):
            return {k.value: v for k, v in zip(value.keys, value.values)}
        if (
            isinstance(value, ast.Call)
            and isinstance(value.func, ast.Name)
            and self.value(self.base(value.func.id)) is dict
            and not value.args
            and all(kw.arg for kw in value.keywords)
        ):
            return {kw.arg: kw.value for kw in value.keywords}
        return None

    def _bind(self, call, signature) -> dict | None:
        """The call's arguments bound to ``signature``'s four names, or
        ``None`` if they don't bind exactly."""
        positional = []
        for arg in call.args:
            if isinstance(arg, ast.Starred):
                expanded = self._star(arg.value)
                if expanded is None:
                    return None
                positional += expanded
            else:
                positional.append(arg)
        keywords = {}
        for keyword in call.keywords:
            items = (
                {keyword.arg: keyword.value}
                if keyword.arg
                else self._double_star(keyword.value)
            )
            if items is None or keywords.keys() & items.keys():
                return None
            keywords.update(items)
        if len(positional) > len(signature):
            return None
        bound = dict(zip(signature, positional))
        for name, value in keywords.items():
            if name not in signature or name in bound:
                return None
            bound[name] = value
        return bound if len(bound) == len(signature) else None

    def _is_own(self, node, index, own) -> bool:
        if not isinstance(node, ast.Name):
            return False
        name = node.id if node.id.startswith("*") else self.base(node.id)
        return name == own[index]

    def found(self) -> dict:
        own = self._own()
        if not own:
            return {}
        helper = _formula_helper()
        good, held = set(), {}
        for call in ast.walk(self.node):
            if (
                not isinstance(call, ast.Call)
                or id(call) in self.nested
                or not isinstance(call.func, ast.Name)
                or isinstance(self.parents.get(id(call)), ast.Expr)
            ):
                continue
            callee = self.value(self.base(call.func.id))
            if helper is not None and callee is helper:
                signature, slot = _HELPER_SIGNATURE, "variable"
            elif isinstance(callee, types.FunctionType) and (
                self.behaviour.of(callee) in self.formulas
            ):
                names = callee.__code__.co_varnames
                if callee.__code__.co_argcount != 3:
                    continue
                signature, slot = tuple(names[:3]), None
            else:
                continue
            bound = self._bind(call, signature)
            if bound is None:
                continue
            arguments = [bound[name] for name in signature if name != slot]
            if not all(
                self._is_own(node, i, own) for i, node in enumerate(arguments)
            ):
                continue
            target = bound[slot] if slot else call.func
            if not isinstance(target, ast.Name):
                continue
            value = self.value(self.base(target.id))
            if slot and not _is_variable(value):
                continue
            good.add(id(target))
            held[id(value)] = value
        alias_values = {
            id(v) for v in self.aliases.values() if isinstance(v, ast.Name)
        }
        loads: dict = {}
        for name in ast.walk(self.node):
            if not (
                isinstance(name, ast.Name) and isinstance(name.ctx, ast.Load)
            ):
                continue
            if id(name) in alias_values:
                continue
            base = self.base(name.id)
            value = self.value(base)
            if id(value) not in held:
                continue
            entry = loads.setdefault(id(value), [0, 0])
            entry[0] += id(name) in good and id(name) not in self.nested
            entry[1] += 1
        return {
            key: value
            for key, value in held.items()
            if loads.get(key, [0, 1])[0] == loads.get(key, [0, 1])[1]
        }


# Read directly, never through pickling: values, containers, code.
_NOT_REBUILT = (
    bool,
    int,
    float,
    complex,
    str,
    bytes,
    bytearray,
    list,
    tuple,
    dict,
    set,
    frozenset,
    type,
    types.ModuleType,
    types.FunctionType,
    types.BuiltinFunctionType,
    enum.Enum,
)


def _rebuilt_from(value):
    """What rebuilds a standard-library object (its constructor's
    arguments and state, as pickling gives them): an ``itemgetter``'s key, a
    ``Decimal``'s digits. ``None`` for anything else."""
    kind = type(value)
    if isinstance(value, _NOT_REBUILT) or value is None:
        return None
    top = (kind.__module__ or "").split(".")[0].lstrip("_")
    if top not in sys.stdlib_module_names and top != "builtins":
        return None
    try:
        reduced = value.__reduce_ex__(4)
    except Exception:  # noqa: BLE001 - not reducible: read as before
        return None
    if not isinstance(reduced, tuple) or len(reduced) < 2:
        return None
    return tuple(reduced[1:3])


def _formula_helper():
    """The templates' helper for a variable's own result (imported here:
    the templates import this module)."""
    try:
        from uk_budget_data.measure_templates import _call_formula
    except ImportError:  # pragma: no cover - always present in this package
        return None
    return _call_formula


def _fields_of(value) -> dict:
    """An object's ``__dict__`` and slots."""
    found = dict(getattr(value, "__dict__", None) or {})
    for kind in type(value).__mro__:
        slots = kind.__dict__.get("__slots__", ())
        for name in [slots] if isinstance(slots, str) else slots:
            if name in ("__dict__", "__weakref__") or name in found:
                continue
            stored = name
            if name.startswith("__") and not name.endswith("__"):
                # Python stores a private slot under the class's name.
                stored = f"_{kind.__name__.lstrip('_')}{name}"
            try:
                found[name] = getattr(value, stored)
            except AttributeError:
                pass
    return found


def _engine(value):
    """``(kind, name)`` for an engine object a formula holds, read by name
    as formulas read the engine's own: a simulation or system (its data are
    what is being costed, its variables and parameters are compared
    directly), a population or entity, or a parameter, view or scale, whose
    path is the name. ``None`` for anything else."""
    if isinstance(value, type) or _is_variable(value):
        return None
    if hasattr(value, "tax_benefit_system") and hasattr(value, "calculate"):
        return ("simulation", None)
    if all(
        hasattr(value, a) for a in ("variables", "parameters", "get_variable")
    ):
        return ("system", None)
    module = type(value).__module__ or ""
    if module.startswith(
        ("policyengine_core.parameters", "policyengine_core.taxscales")
    ):
        name = getattr(value, "name", None) or getattr(value, "_name", None)
        return ("parameter", name if isinstance(name, str) else None)
    if module.startswith(
        ("policyengine_core.populations", "policyengine_core.entities")
    ):
        return (type(value).__qualname__, None)
    return None


def _is_component(value) -> bool:
    """Something whose code or fields can read a variable or a parameter."""
    if isinstance(
        value, (types.FunctionType, functools.partial, types.MethodType)
    ):
        return True
    if isinstance(value, (classmethod, staticmethod, property)):
        return True
    if _is_variable(value):
        return True
    if isinstance(value, type):
        return not _library_class(value)
    if isinstance(value, (enum.Enum, types.ModuleType, numpy.ndarray)):
        return False
    if _engine(value) is not None:
        return False
    # Any other object of a class from model or measure code, fields or
    # none: its class's methods are code too.
    return not _library_class(type(value))


def _reads(limit: DataLimit, names: set) -> bool:
    """Whether code using ``names`` reads what ``limit`` covers: its missing
    input, a parameter path under it, or every segment of one (formulas
    reach parameters by attribute)."""
    if limit.missing_input in names:
        return True
    return any(
        set(prefix.split(".")) <= names
        or any(_under(name, prefix) for name in names)
        for prefix in limit.parameters
    )


def _formulas_touched(base_system, reform_system, behaviour=None) -> dict:
    """For each limit's key, the variables that behave differently between
    the two systems (see :class:`_Behaviour`; replaced, added, removed or
    neutralised, by a modifier or a reform class) where the code that
    differs reads what the limit covers (see :func:`_reads`).

    The code that differs is each side's formulas and what they hold. A
    variable or formula a formula holds and uses only for the result it
    gives on that formula's own arguments (see
    :meth:`_Behaviour.uses_as_results`) is left out when it is unchanged: a
    variable either system has, or part of both sides' chains of results.
    A side the other's chain uses for its own result is left out too (a
    template that adds to it). What is done with such a result is
    downstream of the pricing, partly computable as abolishing SDLT is. A
    held variable called with other arguments (a changed purchase base, say)
    is followed like any code, as is a held original never called, or
    called and its result discarded.
    """
    behaviour = behaviour or _Behaviour()
    base, reform = base_system.variables, reform_system.variables
    changed = [
        name
        for name in sorted(base.keys() | reform.keys())
        if behaviour.of(base.get(name)) != behaviour.of(reform.get(name))
    ]
    if not changed:
        return {}
    installed = {
        behaviour.of(item)
        for variables in (base, reform)
        for variable in variables.values()
        for item in (variable, *(variable.formulas or {}).values())
    }
    found: dict = {}
    for name in changed:
        before, after = base.get(name), reform.get(name)
        formulas = installed | {
            behaviour.of(f)
            for side in (before, after)
            for held in behaviour.variables_held(side)
            for f in (held.formulas or {}).values()
        }
        chains = {
            id(side): behaviour.chain(side, formulas)
            for side in (before, after)
        }
        unchanged = installed | (chains[id(before)] & chains[id(after)])
        names = set()
        for side, other in ((before, after), (after, before)):
            if side is None or _wrapped(behaviour, side, chains[id(other)]):
                continue
            names |= behaviour.names(side, unchanged, formulas, installed)
        for limit in DATA_LIMITS:
            if _reads(limit, names):
                found.setdefault(limit.key, []).append(f"formula:{name}")
    return found


def limits_touched(sim_baseline, sim_reform) -> list[dict]:
    """The limits a measure touches, as recorded in its receipt.

    A limit is touched when, in the two built simulations:

    - the stored parameters under it differ, by position and effective
      value (parameter changes or modifiers, on either side; a reordered,
      replaced, re-typed or added parameter; not a redundant breakpoint, a
      label or 40000 against 40000.0);
    - or only what formulas read under it differs (a modifier that edited
      cached views, or a parameter class that changes between breakpoints),
      recorded as the limit's own prefix;
    - or a variable behaves differently and the code that differs reads
      what the limit covers (see :func:`_formulas_touched`), recorded as
      ``formula:<variable>``.
    """
    base_system = sim_baseline.tax_benefit_system
    reform_system = sim_reform.tax_benefit_system
    base, reform = base_system.parameters, reform_system.parameters
    behaviour = _Behaviour()
    formulas = _formulas_touched(base_system, reform_system, behaviour)
    touched = []
    with (
        _caches_left_as_found(base_system),
        _caches_left_as_found(reform_system),
    ):
        for limit in DATA_LIMITS:
            differing = []
            for prefix in limit.parameters:
                before, after = _structure(base, prefix), _structure(
                    reform, prefix
                )
                found = [
                    path
                    for path in before.keys() | after.keys()
                    if not _same_effect(before.get(path), after.get(path))
                ]
                if not found and not _equal(
                    _views(base_system, prefix, behaviour),
                    _views(reform_system, prefix, behaviour),
                ):
                    found = [prefix]
                differing += found
            differing += formulas.get(limit.key, [])
            if differing:
                touched.append(record(limit, differing))
    return touched


def record(limit: DataLimit, parameters: Iterable[str]) -> dict:
    """A limit as the receipt and manifest record it."""
    return {
        "key": limit.key,
        "reason": limit.reason,
        "parameters": sorted(set(parameters)),
    }


def _formula_path(path) -> bool:
    """A recorded ``formula:<variable>`` path (see :func:`limits_touched`)."""
    return (
        isinstance(path, str)
        and path.startswith("formula:")
        and path[len("formula:") :].isidentifier()
    )


def record_problems(records) -> list[str]:
    """Ways a recorded list of limits is not one this registry produced."""
    if not isinstance(records, list):
        return ["data_limits must be a list"]
    known = {limit.key: limit for limit in DATA_LIMITS}
    order = list(known)
    problems = []
    keys = [r.get("key") if isinstance(r, dict) else None for r in records]
    if (
        any(key not in known for key in keys)
        or len(set(keys)) != len(keys)
        or keys != sorted(keys, key=order.index)
    ):
        problems.append(
            "data_limits must list known limits once each, in registry order"
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
                limits_for_paths([path]) != [limit] and not _formula_path(path)
                for path in paths
            )
        ):
            problems.append(
                f"{limit.key}: its parameters must be a sorted, non-empty "
                "list of paths under that limit"
            )
    return problems
