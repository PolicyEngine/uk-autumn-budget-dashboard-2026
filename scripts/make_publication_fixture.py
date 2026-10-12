"""Generate the frontend publication fixture from the Python publication code.

Usage (from the repository root):

    PYTHONPATH=. uv run python scripts/make_publication_fixture.py \\
        src/test/fixtures/publication

The fixture is a real manifest and real artifacts, written by the same code
that publishes, so the browser code is tested against bytes and digests the
Python side actually produces. Its receipts are certified against a dummy
dataset (see tests/publication_support.py), so it is test data only.
"""
import json, shutil, sys
from pathlib import Path
from tests.publication_support import World
from uk_budget_data.publication import manifest as m
from uk_budget_data.publication.artifacts import read_receipt
from uk_budget_data.publication.publish import approve, stage

out = Path(sys.argv[1])
world = World()
try:
    manifest = m.Manifest()
    args = dict(data_root=world.data_root, inputs=world.inputs)
    values = {
        "alpha": {2030: -1.1, 2031: -1.3},
        "beta": {2030: -2.2, 2031: -2.4},
        "gamma": {2030: 0.5, 2031: 0.6},
        "delta": {2030: 0.7, 2031: 0.8},
    }
    refs = {}
    for key in ("alpha", "beta", "delta"):
        refs[key] = world.ready(key, values[key], rate=0.2 + 0.01 * len(refs))
        stage(manifest, refs[key].path, **args)
    for key in ("alpha", "beta"):
        approve(manifest, key, "Reviewer", **args)
    world.expect("gamma", "positive", 2030)
    refs["gamma"] = world.write("gamma", values["gamma"], rate=0.25)
    world.reconcile(refs["gamma"])
    stage(manifest, refs["gamma"].path, provisional=True, **args)
    records = []
    for member in ("alpha", "beta"):
        receipt = read_receipt(refs[member].path)["execution_receipt"]
        records.append({"id": member, "reform": receipt["reform"], "baseline": receipt["baseline"]})
    combined = world.write(
        "combined--alpha+beta",
        {2030: -2.75, 2031: -3.0},
        members=records,
        measure_ids=["alpha", "beta"],
        rate=0.3,
        member_outputs={
            member: manifest.measures[member].outputs_sha256
            for member in ("alpha", "beta")
        },
    )
    stage(manifest, combined.path, **args)
    approve(manifest, "combined--alpha+beta", "Reviewer", **args)
    m.save_manifest(manifest, world.data_root)
    shutil.copytree(world.data_root, out, dirs_exist_ok=True)
    print(json.dumps({k: (e.status, e.unsupported_years) for k, e in manifest.entries().items()}))
finally:
    world.close()
