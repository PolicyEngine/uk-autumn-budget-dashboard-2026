"""Assemble public/data/living_standards_outlook.json (docs/DATA_CONTRACT.md).

Inputs:
- the projections (:mod:`.projections`), run on the bundle's certified
  dataset;
- data_inputs/living_standards/hbai_outturn.json (:mod:`.hbai`);
- data_inputs/living_standards/obr_rhdi.json (:mod:`.obr`);
- OBR March 2026 series from the policyengine-uk parameters pinned by the
  policyengine bundle (gov.economic_assumptions.yoy_growth.obr.*), using the
  same series and section grouping as PolicyEngine/uk-spring-statement-2026;
- data_inputs/living_standards/obr_forecast_post.json, if present: the
  Budget forecast loaded by ``uk-budget-data obr-forecast`` (:mod:`.forecast`).

Ported from PolicyEngine/uk-living-standards-outlook
pipeline/build_outlook.py (6e28822). Provenance now comes from the installed
bundle: the engine versions and the certified dataset's build tag and sha256.
"""

import json
from datetime import datetime, timezone
from importlib.metadata import version

from policyengine_uk.system import system

from uk_budget_data.living_standards.engine import (
    BASE_YEAR,
    OBR_FORECAST_LAST_YEAR,
    certified_dataset,
    fy,
    headline_end_year,
    headline_end_year_note,
)
from uk_budget_data.living_standards.projections import GROUP_POVERTY_MEASURES
from uk_budget_data.living_standards.uc_health_element import (
    EXTENSION_YEARS,
    needs_uc_health_element_extension,
)

PRICE_BASE_YEAR = BASE_YEAR  # fiscal 2027-28, as on the rest of the dashboard
# Income, poverty and inequality series start at the model's own 2024-25
# point, so the level gap to HBAI shows within 2024-25 rather than as a
# one-year change. Everything else (growth, deciles, depth, groups) starts in
# 2027-28, the base year.
JOIN_START = 2024
PROJECTION_START = BASE_YEAR
HEADLINE_START_YEAR = BASE_YEAR  # headline changes run from 2027-28
# The end year, 2031-32: engine.END_YEAR. Before policyengine-uk 2.134.4 the
# UC health element for 2030-31 and 2031-32 follows that release's fix
# (uc_health_element.py, PolicyEngine/policyengine-uk#2428).
POST_PUBLISHED = (
    False  # Autumn Budget 2026 OBR forecast loaded into forecast.post
)
MIN_HOUSEHOLDS = (
    100  # suppress poverty_by_group cells below this unweighted count
)
# OBR calendar years the Forecast changes sub-tab shows: 2027, the first year
# of the dashboard's 2027-28 to 2031-32 period, to 2030, the last year of the
# OBR March 2026 forecast. 2031 is a policyengine-uk long-run assumption, not
# an OBR forecast, so it is not shown.
FORECAST_YEARS = range(BASE_YEAR, OBR_FORECAST_LAST_YEAR + 1)

# (key, label, parameter leaf under gov.economic_assumptions.yoy_growth.obr)
SECTIONS = [
    (
        "Inflation and price indices",
        [
            ("cpi", "CPI inflation", "consumer_price_index"),
            ("cpih", "CPIH inflation", "cpih"),
            (
                "cpi_ahc",
                "CPI (after housing costs)",
                "consumer_price_index_ahc",
            ),
            ("rpi", "RPI inflation", "rpi"),
        ],
    ),
    (
        "Income and earnings",
        [
            ("earnings", "Earnings growth", "average_earnings"),
            (
                "non_labour_income",
                "Non-labour income growth",
                "non_labour_income",
            ),
        ],
    ),
    (
        "Housing and rent",
        [
            ("house_prices", "House price growth", "house_prices"),
            ("rent", "Rent growth (private and social, ONS D7GQ)", "rent"),
            (
                "social_rent",
                "Social rent growth (England rent policy cap)",
                "social_rent",
            ),
            (
                "mortgage_interest",
                "Mortgage interest growth",
                "mortgage_interest",
            ),
        ],
    ),
]


# OBR EFO March 2026 detailed forecast tables, economy (published 3 March 2026;
# still the latest OBR forecast until the 28 October 2026 EFO). Every OBR series
# below is the calendar-year row of the table: growth in the annual average,
# not fiscal year and not Q4 on Q4. Checked against the xlsx on 20 Oct 2026.
EFO = "OBR EFO March 2026, economy detailed forecast tables"
SOURCES = {
    "consumer_price_index": f"{EFO}, Table 1.7, CPI (calendar year), rounded to 1 d.p. as in Table A.1",
    "cpih": f"{EFO}, Table 1.7, CPIH (calendar year)",
    "consumer_price_index_ahc": (
        "PolicyEngine derivation from OBR March 2026 CPI and rents (not an OBR series; "
        "ONS ad hoc 2863 definition, excluding rents, maintenance and water); 2027 onwards held at 1.9%"
    ),
    "rpi": f"{EFO}, Table 1.7, RPI (calendar year), rounded to 1 d.p. as in Table A.1",
    "average_earnings": (
        f"{EFO}, Table 1.6, average weekly earnings growth (wages and salaries per employee, "
        "calendar year), rounded to 1 d.p. as in Table A.1"
    ),
    "non_labour_income": f"{EFO}, Table 1.12, growth in non-labour income (calendar year)",
    "house_prices": f"{EFO}, Table 1.16, house price index growth (calendar year), rounded to 1 d.p.",
    "rent": f"{EFO}, Table 1.7, actual rents for housing (ONS D7GQ, calendar year)",
    "social_rent": "England social rent policy cap (CPI + 1%, MHCLG policy statement on rents for social housing); not an OBR forecast",
    "mortgage_interest": (
        f"{EFO}, Table 1.7, mortgage interest payments (calendar year), 2027-2029; "
        "OBR stops forecasting this series after 2030 Q1, so the 2030 value (5.5%) is "
        "carried over from policyengine-uk's November 2025 update, not an OBR March 2026 figure"
    ),
}


def build_outlook(
    projections: dict, hbai: dict, rhdi: dict, generated_at: str | None = None
) -> dict:
    """The outlook document from the projections and the outturn inputs.

    The projections must have been run on the installed engine and the
    bundle's certified dataset; the provenance written is the bundle's.
    """
    proj = dict(projections)
    run_meta = proj.pop("meta")
    dataset = certified_dataset()
    pe_version = version("policyengine")
    pe_uk = version("policyengine-uk")
    if run_meta["dataset_sha256"] != dataset["sha256"]:
        raise ValueError(
            "The projections were run on another dataset than the bundle's certified one."
        )
    if (run_meta["policyengine"], run_meta["policyengine_uk"]) != (
        pe_version,
        pe_uk,
    ):
        raise ValueError(
            "The projections were run on another engine than the installed one."
        )
    uc_fix = run_meta.get("uc_health_element_extension", {"applied": False})
    if needs_uc_health_element_extension(pe_uk) and uc_fix.get(
        "years"
    ) != list(EXTENSION_YEARS):
        raise ValueError(
            "The projections were run without the UC health element "
            f"extension for {list(EXTENSION_YEARS)}, which policyengine-uk "
            f"{pe_uk} needs."
        )
    HEADLINE_END_YEAR = headline_end_year(pe_uk)
    # The OBR October 2026 forecast the projections are run on.
    from uk_budget_data.forecast import forecast_parameters

    params = forecast_parameters().gov.economic_assumptions

    # Real terms: chained OBR CPI index (BHC) and CPI after housing costs (AHC)
    # from the pinned package; the value for calendar key Y is applied to
    # fiscal year Y-(Y+1), as policyengine-uk does when uprating.
    # real = nominal * P(base) / P(Y), base = PRICE_BASE_YEAR (2027-28 = 1).
    indices = {
        "bhc": params.indices.obr.consumer_price_index,
        "ahc": params.indices.obr.consumer_price_index_ahc,
    }

    def real(value: float, year: int, basis: str = "bhc") -> float:
        idx = indices[basis]
        return value * idx(f"{PRICE_BASE_YEAR}-01-01") / idx(f"{year}-01-01")

    all_years = sorted(int(y) for y in proj if y.isdigit())
    years = [
        y for y in all_years if PROJECTION_START <= y <= HEADLINE_END_YEAR
    ]
    join_years = [y for y in all_years if JOIN_START <= y <= HEADLINE_END_YEAR]
    end = years[-1]
    P = lambda y: proj[str(y)]  # noqa: E731

    income_metrics = {
        "mean_equivalised_income": ("mean_equivalised_income_bhc", "bhc"),
        "median_equivalised_income": ("median_equivalised_income_bhc", "bhc"),
        "mean_equivalised_income_ahc": ("mean_equivalised_income_ahc", "ahc"),
        "median_equivalised_income_ahc": (
            "median_equivalised_income_ahc",
            "ahc",
        ),
    }
    living = {
        m: [
            {
                "year": fy(y),
                "nominal": round(P(y)[src]),
                "real": round(real(P(y)[src], y, basis)),
            }
            for y in join_years
        ]
        for m, (src, basis) in income_metrics.items()
    }

    # HBAI equivalised income outturn (Table 1.2b) is GBP per week in average
    # 2024/25 prices. Annualise (x 52) and express in 2027-28 prices. BHC cash
    # values are recovered with OBR CPI. AHC outturn is real only: pe-uk's
    # CPI-AHC index is flat before 2022, so recovered 2021-22 cash values come
    # out about 10.7% too high (PolicyEngine/policyengine-uk#2531 does not fix it).
    income_outturn = {}
    for m, (_, basis) in income_metrics.items():
        idx = indices[basis]
        series = []
        for r in hbai["income"][m]:
            y = int(r["year"][:4])
            annual = r["weekly_2024_25_prices"] * 52
            real_v = (
                annual * idx(f"{PRICE_BASE_YEAR}-01-01") / idx("2024-01-01")
            )
            nominal = (
                annual * idx(f"{y}-01-01") / idx("2024-01-01")
                if basis == "bhc"
                else None
            )
            series.append(
                {
                    "year": r["year"],
                    "nominal": None if nominal is None else round(nominal),
                    "real": round(real_v),
                }
            )
        income_outturn[m] = series

    measures = ["absolute_bhc", "absolute_ahc", "relative_bhc", "relative_ahc"]
    groups = ["all", "children", "working_age", "pensioners"]
    poverty_proj = {
        m: {
            g: [
                {"year": fy(y), "rate": round(P(y)["poverty"][m][g], 5)}
                for y in join_years
            ]
            for g in groups
        }
        for m in measures
    }

    # 1. Real income growth by decile, and the non-pensioner split.
    def group_years(basis, key):
        base = [
            real(v, PRICE_BASE_YEAR, basis)
            for v in P(PRICE_BASE_YEAR)[f"{key}_medians_{basis}"]
        ]
        by_year = []
        for y in years:
            r = [real(v, y, basis) for v in P(y)[f"{key}_medians_{basis}"]]
            by_year.append(
                {
                    "year": fy(y),
                    "real_median": [round(v) for v in r],
                    "cumulative_growth": [
                        round(v / b - 1, 5) for v, b in zip(r, base)
                    ],
                }
            )
        return by_year

    def decile_block(basis):
        by_year = group_years(basis, "decile")
        return {
            "cumulative_growth_to_end": by_year[-1]["cumulative_growth"],
            "by_year": by_year,
            # Quintiles' own medians (not two deciles' averaged), each year
            "quintile_by_year": group_years(basis, "quintile"),
        }

    def split_series(key):
        base = real(
            P(PRICE_BASE_YEAR)["non_pensioner_split_ahc"][key],
            PRICE_BASE_YEAR,
            "ahc",
        )
        out = []
        for y in years:
            v = real(P(y)["non_pensioner_split_ahc"][key], y, "ahc")
            out.append(
                {
                    "year": fy(y),
                    "real_mean": round(v),
                    "cumulative_growth": round(v / base - 1, 5),
                }
            )
        return out

    ahc_deciles = decile_block("ahc")
    income_by_decile = {
        "base_year": fy(PRICE_BASE_YEAR),
        "end_year": fy(end),
        "statistic": f"Median equivalised income within each person-weighted income decile, real {fy(PRICE_BASE_YEAR)} prices",
        "deciles": list(range(1, 11)),
        "quintiles": list(range(1, 6)),
        "bases": {
            "bhc": "Before housing costs (deflated by OBR CPI)",
            "ahc": "After housing costs (deflated by CPI excluding housing costs)",
        },
        "bhc": decile_block("bhc"),
        "ahc": ahc_deciles,
        "non_pensioner_split": {
            "basis": "ahc",
            "statistic": f"Mean equivalised AHC income of each half, real {fy(PRICE_BASE_YEAR)} prices",
            "groups": {
                "below_middle": "Non-pensioners below the non-pensioner median",
                "above_middle": "Non-pensioners at or above the non-pensioner median",
            },
            "series": {
                "below_middle": split_series("below_middle_mean"),
                "above_middle": split_series("above_middle_mean"),
            },
        },
        "comparator": "Resolution Foundation, Living Standards Outlook 2026 (February 2026)",
        "notes": [
            "Deciles are re-ranked each year, so growth compares the same position in the distribution, not the same people.",
            decile_note(ahc_deciles["cumulative_growth_to_end"]),
            "The halves are split at the non-pensioner median and show means, not medians.",
        ],
    }

    # 1b. Growth across the distribution: each income group's own median,
    # every year, for all people and for non-pensioners, BHC and AHC, with
    # the year-on-year change. A grouping is published only if every cell
    # (each group, population, basis and year read) has at least
    # MIN_HOUSEHOLDS unweighted households, the floor poverty_by_group uses.
    income_growth_by_group = growth_by_group(proj, years, real)

    # 2. Child poverty by family.
    fam_groups = {
        "all": "All children",
        "one_child": "One child in family",
        "two_children": "Two children in family",
        "three_plus_children": "Three or more children in family",
        "lone_parent": "Lone-parent family",
        "couple": "Couple family",
    }
    cp = lambda y: P(y)["child_poverty_by_family"]  # noqa: E731
    child_poverty_by_family = {
        "measures": {
            "relative_ahc": "Relative (AHC)",
            "absolute_ahc": "Absolute (AHC)",
        },
        "groups": fam_groups,
        "projection": {
            m: {
                g: [
                    {"year": fy(y), "rate": round(cp(y)[m][g], 5)}
                    for y in years
                ]
                for g in fam_groups
            }
            for m in ("relative_ahc", "absolute_ahc")
        },
        "children_millions": {
            g: [
                {
                    "year": fy(y),
                    "value": round(cp(y)["children_millions"][g], 3),
                }
                for y in years
            ]
            for g in fam_groups
        },
        "unweighted_children": cp(years[0])["unweighted_children"],
        "notes": [],
    }

    # 3. Inequality.
    ineq_measures = {"gini": "Gini coefficient", "p90_p10": "90:10 ratio"}
    inequality = {
        "measures": ineq_measures,
        "bases": {"bhc": "Before housing costs", "ahc": "After housing costs"},
        "outturn": {
            m: {b: hbai["inequality"][b][m] for b in ("bhc", "ahc")}
            for m in ineq_measures
        },
        "projection": {
            m: {
                b: [
                    {
                        "year": fy(y),
                        "value": round(P(y)[f"inequality_{b}"][m], 5),
                    }
                    for y in join_years
                ]
                for b in ("bhc", "ahc")
            }
            for m in ineq_measures
        },
        "notes": [
            "Outturn is HBAI Table 1.2b: Gini, and the ratio of top to bottom quintile medians, which is the 90th over the 10th percentile.",
            inequality_note(P(2024), hbai),
        ],
    }

    # 4. Very deep poverty (JRF-style), from the model's own AHC median.
    deep = lambda y: P(y)["deep_poverty_ahc"]  # noqa: E731
    deep_poverty = {
        "measures": {
            "below_40pc_median_ahc": "Very deep poverty: below 40% of median income (AHC)",
            "below_50pc_median_ahc": "Below 50% of median income (AHC)",
        },
        "projection": {
            f"below_{k}pc_median_ahc": [
                {
                    "year": fy(y),
                    "rate": round(deep(y)[f"below_{k}pc"]["rate"], 5),
                    "people_millions": round(
                        deep(y)[f"below_{k}pc"]["people_millions"], 3
                    ),
                    "threshold_annual": round(deep(y)["median"] * k / 100),
                }
                for y in years
            ]
            for k in (40, 50)
        },
        "notes": [
            "Lines are 40% and 50% of the model's own median equivalised AHC income each year.",
            "Not the model's in_deep_poverty_ahc flag, which is half the absolute poverty line.",
            deep_poverty_note(P(PROJECTION_START), PROJECTION_START),
        ],
    }

    # 5. Poverty and median income by group, with small-cell suppression.
    labels = {
        "tenure": (
            "Tenure",
            {
                "owned_outright": "Owned outright",
                "mortgage": "Owned with a mortgage",
                "social_rent": "Social renter",
                "private_rent": "Private renter",
            },
        ),
        "family_type": (
            "Family type",
            {
                "lone_parent": "Lone parent",
                "couple_with_children": "Couple with children",
                "single_no_children": "Single, no children",
                "couple_no_children": "Couple, no children",
                "pensioner": "Pensioner family",
            },
        ),
        "region": (
            "Region",
            {
                "NORTH_EAST": "North East",
                "NORTH_WEST": "North West",
                "YORKSHIRE": "Yorkshire and the Humber",
                "EAST_MIDLANDS": "East Midlands",
                "WEST_MIDLANDS": "West Midlands",
                "EAST_OF_ENGLAND": "East of England",
                "LONDON": "London",
                "SOUTH_EAST": "South East",
                "SOUTH_WEST": "South West",
                "WALES": "Wales",
                "SCOTLAND": "Scotland",
                "NORTHERN_IRELAND": "Northern Ireland",
            },
        ),
    }
    poverty_years = [y for y in years if "poverty_by_group" in P(y)]
    suppressed = []
    breakdowns = {}
    for name, (label, glabels) in labels.items():
        cells = {}
        for g in glabels:
            cells[g] = {}
            for y in poverty_years:
                c = P(y)["poverty_by_group"][name][g]
                small = c["unweighted_households"] < MIN_HOUSEHOLDS
                if small:
                    suppressed.append(f"{name}/{g}/{fy(y)}")
                cells[g][fy(y)] = {
                    **{
                        m: None if small else round(c[m], 5)
                        for m in GROUP_POVERTY_MEASURES
                    },
                    "median_equivalised_income_bhc": (
                        None
                        if small
                        else {
                            "nominal": round(
                                c["median_equivalised_income_bhc"]
                            ),
                            "real": round(
                                real(
                                    c["median_equivalised_income_bhc"],
                                    y,
                                    "bhc",
                                )
                            ),
                        }
                    ),
                    "people_millions": (
                        None if small else round(c["people_millions"], 3)
                    ),
                    "unweighted_households": c["unweighted_households"],
                    "suppressed": small,
                }
        breakdowns[name] = {"label": label, "groups": glabels, "cells": cells}
    poverty_by_group = {
        "years": [fy(y) for y in poverty_years],
        "measures": {
            "relative_ahc": "Relative poverty (AHC)",
            "absolute_ahc": "Absolute poverty (AHC)",
            "relative_bhc": "Relative poverty (BHC)",
            "absolute_bhc": "Absolute poverty (BHC)",
            "median_equivalised_income_bhc": f"Median equivalised income (BHC), {EQ_UNIT}",
        },
        "min_unweighted_households": MIN_HOUSEHOLDS,
        "breakdowns": breakdowns,
        "notes": [
            f"Cells with fewer than {MIN_HOUSEHOLDS} unweighted households are suppressed (null); "
            + (
                f"suppressed: {', '.join(suppressed)}."
                if suppressed
                else "none are at this sample size."
            ),
            "Family type is at benefit-unit level; a pensioner family is any benefit unit with someone at or above State Pension age.",
            "Region: model estimates, not validated against official regional figures (Northern Ireland is far above DfC's own figure); not shown on the page.",
        ],
    }

    # 6. OBR RHDI per person.
    obr_rhdi = {
        "label": "OBR real household disposable income per person",
        "unit": "£ per person per year, 2023 prices (national accounts)",
        "basis": "Fiscal year",
        "source": f"{rhdi['source']['release']}, {rhdi['source']['table']}",
        "definition": rhdi["source"]["definition"],
        "url": rhdi["source"]["url"],
        "file_sha256": rhdi["source"]["file_sha256"],
        "series": [
            {
                "year": r["year"],
                "value": r["gbp_2023_prices"],
                "index_2008q1_100": r["index_2008q1_100"],
                "growth": r["growth"],
                "type": r["type"],
                "source_row": r["cell_row"],
            }
            for r in rhdi["series"]
        ],
        "notes": [
            "OBR's national-accounts measure, including non-profit institutions and imputed income; not comparable in level to the survey-based HBAI series.",
            "2025-26 onwards are OBR March 2026 forecast years.",
        ],
    }

    # 2024-25 validation: model vs HBAI outturn.
    v = P(2024)

    def hb(series, yr="2024-25"):
        return next(r for r in series if r["year"] == yr)

    validation = {
        "year": "2024-25",
        "median_equivalised_income_weekly": {
            "bhc": {
                "model": round(v["median_equivalised_income_bhc"] / 52),
                "hbai": round(
                    hb(hbai["income"]["median_equivalised_income"])[
                        "weekly_2024_25_prices"
                    ]
                ),
            },
            "ahc": {
                "model": round(v["median_equivalised_income_ahc"] / 52),
                "hbai": round(
                    hb(hbai["income"]["median_equivalised_income_ahc"])[
                        "weekly_2024_25_prices"
                    ]
                ),
            },
        },
        "relative_ahc": {
            g: {
                "model": round(v["poverty"]["relative_ahc"][g], 4),
                "hbai": hb(hbai["poverty"]["relative_ahc"][g])["rate"],
            }
            for g in groups
        },
        "gini": {
            b: {
                "model": round(v[f"inequality_{b}"]["gini"], 4),
                "hbai": hb(hbai["inequality"][b]["gini"])["value"],
            }
            for b in ("bhc", "ahc")
        },
        "p90_p10": {
            b: {
                "model": round(v[f"inequality_{b}"]["p90_p10"], 3),
                "hbai": hb(hbai["inequality"][b]["p90_p10"])["value"],
            }
            for b in ("bhc", "ahc")
        },
        # Admin comparator not added: FYE2025 UC spending (£67.4bn) still needs a check that it covers the same countries.
        "universal_credit_bn": {
            "model": round(v["diagnostics"]["universal_credit_bn"], 1)
        },
    }

    # The pre-Budget series are the OBR March 2026 forecast, as
    # policyengine-uk ships it: its own parameters, not the October forecast
    # the projections run on (forecast_parameters), or the Forecast changes
    # sub-tab would draw October twice. check_pre_is_march holds them to the
    # committed March 2026 EFO tables below.
    obr = system.parameters.gov.economic_assumptions.yoy_growth.obr
    sections = []
    for title, series in SECTIONS:
        out_series = []
        for key, label, leaf in series:
            node = getattr(obr, leaf)
            pre = [
                {"year": str(y), "value": round(float(node(f"{y}-01-01")), 4)}
                for y in FORECAST_YEARS
            ]
            out_series.append(
                {
                    "key": key,
                    "label": label,
                    "parameter": f"gov.economic_assumptions.yoy_growth.obr.{leaf}",
                    "source": SOURCES[leaf],
                    "pre": pre,
                    "post": [dict(p) for p in pre],
                }
            )
        sections.append({"title": title, "series": out_series})

    outlook = {
        "meta": {
            "generated_at": generated_at
            or datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "policyengine": pe_version,
            "policyengine_uk": pe_uk,
            "dataset": {
                "name": dataset["name"],
                "tag": dataset["tag"],
                "sha256": dataset["sha256"],
                "hf_repo": dataset["hf_repo"],
            },
            "real_price_base": fy(PRICE_BASE_YEAR),
            "headline_start_year": fy(HEADLINE_START_YEAR),
            "headline_end_year": fy(HEADLINE_END_YEAR),
            "headline_end_year_note": headline_end_year_note(pe_uk),
            "uc_health_element_extension": uc_fix,
            "cpi_ahc_note": cpi_ahc_note(
                living["median_equivalised_income_ahc"], HEADLINE_END_YEAR
            ),
            "units": {m: EQ_UNIT for m in income_metrics},
            "deflator": (
                "OBR CPI index (gov.economic_assumptions.indices.obr.consumer_price_index) for BHC incomes "
                "and CPI after housing costs (gov.economic_assumptions.indices.obr.consumer_price_index_ahc) "
                f"for AHC incomes, both from policyengine-uk {pe_uk}; calendar-year value Y applied to fiscal "
                f"year Y-(Y+1), rebased to {fy(PRICE_BASE_YEAR)} = 1"
            ),
            "outturn_source": (
                f"{hbai['source']['release']}, tables {hbai['source']['tables']}: "
                f"{hbai['source']['url']}"
            ),
            "outturn_file_sha256": hbai["source"]["file_sha256"],
            "method": {
                "mean_equivalised_income": "Person-weighted mean of equiv_hbai_household_net_income (BHC, modified OECD scale, household weight x household_count_people), as in HBAI",
                "median_equivalised_income": "Person-weighted median of equiv_hbai_household_net_income (BHC), as in HBAI",
                "mean_equivalised_income_ahc": "Person-weighted mean of equiv_hbai_household_net_income_ahc, as in HBAI",
                "median_equivalised_income_ahc": "Person-weighted median of equiv_hbai_household_net_income_ahc, as in HBAI",
                "income_outturn": f"HBAI Table 1.2b (£ per week in 2024/25 prices) x 52, rebased to {fy(PRICE_BASE_YEAR)} prices; BHC cash values recovered with the OBR CPI index; AHC outturn is real only (nominal null)",
                "poverty": "Person-weighted share of people in households with in_poverty_bhc / in_poverty_ahc (absolute, 60% of FYE 2025 median held in real terms) and in_relative_poverty_bhc / in_relative_poverty_ahc (60% of contemporary median)",
                "groups": "hbai_person_type: HBAI dependent children (is_hbai_dependent_child), working-age adults below State Pension age, and pensioners at or above it; each person in exactly one group",
                "income_by_decile": "Person-weighted deciles of equiv_hbai_household_net_income (BHC) and _ahc (AHC), re-ranked each year; decile medians deflated by CPI (BHC) or CPI-AHC (AHC)",
                "non_pensioner_split": "People in benefit units with no hbai_person_type PENSIONER member, split at their own median AHC income; mean AHC income of each half",
                "child_poverty_by_family": "Children (hbai_person_type CHILD) by the count of is_hbai_dependent_child in their benefit unit and by adults in it (members who are not dependent children: 1 = lone parent, 2+ = couple)",
                "inequality": "Person-weighted Gini (incomes as computed, negatives kept) and p90/p10 of equivalised BHC and AHC income",
                "deep_poverty": "Share of people with equivalised AHC income below 40% and 50% of the person-weighted median AHC income in the same year",
                "poverty_by_group": "tenure_type (council and housing association combined as social rent), benefit-unit family type, and region; unweighted counts are distinct households in the cell",
                "obr_rhdi": f"{rhdi['source']['table']} ({rhdi['source']['definition']})",
                "source_repos": [
                    "PolicyEngine/scottish-budget-dashboard scripts/generate_scotland_baseline.py",
                    "PolicyEngine/uk-spring-statement-2026 src/spring_statement_data/reforms.py",
                ],
            },
            "comparators": {
                "income_by_decile": "Resolution Foundation, Living Standards Outlook 2026 (February 2026): https://www.resolutionfoundation.org/publications/living-standards-outlook-2026/",
                "child_poverty": "DWP, Low income poverty projections for children, FYE 2026 to FYE 2031 (July 2026)",
                "deep_poverty": "JRF, UK Poverty 2026 (January 2026)",
            },
            "validation_2024_25": validation,
            "notes": notes(validation),
            "caveats": CAVEATS,
        },
        "living_standards": {
            "metrics": {
                "mean_equivalised_income": "Mean equivalised income (BHC)",
                "median_equivalised_income": "Median equivalised income (BHC)",
                "mean_equivalised_income_ahc": "Mean equivalised income (AHC)",
                "median_equivalised_income_ahc": "Median equivalised income (AHC)",
            },
            "outturn": income_outturn,
            "projection": living,
        },
        "poverty": {
            "measures": {
                "absolute_bhc": "Absolute (BHC)",
                "absolute_ahc": "Absolute (AHC)",
                "relative_bhc": "Relative (BHC)",
                "relative_ahc": "Relative (AHC)",
            },
            "groups": {
                "all": "All people",
                "children": "Children",
                "working_age": "Working-age adults",
                "pensioners": "Pensioners",
            },
            "outturn": hbai["poverty"],
            "projection": poverty_proj,
            "notes": [absolute_poverty_note(validation)],
        },
        "forecast": {
            "pre_label": "OBR March 2026 (pre-Budget)",
            "basis": "Calendar year, growth in annual average",
            "post_label": "Budget forecast",
            "post_published": POST_PUBLISHED,
            "headline": ["cpi", "rpi", "earnings"],
            "sections": sections,
        },
        "income_by_decile": income_by_decile,
        "child_poverty_by_family": child_poverty_by_family,
        "inequality": inequality,
        "deep_poverty": deep_poverty,
        "poverty_by_group": poverty_by_group,
        "obr_rhdi": obr_rhdi,
        "income_growth_by_group": income_growth_by_group,
    }
    from uk_budget_data.living_standards import INPUTS_DIR
    from uk_budget_data.living_standards.forecast import check_pre_is_march
    from uk_budget_data.living_standards.obr import EFO_FILE_NAME

    check_pre_is_march(outlook["forecast"], INPUTS_DIR / EFO_FILE_NAME)
    for note in outlook["meta"]["notes"] + CAVEATS:
        assert len(note) <= 160, note
    return outlook


GROWTH_POPULATIONS = {
    "all": "All people",
    "non_pensioners": "Non-pensioners: people in families (benefit units) with no one at or above State Pension age",
}


def growth_by_group(proj: dict, years: list[int], real) -> dict:
    """``income_growth_by_group`` (docs/DATA_CONTRACT.md) from the
    projections' ``income_groups``: real medians, the change on the year
    before and the change since the base year, for every grouping whose
    cells all clear the household floor."""
    from uk_budget_data.living_standards.projections import INCOME_GROUPINGS

    P = lambda y: proj[str(y)]["income_groups"]  # noqa: E731
    read_years = [years[0] - 1, *years]
    series = {}
    smallest = {}
    for pop in GROWTH_POPULATIONS:
        series[pop] = {}
        for basis in ("bhc", "ahc"):
            series[pop][basis] = {}
            for name in INCOME_GROUPINGS:
                cells = [P(y)[pop][basis][name] for y in read_years]
                fewest = min(min(c["unweighted_households"]) for c in cells)
                smallest[name] = min(smallest.get(name, fewest), fewest)
                med = {
                    y: [real(v, y, basis) for v in c["medians"]]
                    for y, c in zip(read_years, cells)
                }
                base = med[years[0]]
                series[pop][basis][name] = {
                    "min_unweighted_households": fewest,
                    "by_year": [
                        {
                            "year": fy(y),
                            "real_median": [round(v) for v in med[y]],
                            "annual_growth": [
                                round(v / p - 1, 5)
                                for v, p in zip(med[y], med[y - 1])
                            ],
                            "cumulative_growth": [
                                round(v / b - 1, 5)
                                for v, b in zip(med[y], base)
                            ],
                        }
                        for y in years
                    ],
                }
    published = [n for n in INCOME_GROUPINGS if smallest[n] >= MIN_HOUSEHOLDS]
    withheld = {
        n: f"A cell has {smallest[n]} unweighted households, below the floor of {MIN_HOUSEHOLDS}"
        for n in INCOME_GROUPINGS
        if n not in published
    }
    for pop in series:
        for basis in series[pop]:
            for n in withheld:
                del series[pop][basis][n]
    return {
        "base_year": fy(years[0]),
        "end_year": fy(years[-1]),
        "measure": "median",
        "statistic": f"Median equivalised household income within each person-weighted income group, real {fy(years[0])} prices",
        "bases": {
            "bhc": "Before housing costs (deflated by OBR CPI)",
            "ahc": "After housing costs (deflated by CPI excluding housing costs)",
        },
        "populations": GROWTH_POPULATIONS,
        "groupings": {n: INCOME_GROUPINGS[n] for n in published},
        "min_unweighted_households": MIN_HOUSEHOLDS,
        "withheld_groupings": withheld,
        "method": (
            "Each population is ranked on its own equivalised income (BHC on BHC income, AHC on AHC income), re-ranked each year, "
            "and cut into person-weighted groups; each group's median is deflated by CPI (BHC) or CPI-AHC (AHC). "
            f"annual_growth is the change on the year before (for {fy(years[0])}, on {fy(years[0] - 1)}); "
            f"cumulative_growth the change since {fy(years[0])}."
        ),
        "series": series,
    }


def outlook_text(outlook: dict) -> str:
    """The file's bytes: two-space JSON and a final newline."""
    return json.dumps(outlook, indent=2, ensure_ascii=True) + "\n"


EQ_UNIT = "£ a year, adjusted for household size (shown for a couple with no children)"

# Projection caveats and baseline gaps found in policyengine-uk 2.130.1 (issue #1)
# and unchanged in 2.132.6, shown as their own list on the page.
CAVEATS = [
    "Ages and benefit take-up are held fixed, so the State Pension age rise to 67 removes State Pension from 66-year-olds with no work response.",
    "The population is uprated uniformly, so its age structure stays as in 2025.",
    "Results for small groups are noisy: calibration roughly halves the effective sample, so family-size figures are approximate.",
    "The September 2026 free school meals expansion to all Universal Credit families in England is not modelled, so child poverty from 2026-27 is a little high.",
    "The Universal Credit health element is assigned too widely (through disabled children, and twice to some couples), so child poverty is a little low.",
    "The above-inflation rises in the Universal Credit standard allowance from 2027-28 are missing, so UC is about £0.6bn too low by 2029-30.",
]


def notes(validation: dict) -> list[str]:
    """meta.notes: one plain sentence each, at most 160 characters."""
    out = [
        "Model projections; not yet validated against outturn.",
        "Income outturn is HBAI, published in real terms; BHC cash values are recovered with OBR CPI, and AHC outturn is shown in real terms only.",
        "Poverty and inequality outturn is the HBAI admin-linked series, which starts in 2021-22.",
        (
            "The 2024-25 model point uses the weights solved for 2025, scaled for population, so it carries 2025 "
            f"composition and caseloads (UC £{validation['universal_credit_bn']['model']:.0f}bn)."
        ),
        "OBR series are calendar years; CPI after housing costs and social rent are PolicyEngine derivations, not OBR forecasts.",
    ]
    if not POST_PUBLISHED:
        out.append(
            "Until a later OBR forecast is loaded, the post series repeat the March 2026 forecast."
        )
    return out


def absolute_poverty_note(validation: dict) -> str:
    """Poverty card note (issue #1), with the median gap measured on this file."""
    med = validation["median_equivalised_income_weekly"]["bhc"]
    gap = (med["model"] / med["hbai"] - 1) * 100
    return (
        "The absolute line is the official one: 60% of the 2024-25 HBAI median (£431.69 a week before housing costs "
        "for a couple), uprated by CPI. Our 2024-25 incomes are higher than in HBAI at the bottom and middle of the "
        f"distribution (median about {gap:.0f}% higher), so absolute and relative poverty both sit below official "
        "figures. On the same survey records with the survey's own weights the model reproduces the HBAI median and "
        "poverty rates; the difference comes from reweighting the data to 2025 administrative totals. Read the "
        "projections as changes from 2024-25."
    )


def inequality_note(v: dict, hbai: dict) -> str:
    def hb(basis, m):
        series = hbai["inequality"][basis][m]
        return next(r for r in series if r["year"] == "2024-25")["value"]

    gap = {
        b: (hb(b, "gini") - v[f"inequality_{b}"]["gini"]) * 100
        for b in ("bhc", "ahc")
    }
    ratio = {
        b: f"{v[f'inequality_{b}']['p90_p10']:.2f} against {hb(b, 'p90_p10'):.2f}"
        for b in ("bhc", "ahc")
    }
    return (
        "Read the projection as a change, not a level. "
        f"Our Gini is about {gap['bhc']:.1f} points below official figures in 2024-25 before housing costs "
        f"({gap['ahc']:.1f} after). Our data have fewer very low incomes, and we treat very high incomes differently "
        "from the SPI-based adjustment in HBAI. The 90:10 ratio is low "
        f"({ratio['bhc']} before housing costs, {ratio['ahc']} after) because the bottom tenth is too high, "
        "not because the top is too low."
    )


def deep_poverty_note(v: dict, year: int) -> str:
    d = v["deep_poverty_ahc"]["below_40pc"]
    # JRF, UK Poverty 2026: about 10% (6.8m) in very deep poverty in 2023-24, older HBAI series.
    return (
        f"Our very deep poverty ({d['rate'] * 100:.1f}%, {d['people_millions']:.1f} million in {fy(year)}) is "
        "below published estimates on the older survey series, so read it as a change, not a level."
    )


def decile_note(ahc_growth: list[float]) -> str:
    """Bottom AHC decile caveat (issue #1). The card's summary states the change, so this note does not."""
    noisy = "The lowest tenth's median after housing costs is the 5th percentile, a noisy point"
    if ahc_growth[0] < 0 and abs(ahc_growth[0]) > max(
        abs(g) for g in ahc_growth[1:]
    ):
        # The issue #1 decomposition ran on a 2025-26 base to 2029-30; the
        # 2027-28 base window keeps falling after 2029-30, which it did not
        # cover, so the note names its drivers only for the years it covered.
        return (
            f"{noisy}, and its fall sits in the bottom 5%. To 2029-30 the main drivers were the State Pension age rise "
            "to 67 on a dataset whose ages are held fixed and Local Housing Allowance frozen beyond 2026-27; later "
            "years are not decomposed."
        )
    return f"{noisy}."


# CPI after housing costs growth (calendar year) in PolicyEngine/policyengine-uk#2531,
# merged 23 October 2026 after the 2.132.6 release this engine pins.
CPI_AHC_2531 = {
    2022: 0.0927,
    2023: 0.0826,
    2024: 0.0327,
    2025: 0.0265,
    2026: 0.0217,
    2027: 0.0188,
    2028: 0.0194,
    2029: 0.0194,
    2030: 0.0192,
    # #2531 states no 2031 value, so the series holds its 2030 rate, as
    # policyengine-uk does for a growth series past its last value.
    2031: 0.0192,
}


def cpi_ahc_2531_effect(growth: float, start: int, end: int) -> float:
    """Change in a real AHC growth figure (fraction) from start to end, in points, under #2531's index."""
    pinned = (
        system.parameters.gov.economic_assumptions.yoy_growth.obr.consumer_price_index_ahc
    )
    ratio = 1.0
    for y in range(start + 1, end + 1):
        ratio *= (1 + float(pinned(f"{y}-01-01"))) / (1 + CPI_AHC_2531[y])
    return (1 + growth) * (ratio - 1) * 100


def cpi_ahc_note(median_ahc: list[dict], end_year: int) -> str:
    """CPI after housing costs caveat. The growth itself is stated in the card's summary, not here."""

    def at(y):
        return next(r["real"] for r in median_ahc if r["year"] == fy(y))

    g = at(end_year) / at(HEADLINE_START_YEAR) - 1
    effect = cpi_ahc_2531_effect(g, HEADLINE_START_YEAR, end_year)
    size = (
        "by less than 0.1 points"
        if abs(effect) < 0.1
        else f"by about {abs(effect):.1f} points"
    )
    direction = "lower" if effect < 0 else "higher"
    return (
        "CPI after housing costs, used for real incomes after housing costs, is a PolicyEngine derivation, not an "
        f"OBR forecast. With the corrected index in policyengine-uk#2531, real growth after housing costs from "
        f"{fy(HEADLINE_START_YEAR)} to {fy(end_year)} would be {direction} {size}, for the median and every "
        "decile. No poverty rate uses it."
    )
