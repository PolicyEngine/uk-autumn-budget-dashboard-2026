"""Exact rounding regressions for Budget measure parameter builders."""

from decimal import Decimal

import pytest

from uk_budget_data.measure_templates import (
    allowance_uprating,
    nearest_5p_weekly,
    pension_uprating,
)

ALLOWANCE_PATH = "gov.hmrc.income_tax.allowances.personal_allowance.amount"


@pytest.mark.parametrize(
    "amount, mode, expected",
    [
        (Decimal("15000.000000001"), "up", 15_010),
        (Decimal("14999.999999999"), "down", 14_990),
        (Decimal("15004.999999999"), "nearest", 15_000),
        (Decimal("15005"), "nearest", 15_010),
        (Decimal("15000.0000000000000000000000000001"), "up", 15_010),
        (Decimal("14999.9999999999999999999999999999"), "down", 14_990),
        (Decimal("15004.9999999999999999999999999999"), "nearest", 15_000),
    ],
)
def test_allowance_uprating_preserves_exact_rounding_boundaries(
    amount, mode, expected
):
    assert allowance_uprating(
        ALLOWANCE_PATH, amount, {2028: 0}, rounding_mode=mode
    ) == {ALLOWANCE_PATH: {"2028": expected}}


@pytest.mark.parametrize(
    "growth",
    [
        Decimal("0.5004999999999999999999"),
        Decimal("0.5004999999999999999999999999999999999999"),
    ],
)
def test_allowance_uprating_preserves_decimal_growth_before_rounding(growth):
    assert allowance_uprating(
        ALLOWANCE_PATH, 10_000, {2028: growth}, rounding_mode="nearest"
    ) == {ALLOWANCE_PATH: {"2028": 15_000}}


@pytest.mark.parametrize(
    "amount, expected",
    [
        (Decimal("200.024999999999999999"), 200),
        (Decimal("200.025"), 200.05),
        (Decimal("200.025000000000000001"), 200.05),
        (Decimal("200.024999999999999999999999999999"), 200),
        (Decimal("217.50"), 217.5),
    ],
)
def test_pension_uprating_preserves_exact_five_pence_boundaries(
    amount, expected
):
    assert nearest_5p_weekly(amount) == expected
    assert pension_uprating(amount, 0, round_to_5p=True) == expected


@pytest.mark.parametrize(
    "growth",
    [
        Decimal("0.000124999999999999999999"),
        Decimal("0.000124999999999999999999999999999999999999"),
    ],
)
def test_pension_uprating_rounds_decimal_product_without_float_conversion(
    growth,
):
    assert pension_uprating(Decimal("200"), growth, round_to_5p=True) == 200
    assert (
        pension_uprating(Decimal("217.50"), Decimal("0.03"), round_to_5p=True)
        == 224.05
    )
