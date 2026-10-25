"""£100 more Warm Home Discount, winter 2026-27
(``warm_home_discount_top_up``).

One modifier in a module of its own: see the package docstring.
"""

from uk_budget_data.measure_templates import apply_benefit_receipt_payment


# £100 more Warm Home Discount (£150 to £250), winter 2026-27.
#
# Paid once per household in Great Britain receiving a benefit in the
# Warm Home Discount's 2026-27 core group for England and Wales (Universal
# Credit, Pension Credit, Housing Benefit or income-related ESA; eligibility
# statement 2026-27, as policyengine-uk #2504 lists them), through the
# cost-of-living payment channel, as a benefit. Scotland's scheme has its
# own core group, so households there are approximate. Our bundle
# (policyengine-uk 2.132.6) has no Warm Home Discount; #2504 is in 2.154.0,
# which no policyengine.py release pins yet.
#
# Receipt follows DESNZ's rates (Continuing the Warm Home Discount
# 2026-2031, final stage impact assessment, para. 40): 85% of Pension Credit
# households and 70% of other eligible households receive the rebate,
# drawn by household as policyengine-uk's would_receive_warm_home_discount
# draws it (#2616, open). Once a bundle includes both, the top-up can follow
# the model's own receipt.
#
# The receipt draw happens in this modifier: deterministic and reproducible,
# but a draw made at run time rather than stored in the data. Once Microcosm
# stores warm_home_discount_random_draw as an input, the top-up switches to
# the model's own receipt and this in-modifier draw is removed.
def warm_home_discount_top_up(
    sim,
    amount=100,
    geography="GB",
    year=2026,
    pension_credit_receipt_rate=0.85,
    other_receipt_rate=0.7,
):
    return apply_benefit_receipt_payment(
        sim,
        amount=amount,
        eligible_benefits=[
            "universal_credit",
            "guarantee_credit",
            "savings_credit",
            "housing_benefit",
            "esa_income",
        ],
        geography=geography,
        channel="cost_of_living_support_payment",
        year=year,
        pension_credit_receipt_rate=pension_credit_receipt_rate,
        other_receipt_rate=other_receipt_rate,
    )
