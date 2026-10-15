"""The synthetic results-by-area fixture for the front end.

Regenerate it from the repository root with:

    uv run python -m tests.geography_fixture src/test/fixtures/geography/layer

The tables are written by the code that writes public/data/regional.csv and
constituency.csv, and the front end parses them in a test, from a deterministic synthetic recipe with no survey data:
three real regions, six made-up seats (Z14 codes, which no real seat has), a
package and its two measures, in 2026 and 2027. The layer's bootstrap draws
come from numpy, so a numpy upgrade may change the bytes; regenerate then.
"""

import sys
from pathlib import Path

import numpy as np

from uk_budget_data import geography

FIXTURE_DIR = (
    (Path(__file__).resolve().parents[1] / "src" / "test" / "fixtures")
    / "geography"
    / "layer"
)
PACKAGE = "synthetic_combined"
MEASURES = ("alpha", "beta")
YEARS = (2026, 2027)
REGIONS = {
    "E12000001": "North East",
    "E12000007": "London",
    "W92000004": "Wales",
}
SEATS = {
    "Z14000001": ("E12000001", "Synthetic seat one"),
    "Z14000002": ("E12000001", "Synthetic seat two"),
    "Z14000003": ("E12000007", "Synthetic seat three"),
    "Z14000004": ("E12000007", "Synthetic seat four"),
    "Z14000005": ("W92000004", "Synthetic seat five"),
    "Z14000006": ("W92000004", "Synthetic seat six"),
}
PER_REGION = 120
BASELINE = 28_000.0


def _households() -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Region code, position within the region, and weight per household."""
    codes = list(REGIONS)
    index = np.arange(PER_REGION * len(codes))
    region = np.array([codes[i // PER_REGION] for i in index], dtype=object)
    position = index % PER_REGION
    weight = 80.0 + 10.0 * (index % 5)
    return region, position, weight


def _seat_matrix(region: np.ndarray, position: np.ndarray, weight):
    """Two seats per region. The first two thirds of a region's households
    sit in its first seat and the last two thirds in its second, so the
    middle third is in both and splits its weight. The North East's second
    seat holds only its last ten households."""
    member = np.zeros((len(SEATS), len(region)), dtype=bool)
    for row, (code, (seat_region, _)) in enumerate(SEATS.items()):
        here = region == seat_region
        if code == "Z14000002":
            member[row] = here & (position >= PER_REGION - 10)
        elif row % 2 == 0:
            member[row] = here & (position < 2 * PER_REGION // 3)
        else:
            member[row] = here & (position >= PER_REGION // 3)
    seats = np.maximum(member.sum(axis=0), 1)
    return np.where(member, weight / seats, 0.0)


def _changes(region, position, year: int) -> dict[str, np.ndarray]:
    """Each reform's change in household net income, a year."""
    step = 1.0 + 0.1 * (year - YEARS[0])
    london = region == "E12000007"
    wales = region == "W92000004"
    # alpha does not apply in Wales, so Wales shows a zero.
    alpha = np.where(
        (position % 3 == 0) & ~wales, 150.0 * (1 + position % 4), 0.0
    )
    beta = np.zeros(len(region))
    beta[london & (position % 2 == 0)] = -60.0
    # A thin measure in Wales: fourteen households in its second seat.
    beta[wales & (position >= 80) & (position < 108) & (position % 2 == 0)] = (
        -60.0
    )
    # The package is more than its measures where both apply.
    interaction = np.where(
        london & (alpha != 0) & (beta != 0) & (position % 7 == 0), 5.0, 0.0
    )
    alpha, beta = alpha * step, beta * step
    return {
        PACKAGE: alpha + beta + interaction,
        "alpha": alpha,
        "beta": beta,
    }


def build(out_dir: Path) -> dict[str, Path]:
    """Write regional.csv and constituency.csv to ``out_dir``."""
    region, position, weight = _households()
    matrix = _seat_matrix(region, position, weight)
    seat_regions = {code: seat[0] for code, seat in SEATS.items()}
    collector = geography.GeographyCollector(
        source_ids=np.arange(len(region)),
        region_codes=region,
        national=True,
        seat_matrix=geography.SeatMatrix(
            codes=tuple(SEATS),
            parent_of=seat_regions,
            load=lambda year: matrix,
        ),
    )
    baseline = np.full(len(region), BASELINE)
    for year in YEARS:
        for reform, change in _changes(region, position, year).items():
            collector.add(
                reform,
                year,
                baseline=baseline,
                reformed=baseline + change,
                weight=weight,
            )
    release = geography.build_release(
        collector,
        seat_reforms=[PACKAGE],
        packages={PACKAGE: MEASURES},
    )
    geography.resolve(release)
    names = {
        geography.REGION: dict(REGIONS),
        geography.CONSTITUENCY: {code: s[1] for code, s in SEATS.items()},
    }
    return geography.write_public_tables(
        release.release, out_dir, names, levels=release.published_levels
    )


if __name__ == "__main__":
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else FIXTURE_DIR
    for path in build(target).values():
        print(path)
