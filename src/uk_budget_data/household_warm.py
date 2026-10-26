"""The Modal household calculator's warm schedule (approved by Vahid, 25
October 2026): how many containers stay warm, by UK time. Kept apart from
``modal_household`` so it can be tested without Modal installed."""

# Warm containers by UK time: (start, end, Household, web), first match wins.
# Widened on 26 October (Vahid: keep it warm and ready): Tuesday for the
# deploy and checks, the whole of Budget day from 08:00, and Thursday for
# the day after.
WARM_WINDOWS = (
    ("2026-10-26T09:00", "2026-10-26T18:00", 12, 1),
    ("2026-10-27T08:00", "2026-10-27T20:00", 6, 1),
    ("2026-10-28T08:00", "2026-10-29T00:00", 12, 1),
    ("2026-10-29T08:00", "2026-10-29T20:00", 6, 1),
)
WARM_BASELINE = (2, 0)
WARM_UNTIL = "2026-11-04T00:00"


def warm_target(now_uk: str) -> tuple:
    """(Household, web) warm containers at a UK time ``YYYY-MM-DDTHH:MM``."""
    if now_uk >= WARM_UNTIL:
        return (0, 0)
    for start, end, household, web_warm in WARM_WINDOWS:
        if start <= now_uk < end:
            return (household, web_warm)
    return WARM_BASELINE
