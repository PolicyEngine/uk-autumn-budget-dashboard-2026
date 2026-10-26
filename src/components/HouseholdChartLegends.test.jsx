import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import DistributionalChart from "./DistributionalChart";
import WaterfallChart from "./WaterfallChart";
import { POLICIES } from "../utils/policies";
import { legendMembership, zeroReason, inForceIn } from "../utils/legendMembership";

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

const ALL = POLICIES.map((policy) => policy.id);
const EMPLOYER_NI = "employer_ni_relief_under_25s";

/** A published CSV under public/data, as rows of strings. */
function publishedRows(file) {
  const [header, ...lines] = readFileSync(path.join(process.cwd(), "public", "data", file), "utf8")
    .trim()
    .split("\n");
  const keys = header.split(",");
  return lines.map((line) => Object.fromEntries(line.split(",").map((value, i) => [keys[i], value])));
}

const legendLabels = (container) =>
  [...container.querySelectorAll(".grouped-legend-groups li:not(.grouped-legend-net-inline) .grouped-legend-label")].map((node) => node.textContent);

describe("legendMembership", () => {
  it("lists every selected measure, in the legends' order, muted where it has no effect", () => {
    const members = legendMembership(ALL, (id) => id !== EMPLOYER_NI);
    expect(members.map((member) => member.id).sort()).toEqual([...ALL].sort());
    expect(members.filter((member) => member.muted).map((member) => member.id)).toEqual([EMPLOYER_NI]);
  });

  it("leaves out measures that are not selected", () => {
    const members = legendMembership([EMPLOYER_NI], () => false);
    expect(members).toEqual([{ id: EMPLOYER_NI, name: "Employer NI relief for under-25s", muted: true }]);
  });

  it("gives the employer NI relief its incidence, and a measure out of force its window", () => {
    expect(zeroReason(EMPLOYER_NI, 2027)).toMatch(/wages are held fixed/);
    const whd = POLICIES.find((policy) => policy.id === "warm_home_discount_top_up");
    expect(inForceIn(whd, 2026)).toBe(true);
    expect(inForceIn(whd, 2027)).toBe(false);
    expect(zeroReason(whd.id, 2027)).toBe("not in force that year");
  });
});

describe.each([
  ["relative", DistributionalChart, "distributional_impact.csv"],
  ["absolute", WaterfallChart, "winners_losers.csv"],
])("%s impact by decile, published data", (_, Chart, file) => {
  const rows = publishedRows(file);

  it.each([2027, 2028, 2029, 2030, 2031])("lists all nine selected measures in %s", (year) => {
    const { container } = render(<Chart rawData={rows} selectedPolicies={ALL} selectedYear={year} />);
    expect(legendLabels(container).sort()).toEqual(POLICIES.map((policy) => policy.name).sort());
  });

  it("greys out the employer NI relief and says why under the chart", () => {
    const { container } = render(<Chart rawData={rows} selectedPolicies={ALL} selectedYear={2027} />);
    const item = [...container.querySelectorAll(".grouped-legend-groups li")].find(
      (node) => node.textContent === "Employer NI relief for under-25s",
    );
    expect(item.className).toContain("is-muted");
    const note = container.querySelector(`[data-zero-measure="${EMPLOYER_NI}"]`);
    expect(note.textContent).toMatch(/wages are held fixed/);
    // The Warm Home Discount top-up is paid in 2026-27 only
    expect(container.querySelector('[data-zero-measure="warm_home_discount_top_up"]')).not.toBeNull();
    // A measure with an effect is neither greyed out nor in the note
    expect(container.querySelector('[data-zero-measure="fuel_duty_rise_deferral"]')).toBeNull();
    expect(screen.getAllByText("Fuel duty rises deferred")[0].closest("li").className).not.toContain("is-muted");
    within(container).getByText(/so greyed out in the key/);
  });
});
