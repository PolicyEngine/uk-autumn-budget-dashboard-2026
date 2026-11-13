"""Bounded direct-reader names, without executing model formula bodies."""

from types import SimpleNamespace

from uk_budget_data.data_limits import (
    _code_names,
    _direct_reader_names,
)


def variable(formula=None, **attributes):
    return SimpleNamespace(
        formulas={"start": formula} if formula else {}, **attributes
    )


def function(source, **globals_):
    exec(source, globals_)
    return globals_["formula"]


def limited_helper():
    raise AssertionError("missing_input")


def test_literal_defined_for_is_a_direct_reader():
    assert "missing_input" in _direct_reader_names(
        variable(defined_for="missing_input")
    )


def test_nonstring_defined_for_is_not_inferred():
    assert "missing_input" not in _direct_reader_names(
        variable(defined_for=["missing_input"])
    )


def test_direct_global_helper_names_are_read_without_calling_it():
    formula = function("def formula(): return helper()", helper=limited_helper)
    assert "missing_input" in _direct_reader_names(variable(formula))


def test_unloaded_global_function_is_not_followed():
    formula = function("def formula(): return 0", helper=limited_helper)
    assert "missing_input" not in _direct_reader_names(variable(formula))


def test_attribute_name_does_not_load_same_named_global():
    formula = function(
        "def formula(): return holder.helper",
        holder=object(),
        helper=limited_helper,
    )
    assert "missing_input" not in _direct_reader_names(variable(formula))


def test_a_helper_of_a_helper_is_not_followed():
    direct = function("def formula(): return inner()", inner=limited_helper)
    formula = function("def formula(): return direct()", direct=direct)
    assert "missing_input" not in _direct_reader_names(variable(formula))


def test_nonfunction_callable_is_not_inspected_or_called():
    class Callable:
        @property
        def __code__(self):
            raise AssertionError("must not inspect callable")

        def __call__(self):
            raise AssertionError("must not call callable")

    formula = function("def formula(): return helper()", helper=Callable())
    assert "missing_input" not in _direct_reader_names(variable(formula))


def test_module_attributes_are_not_resolved():
    formula = function(
        "def formula(): return module.helper()",
        module=SimpleNamespace(helper=limited_helper),
    )
    assert "missing_input" not in _direct_reader_names(variable(formula))


def test_cached_formula_and_helper_names_are_not_mutated():
    formula = function("def formula(): return helper()", helper=limited_helper)
    own = set(_code_names(formula.__code__))
    helper = set(_code_names(limited_helper.__code__))
    _direct_reader_names(variable(formula, defined_for="condition"))
    assert _code_names(formula.__code__) == own
    assert _code_names(limited_helper.__code__) == helper


def test_existing_formula_adds_subtracts_and_parameter_names_remain():
    formula = function(
        'def formula(): return parameters.gov.program.rate("x")'
    )
    names = _direct_reader_names(
        variable(formula, adds=["added", 1], subtracts="subtracted")
    )
    assert {"gov", "program", "rate", "x", "added", "subtracted"} <= names


def test_literal_names_in_nested_code_remain_visible():
    formula = function(
        'def formula():\n def nested(): return "missing_input"\n return nested()'
    )
    assert "missing_input" in _direct_reader_names(variable(formula))


def test_direct_reference_without_call_is_conservatively_included():
    formula = function("def formula(): return helper", helper=limited_helper)
    assert "missing_input" in _direct_reader_names(variable(formula))


def test_function_defined_for_is_not_followed():
    assert "missing_input" not in _direct_reader_names(
        variable(defined_for=limited_helper)
    )


def test_nonfunction_formula_is_not_inspected():
    class NotFunction:
        @property
        def __code__(self):
            raise AssertionError("must not inspect nonfunction formula")

    assert _direct_reader_names(variable(NotFunction())) == set()
