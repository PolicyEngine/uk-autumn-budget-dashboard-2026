"""Each measure's public copy names only the taxes the measure moves.

A measure's name and description are public: the personal impact API
returns them. Each registered measure declares here the taxes whose rules
it changes, and its copy may name only those, so a new measure must
declare its taxes too. Copy that names a tax this module doesn't know
fails until the tax is added. An unnamed "tax" or "taxed" reads as income
tax, an unnamed "duty" as a duty and an unnamed "levy" as a levy, so each
fails in the copy of a measure that declares none. The salary sacrifice
cap's description said that contributions above the cap were charged
income tax, though the cap is a National Insurance measure (coordinator,
23 October, from the UK hub).

Second-round and modelling effects don't count as moving a tax. The cap's
broad-base haircut lowers every worker's employment income, and so their
income tax, a little. In the model the excess above the cap also raises
some people's income tax. It raises their adjusted net income, and so the
High Income Child Benefit Charge, from £60,000, and the personal allowance
taper, from £100,000. And the model relieves it only up to the person's
annual allowance, and charges more annual allowance charge where the
higher income tapers that allowance further below their pension savings,
or raises the marginal rate the charge is levied at (see
``create_salary_sacrifice_cap_reform``). The cap changes no income
tax rule, and the OBR describes it as raising NICs, so it declares
National Insurance alone.
"""

import re

from policyengine_uk.system import system as installed_system

from uk_budget_data.reforms import (
    AUTUMN_BUDGET_2026_COMBINED_COMPONENTS,
    AUTUMN_BUDGET_2026_COMBINED_ID,
    get_reform,
    list_reform_ids,
)

TAX = r"tax(?:es)?"
DUTY = r"dut(?:y|ies)"
LEVY = r"lev(?:y|ies)"

# How copy names each tax, with plurals and hyphens. Dividend, savings and
# property income rates are rates of income tax, and the model keeps them
# under gov.hmrc.income_tax.rates, so "dividend tax" names income tax; so
# does the High Income Child Benefit Charge, an income tax charge, and so
# does "tax relief" alone (TAX_RELIEF, below). "NI" is National Insurance:
# copy writes Northern Ireland in full.
TAX_NAMES = {
    "income tax": (
        rf"(?i:\bincome[- ]{TAX}\b)",
        rf"(?i:\b(?:dividends?|savings)[- ]{TAX}\b)",
        rf"(?i:\b{TAX} on (?:(?:dividend|savings|property) income|"
        rf"dividends|savings|income|earnings)\b)",
        r"(?i:\bhigh income child benefit charge\b)",
        r"\bHICBC\b",
    ),
    "National Insurance": (
        r"(?i:\bnational[- ]insurance\b)",
        r"\bNICs?\b",
        r"\bNI\b",
        r"(?i:\bclass [1-4]a? contributions\b)",
    ),
    "VAT": (r"\bVAT(?:able)?\b", rf"(?i:\bvalue[- ]added[- ]{TAX}\b)"),
    "fuel duty": (rf"(?i:\bfuel[- ]{DUTY}\b)", rf"(?i:\b{DUTY} on fuel\b)"),
    "capital gains tax": (
        rf"(?i:\bcapital[- ]gains[- ]{TAX}\b)",
        r"\bCGT\b",
    ),
    "stamp duty": (
        rf"(?i:\bstamp[- ]{DUTY}(?:[- ]land[- ]{TAX})?\b)",
        r"\bSDLT\b",
    ),
    "land and buildings transaction tax": (
        rf"(?i:\bland and buildings transaction {TAX}\b)",
        r"\bLBTT\b",
    ),
    "land transaction tax": (rf"(?i:\bland transaction {TAX}\b)",),
    "council tax": (rf"(?i:\bcouncil[- ]{TAX}\b)",),
    "domestic rates": (r"(?i:\bdomestic rates\b)",),
    "alcohol duty": (rf"(?i:\balcohol[- ]{DUTY}\b)",),
    "tobacco duty": (rf"(?i:\btobacco[- ]{DUTY}\b)",),
    "vehicle excise duty": (
        rf"(?i:\bvehicle excise {DUTY}\b)",
        r"\be?VED\b",
    ),
    "air passenger duty": (rf"(?i:\bair passenger {DUTY}\b)", r"\bAPD\b"),
    "gambling duties": (
        rf"(?i:\b(?:remote gaming|general betting|pool betting|"
        rf"machine games|gaming|bingo|lottery|gambling)[- ]{DUTY}\b)",
    ),
    "business rates": (r"(?i:\bbusiness rates\b)",),
    "corporation tax": (
        rf"(?i:\bcorporation[- ]{TAX}\b)",
        rf"(?i:\b(?:R&D|research and development)[- ]{TAX}[- ]reliefs?\b)",
    ),
    "inheritance tax": (rf"(?i:\binheritance[- ]{TAX}\b)", r"\bIHT\b"),
    "carbon tax": (rf"(?i:\bcarbon[- ]{TAX}\b)",),
    "land value tax": (rf"(?i:\bland[- ]value[- ]{TAX}\b)", r"\bLVT\b"),
    "wealth tax": (rf"(?i:\bwealth[- ]{TAX}\b)",),
}
# "Tax relief" alone is relief from income tax ("pension tax relief"). Where
# its "tax" ends another tax's name ("inheritance tax relief"), it is relief
# from that tax.
TAX_RELIEF = rf"(?i:\b{TAX}[- ]reliefs?\b)"
# A word for a tax. Each in copy must lie in a name above or below, or be
# generic: first in the name or the description, or after one of GENERIC.
TAX_WORD = rf"(?i:\b(?:{TAX}|{DUTY}|{LEVY})\b)"
# Names that hold a word for a tax but name none: Tax Credits are a
# benefit, Tax-Free Childcare a scheme, and a tax year a period.
NOT_TAXES = (
    r"(?i:\b(?:working |child )?tax credits?\b)",
    r"(?i:\btax[- ]free\b)",
    r"(?i:\btax[- ]years?\b)",
)
GENERIC = {
    *("a", "an", "the", "and", "or", "of", "on", "in", "to", "for"),
    *("from", "by", "with", "no", "any", "all", "more", "less", "its"),
    *("their", "other", "new", "extra", "higher", "lower", "pre", "post"),
    "after",
}
# Unnamed, these words in UK copy read as a tax: "tax", "taxed" and
# "taxable" as income tax ("subject to tax", "taxed as employment income",
# "taxable pay"), "duty" as one of the duties, and "levy" as a levy. So the
# copy of a measure that declares no such tax may use them only inside a
# name above. Each word is paired with the names of the taxes it reads as.
BARE_WORDS = (
    (r"(?i:\btax(?:es|ed|able|ation)?\b)", r"^income tax$"),
    (rf"(?i:\b{DUTY}\b)", rf"\b{DUTY}$"),
    (rf"(?i:\b{LEVY}\b)", rf"\b{LEVY}$"),
)

# The parameters whose change moves each tax. Modelling assumptions, such
# as gov.simulation's, move none.
TAX_PARAMETERS = {
    "gov.hmrc.income_tax": ("income tax",),
    # Pension tax relief.
    "gov.hmrc.pensions": ("income tax",),
    "gov.contrib.conservatives": ("income tax",),
    "gov.contrib.cps.marriage_tax_reforms": ("income tax",),
    "gov.hmrc.national_insurance": ("National Insurance",),
    "gov.contrib.policyengine.employer_ni": ("National Insurance",),
    "gov.hmrc.vat": ("VAT",),
    "gov.contrib.labour.private_school_vat": ("VAT",),
    "gov.hmrc.fuel_duty": ("fuel duty",),
    "gov.hmrc.cgt": ("capital gains tax",),
    "gov.hmrc.stamp_duty": ("stamp duty",),
    "gov.revenue_scotland.lbtt": ("land and buildings transaction tax",),
    "gov.wra.land_transaction_tax": ("land transaction tax",),
    "gov.hmrc.council_tax": ("council tax",),
    "gov.contrib.abolish_council_tax": ("council tax",),
    "gov.local_authorities.domestic_rates": ("domestic rates",),
    "gov.hmrc.alcohol_duty": ("alcohol duty",),
    "gov.hmrc.tobacco_duty": ("tobacco duty",),
    "gov.dft.vehicle_excise_duty": ("vehicle excise duty",),
    "gov.hmrc.business_rates": ("business rates",),
    "gov.contrib.ubi_center.carbon_tax": ("carbon tax",),
    "gov.contrib.ubi_center.land_value_tax": ("land value tax",),
    "gov.contrib.ubi_center.wealth_tax": ("wealth tax",),
}

# The taxes each registered measure moves, read from its code.
DECLARED = {
    # Universal Credit and Child Tax Credit are benefits.
    "two_child_limit": set(),
    "fuel_duty_freeze": {"fuel duty"},
    # Rail subsidy spending.
    "rail_fares_freeze": set(),
    "threshold_freeze_extension": {"income tax"},
    # Its baseline modifier sets the dividend rates, under
    # gov.hmrc.income_tax, which no parameter change shows.
    "dividend_tax_increase_2pp": {"income tax"},
    "savings_tax_increase_2pp": {"income tax"},
    "property_tax_increase_2pp": {"income tax"},
    # Student loan repayments are not a tax.
    "freeze_student_loan_thresholds": set(),
    # The excess above the cap is treated as earnings for National
    # Insurance. In the model it also raises some people's income tax:
    # through the High Income Child Benefit Charge and the personal
    # allowance taper, and through the annual allowance, which limits its
    # relief and whose charge rises where the allowance tapers further or
    # the rate it is levied at rises (see the module docstring). But the
    # cap changes no income tax rule.
    "salary_sacrifice_cap": {"National Insurance"},
}
# The combined measure moves what its members move.
DECLARED[AUTUMN_BUDGET_2026_COMBINED_ID] = set().union(
    *(DECLARED[member] for member in AUTUMN_BUDGET_2026_COMBINED_COMPONENTS)
)


def names_in(text: str) -> list:
    """Each tax the text names by one of TAX_NAMES, with where."""
    return [
        (tax, match.span())
        for tax, patterns in TAX_NAMES.items()
        for pattern in patterns
        for match in re.finditer(pattern, text)
    ]


def taxes_named(text: str) -> set:
    names = names_in(text)
    named = {tax for tax, _ in names}
    for relief in re.finditer(TAX_RELIEF, text):
        if not any(a <= relief.start() < b for _, (a, b) in names):
            named.add("income tax")
    return named


def known_spans(text: str) -> list:
    """Where the text names a tax, or holds a name that names none."""
    return [span for _, span in names_in(text)] + [
        match.span()
        for pattern in (*NOT_TAXES, TAX_RELIEF)
        for match in re.finditer(pattern, text)
    ]


def unknown_taxes(text: str) -> list:
    """Each word for a tax that lies in no name this module knows and isn't
    generic, with the word before it: a tax to add to TAX_NAMES."""
    known = known_spans(text)
    unknown = []
    for word in re.finditer(TAX_WORD, text):
        if any(a <= word.start() and word.end() <= b for a, b in known):
            continue
        before = re.search(r"(\w+)[\s-]*$", text[: word.start()])
        if before and before.group(1).lower() not in GENERIC:
            unknown.append(f"{before.group(1)} {word.group(0)}")
    return unknown


def bare_words(text: str, declared=frozenset()) -> list:
    """Each "tax", "taxed", "duty", "levy" and the like that lies in no
    name, unless a declared tax covers it, in order."""
    known = known_spans(text)
    return [
        word.group(0)
        for pattern, reads_as in BARE_WORDS
        if not any(re.search(reads_as, tax) for tax in declared)
        for word in re.finditer(pattern, text)
        if not any(a <= word.start() and word.end() <= b for a, b in known)
    ]


def taxes_changed(parameter_changes) -> set:
    """The taxes a measure's parameter changes move, on either side."""
    taxes = set()
    for path in parameter_changes or {}:
        path = path.removeprefix("baseline.")
        for prefix, moved in TAX_PARAMETERS.items():
            if path == prefix or path.startswith(f"{prefix}."):
                taxes.update(moved)
    return taxes


def test_every_registered_measure_declares_its_taxes():
    registered = set(list_reform_ids())
    assert set(DECLARED) == registered, (
        "declare each registered measure's taxes in DECLARED in "
        "tests/test_measure_descriptions.py: missing "
        f"{sorted(registered - set(DECLARED))}, not registered "
        f"{sorted(set(DECLARED) - registered)}"
    )


def test_every_tax_has_a_name_to_read():
    declared = set().union(*DECLARED.values())
    parameters = {tax for taxes in TAX_PARAMETERS.values() for tax in taxes}
    assert declared | parameters <= set(TAX_NAMES)


def test_every_tax_parameter_is_in_the_installed_model():
    for prefix in TAX_PARAMETERS:
        installed_system.parameters.get_child(prefix)


def copy_of(measure_id) -> tuple:
    """The measure's name and description, read apart: each starts a
    sentence of its own."""
    measure = get_reform(measure_id)
    return (measure.name, measure.description)


def test_each_measure_names_only_the_taxes_it_moves():
    wrong = {}
    for measure_id, declared in DECLARED.items():
        named = set().union(*map(taxes_named, copy_of(measure_id)))
        if named - declared:
            wrong[measure_id] = sorted(named - declared)
    assert not wrong, f"copy names taxes these measures don't move: {wrong}"


def test_no_copy_names_a_tax_this_module_does_not_know():
    unknown = {
        measure_id: [
            tax for text in copy_of(measure_id) for tax in unknown_taxes(text)
        ]
        for measure_id in DECLARED
    }
    unknown = {key: value for key, value in unknown.items() if value}
    assert not unknown, f"add these taxes to TAX_NAMES: {unknown}"


def test_no_copy_says_tax_duty_or_levy_unnamed_unless_it_declares_one():
    bare = {
        measure_id: [
            word
            for text in copy_of(measure_id)
            for word in bare_words(text, declared)
        ]
        for measure_id, declared in DECLARED.items()
    }
    bare = {key: value for key, value in bare.items() if value}
    assert not bare, f"name the tax, or declare it: {bare}"


def test_parameter_changes_agree_with_the_declarations():
    """Cross-check: a parameter change under a tax's parameters moves that
    tax, so the measure must declare it."""
    undeclared = {}
    for measure_id, declared in DECLARED.items():
        measure = get_reform(measure_id)
        changed = taxes_changed(measure.parameter_changes) | taxes_changed(
            measure.baseline_parameter_changes
        )
        if changed - declared:
            undeclared[measure_id] = sorted(changed - declared)
    assert not undeclared, f"changed but not declared: {undeclared}"


def test_the_salary_sacrifice_copy_reads_its_figures_from_the_model():
    measure = get_reform("salary_sacrifice_cap")
    parameters = installed_system.parameters.gov
    cap = parameters.hmrc.national_insurance.salary_sacrifice_pension_cap
    haircut = (
        parameters.contrib.behavioral_responses
    ).salary_sacrifice_broad_base_haircut_rate
    assert f"£{cap('2029-04-06'):,.0f} per year" in measure.description
    assert f"({haircut('2029-04-06'):.2%})" in measure.description
    assert (
        "The excess above the cap is treated as earnings for National "
        "Insurance, so it attracts employee and employer National "
        "Insurance."
    ) in measure.description


def test_the_old_salary_sacrifice_copy_fails():
    old = (
        "Contributions above the cap become employment income subject to "
        "income tax and NICs."
    )
    assert taxes_named(old) - DECLARED["salary_sacrifice_cap"] == {
        "income tax"
    }
    # And without "income", it says tax unnamed.
    old = old.replace("income tax", "tax")
    assert bare_words(old, DECLARED["salary_sacrifice_cap"]) == ["tax"]


def test_the_threshold_freeze_copy_states_the_frozen_thresholds():
    """The higher rate threshold is the personal allowance plus the basic
    rate band, not the band alone, in each year of the freeze."""
    income_tax = installed_system.parameters.gov.hmrc.income_tax
    description = get_reform("threshold_freeze_extension").description
    for year in (2028, 2029, 2030):
        instant = f"{year}-04-06"
        allowance = income_tax.allowances.personal_allowance.amount(instant)
        band = income_tax.rates.uk.brackets[1].threshold(instant)
        assert (
            f"Personal allowance remains at £{allowance:,.0f}" in description
        ), year
        assert (
            f"higher rate threshold at £{allowance + band:,.0f}" in description
        ), year


def test_the_names_are_read_as_copy_uses_them():
    cases = {
        "Increases dividend tax rates by 2 percentage points": {"income tax"},
        "Increases savings income tax rates": {"income tax"},
        "subject to income taxes and NICs": {
            "income tax",
            "National Insurance",
        },
        "income-tax relief and a tax on dividends": {"income tax"},
        "tax on dividend income and taxes on income": {"income tax"},
        "the tax on earnings above the cap": {"income tax"},
        "Limits pension tax relief": {"income tax"},
        "gets tax relief": {"income tax"},
        "inheritance tax relief on pensions": {"inheritance tax"},
        "capital gains tax relief": {"capital gains tax"},
        "R&D tax relief": {"corporation tax"},
        "the High Income Child Benefit Charge": {"income tax"},
        "where employers spread increased NI costs": {"National Insurance"},
        "attract employee and employer National Insurance": {
            "National Insurance"
        },
        "Extends the 5p fuel duty cut": {"fuel duty"},
        "fuel duties and see /fuel-duty-freeze-2025": {"fuel duty"},
        "Cuts the duty on fuel": {"fuel duty"},
        "Zero-rate VAT on energy": {"VAT"},
        "VATable supplies": {"VAT"},
        "stamp duty land tax": {"stamp duty"},
        "eVED from April 2028": {"vehicle excise duty"},
        "IHT on pensions": {"inheritance tax"},
        "the gambling duties": {"gambling duties"},
        "domestic rates in Northern Ireland": {"domestic rates"},
        "child-related payments in Universal Credit and Tax Credits": set(),
        "domestic electricity in Northern Ireland": set(),
        "Freezes Plan 2 student loan repayment thresholds": set(),
        "a net income of £30,000": set(),
    }
    for text, taxes in cases.items():
        assert taxes_named(text) == taxes, text
        assert unknown_taxes(text) == [], text


def test_a_tax_this_module_does_not_know_is_reported():
    cases = {
        "Raises the apprenticeship levy": ["apprenticeship levy"],
        "a new digital services tax": ["services tax"],
        "Doubles property taxes": ["property taxes"],
        "and tax rate increases on dividends": [],
        "the tax year, pre-tax income and Tax-Free Childcare": [],
        "income after tax and after-tax income": [],
        "Child Tax Credit and Working Tax Credit": [],
        "vehicle excise duty and remote gaming duty": [],
    }
    for text, unknown in cases.items():
        assert unknown_taxes(text) == unknown, text


def test_tax_duty_or_levy_unnamed_is_reported():
    cases = {
        "employment income subject to tax and NICs": ["tax"],
        "are taxed as employment income": ["taxed"],
        "The excess becomes taxable pay.": ["taxable"],
        "Tax on the excess": ["Tax"],
        "Freezes the duty": ["duty"],
        "subject to the duty": ["duty"],
        "the levy and other levies": ["levy", "levies"],
        "income tax, tax relief and taxes on income": [],
        "the tax year, Tax-Free Childcare and Child Tax Credit": [],
        "council tax and capital gains tax": [],
        "fuel duty and stamp duty": [],
    }
    for text, bare in cases.items():
        assert bare_words(text) == bare, text


def test_a_declared_tax_covers_its_unnamed_word():
    cases = {
        ("subject to tax", "income tax"): [],
        ("subject to tax", "National Insurance"): ["tax"],
        ("Freezes the duty", "fuel duty"): [],
        ("Freezes the duty", "gambling duties"): [],
        ("Freezes the duty", "income tax"): ["duty"],
        ("the levy", "fuel duty"): ["levy"],
    }
    for (text, tax), bare in cases.items():
        assert bare_words(text, {tax}) == bare, (text, tax)
