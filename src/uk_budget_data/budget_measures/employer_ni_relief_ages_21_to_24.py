"""A zero employer National Insurance rate for employees aged 21 to 24
(``employer_ni_relief_under_25s``). Hand-written.

One modifier in a module of its own: see the package docstring.
"""

import numpy as np

from uk_budget_data.measure_templates import _call_formula, _replace_formula


def employer_ni_relief_ages_21_to_24(
    sim,
    start_year=2027,
    lowest_age=21,
    age_limit=25,
    upper_secondary_threshold_2027=50270,
    upper_secondary_threshold_2028=50270,
    upper_secondary_threshold_2029=50270,
    upper_secondary_threshold_2030=50270,
    upper_secondary_threshold_2031=51330,
):
    """A zero employer (secondary Class 1) rate for employees aged 21 to 24,
    up to an upper secondary threshold, from April 2027. Hand-written: no
    template changes employer National Insurance.

    Under-21s already have this zero rate in law, so the measure extends
    it to ages 21 to 24. policyengine-uk 2.132.6 charges every employee
    over 16 the full rate (the under-21 relief is in the open
    policyengine-uk #2505), so the relief is taken off for ages 21 to 24
    only: employer rate x (min(NI earnings, threshold) - secondary
    threshold), with NI earnings as the native formula has them. The
    threshold is the upper earnings limit, as the upper secondary
    thresholds are set in law, at the engine's annual values.

    Only ``ni_class_1_employer`` changes. The engine's employer cost and
    wage pass-through read the NI parameters, which do not change, so
    earnings and household incomes are fixed: the measure moves revenue
    alone.

    Apprentices (``is_apprentice``) are left as the model has them, as
    under-21s are: they already have the zero rate in law. The certified
    dataset flags no apprentices, so today this changes no result; the
    cost therefore includes 21 to 24-year-old apprentices (HMRC prices the
    apprentice relief at about £0.57bn in 2025-26).
    """
    native = sim.tax_benefit_system.get_variable("ni_class_1_employer")
    thresholds = {
        2027: upper_secondary_threshold_2027,
        2028: upper_secondary_threshold_2028,
        2029: upper_secondary_threshold_2029,
        2030: upper_secondary_threshold_2030,
        2031: upper_secondary_threshold_2031,
    }

    def formula(person, period, parameters):
        current = _call_formula(native, person, period, parameters)
        year = period.start.year
        if year < start_year or year not in thresholds:
            return current
        national_insurance = parameters(period).gov.hmrc.national_insurance
        class_1 = national_insurance.class_1
        earnings = person("ni_class_1_income", period)
        if not parameters(
            period
        ).gov.contrib.policyengine.employer_ni.exempt_employer_pension_contributions:
            earnings = earnings + person(
                "employer_pension_contributions", period
            )
        secondary_threshold = class_1.thresholds.secondary_threshold * 52
        relieved = np.maximum(
            0, np.minimum(earnings, thresholds[year]) - secondary_threshold
        )
        age = person("age", period)
        # Relevant apprentices under 25 have their own zero rate in law
        # (SSCBA 1992 s.9B), which policyengine-uk #2505 applies natively.
        # Relieving them here as well would take the relief off a charge
        # that no longer includes it, and the floor at zero would then
        # wipe out the ordinary charge above the threshold.
        in_ages = (
            (age >= lowest_age)
            & (age < age_limit)
            & ~person("is_apprentice", period)
        )
        relief = np.where(in_ages, class_1.rates.employer * relieved, 0)
        return np.maximum(current - relief, 0)

    _replace_formula(sim, "ni_class_1_employer", formula)
    return sim
