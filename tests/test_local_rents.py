"""The form's local rents table matches the installed policyengine-uk."""

import json
import subprocess
import sys
from pathlib import Path

from uk_budget_data import household_impact


def test_local_rents_table_is_current():
    """Re-run scripts/build_local_rents.py after a bundle upgrade."""
    built = subprocess.run(
        [sys.executable, "scripts/build_local_rents.py"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    committed = Path("src/utils/localRents.json").read_text()
    assert json.loads(built) == json.loads(committed)


def test_every_area_is_one_the_api_takes_and_every_region_has_its_default():
    table = json.loads(Path("src/utils/localRents.json").read_text())
    assert set(table["areas"]) <= set(household_impact.BRMAS)
    for region, brma in table["region_defaults"].items():
        assert region in table["areas"][brma]["regions"]
    for area in table["areas"].values():
        assert len(area["rates"]) == 5 and area["regions"]


def test_every_area_has_an_ons_average_rent_for_each_size():
    """The form's starting rent: one to four or more bedrooms, rising with
    size, from a month ONS published (data_inputs/local_rents/)."""
    table = json.loads(Path("src/utils/localRents.json").read_text())
    assert table["market_bedrooms"] == [1, 2, 3, 4]
    for name, area in table["areas"].items():
        rents = area["market"]
        assert len(rents) == 4 and all(
            isinstance(rent, int) for rent in rents
        ), name
        assert 0 < rents[0] < rents[1] < rents[2] < rents[3], name
        assert area["market_month"] in {"2026-07", "2026-09"}, name
        # Northern Ireland's latest month is two behind Great Britain's
        assert (area["market_month"] == "2026-07") == (
            area["regions"] == ["NORTHERN_IRELAND"]
        ), name


def test_every_local_authority_weight_has_an_ons_rent():
    """Every BRMA part's local authority has an ONS rent (under its current
    code) or is one ONS does not publish."""
    sys.path.insert(0, "scripts")
    import build_local_rents

    rents = build_local_rents.market_rents()
    assert set(
        json.loads(Path("src/utils/localRents.json").read_text())["areas"]
    ) <= set(rents)
