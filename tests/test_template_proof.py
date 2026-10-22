"""Pure-template evidence is deliberately narrower than receipt binding."""

import importlib.util
import sys
from contextlib import contextmanager
from pathlib import Path
from tempfile import TemporaryDirectory
from uuid import uuid4

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from tests import template_measures
from tests.attestation_measures import template_helper_modifier
from tests.publication_support import World, make_household_rows, make_tables
from tests.unbindable_template_measures import partial_payment_modifier
from uk_budget_data import measure_templates
from uk_budget_data.models import DataConfig, Reform, ReformResult
from uk_budget_data.publication import combine, generate
from uk_budget_data.publication.artifacts import read_receipt
from uk_budget_data.publication.receipt import (
    CodeRevision,
    ReceiptInputs,
    dashboard_problems,
)
from uk_budget_data.publication.template_proof import (
    combined_templates_proof,
    measure_templates_proof,
    pure_templates,
    record_problems,
    registered_templates,
)

REVISION = CodeRevision("a" * 40, True)
IMPORTS = """from uk_budget_data.measure_templates import (
    allowance_uprating, apply_age_conditioned_allowance,
    apply_vat_base_change, rate_change)
PATH = "gov.hmrc.income_tax.allowances.personal_allowance.amount"
RATE = 0.5
"""


@contextmanager
def loaded(source):
    """Import unrevised source, as the released receipt API requires."""
    name = "template_proof_" + uuid4().hex
    with TemporaryDirectory(prefix="template-proof-") as directory:
        path = Path(directory) / f"{name}.py"
        path.write_text(source)
        spec = importlib.util.spec_from_file_location(name, path)
        module = importlib.util.module_from_spec(spec)
        sys.modules[name] = module
        try:
            spec.loader.exec_module(module)
            yield module
        finally:
            sys.modules.pop(name, None)


@st.composite
def pure_source(draw):
    count = draw(st.integers(min_value=0, max_value=3))
    amount = draw(st.integers(min_value=1, max_value=100_000))
    year = draw(st.integers(min_value=2026, max_value=2030))
    rate = draw(st.sampled_from(["RATE", "taper_rate", "0.25"]))
    source = IMPORTS + "\ndef modifier(sim, taper_rate=0.5):\n"
    for index in range(count):
        source += (
            f"    values{index} = allowance_uprating("
            f"PATH, {amount}, {{{year}: 0.02}})[PATH]\n"
        )
    values = f"values{count - 1}" if count else f"{{{year}: {amount}}}"
    source += (
        "    return apply_age_conditioned_allowance(sim, "
        f"allowance_by_year={values}, taper_threshold={amount}, taper_rate={rate})\n"
    )
    return source


def test_every_registered_template_exists():
    assert tuple(registered_templates()) == measure_templates.TEMPLATES


def test_a_missing_registered_template_is_a_configuration_error(monkeypatch):
    monkeypatch.setattr(measure_templates, "TEMPLATES", ("missing_template",))
    with pytest.raises(RuntimeError, match="Invalid registered"):
        registered_templates()


@pytest.mark.parametrize(
    ("name", "expected"),
    [
        ("vat_modifier", ["apply_vat_base_change"]),
        ("payment_modifier", ["apply_benefit_receipt_payment"]),
        (
            "allowance_modifier",
            ["allowance_uprating", "apply_age_conditioned_allowance"],
        ),
        ("property_modifier", ["apply_property_band_surcharge"]),
    ],
)
def test_every_template_measure_is_pure(name, expected):
    assert (
        pure_templates(getattr(template_measures, name), REVISION) == expected
    )


@given(pure_source())
@settings(max_examples=35, deadline=None, database=None)
def test_generated_pure_forms_are_accepted(source):
    with loaded(source) as module:
        proof = pure_templates(module.modifier, REVISION)
        assert proof is not None
        assert "apply_age_conditioned_allowance" in proof


MUTATIONS = [
    "    pass\n",
    "    print(sim)\n",
    "    unused = 1\n",
    "    unused = helper(sim)\n",
    "    unused = rate_change(PATH, sim.calculate('age', 2027))\n",
    "    unused = rate_change(PATH, sim.value)\n",
    "    unused = rate_change(PATH, unknown)\n",
    "    unused = rate_change(PATH, *sim)\n",
    "    unused = rate_change(PATH, **sim)\n",
    "    sim.value = rate_change(PATH, {2027: 1})\n",
    "    import math\n",
    "    if sim:\n        return sim\n",
    "    return sim\n",
]


@given(pure_source())
@settings(max_examples=15, deadline=None, database=None)
def test_each_one_statement_mutation_is_hand_written(source):
    marker = "    return apply_age_conditioned_allowance"
    for mutation in MUTATIONS:
        mutated = source.replace(marker, mutation + marker)
        with loaded(mutated) as module:
            assert pure_templates(module.modifier, REVISION) is None


@pytest.mark.parametrize(
    "source",
    [
        # Even a template call in the body cannot make arbitrary arguments pure.
        IMPORTS
        + "\ndef modifier(sim):\n"
        + "    return apply_vat_base_change(sim, rate_change=abs(-1))\n",
        IMPORTS
        + "\ndef modifier(sim):\n"
        + "    return apply_vat_base_change(sim, rate_change=sim.rate)\n",
        # A module-level call gives the module state its source cannot bind.
        IMPORTS
        + "STATE = object()\n\ndef modifier(sim):\n"
        + "    return apply_vat_base_change(sim, rate_change=0.1)\n",
        # A parameter can shadow an imported template name.
        IMPORTS
        + "\ndef modifier(sim, apply_vat_base_change=None):\n"
        + "    return apply_vat_base_change(sim, rate_change=0.1)\n",
        IMPORTS
        + "\ndef modifier(sim):\n"
        + "    apply_vat_base_change = rate_change(PATH, {2027: 1})\n"
        + "    return apply_vat_base_change(sim, rate_change=0.1)\n",
    ],
)
def test_template_helpers_and_unfixed_modules_are_hand_written(source):
    with loaded(source) as module:
        assert pure_templates(module.modifier, REVISION) is None


def test_import_aliases_and_module_template_calls_are_pure():
    source = (
        "import uk_budget_data.measure_templates as templates\n"
        "from uk_budget_data.measure_templates import apply_vat_base_change as vat\n"
        "\ndef modifier(sim):\n"
        "    values = templates.rate_change('path', {2027: 0.1})\n"
        "    return vat(sim, rate_change=0.1)\n"
    )
    with loaded(source) as module:
        assert pure_templates(module.modifier, REVISION) == [
            "apply_vat_base_change",
            "rate_change",
        ]


def test_runtime_rebinding_or_edited_source_never_earns_a_carve_out():
    source = (
        IMPORTS
        + "\ndef modifier(sim):\n"
        + "    return apply_vat_base_change(sim, rate_change=0.1)\n"
    )
    with loaded(source) as module:
        module.apply_vat_base_change = module.rate_change
        assert pure_templates(module.modifier, REVISION) is None
    with loaded(source) as module:
        Path(module.__file__).write_text(source.replace("0.1", "0.2"))
        assert pure_templates(module.modifier, REVISION) is None


def test_partial_and_non_module_modifiers_are_hand_written():
    assert pure_templates(partial_payment_modifier, REVISION) is None
    assert pure_templates(template_helper_modifier, REVISION) is None
    assert pure_templates(lambda sim: sim, REVISION) is None


def test_combined_proofs_preserve_every_member_and_both_sides():
    config = DataConfig(years=[2027])
    pure = Reform(
        id="pure",
        name="Pure",
        simulation_modifier=template_measures.vat_modifier,
        baseline_simulation_modifier=template_measures.payment_modifier,
    )
    manual = Reform(
        id="manual", name="Manual", simulation_modifier=lambda sim: sim
    )
    parameter_only = Reform(
        id="parameter",
        name="Parameter",
        parameter_changes={"path": {"2027": 1}},
    )
    assert measure_templates_proof(parameter_only, config, REVISION) == {
        "baseline": [],
        "reform": [],
    }

    assert combined_templates_proof(
        [pure, manual, pure], config, REVISION
    ) == {
        "baseline": [
            ["apply_benefit_receipt_payment"],
            ["apply_benefit_receipt_payment"],
        ],
        "reform": [["apply_vat_base_change"], None, ["apply_vat_base_change"]],
    }


def test_generation_records_original_member_proofs_for_combined_runs(
    monkeypatch,
):
    world = World()
    monkeypatch.setattr(
        generate, "code_revision", lambda root: world.revision()
    )
    # Parameter consistency has its own real-simulation tests. This test
    # exercises which original modifiers the generator records.
    monkeypatch.setattr(combine, "check_consistency", lambda *args: None)

    def process(reform, config, baseline, reformed, baseline_scenario):
        values = {2027: 1.0}
        tables = make_tables(reform.id, values)
        tables.pop("household_scatter_binned")
        return ReformResult(
            reform_id=reform.id,
            reform_name=reform.name,
            household_scatter=make_household_rows(reform.id, values),
            constituency=[],
            demographic_constituency=[],
            **tables,
        )

    pure = Reform(
        id="pure",
        name="Pure",
        simulation_modifier=template_measures.vat_modifier,
        baseline_simulation_modifier=template_measures.payment_modifier,
    )
    helper = Reform(
        id="helper",
        name="Helper",
        simulation_modifier=template_helper_modifier,
    )
    try:
        report = generate.generate_artifacts(
            [pure, helper],
            DataConfig(years=[2027]),
            combined_sets=[[pure, helper]],
            artifacts_root=world.artifacts,
            build=lambda dataset, scenario=None: world.sim(),
            process=process,
        )
        assert report.refused == {}
        documents = {
            reference.key: read_receipt(reference.path)
            for reference in report.written
        }
        for document in documents.values():
            assert record_problems(document) == []
        combined = next(
            document
            for key, document in documents.items()
            if key.startswith("combined")
        )
        assert combined["dashboard"]["modifier_templates"] == {
            "baseline": [["apply_benefit_receipt_payment"]],
            # Member order is the composer's stable id order.
            "reform": [None, ["apply_vat_base_change"]],
        }
        assert "generation_id" in combined["dashboard"]
        assert "generation_id" not in documents["pure"]["dashboard"]
    finally:
        world.close()


@pytest.mark.parametrize(
    "proof",
    [
        None,
        {},
        {"baseline": [], "reform": [], "other": []},
        {"baseline": None, "reform": []},
        {"baseline": [], "reform": []},
        {"baseline": [], "reform": [[]]},
        {"baseline": [], "reform": [["unknown"]]},
        {"baseline": [], "reform": [["rate_change", "rate_change"]]},
        {"baseline": [], "reform": [["threshold_change", "rate_change"]]},
        {"baseline": [], "reform": [[{}]]},
    ],
)
def test_absent_malformed_or_incomplete_proofs_fail_shut(proof):
    document = {
        "execution_receipt": {
            "baseline": {"kind": "current_law"},
            "reform": {"binding": "code_revision"},
        },
        "dashboard": {"modifier_templates": proof},
    }
    assert record_problems(document)


def test_modifier_proof_is_required_at_construction():
    with pytest.raises(TypeError, match="modifier_templates"):
        ReceiptInputs(
            key="alpha",
            measure_ids=["alpha"],
            years=[2027],
            baseline_identity=None,
            reform_identity=None,
            file_digests={},
            basis={},
            revision=REVISION,
            data_limits=[],
            model_limits=[],
        )


def test_dashboard_validation_requires_modifier_proofs():
    world = World()
    try:
        reference = world.ready("alpha", {2027: 1.0})
        document = read_receipt(reference.path)
        assert dashboard_problems(document) == []
        del document["dashboard"]["modifier_templates"]
        assert any(
            "modifier templates" in problem
            for problem in dashboard_problems(document)
        )
    finally:
        world.close()


@pytest.mark.parametrize(
    "generation", [None, "", "generation", "f" * 31, "F" * 32, [], 42]
)
def test_handwritten_proof_requires_a_generation_id(generation):
    document = {
        "execution_receipt": {
            "baseline": {"kind": "current_law"},
            "reform": {"binding": "code_revision"},
        },
        "dashboard": {
            "modifier_templates": {"baseline": [], "reform": [None]},
            "generation_id": generation,
        },
    }
    assert any(
        "generation id" in problem for problem in record_problems(document)
    )
    document["dashboard"]["generation_id"] = "f" * 32
    assert record_problems(document) == []
