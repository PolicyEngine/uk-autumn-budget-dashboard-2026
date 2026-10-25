"""The same registry after a Budget-day change (tests/test_registry_diff.py).

`kept` is unchanged but moved; `rate_change` changes a value; `fares`
changes only a constant its modifier reads; `dropped` is gone; `added` and
the combined run are new or changed.
"""

from uk_budget_data.models import Reform

FARE_RISE = {"2026": 0.0}


def _fare_modifier(sim):
    return FARE_RISE


def get_autumn_budget_2026_reforms():
    return [
        Reform(
            id="autumn_budget_2026_combined",
            name="Combined",
            parameter_changes={"gov.a": {"2026": 2}},
        ),
        Reform(
            id="rate_change",
            name="Rate change",
            parameter_changes={"gov.b": {"2026": 0.22}},
        ),
        Reform(
            id="kept", name="Kept", parameter_changes={"gov.a": {"2026": 1}}
        ),
        Reform(id="fares", name="Fares", simulation_modifier=_fare_modifier),
        Reform(
            id="added",
            name="Added",
            parameter_changes={"gov.c": {"2026": float("inf")}},
        ),
    ]
