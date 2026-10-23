# Forecast rebase: Budget-day runbook

Use after the OBR publishes its October 2026 EFO, before releasing results. This is a forecast refresh on the existing Microcosm build: it does not recalibrate the data. Keep outputs in scratch until the normal reconciliation, approval and disclosure gates pass. Fiscal year `2026` means 2026–27; macro keys name calendar years.

The 22 October rehearsal used dashboard `8a6b8a6d`, policyengine 6.10.0, policyengine-uk 2.145.0 (`ecd531776`), Core 3.33.3 and the national Microcosm UK 2024–25 cut (SHA-256 `810ba980005a8b907cb51464279fa5e0125464b7af9a4871b7f6744c30951ece`). Dashboard's checked-in `uv.lock` actually installs UK 2.132.6. For this rehearsal only, after `uv sync --frozen`, install the official 2.145.0 wheel with `uv pip install --python .venv/bin/python --no-deps policyengine-uk==2.145.0`, and use `uv run --no-sync` thereafter. Set `REBASE_REHEARSAL=1` before step 1 to apply the overlay immediately after the frozen sync; otherwise the sync restores UK 2.132.6. Do not mistake that local overlay for adoption of a certified production bundle. On Budget day require the reviewed model/data pair and record the actual versions, lock hash and Git SHA before starting.

**Rehearsal status:** scripted OBR acquisition returned HTTP 403, but the follow-up rehearsal completed the March round trip from the original cached economy and receipts workbooks. The installed UK 2.145.0 CLI took 107.740 s including cold imports; the identical standalone importer took 5.704 s, and all 24 importer fixture tests passed. The import is not byte-idempotent: 22 small annual-rate precision changes and 10 compensating forecast-gap changes require review. The source workbook's 2030 mortgage-interest cell is blank, so that dated model assumption remains retained. See the acquisition notes below. Resource waits are additional, unbounded time; a successful local import does not establish a simulation completion deadline.

**23 October part 3 outcome:** the fully guarded subset and national one-year comparisons passed the synthetic stored-input checks. Both subset registered-measure full processors refused at FY2027 distribution, so neither produced a complete result or artifact. The nonoverlapping observed partial work took **39m31.377s**, or **41m19.117s** including the previously measured local import. The **13:40–14:10 slot does not hold as a deliverable full-rebase release window**; see the historical [part 3 timed evidence](#23-october-timed-simulations). The [part 4 national follow-up](#23-october-national-follow-up) found every national FY2027 decile denominator positive on both bases. National all-measure generation, staging and publication review still have no measured completion deadline.

**Working plan (pending Max's confirmation):** use 13:40–14:10 for the [reduced input/statutory route](#reduced-route-working-plan-pending-maxs-confirmation). The recipe below supplies preparation and the full workflow for the later window; the first cut retains March until complete rebased outputs pass.

**Part 4 setup blocker:** a restart at **07:22:35Z on 23 October** failed during the common `policyengine` import: `Data release manifest is not certified for the runtime model version 2.145.0 in country 'uk'.` Preserve the certification guard (`policyengine/provenance/manifest.py:610`). No complete national measure, constructor profile or end-to-end reduced route was obtained. The reduced route remains **unvalidated**; a reviewed setup that passes certification must precede reference precomputation and a fresh timed rehearsal.

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

   **Vahid's browser-download checklist (try with March tables in Friday's rehearsal):**

   - [ ] Create `$REBASE_SCRATCH/sources` with `mkdir -p "$REBASE_SCRATCH/sources"`. Use the normal browser to open the release's EFO page and select **Detailed forecast tables: economy** and **Detailed forecast tables: receipts**. Scripted downloads return HTTP 403 on this host; use the browser's download/Save As flow.
   - [ ] The direct URL patterns are `https://obr.uk/download/<month>-<year>-economic-and-fiscal-outlook-detailed-forecast-tables-economy/` and `https://obr.uk/download/<month>-<year>-economic-and-fiscal-outlook-detailed-forecast-tables-receipts/`, with the month in lower case. For Friday use `march-2026`; for Budget day use the actual published month/year, checking the EFO page before substituting it.
   - [ ] Save the original economy workbook as `$REBASE_SCRATCH/sources/efo-march-2026-detailed-forecast-tables-economy.xlsx` and the receipts workbook as `$REBASE_SCRATCH/sources/efo-march-2026-detailed-forecast-tables-receipts.xlsx`. Download the Excel workbooks, rather than the EFO PDF, chart CSV or an HTML access-denied page. If OBR serves an economy ZIP, retain that original ZIP and set `MARCH_ECONOMY` to its path; the importer accepts the archive too. Do not re-save Excel contents through a spreadsheet application.
   - [ ] Open the downloaded files to confirm their release and that economy tables 1.6, 1.7 and 1.16 and receipts table 3.19 (including its September-CPI memo) are present. Record the source URLs, download time (`date -u`) and `shasum -a 256` output beside the files. The known March checksums are economy `fde1de4bc5424dcf16c7b5c42eb75a35198e347f54db47690e95ede7541db510` and receipts `f65b6cb7f96931d4abd85940794eb60f6f65afca8bbf16c74a4548bf92766a28`; a changed checksum requires review, not an automatic rejection of a revised OBR workbook.
   - [ ] Run the local-path import command below, then inspect the value diff and both statutory gap files. No OBR network request is needed by this command. Keep the source files and checksum log for the Budget-day audit. For October, use the corresponding saved October filenames in `OCTOBER_ECONOMY` and `OCTOBER_RECEIPTS` and follow the horizon check below.

   The importer is `policyengine_uk/utils/import_obr_forecasts.py` (repository CLI `scripts/import_obr_forecasts.py`). Both entry points already support `--file` and `--receipts-file` in UK 2.145.0 and the checked 22 October upstream `main`; no importer patch or separate PR is needed. Copy the parameter tree into scratch so it can update growth and both gap files atomically:

   ```sh
   export PARAMETER_SOURCE="$(uv run --no-sync python - <<'PYCODE'
   import importlib.util
   from pathlib import Path
   print(Path(importlib.util.find_spec('policyengine_uk').origin).parent / 'parameters')
   PYCODE
   )"
   cp -R "$PARAMETER_SOURCE" "$REBASE_SCRATCH/parameters"
   export MARCH_ECONOMY="$REBASE_SCRATCH/sources/efo-march-2026-detailed-forecast-tables-economy.xlsx"
   export MARCH_RECEIPTS="$REBASE_SCRATCH/sources/efo-march-2026-detailed-forecast-tables-receipts.xlsx"
   test -s "$MARCH_ECONOMY"
   test -s "$MARCH_RECEIPTS"
   /usr/bin/time -p uv run --no-sync python -m policyengine_uk.utils.import_obr_forecasts \
     --file "$MARCH_ECONOMY" --receipts-file "$MARCH_RECEIPTS" \
     --yaml-path "$REBASE_SCRATCH/parameters/gov/economic_assumptions/yoy_growth.yaml" \
     --release-month March --release-year 2026 \
     --forecast-start-year 2025 --forecast-years 6
   rebase_diff_status=0
   diff -ru "$PARAMETER_SOURCE/gov/economic_assumptions" \
     "$REBASE_SCRATCH/parameters/gov/economic_assumptions" || rebase_diff_status=$?
   if [ "$rebase_diff_status" -gt 1 ]; then
     echo "Parameter diff failed; resolve it before continuing."
     exit "$rebase_diff_status"
   fi
   if [ "$rebase_diff_status" -eq 1 ]; then
     echo "Parameter differences found; review every numerical change before continuing."
   fi
   ```

   Review **values** separately from changed comments/reference metadata. Explain every numerical difference before continuing. `diff` exits 1 when it finds differences; the guarded command keeps that expected result from terminating the `set -e` shell, while still rejecting errors (status greater than 1). The 22 October local March round trip made 32 numerical edits: 22 annual rates (six AWE, four CPI, six RPI and six house-price observations), by at most 0.04 percentage points, and ten statutory forecast-gap changes. Every revised annual value rounds to the original model rate at three decimal places as a fraction. The gap changes offset annual-rate precision changes exactly, preserving the implied September CPI and May–July AWE paths. Those changes affect `yoy_growth.yaml` and both forecast-gap files only. Economy sheet `1.7`, cell `H120` (2030 mortgage-interest growth) is blank: the importer silently retains model value `.0553` for that year. Record it as a retained assumption; do not claim seven complete source-backed six-year replacements.

   Do not use `--output` for the full round trip: it suppresses gap-file writes. March ends in 2030, and the pinned importer replaces existing dated lines rather than adding them. Before importing October's 2026–2031 window, seed any missing 2031 line in the scratch YAML with a clearly labelled temporary copy of its last value. The command checks all seven importer targets, rejects missing earlier years and requires the workbook to supply every target year, so a placeholder or an inherited blank-cell value cannot silently remain as a forecast. It preserves the YAML's comments and indentation. If October has a blank/missing target, stop and obtain an explicitly reviewed retained assumption or replacement source; do not disable the preflight check.

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

   To repeat the synthetic drill, start from the **unchanged installed UK 2.145.0 parameter tree**, not the scratch tree modified by the March round trip. In the builder above set `base=Path(os.environ['PARAMETER_SOURCE'])/'gov/economic_assumptions'` (or use an untouched backup of that exact pin), add `obr.per_capita.gdp` to `paths`, and change only CPI 2026 `.023 → .028`, CPI 2027 `.020 → .025`, earnings 2027 `.024 → .019`, house prices 2027 `.029 → .049`, and nominal GDP/head 2027 `.0323 → .0293`. Other 2026–2031 entries stay fixed. Adopting the 22 round-trip precision changes would alter this isolated shock and invalidate the expected factors below. Keep the published statutory overrides above. The resulting unpublished September 2027 CPI is `.02572`, May–July 2027 AWE `.01927`, rounded to 2.6% and 1.9%; April 2028 triple lock becomes **2.6%**, versus 2.5%. Leave April 2027 triple lock at 3.9%; let parameter processing derive it.

   For the exact synthetic dictionary, explicitly `export SMOKE_SYNTHETIC_CHECKS=1` before the subset and national commands below. Its default is `0`; the real October dictionary needs its own reviewed benchmarks rather than these synthetic factors.

4. **Make the every-40th-household cut and smoke-test the data path first.** Retain whole households with their people/benefit units and original weights. Do not call this a calibrated national estimate. Read the national source in place; never overwrite it.

   **The subset is valid only for stored-input and statutory probes, never for income or distributional ones.** Business rates and corporate SDLT are fixed national receipts allocated by each household's share of the cut's own weighted corporate wealth: policyengine-uk's `shareholding` divides each household's `corporate_sector_wealth` by the dataset's weighted total, and `baseline_business_rates` multiplies that share by total national revenue (`corporate_sdlt` does the same). A 1-in-40 cut with original weights therefore still carries the full national corporate receipts, so its household net incomes, deciles, poverty and distributional outputs are wrong by construction. Part 4 found the subset's FY2027 decile 4 at −£719m against £145.9bn on the national cut. Use the national cut for any income, decile or distributional check.


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
   import importlib
   import json
   import os
   import subprocess
   import time
   from pathlib import Path
   from unittest.mock import patch

   command_started=time.perf_counter()
   import_started=time.perf_counter()
   import numpy as np
   import policyengine as pe
   simulation_module=importlib.import_module('policyengine_uk.simulation')
   original_framework_simulation=simulation_module.Simulation
   cold_import_seconds=time.perf_counter()-import_started
   print(json.dumps({'cold_import_seconds':cold_import_seconds}),flush=True)

   gate_wait_seconds=0.0

   def gate(label):
       global gate_wait_seconds
       waited=time.perf_counter()
       while True:
           uptime=subprocess.run(['uptime'],check=True,capture_output=True,text=True).stdout.strip()
           fs=os.statvfs(Path.cwd())
           free_gb=fs.f_bavail*fs.f_frsize/1e9
           load1=os.getloadavg()[0]
           print(f'{label}: {uptime}; available={free_gb:.3f} GB',flush=True)
           if load1<=110 and free_gb>=55:
               elapsed=time.perf_counter()-waited
               gate_wait_seconds+=elapsed
               return elapsed
           time.sleep(30)

   def guarded_framework_simulation(*args,**kwargs):
       gate('framework internal Simulation')
       return original_framework_simulation(*args,**kwargs)

   variables=['employment_income_before_lsr',
              'food_and_non_alcoholic_beverages_consumption','dividend_income',
              'universal_credit','child_benefit','state_pension','council_tax',
              'vat','main_residence_value','gov_balance']
   forecast=json.loads(Path(os.environ['REBASE_JSON']).read_text())
   arms=os.environ.get('SMOKE_ARMS','unshifted,rebased').split(',')
   assert arms and set(arms)<=set(['unshifted','rebased'])
   years=[int(year) for year in os.environ.get(
       'SMOKE_YEARS','2026,2027,2028,2029,2030').split(',')]
   assert years and years==sorted(set(years)) and set(years)<=set(range(2026,2031))
   synthetic_option=os.environ.get('SMOKE_SYNTHETIC_CHECKS','0')
   assert synthetic_option in ('0','1')
   synthetic_checks=synthetic_option=='1'
   if synthetic_checks and set(arms)!=set(['unshifted','rebased']):
       raise RuntimeError('Synthetic checks require both unshifted and rebased arms')
   results={}
   with patch.object(simulation_module,'Simulation',guarded_framework_simulation):
       for label in arms:
           gate_wait_before=gate_wait_seconds
           outer_wait_seconds=gate(label)
           started=time.perf_counter()
           kwargs={'reform':forecast} if label=='rebased' else {}
           sim=pe.uk.managed_microsimulation(
               dataset=os.environ['DATASET'],allow_unmanaged=True,**kwargs)
           construction_seconds=time.perf_counter()-started
           rows=[]
           for year in years:
               totals={}
               for variable in variables:
                   values=sim.calculate(variable,year)
                   totals[variable]={'weighted_gbp':float(values.sum()),
                                     'unweighted_gbp':float(np.asarray(values).sum(dtype=np.float64))}
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
           simulation_wall_seconds=time.perf_counter()-started
           arm_gate_wait_seconds=gate_wait_seconds-gate_wait_before
           results[label]={
               'gate_wait_seconds':arm_gate_wait_seconds,
               'outer_gate_wait_seconds':outer_wait_seconds,
               'construction_seconds_including_internal_gates':construction_seconds,
               'simulation_wall_seconds_including_internal_gates':simulation_wall_seconds,
               'simulation_seconds_excluding_gates':simulation_wall_seconds-(arm_gate_wait_seconds-outer_wait_seconds),
               'rows':rows,
           }
           del values,sim
           gc.collect()
   if set(results)==set(['unshifted','rebased']):
       results['percentage_changes']=[
           {'year':old['year'],'weighted_percent':{
               name:100*(new['totals'][name]['weighted_gbp']/old['totals'][name]['weighted_gbp']-1)
               if old['totals'][name]['weighted_gbp'] else None
               for name in variables}}
           for old,new in zip(results['unshifted']['rows'],results['rebased']['rows'])]
   failures=[]
   if synthetic_checks:
       checks=[]
       for old,new in zip(results['unshifted']['rows'],results['rebased']['rows']):
           year=old['year']
           expected={
               'employment_income_before_lsr':1 if year==2026 else 1.019/1.024,
               'food_and_non_alcoholic_beverages_consumption':(
                   1.028/1.023 if year==2026 else (1.028/1.023)*(1.025/1.020)),
               'main_residence_value':1 if year==2026 else 1.049/1.029,
               'dividend_income':1 if year==2026 else 1.0293/1.0323,
               'council_tax':1,
           }
           for variable,factor in expected.items():
               before=old['totals'][variable]['unweighted_gbp']
               after=new['totals'][variable]['unweighted_gbp']
               measured=after/before if before else None
               passed=measured is not None and bool(np.isclose(
                   measured,factor,rtol=1e-4,atol=1e-6))
               check={'year':year,'variable':variable,'measured_ratio':measured,
                      'expected_ratio':factor,'passed':passed}
               checks.append(check)
               if not passed: failures.append(check)
       results['synthetic_checks']={'rtol':1e-4,'atol':1e-6,'checks':checks}
   results['timings']={
       'cold_import_seconds':cold_import_seconds,
       'gate_wait_seconds':gate_wait_seconds,
       'script_wall_seconds_including_imports_and_gates':time.perf_counter()-command_started,
   }
   output=Path(os.environ['REBASE_SCRATCH'])/os.environ.get('SMOKE_OUTPUT','subset-smoke.json')
   output.write_text(json.dumps(results,indent=2)+'\n')
   print(json.dumps(results,indent=2))
   if failures:
       raise RuntimeError(
           'STOP: synthetic stored-input factors failed; inspect the saved aggregate '
           'ratios, fiscal-year conversion and cumulative-index rounding before '
           'running the measure or national phases. Do not widen the tolerance '
           'or replace a factor without explaining the difference.')
   PY
   SMOKE_SYNTHETIC_CHECKS="${SMOKE_SYNTHETIC_CHECKS:-0}" \
     /usr/bin/time -p uv run --no-sync python "$REBASE_SCRATCH/forecast_smoke.py"
   ```

   `SMOKE_YEARS` selects the years queried; it defaults to 2026–2030 for the subset. Record the command's external `real` total, cold imports, each gate wait and each arm's construction/calculation wall time. The arm wall counters exclude imports and the preceding outer gate, but include any internal baseline gates; `simulation_seconds_excluding_gates` subtracts those internal waits. The external total includes all of them. These counters overlap, so do not add the external total to its components. A one-year query still constructs the single-year dataset's model projection through its configured horizon (2032 in this overlay); it does not establish a one-year construction cost.

   Gating only the public managed call misses framework-created baselines. In UK 2.145.0 a scenario constructor calls the module-global `policyengine_uk.simulation.Simulation` internally, including a full dataset baseline in the rebased national arm. The temporary patch above gates those recursive constructions while preserving the original class; keep it active during both construction and calculation. The patch changes no installed source and restores the module on exit. The helper below applies the same guard to registered processing and production generation.

   Check the stored-input probes before interpreting tax/benefit outputs. Calendar-input benchmarks are employment `1.019/1.024 - 1 = −0.48828%`, CPI-linked food consumption `1.028/1.023 - 1 = +0.48876%` after 2026 and `(1.028/1.023)*(1.025/1.020) - 1 = +0.98135%` cumulatively after 2027, residential values `1.049/1.029 - 1 = +1.94363%`, and GDP/head-linked dividend income `1.0293/1.0323 - 1 = −0.29061%`. The synthetic checks compare **unweighted stored-input sums**, with employment, residential values and dividends unchanged in 2026. Their ratio tolerance is `rtol=1e-4, atol=1e-6`, approximately 0.0101 percentage points around a ratio of one. Residential cumulative HPI indices are rounded to five decimals, so their observed factor can vary slightly across later years; retain the calendar benchmark rather than substituting an observed rounded ratio. Compare weighted aggregates as well; fiscal-year blending and interactions may change fiscal output responses from those calendar factors. Council tax is the **unchanged negative control** because its country paths are independent. VAT rises with affected non-energy consumption while coverage factors stay fixed. Pension rate movement follows the triple lock; stored pension/additional-pension CPI projection may also affect its aggregate. A failed synthetic assertion, unexpected zero or one-year lag stops the run for investigation before the next phase. With synthetic checks disabled, review the real dictionary's expected input moves explicitly before continuing.

   Keep one simulation process at a time and all numerical thread pools at four. There is no timeout exception to load1 ≤110 and available disk ≥55 **decimal** GB. Log wait time separately; do not substitute a previous passing gate for the next check. Run each command in the foreground: do not append `&`, start a background retry or leave a scheduled simulation behind. If the gate remains closed, keep observing that foreground session or cancel it with Ctrl-C and record that no constructor ran. Before retrying, confirm the cancelled process has exited; the new invocation must check the gate again. Do not delete unrelated work or shared environments to open the disk gate.

5. **Use the national cut for the full registered-measure check on both bases.** After the subset direct-input/statutory checks, explicitly restore `DATASET="$NATIONAL_DATASET"` before constructing either full-processor arm. The every-40th subset retains original weights and is suitable for stored-input probes; its full distributional result is a diagnostic rather than a prerequisite for national generation. This command reads the national dataset in place, runs the dashboard's full `ReformProcessor`, and prints only aggregate budgetary rows and timings. It writes a reusable helper script into scratch so the same reviewed gate/merge functions can be used in the artifact step. The macro dict is part of both scenario identities; retain every registered policy change and modifier. `DataConfig.baseline_parameter_changes` alone does not rebase the reform arm and is overridden by a measure's own baseline.

   **Production preflight: check the policy's intended years before the full processor.** At the frozen `31b89c0d6` rehearsal head, the registered dividend measure describes a 2 percentage-point basic/higher rate increase from April 2026, but `_set_pre_budget_dividend_rates` in `src/uk_budget_data/reforms.py` only changes entries dated 2027 onward. UK 2.145.0's fiscal conversion materialises annual entries, including 2026, from each year's April 30 value. That modifier leaves the two 2026 rates equal. The helper below prints the effective rates and requires a 0.02 reform-minus-baseline difference in both brackets for every scored year (2026–2030 in this configuration). The frozen registry fails before the full processor; a reviewed registry correction must pass the same preflight before production generation of the dividend measure or any combined artifact containing it. Do not remove 2026 or bypass the preflight to conceal the gap. The timed rehearsal retains that unchanged registry for diagnosis and timing; it does not clear this production check. A zero-year costing can satisfy receipts-minus-spending reconciliation, so the budget identity alone cannot establish policy responsiveness.

   ```sh
   export DATASET="$NATIONAL_DATASET"
   cat > "$REBASE_SCRATCH/forecast_helpers.py" <<'PY'
   import copy
   import importlib
   import json
   import math
   import os
   import subprocess
   import time
   from contextlib import contextmanager
   from pathlib import Path
   from unittest.mock import patch

   import policyengine_uk
   from policyengine_uk.tax_benefit_system import CountryTaxBenefitSystem
   from policyengine_uk.utils.scenario import Scenario
   from uk_budget_data import pipeline
   from uk_budget_data import reforms as reform_registry
   from uk_budget_data.models import DataConfig
   from uk_budget_data.pipeline import ReformProcessor

   gate_wait_seconds = 0.0
   framework_simulation_module = importlib.import_module("policyengine_uk.simulation")
   original_framework_simulation = framework_simulation_module.Simulation

   def gate(label):
       global gate_wait_seconds
       started = time.perf_counter()
       while True:
           observed = subprocess.run(
               ["uptime"], check=True, capture_output=True, text=True
           ).stdout.strip()
           load1 = os.getloadavg()[0]
           fs = os.statvfs(Path.cwd())
           free_gb = fs.f_bavail * fs.f_frsize / 1e9  # Decimal GB.
           print(f"{label}: {observed}; available={free_gb:.3f} GB", flush=True)
           if load1 <= 110 and free_gb >= 55:
               elapsed = time.perf_counter() - started
               gate_wait_seconds += elapsed
               return elapsed
           time.sleep(30)

   @contextmanager
   def guard_framework_baselines():
       def guarded(*args, **kwargs):
           gate("framework internal Simulation")
           return original_framework_simulation(*args, **kwargs)
       with patch.object(framework_simulation_module, "Simulation", guarded):
           yield

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
       with guard_framework_baselines():
           return pipeline.build_microsimulation(dataset_path, scenario)

   def check_dividend_policy_responsiveness(baseline, reformed, years):
       path = "gov.hmrc.income_tax.rates.dividends"
       before = baseline.tax_benefit_system.parameters.get_child(path)
       after = reformed.tax_benefit_system.parameters.get_child(path)
       checks = []
       failures = []
       for year in years:
           for bracket, name in enumerate(("basic", "higher")):
               date = f"{year}-04-30"
               baseline_rate = float(before.brackets[bracket].rate(date))
               reform_rate = float(after.brackets[bracket].rate(date))
               difference = reform_rate - baseline_rate
               passed = math.isclose(difference, 0.02, rel_tol=0, abs_tol=1e-10)
               row = {"year": year, "bracket": name,
                      "baseline_rate": baseline_rate, "reform_rate": reform_rate,
                      "difference": difference, "expected_difference": 0.02,
                      "passed": passed}
               checks.append(row)
               if not passed:
                   failures.append(f"{year} {name}: {difference:.12g}")
       print(json.dumps({"dividend_policy_rate_preflight": checks}), flush=True)
       if failures:
           raise RuntimeError(
               "Registered dividend policy period coverage failed: "
               + "; ".join(failures)
               + ". A reviewed registry period fix is required before the full "
               "processor or production generation; do not accept an unresponsive "
               "score year or bypass this check."
           )

   def process(measure, cfg, baseline, reformed, baseline_scenario):
       if measure.id in ("dividend_tax_increase_2pp", "autumn_budget_2026_combined"):
           check_dividend_policy_responsiveness(baseline, reformed, cfg.years)
       processor = ReformProcessor(measure, cfg)
       calculate_budget = processor.budgetary_calc.calculate
       def budget_checkpoint(*args, **kwargs):
           rows = calculate_budget(*args, **kwargs)
           print(json.dumps({"checkpoint_only": True,
                             "full_processor_passed": False,
                             "budgetary_impact": rows}), flush=True)
           return rows
       processor.budgetary_calc.calculate = budget_checkpoint
       original = policyengine_uk.Simulation
       def guarded_situation(*args, **kwargs):
           gate("income-curve situation Simulation")
           return original(*args, **kwargs)
       # IncomeCurveCalculator imports this class inside calculate().
       with guard_framework_baselines(), \
            patch.object(policyengine_uk, "Simulation", guarded_situation):
           return processor.process(
               baseline, reformed, baseline_scenario
           )
   PY
   PYTHONPATH="$REBASE_SCRATCH${PYTHONPATH:+:$PYTHONPATH}" /usr/bin/time -p uv run --no-sync python - <<'PY'
   import json
   import time
   command_started = time.perf_counter()
   import_started = time.perf_counter()
   import numpy as np
   import forecast_helpers as helpers
   from forecast_helpers import (
       build_in_place, config, load_forecast, process, rebase_measure,
   )
   from uk_budget_data.reforms import get_reform
   cold_import_seconds = time.perf_counter() - import_started
   print(json.dumps({"cold_import_seconds": cold_import_seconds}), flush=True)

   cfg = config()
   original = get_reform("dividend_tax_increase_2pp")
   assert original is not None
   measures = [("unshifted", original),
               ("rebased", rebase_measure(original, load_forecast()))]
   for label, measure in measures:
       started = time.perf_counter()
       gate_wait_before = helpers.gate_wait_seconds
       baseline_scenario = measure.baseline_scenario_for(cfg)
       baseline = build_in_place(str(cfg.dataset_path), baseline_scenario)
       reformed = build_in_place(str(cfg.dataset_path), measure.to_scenario())
       result = process(measure, cfg, baseline, reformed, baseline_scenario)
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
       wall_seconds = time.perf_counter() - started
       gate_wait_seconds = helpers.gate_wait_seconds - gate_wait_before
       print(json.dumps({"basis": label,
                         "wall_seconds_including_gates": wall_seconds,
                         "gate_wait_seconds": gate_wait_seconds,
                         "simulation_and_validation_seconds_excluding_gates": wall_seconds - gate_wait_seconds,
                         "budgetary_impact": result.budgetary_impact}))
       del result, baseline, reformed
   print(json.dumps({
       "script_wall_seconds_including_imports_and_gates": time.perf_counter() - command_started,
       "cold_import_seconds": cold_import_seconds,
       "gate_wait_seconds": helpers.gate_wait_seconds,
   }))
   PY
   ```

   This runs the whole processor: costing, distribution, winners/losers, metrics, income curve and household scatter. The output above is aggregate only. The internal result also contains household rows; do not print or export them. The gate checks `uptime` and `os.statvfs` before every managed microsimulation, each income-curve household `Simulation` and every recursive framework baseline. Each 5-year measure makes two outer microsimulation calls and ten vectorised household situation calls, plus the internal baselines created by those scenarios; all run sequentially. Per-basis wall time includes every gate and validation; the printed gate total separates that waiting from computation. Cold imports are outside those per-basis counters but inside the script and external command totals. Use the external `real` total once in the critical path, with the counters explaining its components.

   **A national processor refusal stops production generation.** At the part 3 checkpoint, the strict unchanged-registry rehearsal refused the unshifted subset at FY2027 distribution: `ValueError: Decile 4 has non-positive weighted baseline income (-719095882.8319045) in 2027; a relative change is undefined.` Budgetary calculation and the FY2026 income curve completing beforehand did not constitute a full `ReformResult`, and no artifact was produced. The part 4 national FY2027 check found every decile total positive on both bases: decile 4 was £145.850302bn unshifted and £146.168631bn rebased, with the smallest national decile above £87bn. The historical subset refusal therefore does not block a properly guarded national attempt. Once the production rate preflight passes, the helper prints an aggregate budget checkpoint immediately after the unchanged budget calculator returns, preserving that diagnostic evidence if a later calculator refuses. The checkpoint is explicitly incomplete. Preserve the denominator guard: do not drop the decile, substitute a denominator or treat a partial result as a successful measure. The dividend period preflight above remains required on the reviewed registry head; retain it after any period correction.

   **Diagnostic continuation is an explicit scratch-only path.** After recording the refusal and confirming the failed process has exited, the following command can diagnose aggregate costings on both bases and then compare the national baseline/rebased inputs for 2027. It retains the dataset, registered modifiers, forecast merge and every constructor gate. It deliberately calls only `BudgetaryImpactCalculator`, rather than `process` or artifact generation, so it cannot satisfy the national full-processor check or clear a production refusal or responsiveness failure. It prints an aggregate checkpoint for each basis, independently reconciles receipts minus spending, and writes only the national smoke script's aggregate JSON in scratch. Its final nonzero exit preserves the failed-generation status; no receipt, artifact, staging or approval is created.

   ```sh
   DIAGNOSTIC_ONLY=1 PYTHONPATH="$REBASE_SCRATCH${PYTHONPATH:+:$PYTHONPATH}" \
     /usr/bin/time -p uv run --no-sync python - <<'PY'
   import gc
   import json
   import os
   import subprocess
   import sys
   import time
   if os.environ.get('DIAGNOSTIC_ONLY') != '1':
       raise SystemExit('This command is restricted to an explicit scratch diagnosis')
   started=time.perf_counter()
   import numpy as np
   import forecast_helpers as helpers
   from uk_budget_data.calculators import BudgetaryImpactCalculator
   from uk_budget_data.reforms import get_reform

   cfg=helpers.config()
   original=get_reform('dividend_tax_increase_2pp')
   assert original is not None
   measures=[('unshifted',original),
             ('rebased',helpers.rebase_measure(original,helpers.load_forecast()))]
   with helpers.guard_framework_baselines():
       for label,measure in measures:
           basis_started=time.perf_counter()
           wait_before=helpers.gate_wait_seconds
           baseline=helpers.build_in_place(
               str(cfg.dataset_path),measure.baseline_scenario_for(cfg))
           reformed=helpers.build_in_place(str(cfg.dataset_path),measure.to_scenario())
           rows=BudgetaryImpactCalculator(years=cfg.years).calculate(
               baseline,reformed,measure.id,measure.name)
           for year in cfg.years:
               for variable in ('employment_income_before_lsr',
                                'food_and_non_alcoholic_beverages_consumption',
                                'dividend_income'):
                   if not np.allclose(np.asarray(baseline.calculate(variable,year)),
                                      np.asarray(reformed.calculate(variable,year)),
                                      rtol=1e-6,atol=0.01):
                       raise RuntimeError(f'Forecast arms disagree: {variable}, {year}')
           for row in rows:
               year=row['year']
               tax_delta=(reformed.calculate('gov_tax',year)
                          -baseline.calculate('gov_tax',year)).sum()/1e9
               spending_delta=(reformed.calculate('gov_spending',year)
                               -baseline.calculate('gov_spending',year)).sum()/1e9
               if not np.isclose(row['value'],tax_delta-spending_delta,
                                 rtol=1e-4,atol=1e-5):
                   raise RuntimeError(f'Diagnostic budget identity failed: {year}')
           print(json.dumps({'basis':label,'diagnostic_only':True,
                             'full_processor_passed':False,'artifact_written':False,
                             'wall_seconds_including_gates':time.perf_counter()-basis_started,
                             'gate_wait_seconds':helpers.gate_wait_seconds-wait_before,
                             'budgetary_impact':rows}),flush=True)
           del rows,baseline,reformed
           gc.collect()
   national_env={**os.environ,'DATASET':os.environ['NATIONAL_DATASET'],
                 'SMOKE_ARMS':'unshifted,rebased','SMOKE_YEARS':'2027',
                 'SMOKE_OUTPUT':'diagnostic-national-smoke.json'}
   subprocess.run([sys.executable,
                   os.path.join(os.environ['REBASE_SCRATCH'],'forecast_smoke.py')],
                  env=national_env,check=True)
   print(json.dumps({'diagnostic_only':True,'full_processor_passed':False,
                     'artifact_written':False,
                     'diagnostic_command_seconds':time.perf_counter()-started}),flush=True)
   raise SystemExit('Diagnostics ended; full generation remains refused. No artifact was generated.')
   PY
   ```

   **Then run the national baseline and rebased simulations for one year**, after the subset direct-input/statutory probes and both national registered-measure bases have passed in the normal successful path. If full processing was refused, use only the explicitly labelled diagnostic continuation above; its national comparison does not clear the refusal. This invocation checks the gate before each constructor and records national aggregates separately. Use 2027 for this synthetic drill so every changed growth series is exercised; `SMOKE_YEARS` can select another reviewed year. Keep the shell's `DATASET` on the national cut restored at the start of step 5. The later full-workflow order is subset input comparison → full national registered measure on both bases → national comparison for one year.

   ```sh
   DATASET="$NATIONAL_DATASET" SMOKE_ARMS=unshifted,rebased SMOKE_YEARS=2027 \
     SMOKE_SYNTHETIC_CHECKS="${SMOKE_SYNTHETIC_CHECKS:-0}" \
     SMOKE_OUTPUT=national-smoke.json \
     /usr/bin/time -p uv run --no-sync python "$REBASE_SCRATCH/forecast_smoke.py"
   ```

   Keep `export DATASET="$NATIONAL_DATASET"` for production artifact generation in step 6; a subset cannot produce publishable national receipts.

6. **Generate new receipted artifacts and rehearse basis adoption in scratch.** Use the clean, committed forecast declaration. `registered_measures` rebuilds a parameter-only system, then temporarily supplies its forecast indices to the registered factories with their caches cleared. This recalculates CPIH/RPI-dependent counterfactual cash amounts, including income-tax and Plan 2 thresholds; adding the macro dictionary to old cached measures leaves those amounts wrong. It retains each factory's functions/modifiers and restores the original module state afterward. Plain `stage` writes a hidden entry and permits an uncertified or dirty-source receipt. Provisional display (`stage --provisional`) and approval require the receipt to be publishable, including a clean source tree and a certified model/data pair. A subsample deliberately remains uncertified and must never become displayable. Leave these publication gates intact. The default artifact builder makes a private copy of a local dataset and hashes exactly those bytes, so allow disk space for that copy in addition to the 55 GB reserve. The preceding validation reads the source in place; this receipted production route deliberately uses the dashboard's exact-byte provenance mechanism.

   This complete-registry recipe puts the standalone dividend first, so its effective-rate preflight and full processor must pass before any later artifact is generated. A scenario-binding refusal happens before `process`; the progress callback stops that refusal immediately instead of allowing the generator to continue. The helper also checks the registered `autumn_budget_2026_combined` measure. Explicit combined sets run after standalone measures, so this ordering protects them even when long combined keys are hashed. A custom generation call that omits the standalone dividend must separately complete its preflight before generating a combination containing it; do not infer that protection from a combined key's text.

   ```sh
   export DATASET="$NATIONAL_DATASET"
   PYTHONPATH="$REBASE_SCRATCH${PYTHONPATH:+:$PYTHONPATH}" uv run --no-sync python - <<'PY'
   import json
   import os
   import time
   from pathlib import Path
   from unittest.mock import patch

   from forecast_helpers import (
       config, gate, guard_framework_baselines, load_forecast, process, registered_measures,
   )
   from uk_budget_data import pipeline
   from uk_budget_data.publication.generate import generate_artifacts

   cfg = config()
   forecast = load_forecast()
   reforms = registered_measures(forecast)
   assert len({m.id for m in reforms}) == len(reforms) == 10
   dividend_id = "dividend_tax_increase_2pp"
   reforms.sort(key=lambda measure: measure.id != dividend_id)
   assert reforms[0].id == dividend_id
   def progress_or_stop(message):
       print(message, flush=True)
       if message.startswith(f"{dividend_id}: REFUSED:"):
           raise RuntimeError(
               "Dividend preflight could not run because its scenario was refused; "
               "stop before generating any other artifact."
           )
   original_build = pipeline.build_microsimulation
   def guarded_build(dataset_path, scenario=None):
       gate("receipted managed_microsimulation")
       return original_build(dataset_path, scenario)

   started = time.perf_counter()
   with guard_framework_baselines(), \
        patch.object(pipeline, "build_microsimulation", guarded_build):
       report = generate_artifacts(
           reforms, cfg,
           artifacts_root=cfg.output_dir / "artifacts",
           repo_root=Path.cwd(),
           generator_argv=["forecast-rebase-runbook", os.environ["REBASE_JSON"]],
           process=process,
           on_progress=progress_or_stop,
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

7. **Check coverage, timings and release readiness.** Record external command totals for acquisition/import, dictionary construction/review, subset input comparison, one complete national measure on both bases, national comparison for one year and staging. Record cold imports, constructors, calculations and gate waits separately, without adding overlapping counters. Estimate serial regeneration as `10 × one-measure time` only as a labelled extrapolation from a complete measure timed on the **same national dataset and model**: the registry contains nine individual measures plus `autumn_budget_2026_combined`; different policies/calculators may cost more. A subset measure time or a one-year national smoke comparison is insufficient to estimate the national all-measure route. The generator makes two outer microsimulation calls and ten vectorised household situation calls per five-year measure, plus recursive framework baselines; gate and time all of them. Explicit combined artifacts add work. The Budget-day critical path is **OBR acquisition → importer/value diff → manual omitted-series/statutory review → subset probes → one registered measure on both bases → national comparison for one year → all measure generation → reconciliation → one basis adoption plus restaging → reviews/approvals**. Include resource waits and rework; do not put a fixed 30-minute promise on this path without measured national/all-measure evidence. Preinstall the environment and preflight downloads before publication time.

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
| `obr.per_capita.gdp` | Investment/property income, wealth/capital, default CGT | No; derived nominal GDP/population convention needs review |
| `obr.per_capita.mixed_income` | Self-employment income/turnover/losses | No; derived 1.12 income/population convention needs review |
| `obr.per_capita.non_labour_income` | Derived non-labour per-person path | No |
| `obr.council_tax.{england,scotland,wales}` | Country council-tax bill projection | No; locked references cite expenditure 4.1, country rows unverified in the supplied workbooks |
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

## 22 October follow-up: March value reconciliation

The local round trip was compared with both official UK 2.145.0 and upstream `main` at `d62d5f3b6d66` (2.148.0); their importer source is identical, and both parameter trees produce the same numerical diff below. These fractions are parameter values, not simulation outcomes. Unchanged entries have no numerical diff. The source workbooks were read in place; no browser download was performed by this job. Vahid still owns the browser-download check in Friday's rehearsal.

| Series | 2025 | 2026 | 2027 | 2028 | 2029 | 2030 |
|---|---|---|---|---|---|---|
| `obr.average_earnings` | 0.0530 → 0.0531 | 0.0340 → 0.0336 | 0.0240 → 0.0236 | 0.0210 → 0.0209 | 0.0220 → 0.0221 | 0.0240 → 0.0241 |
| `obr.consumer_price_index` | 0.0340 → 0.0337 | unchanged | 0.0200 → 0.0197 | 0.0200 → 0.0198 | 0.0200 → 0.0202 | unchanged |
| `obr.rpi` | 0.0410 → 0.0413 | 0.0310 → 0.0308 | 0.0300 → 0.0298 | 0.0280 → 0.0278 | 0.0290 → 0.0288 | 0.0230 → 0.0226 |
| `obr.house_prices` | 0.0280 → 0.0279 | 0.0240 → 0.0238 | 0.0290 → 0.0294 | 0.0270 → 0.0272 | 0.0260 → 0.0257 | 0.0240 → 0.0242 |
| `forecast_gap.cpi_september` | 0.00411 → 0.00441 | unchanged | 0.00072 → 0.00102 | 0.00030 → 0.00050 | 0.00048 → 0.00028 | unchanged |
| `forecast_gap.awe_total_pay_may_july` | 0.00259 → 0.00249 | 0.00274 → 0.00314 | 0.00027 → 0.00067 | -0.00021 → -0.00011 | -0.00015 → -0.00025 | -0.00011 → -0.00021 |

The installed module route took **107.740 s** including cold package imports; the standalone utility route took **5.704 s**. Use the installed-module timing for the runbook command. The 24 upstream fixture tests passed in **4.56 s**, including both local file flags. Numerical assertions checked all 22 detailed-rate changes and all ten cancelling annual-plus-gap identities. The blank March `1.7!H120` remains an explicitly retained 2030 mortgage-interest assumption of `.0553`; the October preflight must reject an equivalent missing source year.

## 22 October follow-up: simulation gate and critical path

The follow-up used the unchanged installed UK 2.145.0 parameters and read Part 1's synthetic dictionary in place (SHA-256 `6ae39003ef6897fa3cc591eb19eeefd45947df77de26eadcd2d602d6550284c3`); the March round-trip scratch values were not adopted. The foreground simulation job checked resources 16 times from **19:20:03.221113 to 19:27:34.208467 UTC**. Load1 was **11.379–34.026**, within the limit, but available disk was **51.332399–52.228583 decimal GB**, below the required 55 GB at every check. An earlier preflight, before the new parameter copies, was also below the gate at **54.746 GB**. The foreground wait totalled **469.908 s** and was cancelled with Ctrl-C (exit 130) before package imports or any simulation constructor. No simulation was left running or scheduled. A separate closeout preflight at **19:29:31.550586 UTC** remained blocked: load1 **34.546387**, free disk **51.281256448 GB**.

| Critical-path stage | Measured result in this follow-up |
|---|---|
| Browser acquisition of original workbooks | Not timed; cached originals were read in place. Vahid rehearses the browser route on Friday. |
| Local March import and both statutory gap writes | **107.740 s** for the installed module route, including cold imports. Direct standalone utility: **5.704 s**, a different startup route. |
| Numerical reconciliation | 32 checked numerical edits in three files; human review not timed. |
| Omitted-series/statutory review | Decision table below; Max, Vahid and María must agree retained vintages and any hand updates. No measured review-time claim. |
| Foreground resource wait before first subset arm | **469.908 s**, cancelled; disk gate never passed. |
| Every-40th baseline and rebased simulations | **Not run**. No measured employment, CPI-input, residential, GDP/head, council-tax or fiscal aggregate moves. |
| `dividend_tax_increase_2pp` on both bases | **Not run**. No regenerated costing or complete-measure runtime. |
| One national rebased simulation | **Not run**. No national runtime or defensible all-measure estimate. |
| Basis adoption/restaging | Not repeated here. Part 1's synthetic fixture took **301.346 s** including **300.054 s** cold imports; adoption handler **0.035654 s**. This is not an economic-generation timing. |

The **13:40–14:10 slot remains unvalidated**. The measured import is one completed stage; resource waiting is unbounded and no economic-generation stage has a measured duration. Do not add the standalone import time to an imagined simulation throughput or treat the expected input factors as measured results. The operational sequence is acquisition → local import/value review → omitted-series/statutory decisions → subset comparison → registered measure on both bases → national probe → national all-measure generation → reconciliation/adoption/restaging → review and approval. Pre-download the March rehearsal sources, preinstall and prewarm the reviewed environment, and reserve disk/load capacity before promising a 30-minute completion time. The existing certified-pair and statutory-benefit-uprating limits still apply.

## 23 October timed simulations

This historical part 3 checkpoint reused the unchanged UK 2.145.0 installation, Part 1's exact synthetic dictionary and every-40th subset, and read the national Microcosm file in place. The later national denominator diagnosis is recorded in the [part 4 follow-up](#23-october-national-follow-up). It ran sequentially in the foreground with all six numerical thread caps set to four. Every outer and recursive simulation constructor checked load1 ≤110 and available disk ≥55 decimal GB using `os.statvfs`. Only the fully guarded timings below support this assessment; preliminary attempts that missed recursive constructor gates were stopped and excluded.

The subset's measured stored-input moves matched the synthetic factors: employment −0.488281% from 2027; CPI-linked consumption +0.488758% in 2026 and +0.981351% in 2027; GDP/head-linked dividends −0.290615% from 2027; council tax unchanged. Residential values rose about 1.944%, with the small year-to-year differences explained by the cumulative HPI index's five-decimal rounding. The unchanged 2026 employment, dividend and residential controls passed as well. These are subset checks with original weights, not calibrated national estimates.

| Strict phase | Measured seconds and outcome |
|---|---|
| First process cold imports | **21.331 s**. Outside its subset/measure counters. |
| Subset baseline, 2026–2030 | **97.853 s**: construction 59.511 s; calculations 38.342 s. |
| Subset rebased, 2026–2030 | **192.083 s**: construction 81.409 s; calculations 110.674 s. Synthetic factor checks passed. |
| Registered dividend unshifted full attempt | **573.343 s to refusal**, approximately, from its constructor gate to the final error journal write. Includes budget calculation 272.651 s and the FY2026 income curve 128.247 s; these are components, not extra phases. |
| Separate unshifted costing-only diagnostic | **504.135 s**: constructions 165.369 s; budget calculator 338.582 s, plus validation. Repeated work after the refusal; it is not an additional required step in the normal production path. |
| Diagnostic continuation cold imports | **61.809 s**. A separate process restart, not part of the first process's import counter. |
| Registered dividend rebased checkpoint and full attempt | **318.564 s total**: constructions 141.280 s; costing checkpoint 80.811 s; subsequent full attempt 96.336 s, plus validation. The full processor refused. |
| National baseline, FY2027–28 | **197.282 s**: construction 111.292 s; calculations 85.990 s. One-year smoke probes only. |
| National rebased, FY2027–28 | **970.921 s**: construction 567.362 s; calculations 403.559 s. Both national arms' synthetic factor checks passed. |
| Successful full registered measure; national five-year all-measure generation | **Not measured in part 3**. Both subset full processors refused, so this checkpoint supplied no complete measure or national all-measure throughput. The national follow-up is separate. |

Both full processors preserved the distributional guard and refused FY2027 decile 4 because its weighted baseline income was non-positive: −£719,095,882.8319045 unshifted and −£714,106,692.6294405 rebased. A relative distributional change is undefined on those denominators. The separate aggregate costings passed same-input and receipts-minus-spending checks on both bases, but returned no `ReformResult` or artifact. They also confirmed the registered measure's unresponsive FY2026 period, which the new production effective-rate preflight stops before the full processor. At this checkpoint, those diagnostics cleared neither the subset refusal nor the registry responsiveness failure. The later positive national denominators do not clear the separate responsiveness preflight.

The national FY2027–28 unweighted input checks also passed: employment −0.488281%, CPI-linked consumption +0.981351%, GDP/head-linked dividends −0.290614%, residential values +1.943853%, and council tax unchanged. The national comparison is an input smoke test, not a successful full registered-measure generation.

Use each whole phase once when assessing the critical path. The two strict subset arms total **289.936 s**. Calculator times sit inside the corresponding attempt totals; the repeated unshifted costing diagnosis and restarted imports describe recovery work, rather than mandatory extra steps in a clean run. Do not add those duplicate attempts or overlapping components to estimate normal throughput. The one-year national probe still prepares the model's dataset projection through its configured horizon and does not time a full five-year registered measure. A subset costing cannot be multiplied by 40 or by the ten registered measures to infer national throughput.

The **nonoverlapping observed partial-work subtotal is 2,371.377 s (39m31.377s)**: first cold imports 21.331 s, subset arms 97.853 + 192.083 s, first unshifted full refusal 573.343 s, rebased checkpoint/full attempt 318.564 s, and national arms 197.282 + 970.921 s. This excludes the repeated unshifted costing diagnosis (504.135 s), continuation restart imports (61.809 s), and minor overhead. Adding the earlier local import's 107.740 s gives **2,479.117 s (41m19.117s)**, before acquisition/human review, successful full artifacts, national all-measure generation, staging and approval. This is measured partial work under the observed conditions, not a throughput estimate for a corrected future implementation.

The later full release path is **OBR acquisition → importer/value review → omitted-series/statutory decisions → reviewed dictionary → subset direct-input/statutory probes → complete national registered-measure check on both bases → national comparison for one year → national five-year artifact generation for all measures → reconciliation → basis adoption/restaging → review and approval**. **The 13:40–14:10 full-rebase release slot does not hold:** even part 3's measured partial route exceeded 30 minutes, and both subset full processors refused. These historical observations do not establish a fixed runtime for national all-measure generation and the remaining publication workflow.

## 23 October national follow-up

Part 4 checked the actual dividend-measure baseline on the full national cut for FY2027–28 at dashboard `31b89c0d6`, with the same policyengine 6.10.0 / UK 2.145.0 / Core 3.33.3 pins and the same three hashed inputs. It used exactly the processor's ordinary `household_net_income`, baseline `household_income_decile` grouping and baseline `household_weight` (`src/uk_budget_data/calculators.py:169–192`), then the weighted sum and non-positive denominator guard (`:210–223`). All ten national decile totals were positive on both bases, and the smallest exceeded £87bn. Decile 4 was **£145.850302bn unshifted** and **£146.168631bn rebased**. The part 3 subset refusal is therefore not a national FY2027 denominator defect; the unchanged guard remains mandatory for every national full run. The subset refusal comes from how the cut allocates national corporate receipts (see step 4), so the subset is valid only for stored-input and statutory probes, never for income or distributional ones.

The corrected unshifted national processor completed all five budget years and the FY2026/FY2027 distributions, then was interrupted with the FY2027 income curve unfinished; its last journal entry was **07:04:30Z**. It produced no complete result or artifact, so no completed five-year throughput can be reported. On restart, the **07:22:35Z** certification failure above prevented the common engine import, before a new constructor or processor. The rebased full processor, both constructor profiles and unchanged-reference/reduced-probe stages were therefore not completed. The installed-distribution RECORD audit found all 159 audited files unchanged; this does not clear certification. Do not bypass the guard or infer a profile result from the earlier 5× observation.

The valid partial phase timings and setup evidence are preserved with the aggregate job report `.job/RESULTS-national4.md` in the assigned rehearsal evidence. The frozen-registry drill retains the known FY2026 £0 period defect. Neither partial processing nor a separately timed local input stage clears the production responsiveness preflight or establishes national all-measure throughput. Prepare the later full workflow on the reviewed registry head and a setup that passes certification, retaining the preflight after any period correction.

## Reduced route: working plan (pending Max's confirmation)

The coordinator's working plan reserves **13:40–14:10 for reviewed forecast inputs and guarded direct-input/statutory probes**. It remains **unvalidated end to end** because the part 4 restart failed the setup certification check before reference precomputation or the rebased probes. No completed baseline/probe timing supports a 30-minute completion claim. The numbered recipe above remains the preparation and later full-output workflow; complete fiscal smoke queries, registered processors and publication gates follow in the separate window below.

1. **Before Budget day, freeze the reviewed bundle and prepare the inputs route.** Record the dashboard SHA, lock hash, policyengine/UK/Core versions, national and every-40th dataset hashes, and probe definitions. Preinstall and prewarm that environment, verify the reviewed model/data setup passes its certification/import checks, and resolve any refusal before simulations. Rehearse the browser download and March local-workbook round trip; prepare the omitted-series, retained-assumption and statutory decision worksheets. Preserve calibration and the independently sourced assumptions identified in the decision table. A changed code/model/data pin invalidates the references.
2. **Before 13:40, precompute the unchanged March references on those frozen pins.** On the subset, save only weighted and unweighted sums for employment income before the labour-supply response, CPI-linked food consumption, dividends, residential values and the council-tax control, plus previous-September CPI, previous-May–July AWE, April triple lock and basic/new weekly pension parameters, for every year 2026–2030. Save the exact code/lock/model/data identities beside those aggregates. The unknown October dictionary does not define these unchanged references; check its reviewed hash separately when it becomes available. Reserve disk/load capacity in advance.
3. **From 13:40, obtain and review the forecast inputs.** Preserve the original economy and receipts workbooks, source URLs, timestamps and SHA-256 hashes. Run the strict horizon check, local import, numerical-value diff and omitted-series/statutory review in that order, then build and hash the reviewed dated dictionary from the untouched pinned basis. Review every retained value and both forecast-gap files; enter published statutory observations separately. Failed acquisition, missing years or an unresolved value review stops the route.
4. **After input sign-off, run one rebased subset direct-input/statutory probe against the frozen references.** Validate the unchanged reference identities before applying the candidate dictionary. Cap all six numerical thread pools at four, run one simulation at a time in the foreground, and freshly check load1 ≤110 and available disk ≥55 decimal GB with `os.statvfs` before every outer or recursive constructor. Query only the five stored-input/control variables and pension parameters listed above. Check the reviewed expected factors in both weighted and unweighted sums; keep the synthetic drill's existing `rtol=1e-4, atol=1e-6` tolerance and cumulative-index rounding explanation. For the actual October dictionary, replace synthetic expectations only through explicit input review. Record imports, gate waits, construction, each year's queries, comparisons and total external elapsed time without adding overlapping counters.
5. **By 14:10, preserve an aggregate input-readiness record and stop the reduced route.** A successful probe confirms the input path and statutory derivation; it supplies no full fiscal artifact. Retain the March publication basis while the later full-output work is pending.

The exact 23 October rehearsal uses the driver and aggregate report saved with `.job/RESULTS-national4.md`. These `.job` files belong to the preserved job evidence in the assigned rehearsal workspace; a standard PR checkout does not contain them. The commands below reproduce only that drill. Before Budget day, prepare and review equivalent scratch tooling for the adopted pins and actual October inputs/expectations, following the ordered working plan above:

```sh
# Blocked drill recipe: resume only after the reviewed setup passes certification.
# Before the timed window; use the reviewed rehearsal Python.
: "${REBASE_PYTHON:?Set the reviewed rehearsal Python executable}"
export PYTHONDONTWRITEBYTECODE=1
export OMP_NUM_THREADS=4 OPENBLAS_NUM_THREADS=4 MKL_NUM_THREADS=4
export VECLIB_MAXIMUM_THREADS=4 NUMEXPR_NUM_THREADS=4 NUMBA_NUM_THREADS=4
export PYTHONPATH="$PWD/.job:$PWD/.job/deps:$PWD/.job/pr94/src${PYTHONPATH:+:$PYTHONPATH}"
/usr/bin/time -p "$REBASE_PYTHON" -B -u .job/reduced_probes.py precompute
# Timed window: reference validation, local input rehearsal, rebased probes and comparison.
/usr/bin/time -p "$REBASE_PYTHON" -B -u .job/reduced_probes.py probe
```

The driver stores aggregate references/results only under `.job/scratch/reduced/`; its `probe` stage includes the reviewed local-input phase and verifies that the reconstructed synthetic dictionary has the supplied hash. Its frozen-reference comparison excludes the candidate forecast hash, while independently checking that exact synthetic hash for this drill. It refuses changed frozen identities, failed factors and resource gates, and starts no new heavy phase after the rehearsal's 10:00Z cutoff. These commands replay saved March source files and the supplied synthetic shock; browser acquisition and human review of new October inputs remain unmeasured.

| Reduced-route rehearsal phase | Part 4 result |
|---|---|
| Unchanged reference precompute, outside the window | Stopped at the setup certification guard before construction after **161.33 s external elapsed**; no completed baseline reference. |
| Reviewed inputs through rebased direct/statutory probes, comparisons and scratch output | Blocked before construction by setup certification; no end-to-end timing. The reduced route remains unvalidated. |
| Isolated cached March input import/review alone | **77.781 s** driver wall time (interpreter startup excluded); excludes the common engine import, reference precompute and simulations. |

The isolated input stage completed at **07:27:12Z**. Its reviewed-input function took **76.369 s**, including source-horizon/importer module loading **71.502 s**, same-process March import **2.452 s**, and the remaining pin/hash checks, scratch copy, numerical review and synthetic reconstruction **2.415 s**. It verified the 32 numerical edits (22 annual precision changes and ten compensating gaps), retained the reviewed March tail, and reconstructed the exact supplied forecast hash. This was not the combined guarded input/statutory route and supplies no baseline-reference or rebased-probe completion time.

**Later window: after 14:10, continuing after the proposed 15:45 first cut and overnight when needed.** Run the national fiscal-output comparisons and full five-year processors on both bases, followed by the national artifacts required for the release, income curves, household scatter and explicit combinations. Preserve all calculators and denominator, responsiveness, resource and publication guards. Then reconcile, update and review `data_inputs/publication_basis.json`, adopt the new basis once, restage all displayed entries and obtain the usual reviews/approvals. Batch later reconciliation/staging to reduce repeated imports. A full-processor refusal stops that arm; a costing checkpoint cannot replace a complete artifact. The old 14:50 combined-run target is conditional on this work finishing, rather than a promised rebased completion time.

**The first cut stays on March until the complete rebased outputs pass.** Move it to the October forecast only after every required national full output and combined artifact, reconciliation, basis adoption/restaging and approval gate passes in one manifest revision. If this is unfinished at the proposed 15:45 cut, retain March for that cut and continue the rebased workflow for the 07:00 briefing; the briefing also takes only fully approved entries. Resolve the registered period coverage and any national denominator refusal before relying on the affected measure. This working plan remains pending Max's confirmation.

## Omitted-series decision table

This is a decision aid for Max, Vahid and María, not evidence that these inputs were refreshed. `E` below is the original March 2026 **economy** workbook (SHA-256 starts `fde1de4bc5424dcf`); `R` is the original March **receipts** workbook (SHA-256 `f65b6cb7f96931d4abd85940794eb60f6f65afca8bbf16c74a4548bf92766a28`). Sheet names, Excel row numbers and columns were read from the originals. Annual rows are calendar years unless explicitly marked financial years. Find October rows by their year labels: row positions can move.

`Y` means the prefix `gov.economic_assumptions.yoy_growth.`. The exact one-line edits below use the runbook's forecast dictionary `result`; define these helpers in its dictionary-building Python session and save that dictionary using the runbook's existing JSON writer:

```python
def P(path, year, value):
    result.setdefault(path, {})[f"{year}-01-01.{year}-12-31"] = value
def G(path, year, value):
    P("gov.economic_assumptions.yoy_growth." + path, year, value)
```

Most numeric examples **reassert existing pinned defaults for 2027**; the social-rent and Bank Rate examples are proposed source updates, and the bus-cap example is explicitly a possible policy change; replace the number only with a reviewed value and repeat for every forecast year. They are executable editing examples, not October forecasts. Keep the entire existing horizon and convergence tails. Forecast changes must enter both simulation arms and custom counterfactuals as described above; the separately labelled bus policy belongs only in the reform arm. Do not edit generated cumulative indices. Feasibility estimates below are planning judgments for the 13:30–14:10 window, not measured timings.

| Priority / exact parameter paths | Verified EFO location or other source | Hand update in 13:30–14:10; one-line edit | Effect on likely measures | Recommendation and publication caveat if retained |
|---|---|---|---|---|
| **1. Nominal GDP per head**: `Yobr.per_capita.gdp` | Derived, not a direct workbook series. **E `1.2`, O114:O120**, nominal GDP at market prices, 2024–2030; denominator is the separately retained `Yons.population`. **E `1.5`, F116:F122 is real GDP/head**, not this nominal input. | Mechanically possible in 2–4 minutes with a worksheet approved before Friday; unsafe to improvise the conversion. Example: `G("obr.per_capita.gdp", 2027, .0323)`. Pinned convention is rounded summary nominal-GDP growth minus retained population growth: for 2027 `.036-.0037=.0323`. A proposed level-consistent alternative `(GDP_y/GDP_previous)/(1+population_growth_y)-1` changes that convention; do not switch during the live window. | Dividend, savings/property-income rates and CGT; investment/property inputs, wealth, capital means tests and non-residential property. CGT defaults to this series. High priority because it moves the tax base of the registered dividend measure. | **Keep the locked March series for first publication unless Friday verifies the new summary-growth transcription using the existing convention; then hand-update.** The pinned 2027 rate is .0323; exact level division with retained population gives .03182295, because it is a different construction. The model cites summary Table A.1; the detailed level rows above are a cross-check, not an exact replacement for its rounded summary input. Caveat: “Investment income, capital gains and related wealth inputs retain the locked March nominal GDP-per-head projection.” |
| **1b. Other per-capita income**: `Yobr.per_capita.mixed_income`, `Yobr.per_capita.non_labour_income`; also `Yobr.non_labour_income` | **E `1.12`, E93:E99** mixed income and **G93:G99** non-labour income, 2024–2030. Pinned YAML describes the per-capita variants as aggregate growth **minus** retained `Yons.population`; aggregate non-labour growth comes from `G_y/G_previous-1`. Do not assume exact level division reproduces the stored per-capita values: source rounding/population alignment must be checked. The workbook has no ready-made per-capita nominal versions. | Yes, about 2–4 minutes together after convention review. Examples: `G("obr.per_capita.mixed_income", 2027, .0371)`; `G("obr.per_capita.non_labour_income", 2027, .0474)`; `G("obr.non_labour_income", 2027, .0513)`. Reproduce March stored values first: mixed-income 2027 exact division gives .03702165 and subtraction .03715863, while the pin is .0371. Non-labour division gives .04739238 and subtraction .04756773, while the pin is .0474. These source/rounding conventions need review before a live update. | Mixed-income series projects self-employment, trading losses and owned-company income shares; non-labour series supplies income proxies. Relevant to threshold freezes, NICs and income-rate measures. Many stored dividend/property/interest inputs in this lock actually use GDP/head rather than the per-capita non-labour leaf. | **Keep March unless the same Friday conversion review passes; then update all three together.** Caveat: “Self-employment and non-labour-income growth retain their locked March projections.” |
| **2. Population**: `Yons.population` | **No direct all-age population row in the two supplied detailed workbooks.** E `1.15` F/O is potential **16+** population, not the required all-age series. E `1.5` notes at row 151 identify the all-age denominator as ONS EBAQ. The **stored path is OBR March 2025 long-term determinants**, with ONS 2022-based migration-category projections for the tail, not a March 2026 refresh. [OBR source](https://obr.uk/supplementary-forecast-information-on-long-term-economic-determinants-and-personal-independence-payment-policy-costing/), [ONS vintage](https://www.ons.gov.uk/peoplepopulationandcommunity/populationandmigration/populationprojections/bulletins/nationalpopulationprojections/2022based). | No defensible new vintage in this window without a pre-approved all-age table and period alignment. Example retaining it: `G("ons.population", 2027, .0037)`. If approved, update every year and every per-capita denominator consistently; changing this scalar cannot recreate age/local composition. | Uniform household-weight scaling changes national costings across every measure, including benefits and pension protection. It does not add ageing, migration composition or new calibration targets. | **Keep the locked population path**, explicitly calling it March **2025**, not March 2026. Caveat: “Population growth and population composition remain on the pre-Budget calibrated basis; this refresh does not reweight the population to the new OBR forecast.” |
| **3. AHC CPI**: `Yobr.consumer_price_index_ahc` | **Not a direct EFO series.** E `1.7` E114:E120 supplies headline CPI only. The model cites [ONS CPI excluding rents, maintenance, repairs and water](https://www.ons.gov.uk/economy/inflationandpriceindices/adhocs/2863consumerpriceindicesseriesexcludingrentsmaintenancerepairsandwaterchargesfortheperiodjanuary1996toapril2025), plus CPI weights and a derived forecast. E `1.19`/`1.19b` broad CPI groups cannot uniquely reconstruct that exclusion. | No: requires the agreed component/weight derivation, not copying headline CPI. Example retaining it: `G("obr.consumer_price_index_ahc", 2027, .019)`. | AHC real-income comparisons and poverty/deflation measures; does not itself set statutory benefit rates. Important when interpreting below-CPI benefit cuts, housing support and pensioner real-income impacts. | **Keep March.** Caveat: “After-housing-costs real-income results use the retained March AHC price index, while headline CPI has been refreshed.” |
| **4a. Social rents**: `Yobr.social_rent` | **Not the same series as EFO eligible rent.** **E `1.18`, rows 9 and 10, D:I** gives LA/RSL **HB-eligible** rent growth for FY2025–26 to FY2030–31; rows 12–14 explicitly include composition, UC migration and convergence. The model is stock-average rent, forecast using England's September CPI + 1 percentage-point cap, without a composition multiplier. [Rent policy, para. 2.16](https://www.gov.uk/government/publications/direction-on-the-rent-standard-2026/policy-statement-on-rents-for-social-housing). | Yes for the next observed-cap year after policy review, about 1 minute: `G("obr.social_rent", 2027, .045)` from September 2026 CPI .035 + .01. Do not add the synthetic annual-CPI shock to the observed September CPI. Future years need separately approved September forecasts. | Rent paid, UC/HB housing elements, AHC income and LHA comparisons; potentially offsets or compounds benefit changes. The single series remains an England cap proxy for the model's social-rent projection. | **Update 2027 by hand only as a linked decision with all 14 private-rent leaves, if the unchanged cap policy and England-proxy treatment are signed off; retain later years pending a reviewed September mapping.** If held: “Social rents retain the locked March policy-cap projection, rather than the new EFO's composition-sensitive eligible-rent forecast.” |
| **4b. Private rents**: `Yons.private_rental_prices.{UNITED_KINGDOM,ENGLAND,WALES,SCOTLAND,NORTHERN_IRELAND,NORTH_EAST,NORTH_WEST,YORKSHIRE,EAST_MIDLANDS,WEST_MIDLANDS,EAST_OF_ENGLAND,LONDON,SOUTH_EAST,SOUTH_WEST}` | **E `1.7`, J114:J120**, UK private-rental inflation, 2024–2030; T114:T120 is the associated index. Pinned forecasts instead back out private growth from aggregate **I** (rounded as in the model) and the social-rent cap: `(aggregate_growth - (.164/.352)*social_growth)/(.188/.352)`. Regional/nation outturns come from [ONS PIPR](https://www.ons.gov.uk/economy/inflationandpriceindices/datasets/priceindexofprivaterentsukmonthlypricestatistics); **EFO has no region-specific forecast**. Model currently uses one common forecast across these leaves. | Yes in 2–3 minutes using the reviewed aggregate/social-cap conversion across all leaves; e.g. `G("ons.private_rental_prices.UNITED_KINGDOM", 2027, .027757447)` reasserts the existing rate. For a new value repeat across all 14 leaves, preserving historical regional outturns. March reproduces `(.0302*.352-.164*.033)/.188`=.027757447. The direct EFO private component `J117/100`=.024154435 is a different forecast convention; do not substitute it silently. Changing the 2027 social cap to .045 requires simultaneous recomputation from the new aggregate rent forecast; holding March aggregate .0302 gives private growth .0172893617. Updating social alone breaks the model's tested weighted identity. | Private rents, housing benefits and AHC income; LHA increases interact with projected rents and local limits. A UK forecast cannot supply new geographic divergence. | **Hand-update all 14 with the approved existing aggregate/social-cap mapping; retain March if that mapping and the social cap are not approved together.** Caveat: “Private-rent growth retains the locked March projections and existing regional differentials.” |
| **5. Council tax**: `Yobr.council_tax.{england,scotland,wales}` | Model cites **March EFO expenditure workbook `4.1`**. That third workbook was not supplied or found in the specified caches; **country rows are unverified**. The supplied **R `3.8`, row 54, D:J** is UK cash council-tax receipts; **R `3.22`, row 16, C:H** is a different fiscally neutral council-tax aggregate. Neither is a country household-bill series. Obtain optional expenditure workbook via `...-detailed-forecast-tables-expenditure/`. | No, until country rows and receipts-vs-bill assumptions are verified. Retain with `G("obr.council_tax.england", 2027, .0605)`; Scotland .0384, Wales .0743. Do not apply UK total receipt growth to three country bill paths. | Council tax/CTR and disposable income, especially low-income households; relevant to possible local tax changes. HVCTS is a separate lever and house-value rebase does not refresh council-tax bills. | **Keep March.** Caveat: “Council-tax projections for England, Scotland and Wales remain on the locked March country assumptions.” |
| **6. Road fuel**: `Yobr.road_fuel_volume`, `Yobr.petrol_spending_litre_proxy`, `Yobr.diesel_spending_litre_proxy`; associated `household.consumption.fuel.prices.{petrol,diesel}` | R **`3.8`, row 21, D:J** is **fuel-duty receipts**, not road-fuel litres. Clearances come from [HMRC Hydrocarbon Oils Bulletin](https://www.gov.uk/government/statistics/hydrocarbon-oils-bulletin), pump prices from [DESNZ](https://www.gov.uk/government/statistical-data-sets/oil-and-petroleum-products-monthly-statistics); model also cites OBR's vehicle-type supplementary release. Spending proxies are derived: `(1+volume_growth)*(price_y/price_previous)/(1+population_growth)-1`. | No safe receipt-to-volume inference in the window: duty rates, timing, business fuel and fuel mix matter. Retain `G("obr.road_fuel_volume", 2027, -.02416859220902523)` and both spending proxies at -.027765858532455168. Any approved change to population/prices must rederive both proxies, not just litres. | Fuel freeze/delay is the highest-priority likely measure. Volume changes scale household duty exposure; new receipts forecasts already include policy, so blindly calibrating to them can contaminate the counterfactual. | **Keep March physical-volume/price basis; change the announced duty policy separately.** Caveat: “Fuel-duty impacts retain the pre-Budget road-fuel volume and pump-price basis, including the model's treatment of business fuel.” |
| **7a. Water, England/Wales**: `Yofwat.water_bills` | **Not an EFO bill series.** [Ofwat 2026 bill announcement](https://www.ofwat.gov.uk/ofwat-responds-to-water-sector-average-bill-figures/) and PR24 company determinations; EFO headline CPI is not a bill forecast. | No new OBR value to transcribe; annual regulator/company vintage should be reviewed outside the slot. `G("ofwat.water_bills", 2027, .046)`. | Water costs and AHC resources; may affect VAT/base-change comparisons indirectly through consumption allocation. No direct lever among the most likely measures. | **Keep existing regulator basis, not “March OBR”.** Caveat: “Water bills retain the existing Ofwat/PR24 assumptions.” |
| **7b. Scottish water**: `Yscottish_water.water_bills` | **Not in EFO.** Scottish Water 2026 charges and [WICS 2027–33 draft determination](https://wics.scot/system/files/2026-06/Draft-Determination-2027-33.pdf), para. 9.1.3/Table 68, underpin the path; draft assumes CPI + 2%. | No; do not substitute headline OBR CPI for a regulator decision. `G("scottish_water.water_bills", 2027, .039)`. A final regulator decision is a separate source update. | Scottish AHC income and water-charge comparisons; relevant when presenting devolved distributional effects. | **Keep regulator vintage.** Caveat: “Scottish water charges retain the existing regulator-based assumptions, including draft assumptions for later years.” |
| **7c. NI domestic rates**: `Yfinance_ni.domestic_rates` | **Not an EFO household-rate series.** [NI Finance rate poundages](https://www.finance-ni.gov.uk/articles/rate-poundages), domestic regional/district rates, and the NI draft budget; weighted average domestic bill growth. R `3.2`, row 6, C:I gives **NI domestic-rate receipts**, but the pinned methodology warns these receipts do not represent the full regional-plus-district household bill or poundage growth; row 7 is NI business rates. Neither can simply replace this bill-growth input. | No all-NI household bill update from the EFO. `G("finance_ni.domestic_rates", 2027, .0433)`. A new regional rate alone is insufficient without district weights. | NI household local tax and disposable income; independent of GB council tax and property-value shocks. | **Keep NI basis.** Caveat: “Northern Ireland domestic rates retain the existing regional-and-district rate assumptions.” |
| **8. Carbon intensity**: `Ycarbon_intensity` | **Not in EFO.** [DESNZ Energy and emissions projections 2023–2050](https://www.gov.uk/government/publications/energy-and-emissions-projections-2023-to-2050); stored annual intensity decline is 4.9%. EFO electricity/oil prices are different quantities. | No forecast transposition possible. `G("carbon_intensity", 2027, -.049)`. | Carbon/emissions outputs, if published; no direct effect on tax/benefit cash costings from changing this parameter alone. Do not describe energy-price measures as updated emissions forecasts. | **Keep existing DESNZ basis.** Caveat: “Carbon estimates retain the existing DESNZ intensity projection.” |
| **9a. Corporate SDLT**: `gov.hmrc.stamp_duty.statistics.{residential,non_residential}.corporate.revenue` | **Corporate split not in the supplied EFO tables.** R **`3.8`, row 24, D:J** is total SDLT only. The locked corporate split comes from [HMRC UK Stamp Tax Statistics, tables 6a/6b](https://www.gov.uk/government/statistics/uk-stamp-tax-statistics), retaining 2020 £.705bn residential and £2.425bn non-residential. | Not a defensible hand update from total EFO receipts. Example retention: `P("gov.hmrc.stamp_duty.statistics.residential.corporate.revenue", 2027, 705000000)`; non-residential 2425000000. Do not overwrite corporate split with all SDLT or add absent proposed receipt-growth paths to 2.145.0. | Corporate-property incidence; household SDLT/LBTT/LTT changes need separate formula validation. Does not make corporation tax/bank surcharge/EPL modelled. | **Keep locked outturns; use official ledger costings for unmodelled corporate measures.** Caveat: “Corporate SDLT incidence retains the locked-model HMRC outturn statistics; it is not calibrated to the new OBR receipt forecast.” |
| **9b. Business rates**: `gov.hmrc.business_rates.statistics.revenue.{ENGLAND,SCOTLAND,WALES,NORTHERN_IRELAND}` | R **`3.8`, row 53, D:J** gives UK cash business rates; R **`3.2`, row 7, C:I** gives NI business rates. **No four-nation outturn split** suitable for these locked statistic leaves. Current sources are England NNDR, Scottish non-domestic rates income, StatsWales and NI review statistics. | No; growth/level, national splits and relief mechanisms must be reviewed. Retain e.g. `P("gov.hmrc.business_rates.statistics.revenue.ENGLAND", 2027, 27222000000)`; Scotland 2123000000, Wales 1053499000, NI 1334000000. Their outturn years differ (2021/2021/2020/2018). | High-probability business-rates relief remains ledger unless a reviewed incidence route is selected; no SBRR/sector mechanism in this lock. UK total receipt growth cannot supply those reforms. | **Keep locked statistics and use ledger for new relief.** Caveat: “Business-rates incidence uses the locked national outturn statistics and does not model the announced relief mechanism.” |
| **10. BoE base rate**: `gov.boe.base_rate` | **E `1.9`, C113:C119**, annual-average Bank Rate **in percentage points**, 2024–2030; C3 is the header. Current model forecast is still November 2025, so “keep March” would be inaccurate. | **Yes**, about 1 minute: divide new annual cell values by 100. March check: `P("gov.boe.base_rate", 2027, .03407796552346473)` from C116. Review annual-average vs the old end-year-style approximations and retain actual observed dates separately. | Student-loan Plans 1/4 interest, capped at min(RPI, Bank Rate+1pp); usually little effect on earnings-based annual repayments, but affects interest/balances. Does not update household savings-interest receipts directly. | **Update by hand** from the new EFO annual rows, explicitly approving the annual-average convention. If held: “Student-loan interest calculations retain the model's November 2025 Bank Rate forecast.” |
| **11. VAT coverage factors**: `gov.simulation.vat.survey_consumption_coverage`, `gov.simulation.vat.household_share_of_receipts`; legacy `gov.simulation.microdata_vat_coverage` | R **`3.8`, row 13, D:J** supplies total VAT receipts, not either factor. Survey coverage .67 is a **Microcosm 2 October release-specific calibration** using £170.994bn 2024–25 receipts; its metadata does not validate the 19 October cut used here. Household share .7 comes from HMRC VAT-gap/TTLs methodology. The deprecated combined factor `gov.simulation.microdata_vat_coverage` remains .469 (= .67 × .7); changing it can override the two separate factors, so retain it. | No; changing macro receipts is not a recalibration. Reassert `P("gov.simulation.vat.survey_consumption_coverage", 2027, .67)` and `P("gov.simulation.vat.household_share_of_receipts", 2027, .7)`. A new dataset needs its own coverage validation before Budget day. | Any VAT rate/base change, particularly electricity/gas zero-rating; scales fiscal totals and matters to distributional incidence. Energy price-year limitations remain separate. | **Keep locked factors; validate coverage against the adopted certified dataset separately before publication.** Caveat: “VAT results retain the pre-Budget Microcosm coverage and household-share factors; the new forecast does not recalibrate consumption coverage.” |
| **12a. Rail**: `gov.dft.rail.{ridership_index,fare_index,prior_law_fare_index}` | **Not EFO rail series.** Ridership: [ORR Passenger Rail Usage](https://dataportal.orr.gov.uk/statistics/usage/passenger-rail-usage/) and assumed growth. Fare/current-law and counterfactual paths are transport policy plus RPI assumptions (E `1.7` C114:C120 can inform the inflation component only). Registered rail freeze also hardcodes external Treasury cost totals, outside these paths. | No ridership/cost-total update in the window. `P("gov.dft.rail.ridership_index", 2027, 1.005)`; keep existing fare-index levels unless policy is expressly reviewed. If RPI changes, regenerate/review both fare counterfactuals and the registered fixed cost; do not silently assume its factory refresh covers these transport paths. | Registered rail freeze; household allocation may change with inflation, but the fixed £.145/.155/.160/.165/.150bn fiscal totals do not become new costings. | **Keep ridership; publish rail as a fixed-cost distribution only, or hold for new reviewed Treasury costings.** Caveat: “Rail results allocate the retained Treasury cost assumption using existing ridership; they are not a new OBR-based fiscal estimate.” |
| **12b. Bus**: `gov.dft.bus.{ridership_index,local_bus_fares_index.*,fares.cap,reference_fares.cap,fare_index,prior_law_fare_index,yield_per_boarding.*,boardings_per_trip.*,benchmark_year,default_single_fare_share,uncapped_single_fares.{fare,share}.*,fare_allocation_weight_by_age}` | **Not EFO bus series.** [DfT BUS01/BUS05i/BUS0415a and NTS](https://www.gov.uk/government/statistical-data-sets/bus-statistics-data-tables), Scottish/NI statistics and fare-cap evaluations. Model's published fares index is June 2026 vintage; later extension automatically uprates with CPI. Ridership neutral factor is 1. | Forecast rebase: retain benchmark/observed indices and neutral ridership, e.g. `P("gov.dft.bus.ridership_index", 2027, 1)`. An announced extension is a **policy edit**, feasible in 1 minute: `bus_policy_changes = {"gov.dft.bus.fares.cap": {"2028-01-01.2028-12-31": 2}}` for a £2 cap in 2028; apply this separate dictionary only to the measure's reform arm, leaving its policy baseline unchanged. Do not alter reference_fares.cap or rewrite the fitted fare distribution to simulate the policy. | Likely £2 cap extension beyond 2027. New headline CPI already moves future uncapped fares; new ridership requires a separate behavioural scenario. | **Keep transport quantities/calibration; enter only the announced cap policy.** Caveat: “Bus results retain the existing journeys and fare-distribution benchmark; future uncapped fares reflect the refreshed CPI.” |
| **13. Household interest proxy**: `Yons.household_interest_income` | Direct historical source: [ONS HAXV, D.41g](https://www.ons.gov.uk/economy/grossdomesticproductgdp/timeseries/haxv/ukea). No dedicated EFO household-interest forecast in supplied sheets; **E `1.12`, G93:G99** non-labour growth is explicitly a **proxy** for 2025 onward, not a rate forecast. | Yes as a matched proxy update only after the income-series review, roughly 1 minute. `G("ons.household_interest_income", 2027, .0513)`. Do not substitute E `1.9` deposit rates for income growth. | Savings-income rate rises and personal savings allowance; variable-specific uprating can use this path even when stored-data uprating maps savings interest to GDP/head. Verify the actual data route. | **Keep with income-series package unless that package is approved.** Caveat: “Interest-income projection retains the locked non-labour-income proxy; it is not a new forecast of household deposit returns.” |
| **14. Private rent index / local calibration**: `gov.indices.private_rent_index`; `gov.economic_assumptions.local_authority_targets.ons_income.{net_income_bhc_uprating_factor,housing_costs_uprating_factor}` | Private index: **ONS monthly PIPR**, not EFO; current observations to July 2026, CPI-uprated tail. Local factors: November 2025 real household income/house-price indices used to bring **2020 local targets to calibration year 2025**, not new forecast levels. | No: keep observations and calibration vintages. Retain the monthly YAML line `2026-07-01: 124.3`; preserve all actual monthly dates instead of replacing them with an annual overlay. Local factors retain 2025 values 1.3526165167620605 and 1.2190812720848057. A new target requires a data rebuild/recalibration, not an overlay. | Housing/local and constituency comparisons, local income targets and calibration. Forecast-only rebase cannot validate new dense regional output on 2.145.0. | **Keep existing data-build basis.** Caveat: “Local income calibration and observed rent-index vintages remain fixed; forecast rebasing does not rebuild local calibration.” |

Bus `index.yaml` files also carry node metadata (calendar-date handling, fiscal-year blending and uprating); retain that metadata with the transport benchmark. They are not additional scalar forecast series.

The generated `triple_lock`, `september_cpi_uprating`, `obr.lagged_cpi`, `obr.lagged_average_earnings`, `obr.private_pension_index`, `capital_gains` and `indices.*` are deliberately excluded from hand edits. Update their raw observations/forecast gaps and regenerate. State-pension triple-lock policy leaves, UC uprating rules and frozen tax thresholds are policy decisions, not missing EFO series. Broad-benefit September-CPI limitations in 2.145.0 remain separately disclosed.

Three publication distinctions matter: retained population is **March 2025**; retained Bank Rate is **November 2025**; water, NI rates, transport and data calibration have their **own** source vintages. A generic “all omitted series remain March 2026” label would be wrong. Missing country council-tax rows and the per-capita conversion convention remain review items; the private-rent aggregate/social-cap derivation is identified above and must be applied consistently.
