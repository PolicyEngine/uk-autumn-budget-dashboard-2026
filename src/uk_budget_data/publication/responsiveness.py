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

from dataclasses import dataclass
from typing import Mapping, Optional

RESPONSIVE = "responsive"
INERT = "inert"
WRONG_DIRECTION = "wrong_direction"
UNDECLARED = "undeclared"

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
        if self.direction not in (POSITIVE, NEGATIVE):
            raise ValueError(
                f"{self.measure_id}: direction must be positive or negative, "
                f"not {self.direction!r}"
            )
        if self.to_year is not None and self.to_year < self.from_year:
            raise ValueError(f"{self.measure_id}: to_year before from_year")

    def covers(self, year: int) -> bool:
        return year >= self.from_year and (
            self.to_year is None or year <= self.to_year
        )


def _sign(value: float) -> str:
    return POSITIVE if value > 0 else NEGATIVE


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

    Returns:
        ``{"status", "rows"}``. Status is ``wrong_direction`` if any expected
        year has the wrong sign, else ``inert`` if any expected year is below
        the minimum, else ``undeclared`` if no year carried an expectation,
        else ``responsive``.
    """
    own = [d for d in declarations if d.measure_id == measure_id]
    rows = []
    for year in sorted(budgetary):
        if supported_years is not None and year not in supported_years:
            continue
        value = float(budgetary[year])
        comparator = comparators_bn.get(year)
        direction, basis = expected_direction(
            year, own, comparator, zero_tolerance_bn
        )
        if direction is None:
            continue
        minimum = min_response_bn
        if comparator is not None:
            minimum = max(minimum, min_response_share * abs(comparator))
        if abs(value) < minimum:
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
    elif INERT in statuses:
        overall = INERT
    elif not rows:
        overall = UNDECLARED
    else:
        overall = RESPONSIVE
    return {"status": overall, "rows": rows}
