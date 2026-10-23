import base64
import hashlib
import importlib.metadata as md
import importlib.util
import json
from pathlib import Path
import sys
import e2e_common as common

common.configure_environment()
pe=common.load_runtime()
paths={}
checked={}
for name in common.PINS:
    dist=md.distribution(name)
    total=0
    for entry in dist.files:
        if entry.hash is None:continue
        if entry.hash.mode!='sha256':raise RuntimeError(entry.hash.mode)
        p=Path(dist.locate_file(entry))
        actual=base64.urlsafe_b64encode(hashlib.sha256(p.read_bytes()).digest()).decode().rstrip('=')
        assert actual==entry.hash.value,(name,str(entry))
        total+=1
    checked[name]=total
spec=importlib.util.find_spec('policyengine_uk.utils.import_obr_forecasts')
row={'python':sys.version,'versions':{n:md.version(n) for n in common.PINS},'record_files_checked':checked,'certified_pin_importer_present':spec is not None,'lock_sha256':hashlib.sha256((common.JOB/'runtime/uv.lock').read_bytes()).hexdigest(),'data_manifest_bundled_sha256':pe.uk.model.release_manifest.source_sha256}
assert row['lock_sha256']=='d06f3846f24336bb05e563e3d27b9f5fb46e81d99f0c92fac80f8ff24d9b35bf'
(common.JOB/'preflight.json').write_text(json.dumps(row,indent=2)+'\n')
common.finish(**row)
