"""Immutable custom data/engine contract for the October 2026 rehearsal."""

import hashlib
import os
from importlib.metadata import version
from pathlib import Path

MODEL_VERSION = "2.120.0"
CORE_VERSION = "3.32.17"
DATASET_BUILD_MODEL_VERSION = "2.100.0"
DATASET_BUILD_CORE_VERSION = "3.32.5"
DATASET_BUILD_PYTHON_VERSION = "3.14.6"
DATASET_NAME = "microcosm_uk_2024_25.h5"
DATASET_SHA256 = (
    "aa31bdf67c977927ea2b325567d1cf7a79d94381239bc79918a0a0fc9c9588af"
)
DATASET_REVISION = "9d4a76ba20e7cdac69ff5213614a2b90a639f9da"
DATASET_RELEASE = "microcosm-uk-2024-25-national-20261002T230158Z-5c6b3f68"


def runtime_versions() -> dict[str, str]:
    """Read installed versions rather than advertising configured values."""
    return {
        name: version(name)
        for name in ("policyengine-uk", "policyengine-core")
    }


def verify_runtime() -> dict[str, str]:
    versions = runtime_versions()
    expected = {
        "policyengine-uk": MODEL_VERSION,
        "policyengine-core": CORE_VERSION,
    }
    if versions != expected:
        raise RuntimeError(
            f"Drill engine mismatch: expected {expected}; installed {versions}"
        )
    return versions


def verify_dataset(path: str | Path | None = None) -> Path:
    """Reject missing or changed inputs; never fall back to a bundled dataset."""
    selected = path or os.environ.get("UK_BUDGET_DATASET")
    if not selected:
        raise ValueError(
            "Set UK_BUDGET_DATASET or pass --dataset for the pinned drill H5"
        )
    selected = Path(selected).expanduser().resolve(strict=True)
    with selected.open("rb") as source:
        actual = hashlib.file_digest(source, "sha256").hexdigest()
    if actual != DATASET_SHA256:
        raise ValueError(f"Dataset SHA-256 mismatch: {selected.name}")
    return selected


def drill_provenance() -> dict:
    """Separate actual runtime from immutable producer metadata and consent."""
    return {
        "runtime": runtime_versions(),
        "dataset_build": {
            "policyengine-uk": DATASET_BUILD_MODEL_VERSION,
            "policyengine-core": DATASET_BUILD_CORE_VERSION,
            "python": DATASET_BUILD_PYTHON_VERSION,
        },
        "dataset": DATASET_NAME,
        "sha256": DATASET_SHA256,
        "revision": DATASET_REVISION,
        "mode": "drill-only-latest-engine-exception",
        "dataset_model_match": False,
        "calibration_validated_for_runtime": False,
        "publication_ready": False,
    }


def drill_scenario(scenario=None):
    """Use the latest engine's native baseline; apply no hidden policy overrides."""
    from policyengine_uk.utils.scenario import Scenario

    return scenario if scenario is not None else Scenario()
