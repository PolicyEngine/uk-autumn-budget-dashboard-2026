"""A limit that covers variables as well as parameters: VAT measures were
held until the model grossed VAT up as policyengine-uk #2187 does.

Before #2187 the model divided household VAT on survey consumption by one
factor, ``gov.simulation.microdata_vat_coverage`` (0.38), to reach
receipts; #2187 divides by survey consumption coverage times the household
share of VAT receipts, 0.67 × 0.7 = 0.469. A measure can move VAT through
its parameters, through the VAT base template, which replaces the ``vat``
formula, or through the consumption VAT is charged on, so the limit
covered variables too, the only one that did.

It expired at policyengine-uk 2.151.0 (PR 238). The machinery that compares
covered variables (formulas, what decides how they run, stored and
calculated values) stays for the next such limit, and is tested here on the
limit's stand-in (tests/model_limit_stand_ins.py), whose fix is a marker a
test installs. The tests of its check for the fix, and its pins to the
installed model's VAT build, went with the limit.
"""

import copy
import datetime
import re
import warnings
from types import SimpleNamespace

import numpy
import pytest
from policyengine_core.periods import period as as_period
from policyengine_uk import Simulation
from policyengine_uk.utils.scenario import Scenario

from tests import model_limit_stand_ins, template_measures
from tests.model_limit_stand_ins import with_fix
from tests.publication_support import World
from tests.test_geography import (
    geography_command,
    real_simulations,  # noqa: F401 - a fixture
)
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
from uk_budget_data import geography as g
from uk_budget_data import model_limits
from uk_budget_data.cli import parse_args
from uk_budget_data.data_limits import UnwatchedFormulaWarning
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

pytestmark = pytest.mark.usefixtures("stand_in_model_limits")

LIMIT = limit_by_key("vat_consumption_coverage")
BENEFIT_LIMIT = limit_by_key("benefit_uprating_september_cpi")
STANDARD_RATE = "gov.hmrc.vat.standard_rate"
REDUCED_RATE = "gov.hmrc.vat.reduced_rate"
REDUCED_RATE_SHARE = "gov.hmrc.vat.reduced_rate_share"
COVERAGE = "gov.simulation.microdata_vat_coverage"
# The engine's copy of the tree as built, which baseline_vat reads.
BUILT_STANDARD_RATE = "baseline." + STANDARD_RATE
BUILT_COVERAGE = "baseline." + COVERAGE
CPI_INDEX = "gov.economic_assumptions.indices.obr.consumer_price_index"
CPI_GROWTH = "gov.economic_assumptions.yoy_growth.obr.consumer_price_index"
# The deprecated combined factor's declared value is #2187's product,
# 0.67 × 0.7 = 0.469, from policyengine-uk 2.151.0; a measure that moves it
# away from that is honoured.
OTHER_FACTOR = 0.5
VAT = variable_path("vat")
TRANSPORT = "transport_consumption"
PRIVATE_SCHOOL_VAT_RATE = "gov.contrib.labour.private_school_vat"
PRIVATE_SCHOOL_FEES = "gov.simulation.private_school_vat.private_school_fees"


# --- the registry ----------------------------------------------------------


def test_the_limit_is_registered_with_its_key():
    assert LIMIT.from_year is None
    assert LIMIT.fixed_by == "policyengine-uk #2187"
    assert LIMIT.fixed_by in LIMIT.reason
    assert LIMIT.parameters == (
        "gov.hmrc.vat",
        COVERAGE,
        CPI_INDEX,
        "baseline.gov.hmrc.vat",
        BUILT_COVERAGE,
    )


def test_the_registry_digest_covers_every_field_it_records():
    """A receipt names the registry it was judged against by digest, so a
    change to any field a receipt records or the guard decides by,
    variables included, changes it."""
    digest = model_limits._registry_digest
    assert digest(model_limits.MODEL_LIMITS) == model_limits.REGISTRY_SHA256
    for field, value in [
        ("key", "other"),
        ("parameters", LIMIT.parameters[:-1]),
        ("variables", LIMIT.variables[:-1]),
        ("fixed_by", "another fix"),
        ("reason", LIMIT.reason + " "),
        ("from_year", 2027),
    ]:
        changed = type(LIMIT)(**{**vars(LIMIT), field: value})
        registry = tuple(
            changed if limit is LIMIT else limit
            for limit in model_limits.MODEL_LIMITS
        )
        assert digest(registry) != model_limits.REGISTRY_SHA256, field


@pytest.mark.parametrize(
    "path, covered",
    [
        (STANDARD_RATE, True),
        (REDUCED_RATE, True),
        (REDUCED_RATE_SHARE, True),
        (COVERAGE, True),
        (CPI_INDEX, True),
        (CPI_GROWTH, False),
        (BUILT_STANDARD_RATE, True),
        (BUILT_COVERAGE, True),
        ("baseline." + INCOME_TAX, False),
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
        # Private school VAT reads no grossing factor, and #2187 leaves it
        # unchanged, so it isn't held.
        (PRIVATE_SCHOOL_VAT_RATE, False),
        (PRIVATE_SCHOOL_FEES, False),
        (variable_path("private_school_vat"), False),
        (variable_path(""), False),
    ],
)
def test_the_limit_covers_vat_parameters_and_variables(path, covered):
    assert (LIMIT in limits_for_paths([path])) is covered


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


# --- what a measure touches -----------------------------------------------


def quietly(modifier):
    """A modifier whose template warning is expected, not under test."""

    def run(sim):
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", ModelLimitedWarning)
            return modifier(sim)

    return run


# The stand-in's fix, as a model with #2187 had it.
install_the_fix = with_fix(LIMIT.key)


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


def edit_the_built_tree(sim):
    """A VAT rate rise written into the engine's copy of the tree as built,
    which ``baseline_vat`` reads, not into the tree a measure changes."""
    tree = sim.tax_benefit_system.parameters.children["baseline"]
    tree.get_child(STANDARD_RATE).update(period="year:2027:1", value=0.10)


def uprate_transport_by_rpi(sim):
    variables = sim.tax_benefit_system.variables
    variables[TRANSPORT] = copy.copy(variables[TRANSPORT])
    variables[TRANSPORT].uprating = "gov.economic_assumptions.indices.obr.rpi"


def end_vat(sim):
    variables = sim.tax_benefit_system.variables
    variables["vat"] = copy.copy(variables["vat"])
    variables["vat"].end = datetime.date(2026, 12, 31)


def drop_reduced_rate_consumption(sim):
    del sim.tax_benefit_system.variables["reduced_rate_vat_consumption"]


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
        (None, None, {COVERAGE: {"2027": OTHER_FACTOR}}, None),
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
    "a rate rise in the tree as built": (
        (None, None, None, edit_the_built_tree),
        [BUILT_STANDARD_RATE],
    ),
    "a consumption category uprated by another index": (
        (None, None, None, uprate_transport_by_rpi),
        [variable_path(TRANSPORT)],
    ),
    "vat given an end date": ((None, None, None, end_vat), [VAT]),
    "a covered variable removed on one side": (
        (None, None, None, drop_reduced_rate_consumption),
        [variable_path("reduced_rate_vat_consumption")],
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
    """Either side's model lacking the fix is enough to hold the measure."""
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


def test_a_private_school_vat_measure_records_nothing():
    """Its formula multiplies pupils by fees, the rate and the VAT basis,
    and reads no grossing factor, so #2187 doesn't change it."""
    measure = simulation(
        {
            PRIVATE_SCHOOL_VAT_RATE: {"2027": 0.2},
            PRIVATE_SCHOOL_FEES: {"2027": 16_000},
        }
    )
    assert limits_touched(simulation(), measure) == []


def shopping(changes=None, modifier=None):
    """The household with known consumption, under a measure."""
    scenario = None
    if changes or modifier:
        scenario = Scenario(
            parameter_changes=changes, simulation_modifier=modifier
        )
    return Simulation(situation=shopper(2027), scenario=scenario)


def figures(*sims, years=(2027,)):
    """Make the figures, as generation does before the guard runs."""
    for sim in sims:
        for year in years:
            sim.calculate("vat_change", year)
    return sims


def test_values_one_side_alone_calculated_are_not_compared():
    """Detection runs after the figures are made, so the holders keep VAT
    as calculated: an income tax measure, with VAT calculated on one side
    only, records nothing, and nor does one with VAT calculated on both."""
    baseline = shopping()
    reformed = shopping({INCOME_TAX: {"2027": 0.21}})
    reformed.calculate("vat", 2027)
    assert limits_touched(baseline, reformed) == []
    assert limits_touched(*figures(baseline, reformed)) == []


def cache_consumption(sim):
    sim.get_holder("consumption").put_in_cache(
        numpy.array([30_000.0]), as_period(2027)
    )


def double_projected_transport(sim):
    """Edit in place the array the engine calculated for a projected year,
    which it keeps as its cached value."""
    values = sim.calculate(TRANSPORT, 2028)
    values *= 2


def energy_vat_with_more_spending(sim):
    template_measures.vat_modifier(sim)
    sim.set_input("domestic_energy_consumption", 2027, [2_000.0])


# The grossed bases, and VAT on both sides, all follow consumption.
FOLLOWS_CONSUMPTION = [
    variable_path(name)
    for name in (
        "baseline_vat",
        "consumption",
        "full_rate_vat_consumption",
        "reduced_rate_vat_consumption",
        "vat",
    )
]


@pytest.mark.parametrize(
    "changes, base_modifier, modifier, years, recorded",
    [
        (
            {STANDARD_RATE: {"2027": 0.21}},
            None,
            None,
            (2027,),
            [STANDARD_RATE, VAT, variable_path("vat_change")],
        ),
        (
            {REDUCED_RATE_SHARE: {"2027": 0.2}},
            None,
            None,
            (2027,),
            [
                REDUCED_RATE_SHARE,
                variable_path("baseline_vat"),
                variable_path("reduced_rate_vat_consumption"),
                VAT,
            ],
        ),
        (None, None, cache_consumption, (2027,), FOLLOWS_CONSUMPTION),
        (
            None,
            None,
            double_projected_transport,
            (2027, 2028),
            sorted(FOLLOWS_CONSUMPTION + [variable_path(TRANSPORT)]),
        ),
        (
            None,
            ENERGY_VAT,
            quietly(energy_vat_with_more_spending),
            (2027,),
            [VAT, variable_path("vat_change")],
        ),
    ],
    ids=[
        "a rate rise",
        "a wider reduced-rate base",
        "consumption cached",
        "a calculated category edited in place",
        "the template on both sides, its spending on one",
    ],
)
def test_calculated_values_both_sides_hold_are_compared(
    changes, base_modifier, modifier, years, recorded
):
    """A value the engine calculated, or a modifier cached, is compared
    where both sides hold one: the figures move VAT through it, though no
    input or formula differs."""
    baseline, reformed = figures(
        shopping(modifier=base_modifier),
        shopping(changes, modifier),
        years=years,
    )
    assert limits_touched(baseline, reformed) == [record(LIMIT, recorded)]


def test_with_the_fix_calculated_values_record_nothing():
    baseline, reformed = figures(
        shopping(modifier=with_the_fix()),
        shopping(modifier=with_the_fix(cache_consumption)),
    )
    assert limits_touched(baseline, reformed) == []


class Unreadable:
    """A simulation whose stored values can't be read."""

    def __init__(self, sim):
        self.tax_benefit_system = sim.tax_benefit_system

    def get_holder(self, name):
        raise RuntimeError("no holder")


def test_stored_values_that_cannot_be_read_count_as_different():
    """Fail closed: every covered variable records."""
    assert limits_touched(
        Unreadable(simulation()), Unreadable(simulation())
    ) == [record(LIMIT, map(variable_path, LIMIT.variables))]


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
    (the generation test below found it). Recording the warning still
    leaves the registry, and keeps it from pytest-xdist's main process."""
    vars(template_measures).pop("__warningregistry__", None)
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("default")
        simulation(modifier=template_measures.vat_modifier)
    assert any(item.category is ModelLimitedWarning for item in caught)
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
        # The template's formula is watched by the run, not the build.
        warnings.simplefilter("ignore", UnwatchedFormulaWarning)
        assert generated(world, reform, built(world)) == [record(LIMIT, held)]


# --- the area view -----------------------------------------------------------


@pytest.fixture(scope="module")
def area_manifest(tmp_path_factory):
    """A real manifest: an approved measure, and a VAT measure held at
    provisional by this limit, as the energy VAT template records it.
    Built on the stand-in registry, as each test here runs on it."""
    instance = World()
    with pytest.MonkeyPatch.context() as monkeypatch:
        model_limit_stand_ins.register(monkeypatch)
        yield from _area_manifest(instance, tmp_path_factory)


def _area_manifest(instance, tmp_path_factory):
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


@pytest.mark.parametrize(
    "fields",
    [
        {"parameter_changes": {STANDARD_RATE: {"2027": 0.21}}},
        # Unwrapped: an approved measure has a receipt, and a receipt binds
        # only a modifier that closes over no values, so not quietly's.
        {"simulation_modifier": template_measures.vat_modifier},
    ],
    ids=["a rate", "the energy VAT template"],
)
def test_an_area_run_refuses_a_vat_measure_approved_without_the_limit(
    real_simulations, monkeypatch, tmp_path, capsys, fields  # noqa: F811
):
    """Review of #2187's limit: a VAT measure approved before the limit was
    registered, or on a model with the fix, is still approved in the
    manifest. The area run judges its own simulations, so it writes no
    tables for it."""
    code, printed = geography_command(
        monkeypatch, tmp_path, capsys, [Reform(id="vat", name="VAT", **fields)]
    )
    assert code == 1, printed
    assert "Mis-costed by this model: vat" in printed
    assert LIMIT.reason in printed
    assert not (tmp_path / "out").exists()
