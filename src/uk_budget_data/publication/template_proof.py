"""Record when a bound modifier consists solely of registered templates.

The released receipt API first proves the module's fixed shape and that
its imported code and state still match its source. Within that module we
accept only assignments of template calls (optionally subscripted) followed
by a returned template call. Arguments are literals, function parameters,
earlier assignment names or module literal constants. Any other form is a
hand-written modifier, including a helper call around a template.
"""

import ast
import inspect
import re
import sys
from types import ModuleType, SimpleNamespace

from uk_budget_data import measure_templates


def registered_templates() -> dict:
    """Resolve the explicit registry, refusing a missing or invalid member."""
    result = {}
    for name in measure_templates.TEMPLATES:
        function = (
            getattr(measure_templates, name, None)
            if isinstance(name, str)
            else None
        )
        if not inspect.isfunction(function):
            raise RuntimeError(
                f"Invalid registered measure template: {name!r}"
            )
        if name in result:
            raise RuntimeError(
                f"Duplicate registered measure template: {name}"
            )
        result[name] = function
    return result


def _literal(node: ast.AST) -> bool:
    try:
        ast.literal_eval(node)
        return True
    except (ValueError, TypeError, SyntaxError, RecursionError):
        return False


def pure_templates(modifier, revision) -> list[str] | None:
    """The template ids proving a modifier is pure, or None for hand-written.

    Source alone is insufficient: a reassigned import, altered defaults or
    edited file must never earn a carve-out. Use the installed receipt API
    to check all of them before interpreting the function's body.
    """
    from uk_budget_data.publication.receipt import receipt_api

    registered = registered_templates()
    api, _ = receipt_api()
    try:
        api.scenario_reform_identity(
            SimpleNamespace(
                applied_before_data_load=False,
                parameter_changes=None,
                simulation_modifier=modifier,
            ),
            code_revision=revision.as_binding(),
        )
        module = sys.modules[modifier.__module__]
        tree = ast.parse(inspect.getsource(module))
        definition = next(
            node
            for node in tree.body
            if isinstance(node, ast.FunctionDef)
            and node.name == modifier.__name__
        )
    except (
        api.ReceiptError,
        OSError,
        TypeError,
        SyntaxError,
        KeyError,
        StopIteration,
    ):
        return None
    parameters = {
        argument.arg
        for argument in (
            *definition.args.posonlyargs,
            *definition.args.args,
            *definition.args.kwonlyargs,
        )
    }
    if definition.args.vararg:
        parameters.add(definition.args.vararg.arg)
    if definition.args.kwarg:
        parameters.add(definition.args.kwarg.arg)
    constants = set()
    for statement in tree.body:
        if isinstance(statement, ast.Assign) and _literal(statement.value):
            constants.add(statement.targets[0].id)
        elif (
            isinstance(statement, ast.AnnAssign)
            and statement.value is not None
            and _literal(statement.value)
        ):
            constants.add(statement.target.id)
    names = parameters | constants
    assigned = set()
    used = set()

    def argument(node):
        return _literal(node) or (
            isinstance(node, ast.Name) and node.id in names
        )

    def template_call(node):
        if not isinstance(node, ast.Call):
            return False
        root = node.func
        attributes = []
        while isinstance(root, ast.Attribute):
            attributes.append(root.attr)
            root = root.value
        if not isinstance(root, ast.Name) or root.id in parameters | assigned:
            return False
        value = vars(module).get(root.id)
        for attribute in reversed(attributes):
            if not isinstance(value, ModuleType):
                return False
            value = vars(value).get(attribute)
        template_id = next(
            (
                name
                for name, function in registered.items()
                if function is value
            ),
            None,
        )
        if template_id is None:
            return False
        if not all(argument(value) for value in node.args) or not all(
            keyword.arg is not None and argument(keyword.value)
            for keyword in node.keywords
        ):
            return False
        used.add(template_id)
        return True

    if not definition.body or not isinstance(definition.body[-1], ast.Return):
        return None
    for statement in definition.body[:-1]:
        if (
            not isinstance(statement, ast.Assign)
            or len(statement.targets) != 1
            or not isinstance(statement.targets[0], ast.Name)
        ):
            return None
        value = statement.value
        if isinstance(value, ast.Subscript):
            if not argument(value.slice):
                return None
            value = value.value
        if not template_call(value):
            return None
        target = statement.targets[0].id
        assigned.add(target)
        names.add(target)
    if not template_call(definition.body[-1].value):
        return None
    return sorted(used)


def scenario_templates(scenario, revision) -> list:
    """One proof per modifier on a scenario; parameter-only sides have none."""
    modifier = getattr(scenario, "simulation_modifier", None)
    return [] if modifier is None else [pure_templates(modifier, revision)]


def measure_templates_proof(reform, config, revision) -> dict:
    """Record each side's actual modifier, including an inherited baseline."""
    return {
        "baseline": scenario_templates(
            reform.baseline_scenario_for(config), revision
        ),
        "reform": scenario_templates(reform.to_scenario(), revision),
    }


def combined_templates_proof(members, config, revision) -> dict:
    """Member proofs in the same application order as combined_identities."""
    result = {"baseline": [], "reform": []}
    configured_included = False
    for member in members:
        proof = measure_templates_proof(member, config, revision)
        bound = member.has_custom_baseline() or not configured_included
        if bound:
            result["baseline"].extend(proof["baseline"])
            configured_included |= not member.has_custom_baseline()
        result["reform"].extend(proof["reform"])
    return result


def modifier_counts(document: dict) -> dict:
    """Number of bound modifiers, from identities already checked by the gate."""
    dashboard = document.get("dashboard") or {}
    members = dashboard.get("members") or []
    execution = document.get("execution_receipt") or {}
    result = {}
    for side in ("baseline", "reform"):
        identities = (
            [
                member.get(side) or {}
                for member in members
                if isinstance(member, dict)
                if side == "reform" or member.get("baseline_bound") is True
            ]
            if members
            else [execution.get(side) or {}]
        )
        result[side] = sum(
            identity.get("binding") == "code_revision"
            for identity in identities
            if isinstance(identity, dict)
        )
    return result


def record_problems(document: dict) -> list[str]:
    """Reject absent, malformed or incomplete modifier-template proofs."""
    proof = (document.get("dashboard") or {}).get("modifier_templates")
    if not isinstance(proof, dict) or set(proof) != {"baseline", "reform"}:
        return [
            "its modifier templates are not recorded as baseline and reform"
        ]
    known = registered_templates()
    counts = modifier_counts(document)
    problems = []
    hand_written = False
    for side in ("baseline", "reform"):
        records = proof[side]
        if not isinstance(records, list):
            problems.append(f"its {side} modifier templates are not a list")
            continue
        if len(records) != counts[side]:
            problems.append(
                f"its {side} modifier templates do not match its bound modifiers"
            )
        for record in records:
            if record is None:
                hand_written = True
                continue
            if (
                not isinstance(record, list)
                or not record
                or any(
                    not isinstance(name, str) or name not in known
                    for name in record
                )
                or record != sorted(set(record))
            ):
                problems.append(
                    f"its {side} modifier template proof is malformed"
                )
    if hand_written:
        generation = (document.get("dashboard") or {}).get("generation_id")
        if (
            not isinstance(generation, str)
            or re.fullmatch(r"[0-9a-f]{32}", generation) is None
        ):
            problems.append(
                "its hand-written modifiers do not record a generation id"
            )
    return problems
