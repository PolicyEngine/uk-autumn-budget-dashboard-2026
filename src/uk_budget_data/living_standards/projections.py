"""Baseline (current-law) UK living standards, poverty and distribution projections.

All income concepts follow DWP's Households Below Average Income (HBAI):
equivalised household net income before (BHC) and after (AHC) housing
costs, with the person as the unit of analysis (each household weighted by
its survey weight x number of members).

- equivalised income  = person-weighted mean and median of
                        equiv_hbai_household_net_income (BHC) and
                        equiv_hbai_household_net_income_ahc (AHC)
- poverty             = person-weighted share of people in households flagged
                        by in_poverty_bhc / in_poverty_ahc (absolute) and
                        in_relative_poverty_bhc / in_relative_poverty_ahc
- population groups   = hbai_person_type (HBAI dependent children,
                        working-age adults below State Pension age,
                        pensioners at or above it; each person in one group)
- income deciles      = person-weighted deciles of the equivalised income,
                        re-ranked within each year and on each basis (BHC on
                        BHC income, AHC on AHC income); decile medians
- income groups       = quintile, decile and vigintile medians, as the
                        deciles, for all people and for non-pensioners (ranked
                        among themselves), with unweighted household counts
- non-pensioner split = people in benefit units with no pensioner, split at
                        the median AHC income of that population
- child poverty by family = children (hbai_person_type CHILD) by number of
                        HBAI dependent children in the benefit unit and by
                        number of adults (non-dependent-child members)
- inequality          = person-weighted Gini, p90/p10, and ratio of top to
                        bottom quintile medians (as in HBAI Table 1.2b)
- very deep poverty   = share of people below 40% and 50% of the model's own
                        person-weighted median AHC income
- poverty by group    = tenure, family type, disability-benefit receipt in
                        the benefit unit, and region, with unweighted
                        household counts

Years run sequentially in one baseline simulation, built by
``pe.uk.managed_microsimulation()`` on the bundle's certified dataset. On a
policyengine-uk before 2.134.4 the UC health element for 2030-31 and 2031-32
is first set as that release sets it (:mod:`.uc_health_element`,
PolicyEngine/policyengine-uk#2428).
Ported from PolicyEngine/uk-living-standards-outlook
pipeline/run_projections.py (6e28822).
"""

import time
import warnings

import numpy as np
import policyengine as pe

from uk_budget_data.living_standards.engine import (
    BASE_YEAR,
    certified_dataset,
    engine_versions,
    headline_end_year,
    projection_years,
)
from uk_budget_data.living_standards.uc_health_element import (
    EXTENSION_YEARS,
    apply_uc_health_element_extension,
    needs_uc_health_element_extension,
)

warnings.filterwarnings("ignore", message="Accessing .values on a MicroSeries")

POVERTY_VARS = {
    "absolute_bhc": "in_poverty_bhc",
    "absolute_ahc": "in_poverty_ahc",
    "relative_bhc": "in_relative_poverty_bhc",
    "relative_ahc": "in_relative_poverty_ahc",
}

TENURE = {
    "OWNED_OUTRIGHT": "owned_outright",
    "OWNED_WITH_MORTGAGE": "mortgage",
    "RENT_FROM_COUNCIL": "social_rent",
    "RENT_FROM_HA": "social_rent",
    "RENT_PRIVATELY": "private_rent",
}


def wquantile(values, weights, q):
    # float64 running total: in float32 the cumulative weight ends about 0.07% short.
    order = np.argsort(values, kind="stable")
    v, w = values[order], weights[order].astype(np.float64)
    cw = np.cumsum(w)
    idx = np.searchsorted(cw, q * cw[-1])
    return float(v[min(idx, len(v) - 1)])


def wmedian(values, weights):
    return wquantile(values, weights, 0.5)


def gini(values, weights):
    """Weighted Gini from the Lorenz curve (trapezoid rule); incomes as is."""
    order = np.argsort(values, kind="stable")
    v, w = values[order].astype(float), weights[order].astype(float)
    wf = w / w.sum()
    cum = np.cumsum(v * w)
    lorenz = cum / cum[-1]
    lorenz_prev = np.concatenate([[0.0], lorenz[:-1]])
    return float(1 - np.sum(wf * (lorenz + lorenz_prev)))


def decile_medians(values, weights, groups=10):
    """Person-weighted income groups (ranked within the year), median of each:
    deciles by default, quintiles with ``groups=5``."""
    order = np.argsort(values, kind="stable")
    v, w = values[order], weights[order].astype(np.float64)
    cw = np.cumsum(w) / w.sum()
    group = np.minimum((cw * groups - 1e-12).astype(int), groups - 1)
    return [wmedian(v[group == d], w[group == d]) for d in range(groups)]


# Income groups for growth across the distribution, each population ranked
# on its own: quintiles, deciles and vigintiles.
INCOME_GROUPINGS = {"quintile": 5, "decile": 10, "vigintile": 20}


def group_medians_and_households(values, weights, hh_ids, groups):
    """The groups of :func:`decile_medians` (same ranking and cut points),
    with the median of each and the distinct unweighted households in it
    (a household whose members straddle a cut counts in both groups)."""
    order = np.argsort(values, kind="stable")
    v, w, h = values[order], weights[order].astype(np.float64), hh_ids[order]
    cw = np.cumsum(w) / w.sum()
    group = np.minimum((cw * groups - 1e-12).astype(int), groups - 1)
    return {
        "medians": [wmedian(v[group == d], w[group == d]) for d in range(groups)],
        "unweighted_households": [
            int(len(np.unique(h[group == d]))) for d in range(groups)
        ],
    }


def income_groups(a):
    """Group medians for all people and for non-pensioners (people in benefit
    units with no pensioner, as the non-pensioner split), BHC and AHC, each
    population and basis ranked on its own income."""
    populations = {
        "all": np.ones(len(a["weight"]), dtype=bool),
        "non_pensioners": ~a["bu_has_pensioner"],
    }
    return {
        pop: {
            basis: {
                name: group_medians_and_households(
                    a[f"eq_{basis}"][mask], a["weight"][mask], a["hh_id"][mask], n
                )
                for name, n in INCOME_GROUPINGS.items()
            }
            for basis in ("bhc", "ahc")
        }
        for pop, mask in populations.items()
    }


def rate(flag, weight, mask):
    return float(weight[mask & flag].sum() / weight[mask].sum())


def person_arrays(sim, year):
    """Person-level arrays needed by every section."""
    c = lambda var, **kw: sim.calculate(var, year, **kw).values  # noqa: E731
    # Entity ids come back as floats: check they are whole numbers before the cast.
    for var in ("person_household_id", "person_benunit_id"):
        ids = c(var)
        assert np.array_equal(
            ids, np.round(ids)
        ), f"{var} ids do not round-trip to integers"
    a = {
        "weight": c("person_weight"),
        "eq_bhc": c("equiv_hbai_household_net_income", map_to="person"),
        "eq_ahc": c("equiv_hbai_household_net_income_ahc", map_to="person"),
        "type": c("hbai_person_type").astype(str),
        "dep_child": c("is_hbai_dependent_child").astype(bool),
        "disabled": c("is_disabled_for_benefits").astype(bool),
        "hh_id": c("person_household_id").astype(np.int64),
        "bu_id": c("person_benunit_id").astype(np.int64),
        "tenure": c("tenure_type", map_to="person").astype(str),
        "region": c("region", map_to="person").astype(str),
    }
    for key, var in POVERTY_VARS.items():
        a[key] = c(var, map_to="person").astype(bool)
    # Benefit-unit aggregates, broadcast back to members.
    _, bu_idx = np.unique(a["bu_id"], return_inverse=True)
    n_bu = bu_idx.max() + 1
    size = np.bincount(bu_idx, minlength=n_bu)
    kids = np.bincount(bu_idx, weights=a["dep_child"], minlength=n_bu)
    pens = np.bincount(
        bu_idx, weights=a["type"] == "PENSIONER", minlength=n_bu
    )
    dis = np.bincount(bu_idx, weights=a["disabled"], minlength=n_bu)
    a["bu_children"] = kids[bu_idx].astype(int)
    a["bu_adults"] = (size - kids)[bu_idx].astype(int)
    a["bu_has_pensioner"] = pens[bu_idx] > 0
    a["bu_has_disabled"] = dis[bu_idx] > 0
    return a


def family_type(a):
    ft = np.full(len(a["weight"]), "", dtype=object)
    kids, adults = a["bu_children"] > 0, a["bu_adults"]
    ft[~a["bu_has_pensioner"] & kids & (adults == 1)] = "lone_parent"
    ft[~a["bu_has_pensioner"] & kids & (adults >= 2)] = "couple_with_children"
    ft[~a["bu_has_pensioner"] & ~kids & (adults == 1)] = "single_no_children"
    ft[~a["bu_has_pensioner"] & ~kids & (adults >= 2)] = "couple_no_children"
    ft[a["bu_has_pensioner"]] = "pensioner"
    return ft


def child_poverty(a):
    child = a["type"] == "CHILD"
    n = a["bu_children"]
    groups = {
        "all": child,
        "one_child": child & (n == 1),
        "two_children": child & (n == 2),
        "three_plus_children": child & (n >= 3),
        "lone_parent": child & (a["bu_adults"] == 1),
        "couple": child & (a["bu_adults"] >= 2),
    }
    w = a["weight"]
    return {
        m: {g: rate(a[m], w, mask) for g, mask in groups.items()}
        for m in ("relative_ahc", "absolute_ahc")
    } | {
        "children_millions": {
            g: float(w[mask].sum() / 1e6) for g, mask in groups.items()
        },
        "unweighted_children": {
            g: int(mask.sum()) for g, mask in groups.items()
        },
    }


def tenure_groups(tenure):
    """Map tenure_type to the four groups; fail on any value the map does not cover."""
    unmapped = set(np.unique(tenure)) - set(TENURE)
    assert (
        not unmapped
    ), f"tenure_type values with no group: {sorted(unmapped)}"
    return np.array([TENURE[t] for t in tenure], dtype=object)


# The poverty measures given for each group, as "Poverty over time" offers
GROUP_POVERTY_MEASURES = (
    "relative_ahc",
    "absolute_ahc",
    "relative_bhc",
    "absolute_bhc",
)


def poverty_by_group(a):
    w = a["weight"]
    breakdowns = {
        "tenure": tenure_groups(a["tenure"]),
        "family_type": family_type(a),
        "disability": np.where(
            a["bu_has_disabled"], "disabled_in_family", "no_disabled_in_family"
        ),
        "region": a["region"],
    }
    out = {}
    for name, labels in breakdowns.items():
        cells = {}
        for g in sorted(set(labels)):
            mask = labels == g
            cells[g] = {
                **{m: rate(a[m], w, mask) for m in GROUP_POVERTY_MEASURES},
                "median_equivalised_income_bhc": wmedian(
                    a["eq_bhc"][mask], w[mask]
                ),
                "people_millions": float(w[mask].sum() / 1e6),
                "unweighted_households": int(len(np.unique(a["hh_id"][mask]))),
                "unweighted_people": int(mask.sum()),
            }
        out[name] = cells
    return out


def baseline_year(sim, year, snapshot_years=()):
    a = person_arrays(sim, year)
    w = a["weight"]
    res = {"people": float(w.sum())}
    for basis, inc in (("bhc", a["eq_bhc"]), ("ahc", a["eq_ahc"])):
        res[f"mean_equivalised_income_{basis}"] = float(
            (inc * w).sum() / w.sum()
        )
        res[f"median_equivalised_income_{basis}"] = wmedian(inc, w)
        res[f"decile_medians_{basis}"] = decile_medians(inc, w)
        res[f"quintile_medians_{basis}"] = decile_medians(inc, w, groups=5)
        order = np.argsort(inc, kind="stable")
        cw = np.cumsum(w[order]) / w.sum()
        quint = np.minimum((cw * 5 - 1e-12).astype(int), 4)
        q1 = wmedian(inc[order][quint == 0], w[order][quint == 0])
        q5 = wmedian(inc[order][quint == 4], w[order][quint == 4])
        res[f"inequality_{basis}"] = {
            "gini": gini(inc, w),
            "p90_p10": wquantile(inc, w, 0.9) / wquantile(inc, w, 0.1),
            "top_bottom_quintile_median_ratio": q5 / q1,
        }
    # Groups on the HBAI definition.
    groups = {
        "all": np.ones(len(w), dtype=bool),
        "children": a["type"] == "CHILD",
        "working_age": a["type"] == "WORKING_AGE_ADULT",
        "pensioners": a["type"] == "PENSIONER",
    }
    res["poverty"] = {
        m: {g: rate(a[m], w, mask) for g, mask in groups.items()}
        for m in POVERTY_VARS
    }
    # Non-pensioner split at the non-pensioner median (AHC).
    nonpen = ~a["bu_has_pensioner"]
    mid = wmedian(a["eq_ahc"][nonpen], w[nonpen])
    below, above = nonpen & (a["eq_ahc"] < mid), nonpen & (a["eq_ahc"] >= mid)
    res["non_pensioner_split_ahc"] = {
        "non_pensioner_median": mid,
        "below_middle_mean": float(
            (a["eq_ahc"][below] * w[below]).sum() / w[below].sum()
        ),
        "above_middle_mean": float(
            (a["eq_ahc"][above] * w[above]).sum() / w[above].sum()
        ),
    }
    # Very deep poverty: thresholds from the model's own AHC median.
    med = res["median_equivalised_income_ahc"]
    res["deep_poverty_ahc"] = {
        "median": med,
        **{
            f"below_{k}pc": {
                "rate": rate(a["eq_ahc"] < med * k / 100, w, groups["all"]),
                "people_millions": float(
                    w[a["eq_ahc"] < med * k / 100].sum() / 1e6
                ),
            }
            for k in (40, 50, 60)
        },
        "check_in_relative_poverty_ahc": res["poverty"]["relative_ahc"]["all"],
    }
    res["child_poverty_by_family"] = child_poverty(a)
    res["income_groups"] = income_groups(a)
    if year in snapshot_years:
        res["poverty_by_group"] = poverty_by_group(a)
    res["diagnostics"] = {
        "universal_credit_bn": float(
            sim.calculate("universal_credit", year).sum() / 1e9
        )
    }
    return res


def group_years(policyengine_uk: str) -> tuple[int, ...]:
    """poverty_by_group snapshot years: every year from the base year to the
    end year, so the page can compare any two of them."""
    return tuple(range(BASE_YEAR, headline_end_year(policyengine_uk) + 1))


def run_projections(log=print) -> dict:
    """Run the baseline on the bundle's certified dataset, year by year.

    Returns the per-year aggregates keyed by year (as strings), with a
    ``meta`` block naming the engine and the dataset the run used.
    """
    versions = engine_versions()
    expected = certified_dataset()
    sim = pe.uk.managed_microsimulation()
    bundle = getattr(sim, "policyengine_bundle", {}) or {}
    used_sha = bundle.get("runtime_dataset_sha256")
    if used_sha != expected["sha256"]:
        raise RuntimeError(
            "The simulation did not run on the bundle's certified dataset: "
            f"expected sha256 {expected['sha256']}, got {used_sha}."
        )
    log(
        f"Dataset {expected['name']} ({expected['tag']}), sha256 "
        f"{used_sha}; policyengine {versions['policyengine']}, "
        f"policyengine-uk {versions['policyengine_uk']}"
    )
    years = projection_years(versions["policyengine_uk"])
    uc_fix = {"applied": False}
    if needs_uc_health_element_extension(versions["policyengine_uk"]):
        # Before anything is calculated for those years.
        if not getattr(sim, "built_from_dataset", False):
            raise RuntimeError(
                "The UC health element extension needs a simulation built "
                "from data (its new-claimant draw)."
            )
        uc_fix = apply_uc_health_element_extension(
            sim, tuple(y for y in EXTENSION_YEARS if y in years)
        )
        log(
            f"UC health element for {uc_fix['years']} set as in "
            f"policyengine-uk {uc_fix['fixed_in']} ({uc_fix['upstream_fix']})"
        )
    snapshot = group_years(versions["policyengine_uk"])
    results = {
        "meta": {
            "dataset_sha256": used_sha,
            "dataset_revision": bundle.get("runtime_dataset_revision"),
            **versions,
            "uc_health_element_extension": uc_fix,
        }
    }
    for year in years:
        t0 = time.time()
        r = baseline_year(sim, year, snapshot)
        results[str(year)] = r
        log(
            f"{year}: median eq BHC £{r['median_equivalised_income_bhc']:,.0f} "
            f"AHC £{r['median_equivalised_income_ahc']:,.0f} "
            f"child rel AHC {r['poverty']['relative_ahc']['children']:.3f} "
            f"gini BHC {r['inequality_bhc']['gini']:.3f} "
            f"({time.time() - t0:.0f}s)"
        )
    return results
