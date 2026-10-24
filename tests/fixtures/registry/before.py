"""A small registry, before a Budget-day change (tests/test_registry_diff.py)."""

from uk_budget_data.models import Reform

FARE_RISE = {"2026": 0.058}


def _fare_modifier(sim):
    return FARE_RISE


def get_autumn_budget_2026_reforms():
    return [
        Reform(
            id="autumn_budget_2026_combined",
            name="Combined",
            parameter_changes={"gov.a": {"2026": 1}},
        ),
        Reform(
            id="kept", name="Kept", parameter_changes={"gov.a": {"2026": 1}}
        ),
        Reform(
            id="rate_change",
            name="Rate change",
            parameter_changes={"gov.b": {"2026": 0.2}},
        ),
        Reform(id="fares", name="Fares", simulation_modifier=_fare_modifier),
        Reform(id="dropped", name="Dropped", parameter_changes={}),
    ]
