"""The 23 October rehearsal's registry: the mock measures only (MOCK DATA).

reforms.py returns these instead of last year's measures on the rehearsal
branch, which is never merged.
"""

from uk_budget_data.models import Reform


def rehearsal_reforms() -> list[Reform]:
    """The mock package's coded measures, in the order the page lists them."""
    return []
