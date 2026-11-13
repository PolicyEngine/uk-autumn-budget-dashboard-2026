"""Formula-runner trust checks without importing PolicyEngine or microdata.

The adoption CI already exercises real templates through Observation. These
small contract cases isolate the runner identity gate, including custom
runners that must remain fail-closed. Run directly with Python under a local
model-import hold; normal pytest also collects these unittest cases.
"""

import ast
import types
import unittest
from pathlib import Path

SOURCE = (
    Path(__file__).resolve().parents[1] / "src/uk_budget_data/data_limits.py"
)


def runner_check():
    """Load only the pure gate; the package imports the full model."""
    tree = ast.parse(SOURCE.read_text())
    function = next(
        node
        for node in tree.body
        if isinstance(node, ast.FunctionDef)
        and node.name == "_known_formula_runner"
    )
    namespace = {"types": types}
    exec(
        compile(
            ast.Module(body=[function], type_ignores=[]), str(SOURCE), "exec"
        ),
        namespace,
    )
    return namespace["_known_formula_runner"]


class CoreRunner:
    def _run_formula(self, *args):
        return None


class ModelRunner(CoreRunner):
    def _run_formula(self, *args):
        return super()._run_formula(*args)


class InheritedModelRunner(ModelRunner):
    pass


class CustomRunner(ModelRunner):
    def _run_formula(self, *args):
        return super()._run_formula(*args)


class RunnerCompatibilityTests(unittest.TestCase):
    def setUp(self):
        self.known = (CoreRunner._run_formula, ModelRunner._run_formula)
        self.accepts = runner_check()

    def test_core_runner_is_observable(self):
        self.assertTrue(self.accepts(CoreRunner(), self.known))

    def test_installed_model_wrapper_is_observable(self):
        self.assertTrue(self.accepts(ModelRunner(), self.known))

    def test_inherited_model_wrapper_is_observable(self):
        self.assertTrue(self.accepts(InheritedModelRunner(), self.known))

    def test_custom_subclass_wrapper_stays_unobservable(self):
        self.assertFalse(self.accepts(CustomRunner(), self.known))

    def test_instance_replacement_stays_unobservable(self):
        simulation = ModelRunner()
        simulation._run_formula = lambda *args: None
        self.assertFalse(self.accepts(simulation, self.known))

    def test_known_method_bound_to_another_simulation_is_not_trusted(self):
        simulation = ModelRunner()
        other = ModelRunner()
        simulation._run_formula = types.MethodType(
            ModelRunner._run_formula, other
        )
        self.assertFalse(self.accepts(simulation, self.known))

    def test_unbound_known_function_on_an_instance_is_not_trusted(self):
        simulation = ModelRunner()
        simulation._run_formula = ModelRunner._run_formula
        self.assertFalse(self.accepts(simulation, self.known))

    def test_copied_code_does_not_acquire_trust(self):
        simulation = ModelRunner()
        copied = types.FunctionType(
            ModelRunner._run_formula.__code__,
            globals(),
            closure=ModelRunner._run_formula.__closure__,
        )
        simulation._run_formula = types.MethodType(copied, simulation)
        self.assertFalse(self.accepts(simulation, self.known))

    def test_callable_equality_does_not_acquire_trust(self):
        class EqualRunner:
            def __eq__(self, other):
                return True

            def __call__(self, *args):
                return None

        simulation = ModelRunner()
        simulation._run_formula = EqualRunner()
        self.assertFalse(self.accepts(simulation, self.known))

    def test_missing_or_unreadable_runner_stays_unobservable(self):
        class Unreadable:
            @property
            def _run_formula(self):
                raise RuntimeError("not readable")

        self.assertFalse(self.accepts(object(), self.known))
        self.assertFalse(self.accepts(Unreadable(), self.known))


if __name__ == "__main__":
    unittest.main()
