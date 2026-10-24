"""The page's display metadata for each measure (reforms.PUBLIC_DISPLAY).

The frontend holds no measure list: colours, legend order, the selector's
short description, policy cards and the Methodology table's modelling notes
are published with each measure. These checks stand in for the frontend
config tests that went with the hand-written lists.
"""

import re

from uk_budget_data.publication.manifest import MeasureDisplay
from uk_budget_data.reforms import (
    AUTUMN_BUDGET_2026_COMBINED_ID,
    PUBLIC_DISPLAY,
    get_autumn_budget_2026_reforms,
)

MEASURES = [
    reform
    for reform in get_autumn_budget_2026_reforms()
    if reform.id != AUTUMN_BUDGET_2026_COMBINED_ID
]


def test_every_measure_has_valid_display_metadata():
    assert set(PUBLIC_DISPLAY) == {reform.id for reform in MEASURES}
    for reform in MEASURES:
        display = MeasureDisplay.model_validate(PUBLIC_DISPLAY[reform.id])
        for field in ("color", "summary", "starts", "type", "details"):
            assert getattr(display, field), (reform.id, field)
        assert display.modelling and display.modelled_from, reform.id


def test_colours_and_legend_places_are_distinct():
    colours = [display["color"].upper() for display in PUBLIC_DISPLAY.values()]
    assert len(set(colours)) == len(colours)
    orders = [display["order"] for display in PUBLIC_DISPLAY.values()]
    assert sorted(orders) == list(range(len(orders)))


def test_cards_never_repeat_a_revenue_figure():
    for measure_id, display in PUBLIC_DISPLAY.items():
        text = " ".join([display["summary"], display["details"]])
        assert not re.search(r"£[\d.]+ ?(bn|billion)", text), measure_id
