"""The engine and dataset the projections run on, and the years they cover.

Everything here is read from the installed policyengine.py bundle, so the
tab always reports the engine and certified Microcosm build the repository
pins (``uv.lock``), never a hand-passed file.
"""

from importlib.metadata import version

from uk_budget_data.bundle_adoption import installed_identity
from uk_budget_data.certified_data import load_bundle_manifest

# First fiscal year modelled: 2024-25, the latest HBAI outturn year, so the
# level gap to HBAI shows within one year.
FIRST_YEAR = 2024
# Fiscal 2027-28: the price base and the start of every headline change,
# the first full fiscal year after Autumn Budget 2026, as on the rest of the
# dashboard.
BASE_YEAR = 2027
# Fiscal 2031-32: the last year the series show, as on the rest of the
# dashboard.
END_YEAR = 2031
# The last calendar year of the OBR March 2026 forecast in policyengine-uk's
# economic assumptions; 2031 takes its long-run assumptions.
OBR_FORECAST_LAST_YEAR = 2030


def fy(year: int) -> str:
    """2027 -> "2027-28"."""
    return f"{year}-{str(year + 1)[-2:]}"


def engine_versions() -> dict:
    """Installed policyengine and policyengine-uk versions."""
    return {
        "policyengine": version("policyengine"),
        "policyengine_uk": version("policyengine-uk"),
    }


def headline_end_year(policyengine_uk: str | None = None) -> int:
    """Last fiscal year (start) the series show.

    The same for every engine: before policyengine-uk 2.134.4 the UC health
    element for 2030-31 and 2031-32 comes from
    :mod:`.uc_health_element`, which reproduces that release's fix.
    """
    return END_YEAR


def long_run_growth(year: int = END_YEAR) -> dict:
    """CPI and earnings growth policyengine-uk assumes for a calendar year."""
    from policyengine_uk.system import system

    obr = system.parameters.gov.economic_assumptions.yoy_growth.obr
    return {
        "cpi": float(obr.consumer_price_index(f"{year}-01-01")),
        "earnings": float(obr.average_earnings(f"{year}-01-01")),
    }


def headline_end_year_note(policyengine_uk: str | None = None) -> str:
    """One sentence on the last year: past the OBR forecast horizon.

    The UC health element patch is recorded separately
    (``meta.uc_health_element_extension``).
    """
    growth = long_run_growth(END_YEAR)
    return (
        f"{fy(END_YEAR)} is past the OBR March 2026 forecast, so it uses "
        f"policyengine-uk's long-run assumptions (CPI {growth['cpi'] * 100:.1f}%, "
        f"earnings growth {growth['earnings'] * 100:.1f}%)."
    )


def projection_years(policyengine_uk: str | None = None) -> list[int]:
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
