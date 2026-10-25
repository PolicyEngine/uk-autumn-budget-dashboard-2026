"""One list of policy years: budget_years.json's policy_years.

The page reads its years from budget_years.json (src/utils/displayYears.js),
so the pipeline does too: every default year list is POLICY_YEARS, which
reaches 2031 (fiscal year 2031-32). The data are projected to 2032 on the
pinned model and data, so 2031-32 is a supported year.
"""

from uk_budget_data.budget_years import POLICY_YEARS
from uk_budget_data.calculators import (
    BudgetaryImpactCalculator,
    get_standard_calculators,
)
from uk_budget_data.cli import parse_args
from uk_budget_data.models import DataConfig
from uk_budget_data.reforms import DEFAULT_YEARS


def test_the_policy_years_reach_2031_32():
    assert max(POLICY_YEARS) == 2031


def test_every_default_year_list_is_the_policy_years():
    assert DEFAULT_YEARS == POLICY_YEARS
    assert DataConfig().years == POLICY_YEARS
    assert BudgetaryImpactCalculator().years == POLICY_YEARS
    assert get_standard_calculators()["budgetary"].years == POLICY_YEARS
    assert parse_args(["generate"]).years == POLICY_YEARS
    assert parse_args(["geography"]).years == POLICY_YEARS
