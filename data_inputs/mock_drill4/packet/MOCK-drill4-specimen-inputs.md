MOCK DATA: rehearsal Budget for PolicyEngine drill 4, 19 October 2026. Not a real Budget.

# Specimen households and scoring templates for drill 4

*Released at 13:40 BST with the Budget documents.*

## Household scoring

Fourteen households, facts only. For each household and each row of `MOCK-drill4-household-scoring.csv`, work out the change in annual household net income from **that measure on its own**, against the pre-measures baseline in Annex A, in the scoring year shown. Two rows are different: **"1, 3 and 7 together (stacked)"** asks for the change from measures 1, 3 and 7 applied together, and **"5 and 18 together (stacked)"** for measures 5 and 18 together, each against the same baseline. Log each figure in £ a year to the penny in `team_change`, note any assumption, and pin the run in `run_sha`.

| Measure | Scoring year(s) |
|---|---|
| 1 Threshold freeze to 2032 | 2031-32 |
| 3 State Pension Top-up Allowance | 2027-28 |
| 4 Warm Home Discount top-up | 2026-27 |
| 5 Fuel duty | 2026-27, 2027-28 |
| 7 Starting rate for savings | 2028-29 |
| 8 Capital Gains Tax higher rate | 2027-28 |
| 11 Local Housing Allowance | 2027-28 |
| 12 Employer NICs for young workers | 2027-28 |
| 14 Universal Credit child element | 2027-28 |
| 17 Child Benefit Early Years Addition | 2027-28 |
| 18 VAT on road fuel | 2026-27, 2027-28 |
| 20 Stamp Duty Land Tax surcharge | 2027-28 |
| 21 Carer's Allowance earnings limit | 2027-28 |
| 1, 3 and 7 together (stacked) | 2031-32 |
| 5 and 18 together (stacked) | 2026-27 |

### Scoring basis, stated once

- **Years.** Income tax, National Insurance, Capital Gains Tax, Child Benefit and Carer's Allowance rows use the tax year (6 April to 5 April). Fuel, VAT, Warm Home Discount, Universal Credit, Local Housing Allowance and Stamp Duty Land Tax rows use the financial year (1 April to 31 March). The scoring-year label names both.
- **Static.** Each measure on its own against Annex A, except the two stacked rows. No behavioural response: earnings, pensions, savings interest, rents, gains, purchase prices and fuel litres are fixed in cash at the stated amounts in every year.
- **State Pension.** The Annex A weekly rates, which are already rounded to the nearest 5p; annual State Pension = 52 × the weekly rate.
- **Claims and elections.** Every claim and election is stated in the household's facts, including Pension Credit, Universal Credit, Child Benefit, Carer's Allowance or Carer Support Payment, and Marriage Allowance. A household claims nothing that is not stated. Where a household receives Universal Credit, the award is positive in every assessment period; compute Universal Credit as 12 × the monthly amount, with no intermediate rounding. Income tax and NICs changes pass through the Universal Credit taper as stated in Annex A.
- **Household net income** is what the household receives after direct taxes and benefits, less the indirect taxes and Stamp Duty Land Tax it pays. Employer National Insurance is the employer's cost, not the household's. Council tax, domestic rates and Council Tax Reduction are held at the stated amounts.
- **Fuel.** Use the stated litres a year, spread evenly over the days of the financial year (365 days in 2026-27; 366 in 2027-28, which includes 29 February 2028). The pump price is the Annex A product price plus duty, plus VAT on both. Score the change in what the household pays at the pump, including VAT.
- **Bill credits** count as household income in the financial year they are credited.
- **Capital Gains Tax.** Score the change in the liability for the tax year of the disposal, whenever it is paid.
- **Stamp Duty Land Tax** counts in the financial year of the effective date, as a reduction in household net income.
- **Child Benefit.** Count benefit weeks: a benefit week starts on a Monday, and counts in the tax year in which its Monday falls. A child's Child Benefit (and any Early Years Addition) is payable for a benefit week whose Monday is on or after the child's birth (and, for the addition, before their first birthday).
- **Rounding.** No intermediate rounding of tax, benefit or fuel amounts. Allowances are the whole-pound amounts stated in Annex A or produced by the rounding rule a measure states. Round each final change to the nearest penny, halves rounded away from zero.

## National scoring

`MOCK-drill4-national-scoring.csv` has one row for each costed measure and financial year, plus one row for the interaction of measures 1, 3 and 7 in 2031-32. For each row, record:

- the costing's static and post-behavioural figures (£m), copied from the costings document and Table 4.1;
- your own figure (£m), or `not computable` where the measure cannot be computed (never £0 for a measure you could not compute);
- the basis of your figure in four columns: gross or net; cash or accrued; duty only, VAT-inclusive or not applicable; fiscal or calendar years; plus its coverage (households only or whole economy, and which nations);
- one explanation class for any gap of more than 10% between your figure and the costing's **static** figure, and one for the gap to the **post-behavioural** figure, each from this closed list:

  `behavioural`, `coverage_business`, `top_tail_data`, `timing_fiscal_calendar`, `incidence_basis`, `baseline_mismatch`, `data_forward_path`, `devolved`, `interaction`, `takeup_caseload`, `none_expected`

- the measure's route class and cause class (as in the ledger), a one-line rationale, the run SHA, and whether the row was re-run after the 14:20 inject.

## Coverage ledger

`MOCK-drill4-ledger.csv` has one row for each Table 4.1 line. Classify each as `coded` or `ledger`, give its route class and its cause class, and a one-line reason. Route classes:

  `dashboard-param`, `dashboard-structural`, `pe-uk-param`, `pe-uk-variable`, `data`, `ledger`, `not-computable`

Cause classes:

  `parameter`, `formula`, `data_missing_input`, `data_calibration`, `behavioural`, `basis`, `not_in_scope`

Each CSV's first line is the MOCK line: skip one line when reading it (pandas: `skiprows=1`).

## H1: Single employee on £56,000 (England)

- **Where and household:** South East (Reading). Single. Private tenant paying £1,350.00 a month.
- **People and incomes:** adult, 41: employment earnings £56,000.00 a year from a private-sector employer.
- **Claims and elections:** Claims no benefit of any kind, including Universal Credit and Child Benefit (no children). Not eligible for Marriage Allowance (single). Pension Credit does not apply: nobody in the household has reached State Pension age.
- **Pensions, savings, gains and transactions:** Has opted out of the workplace pension: no pension contributions of any kind and no salary sacrifice. No savings interest (all savings are in a cash ISA). No capital gains, dividends or property income.
- **Other inputs:** 1,100 litres of petrol a year, all private motoring. Council tax £2,050.00. Buys no property.

## H2: Scottish employee on £38,000 who sells shares and buys a holiday cottage

- **Where and household:** Scotland (Glasgow). Scottish taxpayer. Single. Owner-occupier of a flat valued at £210,000.00.
- **People and incomes:** adult, 46: employment earnings £38,000.00 a year from a private-sector employer.
- **Claims and elections:** Claims no benefit of any kind. Not eligible for Marriage Allowance (single). Pension Credit does not apply: nobody in the household has reached State Pension age. Does not claim Universal Credit.
- **Pensions, savings, gains and transactions:** No pension contributions and no salary sacrifice. No savings interest (all savings are in a cash ISA). Sells shares held outside an ISA on 15 July 2027 for a gain of £25,000.00; no other gains or losses in 2027-28; no losses brought forward. Buys a holiday cottage in Perthshire on 1 September 2027 for £180,000.00 (an additional dwelling; effective date 1 September 2027).
- **Other inputs:** 800 litres of petrol a year, all private motoring. Council tax £1,600.00.

## H3: Single pensioner on the full new State Pension only (England)

- **Where and household:** North East (Durham). Single. Owner-occupier; home valued at £160,000.00.
- **People and incomes:** pensioner, 70: the full new State Pension at the Annex A rate in every year; reached State Pension age after 6 April 2016; no protected payment or additional State Pension.
- **Claims and elections:** Not entitled to Pension Credit and does not claim it. Claims no other benefit. Not named on any Warm Home Discount list. Not eligible for Marriage Allowance (single). Does not claim Universal Credit.
- **Pensions, savings, gains and transactions:** No private pension, no earnings, no savings interest (savings are in a cash ISA), no gains.
- **Other inputs:** No car. Council tax £1,700.00.

## H4: Single pensioner on Pension Credit (Wales)

- **Where and household:** Wales (Swansea). Single. Council tenant.
- **People and incomes:** pensioner, 84: the basic State Pension at the Annex A rate in every year (reached State Pension age before 6 April 2016); no additional State Pension; no private pension.
- **Claims and elections:** Claims and receives Pension Credit guarantee credit continuously, including on 24 August 2026. Named on the household's electricity bill. Housing costs met by Housing Benefit; council tax nil after Council Tax Reduction. Claims no other benefit. Not eligible for Marriage Allowance (single). Does not claim Universal Credit.
- **Pensions, savings, gains and transactions:** No savings interest, earnings or gains.
- **Other inputs:** No car.

## H5: Retired couple with a small private pension and savings (England)

- **Where and household:** East Midlands (Nottingham). Married. Mortgage-free owner-occupiers; home valued at £290,000.00.
- **People and incomes:** pensioner A, 72: the full new State Pension at the Annex A rate, a private pension of £1,500.00 a year and savings interest of £4,000.00 a year; pensioner B, 69: the full new State Pension at the Annex A rate and savings interest of £300.00 a year. Both reached State Pension age after 6 April 2016; no protected payments.
- **Claims and elections:** Neither is entitled to Pension Credit and neither claims it. Neither claims any other benefit. Marriage Allowance is not elected in any year. Does not claim Universal Credit.
- **Pensions, savings, gains and transactions:** The savings interest is paid gross on bank accounts outside any ISA and is fixed in cash in every year. The private pension is fixed in cash. No gains, dividends or property income.
- **Other inputs:** 500 litres of petrol a year, all private motoring. Council tax £2,100.00.

## H6: Couple with two children on Universal Credit, private renters (England)

- **Where and household:** South West (Bristol), in the Bristol Broad Rental Market Area. Cohabiting. Private tenants paying £1,200.00 a month; entitled to the 2-bedroom Local Housing Allowance rate.
- **People and incomes:** parent A, 35: employment earnings £22,000.00 a year; parent B, 33: no income; children aged 9 and 6 in October 2026 (both born after 6 April 2017), in full-time non-advanced education throughout.
- **Claims and elections:** Receives Universal Credit continuously from before 24 August 2026 to March 2032, with a positive award in every assessment period; parent A is named on the electricity bill. Not subject to the benefit cap (earnings above the earnings exemption). No non-dependant deductions. Claims Child Benefit for both children. Neither partner claims any other benefit. Not married, so Marriage Allowance does not apply. Pension Credit does not apply: nobody in the household has reached State Pension age.
- **Pensions, savings, gains and transactions:** No pension contributions, savings interest or gains.
- **Other inputs:** 900 litres of diesel a year, all private motoring. Council tax is the stated liability after Council Tax Reduction, £1,150.00, held fixed.

## H7: Lone parent with a baby on Universal Credit (Wales)

- **Where and household:** Wales (Newport). Housing association tenant, rent £560.00 a month (a social rent, not assessed under the Local Housing Allowance).
- **People and incomes:** lone parent, 29: employment earnings £14,500.00 a year; children: one aged 5 in October 2026 and one born on 27 January 2027.
- **Claims and elections:** Started claiming Universal Credit on 2 November 2026 (so was not receiving it on 24 August 2026); receives it continuously from 2 November 2026 to March 2032, with a positive award in every assessment period; named on the electricity bill. Not subject to the benefit cap. Claims Child Benefit for both children from birth. Claims no other benefit. Not eligible for Marriage Allowance (single). Pension Credit does not apply: nobody in the household has reached State Pension age.
- **Pensions, savings, gains and transactions:** No pension contributions, savings interest or gains.
- **Other inputs:** No car. Council tax £950.00 after Council Tax Reduction, held fixed.

## H8: Two-earner couple with a new baby (Northern Ireland)

- **Where and household:** Northern Ireland (Lisburn). Married. Owner-occupiers with a mortgage; home valued at £230,000.00.
- **People and incomes:** partner A, 38: employment earnings £64,500.00 a year; partner B, 36: employment earnings £30,000.00 a year; children: one aged 4 in October 2026 and one born on 20 August 2027.
- **Claims and elections:** Partner B claims Child Benefit for both children, for the baby from birth; neither partner has opted out of Child Benefit payments. Partner A has the higher adjusted net income and pays the High Income Child Benefit Charge through Self Assessment. Neither claims any other benefit. Marriage Allowance is not elected (partner A is a higher-rate taxpayer). Pension Credit does not apply: nobody in the household has reached State Pension age. Does not claim Universal Credit.
- **Pensions, savings, gains and transactions:** No pension contributions, salary sacrifice, savings interest or gains. Adjusted net income equals employment earnings.
- **Other inputs:** 1,300 litres of petrol a year, all private motoring. Domestic rates £1,050.00.

## H9: Carer on Carer Support Payment (Scotland)

- **Where and household:** Scotland (Dundee). Scottish taxpayer. Single; lives in their father's home and cares for him for more than 35 hours a week (he receives Attendance Allowance).
- **People and incomes:** carer, 49: employment earnings of £215.00 every week (£11,180.00 a year), the same in every year, measured as Carer Support Payment requires.
- **Claims and elections:** Receives Carer Support Payment from Social Security Scotland in every year, at the Annex A weekly rate for 52 weeks a year. Has not claimed Carer's Allowance (which is not available to new claimants in Scotland) and does not claim Universal Credit. Claims no other benefit. Not eligible for Marriage Allowance (single). Pension Credit does not apply: nobody in the household has reached State Pension age.
- **Pensions, savings, gains and transactions:** No pension contributions, savings interest or gains.
- **Other inputs:** No car. Pays no council tax (not the liable person).

## H10: Carer with a working spouse and Marriage Allowance (England)

- **Where and household:** West Midlands (Coventry). Married. Owner-occupiers with a mortgage; home valued at £240,000.00. The carer looks after their mother, who lives nearby and receives Attendance Allowance, for more than 35 hours a week.
- **People and incomes:** carer, 52: employment earnings of £215.00 every week (£11,180.00 a year), the same in every year, measured as Carer's Allowance requires; partner, 54: employment earnings £40,000.00 a year.
- **Claims and elections:** The carer claims Carer's Allowance whenever entitled, for 52 weeks a year at the Annex A rate; under the baseline earnings limit the carer is not entitled in any year. The couple do not claim Universal Credit and are not entitled to it. Neither claims any other benefit. Marriage Allowance is elected in every year: the carer transfers to the partner, and the election stays in force whatever the measure. Pension Credit does not apply: nobody in the household has reached State Pension age.
- **Pensions, savings, gains and transactions:** No pension contributions, savings interest or gains.
- **Other inputs:** No car. Council tax £1,900.00.

## H11: Higher-rate landlord who buys and sells let property (England)

- **Where and household:** London (Barnet). Married to a spouse with no income of their own. Owner-occupiers of a home valued at £850,000.00.
- **People and incomes:** landlord, 57: employment earnings £85,000.00 a year and taxable rental profit of £18,000.00 a year from let property in England; spouse, 55: no income.
- **Claims and elections:** Neither claims any benefit. Marriage Allowance is not elected (the landlord is a higher-rate taxpayer). Pension Credit does not apply: nobody in the household has reached State Pension age. Does not claim Universal Credit.
- **Pensions, savings, gains and transactions:** No pension contributions, salary sacrifice or savings interest (savings are in ISAs). Buys a flat in Leeds to let on 3 June 2027 for £320,000.00 (an additional dwelling; effective date 3 June 2027). Sells a let house in Bristol on 12 September 2027 for a gain of £40,000.00 on UK residential property; no other gains or losses in 2027-28. The rental profit is unchanged by these transactions.
- **Other inputs:** 1,000 litres of diesel a year, all private motoring. Council tax £1,950.00.

## H12: Young employee aged 22 (Wales)

- **Where and household:** Wales (Wrexham). Single. Lives in their parents' home and pays board.
- **People and incomes:** employee, born 3 March 2005 (aged 22 on 6 April 2027): employment earnings £24,000.00 a year from a private-sector employer.
- **Claims and elections:** Claims no benefit of any kind. Not eligible for Marriage Allowance (single). Pension Credit does not apply: nobody in the household has reached State Pension age. Does not claim Universal Credit.
- **Pensions, savings, gains and transactions:** Has opted out of the workplace pension: no pension contributions. No savings interest or gains.
- **Other inputs:** 600 litres of petrol a year, all private motoring. Pays no council tax (not the liable person).

## H13: Couple with three children on Universal Credit, private renters (Northern Ireland)

- **Where and household:** Northern Ireland (Belfast). Married. Private tenants paying £800.00 a month; housing costs assessed under the Northern Ireland Housing Executive's Local Housing Allowance rates.
- **People and incomes:** parent A, 37: employment earnings £19,000.00 a year; parent B, 35: employment earnings £6,000.00 a year; children aged 11, 7 and 3 in October 2026, all born after 6 April 2017.
- **Claims and elections:** Receives Universal Credit continuously from before 24 August 2026 to March 2032, with a positive award in every assessment period; parent A is named on the electricity bill. Not subject to the benefit cap. Claims Child Benefit for all three children. Neither claims any other benefit. Marriage Allowance is not elected. Pension Credit does not apply: nobody in the household has reached State Pension age.
- **Pensions, savings, gains and transactions:** No pension contributions, savings interest or gains.
- **Other inputs:** No car. Domestic rates are met in full by Rate Relief and held fixed.

## H14: Scottish pensioner with a small private pension and savings

- **Where and household:** Scotland (Inverness). Scottish taxpayer. Widowed, lives alone. Owner-occupier; home valued at £195,000.00.
- **People and incomes:** pensioner, 71: the full new State Pension at the Annex A rate (reached State Pension age after 6 April 2016; no protected payment), a private pension of £600.00 a year and savings interest of £600.00 a year.
- **Claims and elections:** Not entitled to Pension Credit and does not claim it. Claims no other benefit. Not eligible for Marriage Allowance (no spouse or civil partner). Does not claim Universal Credit.
- **Pensions, savings, gains and transactions:** The savings interest is paid gross on a bank account outside any ISA and is fixed in cash in every year. No gains.
- **Other inputs:** No car. Council tax £1,450.00.
