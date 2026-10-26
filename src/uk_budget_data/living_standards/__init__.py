"""The Living standards tab's data: baseline projections, outturn and OBR series.

``uk-budget-data living-standards`` writes
``public/data/living_standards_outlook.json`` (shape in
``docs/DATA_CONTRACT.md``) from this repository's own code, on the pinned
policyengine.py bundle and its certified Microcosm dataset:

- :mod:`.projections` runs the baseline (current-law) microsimulation and
  aggregates HBAI-style incomes, poverty and inequality by year;
- :mod:`.hbai` extracts the DWP HBAI outturn from the summary tables;
- :mod:`.obr` extracts OBR series from the EFO economy tables (household
  income per person, and the forecast series the Forecast changes sub-tab
  shows);
- :mod:`.build` assembles the JSON with its provenance;
- :mod:`.forecast` loads a new OBR forecast into the file's ``post`` series
  (``uk-budget-data obr-forecast``).

Ported on 24 October 2026 from PolicyEngine/uk-living-standards-outlook
(branch rerun-2026-base, 6e28822), which is no longer this tab's source.
"""

from pathlib import Path

INPUTS_DIR = Path("data_inputs/living_standards")
OUTPUT_PATH = Path("public/data/living_standards_outlook.json")
