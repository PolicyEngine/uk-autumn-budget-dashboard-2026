import { describe, expect, it } from "vitest";
import { parseGeographyTable } from "./parse";
import {
  NO_DATA_FILL,
  WITHHELD_FILL,
  approximateFill,
} from "./palette";
import { cardLines, describeSeat, movesNoSeat, seatCard, noSeatMovedNote, seatStates, seatStyle, seatSummary } from "./seats";
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

  it("draw withheld seats hatched, approximate ones dotted, missing ones as no data", () => {
    expect(seatStyle(states.get("Z14000003")).fill).toBe(WITHHELD_FILL);
    // Status is a texture, never a change of colour.
    expect(seatStyle(states.get("Z14000002"))).toMatchObject({
      fill: approximateFill("small_gain"),
      fillOpacity: 1,
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
    expect(lines).toEqual([{ kind: "note", text: "Not published: too few survey households" }]);
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

describe("a seat's card", () => {
  // TEST DATA ONLY: one seat, three measures; the map shows threshold_freeze
  const rows = [
    "threshold_freeze,average_change,-150.0,-200.0,-100.0,loss",
    "threshold_freeze,relative_change,-0.0021,-0.003,-0.001,loss",
    "loan_threshold,average_change,30.0,-10.0,70.0,too_close_to_call",
    "warm_home,average_change,0.0,0.0,0.0,no_change",
    "pension_protection,average_change,,,,",
  ].map((line) => {
    const [reform, outcome, value, lo, hi, direction] = line.split(",");
    const withheld = value === "";
    return `constituency,Z14000001,Northfield East,${reform},2031,${outcome},${value},${lo},${hi},${direction},${
      withheld ? "withheld,disclosure_control," : "reported,,30+"
    },False,direct`;
  });
  const header = geographyFixture("constituency.csv").split("\n")[0];
  const table = parseGeographyTable(`${header}\n${rows.join("\n")}\n`, { level: "constituency" });
  const measures = [
    { id: "loan_threshold", name: "Student loan threshold unfrozen" },
    { id: "warm_home", name: "Warm Home Discount top-up" },
    { id: "threshold_freeze", name: "Threshold freeze" },
    { id: "pension_protection", name: "State Pension protection" },
  ];
  const shown = { reform: "threshold_freeze", year: 2031, outcome: "average_change" };
  const [state] = seatStates([features[0]], table, shown).values();
  const card = seatCard({ feature: features[0], state, table, measures, ...shown });

  it("labels the headline with the measure the map shows, and lists the others", () => {
    expect(card.label).toBe("Threshold freeze");
    expect(card.average).toMatchObject({ text: "\u2212£150", sign: "loss" });
    expect(card.relative).toMatchObject({ text: "\u22120.21%", sign: "loss" });
    expect(card.policiesHeading).toBe("Other selected policies");
    expect(card.byPolicy.map((row) => row.id)).not.toContain("threshold_freeze");
  });

  it("colours by sign, counts no change, and puts not published last", () => {
    expect(card.byPolicy.map((row) => [row.name, row.text, row.sign])).toEqual([
      ["Student loan threshold unfrozen", "+£30", "gain"],
      ["State Pension protection", "Not published", null],
    ]);
    expect(card.byPolicy[1].title).toMatch(/confidentiality/);
    expect(card.unchanged).toEqual(["Warm Home Discount top-up"]);
  });

  it("says the same in the exported file", () => {
    expect(cardLines(card).lines.map((line) => line.text)).toEqual([
      "\u2212£150 · \u22120.21% of income",
      "Threshold freeze",
      "Other selected policies",
      "Student loan threshold unfrozen: +£30",
      "State Pension protection: Not published",
      "+1 with no change",
    ]);
  });

  it("gives the package's parts under Of which", () => {
    const parts = seatCard({ feature: features[0], state, table, measures: measures.filter((m) => m.id !== "threshold_freeze"), ...shown, label: "All policies" });
    expect(parts.label).toBe("All policies");
    expect(parts.policiesHeading).toBe("Of which");
  });
});

describe("a measure that moves no seat", () => {
  const seat = (row) => ({ kind: row ? row.tier : "no-data", row });
  const zero = { tier: "reported", direction: "no_change", value: "0" };
  const withheld = { tier: "withheld", direction: "", value: "" };
  const gain = { tier: "reported", direction: "gain", value: "0.4" };
  const close = { tier: "approximate", direction: "too_close_to_call", value: "0.01" };

  it("is every seat with a row zero or withheld", () => {
    expect(movesNoSeat(new Map([["a", seat(zero)], ["b", seat(withheld)], ["c", seat(null)]]))).toBe(true);
    expect(movesNoSeat(new Map([["a", seat(withheld)]]))).toBe(true);
  });

  it("is not when one seat has a figure, or no seat has a row", () => {
    expect(movesNoSeat(new Map([["a", seat(zero)], ["b", seat(gain)]]))).toBe(false);
    expect(movesNoSeat(new Map([["a", seat(withheld)], ["b", seat(close)]]))).toBe(false);
    expect(movesNoSeat(new Map([["a", seat(null)]]))).toBe(false);
    expect(movesNoSeat(null)).toBe(false);
  });

  it("the fixture's package moves seats", () => {
    expect(movesNoSeat(states)).toBe(false);
  });

  it("is said in one line, for one policy or several", () => {
    expect(noSeatMovedNote({ yearLabel: "2029-30" })).toBe(
      "No constituency shows a change large enough to publish for this policy in 2029-30.",
    );
    expect(noSeatMovedNote({ yearLabel: "2029-30", several: true })).toBe(
      "No constituency shows a change large enough to publish for these policies in 2029-30.",
    );
  });
});
