"""Primary certified-pin importer, exact module CLI, machine-only reviewed inputs."""
from __future__ import annotations
import base64,csv,hashlib,json,pathlib,re,shutil,time
import run_importer as runner
ROOT=runner.ROOT
runner.RESULT=ROOT/'importer-certified-timings.json'
runner.stages={}
PYTHON=ROOT/'runtime/.venv/bin/python'
SITE=ROOT/'runtime/.venv/lib/python3.13/site-packages'
PACKAGE=SITE/'policyengine_uk'
SCRATCH=ROOT/'scratch/importer-certified'
ECONOMY=pathlib.Path('/Users/maxghenis/reviews/uk-obr-receipts-importer-2341/sources/efo-march-2026-detailed-forecast-tables-economy.xlsx')
RECEIPTS=ECONOMY.parent/'obr_efo_march_2026_receipts.xlsx'
EXPECTED={'economy':'fde1de4bc5424dcf16c7b5c42eb75a35198e347f54db47690e95ede7541db510','receipts':'f65b6cb7f96931d4abd85940794eb60f6f65afca8bbf16c74a4548bf92766a28'}
def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest()
runner.reservation()
started=time.perf_counter()
for name,path in [('economy',ECONOMY),('receipts',RECEIPTS)]:
    if digest(path)!=EXPECTED[name]:raise RuntimeError(f'{name} hash mismatch')
importer=PACKAGE/'utils/import_obr_forecasts.py'
encoded=base64.urlsafe_b64encode(hashlib.sha256(importer.read_bytes()).digest()).rstrip(b'=').decode()
record=SITE/'policyengine_uk-2.132.6.dist-info/RECORD'
row=next(row for row in csv.reader(record.read_text().splitlines()) if row[0]=='policyengine_uk/utils/import_obr_forecasts.py')
if row[1]!='sha256='+encoded:raise RuntimeError('Certified importer source differs from installed distribution RECORD')
EXPECTED['importer']=digest(importer)
SCRATCH.mkdir(parents=True,exist_ok=True)
for name in ['before','after']:
    target=SCRATCH/name/'gov/economic_assumptions'
    target.parent.mkdir(parents=True,exist_ok=True)
    if target.exists():raise RuntimeError(f'Refuse to overwrite existing {target}')
    shutil.copytree(PACKAGE/'parameters/gov/economic_assumptions',target)
runner.stages['source_verification_and_parameter_copy']={'seconds':time.perf_counter()-started,'source_sha256':EXPECTED,'importer_present_on_certified_pin':True,'importer_record_hash_verified':True}
module_env=runner.ENV.copy()
module_env['PYTHONPROFILEIMPORTTIME']='1'
args=[str(PYTHON),'-B','-m','policyengine_uk.utils.import_obr_forecasts','--file',str(ECONOMY),'--receipts-file',str(RECEIPTS),'--yaml-path',str(SCRATCH/'after/gov/economic_assumptions/yoy_growth.yaml'),'--release-month','March','--release-year','2026','--forecast-start-year','2025','--forecast-years','6']
p=runner.command('certified_module_cli',args,env=module_env)
roots=[]
for line in p.stderr.splitlines():
    match=re.match(r'import time:\s+(\d+)\s+\|\s+(\d+)\s+\| (.*)$',line)
    if match and not match[3].startswith(' '):roots.append({'module':match[3],'cumulative_microseconds':int(match[2])})
import_seconds=sum(row['cumulative_microseconds'] for row in roots)/1e6
external=runner.stages['certified_module_cli']['external_seconds']
runner.stages['certified_module_cli'].update({'pins':{'policyengine':'6.10.0','policyengine-uk':'2.132.6','policyengine-core':'3.33.3'},'import_seconds_nonoverlapping_roots':import_seconds,'cli_calculation_and_interpreter_residual_seconds':external-import_seconds,'importtime_root_modules':roots,'timing_method':'Exact python-m CLI with PYTHONPROFILEIMPORTTIME=1; only nonnested cumulative import records summed. Residual includes parser/workbook/renderer/calculation and interpreter overhead; it is not a pure calculation clock. Subcounters partition external wall, never add them to it.','construction_seconds':0,'resource_gate_wait_seconds':0,'fallback_required':False})
runner.RESULT.write_text(json.dumps(runner.stages,indent=2)+'\n')
print(json.dumps({'primary_certified_importer':runner.stages['certified_module_cli']},indent=2),flush=True)
review=[str(PYTHON),'-B',str(ROOT/'review_inputs.py'),'--before-parameters',str(SCRATCH/'before'),'--after-parameters',str(SCRATCH/'after'),'--output-dir',str(ROOT/'scratch/reviewed-inputs-certified')]
runner.command('certified_reviewed_inputs',review)
