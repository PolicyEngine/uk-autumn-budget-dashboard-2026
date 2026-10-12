# Budget-day model risk register: where the PolicyEngine UK model and data most need challenging

Updated 8 October 2026. This is real research for the 28 October Budget, not MOCK data. It lists *kinds* of measure that would expose each weak spot, never the drill 3 measures.

**Blindness note.** The drill 3 packet was written separately and sealed. This register does not say which areas the packet uses.

## Sources

- **Scorecard.** `PolicyEngine/policyengine-scorecard` at `99f1cc1`, local clone `/Users/vahid/policyengine-scorecard`. Its UK results run on the certified bundle: **policyengine-uk 2.89.2** with `populace-uk-2023-…20260619T023711Z` (`data/uk/certified_bundle.json`). Some engine bugs have been fixed since; for example, the Class 4 limit bug was fixed in 2.102.1. Treat the scorecard ratios as evidence of *where* the model is weak, not as current-engine values.
- **Drill 2** (5 Oct 2026):
  - dashboard PR `PolicyEngine/uk-autumn-budget-dashboard-2026#7` and issue #8;
  - `data_inputs/mock_drill2/MOCK-drill2-reconciliation.csv`, `MOCK-drill2-scoring.csv` and `packet/MOCK-drill2-answer-key.csv` on branch `drill2-mock-budget`;
  - the follow-up issues in policyengine-uk and microcosm;
  - the follow-up comment on PolicyEngine/uk-cgt-reform#2 and the filed issues listed below.

## What drill 2 taught us about drill design

Households were scored almost perfectly. **78 of 80 rows matched the key to 1p.** The two misses were State Pension 5p rounding, since fixed in `3910fee`.

National figures were the weak point. The G3 sign-off was only *qualified*:

| Measure | Our figure | Costing figure | Gap |
|---|---|---|---|
| CGT, 2027-28 | +£4.42bn | £1.85bn static | +139% |
| Fuel duty, 2027-28 | −£1.16bn | −£2.245bn | 48–52% short every year |
| Employer NI, 2027-28 | −£1.32bn net | −£2.25bn gross | different bases |
| Electricity VAT, 2027-28 | −£1.25bn | −£1.76bn | −29% |
| HVCTS | ~100k properties | 140k properties | |
| Energy payment | 7.06m payments | 5.8m payments | |

Two of the four "calibration" flags raised on the day were later withdrawn: the comparator was wrong.

So drill 3 should put more weight on four things:

1. national static versus post-behavioural reconciliation;
2. timing conversions;
3. classifying what is and is not modelled;
4. comparing like with like (net versus gross, households versus all fuel).

Household traps still matter, but mainly where a household reveals a *model* gap rather than an arithmetic slip.

## Ranked summary

| Rank | Challenge area | Main type | Why it ranks here |
|---|---|---|---|
| 1 | Threshold freeze extension: income tax and NI on different baselines | Timing / baseline | Very likely real measure. The NI legs are not frozen in the engine. OBR Class 1 freezes come out with the **wrong sign** (−0.52 to −0.58×) |
| 2 | Engine and dataset version pairing | Process | Every national figure in drill 2 was "unvalidated under the newer engine" (2.120.0 engine, data built under 2.100.0). The engine changed again on 7 Oct |
| 3 | CGT: forward path, static gap, behaviour, forestalling | Behavioural / data | +139% static gap; liabilities +42/+23/+13% above OBR; elasticity 0; no income tax offset |
| 4 | Employer NICs: incidence default and business boundary | Behavioural / coverage | `employee_incidence = 1` by default; like-for-like gap −£12.67bn; no Employment Allowance (+£4.58bn) |
| 5 | Top incomes: additional rate, higher-rate threshold, top rates | Data (top tail) / behavioural | ART cut 1.96–2.23× OBR; reckoner 1.5–2.2×; no SPI comparison ever run |
| 6 | UC take-up and the child-related benefit caseload | Distributional / data | UC take-up 0.55 (dated 2015) against 0.80–0.82 elsewhere; two-child limit 0.43–0.59× HMT/OBR |
| 7 | High-value property and wealth top tail | Data coverage | `main_residence_value` stops at ~£2.8m; 0 homes above £3.5m against OBR's 40k; let and second homes missing (~40% of the base) |
| 8 | Mid-year starts and fiscal/calendar conversion | Timing | Dated reforms on blended parameters come out 37% short (#2167). Calendar year is used as a proxy for fiscal year, and a step dated 6 April is read at 1 January |
| 9 | Fuel duty: households only, and the price divisor | Coverage / data | Model has ~22bn litres against 43bn; cars residual −15.2%; national figure ~50% short |
| 10 | VAT and energy: no energy VAT path, stale VAT scaling | Data / engine | No electricity-specific VAT (#2166); `microdata_vat_coverage` 0.383 since 2010, VAT 21–70% above OBR (#1996) |
| 11 | Devolved nations: Scotland, Wales, Northern Ireland | Devolved | Scottish 48% threshold wrong (#2130); no devolved lane (#58); 3,318 sub-national claims unanswered; NI eligibility for GB-only payments |
| 12 | Pensions: State Pension, Pension Credit and pension tax reliefs | Distributional / not expressible | Pension Credit guarantee still CPI-linked (#2072, fix PR closed); lump sum not expressible; salary-sacrifice cap 0.18–0.47× |
| 13 | Savings, dividend and property income | Data / timing / double count | Savings +2pp 2.1–2.5×; SRS limit flat since 2010; dividend thresholds lag; property income rates already in baseline |
| 14 | SDLT and council tax projections | Engine / double count | Corporate SDLT counted twice, +£3.13bn (#2159); LBTT and LTT collapse under reform; council tax growth may be double counted (#2067) |
| 15 | Stacking and interactions between measures | Interaction | HICBC 2.7–3.0× (claiming fixed, welfare head 0); CGT income tax offset missing; net `gov_balance` hides offsets |

Ranking rule: (chance a real Budget measure touches it) × (size of the likely error) × (how little the scorecard has validated it). The top four combine a probable 28 October measure with a known error of over £1bn.

---

## The challenge areas in detail

Each area has six parts: the evidence, the mock measure that would stress it, the specimen household that exposes it, the correct team response, and what the answer key should test.

### 1. Threshold freeze extension: income tax and NI on different baselines

**Evidence**

- Income tax thresholds are frozen to 2030-31 in the engine. The NI thresholds are not:
  - the primary threshold and UEL uprate from April 2028;
  - the Class 4 limits uprate from April 2027.
  - Source: `ab2025_measures.json`, `personal_tax_thresholds_freeze_to_2031.baseline_integrity_note` ("MIXED"); policyengine-uk#1879.
- AB2025 freeze, NICs head (`results/uk/obr_costings/COMPARISON.csv`): PE £0 against OBR +£0.16bn, +£0.33bn and +£0.53bn for 2028-29 to 2030-31.
- EFO March 2026 Class 1 NICs threshold freezes: OBR +£10.2bn to +£14.2bn against PE −£5.9bn to −£7.3bn. The ratio is **−0.52 to −0.58: the wrong sign.**
- "NICs rise in primary threshold": 0.02–0.21×.
- The Class 1 employee leg sits near a sign flip. The break-even ratio is 0.4995 and the data has 0.521 (scorecard PR #142). A 4% change in the high-earner count flips the sign.
- In the first year, a full calendar year 2028 stands in for FY2028-29. That gives a ratio of 1.44 against HMT (`results/uk/staged_ab2025/ab2025_counterparts.jsonl`), and 1.21 (mapped total) / 1.25 (income tax head) against OBR in `COMPARISON.csv`, all on 2.89.2.

**Mock measure.** Extend the income tax *and* NI threshold freeze by one or two years (to 2031-32), and/or freeze the Class 4 limits. Score 2028-29 to 2031-32.

**Specimen household**

- Employee on about £52,000, just above the higher-rate threshold and below the UEL.
- Self-employed person on £60,000 profit, to expose the Class 4 path.

**Correct team response**

- Build an *indexed counterfactual* for every leg (income tax, Class 1, Class 4).
- State that the engine baseline uprates NI from 2028 while income tax is frozen.
- Report each tax head separately.
- Ledger row: "freeze, scored against the indexed path; NI legs constructed by hand".

**What the answer key should test**

- Household: the statutory change for both specimens in each year.
- National: the sign and size of the NI leg against the static costing (a wrong sign is an automatic fail).
- Classification: a "constructed counterfactual" row, not a plain parameter edit.

### 2. Engine and dataset version pairing

**Evidence**

- Drill 2 ran engine 2.120.0 / core 3.32.17 on a dataset built and certified under 2.100.0 (reconciliation header). The shared API was 2.90.2, so Personal impact needed a local backend.
- María's 6 Oct audit: the national figures are "unvalidated under the newer engine", not uncalibrated.
- policyengine-uk #2163, #2164 and #2165 merged on 7 Oct, so the engine has changed since drill 2.
- The scorecard pins **2.89.2** and refuses newer engines without a re-certified bundle (scorecard PR #126). So known bugs stay in published scorecard artefacts. Example: the Class 4 bug gave £2,307 against a statutory £3,282 at £100k profit.
- `claims_pension_credit` was silently dropped by the API: it returned 200 and defaulted to True.

**Mock measure.** Not a policy measure. Add a process inject: an engine patch release lands mid-drill, or the packet requires a reproducible re-run from a stated commit and dataset hash.

**Specimen household.** Any household whose answer moved across the 7 Oct merges:

- a State Pension reform household (#2163);
- an employer NI £5,000 threshold case (#2165).

**Correct team response**

- Freeze a *matched* engine and dataset pair by 21 Oct.
- Record the engine version, core version, dataset sha and API version on every output.
- Refuse a mid-drill upgrade unless re-certified.
- Run every new household input end to end through the API path.

**What the answer key should test**

- Each output row carries the frozen pair.
- The household value is reproducible from the logged SHA.
- The ledger has a "version" row stating which known bugs are present in the frozen engine.

### 3. CGT: forward path, static gap, behaviour, forestalling

**Evidence**

- Drill 2 CGT gap was +139% in 2027-28 (+£4.42bn against £1.85bn static) and +116–139% across all years.
- The 2024-25 base matches HMRC: liability £23.3bn against £22.5bn. But the forestalling spike is uprated by GDP per capita, so liabilities run **+42% / +23% / +13%** above OBR for 2025-26 to 2027-28. Source: [uk-cgt-reform#2 comment](https://github.com/PolicyEngine/uk-cgt-reform/issues/2#issuecomment-6014594940); microcosm#875 was closed not-planned.
- `capital_gains_responses.elasticity` = 0. The scorecard sweep has no cited value (`data/uk/cgt_alignment_reform.json`, scorecard #97 / PR #102).
- There is no income tax offset to behaviour; OBR's is about 30% (policyengine-uk#1982).
- In Table 4.1, 2026-27 is +£0.45bn from forestalling, against a static £0.
- The reckoner registry says CGT rate changes are "not expressible" while the Budget registry says they are expressible.

**Mock measure.** A CGT rate rise effective from Budget day (mid-year, 29 Oct 2026), or alignment with income tax rates. Score 2026-27 (part-year plus forestalling) and 2027-28.

**Specimen households**

- Basic-rate employee whose gain straddles the higher-rate band.
- Scottish taxpayer selling shares: CGT bands use rUK income tax bands, not Scottish ones.
- Seller with disposals both before and after Budget day in 2026-27.

**Correct team response**

- Score statically on the engine.
- Report the forward-year base problem separately, with OBR's receipts path as the stated comparator.
- Do not cite any post-behavioural figure without a sourced elasticity.
- Show forestalling as a ledger line, not a model output.
- Pro-rate the part-year by disposal date.

**What the answer key should test**

- Household: statutory CGT for the straddling and Scottish cases, and the pre/post Budget-day split.
- National: the static gap with the base-path cause *named*, not "calibration".
- Classification: forestalling and behaviour go in the ledger as "not modelled".

### 4. Employer NICs: incidence default and business boundary

**Evidence**

- `employee_incidence` defaults to 1 (policyengine-uk#2168, open). A £40k worker at +1pp scores +£217.29 by default against +£350.08 at fixed wages.
- Like-for-like gap against OBR on AB2024 employer NICs: −£12.67bn. The income tax head is −£8.5bn in PE against −£0.31bn at OBR. There is no Employment Allowance (+£4.58bn). Source: scorecard PR #67, #78.
- Drill 2: −£1.317bn net `gov_balance` against −£2.25bn gross static (reconciliation measure 5). The closest-basis residual is 28.8%.
- The secondary threshold was £4,992 rather than £5,000; fixed in #2165.
- AB2025 secondary threshold freeze: 0.68–0.71× on the mapped total.

**Mock measure.** An employer NI rate rise, or an Employment Allowance change, or a secondary threshold change. Score 2027-28 to 2030-31.

**Specimen households**

- Employee on £40k (static household change £0; non-zero if the default incidence is left on).
- Small-firm owner-director (the Employment Allowance case: ledger only).

**Correct team response**

- For static household scoring, set all three incidence parameters to 0.
- Nationally, report *gross employer contributions* to match the costing, and report the pass-through as a separate post-behavioural line.
- Ledger the Employment Allowance as not expressible.

**What the answer key should test**

- Household: £0 statutory change for the employee.
- National: gross static and post-behavioural figures stated separately, on the same basis as the costing.
- Classification: Employment Allowance and firm-side effects are "out of model scope".

### 5. Top incomes: additional rate, higher-rate threshold, top rates

**Evidence**

- EFO March 2026 additional-rate threshold cut: PE £1.84bn to £2.35bn against OBR £0.94bn to £1.05bn, **1.96–2.23×** and rising each year (`COMPARISON.csv`).
- PA/HRT freezes 1.29–1.40× (scorecard #59).
- Ready reckoner 2026-27: Class 1 employee additional rate +1pp 2.20×; basic rate limit 1.46–1.51×; upper profits limit 1.52×.
- The behavioural and top-income-composition axes are unsized. No HMRC SPI top-income comparison has been run (`data/lanes.json`; hmrc-personal-tax lane has PE values for 14 of 777 rows).

**Mock measure.** Cut the additional-rate threshold to £100,000, or raise the additional rate by 2pp. Score 2027-28.

**Specimen households**

- Employee on £180k.
- Employee on £110k inside the PA taper (60% effective band).

**Correct team response**

- Give the static figure with an explicit "PE runs about 2× OBR on top-rate changes" caveat.
- Apply a sourced taxable income elasticity only as a labelled sensitivity.
- Name the SPI top-tail check as not done.

**What the answer key should test**

- Household: statutory values, including the taper interaction.
- National: whether the team shows a static figure *and* the size of the static-to-post-behavioural gap with a cited source.
- Ledger: "TIE response: sensitivity, not central".

### 6. UC take-up and the child-related benefit caseload

**Evidence**

- `gov.dwp.universal_credit.takeup_rate` = **0.55** (dated 2015), against RF/Landman 0.80 and Scottish Government 0.82 (`data/uk/takeup_assumptions.json`, scorecard #130).
- Two-child limit removal: 0.43–0.59× HMT/OBR. Under forced full take-up it is about 0.98×. A previous PE number was £2.9bn (1.3×). Sources: `ab2025_measures.json`, scorecard #136.
- There is no UC administrative caseload comparison (scorecard #87).
- Forcing take-up zeroed pensioner HB (380k recipients, £2.62bn). The fix (#135) has been tested only, never run (#128).
- In drill 2, energy payment counts were 7.06m against 5.8m. The 5.8m was the wrong comparator; DWP benefit units match (6.36m against 6.40m).

**Mock measure.** A UC child element or standard allowance change, or a one-off payment to UC recipients. Score the first full year.

**Specimen households**

- Couple on UC with three children.
- Eligible non-claimant family (statutory gain > £0, but the model scores its expected value at 0.55).

**Correct team response**

- Report national cost under the engine take-up *and* under a cited take-up such as DWP, side by side.
- Separate entitlement (household) from expected receipt (national).
- Check the comparator's unit (payments, benefit units or households) before calling it a gap.

**What the answer key should test**

- Household: full entitlement amount.
- National: the take-up sensitivity range shown, and the comparator unit stated.
- Ledger: "take-up 0.55 is a known low assumption".

### 7. High-value property and wealth top tail

**Evidence**

- `main_residence_value` stops at £2,821,389, about £3.03m in 2026; 334 records share the maximum (microcosm#1112).
- England bands, model against OBR:

  | Band | Model | OBR |
  |---|---|---|
  | £2.0–2.5m | 40k | 71k |
  | £2.5–3.5m | 106k | 54k |
  | £3.5m+ | 0 | 40k |

- 28.5k of the £2m+ homes are in the East Midlands.
- HVCTS misses let, second and company-held homes, about 40% of the OBR base (#2171). Drill 2: 99.7k properties against 140k.
- Renters were being charged; fixed in #2164.
- A wealth tax would resolve, but on survey-imputed `total_wealth` (`budget_2026_measures.json`).

**Mock measure.** A new HVCTS band above £5m, or a change to the £2m threshold, or a 2% wealth tax above £10m. Score 2028-29.

**Specimen households**

- Owner-occupier of a £6m home (the model cannot place them).
- Private renter in a £2.5m flat (statutory £0 for the tenant; the landlord pays).
- Owner of a second home.

**Correct team response**

- Score only the bands the data reaches.
- Ledger the £3.5m+ band and non-owner-occupied homes as data-coverage gaps, with OBR counts.
- Do not let a top band produce £0 silently.

**What the answer key should test**

- Household: statutory charge for the £6m owner (the model will say otherwise).
- National: the coverage share named.
- Classification: "data ceiling, not a zero".

### 8. Mid-year starts and fiscal/calendar conversion

**Evidence**

- Dated mid-year reforms on `fiscal_year_blend` parameters are not day-weighted. The example comes out 37% short: +£24.19 against +£38.26. A single-date key gives a one-day effect (policyengine-uk#2167).
- Every scorecard counterpart uses calendar year as a proxy for fiscal year, with an assumed 3:1 accrual (PR #67). Twenty-two IFS rows use the start-year convention.
- A step dated 6 April 2029 is read at 1 January (salary-sacrifice cap, scorecard PR #110).
- In drill 2, the energy payment used "any receipt in 2026" as a proxy for "receipt on 1 December".

**Mock measure.** A duty or VAT change starting 1 October or 1 January, plus a one-off payment on a qualifying date. Score the split fiscal year.

**Specimen households**

- Household with even monthly fuel or energy spend.
- Household that starts claiming UC after the qualifying date (statutory £0).

**Correct team response**

- Build monthly values and sum April to March.
- State the proration in the ledger.
- Use the qualifying date, not annual receipt, for one-off payments.
- Never feed a single-date key to a blended parameter.

**What the answer key should test**

- Household: exact days or months weighting.
- National: the split-year figure against the costing.
- Classification: an "FY proration" exception row.

### 9. Fuel duty: households only, and the price divisor

**Evidence**

- Drill 2 national fuel duty came out 48–52% short every year (reconciliation measure 1). Implied volume was ~22bn litres against 43bn.
- Freight and business fuel are not in household data. Households are about 9% low against ONS.
- Price divisors are January 2024 RAC prices (£1.44/£1.52). The cars fuel duty residual is −15.2% (£12.2bn against £14.4bn), and passes only because the gate is 25% (#2169).

**Mock measure.** A staged fuel duty rise or a cut ending mid-year.

**Specimen households**

- NI diesel household (drill 2's H4 shape).
- Rural petrol-heavy driver.

**Correct team response**

- Score households, then state the business share as a ledger line with a sourced split rather than scaling up.
- Note the divisor basis.

**What the answer key should test**

- Household: litres × duty change × 1.2 for VAT, month-weighted.
- National: whether the team labels the figure "household-only" and quantifies the missing share.
- Ledger: "business fuel: out of scope".

### 10. VAT and energy: no energy VAT path, stale VAT scaling

**Evidence**

- No electricity-specific VAT. Domestic fuel sits in a flat 2.5% reduced-rate share. Repro: `vat` is £5,328.95 whether electricity is £1,200 or £5,000 (#2166).
- `microdata_vat_coverage` = 0.383 since 2010. The implied value is 0.65 (EFRS) or 0.46 (Microcosm), putting VAT 70% or 21% above OBR (#1996; not recommended for change before 21 Oct).
- Electricity level choice: ONS £26.5bn against DESNZ × QEP £29.4bn. Ofgem FY2026-27 prices against QEP FY2024-25 (microcosm#1113).
- Drill 2 electricity VAT was −29% against a mock base of £35bn.

**Mock measure.** Zero-rate domestic energy VAT for a period, or a standard VAT rate change of 1pp. Score 2027-28.

**Specimen households**

- All-electric home in Wales on UC (drill 2's H10 shape).
- Gas-heated household.
- NI oil-heated household (heating oil also at 5%).

**Correct team response**

- Score the energy VAT change off household energy spend by hand.
- Do not rely on the engine's VAT for energy.
- For a standard rate change, show the 0.383 caveat.

**What the answer key should test**

- Household: spend ÷ 1.05 × rate change.
- National: the base stated (ONS or DESNZ) and its source.
- Classification: "constructed outside engine".

### 11. Devolved nations: Scotland, Wales, Northern Ireland

**Evidence**

- The Scottish 48% threshold is stored as £112,570 rather than £125,140. That is £377.10 too much per taxpayer, about 25k taxpayers and £9.5m a year (#2130, open; mirrored in rulespec-uk).
- There is no devolved lane in the scorecard (#58). The Scottish block-grant head is unmapped, and 3,318 AB2025 sub-national claims are unanswered (PR #142).
- LBTT falls from £2.03bn to £0.09bn and LTT from £0.071bn to £0.003bn under an SDLT reform (`fix-plan-2159.md`).
- In drill 2, an NI UC household received the GB-only £150 (fixed during the drill).

**Mock measure.** A UK-wide income tax rate or threshold change that applies only to rUK non-savings income. Or a GB-only payment. Or an SDLT change, with LBTT and LTT unaffected.

**Specimen households**

- Scottish employee on £130k.
- Welsh taxpayer.
- NI household for a GB-only measure.

**Correct team response**

- Apply devolution rules correctly.
- State Barnett and block-grant effects as out of scope.
- Note #2130 if any Scottish top-rate taxpayer is scored.

**What the answer key should test**

- Household: the Scottish taxpayer is unaffected by rUK rate changes on earnings, but affected on savings and dividends; the NI household gets £0 from a GB-only payment.
- National: rUK-only scope.
- Classification: "block grant: out of scope".

### 12. Pensions: State Pension, Pension Credit and pension tax reliefs

**Evidence**

- #2163 fixed the household path for State Pension reforms. Protected payments are still open (#1941).
- The Pension Credit guarantee is still projected by CPI. PR #2146 was closed without merging (#2072). Drill 2 needed a hand fix.
- State Pension rates are not rounded to 5p.
- `claims_pension_credit` had to be wired into the API after the drill.
- Drill 2 SP personal allowance measure ran −20% to +38% against the costing by year. SP uprating was −39% gross (+12% on the post-behavioural basis).
- The pension tax-free lump sum is not expressible. Pensions have zero validation rows (#98).
- Salary-sacrifice cap is 0.18–0.47× HMT/OBR, with a default 0.16% pay haircut on and the employee response off (`nics_salary_sacrifice_reform.json`).

**Mock measure.** A triple-lock change, or a lump-sum cap cut, or a tighter salary-sacrifice cap.

**Specimen households**

- New State Pension non-claimer of Pension Credit.
- Basic State Pension plus Pension Credit (the Pension Credit offset).
- £60k employee sacrificing £5k.

**Correct team response**

- Round to 5p where statute and DWP practice do.
- Uprate the Pension Credit guarantee by earnings.
- Ledger the lump sum as not expressible.
- State the salary-sacrifice assumptions explicitly.

**What the answer key should test**

- Household: values with the Pension Credit offset and 5p rounding.
- National: gross spending against net `gov_balance`, stated.
- Classification: lump sum = "not expressible".

### 13. Savings, dividend and property income

**Evidence**

- AB2025 savings +2pp: 2.1–2.5× HMT, because the starting rate for savings leg is omitted. The SRS limit has been £5,000 since 2010.
- Dividend first year 3.1× (forestalling and incorporation responses).
- Dividend thresholds lag the main bands (#1822).
- Property income rates are already in the baseline, so there is a double-count risk (`baseline_integrity.json`).

**Mock measure.** A further 2pp on dividends, or an ISA limit cut (not expressible: no ISA holdings).

**Specimen households**

- Retiree with £18k savings interest and low other income (SRS band).
- Owner-director taking dividends.

**Correct team response**

- Check the SRS and threshold paths before scoring.
- Do not re-apply measures already in the baseline.
- Ledger the ISA change.

**What the answer key should test**

- Household: statutory values for the SRS case.
- National: the forestalling gap named.
- Classification: "already in baseline" as a correct no-op.

### 14. SDLT and council tax projections

**Evidence**

- Corporate SDLT is counted twice, and `expected_sdlt` adds 0.045 rather than multiplying. The overstatement is **£3.13bn**, and one copy survives SDLT abolition (#2159, open; `fix-plan-2159.md`).
- The council tax projection may double count tax-base growth (#2067, unconfirmed).
- A council tax or SDLT to land value tax switch is only partly expressible (`budget_2026_measures.json`).

**Mock measure.** An SDLT band change or abolition for main homes, or a council tax revaluation.

**Specimen household.** First-time buyer buying in 2027-28. Note that this is a transaction tax, so it is annualised.

**Correct team response**

- Check the engine SDLT baseline against HMRC receipts before scoring.
- Score the household transaction directly.
- Ledger the corporate SDLT defect.

**What the answer key should test**

- Household: statutory SDLT on the purchase.
- National: whether the team spots that the baseline overstates by about £3bn.
- Classification: "engine defect: known, filed".

### 15. Stacking and interactions between measures

**Evidence**

- HICBC threshold and taper: 2.7–3.0× OBR. The PE welfare head is £0 against OBR −£0.39bn to −£0.47bn, because Child Benefit claiming is fixed (`COMPARISON.csv`).
- Class 4 cuts: PE gives £0 on the income tax head against OBR's positive offset.
- The CGT income tax offset is missing (#1982).
- Net `gov_balance` mixes offsets: drill 2 SP uprating was net against gross.

**Mock measure.** A package of a freeze extension, a basic-rate cut and a HICBC threshold change, scored individually and as a package.

**Specimen households**

- Household with child benefit at £70k.
- Self-employed person near the threshold.

**Correct team response**

- State the stacking order (the HMT/OBR order) and that the parts do not sum to the package.
- Show each tax head.
- Ledger missing behavioural heads.

**What the answer key should test**

- Household: measure-alone values against the package value.
- National: whether the interaction term is reported.
- Classification: an interaction row exists.

---

## Coverage by type

| Type | Areas |
|---|---|
| Distributional | 6, 12, 7 |
| Timing (fiscal/calendar, mid-year) | 1, 8, 3, 9 |
| Behavioural | 3, 4, 5, 13, 15 |
| Data coverage: top tails | 5, 7 |
| Data coverage: business vs household | 4, 9, 14 |
| Data coverage: devolved | 11, plus households in 3, 9, 10 |
| Interaction / stacking | 15, 1 |
| Process: version freeze, engine/dataset mismatch | 2 |

## Suggested drill 3 shape

Use a packet of six to eight measures covering ranks 1, 3, 4, 7, 8 and 11. Score the answer key on three things:

1. statutory household values;
2. a reason the team states for its static versus costing gap, for each measure-year, with the cause named or "unexplained" (not "calibration");
3. a correct ledger class for each line: modelled, constructed, sensitivity, data ceiling, out of scope, or already in baseline.

Weight 2 and 3 more heavily than in drill 2, since the household rows are close to solved.
