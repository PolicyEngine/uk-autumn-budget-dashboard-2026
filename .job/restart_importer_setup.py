import json, time
import run_importer as runner
runner.stages.update(json.loads(runner.RESULT.read_text()))
runner.stages['initial_install_interrupted']={'completed':False,'reason':'Slow Plotly download/extraction; interrupted alongside main sync. Exact existing immutable5.24.1 cache now read in place through workspace links. Preparation only, excluded from Budget route clock.','elapsed_seconds_approximate': time.time()-runner.RESULT.stat().st_mtime}
runner.RESULT.write_text(json.dumps(runner.stages,indent=2)+'\n')
runner.command('install_after_cache_seed',['uv','pip','install','--python',str(runner.ROOT/'importer-runtime/.venv/bin/python'),'policyengine-uk==2.145.0','policyengine-core==3.33.3'])
