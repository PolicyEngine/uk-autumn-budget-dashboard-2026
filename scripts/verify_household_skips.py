"""Every skip rule (household_impact.provably_unaffected) against the full
run: for many generated households and every policy year, the split by
policy with skips equals it without. Heavy: about 45 s per household-year
per process.

    uv run python scripts/verify_household_skips.py <households> <processes>
"""

import json
import random
import sys
import time
from concurrent.futures import ProcessPoolExecutor


def case(args):
    import os

    os.environ.pop("HOUSEHOLD_RUNNER", None)
    from uk_budget_data import household_impact as hi

    kw, year = args
    kids = tuple(hi.Child(age=a) for a in kw.pop("children"))
    A = hi.HouseholdAnswers(children=kids, **kw)
    ids = hi.measure_ids()
    hi.clear_runs()
    full = hi.calculate_household_impact(
        A, ids, year, include=("by_policy",), skip_unaffected=False
    )
    skipped_ids = [i for i in ids if hi.provably_unaffected(i, A, year)]
    hi.clear_runs()
    fast = hi.calculate_household_impact(
        A, ids, year, include=("by_policy",), skip_unaffected=True
    )
    for d in (full, fast):
        d.pop("engine", None)
    bad = []
    if full != fast:
        fm = {m["id"]: m for m in full["by_policy"]["measures"]}
        for m in fast["by_policy"]["measures"]:
            if fm[m["id"]] != m:
                bad.append((m["id"], fm[m["id"]]["change"], m["change"]))
        if not bad:
            bad.append(("other", "", ""))
    return year, skipped_ids, bad


def gen(n, seed=2026):
    from uk_budget_data import household_impact as hi

    r = random.Random(seed)
    out = []
    plans = list(hi.STUDENT_LOAN_PLANS)
    regions = list(hi.REGIONS)
    tenures = list(hi.TENURES)
    for i in range(n):
        partner = r.random() < 0.5
        age = r.choice([19, 23, 30, 45, 58, 64, 66, 67, 70, 82])
        kw = dict(
            age=age,
            employment_income=(
                r.choice([0, 8000, 18000, 30000, 52000, 99000, 125000, 160000])
                if age < 75
                else 0
            ),
            student_loan_plan=r.choice(plans),
            has_partner=partner,
            partner_age=r.choice([22, 35, 60, 66, 68, 75]) if partner else 40,
            partner_employment_income=(
                r.choice([0, 15000, 40000]) if partner else 0
            ),
            partner_student_loan_plan=r.choice(plans) if partner else "NONE",
            children=[
                r.choice([1, 4, 9, 14, 17])
                for _ in range(r.choice([0, 0, 1, 2, 3]))
            ],
            region=r.choice(regions),
            claims_universal_credit=r.random() < 0.4,
            tenure=r.choice(tenures),
            monthly_rent=r.choice([0, 700, 1200]),
            petrol_spending=r.choice([0, 0, 600, 2000]),
            diesel_spending=r.choice([0, 0, 400]),
            electricity_spending=r.choice([0, 1040, 1800]),
            private_pension_income=r.choice([0, 0, 8000, 25000]),
            dividend_income=r.choice([0, 0, 2000]),
            savings_interest_income=r.choice([0, 0, 1500]),
            cash_isa_subscriptions=r.choice([0, 0, 12000, 20000]),
        )
        out.append(kw)
    return out


if __name__ == "__main__":
    n = int(sys.argv[1])
    procs = int(sys.argv[2])
    from uk_budget_data.budget_years import POLICY_YEARS

    cases = [(dict(kw), y) for kw in gen(n) for y in POLICY_YEARS]
    t = time.perf_counter()
    skipped = 0
    total = 0
    failures = []
    with ProcessPoolExecutor(procs) as ex:
        for year, s_ids, bad in ex.map(case, cases):
            skipped += len(s_ids)
            total += 9
            if bad:
                failures.append((year, bad))
    print(
        json.dumps(
            {
                "households": n,
                "cases": len(cases),
                "per_policy_runs": total,
                "skipped": skipped,
                "failures": failures[:10],
                "n_failures": len(failures),
                "seconds": round(time.perf_counter() - t),
            }
        )
    )
