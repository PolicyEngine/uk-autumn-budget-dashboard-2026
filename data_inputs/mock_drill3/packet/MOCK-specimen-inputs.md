MOCK DATA: rehearsal Budget for PolicyEngine drill 3, 12 October 2026. Not a real Budget.

# Specimen households and scoring templates for drill 3

*Released at 13:40 BST with the Budget documents.*

## Household scoring

Twelve households, facts only. For each household and each row of `MOCK-drill3-scoring.csv`, work out the change in annual household net income from **that measure on its own**, against the pre-Budget baseline in Annex A, in the scoring year shown. One row is different: **"1 and 2 together (stacked)"** asks for the change from measures 1 and 2 applied together, against the same baseline. Log each figure in £ a year to the penny in `team_change`, note any assumption in `cause`, and pin the run in `run_sha`.

| Measure | Scoring year(s) |
|---|---|
| 1 threshold freeze extension | 2031-32 |
| 2 Pensioner Allowance | 2027-28, 2031-32 |
| 3 Warm Home Discount top-up | 2026-27, 2027-28 |
| 4 Capital Gains Tax | 2027-28 |
| 5 employer NICs for under-22s | 2027-28 |
| 6 HVCTS bands | 2028-29 |
| 7 additional rate threshold | 2027-28 |
| 8 Local Housing Allowance | 2027-28 |
| 9 fuel duty | 2026-27, 2027-28 |
| 10 Class 4 NICs | 2027-28 |
| 1 and 2 together (stacked) | 2031-32 |

Scoring basis, stated once:

- Fiscal years (April to March). Use even monthly fuel use within a year.
- Each measure on its own against Annex A, except the stacked row. Static: no behavioural response.
- **Earnings, profits, private pensions, dividends, rents and fuel use are fixed in cash at the stated amounts in every year.** The State Pension follows the Annex A weekly rates, which are already rounded to the nearest 5p; annual State Pension = 52 × the weekly rate.
- Whether each household claims Pension Credit or Universal Credit, and on which dates, is stated in its facts. Where a household receives Universal Credit, the award is positive in every month; compute UC annually as 12 × the monthly amount with no intermediate rounding.
- "Household net income" is what the household receives after direct taxes and benefits, less the indirect taxes it pays. Employer National Insurance is the employer's cost, not the household's. Council tax and Council Tax Reduction are held at the stated amounts.
- Fuel duty: include VAT at 20% on the change in duty, so the figure is the change in what the household pays at the pump.
- A bill credit counts as household income in the fiscal year it is credited.
- Capital Gains Tax: score the change in the liability for the tax year of the disposal, whenever it is paid.
- Home values are April 2026 valuations.

## National scoring

`MOCK-drill3-national-scoring.csv` has one row for each coded measure and fiscal year, plus one row for the interaction of measures 1 and 2 in 2031-32. For each row, record:

- the costing's static and post-behavioural figures (£m), copied from the costings document and Table 4.1;
- your own figure (£m), and its basis: gross or net, duty only or VAT-inclusive, cash or accruals, tax year or fiscal year, households only or whole economy;
- one explanation class for the gap between your figure and the costing's **static** figure, and one for the gap to the **post-behavioural** figure, each from this closed list:

  `behavioural`, `coverage_business`, `top_tail_data`, `timing_fiscal_calendar`, `incidence_basis`, `baseline_mismatch`, `data_forward_path`, `devolved`, `interaction`, `takeup_caseload`, `none_expected`

- a one-line rationale, the run SHA, and whether the row was re-run after any later correction.

## Classification

In the coverage ledger, classify every Table 4.1 line, and anything in the statement that is not in Table 4.1, with one class from this closed list:

  `modelled_param`, `modelled_new_variable`, `constructed_counterfactual`, `ledger_business_side`, `ledger_out_of_model_scope`, `ledger_spending`, `already_in_baseline`

Each CSV's first line is the MOCK line: skip one line when reading it (pandas: `skiprows=1`).

## H1: Employee on £51,000 (England)

- **Where:** Yorkshire and the Humber (Leeds). Single. Private renter paying £950 a month; does not claim any benefit. Works for a private-sector employer. No capital gains, savings income or dividends.
- **Inputs:** 1,000 litres of petrol a year, all private motoring; council tax £1,980.00.
- **People:** adult, 34: employment earnings £51,000.00 a year.

## H2: Scottish employee on £45,000 selling shares

- **Where:** Scotland (Glasgow). Scottish taxpayer. Owner-occupier; home valued at £240,000.00. Does not claim any benefit. Sells shares held outside an ISA on 14 June 2027 for a gain of £20,000.00; no other gains or losses in 2027-28.
- **Inputs:** 1,000 litres of petrol a year, all private motoring; council tax £1,650.00.
- **People:** adult, 48: employment earnings £45,000.00 a year.

## H3: Single pensioner on the full new State Pension only (England)

- **Where:** South West (Bristol). Owner-occupier; home valued at £380,000.00. Reached State Pension age after April 2016. No private pension, savings income or other income. Not entitled to Pension Credit and does not claim it.
- **Inputs:** no car; council tax £2,150.00.
- **People:** pensioner, 70: the full new State Pension at the Annex A rate in every year.

## H4: Single pensioner on Pension Credit (England)

- **Where:** North West (Manchester). Council tenant. Reached State Pension age before April 2016: basic State Pension only, topped up by Pension Credit guarantee credit. Claims and receives Pension Credit guarantee credit continuously, including on 23 August 2026 and 22 August 2027. Named on the household's electricity bill. Taxable income (the basic State Pension) is below £12,570 in every year.
- **Inputs:** no car; council tax nil after Council Tax Reduction.
- **People:** pensioner, 82: basic State Pension and Pension Credit guarantee credit.

## H5: Retired couple with private pensions (England)

- **Where:** South East (Guildford). Married; mortgage-free owner-occupiers; home valued at £900,000.00. Both reached State Pension age after April 2016. Private pensions are fixed in cash in every year. Neither is entitled to Pension Credit and neither claims it.
- **Inputs:** 800 litres of petrol a year, all private motoring; council tax £2,900.00.
- **People:** pensioner A, 74: the full new State Pension and a private pension of £17,500.00 a year; pensioner B, 72: the full new State Pension and a private pension of £4,000.00 a year.

## H6: Couple with two children on Universal Credit, private renters (England)

- **Where:** North West (Manchester), in the Central Greater Manchester Broad Rental Market Area. Cohabiting. Private tenants paying £1,250.00 a month; entitled to the 2-bedroom Local Housing Allowance rate. Receives Universal Credit continuously from before 23 August 2026 to March 2032, with a positive award in every month; claimant A is named on the electricity bill. Not subject to the benefit cap (earnings are above the earnings exemption). Council tax is the stated liability after Council Tax Reduction and is held fixed.
- **Inputs:** 800 litres of diesel a year, all private motoring; council tax £1,100.00.
- **People:** parent A, 36: employment earnings £24,000.00 a year; parent B, 34: no income; children aged 9 and 6 (October 2026), in full-time non-advanced education throughout.

## H7: Lone parent aged 22 on Universal Credit (Wales)

- **Where:** Wales (Cardiff). Housing association tenant, rent £520.00 a month (a social rent, not assessed under the Local Housing Allowance). Works for a private-sector employer. Started claiming Universal Credit on 1 October 2026 (so not receiving it on 23 August 2026); receives it on 22 August 2027 and continuously from 1 October 2026 to March 2032, with a positive award in every month. Named on the electricity bill. Council tax held fixed.
- **Inputs:** no car; council tax £900.00 after Council Tax Reduction.
- **People:** lone parent, 22 (born June 2004): employment earnings £14,000.00 a year; one child aged 6 (October 2026).

## H8: Two-earner family on Universal Credit (Northern Ireland)

- **Where:** Northern Ireland (Belfast). Married. Private tenants paying £850.00 a month; housing costs assessed under the Northern Ireland Housing Executive's rates. Receives Universal Credit continuously from before 23 August 2026 to March 2032, with a positive award in every month. Named on the electricity bill.
- **Inputs:** 1,500 litres of diesel a year, all private motoring; domestic rates £1,100.00.
- **People:** partner A, 39: employment earnings £21,000.00 a year; partner B, 37: employment earnings £8,000.00 a year; children aged 12 and 8 (October 2026), in full-time non-advanced education throughout.

## H9: Self-employed sole trader on £60,000 profit (England)

- **Where:** East of England (rural Norfolk). Single. Owner-occupier; home valued at £350,000.00. Sole trader with taxable trading profit of £60,000.00 in every year, after all expenses. No employment income, gains, savings income or dividends. Does not claim any benefit.
- **Inputs:** 2,500 litres of petrol a year, all private motoring (no motoring costs are deducted from profit); council tax £1,850.00.
- **People:** adult, 45: trading profit £60,000.00 a year.

## H10: High earner with a £6.5m home (England)

- **Where:** London (Kensington and Chelsea). Single. Sole owner-occupier of a home valued at £6,500,000.00 (April 2026 valuation). Employee of a private-sector firm. No other income, gains or benefits.
- **Inputs:** 1,200 litres of petrol a year, all private motoring; council tax £3,100.00.
- **People:** adult, 52: employment earnings £180,000.00 a year.

## H11: Scottish company director with dividends

- **Where:** Scotland (Edinburgh). Scottish taxpayer. Owner-occupier; home valued at £700,000.00. Director of their own UK company; takes a salary and dividends of the amounts below in every year. No other income, gains or benefits.
- **Inputs:** 900 litres of petrol a year, all private motoring; council tax £2,600.00.
- **People:** adult, 50: employment earnings (salary) £90,000.00 a year and UK dividends £30,000.00 a year.

## H12: Landlord with a let house in London and a flat sale (England)

- **Where:** South East (Sevenoaks). Married to a non-earning spouse who has no income of their own. Owner-occupiers of a home valued at £800,000.00. Employee earning the amount below. Sole owner, outright, of a house in London (Wandsworth) valued at £2,200,000.00 (April 2026 valuation) that is let to tenants; taxable rental profit £20,000.00 in every year. Sells a separate buy-to-let flat in Bristol on 10 November 2027 for a gain of £60,000.00 (residential property); no other gains or losses in 2027-28. Does not claim any benefit.
- **Inputs:** 1,100 litres of diesel a year, all private motoring; council tax £2,750.00.
- **People:** landlord, 58: employment earnings £70,000.00 and rental profit £20,000.00 a year; spouse, 57: no income.
