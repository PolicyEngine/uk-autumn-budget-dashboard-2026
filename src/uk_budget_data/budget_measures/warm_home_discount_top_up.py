"""£100 more Warm Home Discount, winter 2026-27
(``warm_home_discount_top_up``).

One modifier in a module of its own: see the package docstring.
"""

from uk_budget_data.measure_templates import apply_benefit_receipt_payment


# £100 more Warm Home Discount (£150 to £250), winter 2026-27.
#
# Paid once per household in Great Britain receiving Universal Credit or
# Pension Credit (guarantee or savings credit), through the cost-of-living
# payment channel, as a benefit. The model has no Warm Home Discount and no
# high-cost-to-heat test, and the template cannot select the legacy benefits
# (Housing Benefit, income-related ESA and JSA, tax credits), so eligibility
# is approximate.
#
# Receipt follows DESNZ's rates (Continuing the Warm Home Discount
# 2026-2031, final stage impact assessment, para. 40): 85% of Pension Credit
# households and 70% of other eligible households receive the rebate (about
# 6m recipients of 7.8m eligible), drawn by household as policyengine-uk's
# would_receive_warm_home_discount draws it. This mirrors pe-uk #2616 until
# the bundle includes it; then the top-up can follow the model's own
# receipt.
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
        ],
        geography=geography,
        channel="cost_of_living_support_payment",
        year=year,
        pension_credit_receipt_rate=pension_credit_receipt_rate,
        other_receipt_rate=other_receipt_rate,
    )
