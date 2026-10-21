/**
 * The UK's regions and nations, as data_inputs/regions.csv lists them: the
 * ONS code, the name, and how the constituency boundary file labels each
 * (`CTR_REG` for an English region, `Country` for a nation). A test checks
 * that this copy and the CSV agree.
 */

export const REGIONS = Object.freeze(
  [
    ["E12000001", "North East", "North East", "England"],
    ["E12000002", "North West", "North West", "England"],
    [
      "E12000003",
      "Yorkshire and The Humber",
      "Yorkshire and the Humber",
      "England",
    ],
    ["E12000004", "East Midlands", "East Midlands", "England"],
    ["E12000005", "West Midlands", "West Midlands", "England"],
    ["E12000006", "East of England", "East of England", "England"],
    ["E12000007", "London", "Greater London", "England"],
    ["E12000008", "South East", "South East", "England"],
    ["E12000009", "South West", "South West", "England"],
    ["W92000004", "Wales", "", "Wales"],
    ["S92000003", "Scotland", "", "Scotland"],
    ["N92000002", "Northern Ireland", "", "Northern Ireland"],
  ].map(([code, name, geojsonRegion, geojsonCountry]) =>
    Object.freeze({ code, name, geojsonRegion, geojsonCountry }),
  ),
);

const BY_CODE = new Map(REGIONS.map((region) => [region.code, region]));

/** Whether `code` is one of the twelve region codes. */
export const isRegionCode = (code) => BY_CODE.has(code);

/** The region with this ONS code, or null. */
export const regionByCode = (code) => BY_CODE.get(code) ?? null;

/**
 * The region a constituency lies in, from its boundary file properties:
 * `CTR_REG` names the English region ("Greater London") and is empty for
 * the other nations, which `Country` names. Null when neither matches.
 */
export function regionForBoundary(properties) {
  const country = properties?.Country ?? "";
  const englishRegion = country === "England" ? (properties?.CTR_REG ?? "") : "";
  return (
    REGIONS.find(
      (region) =>
        region.geojsonCountry === country &&
        region.geojsonRegion === englishRegion,
    ) ?? null
  );
}
