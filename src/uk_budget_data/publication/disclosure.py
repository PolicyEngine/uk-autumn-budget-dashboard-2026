"""One disclosure rule for every survey-derived figure the page publishes.

Computation and publication are separate. The simulations and calculators
work on exact values and never consult this module, so a run never fails or
changes because of disclosure control. Publication reads each figure's exact
parts, record by record (``household_frame``, ``person_frame``), and turns
them into the figure people read.

The rule, for every figure built from the survey records (UK Data Service
CD171 section 5.2.1, as this project applies it):

- a figure that rests on 1 or 2 survey households is withheld. Microcosm
  builds several records from one survey household, so the count is of
  distinct survey households (``pipeline.scatter_survey_households``), and
  only households that move the figure count;
- every other figure carries keyed noise: each survey household's part of
  the numerator is multiplied by its own fixed factor, 8 to 12% from 1,
  derived from a secret key (``policyengine.disclosure.noise_factors``).
  Denominators stay exact, so even an average over one household's records
  is noised. A household has the same factor in every table and every run,
  so repeated publication cannot average the noise away;
- a count of survey households is published only as a band: "<10", "10–29"
  or "30+".

With noise off (``Policy(noise=False)``) the floor is 10 survey households
and no figure is noised: the rule without noise, which also needs checks on
what subtraction recovers. This module makes no such check.
"""

import hashlib
import hmac
from dataclasses import dataclass
from typing import Optional

import numpy as np
import pandas as pd
from policyengine.disclosure import noise_factors, resolve_noise_key
from policyengine.disclosure.schema import (
    BAND_10_TO_29,
    BAND_30_PLUS,
    BAND_UNDER_10,
)

from uk_budget_data.calculators import (
    AGE_BAND_ALL,
    AGE_BANDS,
    AGE_CHANGE_THRESHOLD,
    DIRECT_EFFECT_MIN_GBP,
    DIRECT_EFFECT_VARIABLES,
    POVERTY_GROUPS,
    POVERTY_MEASURES,
    BudgetaryImpactCalculator,
    age_band_of,
    single_age_of,
)

# CD171's absolute floor (cells on 1 or 2 cases are never published), which
# applies when every figure is noised; and its working floor without noise.
NOISED_FLOOR = 3
EXACT_FLOOR = 10
# A household whose net income moves by less than this, £ a year, has not
# changed: the difference is rounding in the engine (as
# ``disclosure_floor.CHANGE_TOLERANCE``).
CHANGE_TOLERANCE = 0.01
DECILE_NAMES = (
    "1st",
    "2nd",
    "3rd",
    "4th",
    "5th",
    "6th",
    "7th",
    "8th",
    "9th",
    "10th",
)
_FINGERPRINT_LABEL = b"uk-budget-data.disclosure.key-fingerprint.v1"


@dataclass(frozen=True)
class Policy:
    """How figures are published: with keyed noise and a floor of 3 survey
    households (the default), or exact with a floor of 10."""

    noise: bool = True

    @property
    def floor(self) -> int:
        return NOISED_FLOOR if self.noise else EXACT_FLOOR

    def key(self) -> Optional[bytes]:
        """The noise key from ``POLICYENGINE_DISCLOSURE_NOISE_KEY``, or None
        without noise. A missing or short key stops publication, never a
        computation."""
        return resolve_noise_key() if self.noise else None

    def record(self, key: Optional[bytes]) -> dict:
        """What a receipt records of the policy: never the key, only a
        fingerprint that names it."""
        return {
            "noise": self.noise,
            "floor_survey_households": self.floor,
            "key_fingerprint": None if key is None else key_fingerprint(key),
        }


def key_fingerprint(key: bytes) -> str:
    """Names a key without revealing it: an HMAC of a fixed label, so the
    same key always gives the same fingerprint."""
    return hmac.new(key, _FINGERPRINT_LABEL, hashlib.sha256).hexdigest()[:16]


def record_factors(survey, key: Optional[bytes]) -> np.ndarray:
    """Each record's noise factor, from its survey household; ones when
    figures are published without noise (``key`` None)."""
    survey = np.asarray(survey)
    if key is None:
        return np.ones(len(survey))
    return noise_factors(survey, key)


def band(households: int) -> str:
    """The published band of a count of survey households."""
    if households < 10:
        return BAND_UNDER_10
    if households < 30:
        return BAND_10_TO_29
    return BAND_30_PLUS


@dataclass(frozen=True)
class Figure:
    """One published figure: its value, None when withheld. ``households``
    is the exact count of survey households behind it, which stays
    private: only its band (``band``) is ever published."""

    value: Optional[float]
    households: int

    @property
    def withheld(self) -> bool:
        return self.value is None


def figure(
    parts,
    denominator: float,
    movers,
    survey,
    factors,
    *,
    floor: int,
    scale: float = 1.0,
) -> Figure:
    """``scale`` × the noised sum of the movers' ``parts``, over an exact
    ``denominator``.

    ``parts`` is each record's exact part of the numerator, ``movers`` marks
    the records that move the figure, ``survey`` names each record's survey
    household and ``factors`` its noise factor. A figure no household moves
    is an exact zero. One that 1 to ``floor`` - 1 survey households move is
    withheld.
    """
    movers = np.asarray(movers, dtype=bool)
    households = len(np.unique(np.asarray(survey)[movers]))
    if households == 0:
        return Figure(0.0, 0)
    if households < floor:
        return Figure(None, households)
    if denominator == 0:
        raise ValueError("a published figure has a zero denominator")
    noised = np.asarray(factors)[movers] * np.asarray(parts)[movers]
    return Figure(float(noised.sum()) / denominator * scale, households)


def _values(simulation, variable: str, year: int, map_to: str) -> np.ndarray:
    return np.asarray(
        simulation.calculate(variable, period=year, map_to=map_to).values,
        dtype=float,
    )


def household_frame(
    baseline, reformed, year: int, survey, reform_id: str = ""
) -> dict:
    """A year's exact household values, in the engine's household order:
    what the decile, budget and headline figures are made from. Private:
    it names each record's survey household. The costing reads the
    government balance, or student loan repayments for the measures
    ``BudgetaryImpactCalculator`` costs that way."""
    budget = (
        "student_loan_repayment"
        if reform_id in BudgetaryImpactCalculator.STUDENT_LOAN_REFORMS
        else "gov_balance"
    )
    frame = {
        "survey": np.asarray(survey),
        "weight": _values(baseline, "household_weight", year, "household"),
        "people": _values(
            baseline, "household_count_people", year, "household"
        ),
        "decile": _values(
            baseline, "household_income_decile", year, "household"
        ),
        "baseline_income": _values(
            baseline, "household_net_income", year, "household"
        ),
        "reform_income": _values(
            reformed, "household_net_income", year, "household"
        ),
        "gov_change": _values(reformed, budget, year, "household")
        - _values(baseline, budget, year, "household"),
    }
    if len(frame["survey"]) != len(frame["weight"]):
        raise ValueError(
            f"{len(frame['survey'])} survey households for "
            f"{len(frame['weight'])} households"
        )
    return frame


def person_frame(baseline, reformed, year: int, survey) -> dict:
    """A year's exact person values: what the age and poverty figures are
    made from. ``survey`` is in the engine's household order; each person
    takes their household's. Private, as ``household_frame``."""
    position = pd.Index(
        _values(baseline, "household_id", year, "household")
    ).get_indexer(_values(baseline, "household_id", year, "person"))
    if (position < 0).any():
        raise ValueError("a person's household is not among the households")
    own_change = np.zeros(len(position))
    for variable in DIRECT_EFFECT_VARIABLES:
        own_change = np.maximum(
            own_change,
            np.abs(
                _values(reformed, variable, year, "person")
                - _values(baseline, variable, year, "person")
            ),
        )
    frame = {
        "survey": np.asarray(survey)[position],
        "weight": _values(baseline, "person_weight", year, "person"),
        "age": _values(baseline, "age", year, "person"),
        "decile": _values(baseline, "household_income_decile", year, "person"),
        "baseline_income": _values(
            baseline, "household_net_income", year, "person"
        ),
        "reform_income": _values(
            reformed, "household_net_income", year, "person"
        ),
        "baseline_equivalised": _values(
            baseline, "equiv_household_net_income", year, "person"
        ),
        "reform_equivalised": _values(
            reformed, "equiv_household_net_income", year, "person"
        ),
        "own_change": own_change,
    }
    for measure, variable in POVERTY_MEASURES.items():
        frame[f"before_{measure}"] = _values(
            baseline, variable, year, "person"
        )
        frame[f"after_{measure}"] = _values(reformed, variable, year, "person")
    for prefix, flag in POVERTY_GROUPS.items():
        if flag is not None:
            frame[f"in_{prefix}group"] = _values(
                baseline, flag, year, "person"
            )
    return frame


def decile_tables(
    frame: dict,
    factors,
    policy: Policy,
    *,
    reform_id: str,
    reform_name: str,
    year: int,
) -> tuple[list[dict], list[dict], list[str]]:
    """The year's ``distributional_impact`` and ``winners_losers`` rows, as
    the calculators make them, with each cell published by the policy, and
    the labels of the cells withheld.

    A decile's relative change is its households' noised change over their
    exact baseline income; its average change is the same noised change over
    its exact household count. "all" is every household with a decile.
    """
    change = frame["reform_income"] - frame["baseline_income"]
    movers = np.abs(change) >= CHANGE_TOLERANCE
    weight = frame["weight"]
    decile = frame["decile"]
    parts = weight * change
    base = {"reform_id": reform_id, "reform_name": reform_name, "year": year}
    distributional, winners, withheld = [], [], []
    groups = [(str(n), decile == n) for n in range(1, 11)]
    groups.append(("all", decile >= 1))
    for label, members in groups:
        if not members.any():
            continue
        moving = movers & members
        average = figure(
            parts,
            float(weight[members].sum()),
            moving,
            frame["survey"],
            factors,
            floor=policy.floor,
        )
        winners.append({**base, "decile": label, "avg_change": average.value})
        if average.withheld:
            withheld.append(f"decile {label}")
        if label == "all":
            continue
        income = float((weight * frame["baseline_income"])[members].sum())
        if income <= 0:
            raise ValueError(
                f"Decile {label} has non-positive weighted baseline income "
                f"({income}) in {year}; a relative change is undefined."
            )
        relative = figure(
            parts,
            income,
            moving,
            frame["survey"],
            factors,
            floor=policy.floor,
            scale=100.0,
        )
        distributional.append(
            {
                **base,
                "decile": DECILE_NAMES[int(label) - 1],
                "value": relative.value,
            }
        )
    return distributional, winners, withheld


def budgetary_row(
    frame: dict,
    factors,
    policy: Policy,
    *,
    reform_id: str,
    reform_name: str,
    year: int,
) -> tuple[dict, list[str]]:
    """The year's net cost, £bn: the households' noised change in the
    government balance."""
    change = frame["gov_change"]
    movers = np.abs(change) >= CHANGE_TOLERANCE
    cost = figure(
        frame["weight"] * change,
        1e9,
        movers,
        frame["survey"],
        factors,
        floor=policy.floor,
    )
    row = {
        "reform_id": reform_id,
        "reform_name": reform_name,
        "year": year,
        "value": cost.value,
    }
    return row, (["budgetary impact"] if cost.withheld else [])


def age_rows(
    frame: dict,
    factors,
    policy: Policy,
    *,
    reform_id: str,
    reform_name: str,
    year: int,
) -> tuple[list[dict], list[str]]:
    """The year's age rows (``AgeImpactCalculator``'s groups and columns),
    each cell published by the policy, and the labels withheld.

    Every single year of age has a row: a thin cell is withheld on its own,
    with no record-count rule. ``survey_households`` replaces the exact
    ``sample_size``: the band of survey households whose change moves the
    row's mean. ``pct_unchanged`` is 100 less the two published shares, so
    it is withheld with either of them.
    """
    kept = frame["decile"] >= 1
    survey = frame["survey"][kept]
    weight = frame["weight"][kept]
    noise = np.asarray(factors)[kept]
    change = (frame["reform_income"] - frame["baseline_income"])[kept]
    relative = change / np.maximum(frame["baseline_income"][kept], 1)
    better = relative > AGE_CHANGE_THRESHOLD
    worse = relative < -AGE_CHANGE_THRESHOLD
    equivalised = (
        frame["reform_equivalised"] - frame["baseline_equivalised"]
    )[kept]
    direct = frame["own_change"][kept] >= DIRECT_EFFECT_MIN_GBP
    moved = np.abs(change) >= CHANGE_TOLERANCE
    moved_equivalised = np.abs(equivalised) >= CHANGE_TOLERANCE
    age = frame["age"][kept]
    bands = age_band_of(age)
    singles = single_age_of(age)
    groups = [(label, bands == label) for label, _, _ in AGE_BANDS]
    groups.append((AGE_BAND_ALL, np.ones(len(age), dtype=bool)))
    for label in sorted(set(singles), key=lambda s: int(s.rstrip("+"))):
        groups.append((label, singles == label))
    rows, withheld = [], []
    for label, members in groups:
        people = float(weight[members].sum())
        if people <= 0:
            continue

        def cell(
            parts, movers, scale=1.0, denominator=people, members=members
        ):
            return figure(
                parts,
                denominator,
                movers & members,
                survey,
                noise,
                floor=policy.floor,
                scale=scale,
            )

        mean = cell(weight * change, moved)
        cells = {
            "people": cell(weight, members, 1.0, 1.0),
            "mean_change": mean,
            "mean_equivalised_change": cell(
                weight * equivalised, moved_equivalised
            ),
            "pct_better_off": cell(weight, better, 100.0),
            "pct_worse_off": cell(weight, worse, 100.0),
            "people_directly_affected": cell(weight, direct, 1.0, 1.0),
        }
        better_off = cells["pct_better_off"].value
        worse_off = cells["pct_worse_off"].value
        unchanged = (
            None
            if better_off is None or worse_off is None
            else 100.0 - better_off - worse_off
        )
        rows.append(
            {
                "reform_id": reform_id,
                "reform_name": reform_name,
                "year": year,
                "age_band": label,
                "people": cells["people"].value,
                "survey_households": band(mean.households),
                "mean_change": mean.value,
                "mean_equivalised_change": cells[
                    "mean_equivalised_change"
                ].value,
                "pct_better_off": better_off,
                "pct_worse_off": worse_off,
                "pct_unchanged": unchanged,
                "people_directly_affected": cells[
                    "people_directly_affected"
                ].value,
            }
        )
        withheld += [
            f"age {label} {column}"
            for column, value in cells.items()
            if value.withheld
        ]
    return rows, withheld


def poverty_row(
    persons: dict,
    households: dict,
    person_factors,
    household_factors,
    policy: Policy,
    *,
    reform_id: str,
    reform_name: str,
    year: int,
) -> tuple[dict, list[str]]:
    """The year's headline and poverty columns (``MetricsCalculator``'s),
    published by the policy, and the columns withheld.

    A poverty change rests on the survey households of the people who cross
    a line, which can be few however many households a measure changes. In
    percentage points it is their noised weighted count, signed, over the
    exact population; in % of the exact baseline rate. People affected is
    the noised share of people in households whose income moves. The
    inequality columns (Gini, top shares, 90/10) are not sums of household
    parts, so this module does not publish them.
    """
    row = {"reform_id": reform_id, "reform_name": reform_name, "year": year}
    withheld = []
    weight = persons["weight"]
    for measure in POVERTY_MEASURES:
        before = persons[f"before_{measure}"].astype(bool)
        after = persons[f"after_{measure}"].astype(bool)
        crossed = before != after
        signed = after.astype(float) - before.astype(float)
        for prefix in POVERTY_GROUPS:
            members = (
                np.ones(len(weight), dtype=bool)
                if not prefix
                else persons[f"in_{prefix}group"].astype(bool)
            )
            total = float(weight[members].sum())
            baseline_rate = float(weight[members & before].sum()) / total
            if baseline_rate <= 0:
                raise ValueError(
                    f"Baseline {prefix}{measure} poverty rate is 0 for "
                    f"{reform_id} in {year}; a relative change is undefined."
                )
            points = figure(
                weight * signed,
                total,
                crossed & members,
                persons["survey"],
                person_factors,
                floor=policy.floor,
                scale=100.0,
            )
            name = f"{prefix}poverty_{measure}"
            row[f"{name}_change_pp"] = points.value
            row[f"{name}_change_pct"] = (
                None
                if points.withheld
                else points.value / (baseline_rate * 100.0) * 100.0
            )
            if points.withheld:
                withheld.append(name)
    row["poverty_change_pp"] = row["poverty_abs_bhc_change_pp"]
    row["poverty_change_pct"] = row["poverty_abs_bhc_change_pct"]
    valid = households["decile"] >= 1
    change = households["reform_income"] - households["baseline_income"]
    changed = (
        np.abs(change / np.maximum(households["baseline_income"], 1))
        > AGE_CHANGE_THRESHOLD
    )
    people = households["weight"] * households["people"]
    affected = figure(
        people,
        float(people[valid].sum()),
        changed & valid,
        households["survey"],
        household_factors,
        floor=policy.floor,
        scale=100.0,
    )
    row["people_affected"] = affected.value
    if affected.withheld:
        withheld.append("people affected")
    return row, withheld
