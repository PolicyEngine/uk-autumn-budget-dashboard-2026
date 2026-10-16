"""UK Budget Data - Data generation pipeline for UK Autumn Budget dashboard."""

# ruff: noqa: E402

# Importing the released recorder initializes policyengine, including core
# and the UK wrapper. The wrapper records model/core/wrapper versions before
# loading policyengine_uk. Record all three here during uk_budget_data import,
# before our models, pipeline or any simulation; the recorder keeps the first
# versions already observed by policyengine. Receipts can then reject packages
# upgraded while this process runs (policyengine.py#571).
from policyengine.provenance.loaded import (
    record_loaded_versions as _record_loaded_versions,
)

_record_loaded_versions(
    ("policyengine", "policyengine-uk", "policyengine-core")
)

from uk_budget_data.models import (
    DataConfig,
    Reform,
    ReformResult,
)
from uk_budget_data.pipeline import (
    DataPipeline,
    generate_all_data,
)
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
