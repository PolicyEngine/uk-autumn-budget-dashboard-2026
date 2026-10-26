import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render as renderReact, screen, within } from "@testing-library/react";
import DistributionalChart from "./DistributionalChart";
import WaterfallChart from "./WaterfallChart";
import ZeroMeasuresNote from "./ZeroMeasuresNote";
import { legendMembership, zeroReason, inForceIn, inForceText } from "../utils/legendMembership";
import { policyDetails } from "../utils/policyDetails";
import { buildMeasureCatalogue, MeasureCatalogueProvider } from "../utils/measureCatalogue";

// The household decile charts must list every selected measure in their
// legend, £0 ones too (greyed out, with the reason under the chart): a
// measure that is £0 for households by design, as the employer NI relief
// is, once disappeared from the key.

vi.mock("recharts", async () => {
  const actual = await vi.importActual("recharts");
  const { cloneElement } = await import("react");
  return {
    ...actual,
    ResponsiveContainer: ({ children }) => (
      <div style={{ width: 800, height: 480 }}>{cloneElement(children, { width: 800, height: 480 })}</div>
    ),
  };
});

const EMPLOYER_NI = "employer_ni_relief_under_25s";

/** A published CSV under public/data, as rows of strings. */
function publishedRows(file) {
  const [header, ...lines] = readFileSync(path.join(process.cwd(), "public", "data", file), "utf8")
    .trim()
    .split("\n");
  const keys = header.split(",");
  return lines.map((line) => Object.fromEntries(line.split(",").map((value, i) => [keys[i], value])));
}

// #185 on #104: a catalogue built from the flat files' own measures, as a
// manifest with every one approved and every artifact verified (test only)
const COMBINED = "autumn_budget_2026_combined";
const YEARS = [2026, 2027, 2028, 2029, 2030, 2031];
const budget = publishedRows("budgetary_impact.csv");
const ALL = [...new Set(budget.map((row) => row.reform_id))].filter((id) => id !== COMBINED);
const nameOf = (id) => budget.find((row) => row.reform_id === id).reform_name;
const entry = (extra) => ({ status: "approved", years: YEARS, unsupported_years: [], ...extra });
const catalogue = buildMeasureCatalogue({
  manifest: {
    measures: Object.fromEntries(ALL.map((id) => [id, entry({ name: nameOf(id), outputs_sha256: "a".repeat(64) })])),
    combined: { [COMBINED]: entry({ name: nameOf(COMBINED), measures: ALL, member_outputs_sha256: Object.fromEntries(ALL.map((id) => [id, "a".repeat(64)])) }) },
  },
  budgetary: budget,
  tablesByKey: Object.fromEntries([...ALL, COMBINED].map((id) => [id, { budgetary_impact: budget.filter((row) => row.reform_id === id) }])),
});
const render = (element) => renderReact(
  <MeasureCatalogueProvider catalogue={catalogue}>{element}</MeasureCatalogueProvider>,
);

const legendLabels = (container) =>
  [...container.querySelectorAll(".grouped-legend-groups li:not(.grouped-legend-net-inline) .grouped-legend-label")].map((node) => node.textContent);

describe("legendMembership", () => {
  it("lists every selected measure, in the legends' order, muted where it has no effect", () => {
    const members = legendMembership(catalogue, ALL, (id) => id !== EMPLOYER_NI);
    expect(members.map((member) => member.id).sort()).toEqual([...ALL].sort());
    expect(members.filter((member) => member.muted).map((member) => member.id)).toEqual([EMPLOYER_NI]);
  });

  it("leaves out measures that are not selected", () => {
    const members = legendMembership(catalogue, [EMPLOYER_NI], () => false);
    expect(members).toEqual([{ id: EMPLOYER_NI, key: `measure:${EMPLOYER_NI}`, name: "Employer NI relief for under-25s", muted: true }]);
  });

  it("gives the employer NI relief its incidence, and a measure out of force its window", () => {
    expect(zeroReason(catalogue.byId.get(EMPLOYER_NI), 2027)).toEqual({ kind: "employer", text: expect.stringMatching(/held fixed/) });
    const whd = policyDetails("warm_home_discount_top_up");
    expect(inForceIn(whd, 2026)).toBe(true);
    expect(inForceIn(whd, 2027)).toBe(false);
    expect(zeroReason(catalogue.byId.get("warm_home_discount_top_up"), 2027)).toEqual({ kind: "not_in_force", text: "winter 2026-27 only" });
    const freeze = policyDetails("threshold_freeze_2031_32");
    expect(inForceText(freeze)).toBe("in force from April 2031 (2031-32 only)");
    const fuelVat = policyDetails("road_fuel_vat_cut");
    expect(inForceText(fuelVat)).toBe("in force December 2026 to May 2027");
  });
});

describe.each([
  ["relative", DistributionalChart, "distributional_impact.csv"],
  ["absolute", WaterfallChart, "winners_losers.csv"],
])("%s impact by decile, published data", (_, Chart, file) => {
  const rows = publishedRows(file);

  it.each([2027, 2028, 2029, 2030, 2031])("lists all nine selected measures in %s", (year) => {
    const { container } = render(<Chart rawData={rows} selectedPolicies={ALL} selectedYear={year} />);
    expect(legendLabels(container).sort()).toEqual(ALL.map(nameOf).sort());
  });

  it("greys out the employer NI relief and says why under the chart", () => {
    const { container } = render(<Chart rawData={rows} selectedPolicies={ALL} selectedYear={2027} />);
    const item = [...container.querySelectorAll(".grouped-legend-groups li")].find(
      (node) => node.textContent === "Employer NI relief for under-25s",
    );
    expect(item.className).toContain("is-muted");
    // One short line, the detail closed until "More info" is opened
    const note = container.querySelector(".zero-measures-note");
    expect(note.querySelector(".note-line").textContent).toBe("3 measures are £0 for households in 2027-28. More info");
    const toggle = within(note).getByRole("button", { name: "More info" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(note.querySelector(".note-detail")).not.toBeVisible();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveTextContent("Less info");
    expect(note.querySelector(".note-detail")).toBeVisible();
    const employer = container.querySelector(`[data-zero-measure="${EMPLOYER_NI}"]`);
    expect(employer.textContent).toMatch(/Wages are held fixed/);
    expect(within(employer).getByRole("link", { name: "Public finances" })).toHaveAttribute(
      "href",
      "?tab=dashboard&sub=finances",
    );
    // The Warm Home Discount top-up is paid in 2026-27 only
    expect(container.querySelector('[data-zero-measure="warm_home_discount_top_up"]')).not.toBeNull();
    // A measure with an effect is neither greyed out nor in the note
    expect(container.querySelector('[data-zero-measure="fuel_duty_rise_deferral"]')).toBeNull();
    expect(screen.getAllByText("Fuel duty rises deferred")[0].closest("li").className).not.toContain("is-muted");
    within(container).getByText("Greyed out in the key and left out of the tooltip.");
  });
});

describe("ZeroMeasuresNote", () => {
  const members = [
    { id: EMPLOYER_NI, key: `measure:${EMPLOYER_NI}`, name: "Employer NI relief for under-25s", muted: true },
    { id: "fuel_duty_rise_deferral", key: "measure:fuel_duty_rise_deferral", name: "Fuel duty rises deferred", muted: false },
  ];

  it("says one measure in the singular, and lists only the £0 ones", () => {
    const { container } = render(<ZeroMeasuresNote members={members} year={2028} />);
    expect(container.querySelector(".note-line").textContent).toBe("1 measure is £0 for households in 2028-29. More info");
    expect([...container.querySelectorAll("[data-zero-measure]")].map((node) => node.dataset.zeroMeasure)).toEqual([
      EMPLOYER_NI,
    ]);
  });

  it("renders nothing when every measure has an effect", () => {
    const { container } = render(<ZeroMeasuresNote members={[members[1]]} year={2028} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("ZeroMeasuresNote's employer NI revenue", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("quotes the verified revenue for the year shown", async () => {
    // From the catalogue's verified budgetary_impact rows (#104), no fetch
    const value = Number(budget.find((row) => row.reform_id === EMPLOYER_NI && row.year === "2027").value);
    render(
      <ZeroMeasuresNote
        members={[{ id: EMPLOYER_NI, name: "Employer NI relief for under-25s", muted: true }]}
        year={2027}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "More info" }));
    expect(
      await screen.findByText(new RegExp(`about £${Math.abs(value).toFixed(1)}bn in 2027-28`)),
    ).toBeInTheDocument();
  });
});
