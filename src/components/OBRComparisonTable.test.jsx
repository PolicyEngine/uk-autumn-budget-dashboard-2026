import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render as renderReact,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import OBRComparisonTable, { OBR_CARD_TITLE, OBR_PENDING, OBR_UNAVAILABLE, ObrComparisonCard, comparisonRows, comparisonSentence } from "./OBRComparisonTable";

// The chart/table choice: two icon buttons (ViewToggle)
const viewRadio = (label) => screen.getByRole("radio", { name: `Show as ${label.toLowerCase()}` });
const show = (label) => fireEvent.click(viewRadio(label));
import { DISPLAY_YEARS } from "../utils/displayYears";
import { expectStandardDownloads } from "../test/downloadMenus";
import { geographyFetch } from "../test/geographyFixture";
import { buildMeasureCatalogue, MeasureCatalogueProvider } from "../utils/measureCatalogue";
import { parseDashboardCsv } from "../utils/loadDashboard";
import { ALPHA, BETA, YEAR, measureCatalogueFixture } from "../test/measureCatalogueFixture";
import { OBR_DEVIATION_STATEMENT } from "../utils/obrDeviationNotes";
import { POLICY_DETAILS } from "../utils/policyDetails";
import { downloadFile } from "../utils/downloadFile";

// The official costings as rows, from a CSV fixture; the loader's own checks
// are tested in utils/publication/officialCostings.test.js
vi.mock("../utils/publication/officialCostings", async (importOriginal) => {
  const actual = await importOriginal();
  const { parseDashboardCsv: parse } = await import("../utils/loadDashboard");
  const number = (value) => (value === "" || value == null ? null : Number(value));
  return {
    ...actual,
    loadOfficialCostings: () => fetch("/data/official_costings.csv").then(async (response) => {
      if (response.status === 404) throw new actual.OfficialCostingsPendingError();
      return parse(await response.text()).map((row) => ({
        reform_id: row.reform_id,
        year: Number(row.year),
        obr_static: number(row.obr_static_value),
        obr_behavioural: number(row.obr_post_behavioural_value),
        ...(row.not_comparable ? { not_comparable: row.not_comparable } : {}),
      }));
    }),
  };
});

vi.mock("../utils/downloadFile", () => ({
  downloadFile: vi.fn(),
  downloadSvg: vi.fn(),
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

// Invented figures: the OBR's costings stop at 2030-31; PolicyEngine's
// reach 2031-32
const OBR_COMPARISON = [
  "reform_id,reform_name,year,policyengine_value,obr_static_value,obr_post_behavioural_value",
  "two_child_limit,2 child limit repeal,2030,-3.4,-3.3,-3.5",
].join("\n");
const BUDGETARY_IMPACT = [
  "reform_id,reform_name,year,value",
  "two_child_limit,2 child limit repeal,2030,-3.4",
  "two_child_limit,2 child limit repeal,2031,-3.6",
 ].join("\n");

let artifactRows;
beforeEach(() => { artifactRows = parseDashboardCsv(BUDGETARY_IMPACT); });
const render = (element) => {
  const manifest = { measures: { two_child_limit: { name: "2 child limit repeal", status: "approved", years: DISPLAY_YEARS, unsupported_years: [] } }, combined: {} };
  const catalogue = buildMeasureCatalogue({ manifest, budgetary: artifactRows, tablesByKey: { two_child_limit: { budgetary_impact: artifactRows } } });
  return renderReact(<MeasureCatalogueProvider catalogue={catalogue}>{element}</MeasureCatalogueProvider>);
};

describe("the OBR comparison table", () => {
  it("tables the year shown: ours, both official bases and the difference", async () => {
    vi.stubGlobal(
      "fetch",
      geographyFetch({
        "/data/official_costings.csv": OBR_COMPARISON,
        "/data/budgetary_impact.csv": BUDGETARY_IMPACT,
      }),
    );
    render(<OBRComparisonTable selectedPolicies={["two_child_limit"]} selectedYear={2030} />);
    await screen.findByRole("radio", { name: "Show as chart" });
    show("Table");
    expect(screen.getAllByRole("columnheader").map((th) => th.textContent)).toEqual([
      "Policy", "Ours", "Official static", "Official post-behavioural", "Difference",
    ]);
    const cells = within(screen.getByRole("row", { name: /2 child limit repeal/ })).getAllByRole("cell");
    expect(cells.map((td) => td.textContent)).toEqual(["2 child limit repeal", "−£3.4bn", "−£3.3bn", "−£3.5bn", "−£100m"]);    // The table offers the same downloads as the chart
    expect(expectStandardDownloads(document.body)).toBe(1);
  });

  it("starts on the static official basis and switches to post-behavioural", async () => {
    vi.stubGlobal(
      "fetch",
      geographyFetch({
        "/data/official_costings.csv": OBR_COMPARISON,
        "/data/budgetary_impact.csv": BUDGETARY_IMPACT,
      }),
    );
    render(<OBRComparisonTable selectedPolicies={["two_child_limit"]} selectedYear={2030} />);
    await screen.findByRole("radio", { name: "Show as chart" });
    show("Table");
    const difference = () => within(screen.getByRole("row", { name: /2 child limit repeal/ })).getAllByRole("cell")[4];
    expect(difference()).toHaveTextContent("−£100m");
    fireEvent.click(screen.getByRole("button", { name: /Options/ }));
    fireEvent.click(screen.getByRole("radio", { name: "Post-behavioural" }));
    expect(difference()).toHaveTextContent("+£100m");
  });

  it("titles the card with the year and says in one sentence how the two compare", async () => {
    vi.stubGlobal(
      "fetch",
      geographyFetch({
        "/data/official_costings.csv": OBR_COMPARISON,
        "/data/budgetary_impact.csv": BUDGETARY_IMPACT,
      }),
    );
    const { container } = render(<OBRComparisonTable selectedPolicies={["two_child_limit"]} selectedYear={2030} />);
    expect(await screen.findByRole("heading", { name: "How our estimates compare with the official costings, 2030-31" })).toBeInTheDocument();
    // One sentence on the figures, one on why they differ: no more above the chart
    expect(plain(container.querySelector(".chart-description").textContent)).toBe(
      `For 2 child limit repeal, our static estimate is −£3.4bn and the official static costing is −£3.3bn. ${OBR_DEVIATION_STATEMENT}`,
    );
    expect(container).not.toHaveTextContent(/accura|error|OBR\b/);
  });
});

const plain = (text) => text?.replace(/\u2060/g, "");

describe("why our estimates differ from the official costings", () => {
  // A real measure, published as its card entry was written for, so its
  // note fits (deviationNoteFor); invented figures
  const ID = "savings_income_rates_up";
  const ENTRY = POLICY_DETAILS.find((entry) => entry.id === ID);
  const NOTE = "Most of the gap is in the 2029-30 base; timing affects only the first two years.";
  const BASIS = "Official: income tax, after behaviour. Ours: income tax, static.";
  const POINTS = [{ reason: "Timing", text: "Official counts Self Assessment tax a year later." }, { reason: "Coverage", text: "Our data tax too little savings interest." }];
  const renderNoted = ({ description = ENTRY.writtenFor, notes = { [ID]: NOTE }, bases = { [ID]: BASIS }, points = {} } = {}) => {
    const impact = ["reform_id,reform_name,year,value", `${ID},${ENTRY.name},2030,0.3`].join("\n");
    vi.stubGlobal(
      "fetch",
      geographyFetch({
        "/data/official_costings.csv": ["reform_id,reform_name,year,obr_static_value,obr_post_behavioural_value", `${ID},${ENTRY.name},2030,0.5,0.5`].join("\n"),
        "/data/budgetary_impact.csv": impact,
      }),
    );
    const rows = parseDashboardCsv(impact);
    const manifest = { measures: { [ID]: { name: ENTRY.name, description, status: "approved", years: DISPLAY_YEARS, unsupported_years: [] } }, combined: {} };
    const catalogue = buildMeasureCatalogue({ manifest, budgetary: rows, tablesByKey: { [ID]: { budgetary_impact: rows } } });
    return renderReact(
      <MeasureCatalogueProvider catalogue={catalogue}>
        <OBRComparisonTable selectedPolicies={[ID]} selectedYear={2030} notes={notes} bases={bases} points={points} panelBases={{}} />
      </MeasureCatalogueProvider>,
    );
  };
  const tableRow = () => screen.getAllByRole("row")[1];

  it("explains the selected policy in a panel beside the chart: figures, what each side counts, and tagged reasons (Vahid, 28 Oct)", async () => {
    const { container } = renderNoted({ points: { [ID]: POINTS } });
    await screen.findByRole("radio", { name: "Show as chart" });
    // No block of text under the chart
    expect(container.querySelector(".obr-deviation-notes, .obr-deviation-list")).toBeNull();
    const panel = screen.getByRole("complementary", { name: `Why ours differs: ${ENTRY.shortName}` });
    const figures = [...panel.querySelectorAll(".obr-panel-figures dd")].map((dd) => plain(dd.textContent));
    expect(figures).toEqual(["£300m", "£500m", "−£200m"]);
    const basis = [...panel.querySelectorAll(".obr-panel-basis > div")].map((div) => div.textContent);
    expect(basis).toEqual(["Official countsIncome tax, after behaviour", "We countIncome tax, static"]);
    const points = [...panel.querySelectorAll(".obr-panel-points li")].map((li) => li.textContent);
    expect(points).toEqual(["TimingOfficial counts Self Assessment tax a year later.", "CoverageOur data tax too little savings interest."]);
    // Fragments only: no point over about 12 words
    for (const text of [...panel.querySelectorAll(".obr-panel-points li > span:last-child, .obr-panel-basis dd")].map((node) => node.textContent)) {
      expect(text.split(/\s+/).length, text).toBeLessThanOrEqual(12);
    }
    expect(panel).not.toHaveTextContent(/PolicyEngine/);
    // The panel stays when the table replaces the chart
    show("Table");
    expect(screen.getByRole("complementary", { name: /^Why ours differs/ })).toBeInTheDocument();
  });

  it("makes rows read as clickable, and the chart and panel one figure with one mark (Vahid, 28 Oct)", async () => {
    const { container } = renderNoted();
    await screen.findByRole("radio", { name: "Show as chart" });
    expect(container.querySelector(".obr-dumbbell-hint")).toHaveTextContent("Select a policy to see why it differs");
    const row = container.querySelector(`[data-policy="${ID}"]`);
    // The selected row: its accent bar and a chevron in the accent colour
    expect(container.querySelector(".obr-dumbbell-accent")).toBeTruthy();
    expect(row.querySelector(".obr-dumbbell-chevron")).toHaveClass("is-selected");
    // The mark once, under the panel, not under the chart
    expect(container.querySelector(".obr-dumbbell-logo")).toBeNull();
    expect(container.querySelectorAll(".obr-figure-logo svg")).toHaveLength(1);
    const layout = container.querySelector(".obr-compare-layout");
    expect(layout.nextElementSibling).toHaveClass("obr-figure-logo");
  });

  it("selects a row for the panel by click, focus or the arrow keys, and marks it", async () => {
    const { container } = renderNoted();
    await screen.findByRole("radio", { name: "Show as chart" });
    const row = container.querySelector(`[data-policy="${ID}"]`);
    expect(row).toHaveAttribute("role", "button");
    // The first row with a gap is selected by default
    expect(row).toHaveAttribute("aria-pressed", "true");
    expect(row).toHaveClass("is-selected");
    fireEvent.click(row);
    expect(screen.getByRole("complementary", { name: `Why ours differs: ${ENTRY.shortName}` })).toBeInTheDocument();
  });

  it("keeps the chart's tooltip to the figures and a pointer to the panel, the reasons being in the panel", async () => {
    const { container } = renderNoted();
    await screen.findByRole("radio", { name: "Show as chart" });
    fireEvent.mouseEnter(container.querySelector(`[data-policy="${ID}"]`));
    expect([...document.querySelectorAll(".chart-tooltip-note")].map((line) => line.textContent)).toEqual(["Click for why they differ"]);
    expect(document.body).not.toHaveTextContent(NOTE);
  });

  it("shows a row's note on its Difference cell in the table, on hover and on focus", async () => {
    renderNoted();
    await screen.findByRole("radio", { name: "Show as chart" });
    show("Table");
    const difference = within(tableRow()).getAllByRole("cell")[4];
    // The figure itself is unchanged; the note is on hover, focus or a tap
    expect(difference).toHaveTextContent(/^−£200m$/);
    const anchor = difference.querySelector(".difference-note-anchor");
    fireEvent.mouseEnter(anchor);
    expect(screen.getByRole("tooltip")).toHaveTextContent(`${BASIS} ${NOTE}`);
    // What each side counts first, on its own line
    expect(screen.getByRole("tooltip").querySelector(".obr-basis-line").textContent).toBe(BASIS);
    fireEvent.mouseLeave(anchor);
    fireEvent.focus(anchor);
    expect(screen.getByRole("tooltip")).toHaveTextContent(`${BASIS} ${NOTE}`);
  });

  it("adds each note to the table's CSV download", async () => {
    renderNoted();
    await screen.findByRole("radio", { name: "Show as chart" });
    show("Table");
    vi.mocked(downloadFile).mockClear();
    fireEvent.click(document.querySelector(".chart-download-button:not([disabled])"));
    fireEvent.click(screen.getByRole("button", { name: "CSV Data" }));
    await waitFor(() => expect(downloadFile).toHaveBeenCalledTimes(1));
    const [content] = vi.mocked(downloadFile).mock.calls[0];
    // What each side counts, then why it differs, as their own columns
    expect(content).toContain("What each side counts,Why it differs");
    expect(content).toContain(BASIS);
    expect(content).toContain(NOTE);
    expect(content.indexOf(BASIS)).toBeLessThan(content.indexOf(NOTE));
  });

  it("says what each side counts for a policy with no note", async () => {
    renderNoted({ notes: {} });
    await screen.findByRole("radio", { name: "Show as chart" });
    const panel = screen.getByRole("complementary", { name: /^Why ours differs/ });
    expect(panel.querySelector(".obr-panel-basis")).toBeTruthy();
    expect(panel.querySelector(".obr-panel-points")).toBeNull();
  });

  it("keeps the statement, with no reasons, tooltip or anchor, for a policy with no note or line", async () => {
    const { container } = renderNoted({ notes: { other: NOTE, [ID]: "  " }, bases: { other: BASIS } });
    await screen.findByRole("radio", { name: "Show as chart" });
    expect(screen.getByText(OBR_DEVIATION_STATEMENT)).toBeInTheDocument();
    expect(document.querySelector(".obr-panel-basis, .obr-panel-points")).toBeNull();
    fireEvent.mouseEnter(container.querySelector(`[data-policy="${ID}"]`));
    expect([...document.querySelectorAll(".chart-tooltip-note")].map((line) => line.textContent)).toEqual(["Click for why they differ"]);
    show("Table");
    expect(document.querySelector(".difference-note-anchor")).toBeNull();
  });

  it("steps the note aside, keeping the statement, once the publication describes the measure differently", async () => {
    const { container } = renderNoted({ description: "Savings income tax rates rise by 2 points from April 2028." });
    await screen.findByRole("radio", { name: "Show as chart" });
    expect(screen.getByText(OBR_DEVIATION_STATEMENT)).toBeInTheDocument();
    expect(document.querySelector(".obr-panel-basis, .obr-panel-points")).toBeNull();
    expect(document.body).not.toHaveTextContent(NOTE);
    expect(document.body).not.toHaveTextContent(BASIS);
    fireEvent.mouseEnter(container.querySelector(`[data-policy="${ID}"]`));
    expect([...document.querySelectorAll(".chart-tooltip-note")].map((line) => line.textContent)).toEqual(["Click for why they differ"]);
    show("Table");
    expect(document.querySelector(".difference-note-anchor")).toBeNull();
  });
});

// #297's third mark
describe("ours on the official costing's basis", () => {
  // A real measure, so its catalogue entry fits; invented figures, on the
  // chart's £5m steps: ours -£25m net, -£40m on the official basis,
  // official -£45m
  const ID = "carers_allowance_earnings_taper";
  const ENTRY = POLICY_DETAILS.find((entry) => entry.id === ID);
  const LABEL = "Ours, on the official costing's basis";
  const renderBasis = ({ basis = [`${ID},${ENTRY.name},2030,-0.04`] } = {}) => {
    const impact = ["reform_id,reform_name,year,value", `${ID},${ENTRY.name},2030,-0.025`].join("\n");
    vi.stubGlobal(
      "fetch",
      geographyFetch({
        "/data/official_costings.csv": ["reform_id,reform_name,year,obr_static_value,obr_post_behavioural_value", `${ID},${ENTRY.name},2030,-0.045,-0.045`].join("\n"),
        "/data/budgetary_impact.csv": impact,
      }),
    );
    const rows = parseDashboardCsv(impact);
    const officialBasis = basis.length ? parseDashboardCsv(["reform_id,reform_name,year,value", ...basis].join("\n")) : undefined;
    const manifest = { measures: { [ID]: { name: ENTRY.name, description: ENTRY.writtenFor, status: "approved", years: DISPLAY_YEARS, unsupported_years: [] } }, combined: {} };
    const tables = { budgetary_impact: rows, ...(officialBasis ? { official_basis: officialBasis } : {}) };
    const catalogue = buildMeasureCatalogue({ manifest, budgetary: rows, tablesByKey: { [ID]: tables } });
    return renderReact(
      <MeasureCatalogueProvider catalogue={catalogue}>
        <OBRComparisonTable selectedPolicies={[ID]} selectedYear={2030} notes={{}} bases={{}} points={{}} panelBases={{}} />
      </MeasureCatalogueProvider>,
    );
  };
  const csvDownload = async () => {
    vi.mocked(downloadFile).mockClear();
    fireEvent.click(document.querySelector(".chart-download-button:not([disabled])"));
    fireEvent.click(screen.getByRole("button", { name: "CSV Data" }));
    await waitFor(() => expect(downloadFile).toHaveBeenCalledTimes(1));
    return vi.mocked(downloadFile).mock.calls[0][0];
  };

  it("draws it as a small teal ring on the row, named in the legend, beside our dot and the official ring", async () => {
    const { container } = renderBasis();
    await screen.findByRole("radio", { name: "Show as chart" });
    const row = container.querySelector(`[data-policy="${ID}"]`);
    expect(row.querySelectorAll(".obr-dumbbell-dot.pe, .obr-dumbbell-dot.basis, .obr-dumbbell-dot.obr")).toHaveLength(3);
    expect(row.querySelector(".obr-dumbbell-dot.basis")).toHaveAttribute("fill", "none");
    expect(within(screen.getByRole("list", { name: "Legend" })).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Ours (static)",
      LABEL,
      "Official costing (static)",
    ]);
    expect(row.getAttribute("aria-label")).toContain("ours −£25m (on the official costing's basis −£40m), official −£45m");
  });

  it("explains it in the panel: its figure, keyed with the ring, under ours, the official costing and the difference", async () => {
    renderBasis();
    await screen.findByRole("radio", { name: "Show as chart" });
    const panel = screen.getByRole("complementary", { name: `Why ours differs: ${ENTRY.shortName}` });
    expect([...panel.querySelectorAll(".obr-panel-figures dd")].map((dd) => plain(dd.textContent))).toEqual(["−£25m", "−£45m", "+£20m", "−£40m"]);
    const line = panel.querySelector(".obr-panel-figures > .is-basis");
    expect(line.querySelector("dt")).toHaveTextContent(LABEL);
    expect(line.querySelector(".obr-panel-key.is-basis")).toBeTruthy();
    expect(panel).not.toHaveTextContent(/PolicyEngine/);
  });

  it("shows all three in the tooltip and the table, and adds it to the CSV", async () => {
    const { container } = renderBasis();
    await screen.findByRole("radio", { name: "Show as chart" });
    fireEvent.mouseEnter(container.querySelector(`[data-policy="${ID}"]`));
    const tooltip = document.querySelector(".chart-tooltip");
    expect(tooltip).toHaveTextContent("Ours (static)−£25m");
    expect(tooltip).toHaveTextContent(`${LABEL}−£40m`);
    expect(tooltip).toHaveTextContent("Official costing (static)−£45m");
    show("Table");
    expect(screen.getByRole("columnheader", { name: LABEL })).toBeInTheDocument();
    const cells = within(screen.getAllByRole("row")[1]).getAllByRole("cell").map((cell) => plain(cell.textContent));
    expect(cells.slice(1, 3)).toEqual(["−£25m", "−£40m"]);
    const content = await csvDownload();
    expect(content).toContain("Ours on the official costing's basis, static (£bn)");
    expect(content).toContain("-0.04");
  });

  it("shows nothing of it, keeping two marks, for a measure with no official basis", async () => {
    const { container } = renderBasis({ basis: [] });
    await screen.findByRole("radio", { name: "Show as chart" });
    expect(container.querySelector(".obr-dumbbell-dot.basis")).toBeNull();
    expect(screen.getByRole("list", { name: "Legend" })).not.toHaveTextContent(LABEL);
    expect(screen.getByRole("complementary", { name: /^Why ours differs/ }).querySelector(".is-basis")).toBeNull();
    fireEvent.mouseEnter(container.querySelector(`[data-policy="${ID}"]`));
    expect(document.querySelector(".chart-tooltip")).not.toHaveTextContent(LABEL);
    show("Table");
    expect(screen.queryByRole("columnheader", { name: LABEL })).toBeNull();
    expect(await csvDownload()).not.toContain("official costing's basis");
  });
});

describe("a policy not in force in the year shown", () => {
  const catalogue = { measures: [{ id: "a" }, { id: "b" }, { id: "c" }], byId: new Map() };
  const windows = { a: { first: 2030, last: 2031 }, b: { first: 2026, last: 2026 }, c: { first: 2027, last: 2029 } };
  const source = (year, pe, obr) =>
    ["a", "b", "c"].map((id) => ({ reform_id: id, reform_name: id, year, policyengine_value: pe, obr_static: null, obr_behavioural: obr }));
  const statuses = (year, pe, obr) =>
    Object.fromEntries(comparisonRows(source(year, pe, obr), ["a", "b", "c"], year, true, catalogue, windows).map((row) => [row.id, row.status]));

  it("keeps the figures where ours on the official costing's basis has an effect", () => {
    const source = [{ reform_id: "a", reform_name: "a", year: 2026, policyengine_value: 0, policyengine_official_basis: -0.01, obr_static: null, obr_behavioural: null }];
    const [row] = comparisonRows(source, ["a"], 2026, true, catalogue, windows);
    expect(row.peOfficial).toBe(-0.01);
    expect(row.status).toBeNull();
  });

  it("says when it starts, ends or its one year, where neither side has an effect", () => {
    expect(statuses(2027, 0, null)).toEqual({ a: "Starts 2030-31", b: "2026-27 only", c: null });
    expect(statuses(2030, 0, 0)).toEqual({ a: null, b: "2026-27 only", c: "Ended 2029-30" });
  });

  it("keeps the figures where either side has an effect, or the policy is in force", () => {
    expect(statuses(2027, -0.03, null)).toEqual({ a: null, b: null, c: null });
    expect(statuses(2027, 0, -0.05)).toEqual({ a: null, b: null, c: null });
  });
});

describe("the comparison sentence", () => {
  const row = (name, pe, obr) => ({ id: name, name, pe, obr });
  it("counts the measures within £200m and names the largest gap", () => {
    expect(plain(comparisonSentence([row("Employer NI relief", -6.2, -6.5), row("A", 1, 1.1), row("B", 0.4, 0.4), row("C", 0.1, null)], "static"))).toBe(
      // Counted out of every policy the chart draws (C has no official figure)
      "For 2 of the 4 policies our static estimate is within £200m of the official static costing; the largest gap is Employer NI relief (−£6.2bn vs −£6.5bn); 1 has no comparable official figure this year.",
    );
  });
  it("leaves out the gap when every measure rounds equal", () => {
    expect(plain(comparisonSentence([row("A", 1, 1.01), row("B", 2, 2)], "post-behavioural"))).toBe(
      "For all 2 policies our static estimate is within £200m of the official post-behavioural costing.",
    );
    expect(comparisonSentence([row("A", 1, null)], "static")).toBeNull();
  });
});

describe("the OBR comparison's chart and table switch", () => {
  it("shows the chart by default and swaps it for the table", async () => {
    vi.stubGlobal(
      "fetch",
      geographyFetch({
        "/data/official_costings.csv": OBR_COMPARISON,
        "/data/budgetary_impact.csv": BUDGETARY_IMPACT,
      }),
    );
    const { container } = render(
      <OBRComparisonTable selectedPolicies={["two_child_limit"]} selectedYear={2030} />,
    );
    expect(await screen.findByRole("radio", { name: "Show as chart" })).toHaveAttribute("aria-checked", "true");
    expect(container.querySelector(".obr-dumbbell")).not.toBeNull();
    expect(screen.queryByRole("table")).toBeNull();

    show("Table");
    expect(viewRadio("Table")).toHaveAttribute("aria-checked", "true");
    expect(container.querySelector(".obr-dumbbell")).toBeNull();
    expect(screen.getByRole("table")).toBeInTheDocument();
  });
});

describe("the comparison at 2031-32", () => {
  it("says 2031-32 is not in the official costings instead of plotting it", async () => {
    vi.stubGlobal(
      "fetch",
      geographyFetch({
        "/data/official_costings.csv": OBR_COMPARISON,
        "/data/budgetary_impact.csv": BUDGETARY_IMPACT,
      }),
    );
    const { container } = render(<OBRComparisonTable selectedPolicies={["two_child_limit"]} selectedYear={2031} />);
    await screen.findByRole("heading", { name: /official costings, 2031-32/ });
    expect(container.querySelector(".obr-not-covered").textContent).toBe(
      "2031-32 is not in the official costings, which run to 2030-31.",
    );
    expect(container.querySelector(".obr-dumbbell-dot")).toBeNull();
    show("Table");
    const cells = within(screen.getByRole("row", { name: /2 child limit repeal/ })).getAllByRole("cell");
    expect(cells.map((td) => td.textContent)).toEqual(["2 child limit repeal", "−£3.6bn", "—", "—", "—"]);
    // A dash is muted and the note says why
    expect(cells.slice(2).every((td) => td.classList.contains("is-none"))).toBe(true);
    expect([...container.querySelectorAll(".comparison-table-note")].map((p) => p.textContent)).toEqual([
      "Difference: ours minus the official static costing.",
      "— where the official costings give no figure on that basis for the policy in 2031-32.",
    ]);
  });
});

// A year a reviewer classified not comparable (data_inputs/treasury
// mapping.csv not_comparable_years): the Pension Tax Allowance after it ends
describe("a year classified not comparable", () => {
  const REASON = "Allowance ends 5 April 2030; the figures after it fall outside the static model.";
  const COSTINGS = [
    "reform_id,reform_name,year,obr_static_value,obr_post_behavioural_value,not_comparable",
    "two_child_limit,2 child limit repeal,2030,,-3.5,",
    `two_child_limit,2 child limit repeal,2031,,,"${REASON}"`,
  ].join("\n");
  const costings = () => vi.stubGlobal(
    "fetch",
    geographyFetch({ "/data/official_costings.csv": COSTINGS, "/data/budgetary_impact.csv": BUDGETARY_IMPACT }),
  );

  it("says the year is not comparable, with the reason, not that it is missing", async () => {
    costings();
    const { container } = render(<OBRComparisonTable selectedPolicies={["two_child_limit"]} selectedYear={2031} />);
    await screen.findByRole("heading", { name: /official costings, 2031-32/ });
    expect(container.querySelector(".obr-not-covered").textContent).toBe(
      `2 child limit repeal: the official costing for 2031-32 is not comparable with our estimate. ${REASON}`,
    );
    expect(container).not.toHaveTextContent("is not in the official costings");
    show("Table");
    const cells = within(screen.getByRole("row", { name: /2 child limit repeal/ })).getAllByRole("cell");
    expect(cells.map((td) => td.textContent)).toEqual(["2 child limit repeal", "−£3.6bn", "Not comparable", "Not comparable", "—"]);
    // The reason on hover, and in the note under the table
    expect(cells[2]).toHaveAttribute("title", REASON);
    expect(cells[3]).toHaveAttribute("title", REASON);
    expect([...container.querySelectorAll(".comparison-table-note")].map((p) => p.textContent)).toEqual([
      "Difference: ours minus the official static costing.",
      `2 child limit repeal: the official costing for 2031-32 is not comparable with our estimate. ${REASON}`,
    ]);
  });

  it("compares the other years as usual", async () => {
    costings();
    const { container } = render(<OBRComparisonTable selectedPolicies={["two_child_limit"]} selectedYear={2030} />);
    await screen.findByRole("heading", { name: /official costings, 2030-31/ });
    expect(container).not.toHaveTextContent("Not comparable");
    show("Table");
    const cells = within(screen.getByRole("row", { name: /2 child limit repeal/ })).getAllByRole("cell");
    expect(cells.map((td) => td.textContent)).toEqual(["2 child limit repeal", "−£3.4bn", "—", "−£3.5bn", "+£100m"]);
  });
});

it("orders rows by the size of the official costing", async () => {
  const fixture = measureCatalogueFixture({ held: false });
  const catalogue = buildMeasureCatalogue({ ...fixture, tablesByKey: Object.fromEntries([ALPHA, BETA].map((id) => [id, { budgetary_impact: fixture.budgetary.filter((row) => row.reform_id === id) }])) });
  const csv = ["reform_id,reform_name,year,obr_static_value,obr_post_behavioural_value", `${ALPHA},CSV first,${YEAR},-5,-5`, `${BETA},CSV second,${YEAR},1,2`].join("\n");
  vi.stubGlobal("fetch", vi.fn(async () => new Response(csv)));
  const { container } = renderReact(<MeasureCatalogueProvider catalogue={catalogue}><OBRComparisonTable selectedPolicies={[ALPHA, BETA]} selectedYear={YEAR} /></MeasureCatalogueProvider>);
  await screen.findByRole("radio", { name: "Show as chart" });
  show("Table");
  const names = [...container.querySelectorAll(".policy-name-cell .mrl-name")].map((node) => node.textContent);
  expect(names).toEqual([ALPHA, BETA].map((id) => catalogue.byId.get(id).label ?? catalogue.byId.get(id).name));
});

// Budget 2026 publishes one Exchequer impact per measure, post-behavioural:
// with no static figure, no line may call the figure shown static
it("names the post-behavioural basis when the official costings give only that", async () => {
  const fixture = measureCatalogueFixture({ held: false });
  const catalogue = buildMeasureCatalogue({ ...fixture, tablesByKey: Object.fromEntries([ALPHA, BETA].map((id) => [id, { budgetary_impact: fixture.budgetary.filter((row) => row.reform_id === id) }])) });
  const csv = ["reform_id,reform_name,year,obr_static_value,obr_post_behavioural_value", `${ALPHA},Alpha,${YEAR},,-5`, `${BETA},Beta,${YEAR},,2`].join("\n");
  vi.stubGlobal("fetch", vi.fn(async () => new Response(csv)));
  const { container } = renderReact(<MeasureCatalogueProvider catalogue={catalogue}><OBRComparisonTable selectedPolicies={[ALPHA, BETA]} selectedYear={YEAR} /></MeasureCatalogueProvider>);
  await screen.findByRole("radio", { name: "Show as chart" });
  const sentence = container.querySelector(".chart-description").textContent;
  expect(sentence).toContain("the official post-behavioural costing");
  expect(sentence).not.toContain("official static");
  // No basis choice with only one basis published
  expect(screen.queryByText("Official basis")).not.toBeInTheDocument();
  show("Table");
  expect(container.querySelector(".comparison-table-note").textContent).toBe(
    "Difference: ours minus the official post-behavioural costing.",
  );
});

describe("before the OBR costs the measures", () => {
  it("says the comparison is not available and pairs nothing", async () => {
    const catalogue = buildMeasureCatalogue(measureCatalogueFixture({ held: false }));
    vi.stubGlobal("fetch", geographyFetch({ "/data/official_costings.csv": OBR_COMPARISON }));
    renderReact(
      <MeasureCatalogueProvider catalogue={catalogue}>
        <OBRComparisonTable selectedPolicies={[ALPHA]} selectedYear={YEAR} />
      </MeasureCatalogueProvider>,
    );
    expect(await screen.findByText(OBR_UNAVAILABLE)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Show as:/ })).not.toBeInTheDocument();
  });
});

// #128's foot under the budgetary chart: the comparison is offered only
// when a verified OBR file costs a selected measure
describe("the OBR comparison foot", () => {
  const fixture = measureCatalogueFixture({ held: false });
  const catalogue = buildMeasureCatalogue({ ...fixture, tablesByKey: Object.fromEntries([ALPHA, BETA].map((id) => [id, { budgetary_impact: fixture.budgetary.filter((row) => row.reform_id === id) }])) });
  const COSTED = ["reform_id,reform_name,year,obr_static_value,obr_post_behavioural_value", `${ALPHA},Alpha,${YEAR},-1,-2`].join("\n");
  // The table beside it settles from the same file, so once it shows its
  // state the foot has had its answer too
  const renderBoth = (selectedPolicies) => renderReact(
    <MeasureCatalogueProvider catalogue={catalogue}>
      <div data-testid="foot"><ObrComparisonCard selectedPolicies={selectedPolicies} selectedYear={YEAR} /></div>
      <OBRComparisonTable selectedPolicies={selectedPolicies} selectedYear={YEAR} />
    </MeasureCatalogueProvider>,
  );

  it("offers the comparison when the OBR file costs a selected measure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(COSTED)));
    renderBoth([ALPHA]);
    const foot = screen.getByTestId("foot");
    expect(await within(foot).findByRole("heading", { name: /How our estimates compare with the official costings/ })).toBeInTheDocument();
  });

  // The empty card: header and title, the one line, and nothing to act on
  const expectEmptyCard = (foot) => {
    expect(within(foot).getByRole("heading", { name: OBR_CARD_TITLE })).toBeInTheDocument();
    expect(within(foot).getByText(OBR_PENDING)).toBeInTheDocument();
    expect(within(foot).queryByRole("button")).toBeNull();
    expect(within(foot).queryByRole("radio")).toBeNull();
    expect(within(foot).queryByRole("table")).toBeNull();
    expect(foot.querySelector("svg circle, svg line")).toBeNull();
    expect(foot.textContent).not.toMatch(/£/);
  };

  it("offers the comparison, not the empty card, once a verified file is published", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(COSTED)));
    renderBoth([ALPHA]);
    const foot = screen.getByTestId("foot");
    expect(await within(foot).findByRole("radio", { name: "Show as chart" })).toBeInTheDocument();
    expect(within(foot).queryByText(OBR_PENDING)).toBeNull();
    expect(within(foot).getByRole("heading", { name: /official costings, \d{4}-\d{2}/ })).toBeInTheDocument();
  });

  it("shows the empty card, never the file, while no OBR file can be bound to the approved results", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("not bound"); }));
    renderBoth([ALPHA]);
    expect(await screen.findByText(/The comparison with the official costings is unavailable/)).toBeInTheDocument();
    expectEmptyCard(await screen.findByTestId("foot"));
  });

  it("shows the empty card until the official costings are published", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
    renderReact(
      <MeasureCatalogueProvider catalogue={catalogue}>
        <div data-testid="foot"><ObrComparisonCard selectedPolicies={[ALPHA]} selectedYear={YEAR} /></div>
      </MeasureCatalogueProvider>,
    );
    const foot = screen.getByTestId("foot");
    await within(foot).findByText(OBR_PENDING);
    expectEmptyCard(foot);
  });

  it("shows nothing when the OBR has costed none of the selected measures", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(COSTED)));
    renderBoth([BETA]);
    expect(await screen.findByText(OBR_UNAVAILABLE)).toBeInTheDocument();
    expect(screen.getByTestId("foot")).toBeEmptyDOMElement();
  });

  it("shows nothing for an empty selection, or for an OBR row with no figure", async () => {
    const blank = ["reform_id,reform_name,year,obr_static_value,obr_post_behavioural_value", `${ALPHA},Alpha,${YEAR},,`].join("\n");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(blank)));
    renderBoth([ALPHA]);
    expect(await screen.findByText(OBR_UNAVAILABLE)).toBeInTheDocument();
    expect(screen.getByTestId("foot")).toBeEmptyDOMElement();
    const { container } = renderReact(
      <MeasureCatalogueProvider catalogue={catalogue}><ObrComparisonCard selectedPolicies={[]} selectedYear={YEAR} /></MeasureCatalogueProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
