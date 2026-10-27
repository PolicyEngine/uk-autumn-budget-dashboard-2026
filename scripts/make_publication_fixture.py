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
from policyengine_uk.utils.scenario import Scenario
from tests.fixed_shape_measures import module_level_modifier
from tests.publication_support import PROJECTION_END, World
from uk_budget_data import model_limits
from uk_budget_data.data_limits import DATA_LIMITS, record
from uk_budget_data.publication import manifest as m
from uk_budget_data.publication import attestations
from uk_budget_data.publication.artifacts import read_receipt
from uk_budget_data.publication.publish import approve, stage
from uk_budget_data.publication.receipt import scenario_identity

out = Path(sys.argv[1])
# A year the dataset covers and the year after it, which it does not, so
# the browser code is tested on both sides of the projection horizon.
IN, BEYOND = PROJECTION_END, PROJECTION_END + 1
world = World()
original_attestations_root = attestations.ATTESTATIONS_ROOT
original_attestation_repository = attestations.ATTESTATION_REPOSITORY
attestations.ATTESTATIONS_ROOT = world.root / "attestations"
attestations.ATTESTATION_REPOSITORY = attestations.ATTESTATIONS_ROOT
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
        kwargs = {}
        if key == "delta":
            # A hand-written modifier is held until two people attest this
            # exact receipt. The browser checks the Python-written full
            # receipt digest and reviewer record as well as its shape.
            kwargs["reform_identity"] = scenario_identity(
                Scenario(simulation_modifier=module_level_modifier),
                name=key,
                revision=world.revision(),
            )
        refs[key] = world.ready(
            key, values[key], rate=0.2 + 0.01 * len(refs), **kwargs
        )
        if key == "delta":
            attestations.ATTESTATIONS_ROOT.mkdir()
            document = read_receipt(refs[key].path)
            attestation_file = attestations.ATTESTATIONS_ROOT / f"{key}.json"
            attestation_file.write_text(
                json.dumps(
                    {
                        "measure_id": key,
                        "receipt_sha256": attestations.receipt_document_sha256(
                            document
                        ),
                        "reason": "The modifier leaves the simulation unchanged.",
                        "checker": "First reviewer",
                        "second": "Second reviewer",
                        "released_at": "2026-10-22T12:00:00+00:00",
                    }
                )
                + "\n"
            )
            World.commit_attestation(attestation_file)
        stage(manifest, refs[key].path, **args)
    for key in ("alpha", "beta"):
        approve(manifest, key, "Reviewer", **args)
    world.expect("gamma", "positive", IN)
    refs["gamma"] = world.write("gamma", values["gamma"], rate=0.25)
    world.reconcile(refs["gamma"])
    stage(manifest, refs["gamma"].path, provisional=True, **args)
    # A measure the certified data cannot cost (the PIP daily living points
    # needed for the enhanced rate: the data record awards, not points): its
    # receipt records the limit, so its artifact is the receipt alone, and
    # staging lists it as not computable, with its reason and no figure.
    points = record(
        next(
            limit
            for limit in DATA_LIMITS
            if limit.key == "pip_daily_living_points"
        ),
        ["gov.dwp.pip.daily_living.points_thresholds.enhanced"],
    )
    refs["epsilon"] = world.write(
        "epsilon", {IN: 0.0, BEYOND: 0.0}, rate=0.26, data_limits=[points]
    )
    stage(manifest, refs["epsilon"].path, **args)
    # A measure the installed model mis-costs (a 2027 Pension Credit measure,
    # held until the minimum guarantee follows earnings): its receipt
    # records the model limit, so it is shown as provisional and can never
    # be approved. The fixture had one entry for each limit; the other three
    # expired at policyengine-uk 2.151.0 (PR 238).
    guarantee = model_limits.record(
        next(
            limit for limit in model_limits.MODEL_LIMITS
            if limit.key == "pc_minimum_guarantee_uprating"
        ),
        ["gov.dwp.pension_credit.guarantee_credit.minimum_guarantee.SINGLE"],
    )
    world.expect("theta", "positive", IN)
    refs["theta"] = world.write(
        "theta", {IN: 1.3, BEYOND: 1.4}, rate=0.29, model_limits=[guarantee]
    )
    world.reconcile(refs["theta"])
    stage(manifest, refs["theta"].path, provisional=True, **args)
    records = []
    for member in ("alpha", "beta"):
        receipt = read_receipt(refs[member].path)["execution_receipt"]
        records.append(
            {
                "id": member,
                "reform": receipt["reform"],
                "baseline": receipt["baseline"],
            }
        )
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
    print(
        json.dumps(
            {
                k: (e.status, e.unsupported_years)
                for k, e in manifest.entries().items()
            }
        )
    )
finally:
    attestations.ATTESTATIONS_ROOT = original_attestations_root
    attestations.ATTESTATION_REPOSITORY = original_attestation_repository
    world.close()
