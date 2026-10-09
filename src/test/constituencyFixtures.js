/**
 * Synthetic constituency fixtures for tests. TEST FIXTURES ONLY: the codes,
 * names and values are made up and are never shown in the dashboard.
 */

const REGIONS = [
  { CTR_REG: "North East", Country: "England", prefix: "E14" },
  { CTR_REG: "Greater London", Country: "England", prefix: "E14" },
  { CTR_REG: "", Country: "Scotland", prefix: "S14" },
  { CTR_REG: "", Country: "Wales", prefix: "W07" },
];

/** Build `count` fake constituencies with unique codes and varied regions. */
export function makeConstituencies(count) {
  return Array.from({ length: count }, (_, i) => {
    const region = REGIONS[i % REGIONS.length];
    return {
      code: `${region.prefix}${String(i + 1).padStart(6, "0")}`,
      // Every fifth name has a comma, as real names like
      // "Ayr, Carrick and Cumnock" do.
      name: i % 5 === 0 ? `Test seat ${i + 1}, North` : `Test seat ${i + 1}`,
      CTR_REG: region.CTR_REG,
      Country: region.Country,
    };
  });
}

/** A geojson FeatureCollection with one small square per constituency. */
export function makeGeojson(constituencies) {
  return {
    type: "FeatureCollection",
    features: constituencies.map((c, i) => ({
      type: "Feature",
      properties: {
        GSScode: c.code,
        Name: c.name,
        CTR_REG: c.CTR_REG,
        Country: c.Country,
      },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [i * 10, 0],
            [i * 10 + 10, 0],
            [i * 10 + 10, 10],
            [i * 10, 10],
            [i * 10, 0],
          ],
        ],
      },
    })),
  };
}

const quote = (text) =>
  /[",]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;

/**
 * constituency.csv text with one row per policy, year and constituency.
 * `value(policyId, year, index)` returns [average_gain, relative_change].
 */
export function makeConstituencyCsv(constituencies, policies, years, value) {
  const lines = [
    "reform_id,year,constituency_code,constituency_name,average_gain,relative_change",
  ];
  for (const policyId of policies) {
    for (const year of years) {
      constituencies.forEach((c, i) => {
        const [gain, relative] = value(policyId, year, i);
        lines.push(
          [policyId, year, c.code, quote(c.name), gain, relative].join(","),
        );
      });
    }
  }
  return `${lines.join("\n")}\n`;
}

/** Stub fetch to serve the given CSV text and geojson. */
export function constituencyFetch(csvText, geojson) {
  return async (url) => ({
    ok: true,
    text: async () => (String(url).endsWith(".csv") ? csvText : ""),
    json: async () => geojson,
  });
}
