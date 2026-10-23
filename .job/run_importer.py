from __future__ import annotations
import json, os, pathlib, subprocess, sys, time
ROOT=pathlib.Path(__file__).resolve().parent
RESULT=ROOT/'importer-timings.json'
ENV=os.environ.copy()
for key in ['OMP_NUM_THREADS','OPENBLAS_NUM_THREADS','MKL_NUM_THREADS','VECLIB_MAXIMUM_THREADS','NUMEXPR_NUM_THREADS','NUMBA_NUM_THREADS','BLIS_NUM_THREADS','GOTO_NUM_THREADS','TBB_NUM_THREADS','POLARS_MAX_THREADS','BLOSC_NTHREADS']:
    ENV[key]='4'
for key,value in {'UV_CACHE_DIR':ROOT/'uv-cache','UV_PYTHON_INSTALL_DIR':ROOT/'managed-python','XDG_CACHE_HOME':ROOT/'cache','TMPDIR':ROOT/'tmp','MPLCONFIGDIR':ROOT/'matplotlib','NUMBA_CACHE_DIR':ROOT/'numba-cache'}.items():
    pathlib.Path(value).mkdir(parents=True,exist_ok=True)
    ENV[key]=str(value)
ENV['PYTHONDONTWRITEBYTECODE']='1'
# Existing huggingface-cli login: read into process memory, never print/persist.
for token_path in [pathlib.Path.home()/'.cache/huggingface/token',pathlib.Path.home()/'.huggingface/token']:
    if token_path.is_file():
        ENV['HUGGING_FACE_TOKEN']=token_path.read_text().strip()
        break
stages={}

def reservation():
    check=subprocess.run(['python3',str(pathlib.Path.home()/'reviews/fleet-ops/tools/reservation.py'),'allowed','uk-hub'],env=ENV,capture_output=True,text=True)
    if check.returncode:
        raise RuntimeError(f'Reservation refused: exit {check.returncode}; start nothing new')

def command(key,args,env=None):
    reservation()
    started=time.perf_counter()
    p=subprocess.run(args,env=env or ENV,cwd=ROOT.parent,capture_output=True,text=True)
    stages[key]={'external_seconds':time.perf_counter()-started,'returncode':p.returncode,'argv':list(map(str,args))}
    (ROOT/f'importer-{key}.stdout.log').write_text(p.stdout)
    (ROOT/f'importer-{key}.stderr.log').write_text(p.stderr)
    RESULT.write_text(json.dumps(stages,indent=2)+'\n')
    print(json.dumps({key:stages[key]}),flush=True)
    if p.returncode:
        raise RuntimeError(f'{key} failed: exit {p.returncode}; see scratch logs')
    return p

if __name__=='__main__':
    command('venv',['uv','venv','--python',str(ROOT/'runtime/.venv/bin/python'),str(ROOT/'importer-runtime/.venv')])
    command('install',['uv','pip','install','--python',str(ROOT/'importer-runtime/.venv/bin/python'),'policyengine-uk==2.145.0','policyengine-core==3.33.3'])
