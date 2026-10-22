"""Every scored year written for an uprated amount (policyengine-uk #2430).

After a change bounded to some years, policyengine-uk returns an amount it
uprates from an index (a parameter with ``uprating`` metadata: the State
Pension, benefit rates, the LEL and the like) to prior law's projected
path, rather than uprating from the changed amount
(``policyengine_uk/utils/dated_reforms.py``, "Prior law after a bounded
change"). A one-year rise in a benefit rate is gone the next year, and a
two-year freeze scores savings for two years only. So a measure on such an
amount gives it a value for every scored year from its first changed year.

A parameter without ``uprating`` metadata is checked only in the years
the engine projects it past its last stated value. Within its stated
years a stated value resumes after a bounded change, as the frozen
personal allowance and thresholds do through 2030-31. Past them the
installed engines index those thresholds, and a bounded change there also
returns them to the old path (policyengine-uk 2.145.0 resumes them from
the changed amount instead), so from 2031-32, a policy year, a change to
them must write every scored year too. Economic forecast inputs
(``gov.economic_assumptions.statutory_uprating_inputs``) are left out:
a macro scenario sets them over its own span. Changes made by simulation
modifiers are not seen here.
"""

from dataclasses import dataclass
from functools import lru_cache
from inspect import signature
from typing import Mapping, Optional

from policyengine_core.periods import Instant, instant
from policyengine_uk.tax_benefit_system import projected_timelines
from policyengine_uk.utils.dated_reforms import read_parameter_changes

# policyengine-uk 2.132.6 (policyengine 6.10.0) reads a bare year on a
# calendar-year parameter as that calendar year, as
# parameter_reads_calendar_years decides; 2.130.1 (policyengine 6.6.0)
# reads every bare year as a fiscal year, and has neither.
try:
    from policyengine_uk.tax_benefit_system import (
        parameter_reads_calendar_years,
    )
except ImportError:
    parameter_reads_calendar_years = None
if "calendar_years" not in signature(read_parameter_changes).parameters:
    parameter_reads_calendar_years = None


@dataclass(frozen=True)
class ScoredYearGap:
    """Scored years an uprated parameter's change leaves out, on one side
    (``baseline`` or ``reform``) of a measure."""

    side: str
    path: str
    years: tuple[int, ...]

    @property
    def reason(self) -> str:
        """Why generation refuses the measure (the flat pipeline warns)."""
        years = ", ".join(str(year) for year in self.years)
        return (
            f"{self.path} has no value for {years}; after a bounded change "
            "an uprated amount returns to the old path (policyengine-uk "
            "#2430). Write every scored year."
        )


def _read_window(year: int, path: str, metadata: Mapping):
    """The days whose values make the value the engine reads for ``year``.

    Formulas read an annual parameter at 1 January of the year. A
    parameter outside ``gov`` is never annualised, so that is its stated
    value on that day. In ``gov``, fiscal-year conversion has put there
    the value at 30 April, or the fiscal year's day-weighted average for a
    ``fiscal_year_blend`` parameter, while a ``preserve_calendar_dates``
    parameter keeps its statutory dates through the fiscal year
    (``policyengine_uk.utils.parameters.convert_to_fiscal_year_parameters``).
    """
    if path.split(".")[0] != "gov":
        day = instant(f"{year}-01-01")
        return day, day
    if metadata.get("fiscal_year_blend") or metadata.get(
        "preserve_calendar_dates"
    ):
        return instant(f"{year}-04-06"), instant(f"{year + 1}-04-05")
    day = instant(f"{year}-04-30")
    return day, day


def _covers(assignments, start: Instant, stop: Instant) -> bool:
    """Whether the assignments together cover every day of [start, stop]."""
    for assignment in sorted(assignments, key=lambda item: item.start):
        if assignment.stop < start:
            continue
        if assignment.start > start:
            return False
        if assignment.stop >= stop:
            return True
        start = assignment.stop.offset(1, "day")
    return False


def _touches(assignments, start: Instant, stop: Instant) -> bool:
    return any(
        item.start <= stop and item.stop >= start for item in assignments
    )


# Economic forecast inputs: a macro scenario sets them over its own span
FORECAST_INPUTS = "gov.economic_assumptions.statutory_uprating_inputs."


@lru_cache(maxsize=None)
def _projected_from(path: str) -> Optional[Instant]:
    """The first day the engine projects a gov parameter past its last
    stated value, or None (not projected, a forecast input, or an engine
    without ``statutory_parameters``)."""
    if path.split(".")[0] != "gov" or path.startswith(FORECAST_INPUTS):
        return None
    try:
        from policyengine_uk.tax_benefit_system import statutory_parameters

        stated = statutory_parameters().get_child(path).values_list
    except (ImportError, KeyError, AttributeError, IndexError, ValueError):
        return None
    last = max((entry.instant_str for entry in stated), default="")
    later = [
        entry.instant_str
        for entry in projected_timelines().get(path) or []
        if entry.instant_str > last
    ]
    return instant(min(later)) if later else None


def _missing(path: str, values, scored: list[int], system, reading) -> tuple:
    """The scored years one change leaves out: none unless the parameter
    is uprated, or, in the years the engine projects it, projected (see
    the module notes). ``reading`` is the engine's key reading, passed to
    its reader."""
    try:
        parameter = system.parameters.get_child(path)
    except (KeyError, AttributeError, IndexError, ValueError):
        return ()
    metadata = getattr(parameter, "metadata", None) or {}
    projected_from = None
    if metadata.get("uprating") is None:
        projected_from = _projected_from(path)
        if projected_from is None:
            return ()
    try:
        assignments = read_parameter_changes({path: values}, **reading)
    except (KeyError, TypeError, ValueError):
        return ()
    if not assignments:
        return ()

    def window(year):
        return _read_window(year, path, metadata)

    earliest = min(item.start.year for item in assignments) - 1
    first = next(
        (
            year
            for year in range(earliest, max(scored, default=0) + 1)
            if _touches(assignments, *window(year))
        ),
        None,
    )
    if scored and path not in projected_timelines():
        # policyengine-uk before 2.131.1 (#2404) keeps prior law's projected
        # path for gov parameters only, so a change outside gov leaves no
        # year from the last stated value on prior law: every scored year
        # must be written (review of #89).
        first = min(scored)
    if first is None:
        return ()
    return tuple(
        year
        for year in scored
        if year >= first
        and not _covers(assignments, *window(year))
        and (projected_from is None or window(year)[0] >= projected_from)
    )


def missing_scored_years(
    baseline_changes: Optional[Mapping],
    reform_changes: Optional[Mapping],
    years: list[int],
    system,
) -> list[ScoredYearGap]:
    """The scored years each uprated parameter's change leaves out.

    ``baseline_changes`` and ``reform_changes`` are a measure's two
    ``parameter_changes`` (either may be None), ``years`` its scored years
    (``DataConfig.years``) and ``system`` the installed tax-benefit system,
    whose ``uprating`` metadata says which parameters are uprated. Each
    side is checked on its own, as each runs its own simulation.

    A change's keys are read by the installed engine's own reader, as
    ``Scenario(parameter_changes=...)`` reads them: a bare year as that
    fiscal year (that calendar year on a calendar-year series, from
    policyengine 6.10.0) and ``"start.stop"`` as that interval. A scored
    year is written when the change covers every day the engine reads for
    it (``_read_window``). The first changed year is the first year,
    scored or not, whose read the change touches; every scored year from
    it on must be written. A path the system does not define, or a key it
    cannot read, is left to the scenario builder, which refuses it.
    """
    scored = sorted(set(years))
    # As Simulation.apply_scenario_parameters reads parameter_changes.
    reading = (
        {"calendar_years": parameter_reads_calendar_years()}
        if parameter_reads_calendar_years is not None
        else {}
    )
    gaps = []
    for side, changes in (
        ("baseline", baseline_changes),
        ("reform", reform_changes),
    ):
        for path, values in (changes or {}).items():
            missing = _missing(path, values, scored, system, reading)
            if missing:
                gaps.append(ScoredYearGap(side, path, missing))
    return gaps
