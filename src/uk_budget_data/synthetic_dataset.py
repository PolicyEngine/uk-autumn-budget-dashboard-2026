"""A small, invented dataset for testing the generation plumbing.

No survey record is in it: every value is drawn here from a fixed seed, so
the same call makes the same bytes anywhere (here, in a worker, or in a
Modal container). It exists so ``generate --artifacts`` can be run end to
end where the licensed Microcosm data may not go, such as a Modal
container before the data's terms there are confirmed. Its figures mean
nothing and are never published: a receipt made on it is not certified,
so the publication gate refuses it.

``write(path)`` saves it for a local run. On Modal, a dataset path of
``synthetic:<households>:<seed>`` has each container build its own copy,
so no dataset file is ever sent to Modal.
"""

from pathlib import Path

import numpy as np
import pandas as pd

PREFIX = "synthetic:"
DEFAULT_HOUSEHOLDS = 300
DEFAULT_SEED = 2026
FISCAL_YEAR = 2025
REGIONS = [
    "NORTH_EAST",
    "NORTH_WEST",
    "YORKSHIRE",
    "EAST_MIDLANDS",
    "WEST_MIDLANDS",
    "EAST_OF_ENGLAND",
    "LONDON",
    "SOUTH_EAST",
    "SOUTH_WEST",
    "WALES",
    "SCOTLAND",
    "NORTHERN_IRELAND",
]
TENURES = ["RENT_PRIVATELY", "OWNED_OUTRIGHT", "OWNED_WITH_MORTGAGE"]


def spec(households: int = DEFAULT_HOUSEHOLDS, seed: int = DEFAULT_SEED) -> str:
    """The dataset path that names this dataset without its bytes."""
    return f"{PREFIX}{households}:{seed}"


def parse(path: str) -> tuple[int, int]:
    """(households, seed) from a ``synthetic:`` path."""
    if not path.startswith(PREFIX):
        raise ValueError(f"{path!r} is not a synthetic dataset path")
    households, seed = path[len(PREFIX) :].split(":")
    return int(households), int(seed)


def build(households: int = DEFAULT_HOUSEHOLDS, seed: int = DEFAULT_SEED):
    """The dataset: one or two adults per household, some with a child."""
    from policyengine_uk.data import UKSingleYearDataset

    rng = np.random.default_rng(seed)
    people, benunits, rows = [], [], []
    person_id = 0
    for household in range(1, households + 1):
        adults = 1 + int(rng.random() < 0.5)
        children = int(rng.integers(0, 3)) if rng.random() < 0.4 else 0
        pensioner = rng.random() < 0.2
        for index in range(adults + children):
            person_id += 1
            adult = index < adults
            age = (
                int(rng.integers(67, 85))
                if adult and pensioner
                else int(rng.integers(19, 66))
                if adult
                else int(rng.integers(0, 16))
            )
            earnings = (
                float(round(rng.lognormal(10.2, 0.7), -2))
                if adult and not pensioner and rng.random() < 0.8
                else 0.0
            )
            people.append(
                {
                    "person_id": person_id,
                    "person_benunit_id": household,
                    "person_household_id": household,
                    "age": age,
                    "employment_income": earnings,
                    "state_pension": 11_973.0 if adult and pensioner else 0.0,
                }
            )
        benunits.append({"benunit_id": household})
        tenure = TENURES[int(rng.integers(0, len(TENURES)))]
        rows.append(
            {
                "household_id": household,
                "household_weight": float(rng.integers(50_000, 150_000)),
                "region": REGIONS[int(rng.integers(0, len(REGIONS)))],
                "tenure_type": tenure,
                "rent": (
                    float(round(rng.uniform(6_000, 18_000), -1))
                    if tenure == "RENT_PRIVATELY"
                    else 0.0
                ),
                "council_tax": float(round(rng.uniform(1_400, 3_200), -1)),
                "electricity_consumption": float(
                    round(rng.uniform(500, 1_800), -1)
                ),
                "petrol_spending": float(round(rng.uniform(0, 1_500), -1)),
                "diesel_spending": float(round(rng.uniform(0, 600), -1)),
            }
        )
    return UKSingleYearDataset(
        person=pd.DataFrame(people),
        benunit=pd.DataFrame(benunits),
        household=pd.DataFrame(rows),
        fiscal_year=FISCAL_YEAR,
    )


def write(
    path: Path,
    households: int = DEFAULT_HOUSEHOLDS,
    seed: int = DEFAULT_SEED,
) -> Path:
    """Write the dataset to ``path`` (an .h5 file) and return the path."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    build(households, seed).save(str(path))
    return path
