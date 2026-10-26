import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import DistributionalChart from "./DistributionalChart";
import WaterfallChart from "./WaterfallChart";
import ChartMoreInfo from "./ChartMoreInfo";
import { POLICIES } from "../utils/policies";
import { legendMembership, zeroReason, inForceIn, inForceText } from "../utils/legendMembership";

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
    expect(zeroReason(EMPLOYER_NI, 2027)).toEqual({ kind: "employer", text: expect.stringMatching(/held fixed/) });
    const whd = POLICIES.find((policy) => policy.id === "warm_home_discount_top_up");
    expect(inForceIn(whd, 2026)).toBe(true);
    expect(inForceIn(whd, 2027)).toBe(false);
    expect(zeroReason(whd.id, 2027)).toEqual({ kind: "not_in_force", text: "winter 2026-27 only" });
    const freeze = POLICIES.find((policy) => policy.id === "threshold_freeze_2031_32");
    expect(inForceText(freeze)).toBe("in force from April 2031 (2031-32 only)");
    const fuelVat = POLICIES.find((policy) => policy.id === "road_fuel_vat_cut");
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
    expect(legendLabels(container).sort()).toEqual(POLICIES.map((policy) => policy.name).sort());
  });

  it("greys out the employer NI relief and says why under the chart", () => {
    const { container } = render(<Chart rawData={rows} selectedPolicies={ALL} selectedYear={2027} />);
    const item = [...container.querySelectorAll(".grouped-legend-groups li")].find(
      (node) => node.textContent === "Employer NI relief for under-25s",
    );
    expect(item.className).toContain("is-muted");
    // The card's own "More info" at its foot, closed until opened
    const moreInfo = container.querySelector(".chart-footer > .disclosure-in-card.chart-more-info");
    const toggle = within(moreInfo).getByRole("button", { name: "More info" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(container.querySelector("[data-zero-measure]")).toBeNull();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    within(moreInfo).getByText("3 measures are £0 for households in 2027-28:");
    // One disclosure per card: no second style
    expect(container.querySelectorAll(".disclosure")).toHaveLength(1);
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
    within(container).getByText("They are greyed out in the key and left out of the tooltip.");
  });
});

describe("ChartMoreInfo", () => {
  const members = [
    { id: EMPLOYER_NI, name: "Employer NI relief for under-25s", muted: true },
    { id: "fuel_duty_rise_deferral", name: "Fuel duty rises deferred", muted: false },
  ];

  it("says one measure in the singular, and lists only the £0 ones", () => {
    const { container } = render(<ChartMoreInfo members={members} year={2028} />);
    fireEvent.click(screen.getByRole("button", { name: "More info" }));
    screen.getByText("1 measure is £0 for households in 2028-29:");
    expect([...container.querySelectorAll("[data-zero-measure]")].map((node) => node.dataset.zeroMeasure)).toEqual([
      EMPLOYER_NI,
    ]);
  });

  it("renders nothing when every measure has an effect and there is nothing else to say", () => {
    const { container } = render(<ChartMoreInfo members={[members[1]]} year={2028} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("holds a card's other notes in the same panel", () => {
    render(
      <ChartMoreInfo members={members} year={2028}>
        <p>Single years of age rest on fewer households.</p>
      </ChartMoreInfo>,
    );
    expect(screen.getAllByRole("button")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "More info" }));
    screen.getByText("Single years of age rest on fewer households.");
    screen.getByText("1 measure is £0 for households in 2028-29:");
  });
});

describe("ChartMoreInfo's employer NI revenue", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("quotes the published revenue for the year shown", async () => {
    const csv = readFileSync(path.join(process.cwd(), "public", "data", "budgetary_impact.csv"), "utf8");
    const value = Number(
      csv.split("\n").find((line) => line.startsWith(`${EMPLOYER_NI},`) && line.split(",")[2] === "2027").split(",")[3],
    );
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: true, text: () => Promise.resolve(csv) })));
    render(
      <ChartMoreInfo
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
