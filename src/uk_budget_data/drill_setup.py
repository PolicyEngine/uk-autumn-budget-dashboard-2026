"""Immutable custom data/engine contract for the October 2026 rehearsal."""

import hashlib
import os
from importlib.metadata import version
from pathlib import Path

MODEL_VERSION = "2.100.0"
CORE_VERSION = "3.32.5"
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


# Annual statutory freeze anchors, expressed in each engine parameter's units.
# Source: HMRC rates; https://www.gov.uk/government/publications/rates-and-allowances-national-insurance-contributions/rates-and-allowances-national-insurance-contributions
# Four thresholds must move together to avoid non-rounded uprated upper limits
# entering the old Class 4 case arithmetic: policyengine-uk issue #1878.
NIC_FREEZE_VALUES = {
    "gov.hmrc.national_insurance.class_1.thresholds.primary_threshold": 241.73,
    "gov.hmrc.national_insurance.class_1.thresholds.upper_earnings_limit": 967,
    "gov.hmrc.national_insurance.class_4.thresholds.lower_profits_limit": 12_570,
    "gov.hmrc.national_insurance.class_4.thresholds.upper_profits_limit": 50_270,
}


def nic_freeze_parameters(years=range(2026, 2031)) -> dict:
    """Reusable baseline for a stated freeze; not a registered drill measure."""
    return {
        path: {str(year): value for year in years}
        for path, value in NIC_FREEZE_VALUES.items()
    }


def with_nic_freeze(
    changes: dict | None = None, years=range(2026, 2031)
) -> dict:
    """Keep all four anchors, allowing a measure's explicit changes on top."""
    result = nic_freeze_parameters(years)
    for path, values in (changes or {}).items():
        result.setdefault(path, {}).update(values)
    return result


def drill_scenario(scenario=None):
    """Apply the four-threshold baseline in both population and household runs."""
    from policyengine_uk.utils.scenario import Scenario

    base = Scenario(parameter_changes=nic_freeze_parameters())
    return base + scenario if scenario is not None else base
