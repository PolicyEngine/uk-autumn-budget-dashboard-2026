## Summary

- **The dashboard costs every measure statically.** It runs neither of policyengine-uk's two labour supply routes:
  - It never calls `Simulation.apply_dynamics`, the OBR route.
  - No measure on `main` or on any drill branch sets `gov.simulation.labour_supply_responses`, the parameter route.

  policyengine.py, which builds the dashboard's simulations, can switch on only the parameter route.
- **The parameter route cannot run on the pinned engine.** It returns a zero response whatever the elasticities on every drill engine and on the certified bundle: 2.90.2, 2.120.0, 2.125.1, 2.130.1 and 2.132.6. The cause was that the route compared the reform with a copy of itself (PolicyEngine/policyengine-uk#2268). Released policyengine-uk 2.133.0 carries the correction (PolicyEngine/policyengine-uk#2277).
- **The OBR route runs on every engine, with three limits.**
  - It changes hours only. The participation part has been disabled since September 2025.
  - It responds only to changes in HBAI net income, so indirect-tax measures get no response.
  - Its cache resets delete the inputs that a structural measure's modifier sets.
- **CGT already responds by default on newer engines.** From 2.134.0 a retention-rate elasticity of 1 is the default (PolicyEngine/policyengine-uk#2419). The bundle's 2.132.6 costs CGT statically. The runbook already covers this (`docs/budget-day-runbook.md:781`).
- **Results on the 50 drill reforms:** 95 measure-years: 91 ran on both engines, and 2 are withheld. Another 4 cells, two drill 1 fuel measures, are not comparable on 2.153.0 (¶).
  - **Static figures moved modestly.** The median move between the drill and today's engine and data is 7%. 27 of 85 measure-years moved by more than 10% and £50m, mostly through data and baseline changes.
  - **The OBR route's response moved more.** Where both engines respond with the same sign, it is a median 32% larger today: 13 of 25 such cells grew by more than 25%, and 6 shrank by more than 20%. 4 of the 42 cells with a response changed sign (both sides £5m or more). The two of £25m or more are both threshold freezes.
  - **The two routes agree in sign** in 28 of the 29 cells where both respond. The parameter route gives a median 0.88 times the OBR route's effect.
  - **The response matters most for the high-income measure.** Lowering the additional-rate threshold (drill 3) loses 52–57% of its static yield. Child Benefit, LHA and UC child element increases cost 9–22% more.
  - **Stable totals can hide opposite changes.** The drill 4 bridge splits the UC child element's change into a smaller response from the model change and a larger one from the new data, which roughly cancel.

National weighted aggregates only. Every figure below is a GBP total over the whole population. Any cell that rests on fewer than 10 households is withheld, and so is any response that rests on fewer than 10 responders.

## How the dashboard costs a measure

- `src/uk_budget_data/pipeline.py:39-48` builds both simulations with `pe.uk.managed_microsimulation(dataset=..., scenario=...)`.
- `src/uk_budget_data/calculators.py:86-89` takes the change in `gov_balance`, or in `student_loan_repayment` for the student loan freeze.
- Nothing calls `apply_dynamics`, and no scenario carries a labour supply elasticity.
- policyengine.py's labour supply output checks only the parameter-route paths (`src/policyengine/outputs/labor_supply_response.py:26`, at `25ed3632`). It has no `apply_dynamics` call.

So the published figures are static by construction. This matches the comparison rule ("our static figure against the static costing", `docs/budget-day-publication.md:205`). Table 4.1's post-behavioural figure is shown but not gated.

## The two routes, by engine

| | Parameter route | OBR route (`apply_dynamics`) | CGT realisation response |
|---|---|---|---|
| What it applies | One substitution and one income elasticity to every earner | The OBR's February 2024 Tables A1 and A2, by sex, partnership and youngest child's age | Retention-rate elasticity on realised gains |
| 2.90.2 to 2.132.6 (the drills and the bundle) | Always 0 | Runs | 0 by default |
| 2.133.0 onwards | Runs | Runs | 0 until 2.134.0, then 1.0 by default |

The OBR route's values are the OBR's latest published set. They come from the note of 8 February 2024 that documents the November 2023 NICs costing. In its June 2026 forecast evaluation report (paragraph 4.23), the OBR says it is reviewing its labour supply model elasticities. No newer set has been published.

A synthetic single earner on £40,000, with the basic rate raised from 20% to 30% and elasticities of 0.15 and −0.05, shows the difference. The parameter route gives exactly £0 on 2.90.2, 2.120.0, 2.125.1, 2.130.1 and 2.132.6, and −£663 of earnings on 2.153.0.

## Why the routes can mis-cost structural measures

Line numbers are at policyengine-uk 2.153.0 (`3bcacaaa2`).

### The OBR route deletes inputs a modifier sets

1. `Simulation.reset_calculations` (`policyengine_uk/simulation.py:843-846`) deletes every variable that is not in `input_variables`.
2. `input_variables` is captured at `simulation.py:410`, before the scenario's modifier runs (`:429` onwards). The order is the same on 2.90.2 and 2.130.1.
3. `apply_dynamics` resets the simulation in each marginal-rate step (`dynamics/progression.py:66` and `:86`). It resets again before it writes the response (`dynamics/labour_supply.py:341`).

So a measure whose modifier writes a value with `set_input` loses that value inside the route. It loses it in its marginal rates, and in the result after the response. The drill measures that do this include:

- the fuel duty measures' pump-VAT adjustment (`vat`);
- the Warm Home Discount and energy payments (`cost_of_living_support_payment`);
- the Child Benefit early-years addition (`child_benefit`);
- the State Pension top-up allowance (`allowances`).

On 2.153.0 the drill 3 fuel duty measure shows the effect. Earnings did not change at all, yet the route moved the measure's 2027-28 figure by about £0.16bn, the size of its pump-VAT part. The figures below keep these inputs: the harness adds each modifier's `set_input` variables to `input_variables`.

### A frozen income-dependent input breaks both routes

The State Pension top-up allowance modifier computes `allowances` once, when the simulation is built, and fixes it for everyone. That includes the tapered personal allowance above £100,000. Both routes then compare marginal rates where the reform side has no taper response and the baseline side has one. This gives earnings responses of several £bn that are an artefact. The same holds for the drill 4 package, which contains this measure. Its rows are marked n/r (not reliable).

### A modifier that writes the response variable overrides the parameter route

The drill 3 salary sacrifice cap's modifier sets `employment_income_behavioral_response` and `employer_ni_fixed_employer_cost_change` itself. The first is the parameter route's own output, so the measure overwrites the route's result. Its parameter-route cells are n/r.

### The routes measure income differently

- The OBR route measures income on HBAI net income before it is reset to zero. HBAI net income has no indirect taxes and no capital gains. So fuel duty, VAT and CGT measures get no response on this route.
- The parameter route measures its income effect on `household_net_income`, which subtracts `household_tax`. That includes fuel duty, the VAT change, council tax and the high-value council tax surcharge. So those measures get a small response on this route.

### Dated reforms on 2.153.0

Drills 1 to 3 build a scenario whose modifier applies dated keys after the build (`Reform._build_scenario`). 2.153.0 refuses that with "Cannot apply annualised overrides: … the key contains no 1 January annual value" (`policyengine_uk/utils/dated_reforms.py:603`). Dated keys must be passed when the simulation is built. They then apply on the statutory timeline, day-weighted. For the 2.153.0 runs, each measure with dated keys passes all its keys at construction instead (listed above the tables). The drill engines ran the drill code as it is.

## What was run

- **Measures.** All 50 measures in the four drills' published `budgetary_impact.csv`: 18 in drill 1, 8 in drill 2, 11 in drill 3 and 13 in drill 4. Each is defined by its branch's code at the branch head (`1b2d8bd`, `3910fee`, `b164295`, `8291938`).
- **Years.** Two per measure: the first and the last year with a drill figure of at least £5m, or one year where they are the same. That gives 95 measure-years.
- **"Drill" columns.** Each branch's locked engine, on the national file that drill used:

  | Drill | Engine | National file |
  |---|---|---|
  | 1 | 2.90.2 | enhanced FRS 2024-25, `ef34c1ae` |
  | 2 | 2.120.0 | Microcosm `aa31bdf6` |
  | 3 | 2.125.1 | Microcosm `aa31bdf6` |
  | 4 | 2.130.1 | Microcosm `810ba980` |

  For drills 2 to 4 the static figures reproduce the committed ones exactly, to float32 precision, except three cells (marked ‡). In drill 1, only the five `mock_*` measures were rerun on 28 September. Its other 13 rows were carried over from earlier runs. Of those 13, 8 reproduce exactly on 2.90.2 and `ef34c1ae`; 3 do not (marked ‡, with the rerun shown); and 2 cannot be rerun.
- **"Now" columns.** policyengine-uk 2.153.0, on the latest Microcosm national release: `microcosm-uk-2024-25-national-20261023T075039Z-a133f37a`, file `64f83900`, built on 23 October under 2.147.2. All CGT realisation elasticities are set to 0, so that the static figures compare with the drills. The default CGT response is reported separately.
- **Elasticities.**
  - The OBR route runs as coded (the OBR's Tables A1 and A2, hours only).
  - The parameter route uses a substitution elasticity of 0.15 and an income elasticity of −0.05. These are the OBR's values for men and for single women without children, the two largest groups.
  - Both routes are set on both sides of each comparison, so that a measure with its own baseline gets its own response.
- **Bridge.** 2.153.0 also ran on drill 4's own file `810ba980`. This splits each drill 4 change into a model part and a data part.
- **Effect columns.** In £m: the route's change in the budget figure against the same engine's static figure.
- **Consistency check.** A response changes the budget only through earnings. So an effect larger than 1.2 × the earnings change plus £10m, or a measure that fixes an income-dependent input, is shown as n/r.

## Results

### Overview

| | Measure-years | Result |
|---|---:|---|
| Ran on both engines | 91 of 95 | The drill 1 student loan freeze and the drill 1 package did not run on either engine: their modifier edits `gov_tax.adds`, which neither 2.90.2 nor 2.153.0 defines. Their published figures came from an earlier engine. |
| Withheld | 2 | One measure in both years (small cell) |
| Static, drill as published to now | 85 | Median move 7.1%. 27 moved by more than 10% and £50m. 1 changed sign, from zero. |
| OBR route on both engines | 79 | 37 are zero on both engines by construction. 42 have a response. |
| Of those 42 | | 4 changed sign (both sides £5m or more), 2 of them by £25m or more. Of the 25 same-sign cells with a drill-time response of £10m or more, the median ratio now/drill is 1.32: 13 grew by more than 25%, and 6 shrank by more than 20%. |
| Response as a share of the static figure | 42 | Median 1.9% at drill time, and 2.5% now |
| The two routes on 2.153.0 | 79 | 29 respond on both routes: 28 agree in sign, and the parameter route gives a median 0.88 times the OBR route's effect. 32 respond on the parameter route only. 10 are blind on the parameter route (†). |

The 37 cells that are zero on both engines on the OBR route are of these kinds:

- fuel duty, VAT, bus and rail fares, which HBAI income does not include;
- CGT;
- the high-value council tax surcharge;
- employer NI measures coded as modifiers or templates;
- the State Pension uprating, because people aged 60+ are excluded.

The parameter route responds to most of them, but only through `household_net_income`.

### What moves most

- **The additional-rate threshold (drill 3).** The response grew from −£578m to −£854m in 2027-28, and from −£985m to −£1,197m in 2031-32. It now takes 52–57% of the static yield on both routes. The 45p rate starts at £100,000 of taxable income, inside the personal allowance taper, so it raises the highest marginal rates further: from 60% to 67.5% before NI.
- **Threshold freezes are the least stable.**
  - Two change sign: the drill 1 extension in 2028-29 went from −£191m to +£32m, and the drill 3 freeze to 2032 went from +£117m to −£85m.
  - The drill 4 freeze to 2032 more than tripled, from −£37m to −£123m.

  A freeze has income and substitution effects of opposite sign. So small shifts in the distribution of marginal rates change the sign of the net response.
- **The employer NI threshold (drill 2)** went from −£17m to −£113m in 2030-31, and from −£43m to −£85m in 2027-28. The static figure barely moved. The engine's pass-through of employer NI to wages is the likely cause, but there is no bridge for drill 2, so the model and data parts are not separated.
- **Benefit increases now cost more with responses:**
  - 9–22% more for the Child Benefit, LHA and UC child element measures;
  - 5–7% more for the two-child limit;
  - 1–6% more for flat payments such as the Warm Home Discount top-ups and the energy payment.

### Drill 4 bridge: model change and data change

This is 2.153.0 on drill 4's own file. The model part is (2.153.0 on `810ba980`) minus (2.130.1 on `810ba980`). The data part is (2.153.0 on `64f83900`) minus (2.153.0 on `810ba980`). It covers the OBR route, for the six drill 4 measures with a response on both engines.

| Reform | Year | OBR effect, 2.130.1 on `810ba980` (£m) | 2.153.0 on `810ba980` (£m) | 2.153.0 on `64f83900` (£m) | Model part (£m) | Data part (£m) |
|---|---|---:|---:|---:|---:|---:|
| `mock4_cb_early_years_addition` | 2027-28 | -21 | -36 | -40 | -15 | -4 |
| `mock4_cb_early_years_addition` | 2031-32 | -30 | -38 | -40 | -8 | -3 |
| `mock4_lha_reset` | 2027-28 | -88 | -112 | -150 | -23 | -38 |
| `mock4_lha_reset` | 2031-32 | -106 | -102 | -140 | +4 | -38 |
| `mock4_savings_starting_band` | 2028-29 | +4 | +2 | +6 | -2 | +4 |
| `mock4_savings_starting_band` | 2031-32 | +4 | +5 | +3 | +1 | -2 |
| `mock4_threshold_freeze_2032` | 2031-32 | -37 | -76 | -123 | -39 | -48 |
| `mock4_uc_child_element` | 2027-28 | -112 | -65 | -104 | +47 | -39 |
| `mock4_uc_child_element` | 2031-32 | -112 | -53 | -110 | +59 | -56 |
| `mock4_whd_topup` | 2026-27 | -7 | -7 | -7 | -1 | +0 |

- **The UC child element looked stable**, at −£112m against −£104m to −£110m. In fact the model change made it smaller (+£47m to +£59m), and the new data made it larger (−£39m to −£56m).
- **The LHA reset's growth comes from the data.**
- **The freeze's growth** is about half model and half data.

### Default CGT response on 2.153.0

This is a static run with the engine's default retention-rate elasticity of 1, against the same run with every CGT elasticity at 0 (the basis of every other "now" column). It covers the 12 measures that change CGT rates or move people between income tax bands.

| Reform | Year | Static, CGT response 0 (£bn) | Static, engine default (£bn) | Difference (£m) |
|---|---|---:|---:|---:|
| `cgt_equalisation` | 2026-27 | +19.01 | +6.93 | -12,078 |
| `cgt_equalisation` | 2030-31 | +22.25 | +7.94 | -14,305 |
| `threshold_freeze_extension` | 2028-29 | +3.61 | +3.61 | -2 |
| `threshold_freeze_extension` | 2030-31 | +11.96 | +11.96 | -2 |
| `mock2_cgt_rates` | 2027-28 | +4.38 | +2.60 | -1,774 |
| `mock2_cgt_rates` | 2030-31 | +4.91 | +2.93 | -1,980 |
| `mock2_state_pension_personal_allowance` | 2027-28 | -0.38 | <10 | <10 |
| `mock2_state_pension_personal_allowance` | 2030-31 | -1.34 | <10 | <10 |
| `mock3_cgt_higher_rate_aea` | 2027-28 | +4.44 | +2.67 | -1,770 |
| `mock3_cgt_higher_rate_aea` | 2031-32 | +5.16 | +3.10 | -2,061 |
| `mock3_pensioner_allowance` | 2027-28 | -1.65 | <10 | <10 |
| `mock3_pensioner_allowance` | 2031-32 | -3.04 | -3.04 | +2 |
| `mock3_threshold_freeze_2032` | 2031-32 | +4.33 | +4.33 | -1 |
| `mock4_cgt_higher_rate` | 2027-28 | +2.15 | +1.33 | -821 |
| `mock4_cgt_higher_rate` | 2031-32 | +2.51 | +1.55 | -956 |
| `mock4_combined` | 2026-27 | -1.58 | -1.58 | +0 |
| `mock4_combined` | 2031-32 | +0.68 | -0.26 | -939 |
| `mock4_state_pension_topup_allowance` | 2027-28 | -0.22 | <10 | <10 |
| `mock4_state_pension_topup_allowance` | 2031-32 | -0.62 | <10 | <10 |
| `mock4_threshold_freeze_2032` | 2031-32 | +4.82 | +4.82 | -2 |

- **CGT measures lose 38–64% of their static yield to the default response.** For example, CGT equalisation falls from £19.0bn to £6.9bn in 2026-27.
- **Threshold freezes move by about £2m.**
- **The drill 4 package's 2031-32 figure changes sign.**
- **Five cells, for the three personal-allowance measures, are withheld (<10),** because their CGT response rests on fewer than 10 records or households.

### Tables by drill

All values are national government-balance changes. A positive value is a gain to the Exchequer.

- "Drill, as published" is the measure's row in the drill branch's `public/data/budgetary_impact.csv`.
- Effect columns are in £m: the route's budget figure minus the same engine's static figure.
- "Now" is 2.153.0 on `64f83900` with CGT responses at 0.
- "Moves" flags each of these:
  - a static sign change;
  - a static move of more than 10% and £50m;
  - an OBR-effect sign change;
  - an OBR-effect move of more than 25% and £5m.

Marks:

- † the parameter route does not see the values the measure's modifier sets.
- n/r not reliable (see the mechanism section).
- ‡ the published figure does not reproduce on the drill's engine and file. Where the gap is £0.1bn or more (drill 1, from earlier engines and data), the rerun is shown.
- <10 withheld (small cell).
- ¶ not comparable on 2.153.0: single-date monthly keys, read as one day after the port (see Limits).

Ported to construction-time dated keys for 2.153.0: `mock2_fuel_duty_hold` and `mock3_fuel_duty_phasing` (month ranges, comparable), and `fuel_duty_rise_cancellation` and `mock_fuel_duty_freeze` (single dates, ¶).

<details><summary>Drill 1 (28 Sep): policyengine-uk 2.90.2, enhanced FRS 2024-25 (`ef34c1ae`)</summary>

| Reform | Year | Drill, as published (£bn) | Drill engine + OBR route (£m) | Now, static (£bn) | Now + OBR route (£m) | Now + parameter route (£m) | Moves |
|---|---|---:|---:|---:|---:|---:|---|
| `bus_fare_cap` | 2027-28 | -0.26 | +0 | -0.30 | +0 | -5 |  |
| `bus_fare_cap` | 2030-31 | -0.28 | +0 | -0.36 | +0 | -8 | static size |
| `cgt_equalisation` | 2026-27 | +4.11 | +0 | +19.01 | +0 | +15 | static size |
| `cgt_equalisation` | 2030-31 | +4.79 | +0 | +22.25 | +0 | +19 | static size |
| `dividend_tax_increase_2pp` | 2026-27 | +0.94 | +32 | +1.03 | +20 | +20 | OBR effect size |
| `dividend_tax_increase_2pp` | 2030-31 | +1.07 | +55 | +1.17 | +30 | +26 | OBR effect size |
| `fuel_duty_freeze` | 2026-27 | -3.52 ‡ (rerun -2.04) | +0 | -1.00 | +0 | -18 | static size |
| `fuel_duty_freeze` | 2030-31 | -0.72 ‡ (rerun -0.33) | +0 | -0.19 | +0 | -3 | static size |
| `fuel_duty_rise_cancellation` | 2027-28 | -2.04 | +0 | n/r ¶ | n/r ¶ | n/r ¶ |  |
| `fuel_duty_rise_cancellation` | 2030-31 | -1.94 | +0 | n/r ¶ | n/r ¶ | n/r ¶ |  |
| `mock_child_benefit_increase` | 2027-28 | -1.21 | -99 | -1.03 | -123 | -99 | static size |
| `mock_child_benefit_increase` | 2030-31 | -1.27 | -135 | -1.08 | -184 | -158 | static size, OBR effect size |
| `mock_energy_vat_zero_rate` | 2027-28 | -1.88 | +0 | -1.71 | +0 | -27 † |  |
| `mock_energy_vat_zero_rate` | 2028-29 | -0.64 | +0 | -0.57 | +0 | -9 † | static size |
| `mock_fuel_duty_freeze` | 2027-28 | -1.72 | +0 | n/r ¶ | n/r ¶ | n/r ¶ |  |
| `mock_fuel_duty_freeze` | 2030-31 | -2.10 | +0 | n/r ¶ | n/r ¶ | n/r ¶ |  |
| `mock_hvcts_extension` | 2028-29 | +0.27 | +0 | +0.24 | +0 | +6 |  |
| `mock_hvcts_extension` | 2030-31 | +0.28 | +0 | +0.25 | +0 | +6 |  |
| `mock_nics_threshold_rise` | 2027-28 | -0.79 | -13 | -0.95 | -10 | -11 | static size |
| `mock_nics_threshold_rise` | 2030-31 | -1.02 | -9 | -0.97 | -2 | -4 | OBR effect size |
| `property_tax_increase_2pp` | 2027-28 | +0.88 | +9 | +0.40 | +5 | +4 | static size |
| `property_tax_increase_2pp` | 2030-31 | +1.01 | +11 | +0.45 | +3 | +6 | static size, OBR effect size |
| `rail_fares_freeze` | 2026-27 | -0.15 | +0 | -0.15 | +0 | -3 |  |
| `rail_fares_freeze` | 2030-31 | -0.15 | +0 | -0.15 | +0 | -4 |  |
| `salary_sacrifice_cap` | 2029-30 | +2.78 ‡ (rerun +1.20) | n/r | +1.56 | +107 | +148 | static size |
| `salary_sacrifice_cap` | 2030-31 | +2.91 ‡ (rerun +1.14) | +203 | +1.61 | +119 | +152 | static size, OBR effect size |
| `savings_tax_increase_2pp` | 2027-28 | +0.79 | -15 | +0.28 | -1 | -3 | static size, OBR effect size |
| `savings_tax_increase_2pp` | 2030-31 | +0.93 | +1 | +0.33 | +36 | -2 | static size, OBR effect size |
| `threshold_freeze_extension` | 2028-29 | +3.73 | -191 | +3.61 | +32 | -53 | OBR effect sign |
| `threshold_freeze_extension` | 2030-31 | +12.12 | -243 | +11.96 | -415 | -583 | OBR effect size |
| `two_child_limit` | 2026-27 | -2.95 ‡ (rerun -2.83) | -170 | -2.27 | -125 | -105 | static size, OBR effect size |
| `two_child_limit` | 2030-31 | -3.72 ‡ (rerun -3.52) | n/r | -3.66 | -238 | -186 |  |
| `autumn_budget_2025_combined` | – | not rerun: its modifier edits `gov_tax.adds`, which 2.153.0 and 2.90.2 no longer define | | | | | |
| `freeze_student_loan_thresholds` | – | not rerun: its modifier edits `gov_tax.adds`, which 2.153.0 and 2.90.2 no longer define | | | | | |

</details>

<details><summary>Drill 2 (5 Oct): policyengine-uk 2.120.0, Microcosm national `aa31bdf6`</summary>

| Reform | Year | Drill, as published (£bn) | Drill engine + OBR route (£m) | Now, static (£bn) | Now + OBR route (£m) | Now + parameter route (£m) | Moves |
|---|---|---:|---:|---:|---:|---:|---|
| `mock2_cgt_rates` | 2027-28 | +4.42 | +0 | +4.38 | +0 | +7 |  |
| `mock2_cgt_rates` | 2030-31 | +4.96 | +0 | +4.91 | +0 | +15 |  |
| `mock2_electricity_vat_zero` | 2027-28 | -0.94 | +0 | -1.04 | +0 | -16 † |  |
| `mock2_electricity_vat_zero` | 2028-29 | -0.31 | +0 | -0.35 | +0 | -6 † |  |
| `mock2_employer_ni_threshold` | 2027-28 | -1.32 | -43 | -1.26 | -85 | -56 | OBR effect size |
| `mock2_employer_ni_threshold` | 2030-31 | -1.31 ‡ | -17 | -1.26 | -113 | -94 | OBR effect size |
| `mock2_energy_price_payment` | 2026-27 | -1.06 | -25 | -1.02 | -37 | -27 | OBR effect size |
| `mock2_fuel_duty_hold` | 2027-28 | -1.38 | +0 | -1.50 | +0 | -27 † |  |
| `mock2_fuel_duty_hold` | 2030-31 | -1.03 | +0 | -0.87 | +0 | -17 † | static size |
| `mock2_hvcts_band` | 2028-29 | +0.15 | +0 | +0.14 | +0 | +3 † |  |
| `mock2_hvcts_band` | 2030-31 | +0.16 | +0 | +0.14 | +0 | +3 † |  |
| `mock2_state_pension_personal_allowance` | 2027-28 | -0.35 | -0 | -0.38 | +14 | +12 | OBR effect size |
| `mock2_state_pension_personal_allowance` | 2030-31 | -1.35 | -0 | -1.34 | +2 | -4 |  |
| `mock2_state_pension_uprating` | 2030-31 | +0.99 ‡ | +0 | +0.87 | -0 | +1 | static size |

</details>

<details><summary>Drill 3 (12 Oct): policyengine-uk 2.125.1, Microcosm national `aa31bdf6`</summary>

| Reform | Year | Drill, as published (£bn) | Drill engine + OBR route (£m) | Now, static (£bn) | Now + OBR route (£m) | Now + parameter route (£m) | Moves |
|---|---|---:|---:|---:|---:|---:|---|
| `mock3_additional_rate_threshold` | 2027-28 | +1.65 | -578 | +1.64 | -854 | -930 | OBR effect size |
| `mock3_additional_rate_threshold` | 2031-32 | +2.17 | -985 | +2.09 | -1,197 | -1,310 |  |
| `mock3_cgt_higher_rate_aea` | 2027-28 | +4.49 | +0 | +4.44 | +0 | +5 |  |
| `mock3_cgt_higher_rate_aea` | 2031-32 | +5.23 | +0 | +5.16 | +0 | +14 |  |
| `mock3_class4_main_rate` | 2027-28 | +0.35 | +12 | +0.36 | -3 | -1 | OBR effect size |
| `mock3_class4_main_rate` | 2031-32 | +0.44 | -21 | +0.45 | +11 | +8 | OBR effect sign |
| `mock3_employer_ni_under_22` | 2027-28 | -1.33 | +0 | -1.56 | +0 | +0 † | static size |
| `mock3_employer_ni_under_22` | 2031-32 | -1.52 | +0 | -1.78 | +0 | +0 † | static size |
| `mock3_fuel_duty_phasing` | 2027-28 | -0.91 | +0 | -0.88 | +0 | -16 † |  |
| `mock3_fuel_duty_phasing` | 2031-32 | -0.52 | +0 | -0.44 | +0 | -9 † | static size |
| `mock3_hvcts_top_bands` | 2027-28 | +0.00 | +0 | +0.00 | +0 | +0 † |  |
| `mock3_hvcts_top_bands` | 2031-32 | +0.00 | +0 | +0.03 | +0 | +1 † | static sign |
| `mock3_lha_30th_percentile` | 2027-28 | -0.48 | -74 | -0.47 | -78 | -76 |  |
| `mock3_lha_30th_percentile` | 2031-32 | -0.99 | -147 | -1.13 | -173 | -158 | static size |
| `mock3_pensioner_allowance` | 2027-28 | -1.57 | -1 | -1.65 | -1 | -5 |  |
| `mock3_pensioner_allowance` | 2031-32 | -2.99 | -1 | -3.04 | -1 | -11 |  |
| `mock3_salary_sacrifice_cap` | 2029-30 | +0.97 | -16 | +0.97 | +14 | n/r † | OBR effect sign |
| `mock3_salary_sacrifice_cap` | 2031-32 | +1.10 | +34 | +1.01 | +22 | n/r † | OBR effect size |
| `mock3_threshold_freeze_2032` | 2031-32 | +4.46 | +117 | +4.33 | -85 | -82 | OBR effect sign |
| `mock3_whd_top_up` | 2026-27 | -0.72 | -15 | -0.69 | -31 | -25 | OBR effect size |
| `mock3_whd_top_up` | 2027-28 | -0.72 | -15 | -0.70 | -39 | -35 | OBR effect size |

</details>

<details><summary>Drill 4 (19 Oct): policyengine-uk 2.130.1, Microcosm national `810ba980`</summary>

| Reform | Year | Drill, as published (£bn) | Drill engine + OBR route (£m) | Now, static (£bn) | Now + OBR route (£m) | Now + parameter route (£m) | Moves |
|---|---|---:|---:|---:|---:|---:|---|
| `mock4_carers_allowance_limit` | – | withheld (<10) | | | | | |
| `mock4_cb_early_years_addition` | 2027-28 | -0.21 | -21 | -0.19 | -40 | +0 † | OBR effect size |
| `mock4_cb_early_years_addition` | 2031-32 | -0.20 | -30 | -0.18 | -40 | +0 † | OBR effect size |
| `mock4_cgt_higher_rate` | 2027-28 | +2.16 | +0 | +2.15 | +0 | -2 |  |
| `mock4_cgt_higher_rate` | 2031-32 | +2.52 | +0 | +2.51 | +0 | +6 |  |
| `mock4_combined` | 2026-27 | -1.53 | n/r | -1.58 | n/r | n/r † |  |
| `mock4_combined` | 2031-32 | +1.18 ‡ | n/r | +0.68 | n/r | n/r † | static size |
| `mock4_employer_ni_under23` | 2027-28 | -2.27 | +0 | -2.57 | +0 | +0 | static size |
| `mock4_employer_ni_under23` | 2031-32 | -2.40 | +0 | -2.72 | +0 | +0 | static size |
| `mock4_fuel_duty` | 2026-27 | -0.20 | +0 | -0.21 | +0 | -4 |  |
| `mock4_fuel_duty` | 2031-32 | -0.65 | +0 | -0.68 | +0 | -15 |  |
| `mock4_fuel_vat_cut` | 2026-27 | -0.51 | +0 | -0.53 | +0 | -10 |  |
| `mock4_fuel_vat_cut` | 2027-28 | -0.25 | +0 | -0.26 | +0 | -5 |  |
| `mock4_lha_reset` | 2027-28 | -1.47 | -88 | -1.39 | -150 | -142 | OBR effect size |
| `mock4_lha_reset` | 2031-32 | -1.68 | -106 | -1.56 | -140 | -119 |  |
| `mock4_savings_starting_band` | 2028-29 | +0.28 | +4 | +0.13 | +6 | +8 | static size |
| `mock4_savings_starting_band` | 2031-32 | +0.31 | +4 | +0.12 | +3 | +7 | static size |
| `mock4_state_pension_topup_allowance` | 2027-28 | -0.22 | n/r | -0.22 | n/r | n/r † |  |
| `mock4_state_pension_topup_allowance` | 2031-32 | -0.63 | n/r | -0.62 | n/r | n/r † |  |
| `mock4_threshold_freeze_2032` | 2031-32 | +4.80 | -37 | +4.82 | -123 | -89 | OBR effect size |
| `mock4_uc_child_element` | 2027-28 | -0.76 | -112 | -0.79 | -104 | -68 |  |
| `mock4_uc_child_element` | 2031-32 | -0.76 | -112 | -0.78 | -110 | -70 |  |
| `mock4_whd_topup` | 2026-27 | -0.82 | -7 | -0.84 | -7 | +0 † |  |

</details>

## What this means for 28 October

1. **The published basis stays static.** The publication rule compares our static figure with the static costing (`docs/budget-day-publication.md:205`), and nothing here changes that.
2. **The certified bundle cannot produce a post-behavioural column.** On 2.132.6 the parameter route always returns 0. The OBR route would need new pipeline code, it changes hours only, and it mis-costs measures written as modifiers that set values. A post-behavioural column needs policyengine-uk 2.133.0 or later. Adopting that also brings the CGT response from 2.134.0 and the construction-time rule for dated keys. With three days to go, we should not add one for 28 October.
3. **Code Budget-day measures as parameter changes or formula reforms, not `set_input` modifiers.** Static costings are unaffected either way. Any response, on either route, is not computable, wrong or silently zero for a measure that fixes values with `set_input`. The State Pension top-up allowance shows the worst case: a modifier that fixes an income-dependent variable.
4. **Re-run responses whenever the engine or the data changes.** Responses moved more between releases than static figures did (see Results). So a post-behavioural figure from one engine and data pair should not be read against another.
5. **Decide which taxes a response should see.** The OBR route ignores indirect taxes, CGT and the high-value council tax surcharge. The parameter route sees them through `household_net_income`. That is a modelling choice to make before publishing any response.
6. **Employer NI responses depend on how a measure is coded.** A parameter change to the employer threshold passes through to wages and gets a response. The modifier or template versions for young workers do not.

## Limits of this check

- **The measures are the drills' mock measures**, not real Budget measures. The patterns matter more than the levels.
- **Two years per measure**, not the full window.
- **The OBR route changes hours only**, because the participation part is off. The OBR's own NICs estimate put participation at 14,000 of 94,000 FTEs.
- **The OBR route gives lone fathers no response.** The OBR tables put them in the lone-parent rows, but the engine's lone-parent groups include women only.
- **The parameter route gives everyone one elasticity pair** (0.15 and −0.05), not the OBR's values by group.
- **The OBR-route figures here keep modifier-set inputs** through the engine's cache resets. So they show what the route would give for these measures once that is corrected, not what `apply_dynamics` gives as released.
- **The four measures with dated keys were ported** to construction-time keys for the 2.153.0 runs.
  - The drill 2 and 3 measures use month ranges (`2026-01-01.2026-01-31`), which 2.153.0 reads the same way.
  - The drill 1 measures use single-date monthly keys (`2026-01-01`). The drill engine reads each as "from this date", but 2.153.0 reads a single date as one day. So the port applied them one day a month, and their 2.153.0 cells are n/r (¶). They need a rerun with month ranges.
- **Nine published cells do not reproduce on their drill's engine and file (‡):** six for three carried-over drill 1 measures, and three in drills 2 and 4. The drill-engine rerun is the reference for their moves and effects.
- **Disclosure.** Cells resting on fewer than 10 households or responders are withheld, and one measure is withheld in every year.

### Engine follow-ups (not filed here)

These belong in policyengine-uk, not in this repo:

- `apply_dynamics` should keep inputs that a scenario's modifier sets. Either capture `input_variables` after the modifier runs, or make `reset_calculations` keep `_user_input_keys`.
- The parameter route's measurement branches should carry modifier-set inputs, or refuse a scenario that has them.
- The OBR route's lone-parent rows should include lone fathers.

