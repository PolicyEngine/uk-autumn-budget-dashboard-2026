"""UK Budget Data - Data generation pipeline for UK Autumn Budget dashboard."""

from uk_budget_data.models import DataConfig, Reform, ReformResult
from uk_budget_data.pipeline import DataPipeline, generate_all_data
from uk_budget_data.reforms import (
    create_salary_sacrifice_cap_reform,
    get_autumn_budget_2026_reforms,
    get_pre_autumn_budget_baseline,
    get_reform,
    list_reform_ids,
)

__version__ = "0.1.0"

__all__ = [
    # Models
    "DataConfig",
    "Reform",
    "ReformResult",
    # Pipeline
    "DataPipeline",
    "generate_all_data",
    # Reforms
    "get_autumn_budget_2026_reforms",
    "get_pre_autumn_budget_baseline",
    "create_salary_sacrifice_cap_reform",
    "get_reform",
    "list_reform_ids",
]
