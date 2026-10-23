from pathlib import Path
import json,tomllib
import run_importer as runner
ROOT=runner.ROOT
runner.stages.update(json.loads(runner.RESULT.read_text()))
if 'module_cli' in runner.stages:
    runner.stages['module_cli_failed_latest_pandas31']=runner.stages.pop('module_cli')
    for channel in ['stdout','stderr']:
        p=ROOT/f'importer-module_cli.{channel}.log'
        if p.exists(): p.rename(ROOT/f'importer-module_cli-failed-latest-pandas31.{channel}.log')
lock=tomllib.loads((ROOT/'runtime/uv.lock').read_text())
constraints=[]
for package in lock['package']:
    name=package['name'].replace('_','-').lower()
    if name in {'policyengine-uk','uk-budget-data'}: continue
    if package.get('source',{}).get('editable'): continue
    constraints.append(f'{package["name"]}=={package["version"]}')
path=ROOT/'importer-dependency-constraints.txt'
path.write_text('\n'.join(sorted(set(constraints)))+'\n')
runner.RESULT.write_text(json.dumps(runner.stages,indent=2)+'\n')
runner.command('pin_importer_dependencies',['uv','pip','install','--python',str(ROOT/'importer-runtime/.venv/bin/python'),'--constraint',str(path),'policyengine-uk==2.145.0','policyengine-core==3.33.3','PyYAML','openpyxl','beautifulsoup4','lxml'])
