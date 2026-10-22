# Forecast rebase: Budget-day runbook

Use after the OBR publishes its October 2026 EFO, before releasing results. This is a forecast refresh on the existing Microcosm build: it does not recalibrate the data. Keep outputs in scratch until the normal reconciliation, approval and disclosure gates pass. Fiscal year `2026` means 2026–27; macro keys name calendar years.

The 22 October rehearsal used dashboard `8a6b8a6d`, policyengine 6.10.0, policyengine-uk 2.145.0 (`ecd531776`), Core 3.33.3 and the national Microcosm UK 2024–25 cut (SHA-256 `810ba980005a8b907cb51464279fa5e0125464b7af9a4871b7f6744c30951ece`). Dashboard's checked-in `uv.lock` actually installs UK 2.132.6. For this rehearsal only, after `uv sync --frozen`, install the official 2.145.0 wheel with `uv pip install --python .venv/bin/python --no-deps policyengine-uk==2.145.0`, and use `uv run --no-sync` thereafter. Set `REBASE_REHEARSAL=1` before step 1 to apply the overlay immediately after the frozen sync; otherwise the sync restores UK 2.132.6. Do not mistake that local overlay for adoption of a certified production bundle. On Budget day require the reviewed model/data pair and record the actual versions, lock hash and Git SHA before starting.

**Rehearsal status:** the official March economy workbook returned HTTP 403, so the complete economy round trip is unvalidated. The original cached receipts workbook reproduced all five September-CPI gaps exactly; 24 upstream importer fixture tests passed. Resource waits are additional, unbounded time. Do not infer a validated Budget-day completion deadline from a failed download or a gated run.

1. **Prepare a scratch directory and cap every numerical thread pool at four.** Run from the clean dashboard checkout. `REBASE_JSON` is the reviewed JSON object mapping parameter paths to calendar-year interval/value mappings, including the statutory-input overrides. `DATASET` is the single-year Microcosm cut (or the rehearsal's every-40th-household cut). Do not run concurrent jobs.

   ```sh
   set -e
   uv sync --frozen
   # Only when reproducing this drill: export REBASE_REHEARSAL=1 first.
   if [ "${REBASE_REHEARSAL:-0}" = 1 ]; then
     uv pip install --python .venv/bin/python --no-deps policyengine-uk==2.145.0
     export EXPECTED_UK_VERSION=2.145.0
   fi
   # Otherwise set EXPECTED_UK_VERSION to the reviewed Budget-day bundle's pin.
   : "${EXPECTED_UK_VERSION:?Set the reviewed UK version before generation}"
   export EXPECTED_UK_VERSION
   uv run --no-sync python - <<'PYCODE'
   import importlib.metadata as m, os
   names=['policyengine','policyengine-uk','policyengine-core']
   print({name:m.version(name) for name in names})
   assert m.version('policyengine-uk') == os.environ['EXPECTED_UK_VERSION']
   PYCODE
   export OMP_NUM_THREADS=4 OPENBLAS_NUM_THREADS=4 MKL_NUM_THREADS=4
   export VECLIB_MAXIMUM_THREADS=4 NUMEXPR_NUM_THREADS=4 NUMBA_NUM_THREADS=4
   export DATASET="/absolute/path/to/microcosm_uk_2024_25.h5"
   export REBASE_JSON="/absolute/path/to/reviewed-forecast.json"
   export REBASE_SCRATCH="$(mktemp -d "${TMPDIR:-/tmp}/obr-rebase.XXXXXX")"
   mkdir -p "$REBASE_SCRATCH/data_inputs"
   cp data_inputs/publication_basis.json "$REBASE_SCRATCH/data_inputs/publication_basis.before.json"
   cp -R public/data "$REBASE_SCRATCH/public-data"
   cp -R data_inputs/treasury "$REBASE_SCRATCH/data_inputs/treasury"
   ```

   Production receipted generation below loads the **repository's** `data_inputs/publication_basis.json`. Set its `forecast.status` to `updated` and record the actual EFO URL, vintage, input-file checksums and any omitted series; retain the original calibration section. Review and commit that edit before production generation. A scratch basis file by itself does not affect `publish stage`: the stage command reads the basis embedded in the artifact's receipt.

2. **Download both EFO workbooks and round-trip March first.** Obtain the economy and receipts detailed forecast tables from the [OBR EFO page](https://obr.uk/economic-and-fiscal-outlooks/). Preserve source URLs, download time and SHA-256 checksums. The [March 2026 EFO](https://obr.uk/efo/economic-and-fiscal-outlook-march-2026/) economy endpoint is `https://obr.uk/download/march-2026-economic-and-fiscal-outlook-detailed-forecast-tables-economy/`; the matching receipts endpoint ends `detailed-forecast-tables-receipts/`. A 403 is a failed acquisition, not a matching round trip; obtain the original files through the operator's authorized download route before relying on this validation.

   The importer is `policyengine_uk/utils/import_obr_forecasts.py` (repository CLI `scripts/import_obr_forecasts.py`). Copy the parameter tree into scratch so it can update growth and both gap files atomically:

   ```sh
   export PARAMETER_SOURCE="$(uv run --no-sync python - <<'PYCODE'
   import importlib.util
   from pathlib import Path
   print(Path(importlib.util.find_spec('policyengine_uk').origin).parent / 'parameters')
   PYCODE
   )"
   cp -R "$PARAMETER_SOURCE" "$REBASE_SCRATCH/parameters"
   export MARCH_ECONOMY=/absolute/path/to/original-March-economy.xlsx
   export MARCH_RECEIPTS=/absolute/path/to/original-March-receipts.xlsx
   /usr/bin/time -p uv run --no-sync python -m policyengine_uk.utils.import_obr_forecasts \
     --file "$MARCH_ECONOMY" --receipts-file "$MARCH_RECEIPTS" \
     --yaml-path "$REBASE_SCRATCH/parameters/gov/economic_assumptions/yoy_growth.yaml" \
     --release-month March --release-year 2026 \
     --forecast-start-year 2025 --forecast-years 6
   diff -ru "$PARAMETER_SOURCE/gov/economic_assumptions" \
     "$REBASE_SCRATCH/parameters/gov/economic_assumptions"
   ```

   Review **values** separately from changed comments/reference metadata. Explain every numerical difference before continuing. Do not use `--output` for the full round trip: it suppresses gap-file writes. March ends in 2030, and the pinned importer replaces existing dated lines rather than adding them. Before importing October's 2026–2031 window, seed any missing 2031 line in the scratch YAML with a clearly labelled temporary copy of its last value. The command checks all seven importer targets, rejects missing earlier years and requires the workbook to supply every target year, so a placeholder cannot silently remain as a forecast. It preserves the YAML's comments and indentation.

   ```sh
   export OCTOBER_ECONOMY=/absolute/path/to/original-October-economy.xlsx
   export OCTOBER_RECEIPTS=/absolute/path/to/original-October-receipts.xlsx
   uv run --no-sync python - <<'PYCODE'
   import os, re
   from pathlib import Path
   from policyengine_uk.utils.import_obr_forecasts import (
       SERIES_SPECS, extract_annual_series_from_xlsx,
       extract_economy_workbook_bytes,
   )
   source=Path(os.environ['OCTOBER_ECONOMY'])
   _, workbook=extract_economy_workbook_bytes(source.name,source.read_bytes())
   supplied=extract_annual_series_from_xlsx(workbook)
   path=Path(os.environ['REBASE_SCRATCH'])/'parameters/gov/economic_assumptions/yoy_growth.yaml'
   content=path.read_text()
   for spec in SERIES_SPECS:
       absent=set(range(2026,2032))-set(supplied[spec.key])
       if absent: raise RuntimeError(f'{spec.key}: workbook lacks {sorted(absent)}')
       pattern=re.compile(rf'(^  {spec.key}:\n.*?)(?=^  [a-z_]+:|\Z)',re.M|re.S)
       match=pattern.search(content)
       if match is None: raise RuntimeError(f'Missing section: {spec.key}')
       section=match.group(1)
       dates=list(re.finditer(r'^      (\d{4})-01-01:[ \t]*([^#\n]+)',section,re.M))
       existing={int(value.group(1)) for value in dates}
       missing=set(range(2026,2031))-existing
       if missing: raise RuntimeError(f'{spec.key}: missing earlier years {sorted(missing)}')
       if 2031 in existing: continue
       previous=max((value for value in dates if int(value.group(1))<2031),
                    key=lambda value:int(value.group(1)))
       placeholder=float(previous.group(2).strip())
       line_end=section.find('\n',previous.end())
       if line_end<0: raise RuntimeError(f'Unexpected values block: {spec.key}')
       insertion=(f'\n      # Temporary 2031 placeholder; October import below must overwrite it.'
                  f'\n      2031-01-01: {placeholder:.4f}')
       section=section[:line_end]+insertion+section[line_end:]
       content=content[:match.start()]+section+content[match.end():]
       print(f'Seeded {spec.key} 2031 placeholder: {placeholder:.4f}')
   path.write_text(content)
   PYCODE
   /usr/bin/time -p uv run --no-sync python -m policyengine_uk.utils.import_obr_forecasts \
     --file "$OCTOBER_ECONOMY" --receipts-file "$OCTOBER_RECEIPTS" \
     --yaml-path "$REBASE_SCRATCH/parameters/gov/economic_assumptions/yoy_growth.yaml" \
     --release-month October --release-year 2026 \
     --forecast-start-year 2026 --forecast-years 6
   ```

   Remove the temporary-placeholder comments after verifying that all new 2031 values came from the workbook. Review retained long-run tails explicitly. The importer rounds annual rates to four decimals and gaps to five; its gap-file renderer creates the new horizon dates automatically.

3. **Build and review the dated forecast dictionary and statutory observations.** Convert all refreshed raw values **and both forecast-gap files** to `parameter.path: {"YYYY-01-01.YYYY-12-31": fraction}`. Add separately sourced paths the importer misses. Do not reform generated `indices.*`, triple-lock or capital-gains paths. Keep an audit of old/new values and sources. This writes a complete six-year dictionary from a scratch parameter tree:

   ```sh
   export REBASE_JSON="$REBASE_SCRATCH/forecast.json"
   uv run --no-sync python - <<'PYCODE'
   import datetime, json, os, time
   from pathlib import Path
   import yaml
   start=time.perf_counter()
   base=Path(os.environ['REBASE_SCRATCH'])/'parameters/gov/economic_assumptions'
   tree=yaml.safe_load((base/'yoy_growth.yaml').read_text())
   paths=['obr.average_earnings','obr.rpi','obr.consumer_price_index','obr.cpih',
          'obr.mortgage_interest','obr.rent','obr.house_prices']
   result={}
   def annual_values(node, observation_month=1):
       values=node['values']; out={}
       for year in range(2026,2032):
           date=datetime.date(year,observation_month,1)
           value=values[max(d for d in values if d<=date)]
           out[f'{year}-01-01.{year}-12-31']=value
       return out
   for path in paths:
       node=tree
       for part in path.split('.'): node=node[part]
       result['gov.economic_assumptions.yoy_growth.'+path]=annual_values(node)
   for name in ['cpi_september','awe_total_pay_may_july']:
       node=yaml.safe_load((base/'statutory_uprating_inputs/forecast_gap'/f'{name}.yaml').read_text())
       month=9 if name=='cpi_september' else 7
       result['gov.economic_assumptions.statutory_uprating_inputs.forecast_gap.'+name]=annual_values(node,month)
   prefix='gov.economic_assumptions.statutory_uprating_inputs.'
   result[prefix+'cpi_september']={'2026-01-01.2026-12-31':0.035}
   result[prefix+'awe_total_pay_may_july']={'2026-01-01.2026-12-31':0.039}
   Path(os.environ['REBASE_JSON']).write_text(json.dumps(result,indent=2)+'\n')
   print('dictionary wall seconds',time.perf_counter()-start)
   PYCODE
   ```

   September 2026 CPI is **3.5%**, published 21 October ([ONS bulletin](https://www.ons.gov.uk/economy/inflationandpriceindices/bulletins/consumerpriceinflation/september2026)); May–July 2026 total-pay AWE is **3.9%** in the October vintage ([ONS KAC3](https://www.ons.gov.uk/employmentandlabourmarket/peopleinwork/earningsandworkinghours/timeseries/kac3/lms)). Do not add a hypothetical annual shock to a published observation. April 2027 triple lock is `max(3.5%,3.9%,2.5%) = 3.9%`.

   To repeat the synthetic drill, start from the **unchanged March tree**, add `obr.per_capita.gdp` to `paths`, and change only CPI 2026 `.023 → .028`, CPI 2027 `.020 → .025`, earnings 2027 `.024 → .019`, house prices 2027 `.029 → .049`, and nominal GDP/head 2027 `.0323 → .0293`. Other 2026–2031 entries stay fixed. Keep the published statutory overrides above. The resulting unpublished September 2027 CPI is `.02572`, May–July 2027 AWE `.01927`, rounded to 2.6% and 1.9%; April 2028 triple lock becomes **2.6%**, versus 2.5%. Leave April 2027 triple lock at 3.9%; let parameter processing derive it.

4. **Make the every-40th-household cut and smoke-test the data path first.** Retain whole households with their people/benefit units and original weights. Do not call this a calibrated national estimate. Read the national source in place; never overwrite it.

   ```sh
   export NATIONAL_DATASET="$DATASET"
   uv run --no-sync python - <<'PYCODE'
   import os, time
   from pathlib import Path
   import pandas as pd
   start=time.perf_counter(); source=Path(os.environ['NATIONAL_DATASET'])
   hh=pd.read_hdf(source,'household'); person=pd.read_hdf(source,'person')
   bu=pd.read_hdf(source,'benunit'); kept=hh.household_id.iloc[::40]
   people=person.person_household_id.isin(kept)
   units=bu.benunit_id.isin(person.loc[people,'person_benunit_id'])
   out=Path(os.environ['REBASE_SCRATCH'])/'every40.h5'
   hh.loc[hh.household_id.isin(kept)].to_hdf(out,key='household',mode='w')
   person.loc[people].to_hdf(out,key='person',mode='a')
   bu.loc[units].to_hdf(out,key='benunit',mode='a')
   pd.read_hdf(source,'time_period').to_hdf(out,key='time_period',mode='a')
   print({'households':len(kept),'people':int(people.sum()),
          'benefit_units':int(units.sum()),'wall_seconds':time.perf_counter()-start})
   PYCODE
   export DATASET="$REBASE_SCRATCH/every40.h5"
   ```

   The command below runs the two subset arms sequentially and saves only aggregates. Each construction has a fresh `uptime`/disk gate. Weighted totals retain the subset's original weights and are **not** calibrated national estimates; unweighted sums isolate changes in stored values. The parameter probes distinguish observed statutory inputs, generated triple-lock rates and basic/new pension amounts. A `reform=` dict on this single-year dataset route re-uprates the data in 2.145.0; policyengine's separate `Simulation(policy=...)` API does not.

   ```sh
   cat > "$REBASE_SCRATCH/forecast_smoke.py" <<'PY'
   import gc
   import json
   import os
   import subprocess
   import time
   from pathlib import Path

   import numpy as np
   import policyengine as pe

   def gate(label):
       waited=time.perf_counter()
       while True:
           uptime=subprocess.run(['uptime'],check=True,capture_output=True,text=True).stdout.strip()
           fs=os.statvfs(Path.cwd())
           free_gb=fs.f_bavail*fs.f_frsize/1e9
           load1=os.getloadavg()[0]
           print(f'{label}: {uptime}; available={free_gb:.3f} GB',flush=True)
           if load1<=110 and free_gb>=55:
               return time.perf_counter()-waited
           time.sleep(30)

   variables=['employment_income_before_lsr','universal_credit','child_benefit',
              'state_pension','council_tax','vat','main_residence_value','gov_balance']
   forecast=json.loads(Path(os.environ['REBASE_JSON']).read_text())
   arms=os.environ.get('SMOKE_ARMS','unshifted,rebased').split(',')
   assert arms and set(arms)<=set(['unshifted','rebased'])
   results={}
   for label in arms:
       wait_seconds=gate(label)
       started=time.perf_counter()
       kwargs={'reform':forecast} if label=='rebased' else {}
       sim=pe.uk.managed_microsimulation(
           dataset=os.environ['DATASET'],allow_unmanaged=True,**kwargs)
       construction_seconds=time.perf_counter()-started
       rows=[]
       for year in range(2026,2031):
           totals={}
           for variable in variables:
               values=sim.calculate(variable,year)
               totals[variable]={'weighted_gbp':float(values.sum()),
                                 'unweighted_gbp':float(np.asarray(values).sum())}
           p=sim.tax_benefit_system.parameters
           statutory='gov.economic_assumptions.statutory_uprating_inputs.'
           parameters={
               'previous_september_cpi':float(p.get_child(statutory+'cpi_september')(f'{year-1}-09-01')),
               'previous_may_july_awe':float(p.get_child(statutory+'awe_total_pay_may_july')(f'{year-1}-07-01')),
               'triple_lock':float(p.get_child('gov.economic_assumptions.yoy_growth.triple_lock')(f'{year}-04-30')),
               'basic_pension_weekly_gbp':float(p.get_child('gov.dwp.state_pension.basic_state_pension.amount')(f'{year}-04-30')),
               'new_pension_weekly_gbp':float(p.get_child('gov.dwp.state_pension.new_state_pension.amount')(f'{year}-04-30')),
           }
           rows.append({'year':year,'totals':totals,'parameters':parameters})
       results[label]={'wait_seconds':wait_seconds,
                       'construction_seconds':construction_seconds,
                       'simulation_wall_seconds':time.perf_counter()-started,
                       'rows':rows}
       del values,sim
       gc.collect()
   if set(results)==set(['unshifted','rebased']):
       results['percentage_changes']=[
           {'year':old['year'],'weighted_percent':{
               name:100*(new['totals'][name]['weighted_gbp']/old['totals'][name]['weighted_gbp']-1)
               if old['totals'][name]['weighted_gbp'] else None
               for name in variables}}
           for old,new in zip(results['unshifted']['rows'],results['rebased']['rows'])]
   output=Path(os.environ['REBASE_SCRATCH'])/os.environ.get('SMOKE_OUTPUT','subset-smoke.json')
   output.write_text(json.dumps(results,indent=2)+'\n')
   print(json.dumps(results,indent=2))
   PY
   uv run --no-sync python "$REBASE_SCRATCH/forecast_smoke.py"
   ```

   Expected synthetic directions: earnings down about 0.49% from the changed year; CPI-uprated stored amounts up about 0.49% after 2026 and 0.98% cumulatively after 2027, before fiscal blending/interactions; housing values up about 1.94%; GDP/head inputs down about 0.29%. Council tax is the **unchanged negative control** because its country paths are independent. VAT rises with affected non-energy consumption while coverage factors stay fixed. Pension rate movement follows the triple lock; stored pension/additional-pension CPI projection may also affect its aggregate. An unexpected zero or one-year lag on earnings/CPI stops the run.

   Run only one national rebased simulation after the subset checks pass. This invocation checks the gate again and records national aggregates separately; it does not rerun the national unshifted arm. It leaves the shell's `DATASET` pointing at the subset for the measure comparison in step 5.

   ```sh
   DATASET="$NATIONAL_DATASET" SMOKE_ARMS=rebased SMOKE_OUTPUT=national-smoke.json \
     uv run --no-sync python "$REBASE_SCRATCH/forecast_smoke.py"
   ```

   Keep one simulation process at a time and all numerical thread pools at four. There is no timeout exception to load1 ≤110 and available disk ≥55 **decimal** GB. Log wait time separately; do not substitute a previous passing gate for the next check. Before production artifact generation in step 6, explicitly restore `export DATASET="$NATIONAL_DATASET"`; a subset cannot produce publishable national receipts.

5. **Check the real route and regenerate a registered measure with the forecast in both arms.** This command reads the dataset in place, runs the dashboard's full `ReformProcessor`, and prints only aggregate budgetary rows and timings. It writes a reusable helper script into scratch so the same reviewed gate/merge functions can be used in the artifact step. The macro dict is part of both scenario identities; retain every registered policy change and modifier. `DataConfig.baseline_parameter_changes` alone does not rebase the reform arm and is overridden by a measure's own baseline.

   ```sh
   cat > "$REBASE_SCRATCH/forecast_helpers.py" <<'PY'
   import copy
   import importlib
   import json
   import math
   import os
   import subprocess
   import time
   from pathlib import Path
   from unittest.mock import patch

   import policyengine_uk
   from policyengine_uk.tax_benefit_system import CountryTaxBenefitSystem
   from policyengine_uk.utils.scenario import Scenario
   from uk_budget_data import pipeline
   from uk_budget_data import reforms as reform_registry
   from uk_budget_data.models import DataConfig
   from uk_budget_data.pipeline import ReformProcessor

   def gate(label):
       while True:
           observed = subprocess.run(
               ["uptime"], check=True, capture_output=True, text=True
           ).stdout.strip()
           load1 = os.getloadavg()[0]
           fs = os.statvfs(Path.cwd())
           free_gb = fs.f_bavail * fs.f_frsize / 1e9  # Decimal GB.
           print(f"{label}: {observed}; available={free_gb:.3f} GB", flush=True)
           if load1 <= 110 and free_gb >= 55:
               return
           time.sleep(30)

   def merged(forecast, policy):
       policy = policy or {}
       collisions = sorted(set(forecast) & set(policy))
       if collisions:
           raise RuntimeError(
               "Review forecast/policy collisions before proceeding: "
               + ", ".join(collisions)
           )
       return {**copy.deepcopy(forecast), **copy.deepcopy(policy)}

   def rebase_measure(measure, forecast):
       return measure.model_copy(deep=True, update={
           "parameter_changes": merged(forecast, measure.parameter_changes),
           "baseline_parameter_changes": merged(
               forecast, measure.baseline_parameter_changes
           ),
       })

   def registered_measures(forecast):
       # Factories calculate counterfactual cash amounts from the module's
       # current CPIH/RPI indices. Rebuild those indices without loading data.
       forecast_system = CountryTaxBenefitSystem()
       assignments = Scenario.from_reform(forecast).dated_assignments()
       assert not forecast or assignments, "Forecast produced no dated assignments"
       forecast_system.apply_parameter_assignments(assignments)
       system_module = importlib.import_module("policyengine_uk.system")
       # Fuel-duty standalone/combined factories still hardcode their RPI
       # counterfactuals. Stop this all-measure recipe if processed RPI moves;
       # a dictionary containing unchanged RPI values is safe to continue.
       rpi_path = "gov.economic_assumptions.indices.obr.rpi"
       old_rpi = system_module.system.parameters.get_child(rpi_path)
       new_rpi = forecast_system.parameters.get_child(rpi_path)
       if any(not math.isclose(old_rpi(f"{year}-{month_day}"),
                               new_rpi(f"{year}-{month_day}"),rel_tol=1e-12)
              for year in range(2026,2031)
              for month_day in ("04-01","04-06")):
           raise RuntimeError(
               "Processed RPI changed: stop all-measure generation until "
               "fuel-duty and combined hardcoded counterfactuals are reviewed "
               "and updated in the approved registry; do not bypass this guard."
           )
       cache_names = [name for name in vars(reform_registry)
                      if name.endswith("_CACHE")]
       aliases = ["PRE_AUTUMN_BUDGET_BASELINE", "FREEZE_STUDENT_LOAN_THRESHOLDS",
                  "AUTUMN_BUDGET_2026_REFORMS", "ALL_REFORMS"]
       reset = {name: None for name in cache_names + aliases}
       # Restore the exact original global system and cache objects, including
       # on exceptions. No other work may use the registry during this block.
       with patch.object(system_module, "system", forecast_system), \
            patch.multiple(reform_registry, **reset):
           fresh = [measure.model_copy(deep=True) for measure in
                    reform_registry.get_autumn_budget_2026_reforms()]
       # Preserve factory functions/modifiers and newly calculated cash
       # amounts, then put the forecast in both scenario arms.
       return [rebase_measure(measure, forecast) for measure in fresh]

   def config():
       return DataConfig(
           dataset_path=Path(os.environ["DATASET"]),
           years=[2026, 2027, 2028, 2029, 2030],
           output_dir=Path(os.environ["REBASE_SCRATCH"]) / "public-data",
       )

   def load_forecast():
       return json.loads(Path(os.environ["REBASE_JSON"]).read_text())

   def build_in_place(dataset_path, scenario=None):
       gate("managed_microsimulation")
       return pipeline.build_microsimulation(dataset_path, scenario)

   def process(measure, cfg, baseline, reformed, baseline_scenario):
       original = policyengine_uk.Simulation
       def guarded_situation(*args, **kwargs):
           gate("income-curve situation Simulation")
           return original(*args, **kwargs)
       # IncomeCurveCalculator imports this class inside calculate().
       with patch.object(policyengine_uk, "Simulation", guarded_situation):
           return ReformProcessor(measure, cfg).process(
               baseline, reformed, baseline_scenario
           )
   PY
   PYTHONPATH="$REBASE_SCRATCH${PYTHONPATH:+:$PYTHONPATH}" uv run --no-sync python - <<'PY'
   import json
   import time
   from forecast_helpers import (
       build_in_place, config, load_forecast, process, rebase_measure,
   )
   from uk_budget_data.reforms import get_reform

   cfg = config()
   original = get_reform("dividend_tax_increase_2pp")
   assert original is not None
   measures = [("unshifted", original),
               ("rebased", rebase_measure(original, load_forecast()))]
   for label, measure in measures:
       started = time.perf_counter()
       baseline_scenario = measure.baseline_scenario_for(cfg)
       baseline = build_in_place(str(cfg.dataset_path), baseline_scenario)
       reformed = build_in_place(str(cfg.dataset_path), measure.to_scenario())
       result = process(measure, cfg, baseline, reformed, baseline_scenario)
       import numpy as np
       # A dividend-rate change must share the same projected input data.
       for year in cfg.years:
           for variable in ['employment_income_before_lsr',
                            'food_and_non_alcoholic_beverages_consumption']:
               left=np.asarray(baseline.calculate(variable, year))
               right=np.asarray(reformed.calculate(variable, year))
               if not np.allclose(left, right, rtol=1e-6, atol=0.01):
                   raise RuntimeError(f'Forecast arms disagree: {variable}, {year}')
       # Independently reconcile the costing with receipts minus spending.
       for row in result.budgetary_impact:
           year=row['year']
           tax_delta=(reformed.calculate('gov_tax', year)
                      -baseline.calculate('gov_tax', year)).sum()/1e9
           spend_delta=(reformed.calculate('gov_spending', year)
                        -baseline.calculate('gov_spending', year)).sum()/1e9
           if not np.isclose(row['value'], tax_delta-spend_delta,
                             rtol=1e-4, atol=1e-5):
               raise RuntimeError(f'Budget identity failed: {year}')
       print(json.dumps({"basis": label,
                         "wall_seconds": time.perf_counter() - started,
                         "budgetary_impact": result.budgetary_impact}))
       del result, baseline, reformed
   PY
   ```

   This runs the whole processor: costing, distribution, winners/losers, metrics, income curve and household scatter. The output above is aggregate only. The internal result also contains household rows; do not print or export them. The gate checks `uptime` and `os.statvfs` before every managed microsimulation and each of the income curve's household `Simulation` constructions. Each 5-year measure builds two microsimulations plus ten vectorised household situations; all run sequentially.

6. **Generate new receipted artifacts and rehearse basis adoption in scratch.** Use the clean, committed forecast declaration. `registered_measures` rebuilds a parameter-only system, then temporarily supplies its forecast indices to the registered factories with their caches cleared. This recalculates CPIH/RPI-dependent counterfactual cash amounts, including income-tax and Plan 2 thresholds; adding the macro dictionary to old cached measures leaves those amounts wrong. It retains each factory's functions/modifiers and restores the original module state afterward. Plain `stage` writes a hidden entry and permits an uncertified or dirty-source receipt. Provisional display (`stage --provisional`) and approval require the receipt to be publishable, including a clean source tree and a certified model/data pair. A subsample deliberately remains uncertified and must never become displayable. Leave these publication gates intact. The default artifact builder makes a private copy of a local dataset and hashes exactly those bytes, so allow disk space for that copy in addition to the 55 GB reserve. The preceding validation reads the source in place; this receipted production route deliberately uses the dashboard's exact-byte provenance mechanism.

   ```sh
   export DATASET="$NATIONAL_DATASET"
   PYTHONPATH="$REBASE_SCRATCH${PYTHONPATH:+:$PYTHONPATH}" uv run --no-sync python - <<'PY'
   import json
   import os
   import time
   from pathlib import Path
   from unittest.mock import patch

   from forecast_helpers import config, gate, load_forecast, process, registered_measures
   from uk_budget_data import pipeline
   from uk_budget_data.publication.generate import generate_artifacts

   cfg = config()
   forecast = load_forecast()
   reforms = registered_measures(forecast)
   assert len({m.id for m in reforms}) == len(reforms) == 10
   original_build = pipeline.build_microsimulation
   def guarded_build(dataset_path, scenario=None):
       gate("receipted managed_microsimulation")
       return original_build(dataset_path, scenario)

   started = time.perf_counter()
   with patch.object(pipeline, "build_microsimulation", guarded_build):
       report = generate_artifacts(
           reforms, cfg,
           artifacts_root=cfg.output_dir / "artifacts",
           repo_root=Path.cwd(),
           generator_argv=["forecast-rebase-runbook", os.environ["REBASE_JSON"]],
           process=process,
           on_progress=print,
       )
   paths = {reference.key: str(reference.path) for reference in report.written}
   out = Path(os.environ["REBASE_SCRATCH"])
   (out / "new-artifacts.json").write_text(json.dumps(paths, indent=2) + "\n")
   print(json.dumps({"wall_seconds": time.perf_counter() - started,
                     "written": paths, "refused": report.refused}, indent=2))
   if report.refused:
       raise SystemExit("Resolve generation refusals before staging")
   PY
   export FIRST_ARTIFACT="$(uv run --no-sync python - <<'PY'
   import json, os
   from pathlib import Path
   paths = json.loads((Path(os.environ['REBASE_SCRATCH']) / 'new-artifacts.json').read_text())
   print(paths['dividend_tax_increase_2pp'])
   PY
   )"
   uv run --no-sync uk-budget-data publish --data-root "$REBASE_SCRATCH/public-data" \
     --inputs "$REBASE_SCRATCH/data_inputs/treasury" reconcile "$FIRST_ARTIFACT"
   if test -f "$REBASE_SCRATCH/public-data/manifest.json"; then
     cp "$REBASE_SCRATCH/public-data/manifest.json" "$REBASE_SCRATCH/manifest.before-adopt.json"
     if uv run --no-sync uk-budget-data publish --data-root "$REBASE_SCRATCH/public-data" \
       --inputs "$REBASE_SCRATCH/data_inputs/treasury" stage "$FIRST_ARTIFACT" \
       > "$REBASE_SCRATCH/refused-without-adopt.log" 2>&1; then
       echo "Unexpected acceptance without adoption; stop and inspect the basis."
       exit 1
     fi
     rg --fixed-strings "stage with --adopt-basis" "$REBASE_SCRATCH/refused-without-adopt.log" || exit 1
     cmp "$REBASE_SCRATCH/manifest.before-adopt.json" "$REBASE_SCRATCH/public-data/manifest.json" || exit 1
   fi
   uv run --no-sync uk-budget-data publish --data-root "$REBASE_SCRATCH/public-data" \
     --inputs "$REBASE_SCRATCH/data_inputs/treasury" stage --adopt-basis "$FIRST_ARTIFACT"
   uv run --no-sync uk-budget-data publish --data-root "$REBASE_SCRATCH/public-data" \
     --inputs "$REBASE_SCRATCH/data_inputs/treasury" status
   ```

   On adoption, the newly staged measure replaces its old entry; **every other non-withdrawn entry becomes stale**, with reason `the forecast and calibration basis changed`, and its approval is cleared. The old artifact is retained in superseded history. The manifest adopts the changed basis only if all applicable staging gates pass. `--adopt-basis` does not certify a model/data pair or make the source clean: those gates still block provisional display and approval even when hidden staging succeeds. Artifact-integrity and responsiveness gates remain active. Changed engine/data identity separately needs `--adopt-execution` and the upgrade runbook. If there was no old manifest, this command creates one and there is no old entry to make stale; use the synthetic smoke test for that rehearsal.

   Stage all newly generated single measures on that same basis. Both `publish reconcile` and `publish stage` accept multiple artifact paths, so batch the remaining paths in one invocation of each to avoid a model import per measure. Regenerate any explicit `--combined` artifacts after members are available, reconcile and obtain the required approvals/review rows. Adopt only the first artifact. `publish check` verifies displayed entries, but stale entries are hidden, so independently require the expected ten IDs to have been regenerated and resolved before publishing. Staging only one measure on the new basis is an intentionally incomplete publication.

   The first 22 October scratch test staged two synthetic test-world entries successfully, then approval correctly refused `beta` because the installed UK 2.145.0 model differs from the 6.10.0 wrapper's certified UK 2.132.6 model. This is a production-publication blocker; hidden staging alone does not resolve it. The separate basis-adoption fixture uses dummy data and test-only certification context to isolate the manifest transition, and is not evidence that the national pair is certified.

   During this drill all `publish` commands target `REBASE_SCRATCH`; they never change the live `public/data` manifest or approve any entry for publication. On Budget day, after the scratch proof and normal review, apply the normal runbook's staging/approval process to the production artifact tree.

The 22 October scratch fixture proved the basis transition with the real CLI parser/handler: refusal without adoption took 0.00052 s and left the manifest byte-for-byte unchanged; adoption took 0.03565 s, staged the new entry and made the previously approved old entry stale with its approval cleared. The complete test process took 301.346 s, including 300.054 s of cold imports under the host conditions. These are synthetic aggregate artifacts and dummy data. Only the test world's certification fields were adjusted to isolate adoption semantics; the unmodified bundle independently refused provisional publication as uncertified. None of this certifies economic outputs or measures national regeneration time.

7. **Check coverage, timings and release readiness.** Record wall time for acquisition/import, dictionary construction/review, first subset simulation, one complete measure, national smoke run and staging. Estimate serial regeneration as `10 × one-measure time` only as a labelled extrapolation: the registry contains nine individual measures plus `autumn_budget_2026_combined`; different policies/calculators may cost more. The generator builds two microsimulations and ten vectorised household simulations per five-year measure. Explicit combined artifacts add work. The Budget-day critical path is **OBR acquisition → importer/value diff → manual omitted-series/statutory review → subset probes → one national probe → all measure generation → reconciliation → one basis adoption plus restaging → reviews/approvals**. Include resource waits and rework; do not put a fixed 30-minute promise on this path without measured national/all-measure evidence. Preinstall the environment and preflight downloads before publication time.

8. **Label retained inputs and model limits.** Use the inventory below as the review checklist. None of these labels bypasses an existing publication gate.

All raw paths below relative to `gov.economic_assumptions.yoy_growth`.

| Parameter(s) | Baseline use | Importer refresh? |
|---|---|---|
| `obr.average_earnings` | Employment, contributions, loans; AWE proxy | **Yes**,1.6 |
| `obr.consumer_price_index` | Reported benefits, consumption, poverty, benefit/tax indices | **Yes**,1.7 |
| `obr.rpi` | Private pension, student loans, fuel-duty assumptions | **Yes**,1.7 |
| `obr.cpih` | Housing/price assumptions | **Yes**,1.7 |
| `obr.mortgage_interest` | Mortgage/property finance costs | **Yes**,1.7 |
| `obr.rent` | Aggregate rent source; private-rent derived paths separate | **Yes**,1.7 |
| `obr.house_prices` | Residential wealth/purchase values and surcharge | **Yes**,1.16 |
| `obr.consumer_price_index_ahc` | AHC deflation | No |
| `obr.non_labour_income` | Non-labour/interest forecast proxy | No,1.12 |
| `obr.per_capita.gdp` | Investment/property income, wealth/capital, default CGT | No,nominal GDP minus population |
| `obr.per_capita.mixed_income` | Self-employment income/turnover/losses | No,1.12 minus population |
| `obr.per_capita.non_labour_income` | Derived non-labour per-person path | No |
| `obr.council_tax.{england,scotland,wales}` | Country council-tax bill projection | No,expenditure4.1 |
| `obr.social_rent` | Social rents | No,policy cap/September CPI |
| `obr.road_fuel_volume` | Net receipts/duty rate volume forecast | No |
| `obr.{petrol,diesel}_spending_litre_proxy` | Fuel spending preserving volumes | No |
| `ons.population` | Uniform household weight growth | No,March2025 long-term determinant vintage |
| `ons.household_interest_income` | Variable-level savings interest index; dataset mapping uses GDP/head | No,HAXV history+non-labour proxy |
| `ons.private_rental_prices.{UNITED_KINGDOM,ENGLAND,WALES,SCOTLAND,NORTHERN_IRELAND,NORTH_EAST,NORTH_WEST,YORKSHIRE,EAST_MIDLANDS,WEST_MIDLANDS,EAST_OF_ENGLAND,LONDON,SOUTH_EAST,SOUTH_WEST}` | Regional private rents | No,ONS history+derived aggregate-rent forecast |
| `ofwat.water_bills` | England/Wales water bills | No |
| `scottish_water.water_bills` | Scottish water bills | No,WICS caps+forecast CPI |
| `finance_ni.domestic_rates` | NI household regional+district rates | No,DoF/LPS and held assumption |
| `carbon_intensity` | Carbon consumption intensity | No,DESNZ |

Additional paths:

| Parameter(s) | Refresh scope |
|---|---|
| `gov.economic_assumptions.statutory_uprating_inputs.{cpi_september,awe_total_pay_may_july}` | Actual observations **manual**; forecasts automatically filled with annual series+gap |
| Same prefix `.forecast_gap.{cpi_september,awe_total_pay_may_july}` | **Importer yes** with receipts file/URL: exact September CPI receipt memo while available, Q3 fallback; Q2 earnings proxy |
| `gov.economic_assumptions.yoy_growth.{triple_lock,september_cpi_uprating}` | Automatic from statutory inputs and triple-lock policy flags |
| `...yoy_growth.obr.{private_pension_index,lagged_cpi,lagged_average_earnings}`, `...indices.*` | Automatic from raw series, not manual generated edits |
| `...yoy_growth.capital_gains`,`...indices.capital_gains` | Default GDP/head; versioned `CapitalGainsProjection` separate, generated paths read-only |
| `gov.benefit_uprating_cpi` | **Lagged calendar CPI in2.145.0**, not statutory September CPI |
| `...indices.{uc_standard_allowance,uc_health_element}` | Automatic benefit index+legislated UC rebalancing/freezes |
| Post-freeze HMRC IT/NIC threshold parameters | Automatic statutory September CPI from2031-32; freezes operative |
| `gov.hmrc.stamp_duty.statistics.{residential,non_residential}.corporate.revenue` | No; £.705bn+£2.425bn2020outturns held |
| `gov.hmrc.business_rates.statistics.revenue.{ENGLAND,SCOTLAND,WALES,NORTHERN_IRELAND}` | No; £27.222bn2021,£2.123bn2021,£1.053499bn2020,£1.334bn2018 |
| `gov.simulation.vat.{survey_consumption_coverage,household_share_of_receipts}` and deprecated `microdata_vat_coverage` | No; fixed receipts grossing factors |
| `gov.dft.rail.ridership_index`,bus fare/ridership paths, `gov.indices.private_rent_index`,local-authority ONS income calibration factors | No; independent projections/calibration |

Exact maintained dataset-read inventory: `policyengine_uk/data/economic_assumptions.py:uprating_input_paths()`, with mappings in `data/uprating_indices.yaml`; adds country-specific rents/council-tax/water, residential price indices, CGT metadata, class-level fallbacks. Some raw leaves are legacy/proxy paths rather than dynamic dependencies of every measure.


Also refresh or explicitly retain `gov.boe.base_rate` (locked November 2025 OBR market expectations), independent transport projections, local calibration factors and the VAT coverage/share assumptions. The importer itself updates seven economy series and two forecast gaps only. Audit `uprating_input_paths()` for the adopted release; its footprint can grow.

Use these public caveats where applicable:

- **Forecast-rebased simulation; pre-Budget calibration held fixed.** Microcosm receipts, benefit caseload, income, population targets, imputations and weights are fixed by the data build. Results are conditional reform differences, not a new calibration to EFO aggregate levels.
- **Partial forecast refresh.** Name each retained GDP/income, population, council-tax, rent, fuel-volume, bank-rate, water and other independent path with its source vintage.
- **Corporate SDLT/business rates use locked-model outturns.** UK 2.145.0 has 2018–2021 receipts statistics. The four nested growth paths described in [#2341](https://github.com/PolicyEngine/policyengine-uk/issues/2341) come from still-unmerged [#2322](https://github.com/PolicyEngine/policyengine-uk/pull/2322); they do not exist in this lock. Refresh/review them separately if a later adopted release adds them.
- **Benefit uprating uses lagged annual CPI in this lock.** Updating the statutory observation does not fix broad-benefit September-CPI uprating. The dashboard's `benefit_september_cpi` model limit keeps affected measures provisional; follow it.
- **Population composition retained.** Uniform weight growth does not age people or refresh local-area targets.
- **Independent consumption assumptions retained.** Energy is held at the data build's FY2026–27 prices; VAT grossing factors, water/transport assumptions and coverage do not follow the seven-series refresh.
- **Fuel-duty counterfactual held.** The standalone and combined factories hardcode their pre-Budget fuel rates. The helper stops all-measure generation if processed RPI changes; obtain a reviewed registry update before proceeding. The synthetic drill leaves RPI unchanged.
- **Rail costing fixed.** The rail modifier distributes fixed Treasury costs of £0.145bn, £0.155bn, £0.160bn, £0.165bn and £0.150bn in 2026–2030, including within the combined measure. This is a distribution of an external fixed costing, not a Treasury total regenerated from the new forecast; retain that label or hold these measures until reviewed updated costings exist.
- **Forecast horizon/tails.** March EFO ends 2030–31. Values dated 2031 onward are retained model assumptions until explicitly replaced by the new forecast.

The `registered_measures` helper in step 5 recomputes factory counterfactuals from the new CPIH/RPI paths before step 6 generates artifacts. The fuel-duty standalone and combined factories still hardcode their baseline rates (0.58, 0.61, 0.63, 0.64 and 0.66); refreshing their factories does not update those constants. Review that counterfactual separately when RPI changes and label any deliberately retained path. Review any additional factories or independent hardcoded projections added to the registry before Budget day. The specified synthetic shocks leave CPIH/RPI unchanged. Never claim a partial refresh or a failed March round trip is a complete new-forecast baseline.
