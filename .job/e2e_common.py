"""Certified, resource-gated aggregate-only E2E rehearsal utilities."""
from __future__ import annotations
import datetime as dt
import functools
import importlib.metadata as md
import json
import os
from pathlib import Path
import resource
import subprocess
import sys
import time

JOB = Path(__file__).resolve().parent
PINS = {"policyengine": "6.10.0", "policyengine-uk": "2.132.6", "policyengine-core": "3.33.3"}
CAPS = ("OPENBLAS_NUM_THREADS", "OMP_NUM_THREADS", "MKL_NUM_THREADS", "NUMEXPR_NUM_THREADS", "NUMEXPR_MAX_THREADS", "VECLIB_MAXIMUM_THREADS", "BLIS_NUM_THREADS", "GOTO_NUM_THREADS", "NUMBA_NUM_THREADS", "BLOSC_NTHREADS", "BLOSC2_NTHREADS")
COUNTERS = {"gates_s": 0., "gate_wait_s": 0., "construction_s": 0., "constructors": 0}

def event(name, **kw):
    row = {"utc": dt.datetime.now(dt.timezone.utc).isoformat(), "pid": os.getpid(), "event": name, **kw}
    target = JOB / "events" / f"{os.getpid()}.jsonl"
    target.parent.mkdir(exist_ok=True)
    with target.open("a") as stream:
        stream.write(json.dumps(row, default=str) + "\n")
    print(json.dumps(row, default=str), flush=True)

def configure_environment():
    for name in CAPS:
        os.environ[name] = "4"
    for name, folder in (("TMPDIR", "tmp"), ("XDG_CACHE_HOME", "cache"), ("HF_HOME", "hf-cache"), ("MPLCONFIGDIR", "mpl-cache")):
        p = JOB / folder
        p.mkdir(exist_ok=True)
        os.environ[name] = str(p)
    if not os.environ.get("HUGGING_FACE_TOKEN"):
        candidates = [Path.home()/".huggingface/token", Path.home()/".cache/huggingface/token"]
        for p in candidates:
            if p.is_file():
                os.environ["HUGGING_FACE_TOKEN"] = p.read_text().strip()
                break
    if not os.environ.get("HUGGING_FACE_TOKEN"):
        raise RuntimeError("Existing Hugging Face CLI login token unavailable")
    os.environ["HF_TOKEN"] = os.environ["HUGGING_FACE_TOKEN"]
    assert not os.environ.get("POLICYENGINE_SKIP_COUNTRY_IMPORTS")

def reservation(label):
    start = time.perf_counter()
    result = subprocess.run(["python3", str(Path.home()/"reviews/fleet-ops/tools/reservation.py"), "allowed", "uk-hub"], capture_output=True, text=True)
    if result.returncode:
        event("reservation_refused", label=label, detail=result.stdout+result.stderr)
        raise RuntimeError("Host reservation refused: start nothing new")
    return time.perf_counter()-start

def gate(label, memory_gb=0.):
    start = time.perf_counter()
    wait = 0.
    while True:
        reservation(label)
        now = dt.datetime.now(dt.timezone.utc)
        if now >= dt.datetime(2026,10,23,15,30,tzinfo=dt.timezone.utc):
            raise RuntimeError("15:30Z no-start boundary reached")
        s = os.statvfs(JOB)
        free = s.f_bavail*s.f_frsize/1e9
        load = os.getloadavg()[0]
        # macOS reclaimable headroom: free + inactive, less a 5 GB reserve.
        memory = None
        if memory_gb:
            import re
            vm = subprocess.check_output(["vm_stat"], text=True)
            page = int(re.search(r"page size of (\d+) bytes",vm).group(1))
            pages = sum(int(re.search(r"Pages "+kind+r":\s+(\d+)",vm).group(1)) for kind in ("free", "inactive"))
            memory = max(0.,page*pages/1e9-5.)
        event("gate", label=label, load1=load, free_disk_gb=free, free_memory_gb=memory, required_memory_gb=memory_gb)
        if load <= 110 and free >= 55 and (memory is None or memory >= memory_gb):
            break
        t = time.perf_counter()
        time.sleep(10)
        wait += time.perf_counter()-t
    elapsed = time.perf_counter()-start
    COUNTERS["gates_s"] += elapsed
    COUNTERS["gate_wait_s"] += wait
    event("gate_end", label=label, seconds=elapsed, resource_wait_s=wait)
    return elapsed

def load_runtime():
    configure_environment()
    versions = {name:md.version(name) for name in PINS}
    assert versions == PINS, versions
    assert sys.version_info[:2] == (3,13)
    gate("certified runtime import")
    certifications=[]
    manifests=[]
    fallback=False
    def trace(frame, kind, arg):
        nonlocal fallback
        if not frame.f_code.co_filename.endswith("/policyengine/provenance/manifest.py"):
            return None
        name=frame.f_code.co_name
        if name not in {"certify_data_release_compatibility", "get_data_release_manifest"}:
            return None
        if kind=="line" and name=="certify_data_release_compatibility" and frame.f_lineno==458:
            fallback=True
        if kind=="return" and arg is not None:
            (certifications if name=="certify_data_release_compatibility" else manifests).append(arg)
        return trace
    start=time.perf_counter()
    sys.settrace(trace)
    try:
        import policyengine as pe
    finally:
        sys.settrace(None)
    seconds=time.perf_counter()-start
    bases=[x.compatibility_basis for x in certifications]
    event("import",seconds=seconds,versions=versions,python=sys.version.split()[0],certification_bases=bases,fallback=fallback,data_manifests=[x.source_sha256 for x in manifests])
    if fallback or not manifests or not bases or any(x!="exact_build_model_version" for x in bases):
        raise RuntimeError("Certification must report exact_build_model_version without fallback")
    import numexpr, tables, blosc2
    numexpr.set_num_threads(4)
    tables.set_blosc_max_threads(4)
    blosc2.set_nthreads(4)
    event("thread_caps",environment={k:os.environ[k] for k in CAPS},numexpr=numexpr.get_num_threads(),blosc2=blosc2.nthreads)
    return pe

def install_constructor_guards():
    import policyengine_uk.simulation as module
    original=module.Simulation.__init__
    depth=0
    @functools.wraps(original)
    def guarded(self,*args,**kwargs):
        nonlocal depth
        gate("UK Simulation constructor")
        root=depth==0
        gates=COUNTERS["gates_s"]
        start=time.perf_counter()
        depth+=1
        try:
            return original(self,*args,**kwargs)
        finally:
            depth-=1
            if root:
                elapsed=time.perf_counter()-start-(COUNTERS["gates_s"]-gates)
                COUNTERS["construction_s"]+=elapsed
                COUNTERS["constructors"]+=1
                event("construction",seconds=elapsed,root=True)
    module.Simulation.__init__=guarded

def finish(**kw):
    event("finish",**kw,counters=COUNTERS,peak_memory_decimal_gb=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1e9)
