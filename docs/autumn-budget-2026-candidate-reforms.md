# Autumn Budget 2026: candidate reforms, updated 8 October 2026

This update replaces the 2 October survey (`docs/autumn-budget-2026-candidate-reforms.md` on branch `drill2-mock-budget`). It is **real pre-Budget research, not mock data**. Nothing here is announced policy unless it is marked **announced**.

The Budget and the OBR forecast are on Wednesday 28 October 2026 ([Chancellor's letter to the Treasury Committee, 31 July](https://www.gov.uk/government/publications/chancellor-letter-to-the-treasury-select-committee-tsc-budget-2026-date/chancellor-letter-to-the-treasury-select-committee-tsc); [OBR](https://obr.uk/autumn-2026-forecast-date-announced/)). It is John Healey's first Budget as Chancellor under Prime Minister Andy Burnham. Copy must not say "Reeves' Budget".

## How to read this

**Source quality.**

- **Syndicated:** the BBC, FT, Times, Telegraph, Guardian, Independent, Express, Sky and Reuters block automated fetches. Their stories are cited through Yahoo, AOL, LBC, investing.com or trade-site copies, marked "via".
- **Paywalled:** Bloomberg pages returned 403, so a Bloomberg row rests on its headline or search snippet only.
- **Summarised quotes:** web pages were read through a summarising tool, so quotes are near-verbatim, not exact. Check any figure against the original before it goes into a publication.
- **Unverified:** anything marked this has no primary source.

**Likelihood scale.** High, medium-high, medium, medium-low, low.

**How PolicyEngine UK ("PE") would model each measure.**

- **param:** an existing parameter change.
- **modifier:** a simulation modifier or input change.
- **new var:** needs a new variable or a structural reform.
- **ledger:** business-side only, so it gets a coverage-ledger row, not a household score.

**Parameter checks.** Paths were checked against `policyengine-uk` `origin/main` at `f1a9a3cc2` (8 October 2026).

## What changed since 2 October

1. **Energy support has changed shape.** The Guardian (6–7 October) reports Healey is considering a £100 taxpayer-funded top-up to the £150 Warm Home Discount (WHD). The package is "more than £1bn". He is set to reject the Energy Secretary's £3.2bn plan to move levies off bills. This supersedes the Telegraph's £200 "Energy Price Protection Payment" (12 September) as the lead option. Sources: [Guardian via AOL, 7 Oct](https://www.aol.co.uk/articles/chancellor-plans-major-intervention-help-192759000.html); [LBC, 7 Oct](https://www.lbc.co.uk/article/chancellors-intervention-plans-cut-energy-bills-for-millions-1billion-5HjdjXX_2/). **The engine has no Warm Home Discount at all** (see the engine-risk list).
2. **The triple lock replacement is more complex than "the higher of CPI and 2.5%".** DWP's factsheet (6 October) says that from April 2030 the State Pension rises by the highest of:
   - CPI;
   - 2.5%;
   - "the amount required to return or maintain the value of the State Pension relative to earnings".

   The savings are £15bn a year in 2039-40 and £50bn in 2049-50 in nominal terms, or £11bn and £30bn in 2025-26 prices. That explains the conflicting figures in the press. Sources: [DWP factsheet](https://www.gov.uk/government/publications/state-pension-uprating-analysis-2026/triple-lock-reform-factsheet); [DWP uprating analysis](https://www.gov.uk/government/publications/state-pension-uprating-analysis-2026/state-pension-uprating); [No 10, 29 Sep](https://www.gov.uk/government/news/prime-minister-andy-burnham-sets-out-plans-for-a-new-national-care-service).
3. **The pensioner income tax pledge was restated in new words, and its scope is now unclear.** In his speech Burnham committed "to ensure that the low-income pensioners won't be dragged into paying income tax in this Parliament" ([Labour, 29 Sep](https://labour.org.uk/updates/stories/andy-burnhams-speech-to-labour-party-conference-2026/)). He gave no mechanism. Torsten Bell said it will be set out at the Budget ([Express via AOL, 15 Sep](https://www.aol.co.uk/articles/martin-lewis-issues-state-pension-134700000.html)).
4. **On CGT, the signals now point both ways.** Healey said the UK has the "lowest capital gains tax of any European G7 nation" ([City AM, 27 Sep](https://www.cityam.com/uk-has-low-capital-gains-tax-rates-healey-says/)), and 13 firm and press previews list a CGT rise. Against that:
   - Tax Policy Associates calls reform "dead". It estimates £100–165bn of gains were brought forward, so a rise could lose £11–18bn early on ([Neidle, 6 Oct](https://taxpolicy.org.uk/2026/10/06/cgt-reform-dead/)).
   - The CPS cites HMRC's ready reckoner: a 10pp rise *costs* £3.6bn in 2028-29 ([CPS, 16 Jul](https://cps.org.uk/media/post/2026/governments-own-stats-say-burnham-would-be-wrong-to-raise-capital-gains-tax/)).
   - PwC now expects "a more modest increase in the higher rate" rather than alignment with income tax ([PwC, 6 Oct](https://www.pwc.co.uk/press-room/press-releases/research-commentary/2026/pwc-previews-the-uk-autumn-budget-2026.html); read through a reader proxy).
5. **Fuel duty is unresolved, but leans towards a delay.**
   - Healey: "we will do what we can to give people a bit of breathing space" ([Express via AOL, 3 Oct](https://www.aol.co.uk/articles/petrol-diesel-drivers-set-face-173100000.html)).
   - The Independent says he is "reportedly considering" delaying the January rise ([via AOL, 8 Oct](https://www.aol.com/articles/boost-drivers-live-petrol-prices-230100000.html)). It names no source.
   - BDO calls a delay "highly likely". KPMG predicts the 5p cut is kept for 12 more months.
   - LBC's 27 September line that he "hinted at allowing" the rise conflicts with this and reads as internally inconsistent.
6. **The bank tax is downgraded from high (2 Oct) to medium.** There is still no decision. Healey told bank chief executives on 6 October there is no decision yet ([Telegraph via Yahoo, 6 Oct](https://finance.yahoo.com/economy/policy/articles/bank-tax-raid-hurt-economy-131432194.html); [Bloomberg headline](https://www.bloomberg.com/news/articles/2026-10-06/uk-chancellor-tells-bank-ceos-no-decision-yet-on-tax-in-budget)). The City is lobbying against one ([Sky via Yahoo, 2 Oct](https://uk.finance.yahoo.com/news/city-steps-opposition-healey-bank-162700029.html)).
7. **Three new pre-announced Budget items, none household-scorable in PE:**
   - "Your First Home": a 2.5% deposit plus a 20% government equity loan on new-builds, with costs to be set out "at the Budget" ([MHCLG, 26 Sep](https://www.gov.uk/government/news/new-first-time-buyer-scheme-to-be-confirmed-at-budget)).
   - A fiscal devolution roadmap, with mayors keeping a share of business rates growth from April 2027 ([Bloomberg snippet, 2 Oct](https://www.bloomberg.com/news/articles/2026-10-02/burnham-could-give-uk-mayors-20-of-any-business-tax-growth)) and of income tax from April 2028 ([Cabinet statement](https://assets.publishing.service.gov.uk/media/6a6c7acf0ddb7e4831c62abd/REWIRING_THE_STATE_-_CABINET_STATEMENT.pdf)).
   - A £4.7bn defence top-up to be "confirmed at Budget 2026, in a fair and balanced way" ([MOD/HMT, 30 Jun](https://www.gov.uk/government/publications/the-defence-investment-plan/the-defence-investment-plan-funding-explainer); a commitment of the previous Chancellor).
8. **Welfare.**
   - Burnham: "there will not be welfare cuts in the autumn budget" ([Big Issue, 30 Sep](https://www.bigissue.com/news/politics/what-could-be-in-budget-2026-autumn-statement/); no primary source found).
   - Alan Milburn's youth report is reportedly delayed to November ([Daily Mail via aggregator, 7 Oct](https://uk.headtopics.com/news/milburn-review-on-youth-unemployment-delayed-until-after-88546054); unverified).
   - Both lower the odds of UC or PIP changes on 28 October.
9. **Threshold freeze.** KPMG alone predicts the freeze is extended by a further year, to 2032 ([KPMG](https://kpmg.com/uk/en/budget.html); undated page).
10. **Corrections to the 2 October doc:**
    - The electricity VAT cut costs £850m in 2026-27 ([No 10, 21 Jul](https://www.gov.uk/government/news/new-pm-cuts-tax-on-household-electricity-bills-to-give-breathing-space-on-cost-of-living)). The 2 October figure of "about £1.7bn a year" is a rough full-year equivalent, not an official number.
    - interactive investor wrongly says electricity VAT went "to 5%". It went from 5% to 0%.
    - Mansion House 2026 was given by Rachel Reeves on 14 July, before the change of government, and contained no tax measures ([GOV.UK](https://www.gov.uk/government/speeches/rachel-reeves-mansion-house-2026-speech)).

## Fiscal context

| Item | Latest | Source |
|---|---|---|
| Headroom, March forecast | £23.6bn against the current-budget rule in 2029-30 | [RF, 21 Jul](https://www.resolutionfoundation.org/press-releases/new-chancellor-faces-10-billion-headroom-headache-as-public-sector-finances-remain-on-a-knife-edge/) |
| Headroom now (third-party estimates) | RF about £10bn, falling to about £8bn after the July measures; Telegraph £8.5bn; EY ITEM Club £11.3bn (adverse case about −£7bn); KPMG about £12bn; Deutsche Bank £13.8bn (snippet, unverified); PwC about £14bn; NIESR: none left | [RF, 24 Jul](https://www.resolutionfoundation.org/comment/time-to-heal-ey/); [Telegraph via Yahoo, 24 Sep](https://finance.yahoo.com/economy/policy/articles/healey-considers-smaller-budget-headroom-105321584.html); [EY, 5 Oct](https://ey.com/en_uk/newsroom/2026/10/uk-fiscal-headroom-could-fall-to-7bn-deficit); [Investment Week on KPMG, 21 Sep](https://www.investmentweek.co.uk/news/4536029/pressure-mounts-healey-uk-fiscal-headroom-forecast-drop-12bn); [NIESR, 2 Oct](https://niesr.ac.uk/blog/budget-2026-when-fiscal-and-monetary-policy-collide) |
| Buffer the Treasury may target | £15–20bn rather than rebuilding to £23.6bn (FT, reported via the Telegraph and City AM) | [City AM, 24 Sep](https://www.cityam.com/autumn-budget-healey-weighs-slashing-fiscal-headroom-to-reduce-tax-hikes/) |
| Implied consolidation | About £10–15bn of tax rises or savings (Capital Economics: £9–14bn; EY: about £12bn for a "limited" Budget) | [Telegraph via Yahoo, 22 Sep](https://finance.yahoo.com/economy/policy/articles/tax-rises-virtually-inevitable-8bn-131248871.html); [EY](https://ey.com/en_uk/newsroom/2026/10/uk-fiscal-headroom-could-fall-to-7bn-deficit) |
| Borrowing (public sector finances release, 22 Sep, covering April–August) | £77.3bn, which is £8.1bn above the OBR profile. Spending £7.4bn over (benefits and debt interest); receipts £1.1bn over. August alone was £18.3bn (£3.5bn over). Debt was 93.8% of GDP. The next release is 21 Oct. | [ONS](https://www.ons.gov.uk/economy/governmentpublicsectorandtaxes/publicsectorfinance/bulletins/publicsectorfinances/august2026); [OBR](https://obr.uk/hero/latest-year-to-date-borrowing-estimate-above-march-forecast-profile/); [ICAEW](https://www.icaew.com/insights/viewpoints-on-the-news/2026/sep-2026/budget-overrun-widens-as-public-finances-disappoint) |
| Middle East war hit | £10–15bn to 2029-30 borrowing (RF) | [RF, 22 Sep](https://www.resolutionfoundation.org/press-releases/healey-faces-budget-balancing-act-as-rising-inflation-begins-to-hit-home/) |
| Gilt yields | 30-year above 6% on 1 Oct for the first time since 1998, peaking at about 6.04% on 7 Oct. 10-year about 5.46% on 8 Oct, the highest since 2007. City AM: each 1pp on yields adds about £15bn to costs by 2031. | [Bloomberg headline, 1 Oct](https://www.bloomberg.com/news/articles/2026-10-01/uk-long-term-bond-yield-reaches-6-for-first-time-since-1998); [City AM, 1 Oct](https://www.cityam.com/global-bond-sell-off-headache-for-healey-as-gilt-yields-top-six-per-cent/); [Trading Economics](https://tradingeconomics.com/united-kingdom/government-bond-yield) (secondary) |
| Bank of England | Bank Rate held at 3.75% on 17 Sep, by 6–3 (three members wanted a hike). CPI was 3.1% in August and is projected above 4% in Q1 2027. Markets put about 81% odds on a hike on 5 Nov. | [BoE](https://www.bankofengland.co.uk/monetary-policy-summary-and-minutes/2026/september-2026); [FXStreet, 7 Oct](https://www.fxstreet.com/news/british-pound-buckles-as-30-year-gilts-tops-6-us-yields-soar-202610071736) |
| OBR productivity | No OBR signal yet. ONS's 17 Sep hours re-measurement roughly doubles 2007–19 productivity growth to about 1.0% a year, against the OBR's 1.0% assumption. The TPA (TaxPayers' Alliance) says a move from 1.0% to 1.3% would be worth about £30bn by 2030-31 (its own estimate, unverified). This is the biggest swing factor on the day. | [ONS blog](https://blog.ons.gov.uk/2026/09/17/measuring-labour-productivity-our-new-approach/); [RF, 25 Sep](https://www.resolutionfoundation.org/publications/revision-of-labour/); [TPA, 22 Sep](https://taxpayersalliance.com/revised-productivity-data-will-not-help-taxpayers/) |
| OBR process | The timetable is to appear only in the foreword to the Economic and Fiscal Outlook. No pre-measures forecast date is public. | [OBR, 10 Sep](https://obr.uk/october-2026-forecast-timetable/) |
| Treasury Committee | Its report on the OBR (23 Sep) recommends a 10-year forecast and less emphasis on headroom. No pre-Budget hearing was found (committee pages were blocked). | [OBR response page](https://obr.uk/treasury-committee-report-concluding-its-inquiry-into-the-obr-15-years-on/) |
| Pre-Budget reports still to come | Resolution Foundation, 13 Oct; IFS Green Budget launch, 14 Oct (some chapters already out); September CPI, about 21 Oct, which sets April 2027 uprating | [RF event](https://www.resolutionfoundation.org/events/hitting-the-buffers/); [IFS event](https://ifs.org.uk/events/ifs-green-budget-2026) |

### Locks, rule-outs and U-turns

- **Fiscal rules:**
  - Healey and Burnham will "meet the fiscal rules" ([Healey, conference, 28 Sep](https://labour.org.uk/updates/stories/john-healeys-speech-to-labour-party-conference-2026/); [Healey growth speech, 7 Sep](https://www.gov.uk/government/speeches/chancellor-john-healeys-growth-speech-2026)).
  - No change to the rules has been announced.
  - Ideas in circulation: a smaller buffer; netting assets under the PSNFL rule for about £9bn of borrowing through the national banks ([Telegraph via AOL, 5 Aug](https://www.aol.com/articles/healey-plots-9bn-budget-borrowing-050000000.html)); and the Treasury Committee's 10-year horizon.
- **Manifesto tax locks:**
  - No rise in the basic, higher or additional rates of income tax, in NI or in VAT. Healey restated this on 7 Sep ([IfG](https://www.instituteforgovernment.org.uk/publication/john-healey-tax-budget-2026)): "I'm not going to speculate on questions of tax."
  - Corporation tax capped at 25%, with full expensing and the Annual Investment Allowance kept ([Grant Thornton, 16 Sep](https://www.grantthornton.co.uk/insights/autumn-budget/2026-predictions/)).
  - A 50p top rate would break the lock. A lower additional-rate *threshold* would not.
- **Ruled out:** abolishing stamp duty or council tax "won't be happening" (Burnham, 27 Jul). This rests on a search snippet ([calculatemystampduty.co.uk](https://calculatemystampduty.co.uk/news/autumn-budget-2026-stamp-duty)) and is unverified. The [Reuters explainer via Yahoo, 7 Sep](https://uk.finance.yahoo.com/news/explainer-options-uk-finance-minister-050259202.html) gives the context.
- **Walked back:** a personal allowance rise was hinted on 20 Jul and walked back within days ([Ground News aggregator](https://ground.news/article/burnham-drops-biggest-hint-yet-that-12-570-tax-free-allowance-could-finally-rise_d71bc9); unverified).
- **Not ruled out:**
  - An annual wealth tax ([Reuters via Yahoo, 7 Sep](https://uk.finance.yahoo.com/news/explainer-options-uk-finance-minister-050259202.html)). The CIOT reports that a CGT rise "seems a likelier outcome" ([CIOT, 2 Oct](https://www.tax.org.uk/labour-conference-2026)).
  - Revisiting the 2024 employer NI rise. Burnham raised it during the by-election ([Saffery, 21 Jul](https://www.saffery.com/insights/articles/uk-tax-changes-under-andy-burnham-and-john-healey-what-businesses-and-individuals-need-to-know/)). There has been no follow-up.
- **U-turn on a manifesto pledge:** the triple lock is kept unchanged to 2030, then adjusted (**announced** 29 Sep; see row 5).

### Already in the baseline, so not new

| Item | Status | Source | In PE `main`? |
|---|---|---|---|
| Thresholds frozen to April 2031 | Enacted, 2025 Budget | [Budget 2025](https://www.gov.uk/government/publications/budget-2025-document/budget-2025-html) | Yes (`gov.hmrc.income_tax.allowances.personal_allowance.amount` is £12,570 to 2030). PR #2180 (open) handles indexation after the freeze. |
| Dividend, savings and property income rates +2pp | Enacted, 2025 Budget (savings and property from April 2027) | as above | Yes (`gov.hmrc.income_tax.rates.dividends`, `.savings`, `.property`) |
| High Value Council Tax Surcharge: £2m+, bands £2,500–£7,500, from April 2028, about £430m a year | Enacted plan | [MHCLG consultation](https://www.gov.uk/government/consultations/high-value-council-tax-surcharge/high-value-council-tax-surcharge) | Yes (`gov.hmrc.council_tax.high_value_surcharge.amount`). The owner-only liability fix was merged (#2164). |
| Salary sacrifice NI cap of £2,000 from April 2029 | Enacted plan | [GOV.UK](https://www.gov.uk/government/publications/changes-to-salary-sacrifice-for-pensions-from-april-2029) | Yes (`gov.hmrc.national_insurance.salary_sacrifice_pension_cap`) |
| Two-child limit abolished from 6 April 2026 | Enacted | [DWP](https://www.gov.uk/government/news/two-child-limit-scrapped-as-historic-bill-to-lift-450000-children-out-of-poverty-becomes-law) | Yes (`gov.dwp.universal_credit.elements.child.limit.child_count` is unlimited from 2026-04-06) |
| Pensions brought into inheritance tax from April 2027; cash ISA limit of £12k for under-65s from April 2027 | Enacted | [Hargreaves Lansdown, 8 Sep](https://www.hl.co.uk/news/autumn-budget-2026-key-changes-rumours-and-what-they-mean-for-your-money) | Inheritance tax is not modelled; no ISA limit parameter |
| 0% VAT on GB domestic electricity, 1 Oct 2026 to 31 Mar 2027; £850m | Enacted ([SI 2026/987](https://www.legislation.gov.uk/uksi/2026/987/contents/made)) | [HMRC Brief 10 (2026)](https://www.gov.uk/government/publications/revenue-and-customs-brief-10-2026-temporary-zero-rate-of-vat-for-domestic-electricity-in-great-britain/temporary-zero-rate-of-vat-for-domestic-electricity-in-great-britain) | **Not yet.** PR #2189 (open) adds `gov.hmrc.vat.domestic_electricity_rate.great_britain`. |
| Fuel duty: 52.95p to 31 Dec 2026, then 55.95p from 1 Jan 2027 and 57.95p from 1 Mar 2027 | Enacted path; the cost is "to be set out at a future fiscal event" | [HMRC](https://www.gov.uk/government/publications/amended-fuel-duty-rates-for-2026-to-2027/amended-fuel-duty-rates-2026-to-2027) | Yes (`gov.hmrc.fuel_duty.petrol_and_diesel`). PRs #2185 and #2186 (open) fix mid-year blending and litre divisors. |
| £2 bus fare cap in England outside London, 1 Jan to 31 Dec 2027 | Announced | [DfT, 22 Jul](https://www.gov.uk/government/news/cheaper-travel-for-millions-with-a-third-off-fares) | Yes (`gov.dft.bus.fares.cap`) |
| Warm Home Discount of £150, about 6m households | Existing | [DESNZ, 26 Aug](https://www.gov.uk/government/news/breathing-space-on-your-energy-bill) | **No: not in the engine at all** |
| 20% business rates cut for pubs, clubs and venues from April 2027; about £100m | Announced; details at the Budget | [No 10, 23 Jul](https://www.gov.uk/government/news/burnham-means-business-pm-slashes-business-rates-bills-for-pubs-clubs-and-live-music-venues) | Ledger |
| Disabled concessionary bus passes valid 24/7 from April 2027; £60m | Announced | [No 10, 17 Aug](https://www.gov.uk/government/news/free-bus-travel-247-for-disabled-people-as-prime-minister-takes-further-action-to-ease-cost-of-living) | Ledger |
| £2,000 apprenticeship hiring payment, from October 2026 | Announced, in force | [DfE, 1 Oct](https://www.gov.uk/government/news/2000-boost-for-small-businesses-who-take-on-young-apprentices) | Ledger |

## Candidate measures

Likelihood is as of 8 October. "Firms" means the count of accountancy and wealth-manager previews listing the item (see the appendix).

| # | Candidate: what changes | Likelihood | Evidence (dated, linked) | Reported cost or yield | PE | Parameter path | Winners and losers (specimen households) |
|---|---|---|---|---|---|---|---|
| 1 | **Fuel duty.** A decision on the January rise, most likely to delay or phase the rise from 52.95p to 55.95p on 1 Jan 2027 and to 57.95p on 1 Mar 2027, e.g. keep 52.95p for 12 more months | Medium-high that the rise is delayed (a decision itself is near-certain) | Healey's "breathing space" ([Express via AOL, 3 Oct](https://www.aol.co.uk/articles/petrol-diesel-drivers-set-face-173100000.html)); "reportedly considering" ([Independent via AOL, 8 Oct](https://www.aol.com/articles/boost-drivers-live-petrol-prices-230100000.html)); BDO "highly likely" ([BDO, 8 Sep](https://www.bdo.co.uk/en-gb/microsites/budget-autumn-budget-2026/predictions)); KPMG keeps the 5p cut 12 months ([KPMG](https://kpmg.com/uk/en/budget.html)) | More than £2bn to keep the freeze into 2027. The VAT windfall from high pump prices is £3.9bn over 12 months on Bloomberg's own calculation ([Bloomberg via Yahoo, 1 Oct](https://uk.finance.yahoo.com/news/4-billion-fuel-windfall-offers-040000647.html)) | param, plus the pump-VAT modifier | `gov.hmrc.fuel_duty.petrol_and_diesel` (date-keyed; needs #2185 and #2186 for the mid-year blend) | Rural car-dependent households and the self-employed win. Car-free renters gain nothing. Gains are larger in money terms for higher deciles but larger as a share of income for lower-middle deciles. |
| 2 | **Low-income pensioners kept out of income tax.** The full new State Pension is about £13,000 from April 2027, above the frozen £12,570 allowance | High that a mechanism is set out (**committed**); the design is unknown | Burnham's speech ([Labour, 29 Sep](https://labour.org.uk/updates/stories/andy-burnhams-speech-to-labour-party-conference-2026/)); Bell says it will be set out at the Budget ([Express via AOL, 15 Sep](https://www.aol.co.uk/articles/martin-lewis-issues-state-pension-134700000.html)) | Not reported. Small if limited to state-pension-only pensioners | **new var** | None live. `gov.contrib.conservatives.pensioner_personal_allowance` exists but is **not wired to any formula** | Pensioners whose only income is the full new State Pension gain about £90–£100 a year. Pensioners with small private pensions just over £12,570 may or may not gain, depending on the design. Workers gain nothing. |
| 3 | **Warm Home Discount top-up.** £100 on top of the £150 WHD for households on certain benefits (UC, Pension Credit, Housing Benefit), funded by taxpayers. This replaces the Telegraph's £200 EPPP as the lead option | Medium-high | [Guardian via AOL, 7 Oct](https://www.aol.co.uk/articles/chancellor-plans-major-intervention-help-192759000.html); [Independent via Yahoo, 7 Oct](https://www.yahoo.com/news/world/articles/poorer-uk-households-could-given-081831584.html); [LBC, 7 Oct](https://www.lbc.co.uk/article/chancellors-intervention-plans-cut-energy-bills-for-millions-1billion-5HjdjXX_2/); for comparison, RF proposes a £2bn scheme averaging £175 per eligible household ([RF, 8 Oct](https://www.resolutionfoundation.org/publications/counting-cost/)) | More than £1bn for the whole package (Guardian) | **new var** (lump sum by benefit receipt; the £150 baseline is also missing) | None | Pensioners on Pension Credit and UC families gain £100. Low-income households not on benefits miss out. No effect above the bottom three deciles. |
| 4 | **High Value Council Tax Surcharge threshold cut from £2m to £1.5m.** Possibly with a new band; PwC adds a possible non-resident surcharge | Medium-high | Times (18 Sep) via the [Reuters factbox via Yahoo, 7 Oct](https://uk.finance.yahoo.com/news/factbox-options-uk-finance-minister-115110980.html); [Telegraph via Yahoo, 21 Sep](https://finance.yahoo.com/real-estate/articles/one-four-london-houses-could-153353018.html); BBC round-up ([via AOL, 8 Oct](https://www.aol.co.uk/articles/budget-could-142953000.html)); in 6 firm previews (PwC, BDO, Saffery, ii, CIOT, KPMG) | About £800m a year, against about £400–430m at £2m (Tax Policy Associates, via the Telegraph and ii). Homes affected: 245k–272k, against 123k | param | `gov.hmrc.council_tax.high_value_surcharge.amount` (brackets; thresholds in 2026 prices, CPI-uprated) | London and South East owners of £1.5–2m homes lose £2,500 a year or more from 2028. Asset-rich, income-poor pensioners are the hard case. Renters are unaffected. |
| 5 | **Triple lock replaced from April 2030** by the highest of CPI, 2.5%, or the rise needed to "return or maintain" the State Pension's value relative to earnings | **Announced** (29 Sep). High that the OBR scores it for 2030-31 | [DWP factsheet, 6 Oct](https://www.gov.uk/government/publications/state-pension-uprating-analysis-2026/triple-lock-reform-factsheet); [No 10, 29 Sep](https://www.gov.uk/government/news/prime-minister-andy-burnham-sets-out-plans-for-a-new-national-care-service) | £15bn a year (2039-40) and £50bn (2049-50) nominal; £11bn and £30bn in 2025-26 prices (DWP). Small within the forecast window | param (via `Scenario(parameter_changes=...)` only) | `gov.dwp.state_pension.triple_lock.include_earnings` set to false from 2030, plus `...triple_lock.earnings_path_guarantee` set to true from 2030 | Only 2030-31 falls inside the forecast window. Pensioners lose a little in years when earnings growth beats CPI and 2.5%. |
| 6 | **CGT rate rise.** Range: a modest rise in the 24% higher rate (PwC); alignment with income tax at 20/40/45% (rumoured); indexation or a taper (KPMG); cutting the £3,000 annual exempt amount or Business Asset Disposal Relief (Saffery) | Medium | Healey's "lowest CGT" line ([City AM, 27 Sep](https://www.cityam.com/uk-has-low-capital-gains-tax-rates-healey-says/)); "rumours are growing" ([HL, 29 Sep](https://www.hl.co.uk/news/capital-gains-tax-and-the-autumn-budget-sensible-steps-investors-can-take-today)); 13 firms; against it: [Tax Policy Associates, 6 Oct](https://taxpolicy.org.uk/2026/10/06/cgt-reform-dead/) and [CPS, 16 Jul](https://cps.org.uk/media/post/2026/governments-own-stats-say-burnham-would-be-wrong-to-raise-capital-gains-tax/) | Full alignment: £11.3bn steady state (CenTax via TPA) or about £14bn (Rathbones). The early years could lose £11–18bn to forestalling (Tax Policy Associates). HMRC's ready reckoner (via the CPS) shows a 10pp rise costing £3.6bn in 2028-29 | param for rates and the annual exempt amount; **new var** for indexation or a taper | `gov.hmrc.cgt.basic_rate`, `.higher_rate`, `.additional_rate`, `.annual_exempt_amount`, `.badr.rate`, `.residential_property.*` | Top-decile asset holders lose. Basic-rate payers barely change. A static PE score will overstate the yield because forestalling dominates; pair it with the OBR behavioural line. |
| 7 | **Threshold freeze extended one more year, to April 2032** | Medium-low | KPMG "likely" ([KPMG](https://kpmg.com/uk/en/budget.html); undated); Grant Thornton calls the freeze the "favoured tool" ([GT, 16 Sep](https://www.grantthornton.co.uk/insights/autumn-budget/2026-predictions/)) | Not costed this cycle. The freeze raises more than £55bn in 2030-31 (OBR, Nov 2025, via KPMG and PwC) | param | `gov.hmrc.income_tax.allowances.personal_allowance.amount`; the higher-rate threshold (second bracket of `gov.hmrc.income_tax.rates.uk`); NI thresholds; interacts with PR #2180 | Every taxpayer loses a little in 2031-32. This falls after the five-year window on most dashboards. |
| 8 | **LHA relinked to the 30th percentile of local rents** (frozen since April 2025) | Medium-low | Burnham: "we'll have to look at those things" ([Big Issue, 30 Sep](https://www.bigissue.com/news/politics/what-could-be-in-budget-2026-autumn-statement/)); [RF, 21 Sep](https://www.resolutionfoundation.org/press-releases/chancellor-must-act-to-address-record-gap-between-local-rents-and-support-available-to-low-income-renters/); [Mirror via AOL, 18 Sep](https://www.aol.co.uk/articles/chancellor-john-healey-urged-end-230323000.html) | About £2bn a year by 2029-30; 1.1m households (RF) | param | `gov.dwp.LHA.freeze` set to false from April 2027; `gov.dwp.LHA.percentile` stays 0.3 | Private renters on UC or Housing Benefit in high-rent areas gain. Social renters and owners are unaffected. |
| 9 | **0% VAT on electricity extended beyond March 2027, or extended to gas** | Medium-low | No October report of an extension. KPMG: no announcement now, but permanent later ([KPMG](https://kpmg.com/uk/en/budget.html)). BDO floats gas ([BDO](https://www.bdo.co.uk/en-gb/microsites/budget-autumn-budget-2026/predictions)). The IFS argues for removing the reduced rate in favour of targeted support ([IFS Green Budget ch. 8, Sep](https://ifs.org.uk/system/files/2026-09/IFS%20Green%20Budget%20Chapter%202026%20-%20Electricity%20prices.pdf)) | £850m for half of 2026-27, so roughly £1.7bn a year for electricity (our extrapolation) | modifier; param once #2189 is merged; **new param** for gas | `gov.hmrc.vat.domestic_electricity_rate.great_britain` (PR #2189); `electricity_consumption` and `gas_consumption` inputs exist | Everyone gains, about £45 a year per household for electricity. Larger homes gain more in cash. Northern Ireland is excluded. |
| 10 | **Small personal allowance rise of £100–£500 within the freeze** | Low | Walked back in July (see Locks); BDO says it "seems to have been sidelined" | About £5bn per £500 (Cebr, via BDO and PKF) or about £6bn (Neidle, via ii) | param | `gov.hmrc.income_tax.allowances.personal_allowance.amount` | All basic-rate taxpayers gain up to £20 per £100. Non-taxpayers gain nothing. |
| 11 | **Lower additional-rate threshold** (from £125,140) | Low | "Might choose" ([AJ Bell, 14 Aug](https://www.ajbell.co.uk/news/what-high-earners-might-be-wary-healeys-first-budget)); a 50p rate breaks the lock | Not reported | param | additional-rate threshold (third bracket of `gov.hmrc.income_tax.rates.uk`) | Earners above the new threshold lose. |
| 12 | **Dividend or savings rates raised again** (they are already +2pp under the 2025 Budget) | Low | "Could… marginally" ([PKF Francis Clark, 28 Aug](https://pkf-francisclark.co.uk/insights/what-tax-changes-might-john-healey-introduce-in-his-budget-on-28-october/)); AJ Bell | Investment income tax is about £20bn in 2026-27 (HMRC via AJ Bell) | param | `gov.hmrc.income_tax.rates.dividends`, `.savings` | Owner-managers and retired savers outside ISAs lose. |
| 13 | **Self-employed (Class 4) NI raised, or NI extended to workers over State Pension age** | Low | BDO, PKF, Forvis Mazars (all "could") | £1–2bn from professional partnerships (Tax Policy Associates, via PKF) | param (Class 4); **new var** (NI over State Pension age) | `gov.hmrc.national_insurance.class_4.rates.main` | Sole traders lose. Older workers would lose if NI past State Pension age is applied. |
| 14 | **NI on rental income for landlords** | Low | Forvis Mazars "possible" ([23 Sep](https://www.forvismazars.com/uk/en/insights/the-chancellors-budget-and-forecast-statements/autumn-budget-predictions)) | Not reported | **new var** | Property income exists (`property_income`), but no NI applies to it | Landlord households lose, mostly in the top deciles. |
| 15 | **Hospitality VAT cut** (to about 10%, excluding alcohol) | Low-medium | BDO "would be popular"; KPMG "fifty-fifty"; Blick Rothenberg argues for it | "Substantial" (no figure) | modifier (consumption category) | None. VAT works through `gov.hmrc.vat.standard_rate` and the reduced-rate share | Small, broad gain weighted towards higher-spending households. |
| 16 | **HMRC compliance and anti-avoidance package** | High | BDO, Grant Thornton, ICAEW; New Economics Foundation: £1 spent returns £15 ([CIOT, 2 Oct](https://www.tax.org.uk/labour-conference-2026)) | Target of £10bn a year by 2029-30 ([GT](https://www.grantthornton.co.uk/insights/autumn-budget/2026-predictions/)) | ledger | None | No household effect in PE. |
| 17 | **Business rates package.** Confirms the 20% pubs relief (**announced**); raises the Small Business Rates Relief threshold from £12,000 to about £17,096; drops the warehouse supplement in favour of consulting on online marketplace VAT | High (pubs); medium (Small Business Rates Relief) | [No 10, 23 Jul](https://www.gov.uk/government/news/burnham-means-business-pm-slashes-business-rates-bills-for-pubs-clubs-and-live-music-venues); [Independent via NewsBreak, 18 Sep](https://www.newsbreak.com/the-independent-517119/4894826826501-healey-planning-high-street-revival-with-small-business-tax-cuts-in-first-budget); PwC "most probable" | About £100m a year for pubs | ledger | `gov.hmrc.business_rates.*` (business-side) | No household effect in PE. |
| 18 | **Fiscal devolution roadmap.** Mayors keep 20% of business rates growth from April 2027 and a share of income tax from April 2028; an overnight visitor levy power (about 5%) | High (**committed** to be published with the Budget) | [Cabinet statement](https://assets.publishing.service.gov.uk/media/6a6c7acf0ddb7e4831c62abd/REWIRING_THE_STATE_-_CABINET_STATEMENT.pdf); [Bloomberg snippet, 2 Oct](https://www.bloomberg.com/news/articles/2026-10-02/burnham-could-give-uk-mayors-20-of-any-business-tax-growth); [Tax Policy Associates on the visitor levy, 12 Sep](https://taxpolicy.org.uk/2026/09/12/england-tourist-tax/) | Visitor levy about £600m a year (Tax Policy Associates) | ledger (a revenue split; no rate change for households) | None | No household effect unless mayors get rate-setting powers. |
| 19 | **"Your First Home" equity loan.** A 2.5% deposit and a 20% government loan on new-builds, initially interest-free | High (**pre-announced**; costs at the Budget) | [MHCLG, 26 Sep](https://www.gov.uk/government/news/new-first-time-buyer-scheme-to-be-confirmed-at-budget) | To be set out at the Budget | ledger (outside PE scope) | None | First-time buyers of new-builds, but this is not a tax-benefit transfer. |
| 20 | **Machine Games Duty on Category B machines raised from 20% to 40%** | Medium-high | Times via [Yogonet, 9 Sep](https://www.yogonet.com/international/news/2026/09/09/126321-uk-chancellor-reportedly-weighing-slot-machine-tax-increase-ahead-of-october-budget); Guardian via [AOL, 2 Oct](https://www.aol.co.uk/articles/gambling-tax-rise-budget-really-050011000.html) | £275–460m a year (SMF). Industry-commissioned EY analysis claims a £120m net loss | ledger | None | No household effect in PE. |
| 21 | **Bank Corporation Tax Surcharge** raised from 3% (TUC: 8%), or a windfall levy | Medium (no decision on 6 Oct) | [Telegraph via Yahoo, 6 Oct](https://finance.yahoo.com/economy/policy/articles/bank-tax-raid-hurt-economy-131432194.html); [Independent via Yahoo, 1 Oct](https://uk.finance.yahoo.com/news/chancellor-summons-uk-bank-chiefs-160419768.html); KPMG "less than fifty-fifty" | £9bn over four years (TUC). A return to the pre-2023 level is worth about £2bn a year (KPMG, unattributed) | ledger | None | No household effect in PE. |
| 22 | **Energy Profits Levy** raised or extended beyond 2030 | Medium-low (no October reporting) | [Telegraph via Yahoo, 30 Aug](https://finance.yahoo.com/economy/policy/articles/healey-tax-grab-inflict-lasting-141243719.html); KPMG: no new tax on energy producers | Not reported | ledger | None | No household effect in PE. |
| 23 | **Employer NI relief**, for under-25s or by raising the Secondary Threshold | Low | Milburn opposes the under-25 cut ([Politico via ua.news](https://ua.news/en/world/milbern-vidkinuv-skasuvannia-vneskiv-robotodavtsiv-dlia-molodi-politico-europe); undated, unverified). The Tories pledge 7.5% for ages 21–24 ([ITV snippet, 6 Oct](https://www.itv.com/news/2026-10-06/tories-pledge-to-halve-employer-national-insurance-for-young-people)) | Under-25 abolition: £5.1bn (Politico); £6–7bn (Tax Policy Associates) | param; incidence via the `gov.contrib.policyengine.employer_ni.*` shares | `gov.hmrc.national_insurance.class_1.rates.employer`; `.thresholds.secondary_threshold` | Depends on pass-through to wages. |
| 24 | **Pension tax-free cash cut** (cap £268,275) **or relief restricted to the basic rate** | Low | Bell called the speculation "garbage" ([ii, 1 Oct](https://www.ii.co.uk/analysis-commentary/budget-2026-what-might-burnham-and-healey-have-store-ii540459)); Rathbones; Forvis | Up to £2bn a year (Rathbones) | new var (tax-free cash); param or new var (relief) | `gov.hmrc.income_tax.reliefs.pension_contribution.basic_amount`; no tax-free cash variable | Higher-rate savers near retirement lose. |

## Watch list: low likelihood, or not modelable in PE

- **Inheritance tax:** the agricultural and business reliefs (APR and BPR) are "under scrutiny" ([GT](https://www.grantthornton.co.uk/insights/autumn-budget/2026-predictions/)). A 10% estate levy for a National Care Service has been floated, but the Casey review reports in summer 2027. **Inheritance tax is not in PE.**
- **Removing CGT uplift on death:** worth £1.5–2bn a year ([Rathbones](https://www.rathbones.com/en-gb/wealth-management/knowledge-and-insight/uk-autumn-budget-2026-what-it-could-mean-for-your-finances)). Not modelable.
- **Annual wealth tax:** not ruled out, but "not broadly expected" ([AJ Bell, 14 Aug](https://www.ajbell.co.uk/news/what-high-earners-might-be-wary-healeys-first-budget)). Only a contrib variable (`gov.contrib.ubi_center.wealth_tax`) exists, and wealth data is imputed.
- **Exit tax:** "unlikely" (KPMG).
- **Cap on ISA capital value; lower limit on EIS relief:** suggested by BDO and PKF. Not in PE.
- **Holiday lets charged council tax as second homes:** BDO and Saffery. Ledger, and partly a household effect.
- **Proportional property tax (RF: 0.7%) or land value tax replacing council tax and stamp duty:** ruled out for now (27 Jul).
- **UC or PIP changes:** the IFS options paper puts means-testing PIP at £8.2bn ([IFS, 17 Sep](https://ifs.org.uk/publications/options-reforming-personal-independence-payment); snippet only). Burnham's "no welfare cuts" line and the delayed Milburn report make these unlikely on 28 Oct.
- **Higher VAT registration threshold (£90k to £100k):** BDO. Ledger.

## Top 20, ranked by likelihood × household-scoring relevance

**Scoring.**

- **Likelihood:** high 3, medium-high 2.5, medium 2, medium-low or low-medium 1.5, low 1.
- **Relevance:**
  - 3 means a direct household tax or benefit change that PE can score inside the forecast window.
  - 2 means a household change that is indirect or mostly outside the window.
  - 1 means ledger only or outside PE scope.
- **Ties** are broken by relevance, then likelihood. Ranks 2–4 are a three-way tie at 7.5.

| Rank | # | Measure | Likelihood | Relevance | Score | PE |
|---|---|---|---|---|---|---|
| 1 | 2 | Low-income pensioners kept out of income tax | 3 | 3 | 9 | **new var** |
| 2 | 3 | Warm Home Discount £100 top-up | 2.5 | 3 | 7.5 | **new var** |
| 3 | 1 | Fuel duty delay | 2.5 | 3 | 7.5 | param + modifier |
| 4 | 4 | High Value Council Tax Surcharge to £1.5m | 2.5 | 3 | 7.5 | param |
| 5 | 6 | CGT rate rise | 2 | 3 | 6 | param (**new var** if indexation or a taper) |
| 6 | 5 | Triple lock replaced from 2030 | 3 | 2 | 6 | param (Scenario only) |
| 7 | 8 | LHA relink | 1.5 | 3 | 4.5 | param |
| 8 | 9 | Electricity VAT extension, or extended to gas | 1.5 | 3 | 4.5 | modifier / param (#2189) / new param for gas |
| 9 | 7 | Threshold freeze extended to 2032 | 1.5 | 3 | 4.5 | param |
| 10 | 10 | Small personal allowance rise | 1 | 3 | 3 | param |
| 11 | 11 | Lower additional-rate threshold | 1 | 3 | 3 | param |
| 12 | 12 | Dividend or savings rates raised again | 1 | 3 | 3 | param |
| 13 | 13 | Class 4 NI rise, or NI over State Pension age | 1 | 3 | 3 | param / **new var** |
| 14 | 14 | NI on rental income | 1 | 3 | 3 | **new var** |
| 15 | 15 | Hospitality VAT cut | 1.5 | 2 | 3 | modifier |
| 16 | 16 | HMRC compliance package | 3 | 1 | 3 | ledger |
| 17 | 17 | Business rates package | 3 | 1 | 3 | ledger |
| 18 | 18 | Fiscal devolution roadmap and visitor levy | 3 | 1 | 3 | ledger |
| 19 | 19 | "Your First Home" equity loan | 3 | 1 | 3 | ledger |
| 20 | 20 | Machine Games Duty 20% to 40% | 2.5 | 1 | 2.5 | ledger |

Just outside the 20: the bank surcharge and the Energy Profits Levy (2 each, ledger), employer NI relief (1 × 2), and pension tax-free cash (1 × 2).

## Engine risks for Budget day

These are measure types PE probably cannot score today, in order of how much they matter.

1. **Warm Home Discount (rank 2). Not in the engine, and its £150 baseline is missing too.**
   - Needs a household lump-sum variable keyed on benefit receipt: In England and Wales eligibility is now simple: on the qualifying date (23 August 2026) the claimant or partner gets UC, Housing Benefit, income-related ESA or Pension Credit, and is named on the electricity bill ([GOV.UK](https://www.gov.uk/the-warm-home-discount-scheme/if-you-live-in-england-and-wales)). The page shows no high-energy-cost test. Scotland has its own rules.
   - **Prepare before 28 Oct:** a baseline variable with an amount parameter and a contrib top-up parameter.
2. **Low-income pensioner income tax protection (rank 1). The mechanism is unknown.**
   - `gov.contrib.conservatives.pensioner_personal_allowance` exists but no formula reads it, so a reform dict that sets it does nothing.
   - **Prepare three switchable designs:**
     - (a) a higher personal allowance for those over State Pension age;
     - (b) exempting State Pension income when total income is below a ceiling;
     - (c) an HMRC no-collection easement, which has a near-zero static cost and is not a tax-law change. Score it as "not modelled".
3. **Electricity VAT (baseline and rank 8). PR #2189 is open, not merged.**
   - Until it merges, the `main` baseline charges 5% VAT on electricity from October 2026 to March 2027. That overstates baseline VAT, so any extension would be scored against the wrong baseline.
   - A gas extension needs one new parameter applied to `gas_consumption`.
   - **Merge #2189 (with #2187) before the day.**
4. **Fuel duty with a mid-year date (rank 3).** The 1 January and 1 March change dates need the fiscal-year blend fixes in open PRs #2185 and #2186. Without them a delay from 1 January may be mis-weighted across 2026-27 and 2027-28.
5. **Triple lock (rank 6).** `include_earnings` and `earnings_path_guarantee` change uprating **only through `Scenario(parameter_changes=...)`**. A plain reform dict changes the parameter but not the rates, so the score comes out as a silent zero. The earnings-path benchmark (base year and ratio) is not specified by DWP. Our default reading starts from the 2029-30 level.
6. **CGT with indexation or a taper (rank 5).** PE has rates, the annual exempt amount and Business Asset Disposal Relief, but no holding period or base cost, so indexation or a taper needs a new variable or cannot be modelled. A static PE yield ignores forestalling, which outside estimates say dominates the early years. Report OBR's behavioural figure alongside.
7. **High Value Council Tax Surcharge threshold (rank 4).** This is a parameter change, and the owner-only fix (#2164) is merged. Two risks remain:
   - Property values in the data are imputed, so the count around £1.5m is uncertain. Check it against the 245k–272k press figure.
   - PwC's possible non-resident surcharge needs a residency variable, which does not exist.
8. **NI on rental income, or NI over State Pension age (ranks 13–14).** Both need new NI logic.
9. **Not modelable in PE at all:** inheritance tax and APR/BPR, CGT uplift on death, pension tax-free cash caps, an ISA value cap, an exit tax, the equity loan, and all ledger items.

## Appendix A: how often the firm previews list each item (8 October)

| Measure | Firms | Count |
|---|---|---|
| CGT rate rise or alignment | BDO, Grant Thornton, PwC, KPMG, Saffery, PKF, Blick, Rathbones, HL, ii, AJ Bell, Buzzacott, CIOT | 13 |
| Personal allowance or thresholds | BDO, GT, PwC, KPMG, PKF, Rathbones, ii, AJ Bell, EY | 9 |
| High Value Council Tax Surcharge to £1.5m | BDO, Saffery, PwC, ii, CIOT, KPMG | 6 |
| APR/BPR | GT, Saffery, Rathbones, ii, Buzzacott | 5 |
| Business rates | BDO, GT, Saffery, PwC, ICAEW | 5 |
| CGT uplift on death | Saffery, PKF, Blick, Rathbones, BDO | 5 |
| Pension tax-free cash | BDO, PKF, Rathbones, ii | 4 |
| Bank tax / EPL / hospitality VAT / HMRC compliance / employer NI / 50p or threshold / salary sacrifice | 3 each | 3 |
| Fuel duty freeze; VAT on energy | BDO, KPMG | 2 |

Deloitte and RSM had no 2026 preview; their previews found are from the November 2025 Budget. PwC and Blick were read through the r.jina.ai reader because direct fetches were blocked. KPMG's page is undated.

## Appendix B: baseline facts to load on the day (not reforms)

- **September CPI (published about 21 Oct):** uprates benefits from April 2027. August CPI was 3.1% ([BoE](https://www.bankofengland.co.uk/monetary-policy-summary-and-minutes/2026/september-2026)).
- **State Pension:** the new State Pension is £241.30 a week in 2026-27 (engine value; [DWP snippet](https://www.gov.uk/government/news/over-12-million-pensioners-to-receive-575-state-pension-boost)). The April 2027 triple lock rise is reported as 3.9% ([Express via AOL, 15 Sep](https://www.aol.co.uk/articles/martin-lewis-issues-state-pension-134700000.html)). An earlier Express piece (6 Sep) said 3.4%; we did not capture its URL, so treat that figure as unverified. Use the official figure on the day; at 3.9% it is about £250.70 a week, or £13,036 a year.
- **National Living Wage:** the Low Pay Commission's recommendation is due in October. The engine does not re-simulate earnings.

## Gaps in this update

- **Not out yet:** the IFS Green Budget (main launch 14 Oct) and the RF pre-Budget report (13 Oct). Both should be added when published.
- **Not found:** NIESR's Autumn Outlook, and any 2026 pre-Budget output from JRF or the Fabian Society.
- **Not covered by October news searches** (the search quota ran out): UC uprating detail, PIP, Carer's Allowance, childcare, student loans, alcohol, tobacco and sugar duties, and VAT on private schools.
- **Inaccessible:** Treasury Committee pages and the Lords Library returned 403.
