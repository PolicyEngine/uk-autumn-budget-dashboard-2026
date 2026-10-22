"""Hold VAT measures until the model grosses VAT up as policyengine-uk #2187
does.

The installed model divides household VAT on survey consumption by one
factor, ``gov.simulation.microdata_vat_coverage`` (0.38), to reach receipts.
#2187, in policyengine-uk 2.145.0 and later, divides by survey consumption
coverage times the household share of VAT receipts, 0.67 × 0.7 = 0.469, so
without it VAT runs about 23% high (coordinator, 22 October, from the UK
hub). A measure can move VAT through its parameters, through the VAT base
template, which replaces the ``vat`` formula, or through the consumption VAT
is charged on, so the limit covers variables as well as parameters.
"""

import copy
import math
import re
import warnings
from importlib import import_module
from types import SimpleNamespace

import pytest
from policyengine_core.parameters import ParameterNode
from policyengine_uk import Simulation
from policyengine_uk.system import system as installed_system
from policyengine_uk.utils.scenario import Scenario

from tests import template_measures
from tests.publication_support import World
from tests.test_model_limits import (
    INCOME_TAX,
    VALUES,
    built,
    generated,
    installed_with_the_fix,  # noqa: F401 - a fixture
    limit_by_key,
    simulation,
    world,  # noqa: F401 - a fixture
)
from uk_budget_data import data_limits, model_limits
from uk_budget_data import geography as g
from uk_budget_data.cli import parse_args
from uk_budget_data.measure_templates import ModelLimitedWarning, rate_change
from uk_budget_data.model_limits import (
    limits_for_paths,
    limits_for_scenarios,
    limits_touched,
    record,
    record_problems,
    variable_path,
)
from uk_budget_data.models import Reform
from uk_budget_data.publication import manifest as m
from uk_budget_data.publication.publish import approve, stage

LIMIT = limit_by_key("vat_consumption_coverage")
BENEFIT_LIMIT = limit_by_key("benefit_uprating_september_cpi")
STANDARD_RATE = "gov.hmrc.vat.standard_rate"
REDUCED_RATE = "gov.hmrc.vat.reduced_rate"
REDUCED_RATE_SHARE = "gov.hmrc.vat.reduced_rate_share"
COVERAGE = "gov.simulation.microdata_vat_coverage"
CPI_INDEX = "gov.economic_assumptions.indices.obr.consumer_price_index"
CPI_GROWTH = "gov.economic_assumptions.yoy_growth.obr.consumer_price_index"
SURVEY_COVERAGE = "gov.simulation.vat.survey_consumption_coverage"
HOUSEHOLD_SHARE = "gov.simulation.vat.household_share_of_receipts"
# #2187's factors, and their product, by which it divides household VAT.
FACTORS = {SURVEY_COVERAGE: 0.67, HOUSEHOLD_SHARE: 0.7}
FIXED_FACTOR = 0.67 * 0.7
VAT = variable_path("vat")
TRANSPORT = "transport_consumption"
# What the limit covers beside consumption's categories.
NOT_CATEGORIES = {
    "vat",
    "baseline_vat",
    "vat_change",
    "full_rate_vat_consumption",
    "reduced_rate_vat_consumption",
    "full_rate_vat_expenditure_rate",
    "consumption",
}


# --- the registry ----------------------------------------------------------


def test_the_limit_is_registered_with_its_key():
    assert LIMIT.from_year is None
    assert LIMIT.fixed_by == "policyengine-uk #2187"
    assert LIMIT.fixed_by in LIMIT.reason
    assert LIMIT.parameters == ("gov.hmrc.vat", COVERAGE, CPI_INDEX)


def test_the_pinned_consumption_categories_are_the_installed_ones():
    """Adoption tripwire: the categories are pinned for reproducible
    receipts. If the adopted model's ``consumption`` adds others, this fails
    until the pin follows."""
    adds = installed_system.variables["consumption"].adds
    assert sorted(adds) == sorted(set(LIMIT.variables) - NOT_CATEGORIES)
    assert NOT_CATEGORIES <= set(LIMIT.variables)


def test_what_consumption_rises_by_is_covered():
    """Consumption's categories rise by an index in years after the
    data's, so a change to it moves VAT without a VAT parameter or a stored
    input changing: whatever the installed model uprates them by is
    covered."""
    uprating = {
        installed_system.variables[name].uprating for name in LIMIT.variables
    } - {None}
    assert uprating
    for path in uprating:
        assert LIMIT in limits_for_paths([path]), path


@pytest.mark.parametrize(
    "variable",
    [
        "vat",
        "baseline_vat",
        "full_rate_vat_consumption",
        "reduced_rate_vat_consumption",
    ],
)
def test_every_variable_household_vat_is_built_from_is_covered(variable):
    """What each formula names, and what the totals add and subtract, that
    is a variable of the installed model, is covered: a release that builds
    VAT from another variable fails here until the limit covers it."""
    found = installed_system.variables[variable]
    names = set(found.adds or ()) | set(found.subtracts or ())
    for formula in found.formulas.values():
        names |= data_limits._code_names(formula.__code__)
    assert names & set(installed_system.variables) <= set(LIMIT.variables)


@pytest.mark.parametrize(
    "path, covered",
    [
        (STANDARD_RATE, True),
        (REDUCED_RATE, True),
        (REDUCED_RATE_SHARE, True),
        (COVERAGE, True),
        (CPI_INDEX, True),
        (CPI_GROWTH, False),
        (VAT, True),
        (variable_path("baseline_vat"), True),
        (variable_path("vat_change"), True),
        (variable_path("consumption"), True),
        (variable_path(TRANSPORT), True),
        (variable_path("full_rate_vat_expenditure_rate"), True),
        (INCOME_TAX, False),
        (COVERAGE + "_extra", False),
        ("vat", False),
        (variable_path("income_tax"), False),
        (variable_path("domestic_energy_consumption"), False),
        (variable_path(""), False),
    ],
)
def test_the_limit_covers_vat_parameters_and_variables(path, covered):
    assert (LIMIT in limits_for_paths([path])) is covered


# --- the fix -----------------------------------------------------------------


def _without_the_fix(tree):
    """Remove #2187's factors, so a stand-in starts from neither, whichever
    model is installed."""
    node = tree.get_child("gov.simulation")
    if "vat" in node.children:
        del node.children["vat"]
        del node.__dict__["vat"]


def _add_factors(tree, factors):
    node = tree.get_child("gov.simulation")
    node.add_child(
        "vat",
        ParameterNode(
            "gov.simulation.vat",
            data={
                path.rsplit(".", 1)[1]: {"values": {"2010-01-01": value}}
                for path, value in factors.items()
            },
        ),
    )


def stand_in(factors=FACTORS, built=True, changed=True):
    """A model whose parameter trees carry ``factors``: the tree as built
    (the ``baseline`` child the check reads), the tree a measure changes,
    or both. Its formulas are the installed ones: only whether the guard
    sees the fix is tested with it."""
    system = copy.copy(installed_system)
    system.parameters = installed_system.parameters.clone()
    system._parameters_at_instant_cache = {}
    trees = {
        "built": system.parameters.children["baseline"],
        "changed": system.parameters,
    }
    for name, tree in trees.items():
        _without_the_fix(tree)
        if {"built": built, "changed": changed}[name]:
            _add_factors(tree, factors)
    return system


@pytest.mark.parametrize(
    "kwargs, fixed",
    [
        ({}, True),
        ({"factors": {SURVEY_COVERAGE: 0.67}}, False),
        ({"factors": {HOUSEHOLD_SHARE: 0.7}}, False),
        ({"factors": {}}, False),
        ({"built": False}, False),
        ({"changed": False}, True),
    ],
    ids=[
        "both factors",
        "survey coverage only",
        "household share only",
        "neither",
        "only in the tree a measure changes",
        "only in the tree as built",
    ],
)
def test_the_fix_is_both_factors_in_the_tree_as_built(kwargs, fixed):
    assert LIMIT.fixed(stand_in(**kwargs)) is fixed


def test_a_measure_cannot_make_its_own_model_count_as_fixed_or_unfixed():
    """The template replaces ``vat``'s formula on the reform side, and a
    measure can set the old factor to #2187's product: neither changes
    what the check reads, the tree as the model built it."""
    installed = LIMIT.fixed(installed_system)
    for sim in (
        simulation(modifier=quietly(template_measures.vat_modifier)),
        simulation({COVERAGE: {"2026": FIXED_FACTOR}}),
    ):
        assert LIMIT.fixed(sim.tax_benefit_system) is installed
    fixed_with_the_template = simulation(
        modifier=with_the_fix(quietly(template_measures.vat_modifier))
    )
    assert LIMIT.fixed(fixed_with_the_template.tax_benefit_system) is True


def test_an_unreadable_system_counts_as_unfixed():
    assert LIMIT.fixed(object()) is False
    assert LIMIT.fixed(SimpleNamespace(parameters=None)) is False


GROSSED = (
    "    def formula(household, period, parameters):\n"
    "        p = parameters(period).gov\n"
    "        return raw_vat / vat_grossing_factor(p.simulation)\n"
)
UNGROSSED = (
    "    def formula(household, period, parameters):\n"
    "        # vat_grossing_factor(p.simulation), one day\n"
    "        p = parameters(period).gov\n"
    "        return raw_vat / p.simulation.microdata_vat_coverage\n"
)
NAMED_ONLY = (
    "    def formula(household, period, parameters):\n"
    "        name = 'vat_grossing_factor'\n"
    "        return raw_vat / parameters(period).gov.simulation.coverage\n"
)


def installed_sources(monkeypatch, tmp_path, vat, baseline_vat=GROSSED):
    """Point the installed-model check at source files with these bodies
    for ``vat`` and ``baseline_vat``."""
    sources = {
        "vat.py": f"class vat:\n{vat}",
        "baseline_vat.py": f"class baseline_vat:\n{baseline_vat}",
    }
    for name, text in sources.items():
        (tmp_path / name).write_text(text, encoding="utf-8")

    class Root:
        def joinpath(self, path):
            return tmp_path / path.rsplit("/", 1)[1]

    monkeypatch.setattr(model_limits, "files", lambda package: Root())


@pytest.mark.parametrize(
    "vat, baseline_vat, factors, fixed",
    [
        (GROSSED, GROSSED, FACTORS, True),
        (UNGROSSED, GROSSED, FACTORS, False),
        (GROSSED, UNGROSSED, FACTORS, False),
        (NAMED_ONLY, GROSSED, FACTORS, False),
        (
            GROSSED + GROSSED.replace("formula", "formula_2026"),
            GROSSED,
            {},
            False,
        ),
        (
            UNGROSSED + GROSSED.replace("formula", "formula_2026"),
            GROSSED,
            FACTORS,
            False,
        ),
        (
            GROSSED.replace(
                "vat_grossing_factor(", "utils.vat_grossing_factor("
            ),
            GROSSED,
            FACTORS,
            True,
        ),
        ("    label = 'VAT'\n", GROSSED, FACTORS, False),
    ],
    ids=[
        "both formulas and both factors",
        "vat ungrossed",
        "baseline_vat ungrossed",
        "a string naming the helper",
        "no factors in the tree",
        "a later formula only",
        "the helper as an attribute",
        "no formula",
    ],
)
def test_the_installed_check_needs_the_factors_and_both_formulas(
    monkeypatch, tmp_path, vat, baseline_vat, factors, fixed
):
    installed_sources(monkeypatch, tmp_path, vat, baseline_vat)
    monkeypatch.setattr(
        import_module("policyengine_uk.system"),
        "system",
        stand_in(factors=factors),
    )
    assert LIMIT.installed_fixed() is fixed


@pytest.mark.parametrize("problem", ["missing", "unparsable"])
def test_an_unreadable_installed_source_counts_as_unfixed(
    monkeypatch, tmp_path, problem
):
    monkeypatch.setattr(
        import_module("policyengine_uk.system"), "system", stand_in()
    )
    if problem == "missing":
        monkeypatch.setattr(
            model_limits,
            "_VAT_FILES",
            (("vat", "no/such/file.py"), ("baseline_vat", "no/such.py")),
        )
    else:
        installed_sources(monkeypatch, tmp_path, "    def (:\n")
    assert LIMIT.installed_fixed() is False


def test_the_installed_model_still_lacks_the_fix():
    """Adoption tripwire: remove the limit when a pair with #2187 is
    adopted (policyengine-uk 2.145.0 or later)."""
    assert (
        not LIMIT.installed_fixed()
    ), f"{LIMIT.fixed_by} is in the installed model: remove {LIMIT.key}"


def test_the_two_checks_agree_on_the_installed_model():
    assert LIMIT.fixed(installed_system) is LIMIT.installed_fixed()
    assert LIMIT.fixed(simulation().tax_benefit_system) is (
        LIMIT.installed_fixed()
    )


def shopper(year):
    """One household with known consumption, a third of it full-rated."""
    return {
        "people": {"p": {"age": {year: 40}}},
        "benunits": {"b": {"members": ["p"]}},
        "households": {
            "h": {
                "members": ["p"],
                "food_and_non_alcoholic_beverages_consumption": {year: 6000},
                "transport_consumption": {year: 3000},
                "recreation_consumption": {year: 1000},
                "full_rate_vat_expenditure_rate": {year: 1 / 3},
            }
        },
    }


def test_the_checks_agree_with_how_the_model_grosses_vat():
    """Differential: the checks read the tree and the source; this reads
    behaviour. VAT divided by what the household's consumption owes at the
    statutory rates is 1 / 0.469 exactly when the model grosses as #2187
    does, for VAT and for its baseline."""
    year = 2027
    sim = Simulation(situation=shopper(year))
    rates = sim.tax_benefit_system.parameters(f"{year}-01-01").gov.hmrc.vat
    raw = (
        sim.calculate("full_rate_vat_consumption", year)[0]
        * rates.standard_rate
        + sim.calculate("reduced_rate_vat_consumption", year)[0]
        * rates.reduced_rate
    )
    assert raw > 0
    for variable in ("vat", "baseline_vat"):
        ratio = sim.calculate(variable, year)[0] / raw
        as_2187 = math.isclose(ratio, 1 / FIXED_FACTOR, rel_tol=1e-6)
        assert as_2187 is LIMIT.fixed(installed_system), variable
        assert as_2187 is LIMIT.installed_fixed(), variable


# --- what a measure touches -----------------------------------------------


def quietly(modifier):
    """A modifier whose template warning is expected, not under test."""

    def run(sim):
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", ModelLimitedWarning)
            return modifier(sim)

    return run


def install_the_fix(sim):
    """#2187's factors in both trees, as a model with it has them."""
    for tree in (
        sim.tax_benefit_system.parameters,
        sim.tax_benefit_system.parameters.children["baseline"],
    ):
        _without_the_fix(tree)
        _add_factors(tree, FACTORS)


def with_the_fix(modifier=None):
    def run(sim):
        install_the_fix(sim)
        if modifier is not None:
            modifier(sim)

    return run


def deeper_energy_vat_cut(sim):
    """The template with other arguments: the same code, another closure."""
    return template_measures.vat_modifier(sim, rate_change=-0.05)


def buy_transport(sim):
    sim.set_input(TRANSPORT, 2027, [1000.0])


def buy_more_transport(sim):
    sim.set_input(TRANSPORT, 2027, [2000.0])


def full_rate_more(sim):
    sim.set_input("full_rate_vat_expenditure_rate", 2027, [0.9])


def neutralise_vat(sim):
    sim.tax_benefit_system.neutralize_variable("vat")


ENERGY_VAT = quietly(template_measures.vat_modifier)


# (baseline changes, baseline modifier, reform changes, reform modifier),
# and what the limit records.
MEASURES = {
    "a 2027 standard rate rise": (
        (None, None, {STANDARD_RATE: {"2027": 0.21}}, None),
        [STANDARD_RATE],
    ),
    "a 2026 reduced rate cut": (
        (None, None, {REDUCED_RATE: {"2026": 0.0}}, None),
        [REDUCED_RATE],
    ),
    "a wider reduced-rate base": (
        (None, None, {REDUCED_RATE_SHARE: {"2027": 0.2}}, None),
        [REDUCED_RATE_SHARE],
    ),
    "a new grossing factor": (
        (None, None, {COVERAGE: {"2027": FIXED_FACTOR}}, None),
        [COVERAGE],
    ),
    "the energy VAT template": ((None, None, None, ENERGY_VAT), [VAT]),
    "the template with other arguments": (
        (None, ENERGY_VAT, None, quietly(deeper_energy_vat_cut)),
        [VAT],
    ),
    "a consumption input set on one side": (
        (None, None, None, buy_transport),
        [variable_path(TRANSPORT)],
    ),
    "a consumption input set to another value": (
        (None, buy_transport, None, buy_more_transport),
        [variable_path(TRANSPORT)],
    ),
    "a full-rated share set on one side": (
        (None, None, None, full_rate_more),
        [variable_path("full_rate_vat_expenditure_rate")],
    ),
    "vat neutralised": ((None, None, None, neutralise_vat), [VAT]),
    "a standard rate rise on the baseline side": (
        ({STANDARD_RATE: {"2027": 0.21}}, None, None, None),
        [STANDARD_RATE],
    ),
    "the template on the baseline side": (
        (None, ENERGY_VAT, None, None),
        [VAT],
    ),
}


def measure(case, fix=False):
    (base_changes, base_modifier, changes, modifier), _ = MEASURES[case]
    if fix:
        base_modifier, modifier = (
            with_the_fix(base_modifier),
            with_the_fix(modifier),
        )
    return (
        simulation(base_changes, base_modifier),
        simulation(changes, modifier),
    )


@pytest.mark.parametrize("case", list(MEASURES))
def test_a_vat_measure_without_the_fix_records_the_limit(case):
    _, recorded = MEASURES[case]
    assert limits_touched(*measure(case)) == [record(LIMIT, recorded)]


@pytest.mark.parametrize("case", list(MEASURES))
def test_with_the_fix_a_vat_measure_records_nothing(case):
    """The limit expires on its own once the model has the fix, however
    the measure reaches VAT."""
    assert limits_touched(*measure(case, fix=True)) == []


def test_the_fix_on_one_side_only_still_records_it():
    baseline, _ = measure("a 2027 standard rate rise", fix=True)
    _, reformed = measure("a 2027 standard rate rise")
    assert limits_touched(baseline, reformed) == [
        record(LIMIT, [STANDARD_RATE])
    ]


@pytest.mark.parametrize(
    "base_modifier, modifier",
    [
        (ENERGY_VAT, ENERGY_VAT),
        (buy_transport, buy_transport),
        (None, None),
    ],
    ids=["the template on both sides", "the same input", "nothing"],
)
def test_the_same_change_on_both_sides_records_nothing(
    base_modifier, modifier
):
    assert (
        limits_touched(
            simulation(modifier=base_modifier), simulation(modifier=modifier)
        )
        == []
    )


def test_a_cpi_path_records_the_index_consumption_rises_by():
    """A CPI growth path moves projected consumption, and so VAT, through
    the index alone. The September CPI index and the triple lock move
    with it, so other limits record it too."""
    touched = limits_touched(
        simulation(),
        simulation({CPI_GROWTH: {"2026-01-01.2026-12-31": 0.10}}),
    )
    assert record(LIMIT, [CPI_INDEX]) in touched


def test_a_measure_off_vat_records_nothing():
    assert (
        limits_touched(simulation(), simulation({INCOME_TAX: {"2027": 0.21}}))
        == []
    )


def test_calculated_values_are_not_compared_as_inputs():
    """Detection runs after the figures are made, so the holders keep VAT
    as calculated: an income tax measure, with VAT calculated on one side
    only, records nothing, and a VAT measure records only its parameter."""
    baseline = Simulation(situation=shopper(2027))
    reformed = Simulation(
        situation=shopper(2027),
        scenario=Scenario(parameter_changes={INCOME_TAX: {"2027": 0.21}}),
    )
    reformed.calculate("vat", 2027)
    assert limits_touched(baseline, reformed) == []
    raised = Simulation(
        situation=shopper(2027),
        scenario=Scenario(parameter_changes={STANDARD_RATE: {"2027": 0.21}}),
    )
    for sim in (baseline, raised):
        sim.calculate("vat_change", 2027)
    assert limits_touched(baseline, raised) == [record(LIMIT, [STANDARD_RATE])]


def test_a_stand_in_without_holders_compares_variables_by_behaviour():
    """A stand-in carrying a built model but no holders, as generation's
    tests build them: its variables are still compared."""
    templated = simulation(modifier=ENERGY_VAT)
    assert limits_touched(
        SimpleNamespace(tax_benefit_system=simulation().tax_benefit_system),
        SimpleNamespace(tax_benefit_system=templated.tax_benefit_system),
    ) == [record(LIMIT, [VAT])]


def test_the_scenarios_record_it_against_the_installed_model():
    assert limits_for_scenarios(
        None, Scenario(parameter_changes={STANDARD_RATE: {"2027": 0.21}})
    ) == [record(LIMIT, [STANDARD_RATE])]


# --- the templates -----------------------------------------------------------


def test_the_vat_base_template_warns():
    with pytest.warns(ModelLimitedWarning, match=re.escape(LIMIT.fixed_by)):
        simulation(modifier=template_measures.vat_modifier)


def test_the_template_warning_leaves_the_measure_module_bindable():
    """A warning leaves a ``__warningregistry__`` in the module it is
    attributed to, and a receipt refuses a measure module carrying one, so
    the warning is attributed to the template, not the measure's modifier
    (the generation test below found it)."""
    vars(template_measures).pop("__warningregistry__", None)
    with warnings.catch_warnings():
        warnings.simplefilter("default")
        simulation(modifier=template_measures.vat_modifier)
    assert "__warningregistry__" not in vars(template_measures)


def test_a_vat_rate_built_with_the_templates_warns():
    """rate_change warns through the limit's parameters."""
    with pytest.warns(ModelLimitedWarning, match=re.escape(LIMIT.fixed_by)):
        rate_change(STANDARD_RATE, {2027: 0.21})


@pytest.mark.usefixtures("installed_with_the_fix")
def test_the_template_warning_follows_the_installed_model():
    with warnings.catch_warnings():
        warnings.simplefilter("error", ModelLimitedWarning)
        simulation(modifier=template_measures.vat_modifier)
        rate_change(STANDARD_RATE, {2027: 0.21})


# --- the record --------------------------------------------------------------


def test_a_record_of_covered_variables_passes_its_own_check():
    assert record_problems([record(LIMIT, [VAT])]) == []
    assert (
        record_problems(
            [record(LIMIT, [STANDARD_RATE, VAT, variable_path(TRANSPORT)])]
        )
        == []
    )


@pytest.mark.parametrize(
    "limit, path",
    [
        (LIMIT, variable_path("not_covered")),
        (LIMIT, variable_path("income_tax")),
        (BENEFIT_LIMIT, VAT),
    ],
    ids=["unknown", "another variable", "another limit's record"],
)
def test_a_variable_the_limit_does_not_cover_is_refused(limit, path):
    assert record_problems([record(limit, [path])])
    assert limits_for_paths([path]) == ([LIMIT] if path == VAT else [])


# --- generation --------------------------------------------------------------


@pytest.mark.parametrize(
    "fields, held",
    [
        (
            {
                "parameter_changes": {
                    STANDARD_RATE: {"2027": 0.21, "2028": 0.21}
                }
            },
            [STANDARD_RATE],
        ),
        ({"simulation_modifier": template_measures.vat_modifier}, [VAT]),
    ],
    ids=["a rate", "the energy VAT template"],
)
def test_generation_records_the_limit(world, fields, held):  # noqa: F811
    reform = Reform(id="vat", name="VAT", **fields)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", ModelLimitedWarning)
        assert generated(world, reform, built(world)) == [record(LIMIT, held)]


# --- the area view -----------------------------------------------------------


@pytest.fixture(scope="module")
def area_manifest(tmp_path_factory):
    """A real manifest: an approved measure, and a VAT measure held at
    provisional by this limit, as the energy VAT template records it."""
    instance = World()
    try:
        manifest = m.Manifest()
        args = dict(data_root=instance.data_root, inputs=instance.inputs)
        alpha = instance.ready("alpha", VALUES, rate=0.21)
        stage(manifest, alpha.path, **args)
        approve(manifest, "alpha", "Reviewer", **args)
        held = instance.ready(
            "energy_vat",
            VALUES,
            rate=0.22,
            model_limits=[record(LIMIT, [VAT])],
        )
        stage(manifest, held.path, provisional=True, **args)
        path = tmp_path_factory.mktemp("area") / "publication.json"
        path.write_text(manifest.model_dump_json(by_alias=True))
        yield manifest, path
    finally:
        instance.close()


def test_area_runs_leave_the_held_vat_measure_out_by_default(area_manifest):
    manifest, _ = area_manifest
    assert manifest.measures["energy_vat"].status == m.PROVISIONAL
    assert g.approved_reforms(manifest) == ["alpha"]


@pytest.mark.parametrize(
    "arguments",
    [
        ["--reforms", "energy_vat"],
        ["--reforms", "alpha", "--seat-reforms", "energy_vat"],
    ],
    ids=["--reforms", "--seat-reforms"],
)
def test_area_runs_refuse_the_held_vat_measure(area_manifest, arguments):
    """Area results take approved ids only, and a model-limited measure is
    never approved, so the area view holds VAT results too."""
    _, path = area_manifest
    parsed = parse_args(["geography", "--manifest", str(path), *arguments])
    with pytest.raises(ValueError) as raised:
        g._plan(parsed)
    assert "energy_vat: provisional" in str(raised.value)
