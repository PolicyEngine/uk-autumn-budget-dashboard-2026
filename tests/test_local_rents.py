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
