MOCK DATA: rehearsal Budget for PolicyEngine drill 2, 5 October 2026. Not a real Budget.

# Specimen households for drill 2

*Released at 13:40 BST with the Budget documents.*

Ten households, facts only. For each household and each coded measure, work out the change in annual household net income from **that measure on its own**, against the pre-Budget baseline in Annex A, in the scoring year below. Log each figure, in £ a year to the penny, in the `team_change` column of `MOCK-drill2-scoring.csv`, and note anything you had to assume in `cause`.

| Measure | Scoring year |
|---|---|
| 1 fuel duty | 2027-28 |
| 2 electricity VAT | 2027-28 |
| 3 energy payment | 2026-27 |
| 4 State Pension Personal Allowance | 2027-28 |
| 5 employer NICs | 2027-28 |
| 6 capital gains tax | 2027-28 |
| 7 surcharge | 2028-29 |
| 8 State Pension uprating | 2030-31 |

Scoring basis, stated once:

- Fiscal years (April to March). Use even monthly fuel and energy use within a year.
- Fuel duty: include VAT at 20% on the change in duty, so the figure is the change in what the household pays at the pump.
- Energy bills are VAT-inclusive at the pre-Budget rates in Annex A.
- Static: no behavioural response. Earnings, pensions, rents and spending are as given in every year.
- "Household net income" is what the household receives after direct taxes and benefits, less the indirect taxes it pays. An employer's costs are not the household's.
- Home values are April 2026 valuations. The State Pension follows Annex A.

The sheet's first line is the MOCK line: skip one line when reading it (pandas: `skiprows=1`).

## H1: Single employee on £32,000 (England)

- **Where:** Yorkshire and the Humber (Leeds). Private renter paying £700 a month. Works for a private-sector employer. No capital gains.
- **Inputs:** 1,200 litres of petrol a year; electricity £950.00 and gas £750.00 a year (both including 5% VAT); total consumption £22,000.00; council tax £1,980.00.
- **People:** adult, 31: earnings £32,000.00.

## H2: Couple with two children on Universal Credit, one earner on £19,000 (England)

- **Where:** North East (Newcastle). Cohabiting. Housing association tenants, eligible rent £540 a month. Receiving Universal Credit on 1 December 2026 and throughout 2027-28. Council tax is the liability after the local Council Tax Reduction scheme.
- **Inputs:** 800 litres of diesel a year; electricity £1,150.00 and gas £950.00 a year (both including 5% VAT); total consumption £25,000.00; council tax £1,350.00.
- **People:** parent A, 37: earnings £19,000.00; parent B, 35: no income; children aged 10 and 7.

## H3: Single pensioner on the full new State Pension only (England)

- **Where:** South West (Bristol). Owner-occupier. Reached State Pension age after April 2016. No private pension, no savings income. Not entitled to Pension Credit.
- **Inputs:** no car; electricity £900.00 and gas £800.00 a year (both including 5% VAT); total consumption £14,000.00; council tax £2,150.00; home valued at £380,000.00 (April 2026 valuation).
- **People:** pensioner, 70: the full new State Pension.

## H4: Two-earner couple in Northern Ireland

- **Where:** Northern Ireland (Belfast). Owner-occupiers. Both employees. Oil-fired central heating.
- **Inputs:** 1,500 litres of diesel a year; electricity £1,300.00 a year (including 5% VAT); heating oil £1,100.00 a year (including 5% VAT); total consumption £36,000.00; domestic rates £1,400.00; home valued at £260,000.00.
- **People:** partner A, 42: earnings £40,000.00; partner B, 40: earnings £25,000.00.

## H5: Retired couple with a £1.7m home (England)

- **Where:** South East (Guildford). Mortgage-free owner-occupiers. Both on the full new State Pension plus private pensions, which are fixed in cash terms.
- **Inputs:** 800 litres of petrol a year; electricity £1,400.00 and gas £1,300.00 a year (both including 5% VAT); total consumption £34,000.00; council tax £3,400.00; home valued at £1,700,000.00 (April 2026 valuation).
- **People:** pensioner A, 73: the full new State Pension and a private pension of £9,000.00; pensioner B, 73: the full new State Pension and a private pension of £30,000.00.

## H6: Single private tenant of a £1.6m London flat

- **Where:** London (Camden). Rents privately at £3,200 a month; the landlord owns the flat, valued at £1,600,000.00 (April 2026 valuation). Works for a private-sector employer.
- **Inputs:** no car; electricity £1,000.00 and gas £600.00 a year (both including 5% VAT); total consumption £48,000.00; council tax £2,000.00.
- **People:** adult, 33: earnings £85,000.00.

## H7: Scottish employee on £45,000 selling shares

- **Where:** Scotland (Glasgow). Scottish taxpayer. Owner-occupier. Sells shares held outside an ISA in June 2027 for a gain of £20,000.00; no other gains or losses in 2027-28.
- **Inputs:** 1,000 litres of petrol a year; electricity £1,050.00 and gas £900.00 a year (both including 5% VAT); total consumption £30,000.00; council tax £1,900.00; home valued at £280,000.00.
- **People:** adult, 48: earnings £45,000.00.

## H8: Single pensioner on Pension Credit (England)

- **Where:** North West (Manchester). Council tenant. Reached State Pension age before April 2016, so on the basic State Pension, topped up by Pension Credit guarantee credit, received on 1 December 2026 and throughout. Total income about £12,400 a year, all from the State Pension and Pension Credit.
- **Inputs:** no car; electricity £800.00 and gas £700.00 a year (both including 5% VAT); total consumption £12,500.00; council tax nil after Council Tax Reduction.
- **People:** pensioner, 81: basic State Pension and Pension Credit guarantee credit.

## H9: Basic-rate employee on £30,000 selling shares (England)

- **Where:** East of England (Norwich). Owner-occupier. Sells shares held outside an ISA in September 2027 for a gain of £10,000.00; no other gains or losses in 2027-28.
- **Inputs:** 1,000 litres of petrol a year; electricity £1,000.00 and gas £850.00 a year (both including 5% VAT); total consumption £24,000.00; council tax £2,050.00; home valued at £300,000.00 (April 2026 valuation).
- **People:** adult, 39: earnings £30,000.00.

## H10: Lone parent on Universal Credit in an all-electric home (Wales)

- **Where:** Wales (Cardiff). Housing association tenant, eligible rent £500 a month. All-electric home, no gas. Receiving Universal Credit on 1 December 2026 and throughout 2027-28. No childcare costs.
- **Inputs:** no car; electricity £1,700.00 a year (including 5% VAT); total consumption £17,000.00; council tax £1,000.00 after Council Tax Reduction.
- **People:** lone parent, 30: earnings £14,000.00; one child aged 6.
