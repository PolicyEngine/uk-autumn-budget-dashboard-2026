"""The work a remote container does for ``constituencies --backend modal``,
with no Modal import, so tests can run it here.

``root`` is where the run's private files go: the Modal Volume's mount in a
container, a temporary directory in tests. A unit keeps its arrays and its
copy of the dataset's arrays under ``<root>/geography/<run id>/``; the
release reads them back, checks every unit ran on the same households, and
writes the disclosure layer's audit under ``root`` too. Only the public
table's bytes leave.
"""

import os
import tempfile
from pathlib import Path

import numpy as np

from uk_budget_data.private_outputs import AUDIT_DIR_ENV, private_directory

HDF5_ENV = {"HDF5_USE_FILE_LOCKING": "FALSE"}


def unit_paths(root: str, run_id: str, reform: str) -> dict:
    """Where a unit keeps its files under ``root``."""
    run = f"{root}/geography/{run_id}"
    return {
        "result": f"{run}/units/{reform}.json",
        "arrays": f"{run}/units/{reform}.npz",
        "dataset_arrays": {
            "arrays": f"{run}/datasets/{reform}.npz",
            "record": f"{run}/datasets/{reform}.json",
        },
    }


def simulate_here(
    spec: dict, *, root: str, dataset: str, data_inputs: str
) -> dict:
    """One measure: ``constituencies.simulate_unit`` with its files under
    ``root`` and the cut at ``dataset``."""
    from uk_budget_data.constituencies import simulate_unit

    os.environ.update(HDF5_ENV)
    os.environ[AUDIT_DIR_ENV] = root
    paths = unit_paths(root, spec["run_id"], spec["reform"])
    for path in (paths["result"], paths["dataset_arrays"]["arrays"]):
        private_directory(Path(path).parent)
    unit = {
        **spec,
        **paths,
        "dataset": dataset,
        "data_inputs_dir": data_inputs,
    }
    unit["dataset_arrays"] = {
        **paths["dataset_arrays"],
        "key": spec["dataset_key"],
    }
    return simulate_unit(unit)


def release_here(
    spec: dict, *, root: str, data_inputs: str
) -> tuple[dict, dict]:
    """The release over every unit under ``root``: their dataset arrays
    checked identical, then ``constituencies.build_tables``. Returns its
    result and the public table's bytes by file name."""
    from uk_budget_data.constituencies import (
        ConstituencyRunError,
        build_tables,
    )

    os.environ.update(HDF5_ENV)
    os.environ[AUDIT_DIR_ENV] = root
    reforms = [unit["reform"] for unit in spec["units"]]
    paths = {r: unit_paths(root, spec["run_id"], r) for r in reforms}
    datasets = [paths[r]["dataset_arrays"]["arrays"] for r in reforms]
    with np.load(datasets[0], allow_pickle=False) as first:
        reference = {name: first[name] for name in first.files}
    for reform, path in zip(reforms[1:], datasets[1:]):
        with np.load(path, allow_pickle=False) as other:
            if sorted(other.files) != sorted(reference) or not all(
                np.array_equal(other[name], value)
                for name, value in reference.items()
            ):
                raise ConstituencyRunError(
                    f"{reform} ran on different survey households, regions "
                    "or seats from the other measures"
                )
    out_dir = Path(tempfile.mkdtemp(prefix="constituency-"))
    prior = None
    if spec.get("prior_regional_csv") is not None:
        prior = out_dir / "prior_regional.csv"
        prior.write_text(spec["prior_regional_csv"], encoding="utf-8")
    run_dir = Path(f"{root}/geography/{spec['run_id']}")
    release = {
        key: spec[key]
        for key in (
            "run_id",
            "release_name",
            "years",
            "packages",
            "seat_reforms",
            "allow_demotions",
            "simulate_s",
        )
    }
    release.update(
        dataset_arrays=datasets[0],
        units=[{"reform": r, "arrays": paths[r]["arrays"]} for r in reforms],
        prior_regional=str(prior) if prior else None,
        data_inputs_dir=data_inputs,
        out_dir=str(out_dir),
        result=str(run_dir / f"release-{spec['stamp']}.json"),
    )
    result = build_tables(release)
    files = {
        Path(path).name: Path(path).read_bytes() for path in result["written"]
    }
    # The audit's path is the container's; keep only where it is under root.
    if result.get("audit"):
        result["audit"] = os.path.relpath(result["audit"], root)
    return result, files
