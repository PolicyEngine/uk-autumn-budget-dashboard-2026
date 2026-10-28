"""The Modal household calculator's warm schedule: how many containers stay
warm, by UK time. Kept apart from ``modal_household`` so it can be tested
without Modal installed.

Approved by Vahid on 27 October 2026 ("whatever is great"), for Budget day
and the three weeks after it. The cron reads the time in Europe/London; the
clocks went back on 25 October and next change in March, so UK time is UTC
for the whole schedule and no clock change falls inside it.
"""

# Warm containers by UK time. Each row is (first day, last day, from, to,
# Household workers, Web): on every day from the first to the last day
# (inclusive), from ``from`` up to but not including ``to`` ("24:00" is
# midnight at the end of the day). First match wins.
WARM_WINDOWS = (
    # Past rows, kept as the record: the rehearsal and the day before.
    ("2026-10-26", "2026-10-26", "09:00", "18:00", 12, 1),
    ("2026-10-27", "2026-10-27", "08:00", "20:00", 6, 1),
    # A night belongs to the day it starts on: Friday's night (to 07:00
    # on Saturday) is Friday's 2 + 1, Monday's (to 07:00 on Tuesday 3
    # November) Monday's 1 + 1.
    # Budget day (Wed 28 October), Thursday and Friday: 12 + 1 by day...
    ("2026-10-28", "2026-10-30", "07:00", "24:00", 12, 1),
    # ...and 2 + 1 overnight, the nights ending on 29, 30 and 31 October.
    ("2026-10-29", "2026-10-31", "00:00", "07:00", 2, 1),
    # Saturday 31 October to Monday 2 November: 6 + 1 by day...
    ("2026-10-31", "2026-11-02", "07:00", "23:00", 6, 1),
    # ...and 1 + 1 overnight, from 23:00 on those days to 07:00 the next.
    ("2026-10-31", "2026-11-02", "23:00", "24:00", 1, 1),
    ("2026-11-01", "2026-11-03", "00:00", "07:00", 1, 1),
    # Tuesday 3 November to Tuesday 17 November: 2 + 1 by day.
    ("2026-11-03", "2026-11-17", "07:00", "23:00", 2, 1),
)
# Outside the windows, until WARM_UNTIL (tonight, 27 October, from 20:00,
# and the nights from 23:00 on 3 November): no Household worker, one Web
# container, so the first reader never meets a cold Web container; the
# workers start cold behind the page's 503 retry (#265).
WARM_OTHERWISE = (0, 1)
# The end date: from midnight at the end of 17 November, nothing is kept
# warm and the app scales to zero.
WARM_UNTIL = "2026-11-18T00:00"


def warm_target(now_uk: str) -> tuple:
    """(Household, Web) warm containers at a UK time ``YYYY-MM-DDTHH:MM``."""
    if now_uk >= WARM_UNTIL:
        return (0, 0)
    day, time = now_uk.split("T")
    for first, last, start, end, household, web_warm in WARM_WINDOWS:
        if first <= day <= last and start <= time < end:
            return (household, web_warm)
    return WARM_OTHERWISE
