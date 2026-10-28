import { describe, expect, it } from "vitest";
import { parseGeographyTable } from "./parse";
import {
  CATEGORY_COLOURS,
  NO_DATA_FILL,
} from "./palette";
import { TOO_UNCERTAIN } from "./classify";
import { cardLines, constituencySentence, describeSeat, drawnAsNoData, movesNoSeat, seatCard, noSeatMovedNote, seatStates, seatStyle, seatSummary } from "./seats";
import { geographyFixture } from "../../test/geographyFixture";
import { CHART_COLOURS } from "../chartTheme";

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

  it("draw withheld, too uncertain and missing seats as No data, approximate ones in plain colour", () => {
    // One No data swatch on the map (Vahid, 28 October): a withheld seat is
    // never coloured, with or without the continuous scale
    expect(seatStyle(states.get("Z14000003")).fill).toBe(NO_DATA_FILL);
    expect(seatStyle(states.get("Z14000003"), () => CHART_COLOURS.gain).fill).toBe(NO_DATA_FILL);
    expect(states.get("Z14000004").category).toBe(TOO_UNCERTAIN);
    expect(seatStyle(states.get("Z14000004"), () => CHART_COLOURS.gain).fill).toBe(NO_DATA_FILL);
    expect(["Z14000003", "Z14000004", "Z14000006"].every((code) => drawnAsNoData(states.get(code)))).toBe(true);
    expect(drawnAsNoData(states.get("Z14000001"))).toBe(false);
    expect(drawnAsNoData(states.get("Z14000002"))).toBe(false);
    // No texture: an approximate seat is plain colour (Vahid, 28 October)
    expect(seatStyle(states.get("Z14000002"))).toMatchObject({
      fill: CATEGORY_COLOURS.small_gain,
      fillOpacity: 1,
    });
    expect(seatStyle(states.get("Z14000002"), () => CHART_COLOURS.gain).fill).toBe(CHART_COLOURS.gain);
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
    expect(lines).toEqual([{ kind: "note", text: "No data: not published, to protect survey respondents' confidentiality" }]);
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

describe("the card's sentence", () => {
  const seats = (rows) => new Map(rows.map((row, i) => [`s${i}`, { kind: row ? row.tier : "no-data", row }]));
  // No published category but for a zero: the sentence signs the figure as
  // the seat cards do (the file's own categories are tested below)
  const row = (areaName, value, tier = "reported") => ({ areaName, value, tier, direction: value === "0" ? "no_change" : undefined });
  const withheld = { tier: "withheld", direction: "", value: "" };
  const options = { outcome: "average_change", yearLabel: "2029-30" };

  it("gives the range when every seat gains", () => {
    const rows = [row("Northfield East", "310.0"), row("Harbour, Mill and Quay", "12.0"), row("Lough Side", "85.0")];
    expect(constituencySentence(seats(rows), options)).toBe(
      "Households gain on average in all 3 constituencies, from £12 a year in Harbour, Mill and Quay to £310 in Northfield East.",
    );
    // Seats with no data (not published, no row) are left out: "with data"
    const relative = [row("Northfield East", "0.0112"), row("Lough Side", "0.0031"), withheld, null];
    expect(constituencySentence(seats(relative), { ...options, outcome: "relative_change" })).toBe(
      "Households gain on average in all 2 constituencies with data, from 0.31% of income in Lough Side to 1.12% in Northfield East.",
    );
  });

  it("counts each seat in the file's own category, too close to call apart and never as a loss, and names the policy", () => {
    const at = (areaName, value, direction, tier = "approximate") => ({ areaName, value, tier, direction });
    const rows = [at("A", "-40.0", "loss"), at("B", "-30.0", "loss"), at("C", "-2.0", "too_close_to_call"), at("D", "6.0", "gain"), withheld, null];
    expect(constituencySentence(seats(rows), options)).toBe(
      "Households lose on average in 2 constituencies and gain in 1, 1 too close to call, and 2 have too few survey households to show.",
    );
    expect(constituencySentence(seats(rows), { ...options, policy: "Property income tax up" })).toMatch(/^Property income tax up: households lose on average in 2 constituencies/);
    expect(constituencySentence(seats(rows), { ...options, policy: "Property income tax up", note: "choose another policy" })).toMatch(
      /^Showing Property income tax up \(choose another policy\): households lose /,
    );
  });

  it("gives the range of a loss without a minus sign", () => {
    const rows = [row("Northfield East", "-0.0112"), row("Lough Side", "-0.0005")];
    expect(constituencySentence(seats(rows), { ...options, outcome: "relative_change" })).toBe(
      "Households lose on average in all 2 constituencies, from 0.05% of income in Lough Side to 1.12% in Northfield East.",
    );
  });

  it("counts the seats each way when they differ", () => {
    // Under half a pound reads as no change, as on the seat cards
    const rows = [row("A", "10.0"), row("B", "20.0"), row("C", "-5.0"), row("D", "0.3"), withheld];
    expect(constituencySentence(seats(rows), options)).toBe(
      "Households gain on average in 2 constituencies, lose in 1 and see almost no change in 1, and 1 has too few survey households to show.",
    );
    expect(constituencySentence(seats([row("A", "10.0"), row("C", "-5.0")]), options)).toBe(
      "Households gain on average in 1 constituency and lose in 1.",
    );
  });

  it("names almost no change only when it covers a tenth of the seats or more (Vahid, 28 October)", () => {
    const many = (n, make) => Array.from({ length: n }, (_, i) => make(i));
    // 577 lose, 2 almost no change, 71 not published: the 2 are not said
    const budgetDay = [...many(577, (i) => row(`L${i}`, "-40.0")), row("F1", "0.2"), row("F2", "-0.1"), ...many(71, () => withheld)];
    expect(constituencySentence(seats(budgetDay), options)).toBe("Households lose on average in 577 constituencies, and 71 have too few survey households to show.");
    // Both ways, a few flat: the gains and losses are each said
    const both = [...many(500, (i) => row(`G${i}`, "40.0")), ...many(80, (i) => row(`L${i}`, "-40.0")), ...many(5, (i) => row(`F${i}`, "0.1"))];
    expect(constituencySentence(seats(both), options)).toBe("Households gain on average in 500 constituencies and lose in 80.");
    // A tenth or more flat: said
    const flatShare = [...many(80, (i) => row(`G${i}`, "40.0")), ...many(20, (i) => row(`F${i}`, "0.1"))];
    expect(constituencySentence(seats(flatShare), options)).toBe("Households gain on average in 80 constituencies and see almost no change in 20.");
    // Only a few seats flat and nothing else placed: still said
    expect(constituencySentence(seats([row("F", "0.1"), withheld, withheld, withheld, withheld, withheld, withheld, withheld, withheld, withheld, withheld, withheld]), options)).toBe(
      "Households see almost no change on average in 1 constituency, and 11 have too few survey households to show.",
    );
  });

  it("counts a seat too uncertain to place as no data, as the map draws it", () => {
    const uncertain = { kind: "reported", category: TOO_UNCERTAIN, row: row("U", "-90.0") };
    const states = new Map([
      ["a", { kind: "reported", row: row("A", "10.0") }],
      ["b", { kind: "reported", row: row("B", "-5.0") }],
      ["u", uncertain],
      ["n", { kind: "no-data", row: null }],
    ]);
    expect(constituencySentence(states, options)).toBe("Households gain on average in 1 constituency and lose in 1, and 2 have too few survey households to show.");
  });

  it("says when the policy changes no incomes", () => {
    expect(constituencySentence(seats([row("A", "0"), row("B", "0")]), options)).toBe(
      "This policy does not change household incomes in any constituency in 2029-30.",
    );
    expect(constituencySentence(seats([row("A", "0")]), { ...options, several: true })).toBe(
      "These policies do not change household incomes in any constituency in 2029-30.",
    );
    // Some seats withheld: nothing is published to say there is no change
    expect(constituencySentence(seats([row("A", "0"), withheld]), options)).toBe(
      "No constituency shows a change large enough to publish for this policy in 2029-30.",
    );
  });

  it("says nothing without rows", () => {
    expect(constituencySentence(seats([null]), options)).toBeNull();
    expect(constituencySentence(null, options)).toBeNull();
  });
});
