"""The UC health element extension (living_standards/uc_health_element.py).

It reproduces PolicyEngine/policyengine-uk#2428 (first released in 2.134.4)
for 2030-31 and 2031-32 on an engine without it. The tests follow #2428's own
invariants on a single claimant with LCWRA, built from a situation (no
dataset):

1. 2026-27 to 2029-30 are the engine's own: the patch changes nothing there.
2. From 2030-31 a protected and a new claimant's element is the year
   before's times the growth of the benefit uprating index (never below 1),
   so neither falls from 2029-30 to 2030-31; their UC does not fall either.
3. The amounts are policyengine-uk 2.134.4's, read from that release on the
   same claimants (#2428's reproducer: £457.15 a month in 2029-30, not
   £235.86 in 2030-31).
"""

from importlib.metadata import version

import numpy as np
import pandas as pd
import pytest
from policyengine_uk import Simulation
from policyengine_uk.data import UKMultiYearDataset, UKSingleYearDataset

from uk_budget_data.living_standards import uc_health_element as patch

YEARS = range(2026, 2032)


def claimant(new_claimant: bool) -> dict:
    """A single claimant aged 30 with LCWRA and no income (#2428's tests)."""
    return {
        "people": {
            "person": {
                "age": {y: 30 for y in YEARS},
                "employment_income": {y: 0 for y in YEARS},
                "uc_limited_capability_for_WRA": {y: True for y in YEARS},
            }
        },
        "benunits": {
            "benunit": {
                "members": ["person"],
                "uc_receives_new_claimant_health_element": {
                    y: new_claimant for y in YEARS
                },
            }
        },
        "households": {"household": {"members": ["person"]}},
    }


def monthly(sim, variable: str, year: int) -> float:
    return float(sim.calculate(variable, year)[0]) / 12


@pytest.fixture(scope="module", params=[False, True], ids=["protected", "new"])
def pair(request):
    """The same claimant without and with the patch."""
    before = Simulation(situation=claimant(request.param))
    after = Simulation(situation=claimant(request.param))
    info = patch.apply_uc_health_element_extension(after)
    return request.param, before, after, info


def test_the_version_gate():
    assert patch.needs_uc_health_element_extension("2.132.6")
    assert patch.needs_uc_health_element_extension("2.134.3")
    assert not patch.needs_uc_health_element_extension("2.134.4")
    assert not patch.needs_uc_health_element_extension("2.140.0")


def test_it_sets_only_2030_31_and_2031_32(pair):
    _, before, after, info = pair
    assert info["applied"] and info["years"] == [2030, 2031]
    assert info["upstream_fix"] == "PolicyEngine/policyengine-uk#2428"
    for year in range(2026, 2030):
        for variable in ("uc_LCWRA_element", "universal_credit"):
            assert monthly(after, variable, year) == monthly(
                before, variable, year
            ), (variable, year)


def test_the_element_follows_the_benefit_index_from_2030_31(pair):
    _, _, after, _ = pair
    parameters = after.tax_benefit_system.parameters
    for year in (2030, 2031):
        growth = patch.health_element_index_growth(parameters, year)
        assert growth >= 1
        assert monthly(after, "uc_LCWRA_element", year) == pytest.approx(
            monthly(after, "uc_LCWRA_element", year - 1) * growth, rel=1e-6
        )


def test_no_drop_from_2029_30(pair):
    _, _, after, _ = pair
    for variable in ("uc_LCWRA_element", "universal_credit"):
        path = [monthly(after, variable, y) for y in YEARS]
        assert all(b >= a - 1e-6 for a, b in zip(path, path[1:])), (
            variable,
            path,
        )


@pytest.mark.skipif(
    version("policyengine-uk") != "2.132.6",
    reason="amounts read from 2.134.4 against the 2.132.6 index",
)
def test_the_amounts_are_policyengine_uk_2_134_4s(pair):
    """Monthly elements from policyengine-uk 2.134.4 on the same claimants
    (scratch venv, 24 October 2026), and 2.132.6 without the fix."""
    new_claimant, before, after, _ = pair
    if new_claimant:
        fixed = {2029: 217.26, 2030: 221.60, 2031: 226.04}
    else:
        fixed = {2029: 457.15, 2030: 466.29, 2031: 475.61}
    for year, amount in fixed.items():
        assert monthly(after, "uc_LCWRA_element", year) == pytest.approx(
            amount, abs=0.006
        )
    # The bug #2428 fixed: everyone falls to the new-claimant amount.
    assert monthly(before, "uc_LCWRA_element", 2030) == pytest.approx(
        235.86, abs=0.006
    )


def test_it_refuses_the_engines_own_years():
    sim = Simulation(situation=claimant(False))
    with pytest.raises(ValueError):
        patch.apply_uc_health_element_extension(sim, years=(2029, 2030))
    with pytest.raises(ValueError):
        patch.health_element_index_growth(
            sim.tax_benefit_system.parameters, 2029
        )


class _FixedDraw:
    def __init__(self, values):
        self.values = np.array(values, dtype=float)

    def random(self, size):
        assert size == len(self.values)
        return self.values


def _two_lcwra_claimants():
    """Two LCWRA claimants, stated for every year to 2031-32."""
    return UKMultiYearDataset(datasets=[_one_year(y) for y in YEARS])


def _one_year(year: int):
    return UKSingleYearDataset(
        person=pd.DataFrame(
            {
                "person_id": [1, 2],
                "person_benunit_id": [1, 2],
                "person_household_id": [1, 2],
                "age": [30, 30],
                "uc_limited_capability_for_WRA": [True, True],
            }
        ),
        benunit=pd.DataFrame({"benunit_id": [1, 2]}),
        household=pd.DataFrame(
            {
                "household_id": [1, 2],
                "household_weight": [1.0, 1.0],
                "region": ["NORTH_EAST", "NORTH_EAST"],
            }
        ),
        fiscal_year=year,
    )


def test_data_takes_the_same_draw_held_at_the_2029_30_share(monkeypatch):
    """#2428's draw test: the scenario's seeded uniform per benefit unit
    against a share held at 22% from 2029-30, so 0.2 is a new claimant from
    2029-30 on and 0.99 never is; a status does not flip in 2030-31."""
    from policyengine_uk.scenarios import uc_reform

    draw = lambda seed: _FixedDraw([0.2, 0.99])  # noqa: E731
    monkeypatch.setattr(uc_reform.np.random, "default_rng", draw)
    sim = Simulation(dataset=_two_lcwra_claimants())
    assert getattr(sim, "built_from_dataset", False)
    patch.apply_uc_health_element_extension(sim)
    status = "uc_receives_new_claimant_health_element"
    for year in (2029, 2030, 2031):
        assert list(sim.calculate(status, year)) == [True, False], year
    amounts = patch.extended_amounts(sim)
    for year in (2030, 2031):
        element = sim.calculate("uc_LCWRA_element", year) / 12
        assert element[0] == pytest.approx(
            amounts[year]["new_claimant_monthly"], rel=1e-6
        )
        assert element[1] == pytest.approx(
            amounts[year]["protected_monthly"], rel=1e-6
        )
