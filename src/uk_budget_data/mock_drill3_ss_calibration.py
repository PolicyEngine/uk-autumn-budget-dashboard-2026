"""MOCK drill 3 measure 20 data work: salary-sacrifice relief allocation.

EXPERIMENTAL, unvalidated under this engine. Everything here supports a
PolicyEngine rehearsal (MOCK DATA); fixture results are diagnostic only and
must never be published as national figures.

Pure-Python, bracket-by-bracket allocation of the income tax relief on a
pension salary sacrifice, using the Annex A 2026-27 schedules:

* Personal Allowance £12,570, tapered by £1 per £2 of adjusted net income
  above £100,000 (fully withdrawn at £125,140).
* rUK bands on taxable income: 20% to £37,700, 40% to £125,140, 45% above.
* Scotland bands on taxable income: 19% to £3,967, 20% to £16,956, 21% to
  £31,092, 42% to £62,430, 45% to £125,140, 48% above.

Relief = tax(contractual salary) - tax(cash salary), with only earned income
present (unrelated tax charges are outside this diagnostic). Gross income is
walked from the cash salary up to the contractual salary in segments on which
tax is linear. Segment breakpoints are the PA-taper start/end (£100,000 and
£125,140 gross) and the gross incomes at which taxable income reaches each
band edge. Each segment's tax difference is allocated to the band that
contains its taxable income.

PA-taper convention: inside the taper zone each £1 of gross income adds £1.50
of taxable income, so the effective marginal rate is 1.5x the band rate (60%
rUK, 63%/67.5% Scotland). The extra relief from restoring Personal Allowance
is allocated to the band where the taxable income sits while the taper
operates, i.e. the bracket where it occurs (rUK and Scottish higher in
practice; Scottish advanced is grouped as higher). Categories therefore sum
exactly to the earned-income tax difference.

Grouping: Scottish starter/basic/intermediate -> basic; higher/advanced ->
higher; top -> additional. rUK basic/higher/additional map one-to-one.

NICs (separate quantities, uncapped 2026-27 fixture baseline): employee Class
1 relief at 8% on the sacrificed slice between £12,570 and £50,270 and 2%
above; employer relief at 15% on the slice above £5,000.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

PA = 12_570.0
PA_TAPER_START = 100_000.0
PA_TAPER_END = PA_TAPER_START + 2 * PA  # 125,140

# (upper edge on taxable income, rate, category)
RUK_BANDS = [
    (37_700.0, 0.20, "basic"),
    (125_140.0, 0.40, "higher"),
    (np.inf, 0.45, "additional"),
]
SCOTLAND_BANDS = [
    (3_967.0, 0.19, "basic"),  # starter
    (16_956.0, 0.20, "basic"),  # basic
    (31_092.0, 0.21, "basic"),  # intermediate
    (62_430.0, 0.42, "higher"),  # higher
    (125_140.0, 0.45, "higher"),  # advanced
    (np.inf, 0.48, "additional"),  # top
]
CATEGORIES = ("basic", "higher", "additional")

EE_PT, EE_UEL, EE_MAIN, EE_ADD = 12_570.0, 50_270.0, 0.08, 0.02
ER_ST, ER_RATE = 5_000.0, 0.15


def bands_for(nation: str):
    return SCOTLAND_BANDS if nation.strip().lower() == "scotland" else RUK_BANDS


def personal_allowance(gross: float) -> float:
    return max(0.0, PA - max(0.0, gross - PA_TAPER_START) / 2)


def taxable_income(gross: float) -> float:
    return max(0.0, gross - personal_allowance(gross))


def gross_for_taxable(t: float) -> float:
    """Inverse of taxable_income for t > 0 (monotonic piecewise linear)."""
    if t <= PA_TAPER_START - PA:
        return t + PA
    if t <= PA_TAPER_END:
        # taxable = g - (PA - (g - 100k)/2) = 1.5g - (PA + 100k/2)
        return (t + PA + PA_TAPER_START / 2) / 1.5
    return t


def income_tax(gross: float, nation: str) -> float:
    t = taxable_income(gross)
    tax, lower = 0.0, 0.0
    for upper, rate, _ in bands_for(nation):
        if t > lower:
            tax += (min(t, upper) - lower) * rate
        lower = upper
    return tax


def _band_of_taxable(t: float, nation: str) -> str:
    for upper, _, cat in bands_for(nation):
        if t <= upper:
            return cat
    return "additional"


@dataclass
class Relief:
    basic: float
    higher: float
    additional: float
    total: float
    employee_ni: float
    employer_ni: float


def allocate_relief(contractual: float, sacrifice: float, nation: str) -> Relief:
    cash = contractual - sacrifice
    if sacrifice <= 0:
        return Relief(0.0, 0.0, 0.0, 0.0, 0.0, 0.0)
    points = {cash, contractual, PA, PA_TAPER_START, PA_TAPER_END}
    for upper, _, _ in bands_for(nation):
        if np.isfinite(upper):
            points.add(gross_for_taxable(upper))
    pts = sorted(p for p in points if cash <= p <= contractual)
    out = dict.fromkeys(CATEGORIES, 0.0)
    for a, b in zip(pts[:-1], pts[1:]):
        if b <= a:
            continue
        dt = income_tax(b, nation) - income_tax(a, nation)
        if dt == 0:
            continue
        out[_band_of_taxable(taxable_income((a + b) / 2), nation)] += dt
    total = income_tax(contractual, nation) - income_tax(cash, nation)
    return Relief(
        out["basic"],
        out["higher"],
        out["additional"],
        total,
        employee_ni_relief(contractual, sacrifice),
        employer_ni_relief(contractual, sacrifice),
    )


def _slice(lo: float, hi: float, a: float, b: float) -> float:
    return max(0.0, min(hi, b) - max(lo, a))


def employee_ni_relief(contractual: float, sacrifice: float) -> float:
    cash = contractual - sacrifice
    return EE_MAIN * _slice(EE_PT, EE_UEL, cash, contractual) + EE_ADD * _slice(
        EE_UEL, np.inf, cash, contractual
    )


def employer_ni_relief(contractual: float, sacrifice: float) -> float:
    cash = contractual - sacrifice
    return ER_RATE * _slice(ER_ST, np.inf, cash, contractual)


def allocate_arrays(contractual, sacrifice, nations):
    """Vectorised-by-loop wrapper; returns dict of numpy arrays."""
    rows = [
        allocate_relief(float(c), float(s), n)
        for c, s, n in zip(contractual, sacrifice, nations)
    ]
    keys = ("basic", "higher", "additional", "total", "employee_ni", "employer_ni")
    return {k: np.array([getattr(r, k) for r in rows]) for k in keys}


def kish_ess(w) -> float:
    w = np.asarray(w, dtype=float)
    return float(w.sum() ** 2 / (w**2).sum())
