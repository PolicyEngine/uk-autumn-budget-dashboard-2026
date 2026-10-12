"""MOCK drill 3 measure 20: hand-computed salary-sacrifice relief allocation.

Fixture records are diagnostic only (MOCK DATA, never national figures).
"""

import pytest

from uk_budget_data.mock_drill3_ss_calibration import (
    allocate_relief,
    gross_for_taxable,
    taxable_income,
)

# (id, nation, contractual, sacrifice, basic, higher, additional, ee_ni, er_ni)
# Hand workings (taxable = gross - PA; PA £12,570 below £100k):
# S1 rUK 30,000->28,000: taxable 17,430->15,430, basic 2,000x20% = 400.
# S2 rUK 54,000->50,000: taxable 41,430->37,430. NOT all higher: the higher
#    rate starts at taxable 37,700 (gross 50,270), so higher 3,730x40% =
#    1,492 and basic 270x20% = 54; total 1,546. (The brief's "£1,600 all
#    higher" hint is wrong for a £50,000 cash salary.)
#    Employee NI: UEL 50,270 -> 3,730x2% + 270x8% = 96.20.
# S3 Scot 50,000->46,000: taxable 37,430->33,430, all in higher (42% from
#    31,092): 4,000x42% = 1,680.
# S4 Scot 80,000->68,000: taxable 67,430->55,430. Advanced (45%) above
#    62,430: 5,000x45% = 2,250; higher 7,000x42% = 2,940 -> higher 5,190.
# S5 rUK 150,000->140,000: PA nil both; taxable >125,140: 10,000x45% = 4,500.
# S6 Scot 160,000->150,000: top 48%: 4,800 additional.
# S7 rUK 45,000->40,000: taxable 32,430->27,430 basic: 1,000.
# S8 Scot 46,000->42,000: taxable 33,430->29,430; higher 2,338x42% =
#    981.96, intermediate 1,662x21% = 349.02 (-> basic).
CASES = [
    ("S1", "England", 30_000, 2_000, 400.0, 0.0, 0.0, 160.0, 300.0),
    ("S2", "England", 54_000, 4_000, 54.0, 1_492.0, 0.0, 3_730 * 0.02 + 270 * 0.08, 600.0),
    ("S3", "Scotland", 50_000, 4_000, 0.0, 1_680.0, 0.0, 320.0, 600.0),
    ("S4", "Scotland", 80_000, 12_000, 0.0, 5_190.0, 0.0, 240.0, 1_800.0),
    ("S5", "England", 150_000, 10_000, 0.0, 0.0, 4_500.0, 200.0, 1_500.0),
    ("S6", "Scotland", 160_000, 10_000, 0.0, 0.0, 4_800.0, 200.0, 1_500.0),
    ("S7", "England", 45_000, 5_000, 1_000.0, 0.0, 0.0, 400.0, 750.0),
    ("S8", "Scotland", 46_000, 4_000, 349.02, 981.96, 0.0, 320.0, 600.0),
]


@pytest.mark.parametrize("rid,nation,c,s,b,h,a,ee,er", CASES)
def test_fixture_allocation(rid, nation, c, s, b, h, a, ee, er):
    r = allocate_relief(c, s, nation)
    assert r.basic == pytest.approx(b, abs=0.01)
    assert r.higher == pytest.approx(h, abs=0.01)
    assert r.additional == pytest.approx(a, abs=0.01)
    assert r.basic + r.higher + r.additional == pytest.approx(r.total, abs=1e-6)
    assert r.employee_ni == pytest.approx(ee, abs=0.01)
    assert r.employer_ni == pytest.approx(er, abs=0.01)


def test_pa_taper_relief_goes_to_band_where_it_occurs():
    # rUK 120,000 -> 110,000: both in taper zone; taxable 117,430 -> 102,430
    # all at 40% -> 15,000 x 40% = 6,000 (60% effective), all higher.
    r = allocate_relief(120_000, 10_000, "England")
    assert r.higher == pytest.approx(6_000.0)
    assert r.basic == r.additional == 0
    # Straddling the taper end: 130,000 -> 120,000. 125,140..130,000 is
    # additional at 45% (4,860 x 45% = 2,187); 120,000..125,140 taper zone,
    # taxable 117,430 -> 125,140 at 40% = 3,084, higher.
    r = allocate_relief(130_000, 10_000, "England")
    assert r.additional == pytest.approx(2_187.0)
    assert r.higher == pytest.approx(3_084.0)
    assert r.total == pytest.approx(5_271.0)


def test_inverse_taxable():
    for t in [1.0, 37_700.0, 87_430.0, 100_000.0, 125_140.0, 200_000.0]:
        assert taxable_income(gross_for_taxable(t)) == pytest.approx(t)


def test_fixture_weighted_totals_sum():
    tot = {"basic": 0.0, "higher": 0.0, "additional": 0.0, "total": 0.0}
    for _, n, c, s, *_ in CASES:
        r = allocate_relief(c, s, n)
        for k in tot:
            tot[k] += 100_000 * getattr(r, k)
    assert tot["basic"] + tot["higher"] + tot["additional"] == pytest.approx(tot["total"])
