/**
 * Constituency results shared by the constituency map and the constituency
 * rankings, so both read the same numbers and the same availability flag.
 */

// Reform IDs whose constituency rows can be shown. The rows on main are the
// November 2025 publication's: public/data/constituency.csv is byte-identical
// to the file the 2025 dashboard shipped. Add a 2026 reform ID only after its
// constituency rows are regenerated from the certified Microcosm release with
// aligned constituency weights and pass the local-area checks. Until then the
// map and the rankings stay unavailable for any selection that includes it.
export const VERIFIED_CONSTITUENCY_POLICY_IDS = new Set([
  "autumn_budget_2025_combined",
  "two_child_limit",
  "fuel_duty_freeze",
  "rail_fares_freeze",
  "threshold_freeze_extension",
  "dividend_tax_increase_2pp",
  "savings_tax_increase_2pp",
  "property_tax_increase_2pp",
  "freeze_student_loan_thresholds",
  "salary_sacrifice_cap",
]);

export const UNAVAILABLE_MESSAGE =
  "Complete constituency estimates for the selected policies are not available. National results are shown above; local estimates require verified constituency weights.";

// Format year for display (e.g., 2026 -> "2026-27")
export const formatYearRange = (year) =>
  `${year}-${(year + 1).toString().slice(-2)}`;

// The geojson labels two English regions differently from ONS; use the ONS
// names so the region column joins to official statistics.
const ONS_REGION_NAMES = {
  "Greater London": "London",
  "Yorkshire and the Humber": "Yorkshire and The Humber",
};

/** Split one CSV line, honouring double-quoted fields and "" escapes. */
export function parseCsvLine(line) {
  const values = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes && char === '"' && line[i + 1] === '"') {
      current += '"';
      i++;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      values.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current.trim());
  return values;
}

// Blank or malformed numbers become NaN, not 0, so availability can reject
// them instead of ranking a fabricated zero.
const toNumber = (value) =>
  value === undefined || value.trim() === "" ? NaN : Number(value);

/** Parse constituency.csv into typed rows. */
export function parseConstituencyCsv(csvText) {
  const lines = csvText.replace(/\r/g, "").split("\n");
  const headers = parseCsvLine(lines[0] ?? "");

  return lines
    .slice(1)
    .filter((line) => line.trim())
    .map((line) => {
      const values = parseCsvLine(line);
      const row = {};
      headers.forEach((header, idx) => {
        row[header] = values[idx];
      });

      return {
        reform_id: row.reform_id,
        year: toNumber(row.year),
        constituency_code: row.constituency_code,
        constituency_name: row.constituency_name,
        average_gain: toNumber(row.average_gain),
        relative_change: toNumber(row.relative_change),
      };
    });
}

/** Map each constituency code in the geojson to its region and country. */
export function buildRegionLookup(geoData) {
  const lookup = new Map();
  for (const feature of geoData?.features ?? []) {
    const { GSScode, CTR_REG, Country } = feature.properties ?? {};
    if (!GSScode) continue;
    // Scotland, Wales and Northern Ireland have no English region; the
    // country stands in as the region.
    const region = CTR_REG ? (ONS_REGION_NAMES[CTR_REG] ?? CTR_REG) : Country;
    lookup.set(GSScode, { region: region ?? "", country: Country ?? "" });
  }
  return lookup;
}

/**
 * Decide whether constituency results can be shown for a selection.
 *
 * Fails closed: available only when every selected policy is verified and has
 * exactly one row with finite values for every expected constituency in the
 * selected year, and no rows for any other constituency.
 *
 * @returns {{available: boolean, reason: string, policies?: string[]}}
 */
export function getConstituencyAvailability({
  rows,
  selectedPolicies,
  selectedYear,
  constituencyCodes,
  verifiedPolicyIds = VERIFIED_CONSTITUENCY_POLICY_IDS,
}) {
  if (!selectedPolicies?.length) {
    return { available: false, reason: "no-policies" };
  }

  const unverified = selectedPolicies.filter(
    (policyId) => !verifiedPolicyIds.has(policyId),
  );
  if (unverified.length) {
    return {
      available: false,
      reason: "unverified-policy",
      policies: unverified,
    };
  }

  const expected = new Set(constituencyCodes ?? []);
  if (!expected.size) {
    return { available: false, reason: "no-geography" };
  }

  const seen = new Map(
    selectedPolicies.map((policyId) => [policyId, new Set()]),
  );
  for (const row of rows ?? []) {
    const codes = seen.get(row.reform_id);
    if (!codes || row.year !== selectedYear) continue;
    if (
      !expected.has(row.constituency_code) ||
      codes.has(row.constituency_code) ||
      !Number.isFinite(row.average_gain) ||
      !Number.isFinite(row.relative_change)
    ) {
      return {
        available: false,
        reason: "invalid-rows",
        policies: [row.reform_id],
      };
    }
    codes.add(row.constituency_code);
  }

  const incomplete = selectedPolicies.filter(
    (policyId) => seen.get(policyId).size !== expected.size,
  );
  if (incomplete.length) {
    return {
      available: false,
      reason: "incomplete-coverage",
      policies: incomplete,
    };
  }

  return { available: true, reason: "available" };
}

/**
 * Sum each constituency's results across the selected policies for one year,
 * keeping each policy's contribution for the map tooltip.
 */
export function aggregateConstituencies(rows, selectedPolicies, selectedYear) {
  if (!rows?.length || !selectedPolicies?.length) return [];

  const selected = new Set(selectedPolicies);
  const constituencyMap = new Map();

  rows.forEach((row) => {
    if (!selected.has(row.reform_id)) return;
    if (row.year !== selectedYear) return;

    const key = row.constituency_code;
    if (!constituencyMap.has(key)) {
      constituencyMap.set(key, {
        constituency_code: row.constituency_code,
        constituency_name: row.constituency_name,
        average_gain: 0,
        relative_change: 0,
        policyBreakdown: {},
      });
    }

    const existing = constituencyMap.get(key);
    existing.average_gain += row.average_gain;
    existing.relative_change += row.relative_change;
    existing.policyBreakdown[row.reform_id] = {
      average_gain: row.average_gain,
      relative_change: row.relative_change,
    };
  });

  return Array.from(constituencyMap.values());
}

let cachedLoad = null;

/**
 * Fetch constituency.csv and the constituency geojson once per page, so the
 * map and the rankings share one download.
 */
export function loadConstituencyData() {
  if (!cachedLoad) {
    const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";
    const get = (path, read) =>
      fetch(`${basePath}${path}`).then((response) => {
        if (!response.ok) throw new Error(`Failed to load ${path}`);
        return read(response);
      });

    cachedLoad = Promise.all([
      get("/data/constituency.csv", (r) => r.text()),
      get("/data/uk_constituencies_2024.geojson", (r) => r.json()),
    ])
      .then(([csvText, geoData]) => ({
        rows: parseConstituencyCsv(csvText),
        geoData,
      }))
      .catch((error) => {
        cachedLoad = null;
        throw error;
      });
  }
  return cachedLoad;
}

/** Clear the shared download (tests stub fetch per case). */
export function resetConstituencyDataCache() {
  cachedLoad = null;
}
