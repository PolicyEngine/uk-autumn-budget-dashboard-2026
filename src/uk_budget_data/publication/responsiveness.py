"""Reform responsiveness: a published measure must actually move.

A reform that silently does nothing is the failure this module exists to
catch: a backtest of past model releases reported a benefit uprating that
returned exactly £0 and another that barely moved. A zero or a sliver can
look like a small, plausible costing, so it must fail outright rather than
pass as a small number, and no reconciliation exception can waive it.

For each year in which an effect is expected, the measure's fiscal impact
must have the expected sign and be at least a minimum size: an absolute
floor, and a share of the Treasury's figure when one is known. The
expectation comes from a reviewed declaration, or failing that from the sign
of the Treasury's own costing for that year. A measure with no expectation
at all is ``undeclared`` and cannot be published.
"""

import math
import numbers
from dataclasses import dataclass
from typing import Collection, Mapping, Optional

RESPONSIVE = "responsive"
INERT = "inert"
WRONG_DIRECTION = "wrong_direction"
UNDECLARED = "undeclared"
# An expected year with no model output at all.
MISSING = "missing"

POSITIVE = "positive"
NEGATIVE = "negative"


@dataclass(frozen=True)
class ExpectedEffect:
    """A reviewed declaration of what a measure should do to the Exchequer.

    ``direction`` is the sign of the fiscal impact: positive improves the
    government balance (raises revenue or cuts spending), negative worsens
    it. The effect is expected in every model year from ``from_year`` to
    ``to_year`` inclusive (open-ended when ``to_year`` is None).
    """

    measure_id: str
    direction: str
    from_year: int
    to_year: Optional[int] = None
    reviewer: str = ""
    note: str = ""

    def __post_init__(self):
        # The declaration sets the sign a measure must have, over the
        # Treasury's own, so someone must have reviewed it.
        if not isinstance(self.reviewer, str) or not self.reviewer.strip():
            raise ValueError(
                f"{self.measure_id}: an expected effect needs its reviewer, "
                f"not {self.reviewer!r}"
            )
        if self.direction not in (POSITIVE, NEGATIVE):
            raise ValueError(
                f"{self.measure_id}: direction must be positive or negative, "
                f"not {self.direction!r}"
            )
        whole_year(self.from_year, f"{self.measure_id}: from_year")
        if self.to_year is not None:
            whole_year(self.to_year, f"{self.measure_id}: to_year")
        if self.to_year is not None and self.to_year < self.from_year:
            raise ValueError(f"{self.measure_id}: to_year before from_year")

    def covers(self, year: int) -> bool:
        return year >= self.from_year and (
            self.to_year is None or year <= self.to_year
        )


def whole_year(value, label: str) -> int:
    """A model year: a whole number, never a bool or a fraction."""
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError(f"{label} must be a whole year, not {value!r}")
    return value


def threshold(value, label: str, *, above_zero: bool = False) -> float:
    """A responsiveness threshold: finite, and not negative (above zero
    where a zero would let a measure that does nothing count as moving)."""
    number = finite_impact(value, label)
    if number < 0 or (above_zero and number == 0):
        bound = "above zero" if above_zero else "zero or more"
        raise ValueError(f"{label} must be {bound}, not {value!r}")
    return number


def overlaps(a: ExpectedEffect, b: ExpectedEffect) -> bool:
    """Whether two declarations cover a year in common."""
    a_end = math.inf if a.to_year is None else a.to_year
    b_end = math.inf if b.to_year is None else b.to_year
    return a.from_year <= b_end and b.from_year <= a_end


def one_declaration_a_year(declarations: list[ExpectedEffect]) -> None:
    """Refuse two declarations for one measure and year: which one applied
    would depend on their order."""
    for index, first in enumerate(declarations):
        for second in declarations[index + 1 :]:
            if first.measure_id == second.measure_id and overlaps(
                first, second
            ):
                raise ValueError(
                    f"{first.measure_id} has two expected effects for some "
                    f"years ({first.direction} from {first.from_year}, "
                    f"{second.direction} from {second.from_year}); give each "
                    "year one expectation"
                )


def _sign(value: float) -> str:
    return POSITIVE if value > 0 else NEGATIVE


def finite_impact(value, label: str) -> float:
    """A fiscal impact as a float: a real number, finite, never a bool.

    NaN compares false with everything, so it would pass a minimum-size
    check and take a sign; an infinite impact would pass any comparison.
    """
    if isinstance(value, bool) or not isinstance(value, numbers.Real):
        raise ValueError(f"{label} must be a number, not {value!r}")
    try:
        number = float(value)
    except OverflowError as error:  # an int too large for a float
        raise ValueError(f"{label} must be finite, not {value!r}") from error
    if not math.isfinite(number):
        raise ValueError(f"{label} must be finite, not {value!r}")
    return number


def expected_direction(
    year: int,
    declarations: list[ExpectedEffect],
    comparator_bn: Optional[float],
    zero_tolerance_bn: float,
) -> tuple[Optional[str], str]:
    """The direction expected in ``year`` and where that expectation came from.

    A declaration takes precedence. Otherwise a Treasury figure beyond its
    own rounding implies its sign. Returns (None, "none") when neither says
    an effect is expected.
    """
    for declaration in declarations:
        if declaration.covers(year):
            return declaration.direction, "declared"
    if comparator_bn is not None and abs(comparator_bn) > zero_tolerance_bn:
        return _sign(comparator_bn), "treasury"
    return None, "none"


def check_responsiveness(
    budgetary: Mapping[int, float],
    *,
    measure_id: str,
    declarations: list[ExpectedEffect],
    comparators_bn: Mapping[int, Optional[float]],
    min_response_bn: float,
    min_response_share: float,
    zero_tolerance_bn: float,
    supported_years: Optional[set[int]] = None,
    years: Optional[Collection[int]] = None,
) -> dict:
    """Check that the measure moves in the expected direction, enough.

    Args:
        budgetary: Model year -> fiscal impact in £bn (positive improves the
            government balance).
        measure_id: The measure being checked.
        declarations: Reviewed expectations for this measure.
        comparators_bn: Model year -> the Treasury's figure for that year,
            or None when there is none.
        min_response_bn: Smallest absolute impact that counts as moving.
        min_response_share: Smallest share of the Treasury's figure that
            counts as moving, when a figure exists.
        zero_tolerance_bn: A Treasury figure within this of zero implies no
            expectation (the Treasury's own rounding).
        supported_years: Years the dataset supports; others are not checked.
        years: Years that must have a model output (the artifact's), as
            well as those in ``budgetary``. An expected year with none is
            ``missing``.

    Returns:
        ``{"status", "rows"}``. Status is ``wrong_direction`` if any expected
        year has the wrong sign, else ``missing`` if any expected year has
        no model output, else ``inert`` if any expected year is below the
        minimum, else ``undeclared`` if no year carried an expectation, else
        ``responsive``.

    Raises:
        ValueError: for a year that is not a whole number, an impact,
            comparator, threshold or minimum that is not a finite number
            (or a negative threshold), or two declarations for one measure
            and year.
    """
    # Everything is checked here, whoever calls: the file loaders refuse
    # these inputs, and so must this public entry point.
    impacts = {
        whole_year(year, f"{measure_id}'s model year"): finite_impact(
            value, f"{measure_id}'s impact in {year}"
        )
        for year, value in budgetary.items()
    }
    comparators = {
        whole_year(year, f"{measure_id}'s comparator year"): (
            None
            if value is None
            else finite_impact(value, f"the Treasury's figure for {year}")
        )
        for year, value in comparators_bn.items()
    }
    min_response_bn = threshold(
        min_response_bn, "min_response_bn", above_zero=True
    )
    min_response_share = threshold(min_response_share, "min_response_share")
    zero_tolerance_bn = threshold(zero_tolerance_bn, "zero_tolerance_bn")
    years = [whole_year(year, "a reported year") for year in years or ()]
    if supported_years is not None:
        supported_years = {
            whole_year(year, "a supported year") for year in supported_years
        }
    for declaration in declarations:
        if not isinstance(declaration, ExpectedEffect):
            raise ValueError(
                f"an expected effect must be an ExpectedEffect, not "
                f"{declaration!r}"
            )
    one_declaration_a_year(list(declarations))
    own = [d for d in declarations if d.measure_id == measure_id]
    rows = []
    for year in sorted(set(impacts) | set(years)):
        if supported_years is not None and year not in supported_years:
            continue
        value = impacts.get(year)
        comparator = comparators.get(year)
        direction, basis = expected_direction(
            year, own, comparator, zero_tolerance_bn
        )
        if direction is None:
            continue
        minimum = min_response_bn
        if comparator is not None:
            minimum = finite_impact(
                max(minimum, min_response_share * abs(comparator)),
                f"{measure_id}'s minimum response in {year}",
            )
        if value is None:
            status = MISSING
        # An exact zero never counts as moving, whatever the thresholds.
        elif value == 0 or abs(value) < minimum:
            status = INERT
        elif _sign(value) != direction:
            status = WRONG_DIRECTION
        else:
            status = RESPONSIVE
        rows.append(
            {
                "year": year,
                "pe_bn": value,
                "expected_direction": direction,
                "expectation_from": basis,
                "minimum_bn": minimum,
                "status": status,
            }
        )
    statuses = {row["status"] for row in rows}
    if WRONG_DIRECTION in statuses:
        overall = WRONG_DIRECTION
    elif MISSING in statuses:
        overall = MISSING
    elif INERT in statuses:
        overall = INERT
    elif not rows:
        overall = UNDECLARED
    else:
        overall = RESPONSIVE
    return {"status": overall, "rows": rows}
