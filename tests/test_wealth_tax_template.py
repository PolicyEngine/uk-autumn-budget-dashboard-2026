"""Refuse the engine's gross-wealth base for net-assets announcements."""

import pytest

from uk_budget_data.measure_templates import (
    allowance_uprating,
    rate_change,
    threshold_change,
)

WEALTH_TAX = "gov.contrib.ubi_center.wealth_tax"


@pytest.mark.parametrize("builder", [rate_change, threshold_change])
@pytest.mark.parametrize(
    "suffix", ["", "[0].rate", "[1].threshold", ".not_a_native_leaf"]
)
def test_annual_builders_refuse_every_path_under_wealth_tax(builder, suffix):
    with pytest.raises(ValueError) as error:
        builder(WEALTH_TAX + suffix, {2027: 0.02})
    message = str(error.value)
    assert WEALTH_TAX + suffix in message
    assert "gross wealth" in message
    assert "private pension" in message
    assert "no debts netted" in message
    assert "net assets would be scored on the wrong base" in message
    assert "budget-triage/JUDGED.md, S4" in message


def test_allowance_builder_also_refuses_the_wealth_tax_base():
    with pytest.raises(ValueError, match="wrong base"):
        allowance_uprating(WEALTH_TAX + "[0].threshold", 10_000_000, {2027: 0})


def test_a_similarly_named_unknown_path_is_not_mistaken_for_wealth_tax():
    with pytest.raises(ValueError, match="Unknown parameter path"):
        rate_change(WEALTH_TAX + "_other", {2027: 0.02})
