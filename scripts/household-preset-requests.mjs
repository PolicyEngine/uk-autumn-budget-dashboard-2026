// The household API requests for the Household impact examples, as the page
// builds them: each example over the form's defaults, with every measure
// selected, for each year a reader can choose. Prints JSON to stdout for
// scripts/precompute_household_presets.py, which runs them and writes
// public/data/household_presets.json.
//
//   bun scripts/household-preset-requests.mjs > requests.json
import { readFileSync } from "node:fs";
import { presetRequests } from "../src/utils/householdPresets.js";

// The measures: --policies a,b,c, else the package's: the measures of
// public/data/policy_parameters.json, which `uk-budget-data policy-table`
// writes from AUTUMN_BUDGET_2026_COMBINED_COMPONENTS. Not the current
// presets file's own list, which can name a withdrawn measure the API
// refuses (BADR and employer NI, 27 October 2026).
const flag = process.argv.indexOf("--policies");
const policies = flag > 0
  ? process.argv[flag + 1].split(",")
  : Object.keys(JSON.parse(readFileSync(new URL("../public/data/policy_parameters.json", import.meta.url), "utf8")).measures);
process.stdout.write(`${JSON.stringify(presetRequests(policies), null, 1)}\n`);
