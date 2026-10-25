"""The inputs each certified data cut newly leaves at their defaults, and
the data limits that hold the measures depending on them.

policyengine.py's budget-inputs gate lists, for each cut, the model inputs
its data lack that its predecessor's had. Its decision on the a133 cut
(policyengine-uk 2.147.2, policyengine.py#715) accepted 13 on condition
that the dashboard holds any measure depending on one as a data limit
(dashboard #124). ``NEWLY_MISSING_INPUTS`` records each adopted cut's list
and ``coverage_problems`` requires a limit for every input in it, so an
adoption that brings a cut without its record, or skips a limit, fails
here.
"""

import functools
from unittest import mock

import pytest
from hypothesis import given
from hypothesis import strategies as st
from policyengine_core.variables import Variable
from policyengine_uk import Simulation
from policyengine_uk.system import system
from policyengine_uk.utils.scenario import Scenario

from uk_budget_data import certified_data, data_limits
from uk_budget_data.data_limits import (
    DATA_LIMITS,
    NEWLY_MISSING_INPUTS,
    NO_LONGER_MISSING,
    coverage_problems,
    limits_for_paths,
    limits_touched,
    record,
    record_problems,
)
from uk_budget_data.measure_templates import _call_formula

A133 = "microcosm-uk-2024-25-national-20261023T075039Z-a133f37a"
BY_KEY = {limit.key: limit for limit in DATA_LIMITS}
BY_INPUT = {limit.missing_input: limit for limit in DATA_LIMITS}
RECORDED = sorted(
    {name for names in NEWLY_MISSING_INPUTS.values() for name in names}
)


def installed_build() -> str:
    manifest = certified_data.load_bundle_manifest()
    return manifest["data_releases"]["uk"]["build_id"]


def keys(limits) -> list[str]:
    return [limit.key for limit in limits]


# --- the installed cut --------------------------------------------------


def test_the_installed_cut_is_recorded_and_every_listed_input_is_held():
    """The adoption that brings a new cut copies its newly missing inputs
    here and registers a limit for each; until it does, this fails."""
    assert coverage_problems(installed_build()) == []


def test_the_a133_cut_lists_the_13_inputs_policyengine_py_accepted():
    """policyengine.py#715's decision names 13: eleven new variables in
    policyengine-uk 2.147.2 and two that became inputs there."""
    assert len(NEWLY_MISSING_INPUTS[A133]) == 13
    assert len(set(NEWLY_MISSING_INPUTS[A133])) == 13


@pytest.mark.parametrize("cut", sorted(NEWLY_MISSING_INPUTS))
def test_a_cut_lists_each_input_once(cut):
    names = NEWLY_MISSING_INPUTS[cut]
    assert len(names) == len(set(names))


@pytest.mark.parametrize(
    "name", [name for name in RECORDED if name not in NO_LONGER_MISSING]
)
def test_each_recorded_input_is_an_input_of_the_installed_model(name):
    """A stored input with no formula, so a cut that lacks it leaves every
    record at the default."""
    variable = system.variables[name]
    assert not variable.formulas
    assert not variable.adds and not variable.subtracts


def test_an_input_no_longer_missing_was_listed_and_its_limit_removed():
    """Whether it left the model or the data carry it again (checked with
    the certified data below), it is an input a cut listed, its limit went
    in the same adoption PR, and it says why."""
    records = data_limits.NEWLY_MISSING_INPUTS
    listed = {name for names in records.values() for name in names}
    limited = {limit.missing_input for limit in data_limits.DATA_LIMITS}
    for name, why in data_limits.NO_LONGER_MISSING.items():
        assert name in listed, f"{name} is in no cut's list"
        assert name not in limited, f"{name} still has a limit"
        assert why.strip(), f"{name} says nothing about why"


def test_the_released_check_refuses_an_unlisted_or_still_limited_input():
    """Not vacuous while NO_LONGER_MISSING is empty."""
    for released in ({"never_listed": "why"}, {"pip_dl_points": "why"}):
        with mock.patch.object(data_limits, "NO_LONGER_MISSING", released):
            with pytest.raises(AssertionError):
                test_an_input_no_longer_missing_was_listed_and_its_limit_removed()


@pytest.mark.certified_data
@pytest.mark.parametrize("name", sorted(NO_LONGER_MISSING))
def test_an_input_carried_again_is_set_by_the_certified_data(name):
    from uk_budget_data.pipeline import build_microsimulation

    variable = system.variables.get(name)
    if variable is None or variable.formulas:
        pytest.skip("no longer an input of the installed model")
    sim = build_microsimulation(None)
    assert sim.get_holder(
        name
    ).get_known_periods(), (
        f"{name} is in NO_LONGER_MISSING but the certified data don't set it"
    )


# --- what each new limit says -------------------------------------------

# Each input's default in the installed model, and the words its limit's
# reason uses for it: the reason must state the default (dashboard #124).
DEFAULTS = {
    "pip_dl_points": (-1, "default of -1 (not assessed)"),
    "pip_m_points": (-1, "default of -1 (not assessed)"),
    # Unsupplied, the formula prices from the fare table, not this value.
    "local_bus_uncapped_single_fare": (
        0,
        "default prices a change to the single-fare cap",
    ),
    "salary_sacrifice_returned_to_income": (0, "the model's default is none"),
    "pension_contributions_via_salary_sacrifice_pre_2015": (
        0,
        "default treats all of it as made on or after 9 July 2015",
    ),
    "pension_annual_allowance_taxable_lump_sum_death_benefits": (
        0,
        "the model's default of none",
    ),
    "defined_benefit_pension_share": (
        0,
        "default treats every contribution as money purchase",
    ),
    "non_residential_property_secured_debt": (
        0,
        "the model's default of none",
    ),
    "other_residential_property_secured_debt": (
        0,
        "the model's default of none",
    ),
    "directly_held_shares": (0, "the model's default of none"),
    "unit_and_investment_trusts": (0, "the model's default of none"),
    "early_years_school_start_deferred": (
        False,
        "the model's default assumes none does",
    ),
    "is_full_year_category_a_director": (
        False,
        "the model's default treats no one as one",
    ),
}


def test_every_input_a133_lists_has_its_default_recorded_here():
    assert set(DEFAULTS) == set(NEWLY_MISSING_INPUTS[A133])


@pytest.mark.parametrize("name", sorted(DEFAULTS))
def test_each_limit_states_the_default_the_model_uses(name):
    value, words = DEFAULTS[name]
    assert system.variables[name].default_value == value
    assert words in BY_INPUT[name].reason


# The model formulas that read each new input at policyengine-uk 2.147.2,
# read from the source: the limits' parameters come from what these do with
# it. The watch's own reading of the model (``limit_variables``, which the
# stored-input comparison uses) must find each of them.
READERS = {
    "pip_daily_living_points": ("pip_dl_category",),
    "pip_mobility_points": ("pip_m_category",),
    "bus_uncapped_single_fares": ("person_bus_fare_spending",),
    "salary_sacrifice_returned_to_income": (
        "employment_income",
        "employee_pension_contributions",
    ),
    "pre_2015_salary_sacrifice": (
        "pension_annual_allowance_threshold_income",
    ),
    "annual_allowance_death_benefits": (
        "pension_annual_allowance_threshold_income",
        "pension_annual_allowance_adjusted_income",
    ),
    "defined_benefit_pension_share": (
        "defined_benefit_pension_contributions",
        "pension_contributions_for_annual_allowance",
    ),
    "non_residential_property_secured_debt": (
        "uc_non_residential_property_capital",
    ),
    "other_residential_property_secured_debt": (
        "uc_other_residential_property_capital",
    ),
    # Through a list of names, which compiles to one tuple constant.
    "directly_held_shares": ("share_like_capital",),
    "unit_and_investment_trusts": ("share_like_capital",),
    "early_years_school_start_deferred": (
        "early_years_term_share_before_school",
    ),
    "full_year_category_a_director": (
        "ni_class_1_employee_primary",
        "ni_class_1_employee_additional",
    ),
}


def test_every_new_limit_has_its_readers_listed():
    assert {BY_KEY[key].missing_input for key in READERS} == set(
        NEWLY_MISSING_INPUTS[A133]
    )


@pytest.mark.parametrize("key", sorted(READERS))
def test_the_watch_finds_the_formulas_reading_each_new_input(key):
    found = data_limits.limit_variables(BY_KEY[key])
    assert set(READERS[key]) <= found, set(READERS[key]) - found


def test_a_list_of_names_in_a_formula_counts_as_naming_them():
    """``add(household, period, ["a", "b"])`` keeps its names in one tuple
    constant: before this, ``share_like_capital`` escaped the watch."""

    def formula(household, period, parameters):
        return add(  # noqa: F821 - compiled, never run
            household, period, ["first", ("second", frozenset({"third"}))]
        )

    names = data_limits._code_names(formula.__code__)
    assert {"first", "second", "third", "add"} <= names


# --- which measures each new limit holds --------------------------------

PIP_DL = "gov.dwp.pip.daily_living"
PIP_M = "gov.dwp.pip.mobility"
ANNUAL_ALLOWANCE = "gov.hmrc.income_tax.allowances.annual_allowance"
UC_CAPITAL = "gov.dwp.universal_credit.means_test.capital"
PENSION_LIMITS = [
    "pre_2015_salary_sacrifice",
    "annual_allowance_death_benefits",
    "defined_benefit_pension_share",
]
PROPERTY_DEBT_LIMITS = [
    "non_residential_property_secured_debt",
    "other_residential_property_secured_debt",
]
SHARE_LIMITS = ["directly_held_shares", "unit_and_investment_trusts"]


HELD = [
    (f"{PIP_DL}.points_thresholds.standard", ["pip_daily_living_points"]),
    (f"{PIP_DL}.points_thresholds.enhanced", ["pip_daily_living_points"]),
    (f"{PIP_M}.points_thresholds.standard", ["pip_mobility_points"]),
    # PIP rates don't act through points.
    (f"{PIP_DL}.standard", []),
    (f"{PIP_M}.enhanced", []),
    ("gov.dft.bus.fares.cap", ["bus_uncapped_single_fares"]),
    (
        "gov.dft.bus.uncapped_single_fares.fare",
        ["bus_uncapped_single_fares"],
    ),
    ("gov.dft.bus.default_single_fare_share", ["bus_uncapped_single_fares"]),
    ("gov.dft.bus.ridership_index", []),
    (f"{ANNUAL_ALLOWANCE}.default", PENSION_LIMITS),
    (f"{ANNUAL_ALLOWANCE}.taper", PENSION_LIMITS),
    (
        "gov.simulation.pensions.defined_benefit_input_per_contribution",
        ["defined_benefit_pension_share"],
    ),
    # The salary sacrifice cap changes only NICs earnings.
    ("gov.hmrc.national_insurance.salary_sacrifice_pension_cap", []),
    ("gov.hmrc.income_tax.rates.uk[0].rate", []),
    (f"{UC_CAPITAL}.limit", PROPERTY_DEBT_LIMITS),
    (f"{UC_CAPITAL}.tariff_income.amount", PROPERTY_DEBT_LIMITS),
    (f"{UC_CAPITAL}.sources", [*PROPERTY_DEBT_LIMITS, *SHARE_LIMITS]),
    ("gov.dwp.pension_credit.income.capital.sources", SHARE_LIMITS),
    ("gov.dwp.universal_credit.standard_allowance.amount", []),
    (
        "gov.dfe.universal_childcare_entitlement.hours",
        ["early_years_school_start_deferred"],
    ),
    (
        "gov.scottish_government.funded_early_learning_childcare",
        ["early_years_school_start_deferred"],
    ),
    (
        "gov.hmrc.national_insurance.class_1.directors."
        "full_year_category_a_2022_23.in_effect",
        ["full_year_category_a_director"],
    ),
    ("gov.hmrc.national_insurance.class_1.rates.employee.main", []),
]


@pytest.mark.parametrize("path, held", HELD)
def test_a_change_is_held_by_the_limits_whose_input_it_acts_through(
    path, held
):
    assert keys(limits_for_paths([path])) == [
        key for key in BY_KEY if key in held
    ]


@pytest.mark.parametrize(
    "path, held", [(path, held) for path, held in HELD if len(held) > 1]
)
def test_the_receipt_accepts_each_limit_an_overlapping_path_falls_under(
    path, held
):
    """The annual allowance, Universal Credit capital and the capital
    sources fall under several limits, and each records the path: the
    receipt check took a path to belong to one limit only, so these
    measures could not be staged at all (review of #132)."""
    records = [record(BY_KEY[key], [path]) for key in held]
    assert record_problems(records) == []


@pytest.mark.parametrize(
    "path, value, held",
    [
        (f"{ANNUAL_ALLOWANCE}.default", 50_000, PENSION_LIMITS),
        (f"{UC_CAPITAL}.limit", 20_000, PROPERTY_DEBT_LIMITS),
    ],
)
def test_a_measure_held_by_several_limits_passes_the_receipt_check(
    path, value, held
):
    touched = limits_touched(
        one_adult(),
        one_adult(Scenario(parameter_changes={path: {"2027": value}})),
    )
    assert touched_keys(touched) == [key for key in BY_KEY if key in held]
    assert record_problems(touched) == []


@pytest.mark.parametrize("path", sorted({path for path, _ in HELD}))
def test_every_held_path_exists_in_the_installed_engine(path):
    system.parameters.get_child(path.split("[")[0])


# --- PIP: the case policyengine.py#715 flags ----------------------------


def pip_daily_living(points=None, standard=None) -> str:
    situation = {
        "people": {"p": {"age": {"2027": 40}}},
        "benunits": {"b": {"members": ["p"]}},
        "households": {"h": {"members": ["p"]}},
    }
    if points is not None:
        situation["people"]["p"]["pip_dl_points"] = {"2027": points}
    scenario = None
    if standard is not None:
        scenario = Scenario(
            parameter_changes={
                f"{PIP_DL}.points_thresholds.standard": {"2027": standard}
            }
        )
    sim = Simulation(situation=situation, scenario=scenario)
    return str(sim.calculate("pip_dl_category", 2027)[0])


def test_points_decide_the_category_only_when_supplied():
    """The thresholds act through the points: with the default (not
    assessed) a thresholds change moves no one, which is why the limit
    holds it rather than letting it cost £0."""
    assert pip_daily_living() == pip_daily_living(standard=11) == "NONE"
    assert pip_daily_living(points=9) == "STANDARD"
    assert pip_daily_living(points=9, standard=11) == "NONE"


# --- the build: the model's own construction reads three -----------------

CONSTRUCTION_READS = {
    "directly_held_shares",
    "salary_sacrifice_returned_to_income",
    "unit_and_investment_trusts",
}


def one_adult(scenario=None):
    return Simulation(
        situation={
            "people": {"p": {"age": {"2027": 40}}},
            "benunits": {"b": {"members": ["p"]}},
            "households": {"h": {"members": ["p"]}},
        },
        scenario=scenario,
    )


def build_reads(scenario=None) -> frozenset:
    sim = data_limits.watched_build(one_adult, scenario)
    return data_limits._build_reads(sim)


def test_the_constructor_left_out_is_policyengine_uks_simulation():
    assert Simulation.__init__.__code__ in data_limits._model_constructors()


def test_the_models_own_construction_reads_three_of_the_inputs():
    """Not vacuous: policyengine-uk 2.147.2 builds every simulation through
    the Universal Credit rebalancing, which calculates the capital tests
    and earnings, so counting the constructor's own reads would hold every
    measure (all 9 on main, before this was fixed). It fetches the holders
    of more of them besides (converting a situation to a dataset fetches
    every input's)."""
    with mock.patch.object(data_limits, "_model_constructors", frozenset):
        assert CONSTRUCTION_READS < build_reads()


def test_building_a_household_counts_none_of_the_models_own_reads():
    assert build_reads() == frozenset()
    reform = Scenario(
        parameter_changes={
            "gov.dwp.universal_credit.means_test.capital.limit": {
                "2027": 20_000
            }
        }
    )
    assert build_reads(reform) == frozenset()


def test_a_modifier_reading_a_new_input_while_built_is_counted():
    """Round 17's case with one of the new inputs: the modifier's own frame
    is a measure's code, so the read counts though the constructor called
    it."""

    def modifier(sim):
        sim.calculate("directly_held_shares", 2027)
        return sim

    assert build_reads(Scenario(simulation_modifier=modifier)) == {
        "directly_held_shares"
    }


def bus_rider(scenario=None):
    return Simulation(
        situation={
            "people": {
                "p": {
                    "age": {"2027": 40},
                    "other_local_bus_trips": {"2027": 200},
                }
            },
            "benunits": {"b": {"members": ["p"]}},
            "households": {
                "h": {"members": ["p"], "region": {"2027": "NORTH_EAST"}}
            },
        },
        scenario=scenario,
    )


@pytest.mark.parametrize(
    "variable, build, read",
    [
        ("pip_dl_category", one_adult, "pip_dl_points"),
        ("pip_m_category", one_adult, "pip_m_points"),
        (
            "person_bus_fare_spending",
            bus_rider,
            "local_bus_uncapped_single_fare",
        ),
    ],
)
def test_a_modifier_reading_through_the_supplied_input_helpers_is_counted(
    variable, build, read
):
    """policyengine-uk reads these three only through ``supplied_input`` and
    ``supplied_input_periods``, which fetch the holder and skip
    ``Holder.get_array``; with nothing supplied they read nothing more. So
    a modifier pricing from the default at build counted nothing (review of
    #132)."""

    def modifier(sim):
        sim.calculate(variable, 2027)
        return sim

    sim = data_limits.watched_build(
        build, Scenario(simulation_modifier=modifier)
    )
    assert read in data_limits._build_reads(sim)


def test_the_models_construction_still_counts_none_of_its_own_fetches():
    """Counting fetched holders too adds none of the construction's own."""
    assert build_reads() == frozenset()
    assert data_limits._build_reads(data_limits.watched_build(bus_rider)) == (
        frozenset()
    )


SHARES_MODIFIER = """
def modify(sim):
    sim.calculate("directly_held_shares", 2027)
    return sim
"""


def modifier_from(filename):
    namespace = {}
    exec(compile(SHARES_MODIFIER, filename, "exec"), namespace)
    return namespace["modify"]


@pytest.mark.parametrize(
    "filename",
    [
        "/x/src/uk_budget_data/budget_measures/a_measure.py",
        "/x/site-packages/policyengine_uk/scenarios/a_scenario.py",
    ],
)
def test_the_scenarios_modifier_counts_wherever_its_code_is(filename):
    """The modifier the constructor calls is the measure's, even when
    policyengine-uk ships it (a built-in scenario): told by the call, not
    by its file (review of #132). One applied before the data load can't
    read a value yet; a formula it replaces is the case below."""
    scenario = Scenario(simulation_modifier=modifier_from(filename))
    assert "directly_held_shares" in build_reads(scenario)


NESTED_MODIFIER = """
def modify(sim):
    Simulation(situation=SITUATION)
    return sim
"""


def test_a_shipped_modifier_building_another_simulation_counts_none():
    """What the construction of a simulation the modifier builds reads is
    still the model's own, as it would be from a measure's file."""
    namespace = {
        "Simulation": Simulation,
        "SITUATION": {
            "people": {"p": {"age": {"2027": 40}}},
            "benunits": {"b": {"members": ["p"]}},
            "households": {"h": {"members": ["p"]}},
        },
    }
    exec(
        compile(
            NESTED_MODIFIER,
            "/x/site-packages/policyengine_uk/scenarios/nested.py",
            "exec",
        ),
        namespace,
    )
    scenario = Scenario(simulation_modifier=namespace["modify"])
    assert build_reads(scenario) == frozenset()


def test_a_partial_or_callable_object_as_modifier_counts_too():
    shipped = modifier_from("/x/site-packages/policyengine_uk/s.py")

    def shipped_code(function):
        function.__code__ = function.__code__.replace(
            co_filename="/x/site-packages/policyengine_uk/p.py"
        )
        return function

    class Modifier:
        @shipped_code
        def __call__(self, sim):
            return shipped(sim)

    @shipped_code
    def with_year(sim, year):
        sim.calculate("directly_held_shares", year)
        return sim

    for modifier in (functools.partial(with_year, year=2027), Modifier()):
        scenario = Scenario(simulation_modifier=modifier)
        assert "directly_held_shares" in build_reads(scenario)


OTHER_SIMULATION_MODIFIER = """
def modify(sim):
    OTHER.calculate("directly_held_shares", 2027)
    return sim
"""


def test_a_shipped_modifier_applied_before_the_data_counts_too():
    """The modifier of the part applied before the data load is the
    scenario's as much as the one after it. It can't read its own
    simulation's values yet, but what it reads elsewhere, here from a
    simulation built outside the watch, counts (review of 82866f3d)."""
    namespace = {"OTHER": one_adult()}
    exec(
        compile(
            OTHER_SIMULATION_MODIFIER,
            "/x/site-packages/policyengine_uk/scenarios/before.py",
            "exec",
        ),
        namespace,
    )
    scenario = Scenario(
        simulation_modifier=namespace["modify"],
        applied_before_data_load=True,
    )
    assert "directly_held_shares" in build_reads(scenario)


def test_a_formula_replaced_before_the_data_counts_when_the_build_runs_it():
    """A modifier applied before the data load replaces share-like capital;
    the rebalancing then runs it, and the native formula it wraps reads the
    holdings. A measure's code lies between the reads and the constructor,
    so they count."""

    def modifier(sim):
        system = sim.tax_benefit_system
        native = system.get_variable("share_like_capital")

        def formula(household, period, parameters):
            return _call_formula(native, household, period, parameters)

        fields = ("value_type", "entity", "definition_period", "label")
        attributes = {name: getattr(native, name) for name in fields}
        attributes["formula"] = formula
        system.replace_variable(
            type("share_like_capital", (Variable,), attributes)
        )
        return sim

    scenario = Scenario(
        simulation_modifier=modifier, applied_before_data_load=True
    )
    assert build_reads(scenario) == {
        "directly_held_shares",
        "unit_and_investment_trusts",
    }


# --- a parameter in force from year 0 -------------------------------------

DIRECTOR = (
    "gov.hmrc.national_insurance.class_1.directors."
    "full_year_category_a_2022_23"
)


def touched_keys(touched) -> list[str]:
    return [entry["key"] for entry in touched]


def test_policyengine_uk_starts_the_director_limit_at_year_0():
    """Why the comparison clamps: core can't read a parameter at year 0."""
    leaf = system.parameters.get_child(f"{DIRECTOR}.in_effect")
    assert leaf.values_list[-1].instant_str == "0000-01-01"


def test_a_change_to_a_parameter_from_year_0_is_held_and_others_compare():
    """Before the clamp, comparing any measure's parameters raised (year 0
    is out of range) on reaching the director limit's."""
    in_effect = {f"{DIRECTOR}.in_effect": {"2027": True}}
    assert touched_keys(limits_touched(one_adult(), one_adult())) == []
    unrelated = Scenario(
        parameter_changes={"gov.hmrc.income_tax.rates.uk[0].rate": 0.21}
    )
    assert (
        touched_keys(limits_touched(one_adult(), one_adult(unrelated))) == []
    )
    held = limits_touched(
        one_adult(), one_adult(Scenario(parameter_changes=in_effect))
    )
    assert touched_keys(held) == ["full_year_category_a_director"]


# --- the coverage check itself ------------------------------------------


@pytest.fixture
def registry():
    """Patch the record and limits for one test."""

    def patch(records, limited=(), released=None, against=None):
        limits = tuple(
            data_limits.DataLimit(f"k_{name}", (), name, "r")
            for name in limited
        )
        return mock.patch.multiple(
            data_limits,
            NEWLY_MISSING_INPUTS=records,
            DATA_LIMITS=limits,
            NO_LONGER_MISSING=released or {},
            RECORD_ROOT="root",
            LISTED_AGAINST=(
                {cut: "root" for cut in records}
                if against is None
                else against
            ),
        )

    return patch


def test_an_unrecorded_installed_cut_fails(registry):
    with registry({"old": ()}):
        [problem] = coverage_problems("new")
    assert "the installed data cut new has no record" in problem
    assert "budget-inputs.json" in problem


def test_an_input_without_a_limit_fails_naming_it_and_its_cut(registry):
    with registry({"cut": ("a", "b")}, limited=["a"]):
        [problem] = coverage_problems("cut")
    assert problem.startswith("b, which cut newly leaves at its default")


def test_an_input_a_skipped_cut_listed_still_needs_its_limit(registry):
    """The dashboard can skip a cut: its successor's list is against it,
    so the skipped cut's inputs are not listed again."""
    with registry({"skipped": ("a",), "installed": ()}):
        [problem] = coverage_problems("installed")
    assert problem.startswith("a, which skipped newly leaves")


def test_the_root_needs_no_record(registry):
    with registry({}):
        assert coverage_problems("root") == []


def test_a_chain_of_recorded_cuts_to_the_root_passes(registry):
    with registry(
        {"new": (), "mid": ()}, against={"new": "mid", "mid": "root"}
    ):
        assert coverage_problems("new") == []


def test_a_cut_listed_against_one_never_recorded_fails(registry):
    """The cut in between was certified and never adopted: what it newly
    left at the defaults is in neither list (review of #132)."""
    with registry({"new": ()}, against={"new": "between"}):
        [problem] = coverage_problems("new")
    assert problem.startswith("new lists the inputs it newly leaves")
    assert "against between, which has no record" in problem


def test_a_record_naming_no_predecessor_fails(registry):
    with registry({"new": ()}, against={}):
        [problem] = coverage_problems("new")
    assert problem.startswith("new has no LISTED_AGAINST entry")


def test_a_chain_that_loops_fails(registry):
    with registry({"a": (), "b": ()}, against={"a": "b", "b": "a"}):
        [problem] = coverage_problems("a")
    assert "loop" in problem


def test_the_record_links_each_cut_back_to_the_root():
    assert set(data_limits.LISTED_AGAINST) == set(NEWLY_MISSING_INPUTS)
    for cut in NEWLY_MISSING_INPUTS:
        assert data_limits._chain_problems(cut) == []
    assert data_limits.LISTED_AGAINST[A133] == data_limits.RECORD_ROOT


def test_an_input_no_longer_missing_needs_no_limit(registry):
    with registry({"cut": ("a",)}, released={"a": "carried by cut2"}):
        assert coverage_problems("cut") == []


def test_dropping_any_new_limit_fails_naming_its_input():
    for limit in DATA_LIMITS:
        if limit.missing_input not in NEWLY_MISSING_INPUTS[A133]:
            continue
        rest = tuple(other for other in DATA_LIMITS if other is not limit)
        with mock.patch.object(data_limits, "DATA_LIMITS", rest):
            problems = coverage_problems(A133)
        assert [p.split(",")[0] for p in problems] == [limit.missing_input]


names = st.sampled_from("abcdef")


@given(
    records=st.dictionaries(
        st.sampled_from(["x", "y", "z"]),
        st.lists(names, unique=True).map(tuple),
    ),
    limited=st.sets(names),
    released=st.sets(names),
    installed=st.sampled_from(["x", "y", "z"]),
)
def test_problems_are_exactly_the_unheld_inputs_and_a_missing_record(
    records, limited, released, installed
):
    limits = tuple(
        data_limits.DataLimit(f"k_{n}", (), n, "r") for n in sorted(limited)
    )
    with mock.patch.multiple(
        data_limits,
        NEWLY_MISSING_INPUTS=records,
        DATA_LIMITS=limits,
        NO_LONGER_MISSING={n: "why" for n in released},
        RECORD_ROOT="root",
        LISTED_AGAINST={cut: "root" for cut in records},
    ):
        problems = coverage_problems(installed)
    unheld = {
        (cut, name)
        for cut, listed in records.items()
        for name in listed
        if name not in limited | released
    }
    assert len(problems) == len(unheld) + (installed not in records)
    for cut, name in unheld:
        assert any(p.startswith(f"{name}, which {cut} ") for p in problems)
