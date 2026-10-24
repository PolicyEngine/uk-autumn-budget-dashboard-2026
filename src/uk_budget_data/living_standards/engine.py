"""The engine and dataset the projections run on, and the years they cover.

Everything here is read from the installed policyengine.py bundle, so the
tab always reports the engine and certified Microcosm build the repository
pins (``uv.lock``), never a hand-passed file.
"""

from importlib.metadata import version

from uk_budget_data.bundle_adoption import installed_identity, version_tuple
from uk_budget_data.certified_data import load_bundle_manifest

# First fiscal year modelled: 2024-25, the latest HBAI outturn year, so the
# level gap to HBAI shows within one year.
FIRST_YEAR = 2024
# Fiscal 2026-27: the year of Autumn Budget 2026, the price base and the
# start of every headline change.
BASE_YEAR = 2026

# policyengine-uk applies the protected UC health element amount only for
# 2026 to 2029 before this release (pe-uk #2282), so 2030-31 steps. From it
# on, the series run a year further, to 2030-31.
UC_HEALTH_FIX = (2, 134, 4)
END_YEAR_BEFORE_FIX = 2029
END_YEAR_WITH_FIX = 2030


def fy(year: int) -> str:
    """2026 -> "2026-27"."""
    return f"{year}-{str(year + 1)[-2:]}"


def engine_versions() -> dict:
    """Installed policyengine and policyengine-uk versions."""
    return {
        "policyengine": version("policyengine"),
        "policyengine_uk": version("policyengine-uk"),
    }


def headline_end_year(policyengine_uk: str) -> int:
    """Last fiscal year (start) the series show, from the engine version."""
    if version_tuple(policyengine_uk) >= UC_HEALTH_FIX:
        return END_YEAR_WITH_FIX
    return END_YEAR_BEFORE_FIX


def headline_end_year_note(policyengine_uk: str) -> str:
    """One sentence on why the series stop where they do."""
    end = headline_end_year(policyengine_uk)
    if end == END_YEAR_BEFORE_FIX:
        return (
            f"Series end in {fy(end)}: policyengine-uk {policyengine_uk} "
            "ends the UC health element protection in 2030, a bug fixed in "
            "2.134.4 that this engine pin predates."
        )
    return (
        f"Series end in {fy(end)}, the last year of the OBR forecast the "
        f"model's uprating follows (policyengine-uk {policyengine_uk})."
    )


def projection_years(policyengine_uk: str) -> list[int]:
    """Fiscal years (start) the projections run: 2024-25 to the end year."""
    return list(range(FIRST_YEAR, headline_end_year(policyengine_uk) + 1))


def certified_dataset() -> dict:
    """The bundle's certified UK dataset: name, build tag, sha256, repo."""
    manifest = load_bundle_manifest()
    identity = installed_identity(manifest)
    release = manifest["data_releases"]["uk"]
    package = release["data_package"]
    artifact = release["certified_data_artifact"]
    return {
        "name": identity["dataset"],
        "tag": artifact.get("build_id")
        or package["release_manifest_revision"],
        "sha256": identity["dataset_sha256"],
        "hf_repo": package["repo_id"],
        "model_version": identity["model_version"],
    }
