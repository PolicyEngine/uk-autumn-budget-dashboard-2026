"""Growth across the distribution with each measure, against its own baseline.

The Living standards outlook's ``income_growth_by_group`` is current law:
the real median of each quintile, decile and vigintile, for all people and
for non-pensioners, before (BHC) and after (AHC) housing costs, each year
(:func:`uk_budget_data.living_standards.build.growth_by_group`). This module
reads the same thing from the two simulations ``generate`` builds for a
measure (its baseline and its reform), so the dashboard can show growth with
the measure and what the measure does to growth:

- income: ``equiv_hbai_household_net_income`` (BHC) and
  ``equiv_hbai_household_net_income_ahc`` (AHC), per person, as the outlook
  (:func:`.projections.person_arrays`). HBAI income leaves out indirect
  taxes (fuel duty, VAT) and in-kind payments the model does not add to it,
  so a measure that works only through those does not move it;
- groups: person-weighted, re-ranked each year, each population ranked on
  its own income (:func:`.projections.income_groups`);
- prices: OBR CPI (BHC) and CPI after housing costs (AHC), 2027-28 prices,
  as ``build.py``'s ``real``.

``annual_growth`` is the real change in a group's median on the year before;
``growth_difference`` is the reform's annual growth less its own baseline's,
from the same pair of simulations, so it is what the measure does to growth.
A measure's baseline is not always the outlook's current law: a measure can
bring its own baseline (the Plan 2 measure, and so the package, model student
loan repayments on both sides), and these runs do not apply the outlook's UC
health element extension for 2030-31 and 2031-32
(:mod:`.uc_health_element`). The difference is exact either way.

Disclosure: medians of groups only, no counts, ids or weights. A grouping is
left out for a measure when any of its cells (either side, either
population and basis, any year read, the year before the first included)
has fewer than ``MIN_HOUSEHOLDS`` unweighted households, the outlook's
floor. Vigintile 1, the lowest-income 5%, is left out, as the chart leaves
it out.
"""

import numpy as np

from uk_budget_data.living_standards.engine import BASE_YEAR

# The outlook's floor (build.MIN_HOUSEHOLDS), repeated so the pipeline does
# not import the outlook builder; a test checks they agree.
MIN_HOUSEHOLDS = 100
PRICE_BASE_YEAR = BASE_YEAR
# Groups left out of the file, by grouping: vigintile 1 (the chart's rule).
SKIPPED_GROUPS = {"vigintile": (1,)}
POPULATIONS = ("all", "non_pensioners")
BASES = ("bhc", "ahc")

COLUMNS = [
    "reform_id",
    "reform_name",
    "year",
    "population",
    "basis",
    "grouping",
    "group",
    "baseline_real_median",
    "reform_real_median",
    "baseline_annual_growth",
    "reform_annual_growth",
    "growth_difference",
]


def growth_arrays(sim, year: int) -> dict:
    """The person arrays :func:`.projections.income_groups` reads, from the
    same variables as :func:`.projections.person_arrays`."""
    c = lambda var, **kw: sim.calculate(var, year, **kw).values  # noqa: E731
    for var in ("person_household_id", "person_benunit_id"):
        ids = c(var)
        assert np.array_equal(
            ids, np.round(ids)
        ), f"{var} ids do not round-trip to integers"
    a = {
        "weight": c("person_weight"),
        "eq_bhc": c("equiv_hbai_household_net_income", map_to="person"),
        "eq_ahc": c("equiv_hbai_household_net_income_ahc", map_to="person"),
        "hh_id": c("person_household_id").astype(np.int64),
    }
    bu_id = c("person_benunit_id").astype(np.int64)
    pensioner = c("hbai_person_type").astype(str) == "PENSIONER"
    _, bu_idx = np.unique(bu_id, return_inverse=True)
    pens = np.bincount(bu_idx, weights=pensioner, minlength=bu_idx.max() + 1)
    a["bu_has_pensioner"] = pens[bu_idx] > 0
    return a


def group_cells(sim, years) -> dict:
    """``{year: income_groups}`` for one simulation."""
    from uk_budget_data.living_standards.projections import income_groups

    return {year: income_groups(growth_arrays(sim, year)) for year in years}


def deflator(system=None):
    """``real(value, year, basis)``: nominal to 2027-28 prices, as build.py."""
    if system is None:
        # The OBR October 2026 forecast every run is built on.
        from uk_budget_data.forecast import forecast_parameters

        params = forecast_parameters().gov.economic_assumptions
    else:
        params = system.parameters.gov.economic_assumptions
    indices = {
        "bhc": params.indices.obr.consumer_price_index,
        "ahc": params.indices.obr.consumer_price_index_ahc,
    }

    def real(value: float, year: int, basis: str = "bhc") -> float:
        idx = indices[basis]
        return value * idx(f"{PRICE_BASE_YEAR}-01-01") / idx(f"{year}-01-01")

    return real


def growth_rows(
    reform_id: str,
    reform_name: str,
    baseline: dict,
    reform: dict,
    years,
    real,
) -> list[dict]:
    """Rows for ``income_growth_with_measures.csv`` from both sides' cells.

    ``years`` are the years whose growth is published; each needs the year
    before in both ``baseline`` and ``reform``. A grouping is left out
    whole when any cell it reads is under the floor.
    """
    from uk_budget_data.living_standards.projections import INCOME_GROUPINGS

    years = list(years)
    read = [years[0] - 1, *years]
    rows = []
    for name in INCOME_GROUPINGS:
        fewest = min(
            min(side[y][pop][basis][name]["unweighted_households"])
            for side in (baseline, reform)
            for y in read
            for pop in POPULATIONS
            for basis in BASES
        )
        if fewest < MIN_HOUSEHOLDS:
            continue
        for year in years:
            for pop in POPULATIONS:
                for basis in BASES:

                    def med(side, y):
                        return [
                            real(v, y, basis)
                            for v in side[y][pop][basis][name]["medians"]
                        ]

                    b0, b1 = med(baseline, year - 1), med(baseline, year)
                    r0, r1 = med(reform, year - 1), med(reform, year)
                    for k in range(len(b1)):
                        if k + 1 in SKIPPED_GROUPS.get(name, ()):
                            continue
                        bg = b1[k] / b0[k] - 1
                        rg = r1[k] / r0[k] - 1
                        rows.append(
                            {
                                "reform_id": reform_id,
                                "reform_name": reform_name,
                                "year": year,
                                "population": pop,
                                "basis": basis,
                                "grouping": name,
                                "group": k + 1,
                                "baseline_real_median": round(b1[k]),
                                "reform_real_median": round(r1[k]),
                                "baseline_annual_growth": round(bg, 5),
                                "reform_annual_growth": round(rg, 5),
                                "growth_difference": round(rg - bg, 5),
                            }
                        )
    return rows
