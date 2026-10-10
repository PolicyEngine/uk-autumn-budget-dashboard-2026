MOCK DATA: rehearsal Budget for PolicyEngine drill 3, 12 October 2026. Not a real Budget.

# National data inputs and implementation brief

*Released at 13:40 BST. All numbers in the accompanying CSVs are synthetic rehearsal inputs. They are not HMRC statistics or OBR forecasts.*

Measures **4 (CGT)** and **20 (salary sacrifice)** include data work. Implement both changes during the drill, produce separately identified experimental data artifacts, and rerun the scores. Use `MOCK-data-work-results.csv` to record the before/after diagnostics and the artifact/code hashes. These tasks use the existing timetable and gates. The debrief checks below add no gate, deadline or scoring weight.

Use the chosen G0 national dataset for scoring. The eight pension records are a small diagnostic fixture for developing and checking the allocation; they are not a representative replacement for that dataset. Preflight access to the data pipeline, national data and an incremental rebuild/calibration command before Monday. If a full national rebuild exceeds the clock, retain the small reproducible diagnostic artifact, record the limitation, and identify which national outputs still use the original data. Do not publish fixture totals as national revenue.

## Measure 4: CGT projection

`MOCK-cgt-projection-inputs.csv` supplies an observed-year anchor, mock subsequent-year determinants and a higher-rate chargeable-gains path consistent with the static costing. Amounts are £bn except taxpayers (thousands) and the AEA contribution (£m). Higher-rate gains exclude BADR, Investors' Relief and carried interest, and are already net of the baseline annual exempt amount. Gross realised gains and chargeable higher-rate gains are distinct quantities.

Inspect the existing projection, then implement a CGT-specific path for future years instead of carrying the observed-year spike forward with GDP per capita. Preserve the selected dataset's observed-year amounts and weights. Normalize the mock paths to their 2024-25 anchors when applying them to a dataset whose observed levels differ; disclose any additional level adjustment. Document how the separate gains and taxpayer determinants affect amounts, incidence and weights. Avoid applying both an amount multiplier and a weight multiplier to the same aggregate without reconciling their combined effect.

Report baseline gross gains, taxpayers and CGT liability, and measure 4's static revenue, before and after the change. Hold the costing's forestalling, steady-state realisation response and liability-to-cash assumptions fixed. For the costing cross-check use 4% of the released higher-rate chargeable-gains base plus the AEA contribution. Apply 7% of each tax year's liability in that fiscal year and 93% in the next fiscal year. CGT cash figures in the costing are rounded to the nearest £5m; retain full precision until that display step. Retain the final tax-year liability beyond the cash forecast rather than dropping it. The existing household CGT cases remain liability-based.

The projection determinants describe the pre-measure baseline. Measure 4's forestalling is an incremental response and must not be embedded in that baseline a second time. The synthetic observed-year spike represents a historical event, not a response to this mock Budget.

## Measure 20: salary-sacrifice calibration

Port the bracket-by-bracket allocation of salary-sacrifice income tax relief. Compute tax on earned taxable income with and without the sacrifice using the person's nation-specific schedule and Personal Allowance, then allocate the difference to the brackets it crosses. Use the Annex A schedules for these mock inputs. Group Scottish starter, basic and intermediate relief as `basic`, Scottish higher and advanced as `higher`, and Scottish top as `additional`. Apply the corresponding three categories in the rest of the UK. Keep unrelated tax charges outside this earned-income diagnostic and disclose any wider `income_tax` comparator separately.

`MOCK-salary-sacrifice-records.csv` contains eight independent employees, with contractual salary **before** sacrifice, annual pension salary sacrifice and initial population weights. Cash salary is contractual salary minus sacrifice. No other income, pensions, allowances, benefits, annual allowance charges, HICBC or employer pass-through applies to the fixture. All employees are aged 40, work for large private-sector employers and are not apprentices. The fixture uses the uncapped 2026-27 baseline for relief allocation.

`MOCK-salary-sacrifice-targets.csv` contains the synthetic 2026-27 UK-wide band-relief targets. Restore the three band targets using the repaired allocation and recalibrate the national weights. The separately rounded total is a diagnostic: choose the bands or the total as binding constraints, and document the choice. Do not bind both representations of the same relief. Check employee and employer NICs relief as separate quantities using the applicable year's Class 1 rates; do not reintroduce duplicated OBR-labelled versions of an HMRC target.

Rerun the £2,000-to-£1,000 cap change against the existing cap from April 2029. Keep contributions, income tax pension relief and all behavioural/incidence settings fixed for the static before/after comparison. Keep the employee response and broad-workforce earnings haircut **off** in both runs; the post-behavioural costing is a separate comparator. A fitter must use the new allocation on the national records, not just relabel the targets. Report relief by band, contribution totals, effective sample size, baseline NICs relief and reform revenue before/after. These illustrative target levels do not promise to close the whole real scorecard gap.

## Debrief checks (guidance only)

- Is the diagnosis reproducible, with a code/data artifact and source/assumption provenance?
- Does the CGT change preserve the observed-year fit and distinguish gains, taxpayer incidence, liabilities, payment lag and forestalling?
- Do pension cases crossing brackets allocate relief correctly under Scottish and rUK rates, and do categories sum to the earned-income tax difference?
- Are overlapping calibration constraints avoided, weights/fit reported, and behavioural assumptions held fixed?
- Do before/after scores identify engine/core, code SHA, data hash and validation status, with unexplained residuals and unaffected quantities checked?
- Does the final scoring run use the stated artifact consistently and preserve the superseded run?

Use these checks to discuss implementation quality after the drill. No extra pass/fail data-repair gate or process points apply.

## Real background for the exercise

The [CGT projection investigation](https://github.com/PolicyEngine/uk-cgt-reform/issues/2#issuecomment-6014594940), [Microcosm pension calibration tracker](https://github.com/PolicyEngine/microcosm/issues/1095), and [UK-data allocation repair](https://github.com/PolicyEngine/policyengine-uk-data/pull/533) motivate the tasks. Their real evidence is separate from the invented inputs above.
