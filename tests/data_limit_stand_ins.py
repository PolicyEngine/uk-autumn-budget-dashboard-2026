"""The two purchase limits, kept as stand-ins for tests of the machinery.

policyengine-uk #2241 made additional-dwelling and non-residential purchase
prices inputs, nil unless a dataset sets them, and the registry held the
rates that act through them until certified data carried both: the
a6299504 cut does (PR 237's Certified data run), so they are lifted from
``DATA_LIMITS``. In a household simulation both inputs are still nil by
default, and their rates are read by the three transaction taxes' formulas,
so they remain the clearest example of a limit for the tests of detection,
recording and publication written around them.

Those tests register them on top of the registry with the
``stand_in_data_limits`` fixture (tests/conftest.py), which patches the
registry and everything derived from it, so receipts made meanwhile record
the patched digest and the gate checks against it. Tests of the registry
itself (its coverage of the certified cuts, its digest in contract.json, the
certified tripwire) run without it.
"""

from uk_budget_data import data_limits
from uk_budget_data.data_limits import DataLimit

ADDITIONAL_DWELLING_PURCHASES = DataLimit(
    key="additional_dwelling_purchases",
    parameters=(
        # SDLT higher rates for additional dwellings (FA 2003 Sch. 4ZA).
        "gov.hmrc.stamp_duty.residential.purchase.additional",
        # LBTT additional dwelling supplement.
        "gov.revenue_scotland.lbtt.residential.additional_residence_surcharge",
        # LTT higher residential rates.
        "gov.wra.land_transaction_tax.residential.higher_rate",
    ),
    missing_input="additional_residential_property_purchased",
    reason=(
        "The survey data record no purchases of additional dwellings, "
        "only the property households already own, so the higher rates "
        "cannot be costed. From policyengine-uk's fix for issue #2238 "
        "they apply to nothing; before it, to a buyer's whole stock of "
        "other property. The purchase imputation (policyengine-uk-data "
        "#573) would lift this."
    ),
)

NON_RESIDENTIAL_PURCHASES = DataLimit(
    key="non_residential_purchases",
    parameters=(
        "gov.hmrc.stamp_duty.non_residential.purchase",
        "gov.revenue_scotland.lbtt.non_residential",
        "gov.wra.land_transaction_tax.non_residential",
    ),
    missing_input="non_residential_property_purchased",
    reason=(
        "The survey data record no purchases of non-residential property, "
        "only the property households already own, so the non-residential "
        "purchase rates cannot be costed. From policyengine-uk's fix for "
        "issue #2238 they apply to nothing; before it, to a buyer's whole "
        "stock of non-residential property. The purchase imputation "
        "(policyengine-uk-data #573) would lift this."
    ),
)

PURCHASE_LIMITS = (ADDITIONAL_DWELLING_PURCHASES, NON_RESIDENTIAL_PURCHASES)

# The registry the tests of the machinery see: the stand-ins first, where
# the registry kept them, then every limit in force.
STAND_IN_DATA_LIMITS = PURCHASE_LIMITS + data_limits.DATA_LIMITS


def register(monkeypatch, limits=STAND_IN_DATA_LIMITS) -> None:
    """Make ``limits`` the registry, with everything the module derives
    from it at import."""
    monkeypatch.setattr(data_limits, "DATA_LIMITS", limits)
    monkeypatch.setattr(
        data_limits, "REGISTRY_SHA256", data_limits.registry_digest(limits)
    )
    monkeypatch.setattr(
        data_limits,
        "_MISSING_INPUTS",
        frozenset(limit.missing_input for limit in limits),
    )
    monkeypatch.setattr(
        data_limits,
        "_LIMITED_PREFIXES",
        tuple(prefix for limit in limits for prefix in limit.parameters),
    )
