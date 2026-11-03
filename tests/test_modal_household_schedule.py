"""The Modal household calculator's warm schedule (Vahid, 27 October)."""

from datetime import datetime, timedelta

import pytest

from uk_budget_data.household_warm import (
    WARM_UNTIL,
    WARM_WINDOWS,
    warm_target,
)


@pytest.mark.parametrize(
    "now_uk, expected",
    [
        # Tonight (Tue 27 Oct), after the 08:00-20:00 window: 0 + 1
        ("2026-10-27T19:59", (6, 1)),
        ("2026-10-27T20:00", (0, 1)),
        ("2026-10-27T23:59", (0, 1)),
        ("2026-10-28T00:00", (0, 1)),
        # Budget day, Wed 28 Oct, 07:00 to midnight: 12 + 1
        ("2026-10-28T06:59", (0, 1)),
        ("2026-10-28T07:00", (12, 1)),
        ("2026-10-28T12:30", (12, 1)),
        ("2026-10-28T23:59", (12, 1)),
        # Midnight into Thu 29 Oct: the 2 + 1 overnight
        ("2026-10-29T00:00", (2, 1)),
        ("2026-10-29T06:59", (2, 1)),
        ("2026-10-29T07:00", (12, 1)),
        ("2026-10-29T23:30", (12, 1)),
        # Fri 30 Oct, the last 12 + 1 day, and its night (2 + 1)
        ("2026-10-30T07:00", (12, 1)),
        ("2026-10-30T23:59", (12, 1)),
        ("2026-10-31T00:00", (2, 1)),
        ("2026-10-31T06:59", (2, 1)),
        # Sat 31 Oct to Mon 2 Nov: 6 + 1 07:00-23:00, 1 + 1 overnight
        ("2026-10-31T07:00", (6, 1)),
        ("2026-10-31T22:59", (6, 1)),
        ("2026-10-31T23:00", (1, 1)),
        ("2026-10-31T23:59", (1, 1)),
        ("2026-11-01T00:00", (1, 1)),
        ("2026-11-01T06:59", (1, 1)),
        ("2026-11-01T07:00", (6, 1)),
        ("2026-11-02T07:00", (6, 1)),
        ("2026-11-02T22:59", (6, 1)),
        ("2026-11-02T23:00", (1, 1)),
        # Monday's night runs to 07:00 on Tue 3 Nov
        ("2026-11-03T00:00", (1, 1)),
        ("2026-11-03T06:59", (1, 1)),
        # Tue 3 to Tue 17 Nov: 2 + 1 07:00-23:00, 0 + 1 overnight
        ("2026-11-03T07:00", (2, 1)),
        ("2026-11-03T22:59", (2, 1)),
        ("2026-11-03T23:00", (0, 1)),
        ("2026-11-04T00:00", (0, 1)),
        ("2026-11-10T15:00", (2, 1)),
        ("2026-11-17T06:59", (0, 1)),
        ("2026-11-17T07:00", (2, 1)),
        ("2026-11-17T22:59", (2, 1)),
        ("2026-11-17T23:00", (0, 1)),
        ("2026-11-17T23:59", (0, 1)),
        # The end date: scale to zero from midnight after 17 Nov
        ("2026-11-18T00:00", (0, 0)),
        ("2026-11-18T07:00", (0, 0)),
        ("2026-12-01T12:00", (0, 0)),
    ],
)
def test_warm_target(now_uk, expected):
    assert warm_target(now_uk) == expected


def test_windows_are_well_formed_and_do_not_overlap():
    """Each row's days and times are in order, and no minute is claimed by
    two rows (first match wins, so an overlap would hide a row)."""
    for first, last, start, end, household, web_warm in WARM_WINDOWS:
        assert first <= last and start < end <= "24:00"
        assert household >= 0 and web_warm >= 0
    minute = datetime(2026, 10, 26)
    stop = datetime.fromisoformat(WARM_UNTIL)
    while minute < stop:
        day, time = minute.strftime("%Y-%m-%dT%H:%M").split("T")
        matches = [
            row
            for row in WARM_WINDOWS
            if row[0] <= day <= row[1] and row[2] <= time < row[3]
        ]
        assert len(matches) <= 1, (minute, matches)
        minute += timedelta(minutes=10)
