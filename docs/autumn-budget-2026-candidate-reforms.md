# Autumn Budget 2026: candidate reforms from press and think-tank reporting

Survey as of 2 October 2026. This is **real pre-Budget speculation, not MOCK data**. It is a shortlist of what we should be ready to code on 28 October. Nothing here is announced policy unless marked "announced".

## Context

- **Budget and OBR forecast:** Wednesday 28 October 2026 ([HMT letter to the Treasury Committee, 31 July](https://www.gov.uk/government/publications/chancellor-letter-to-the-treasury-select-committee-tsc-budget-2026-date); [OBR](https://obr.uk/autumn-2026-forecast-date-announced/)). It is John Healey's first Budget as Chancellor under Prime Minister Andy Burnham. Copy must not say "Reeves' Budget".
- **Fiscal space:**
  - Headroom against the stability rule in 2029-30 is now put at roughly £5–14bn, down from about £22–24bn after the March forecast. Estimates: Resolution Foundation (RF) below £8bn; Telegraph £8.5bn; Bloomberg Economics about £12bn; Deutsche Bank £13.8bn.
  - Borrowing in April to August was £8.1bn above forecast.
  - Gilt yields are at multi-decade highs after the Iran war.
  - The press consensus is that the Chancellor needs about £10bn of tax rises or savings.
- **Locks:** no rises to the main income tax rates, employee NI or VAT. Corporation tax is capped at 25%. Stamp duty changes were ruled out on 27 July.
- **Already in the baseline, so not new:**
  - **Enacted at the November 2025 Budget:**
    - Thresholds frozen to April 2031.
    - Dividend, savings and property income tax rates up 2 percentage points.
    - High Value Council Tax Surcharge (HVCTS) from £2m from April 2028.
    - Salary sacrifice cap of £2,000 from April 2029.
    - Two-child limit abolished from April 2026.
    - Electric vehicle mileage duty from April 2028.
  - **Since then:**
    - 0% VAT on domestic electricity in Great Britain from 1 October 2026 to 31 March 2027 ([HMRC Brief 10 (2026)](https://www.gov.uk/government/publications/revenue-and-customs-brief-10-2026-temporary-zero-rate-of-vat-for-domestic-electricity-in-great-britain/temporary-zero-rate-of-vat-for-domestic-electricity-in-great-britain)).
    - The 5p fuel duty cut extended to 31 December 2026, then +3p on 1 January and +2p on 1 March 2027 ([GOV.UK amended rates](https://www.gov.uk/government/publications/amended-fuel-duty-rates-for-2026-to-2027/amended-fuel-duty-rates-2026-to-2027)).
    - £2 bus fare cap in England from January 2027.

## Shortlist

"PE" means PolicyEngine UK:

- **param:** an existing parameter change.
- **modifier:** a simulation modifier or input change, as in drill 1.
- **new var:** needs a new variable or a structural reform.
- **ledger:** business-side only, so it gets a coverage-ledger row, not a coded measure.

| # | Candidate | Likelihood | PE | Reported cost or yield | Main sources |
|---|---|---|---|---|---|
| 1 | Fuel duty: delay or phase the 1 January 2027 3p rise and the 1 March 2p rise | High that a decision is made; medium-high that it is delayed | param + pump-VAT modifier | about £2bn a year to keep the cut into 2027 | [LBC, about 28 Sep](https://www.lbc.co.uk/article/10c463270f42444bb74d297380142a58-5Hjdj9s_2/); [Yahoo Finance, 1 Oct](https://uk.finance.yahoo.com/news/4-billion-fuel-windfall-offers-040000647.html) |
| 2 | Extend 0% VAT on domestic electricity beyond March 2027, possibly adding gas | Medium | modifier (electricity and gas must be split) | about £1.7bn a year for electricity | [ITV, 21 Jul](https://www.itv.com/news/2026-07-21/andy-burnham-announces-tax-cut-on-energy-bills-from-october); [BDO predictions](https://www.bdo.co.uk/en-gb/microsites/budget-autumn-budget-2026/predictions) |
| 3 | HVCTS threshold cut from £2m to £1.5m | Medium-high | param (owner-only liability is not in the engine; see drill 1) | about £800m a year (LBC) | [LBC, about 21 Sep](https://www.lbc.co.uk/article/labour-considers-extending-mansion-tax-to-homes-worth-more-than-15m-5HjdhfD_2/) (Times: "live discussion") |
| 4 | No income tax for pensioners on the State Pension (the full new State Pension exceeds £12,570 from April 2027) | High that a mechanism is set out; medium that it goes beyond state-pension-only income | new var | not reported; small | [Labour conference speech](https://labour.org.uk/updates/stories/andy-burnhams-speech-to-labour-party-conference-2026/); [GB News](https://www.gbnews.com/money/state-pension-tax-experts-warn-labour) |
| 5 | Triple lock replaced from April 2030 by the higher of CPI and 2.5% (announced 29 Sep; scoring detail unknown) | High that it is restated; medium that it is scored in the 2030-31 forecast | param (uprating path) | about £15bn a year by the late 2030s (Labour) | [Professional Pensions](https://www.professionalpensions.com/news/4536485/prime-minister-andy-burnham-confirms-adjust-triple-lock); [ITV, 29 Sep](https://www.itv.com/news/2026-09-29/andy-burnham-social-care-nhs-triple-lock-pensions) |
| 6 | Capital gains tax (CGT) rate rise, from small increases up to alignment with income tax | Medium | param | £11–14bn a year for full alignment (static) | [City AM, 27 Sep](https://www.cityam.com/uk-has-low-capital-gains-tax-rates-healey-says/); [Reuters explainer, 7 Sep](https://www.usnews.com/news/world/articles/2026-09-07/explainer-options-for-uk-finance-minister-healey-to-tax-wealth-in-octobers-budget) |
| 7 | Bank Corporation Tax Surcharge rise from 3%, up to 8%, or a bank windfall levy | High | ledger | about £9bn over four years (TUC) | [City AM (Kleinman)](https://www.cityam.com/mark-kleinman-healey-unlikely-to-resist-clamour-for-bank-windfall-tax/); [Telegraph via AOL, 24 Sep](https://www.aol.com/articles/healey-considers-smaller-budget-headroom-105321000.html) |
| 8 | Machine Games Duty on Category B machines raised from 20% to 40% | Medium-high | ledger | £275–458m a year (Social Market Foundation) | [Times via Yogonet, 9 Sep](https://www.yogonet.com/international/news/2026/09/09/126321-uk-chancellor-reportedly-weighing-slot-machine-tax-increase-ahead-of-october-budget) |
| 9 | Energy Price Protection Payment: up to £200 for low-income households through the Warm Home Discount | Medium | new var (lump sum by benefit receipt) | not reported | [Telegraph via Yahoo, 12 Sep](https://www.yahoo.com/news/politics/articles/burnham-cut-energy-bills-200-070000433.html) |
| 10 | Energy Profits Levy: higher rate and/or extension beyond March 2030 | Medium | ledger | not reported | [Telegraph via Yahoo, 30 Aug](https://finance.yahoo.com/economy/policy/articles/healey-tax-grab-inflict-lasting-141243719.html) |
| 11 | Business rates: confirm the extra 20% relief for pubs and venues; supplement for large warehouses | High for the pubs relief (announced); medium for warehouses | ledger | about £880m a year for the high-street package | [ITV, 5 Jul](https://www.itv.com/news/2026-07-05/burnhams-business-rates-plan-to-boost-high-street-could-cost-around-880m); [Bloomberg, 2 Jul](https://www.bloomberg.com/news/articles/2026-07-02/burnham-floats-warehouse-tax-hike-to-fund-cuts-for-high-street) |
| 12 | HMRC compliance and anti-avoidance package | High | ledger | £10bn a year by 2029-30 (target) | [Grant Thornton, 16 Sep](https://www.grantthornton.co.uk/insights/autumn-budget/2026-predictions/) |
| 13 | Employer NI relief: higher Secondary Threshold (the British Retail Consortium wants +£1,000) or a partial reversal | Low-medium | param (incidence depends on pass-through) | not reported | [City AM](https://www.cityam.com/retailers-urge-healey-to-unwind-national-insurance-hike-to-boost-jobs/); [Saffery, 21 Jul](https://www.saffery.com/insights/articles/uk-tax-changes-under-andy-burnham-and-john-healey-what-businesses-and-individuals-need-to-know/) |
| 14 | Local Housing Allowance relinked to the 30th percentile of local rents (RF: fund it with a 58% UC taper) | Medium-low | param | about £2bn a year by 2029-30 | [RF, 21 Sep](https://www.resolutionfoundation.org/press-releases/chancellor-must-act-to-address-record-gap-between-local-rents-and-support-available-to-low-income-renters/) |
| 15 | Small personal allowance rise of £100–200 within the freeze | Low | param | about £5bn per £500 (Cebr) | [City AM](https://www.cityam.com/healey-urged-to-restore-faith-by-ending-personal-allowance-freeze-in-budget/) |

## Watch list (low likelihood, or not modelable in PE)

- **CGT uplift on death removed:** £1.5–2bn a year; not modelable.
- **Pension changes:** a lower Lump Sum Allowance or relief restricted to the basic rate; reported as "politically perilous".
- **Inheritance tax:** a 10% estate levy for a National Care Service; deferred until after the Casey review.
- **Exit tax on emigrants.**
- **Annual wealth tax.**
- **UC health element for under-25s:** waits for the Milburn and Timms reviews.

## Baseline facts to load on the day (not reforms)

- **September CPI (published 21 October):** uprates benefits from April 2027. August CPI was 3.1%.
- **State Pension:** the triple lock gives about 3.9% in April 2027, so the full new State Pension is about £250.70 a week.
- **National Living Wage:** the Low Pay Commission's central estimate is £13.18. The engine does not re-simulate earnings.

## Caveats

- **How sources were reached:** several facts come via syndication (Times or Telegraph through AOL, Yahoo or Yogonet), because the original sites block automated fetches. The Budget date, OBR date, electricity VAT and fuel duty path, and the HVCTS report were checked against the primary page.
- **Costings:** these are third-party and mostly static, not OBR-certified.
