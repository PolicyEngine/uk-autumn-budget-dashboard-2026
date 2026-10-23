from __future__ import annotations
import hashlib, json, pathlib, re, shutil, subprocess, time
import run_importer as runner
ROOT=runner.ROOT
runner.ENV['NUMEXPR_MAX_THREADS']='4'
runner.ENV['ARROW_NUM_THREADS']='4'
runner.stages.update(json.loads(runner.RESULT.read_text()))
PYTHON=ROOT/'importer-runtime/.venv/bin/python'
SITE=ROOT/'importer-runtime/.venv/lib/python3.13/site-packages'
PACKAGE=SITE/'policyengine_uk'
SCRATCH=ROOT/'scratch/importer'
ECONOMY=pathlib.Path('/Users/maxghenis/reviews/uk-obr-receipts-importer-2341/sources/efo-march-2026-detailed-forecast-tables-economy.xlsx')
RECEIPTS=ECONOMY.parent/'obr_efo_march_2026_receipts.xlsx'
EXPECTED={'economy':'fde1de4bc5424dcf16c7b5c42eb75a35198e347f54db47690e95ede7541db510','receipts':'f65b6cb7f96931d4abd85940794eb60f6f65afca8bbf16c74a4548bf92766a28','importer':'fa79cb02513362ea9f8621112aedfb307cbb7dab868cc144f07076158c89cf94'}
def digest(path): return hashlib.sha256(path.read_bytes()).hexdigest()
# These are importer/readback dependencies that are not consistently declared
# by the UK/core runtime distributions. They stay in this separate venv.
runner.command('importer_extra_dependencies',['uv','pip','install','--python',str(PYTHON),'PyYAML','openpyxl','beautifulsoup4','lxml'])
version_code = 'import importlib.metadata as m, json, sys; print(json.dumps({"python": sys.version, "installed": {d.metadata["Name"]: d.version for d in m.distributions()}}, sort_keys=True))'
version_result = runner.command('versions',[str(PYTHON),'-B','-c',version_code])
runner.stages['versions']['environment'] = json.loads(version_result.stdout)
runner.RESULT.write_text(json.dumps(runner.stages,indent=2)+'\n')
runner.reservation()
started=time.perf_counter()
for name,path in [('economy',ECONOMY),('receipts',RECEIPTS),('importer',PACKAGE/'utils/import_obr_forecasts.py')]:
    if digest(path)!=EXPECTED[name]: raise RuntimeError(f'{name} hash mismatch')
SCRATCH.mkdir(parents=True,exist_ok=True)
for name in ['before','after']:
    target=SCRATCH/name/'gov/economic_assumptions'
    target.parent.mkdir(parents=True,exist_ok=True)
    if target.exists(): raise RuntimeError(f'Refuse to overwrite existing {target}')
    shutil.copytree(PACKAGE/'parameters/gov/economic_assumptions',target)
runner.stages['source_verification_and_parameter_copy']={'seconds':time.perf_counter()-started,'source_sha256':EXPECTED}
module_env=runner.ENV.copy()
module_env['PYTHONPROFILEIMPORTTIME']='1'
args=[str(PYTHON),'-B','-m','policyengine_uk.utils.import_obr_forecasts','--file',str(ECONOMY),'--receipts-file',str(RECEIPTS),'--yaml-path',str(SCRATCH/'after/gov/economic_assumptions/yoy_growth.yaml'),'--release-month','March','--release-year','2026','--forecast-start-year','2025','--forecast-years','6']
p=runner.command('module_cli',args,env=module_env)
# Python's importtime indentation denotes imports nested inside another import.
# Sum only root records, once each. Nested cumulative numbers overlap and are
# retained as diagnostic counters only. The residual includes CLI work and
# interpreter overhead, so never add it to the same command's external total.
roots=[]
for line in p.stderr.splitlines():
    match=re.match(r'import time:\s+(\d+)\s+\|\s+(\d+)\s+\| (.*)$',line)
    if not match: continue
    name=match[3]
    if not name.startswith(' '): roots.append({'module':name,'cumulative_microseconds':int(match[2])})
import_seconds=sum(item['cumulative_microseconds'] for item in roots)/1e6
external=runner.stages['module_cli']['external_seconds']
runner.stages['module_cli'].update({'import_seconds_nonoverlapping_roots':import_seconds,'cli_calculation_and_interpreter_residual_seconds':external-import_seconds,'importtime_root_modules':roots,'timing_method':'PYTHONPROFILEIMPORTTIME=1 on exact python -m CLI; only nonnested cumulative import rows summed. External residual includes parser/workbook/renderer/calculation and interpreter overhead; not an independent pure calculation measurement.','simulation_construction_seconds':0,'gate_wait_seconds':0,'importer_only_environment':'UK2.145.0 / Core3.33.3; not asserted certified and never used for simulation'})
runner.RESULT.write_text(json.dumps(runner.stages,indent=2)+'\n')
print(json.dumps(runner.stages['module_cli'],indent=2),flush=True)
# Machine value/statutory review uses the untouched certified2.132.6 runtime.
review=[str(ROOT/'runtime/.venv/bin/python'),'-B',str(ROOT/'review_inputs.py'),'--before-parameters',str(SCRATCH/'before'),'--after-parameters',str(SCRATCH/'after'),'--output-dir',str(ROOT/'scratch/reviewed-inputs')]
runner.command('reviewed_inputs',review)
