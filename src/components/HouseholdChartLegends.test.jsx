import { readFileSync } from "node:fs";
import path from "node:path";
import fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render as renderReact, screen, within } from "@testing-library/react";
import DistributionalChart from "./DistributionalChart";
import WaterfallChart from "./WaterfallChart";
import ChartMoreInfo, { ABOUT_THIS_CHART, withoutMethodology } from "./ChartMoreInfo";
import { infoParts } from "./InfoSections";
import { GLOSSARY } from "./methodology/glossary";
import { legendMembership, zeroReason, inForceIn, inForceShort, inForceText } from "../utils/legendMembership";
import { POLICY_DETAILS, shortNameOf } from "../utils/policyDetails";
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
// A measure's card details, and the description the publication carries
// for it (reforms.py's, which each entry records as `writtenFor`)
const detailsOf = (id) => POLICY_DETAILS.find((policy) => policy.id === id);
const catalogue = buildMeasureCatalogue({
  manifest: {
    measures: Object.fromEntries(ALL.map((id) => [id, entry({ name: nameOf(id), description: detailsOf(id)?.writtenFor, outputs_sha256: "a".repeat(64) })])),
    combined: { [COMBINED]: entry({ name: nameOf(COMBINED), measures: ALL, member_outputs_sha256: Object.fromEntries(ALL.map((id) => [id, "a".repeat(64)])) }) },
  },
  budgetary: budget,
  tablesByKey: Object.fromEntries([...ALL, COMBINED].map((id) => [id, { budgetary_impact: budget.filter((row) => row.reform_id === id) }])),
});
const render = (element) => renderReact(
  <MeasureCatalogueProvider catalogue={catalogue}>{element}</MeasureCatalogueProvider>,
);

// The measure key's chips (MeasureKey): one per measure, its full name in
// the title; muted ones folded under "with no effect" but still listed
const keyChips = (container) => [...container.querySelectorAll(".measure-key [data-measure]")];
const legendLabels = (container) => keyChips(container).map((node) => node.title);

describe("legendMembership", () => {
  it("lists every selected measure, in the legends' order, muted where it has no effect", () => {
    const members = legendMembership(catalogue, ALL, (id) => id !== EMPLOYER_NI);
    expect(members.map((member) => member.id).sort()).toEqual([...ALL].sort());
    expect(members.filter((member) => member.muted).map((member) => member.id)).toEqual([EMPLOYER_NI]);
  });

  it("leaves out measures that are not selected", () => {
    const members = legendMembership(catalogue, [EMPLOYER_NI], () => false);
    expect(members).toEqual([
      { id: EMPLOYER_NI, key: `measure:${EMPLOYER_NI}`, name: "Employer NI relief for under-25s", description: detailsOf(EMPLOYER_NI).writtenFor, muted: true },
    ]);
  });

  it("gives the employer NI relief its incidence, and a measure out of force its window", () => {
    expect(zeroReason(catalogue.byId.get(EMPLOYER_NI), 2027)).toEqual({ kind: "employer", text: expect.stringMatching(/held fixed/) });
    const whd = detailsOf("warm_home_discount_top_up");
    expect(inForceIn(whd, 2026)).toBe(true);
    expect(inForceIn(whd, 2027)).toBe(false);
    expect(zeroReason(catalogue.byId.get("warm_home_discount_top_up"), 2027)).toEqual({ kind: "not_in_force", text: "winter 2026-27 only" });
    const freeze = detailsOf("threshold_freeze_2031_32");
    expect(inForceText(freeze)).toBe("in force from April 2031 (2031-32 only)");
    const fuelVat = detailsOf("road_fuel_vat_cut");
    expect(inForceText(fuelVat)).toBe("in force December 2026 to May 2027");
    // Short, for the lists of policies with no effect
    expect(inForceShort(freeze)).toBe("from April 2031");
    expect(inForceShort(fuelVat)).toBe("December 2026 to May 2027");
    expect(inForceShort(whd)).toBe("winter 2026-27");
  });

  it("gives a past event's £0 measure no reason written for this Budget's measures", () => {
    // #107: a past event's employer measure (Autumn Budget 2024 raised
    // employer NI) must not read as this Budget's relief, and this Budget's
    // dates never say when a past measure is in force
    for (const id of [EMPLOYER_NI, "warm_home_discount_top_up"]) {
      expect(zeroReason(catalogue.byId.get(id), 2027, { pastEvent: true })).toEqual({ kind: "none", text: "no change for the households shown" });
    }
  });

  it("never calls a measure out of force from details written for another description of it", () => {
    // Changed since its entry was written (on Budget day, say): its window
    // may no longer hold, so it is not used
    const changed = { ...catalogue.byId.get("warm_home_discount_top_up"), description: "The Warm Home Discount rises for two winters." };
    expect(zeroReason(changed, 2027)).toEqual({ kind: "none", text: "no change for the households shown" });
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

  it("says so in place of an empty plot when no selected measure changes a household", () => {
    render(<Chart rawData={rows} selectedPolicies={[EMPLOYER_NI]} selectedYear={2027} />);
    expect(screen.getByRole("status")).toHaveTextContent("None of the selected policies changes household incomes in 2027-28.");
    expect(document.querySelector(".recharts-wrapper")).toBeNull();
    // Said once: the card's sentence does not add "almost no change" at both ends
    expect(document.querySelector(".chart-description").textContent).not.toMatch(/almost no change/);
  });

  it("greys out the employer NI relief and says why under the chart", () => {
    const { container } = render(<Chart rawData={rows} selectedPolicies={ALL} selectedYear={2027} />);
    const item = keyChips(container).find((node) => node.title === "Employer NI relief for under-25s");
    expect(item.className).toContain("is-muted");
    // Folded away until "+3 with no effect" is opened
    const more = within(container).getByRole("button", { name: "+3 with no effect" });
    expect(item.closest("ul")).not.toBeVisible();
    fireEvent.click(more);
    expect(more).toHaveAttribute("aria-expanded", "true");
    expect(item.closest("ul")).toBeVisible();
    // The card's own "About this chart" at its foot, closed until opened
    const moreInfo = container.querySelector(".chart-footer > .disclosure-in-card.chart-more-info");
    const toggle = within(moreInfo).getByRole("button", { name: "About this chart" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(container.querySelector("[data-zero-measure]")).toBeNull();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    within(moreInfo).getByText("No effect on household incomes in 2027-28:");
    // One disclosure per card: no second style
    expect(container.querySelectorAll(".disclosure")).toHaveLength(1);
    const employer = container.querySelector(`[data-zero-measure="${EMPLOYER_NI}"]`);
    expect(employer.textContent).toMatch(/^Employer National Insurance relief, under-25s — employers pay less National Insurance.*wages are held fixed in the model$/);
    // One bullet per policy, under the lead
    expect(employer.closest("ul").classList.contains("info-sublist")).toBe(true);
    expect(employer.closest("ul").children).toHaveLength(3);
    expect(within(employer).getByRole("link", { name: "Public finances" })).toHaveAttribute(
      "href",
      "?tab=dashboard&sub=finances",
    );
    // The Warm Home Discount top-up is paid in 2026-27 only; the threshold
    // freeze is from 2031: when each is in force, short
    expect(container.querySelector('[data-zero-measure="warm_home_discount_top_up"]')).toHaveTextContent("Warm Home Discount top-up — winter 2026-27");
    expect(container.querySelector('[data-zero-measure="threshold_freeze_2031_32"]')).toHaveTextContent("Threshold freeze — from April 2031");
    // A measure with an effect is neither greyed out nor in the note
    expect(container.querySelector('[data-zero-measure="fuel_duty_rise_deferral"]')).toBeNull();
    expect(keyChips(container).find((node) => node.title === "Fuel duty rises deferred").className).not.toContain("is-muted");
    // Closed, the title and a preview of what is inside; the £0 measures are a caveat
    expect(moreInfo.querySelector(".disclosure-preview")).toHaveTextContent("How it's calculated · Caveats");
    expect(moreInfo.querySelector(".disclosure-chip")).toBeNull();
  });

  it("on a past event's page, says only that a £0 measure changes no household shown", () => {
    const { container } = render(<Chart rawData={rows} selectedPolicies={ALL} selectedYear={2027} pastEvent />);
    const moreInfo = container.querySelector(".chart-footer > .disclosure-in-card.chart-more-info");
    fireEvent.click(within(moreInfo).getByRole("button", { name: ABOUT_THIS_CHART }));
    const zero = [...container.querySelectorAll("[data-zero-measure]")];
    // The same £0 measures as on this Budget's page, each with no reason of its own
    expect(zero.map((node) => node.dataset.zeroMeasure)).toEqual(expect.arrayContaining([EMPLOYER_NI, "warm_home_discount_top_up"]));
    // Each named as the past event's catalogue names it (main's line: "name — reason")
    for (const node of zero) expect(node.textContent).toBe(`${catalogue.byId.get(node.dataset.zeroMeasure).label} — no change for the households shown`);
    // Not this Budget's short names (policyDetails), which one of them has
    expect(zero.some((node) => !node.textContent.startsWith(`${shortNameOf(catalogue.byId.get(node.dataset.zeroMeasure))} —`))).toBe(true);
    expect(moreInfo.textContent).not.toMatch(/[Ee]mployers pay less|held fixed|only|from (January|February|March|April|May|June|July|August|September|October|November|December)/);
    expect(within(moreInfo).queryByRole("link", { name: "Public finances" })).toBeNull();
  });

  it("links to Methodology on this Budget's page only: a past event's page has none", () => {
    const linksIn = (props) => {
      const view = render(<Chart rawData={rows} selectedPolicies={ALL} selectedYear={2027} {...props} />);
      const moreInfo = view.container.querySelector(".chart-footer > .disclosure-in-card.chart-more-info");
      fireEvent.click(within(moreInfo).getByRole("button", { name: ABOUT_THIS_CHART }));
      const links = [...moreInfo.querySelectorAll("a.method-link")].map((link) => link.getAttribute("href"));
      // What it says of the chart's calculation is the same on both
      const how = [...moreInfo.querySelectorAll(".info-section")].find((section) => section.querySelector(".info-heading")?.textContent === "How it's calculated")?.querySelector(".info-body").textContent;
      view.unmount();
      return { links, how };
    };
    const own = linksIn({});
    expect(own.links).toEqual([expect.stringMatching(/^\?tab=methodology#/)]);
    const past = linksIn({ pastEvent: true });
    expect(past.links).toEqual([]);
    expect(past.how).toBe(own.how);
    expect(own.how).toBeTruthy();
  });
});

describe("ChartMoreInfo", () => {
  const members = [
    { id: EMPLOYER_NI, key: `measure:${EMPLOYER_NI}`, name: "Employer NI relief for under-25s", muted: true },
    { id: "fuel_duty_rise_deferral", key: "measure:fuel_duty_rise_deferral", name: "Fuel duty rises deferred", muted: false },
  ];

  it("says one £0 policy on one line, and lists only the £0 ones", () => {
    const { container } = render(<ChartMoreInfo members={members} year={2028} />);
    fireEvent.click(screen.getByRole("button", { name: "About this chart" }));
    expect(container.querySelector(".zero-measures")).toHaveTextContent(/^No effect on household incomes in 2028-29: Employer NI relief for under-25s — employers pay less/);
    expect(container.querySelector(".info-sublist")).toBeNull();
    expect([...container.querySelectorAll("[data-zero-measure]")].map((node) => node.dataset.zeroMeasure)).toEqual([
      EMPLOYER_NI,
    ]);
  });

  it("renders nothing when every measure has an effect and there is nothing else to say", () => {
    const { container } = render(<ChartMoreInfo members={[members[1]]} year={2028} />);
    expect(container).toBeEmptyDOMElement();
  });

  const FULL_INFO = {
    shows: "What the card shows.",
    how: ["One step."],
    definitions: [{ term: "A card's own term", meaning: "Its meaning here." }, { ref: "netIncome" }],
    caveats: ["One caveat."],
    sources: [{ label: "One source" }],
    method: { anchor: "by-income", label: "How we group households" },
  };

  it("on a past event's card, keeps every part but its links to Methodology", () => {
    const own = render(<ChartMoreInfo info={FULL_INFO} />);
    fireEvent.click(screen.getByRole("button", { name: ABOUT_THIS_CHART }));
    expect([...own.container.querySelectorAll("a.method-link")].map((link) => link.textContent.trim())).toEqual(["How we group households", GLOSSARY.netIncome.term]);
    own.unmount();
    const { container } = render(<ChartMoreInfo info={FULL_INFO} pastEvent />);
    fireEvent.click(screen.getByRole("button", { name: ABOUT_THIS_CHART }));
    expect(container.querySelector("a.method-link")).toBeNull();
    expect(container.textContent).not.toMatch(/[Ii]n Methodology|How we group households/);
    expect(container.querySelector(".info-method")).toBeNull();
    for (const text of ["What the card shows.", "One step.", "A card's own term", "Its meaning here.", "One caveat.", "One source"]) {
      expect(container.textContent).toContain(text);
    }
  });

  it("on a past event's card, renders nothing when a Methodology link was all it had", () => {
    expect(render(<ChartMoreInfo info={{ method: FULL_INFO.method }} />).container).not.toBeEmptyDOMElement();
    const { container } = render(<ChartMoreInfo info={{ method: FULL_INFO.method, definitions: [{ ref: "netIncome" }] }} pastEvent />);
    expect(container).toBeEmptyDOMElement();
  });

  it("withoutMethodology drops exactly the shared terms and the section link, for any info", () => {
    const text = fc.string({ minLength: 1, maxLength: 8 });
    const definition = fc.oneof(
      fc.record({ term: text, meaning: text }),
      fc.record({ ref: fc.constantFrom(...Object.keys(GLOSSARY), "notATerm") }),
    );
    const info = fc.record(
      {
        shows: text,
        how: fc.array(text, { maxLength: 3 }),
        definitions: fc.array(definition, { maxLength: 4 }),
        caveats: fc.array(text, { maxLength: 3 }),
        sources: fc.array(fc.record({ label: text }), { maxLength: 2 }),
        method: fc.record({ anchor: text, label: text }),
      },
      { requiredKeys: [] },
    );
    fc.assert(
      fc.property(info, (original) => {
        const before = structuredClone(original);
        const past = withoutMethodology(original);
        expect(original).toEqual(before);
        expect(infoParts(past)).toEqual({ ...infoParts(original), shared: [], method: null });
        expect(withoutMethodology(past)).toEqual(past);
      }),
      { numRuns: 300 },
    );
  });

  it("holds a card's other notes in the same panel", () => {
    render(
      <ChartMoreInfo members={members} year={2028}>
        <p>Single years of age rest on fewer households.</p>
      </ChartMoreInfo>,
    );
    expect(screen.getAllByRole("button")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "About this chart" }));
    screen.getByText("Single years of age rest on fewer households.");
    screen.getByText(/^No effect on household incomes in 2028-29:/);
  });
});

describe("ChartMoreInfo's employer NI revenue", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("quotes the verified revenue for the year shown", async () => {
    // From the catalogue's verified budgetary_impact rows (#104), no fetch
    const value = Number(budget.find((row) => row.reform_id === EMPLOYER_NI && row.year === "2027").value);
    render(
      <ChartMoreInfo
        members={[{ id: EMPLOYER_NI, name: "Employer NI relief for under-25s", muted: true }]}
        year={2027}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "About this chart" }));
    expect(
      await screen.findByText(new RegExp(`about £${Math.abs(value).toFixed(1)}bn in 2027-28`)),
    ).toBeInTheDocument();
  });
});
