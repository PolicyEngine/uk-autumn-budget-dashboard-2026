"""The 5% VAT on domestic electricity that the zero rate is scored against:
the pre-Budget side of ``domestic_electricity_zero_vat``
(``pre_budget_vat_on_domestic_electricity``).

One modifier in a module of its own: see the package docstring.
"""

from uk_budget_data.measure_templates import apply_vat_base_change


# The Budget 2026 document scores the whole zero rate, from 1 October 2026,
# as this Budget's measure, against 5% in every month (Table 6.1 row 2;
# zero_vat_on_domestic_electricity.py). The zero rate for 1 October 2026 to
# 31 March 2027 in Great Britain was law before the Budget (SI 2026/987),
# and policyengine-uk 2.153.5 and later have it in current law, at a rate
# of their own for domestic electricity (own_rate_parameter): 2.165.1
# charges Great Britain 0.05 x 183 / 365 in 2026-27. So the measure's
# baseline is not that current law: this side holds electricity at
# baseline_rate, 5%, in ``vat`` and ``baseline_vat``, for the years the
# measure changes (2026-27 and 2027-28), in Great Britain and Northern
# Ireland alike, and changes nothing else (a rate change of 0). The Budget
# side holds the same baseline before its cut. On policyengine-uk 2.151.0,
# which has neither that rate nor the zero rate, nothing is held.
def pre_budget_vat_on_domestic_electricity(
    sim,
    baseline_rate=0.05,
    own_rate_parameter="gov.hmrc.vat.domestic_electricity_rate",
    first_year=2026,
    last_year=2027,
):
    return apply_vat_base_change(
        sim,
        spending_variable="electricity_consumption",
        rate_change=0.0,
        start_year=first_year,
        end_year=last_year,
        baseline_rate=baseline_rate,
        own_rate_parameter=own_rate_parameter,
    )
