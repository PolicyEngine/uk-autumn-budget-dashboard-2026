"""The Modal household calculator's warm schedule (Vahid, 25 October)."""

import pytest

modal_household = pytest.importorskip("uk_budget_data.modal_household")


@pytest.mark.parametrize(
    "now_uk, expected",
    [
        ("2026-10-25T18:00", (2, 0)),
        ("2026-10-26T09:00", (12, 1)),
        ("2026-10-26T17:59", (12, 1)),
        ("2026-10-26T18:00", (2, 0)),
        ("2026-10-28T11:59", (2, 0)),
        ("2026-10-28T12:00", (12, 1)),
        ("2026-10-28T22:00", (2, 0)),
        ("2026-11-03T23:59", (2, 0)),
        ("2026-11-04T00:00", (0, 0)),
    ],
)
def test_warm_target(now_uk, expected):
    assert modal_household.warm_target(now_uk) == expected
