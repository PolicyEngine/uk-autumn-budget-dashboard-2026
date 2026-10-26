"""The Modal household calculator's warm schedule (Vahid, 25 October)."""

import pytest

from uk_budget_data.household_warm import warm_target


@pytest.mark.parametrize(
    "now_uk, expected",
    [
        ("2026-10-25T18:00", (2, 0)),
        ("2026-10-26T09:00", (12, 1)),
        ("2026-10-26T17:59", (12, 1)),
        ("2026-10-26T18:00", (2, 0)),
        ("2026-10-27T07:59", (2, 0)),
        ("2026-10-27T08:00", (6, 1)),
        ("2026-10-27T20:00", (2, 0)),
        ("2026-10-28T07:59", (2, 0)),
        ("2026-10-28T08:00", (12, 1)),
        ("2026-10-28T23:59", (12, 1)),
        ("2026-10-29T00:00", (2, 0)),
        ("2026-10-29T08:00", (6, 1)),
        ("2026-10-29T20:00", (2, 0)),
        ("2026-11-03T23:59", (2, 0)),
        ("2026-11-04T00:00", (0, 0)),
    ],
)
def test_warm_target(now_uk, expected):
    assert warm_target(now_uk) == expected
