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
from tests.publication_support import PROJECTION_END, World
from uk_budget_data import model_limits
from uk_budget_data.data_limits import DATA_LIMITS, record
from uk_budget_data.publication import manifest as m
from uk_budget_data.publication.artifacts import read_receipt
from uk_budget_data.publication.publish import approve, stage

out = Path(sys.argv[1])
# A year the dataset covers and the year after it, which it does not, so
# the browser code is tested on both sides of the projection horizon.
IN, BEYOND = PROJECTION_END, PROJECTION_END + 1
world = World()
try:
    manifest = m.Manifest()
    args = dict(data_root=world.data_root, inputs=world.inputs)
    values = {
        "alpha": {IN: -1.1, BEYOND: -1.3},
        "beta": {IN: -2.2, BEYOND: -2.4},
        "gamma": {IN: 0.5, BEYOND: 0.6},
        "delta": {IN: 0.7, BEYOND: 0.8},
    }
    refs = {}
    for key in ("alpha", "beta", "delta"):
        refs[key] = world.ready(key, values[key], rate=0.2 + 0.01 * len(refs))
        stage(manifest, refs[key].path, **args)
    for key in ("alpha", "beta"):
        approve(manifest, key, "Reviewer", **args)
    world.expect("gamma", "positive", IN)
    refs["gamma"] = world.write("gamma", values["gamma"], rate=0.25)
    world.reconcile(refs["gamma"])
    stage(manifest, refs["gamma"].path, provisional=True, **args)
    # A measure the certified data cannot cost (the SDLT higher rates): its
    # receipt records the limit, so staging lists it as not computable, with
    # its reason and no figure.
    surcharge = record(
        DATA_LIMITS[0],
        ["gov.hmrc.stamp_duty.residential.purchase.additional.rate[1].rate"],
    )
    refs["epsilon"] = world.write(
        "epsilon", {IN: 0.0, BEYOND: 0.0}, rate=0.26, data_limits=[surcharge]
    )
    stage(manifest, refs["epsilon"].path, **args)
    # A measure the installed model mis-costs (the State Pension's full
    # rates before policyengine-uk #2336): its receipt records the model
    # limit, so it is shown as provisional and can never be approved.
    full_rate = model_limits.record(
        model_limits.MODEL_LIMITS[0],
        ["gov.dwp.state_pension.new_state_pension.amount"],
    )
    world.expect("zeta", "positive", IN)
    refs["zeta"] = world.write(
        "zeta", {IN: 0.9, BEYOND: 1.0}, rate=0.27, model_limits=[full_rate]
    )
    world.reconcile(refs["zeta"])
    stage(manifest, refs["zeta"].path, provisional=True, **args)
    records = []
    for member in ("alpha", "beta"):
        receipt = read_receipt(refs[member].path)["execution_receipt"]
        records.append({"id": member, "reform": receipt["reform"], "baseline": receipt["baseline"]})
    combined = world.write(
        "combined--alpha+beta",
        {IN: -2.75, BEYOND: -3.0},
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
    # Replace the fixture outright, so no artifact from an earlier run
    # survives beside the new ones.
    shutil.rmtree(out, ignore_errors=True)
    shutil.copytree(world.data_root, out)
    print(json.dumps({k: (e.status, e.unsupported_years) for k, e in manifest.entries().items()}))
finally:
    world.close()
