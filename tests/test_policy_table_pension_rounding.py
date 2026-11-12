"""Differential checks on the real table/modifier code, without model imports.

The synthetic person has enough tax, no Step 7 charges and no excess income,
so the modifier's reduction is the maximum the policy table describes.
"""

import __future__
import ast
import inspect
import math
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

ROOT = Path(__file__).resolve().parents[1]
MODIFIER = ROOT / "src/uk_budget_data/budget_measures/pension_tax_allowance.py"
TABLE = ROOT / "src/uk_budget_data/policy_table.py"


def _load_functions(path, names, namespace):
    tree = ast.parse(path.read_text())
    nodes = [
        node
        for node in tree.body
        if isinstance(node, ast.FunctionDef) and node.name in names
    ]
    assert {node.name for node in nodes} == set(names)
    exec(
        compile(
            ast.Module(body=nodes, type_ignores=[]),
            str(path),
            "exec",
            flags=__future__.annotations.compiler_flag,
        ),
        namespace,
    )


def _implementations():
    namespace = {
        "__name__": "pension_rounding_source_test",
        "np": np,
        "math": math,
        "inspect": inspect,
        "POLICY_YEARS": range(2026, 2032),
        "POUNDS": "pounds",
        "UNIT_WORDS": {"pounds": "£ a year"},
        "registry": SimpleNamespace(PERSONAL_ALLOWANCE="personal_allowance"),
    }
    _load_functions(MODIFIER, ["pension_tax_allowance"], namespace)
    namespace["pension_tax_allowance"].__module__ = (
        "uk_budget_data.budget_measures.pension_tax_allowance"
    )
    _load_functions(
        TABLE,
        [
            "constants",
            "_fiscal_label",
            "_clean",
            "_point",
            "_yearly",
            "_row",
            "_source",
            "_modifier_source",
            "_pension_tax_allowance",
        ],
        namespace,
    )
    defaults = namespace["constants"](namespace["pension_tax_allowance"])
    namespace.update({k: v for k, v in defaults.items() if k != "sim"})
    tree = ast.parse(MODIFIER.read_text())
    outer = next(
        node
        for node in tree.body
        if isinstance(node, ast.FunctionDef)
        and node.name == "pension_tax_allowance"
    )
    nested = [
        node
        for node in outer.body
        if isinstance(node, ast.FunctionDef)
        and node.name in {"in_force", "reduction_used", "formula"}
    ]
    assert {node.name for node in nested} == {
        "in_force",
        "reduction_used",
        "formula",
    }
    namespace.update(
        native=None,
        STEP_7_CHARGES=("CB_HITC", "personal_pension_contributions_tax"),
        MONTHS_TO_MID_YEAR=6,
        _call_formula=lambda *_: np.array([100_000.0]),
    )
    exec(
        compile(
            ast.Module(body=nested, type_ignores=[]), str(MODIFIER), "exec"
        ),
        namespace,
    )
    return namespace


def _assert_table_matches_modifier(implementations, weekly):
    namespace = implementations
    namespace["engine_value"] = lambda path, _year: (
        12_570.0 if path == "personal_allowance" else weekly
    )
    row = namespace["_pension_tax_allowance"](None)[0]
    parameters = SimpleNamespace(
        gov=SimpleNamespace(
            dwp=SimpleNamespace(
                state_pension=SimpleNamespace(
                    new_state_pension=SimpleNamespace(amount=weekly)
                )
            ),
            hmrc=SimpleNamespace(
                income_tax=SimpleNamespace(
                    allowances=SimpleNamespace(
                        personal_allowance=SimpleNamespace(amount=12_570.0)
                    )
                )
            ),
        )
    )

    def person(_name, _period):
        return np.array([0.0])

    for point in row["points"]:
        period = SimpleNamespace(start=SimpleNamespace(year=point["year"]))
        tax = namespace["formula"](person, period, lambda _: parameters)
        assert point["before"] == 0
        assert point["after"] == pytest.approx(100_000.0 - tax[0], abs=1e-9)
    assert "nearest 5p" in row["source"]["after"]["where"]
    assert "rounded down" not in row["source"]["after"]["where"]


@pytest.mark.parametrize(
    "weekly",
    [
        250.65,
        250.674999,
        250.675,
        250.675001,
        250.7,
        259.224999,
        259.225,
        259.225001,
        259.2357292385871,
    ],
)
def test_table_matches_modifier_at_five_pence_boundaries(weekly):
    _assert_table_matches_modifier(_implementations(), weekly)


@settings(max_examples=100, deadline=None)
@given(st.floats(min_value=242, max_value=350, allow_nan=False))
def test_table_matches_modifier_for_weekly_rates(weekly):
    _assert_table_matches_modifier(_implementations(), weekly)
