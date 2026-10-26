// The household API requests for the Household impact examples, as the page
// builds them: each example over the form's defaults, with every measure
// selected, for each year a reader can choose. Prints JSON to stdout for
// scripts/precompute_household_presets.py, which runs them and writes
// public/data/household_presets.json.
//
//   bun scripts/household-preset-requests.mjs > requests.json
import { presetRequests } from "../src/utils/householdPresets.js";

process.stdout.write(`${JSON.stringify(presetRequests(), null, 1)}\n`);
