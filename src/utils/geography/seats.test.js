import { describe, expect, it } from "vitest";
import { parseGeographyTable } from "./parse";
import {
  APPROXIMATE_OPACITY,
  CATEGORY_COLOURS,
  NO_DATA_FILL,
  WITHHELD_FILL,
} from "./palette";
import { describeSeat, seatStates, seatStyle, seatSummary } from "./seats";
import { geographyFixture } from "../../test/geographyFixture";

const constituency = parseGeographyTable(geographyFixture("constituency.csv"), {
  level: "constituency",
});
const regional = parseGeographyTable(geographyFixture("regional.csv"), {
  level: "region",
});
const { features } = JSON.parse(geographyFixture("constituencies.geojson"));
const options = {
  reform: "autumn_budget_2026_combined",
  year: 2029,
  outcome: "relative_change",
};
const states = seatStates(features, constituency, options);

describe("seat states", () => {
  it("come from each seat's own row, or none", () => {
    expect(Object.fromEntries([...states].map(([code, state]) => [code, state.kind]))).toEqual({
      Z14000001: "reported",
      Z14000002: "approximate",
      Z14000003: "withheld",
      Z14000004: "reported",
      Z14000005: "reported",
      Z14000006: "no-data",
      Z14000007: "reported",
      Z14000008: "reported",
    });
  });

  it("draw withheld seats hatched, approximate ones lighter, missing ones as no data", () => {
    expect(seatStyle(states.get("Z14000003")).fill).toBe(WITHHELD_FILL);
    expect(seatStyle(states.get("Z14000002"))).toMatchObject({
      fill: CATEGORY_COLOURS.small_gain,
      fillOpacity: APPROXIMATE_OPACITY,
    });
    expect(seatStyle(states.get("Z14000006")).fill).toBe(NO_DATA_FILL);
    expect(seatStyle(undefined).fill).toBe(NO_DATA_FILL);
  });

  it("summarise a seat for search without inventing a figure", () => {
    expect(seatSummary(states.get("Z14000001"))).toBe("+1.12%");
    expect(seatSummary(states.get("Z14000002"))).toBe("+0.68% (approximate)");
    expect(seatSummary(states.get("Z14000003"))).toBe("Not published");
    expect(seatSummary(states.get("Z14000006"))).toBe("No data");
  });

  it("give a withheld seat no regional figure when the region's is withheld too", () => {
    const feature = {
      properties: { Name: "Lough Side", GSScode: "Z14000006", CTR_REG: "", Country: "Northern Ireland" },
    };
    const withheld = { kind: "withheld", row: null, category: null };
    const { lines } = describeSeat({ feature, state: withheld, regional, ...options });
    expect(lines).toEqual([
      {
        kind: "note",
        text: "Not published, to protect survey respondents' confidentiality.",
      },
    ]);
  });

  it("label the regional figure as the region's, approximate where it is", () => {
    const feature = {
      properties: { Name: "Valleyside", GSScode: "Z14000099", CTR_REG: "", Country: "Wales" },
    };
    const withheld = { kind: "withheld", row: null, category: null };
    const { title, lines } = describeSeat({ feature, state: withheld, regional, ...options });
    expect(title).toBe("Valleyside");
    expect(lines[1].text).toBe(
      "Regional figure for Wales, not an estimate for this constituency: +0.42% (0.11% to 0.73%, approximate)",
    );
  });
});
