"""A measure the receipt must refuse: W4's partial-wrapper reproducer.

A module-level ``functools.partial`` hides the values it captured from any
digest, so a module holding one cannot be bound (policyengine.py#571). It
is kept apart from tests/template_measures.py, whose modifiers must bind.
"""

import functools

from uk_budget_data.measure_templates import apply_benefit_receipt_payment

PARTIAL_PAYMENT = functools.partial(
    apply_benefit_receipt_payment,
    amount=999,
    eligible_benefits=["universal_credit"],
    geography="UK",
    channel="cost_of_living_support_payment",
    year=2027,
)


def partial_payment_modifier(sim):
    return PARTIAL_PAYMENT(sim)
