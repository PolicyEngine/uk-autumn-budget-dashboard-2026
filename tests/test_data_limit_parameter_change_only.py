"""Shared uprating paths hold parameter changes, not unrelated readers."""

import ast
from dataclasses import replace
from pathlib import Path
from types import CodeType, SimpleNamespace

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from uk_budget_data import data_limits, measure_templates

INPUT = "individual_savings_account_dividend_income"
GDP = "gov.economic_assumptions.indices.obr.per_capita.gdp"
ISA = next(x for x in data_limits.DATA_LIMITS if x.missing_input == INPUT)


def nested(code, name):
    for value in code.co_consts:
        if isinstance(value, CodeType):
            if value.co_name == name:
                return value
            found = nested(value, name)
            if found is not None:
                return found
    return None


def test_only_isa_dividend_gdp_is_classified_parameter_change_only():
    assert ISA.parameter_change_only == (GDP,)
    assert GDP in ISA.parameters
    assert len(ISA.parameters) == 6
    assert all(
        not x.parameter_change_only
        for x in data_limits.DATA_LIMITS
        if x is not ISA
    )


def test_default_keeps_legacy_structural_matching_and_digest_binds_mode():
    names = set(GDP.split("."))
    legacy = replace(ISA, parameter_change_only=())
    assert data_limits._reads(legacy, names)
    assert not data_limits._reads(ISA, names)
    assert data_limits.registry_digest(
        (legacy,)
    ) != data_limits.registry_digest((ISA,))


@pytest.mark.parametrize("paths", [("unlisted.path",), [GDP], (None,)])
def test_classification_must_be_valid_subset(paths):
    with pytest.raises(ValueError):
        replace(ISA, parameter_change_only=paths)


def test_actual_property_template_code_is_not_an_isa_reader():
    code = nested(
        measure_templates.apply_property_band_surcharge.__code__, "formula"
    )
    names = data_limits._code_names(code)
    assert set(GDP.split(".")) <= names
    assert INPUT not in names
    assert not data_limits._reads(ISA, names)


def test_existing_sdlt_wrapper_gdp_read_is_not_an_isa_read():
    source = Path(__file__).with_name("test_data_limits.py").read_text()
    node = next(
        x
        for x in ast.parse(source).body
        if isinstance(x, ast.FunctionDef) and x.name == "band_on_sdlt"
    )
    namespace = {}
    exec(
        compile(ast.Module([node], type_ignores=[]), __file__, "exec"),
        namespace,
    )
    code = nested(namespace["band_on_sdlt"].__code__, "indexed_native")
    assert not data_limits._reads(ISA, data_limits._code_names(code))


def isa_helper():
    return "individual_savings_account_dividend_income"


def formula():
    return isa_helper()


def test_direct_input_helper_gate_and_unknown_reads_remain_held():
    assert data_limits._reads(ISA, {INPUT})
    assert data_limits._reads(ISA, {data_limits.ANY_NAME})
    for variable in (
        SimpleNamespace(formulas={"start": formula}),
        SimpleNamespace(formulas={}, defined_for=INPUT),
    ):
        names = data_limits._direct_reader_names(variable)
        assert data_limits._reads(ISA, names)
    # A changed input's own name still identifies its metadata/defaults.
    assert data_limits._reads(ISA, {INPUT, "default_value", "uprating"})
    assert not data_limits._reads(ISA, {"unrelated"})


def test_all_five_council_roots_remain_structural_and_parameter_scopes():
    roots = [p for p in ISA.parameters if p != GDP]
    assert len(roots) == 5
    for path in roots:
        assert data_limits._reads(ISA, {path})
        assert ISA in data_limits.limits_for_paths([path])
    assert ISA in data_limits.limits_for_paths([GDP])


@pytest.mark.parametrize("side", ["baseline", "reform"])
def test_native_actual_gdp_tree_changes_still_hold_isa_dividends(side):
    """Real tiny household/parameter trees; run only in native CI."""
    from policyengine_uk import Simulation
    from policyengine_uk.system import system
    from policyengine_uk.utils.scenario import Scenario

    situation = {
        "people": {"p": {"age": {2027: 40}}},
        "benunits": {"b": {"members": ["p"]}},
        "households": {"h": {"members": ["p"]}},
    }
    value = system.parameters.get_child(GDP)("2027-01-01")
    plain = Simulation(situation=situation)
    changed = Simulation(
        situation=situation,
        scenario=Scenario(parameter_changes={GDP: {2027: value + 0.01}}),
    )
    date = "2027-01-01"
    before = plain.tax_benefit_system.parameters.get_child(GDP)(date)
    after = changed.tax_benefit_system.parameters.get_child(GDP)(date)
    assert before == pytest.approx(value)
    assert after == pytest.approx(value + 0.01)
    assert after != before
    pair = (changed, plain) if side == "baseline" else (plain, changed)
    record = next(
        x for x in data_limits.limits_touched(*pair) if x["key"] == INPUT
    )
    assert any(data_limits._under(path, GDP) for path in record["parameters"])


@settings(max_examples=25, deadline=None)
@given(
    upstream=st.sets(st.sampled_from((*GDP.split("."), GDP))),
    noise=st.sets(
        st.text(alphabet="xyz_", min_size=1, max_size=8).map(
            lambda value: "unrelated_" + value
        ),
        max_size=4,
    ),
)
def test_upstream_name_subsets_preserve_direct_reader_holds(upstream, noise):
    """Shared GDP names never imply ISA reads; actual reader roots still hold."""
    names = upstream | noise
    assert not data_limits._reads(ISA, names)
    for reader in (
        INPUT,
        data_limits.ANY_NAME,
        *(path for path in ISA.parameters if path != GDP),
    ):
        assert data_limits._reads(ISA, names | {reader})
    legacy = replace(ISA, parameter_change_only=())
    assert data_limits._reads(legacy, names | set(GDP.split(".")))
