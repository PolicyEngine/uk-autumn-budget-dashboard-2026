// The household API requests for the Household impact examples, as the page
// builds them: each example over the form's defaults, with every measure
// selected, for each year a reader can choose. Prints JSON to stdout for
// scripts/precompute_household_presets.py, which runs them and writes
// public/data/household_presets.json.
//
//   bun scripts/household-preset-requests.mjs > requests.json
import { readFileSync } from "node:fs";
import { presetRequests } from "../src/utils/householdPresets.js";

// The measures: --policies a,b,c, else the ones the current file was written for
const flag = process.argv.indexOf("--policies");
const policies = flag > 0
  ? process.argv[flag + 1].split(",")
  : JSON.parse(readFileSync(new URL("../public/data/household_presets.json", import.meta.url), "utf8")).policies;
process.stdout.write(`${JSON.stringify(presetRequests(policies), null, 1)}\n`);
