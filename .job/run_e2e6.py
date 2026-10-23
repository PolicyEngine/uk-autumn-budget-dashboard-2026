"""External wall-time supervisor; every heavy phase passes the fleet gate."""
import argparse
import datetime as dt
import json
from pathlib import Path
import subprocess
import sys
import time
import e2e_common as common

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('label')
    parser.add_argument('--memory-gb',type=float,default=0.)
    parser.add_argument('command',nargs=argparse.REMAINDER)
    args=parser.parse_args()
    command=args.command
    if command and command[0]=='--':command=command[1:]
    common.configure_environment()
    gate=common.gate(args.label,memory_gb=args.memory_gb)
    logs=common.JOB/'logs';logs.mkdir(exist_ok=True)
    start=time.perf_counter();utc=dt.datetime.now(dt.timezone.utc).isoformat()
    with (logs/(args.label+'.log')).open('w') as stream:
        result=subprocess.run(command,stdout=stream,stderr=subprocess.STDOUT)
    row={'label':args.label,'utc_start':utc,'external_wall_seconds':time.perf_counter()-start,'supervisor_gate_seconds':gate,'exit_code':result.returncode,'command':command}
    target=common.JOB/'phases.jsonl'
    with target.open('a') as stream:stream.write(json.dumps(row)+'\n')
    print(json.dumps(row),flush=True)
    raise SystemExit(result.returncode)

if __name__=='__main__':main()
