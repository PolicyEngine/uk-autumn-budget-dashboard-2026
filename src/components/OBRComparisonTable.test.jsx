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
  it("tables the year shown: PolicyEngine, both official bases and the difference", async () => {
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
      "Policy", "PolicyEngine", "Official static", "Official post-behavioural", "Difference",
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
    expect(plain(container.querySelector(".chart-description").textContent)).toBe(
      "For 2 child limit repeal, our static estimate is −£3.4bn and the official static costing is −£3.3bn.",
    );
    expect(container).not.toHaveTextContent(/accura|error|OBR\b/);
  });
});

const plain = (text) => text?.replace(/\u2060/g, "");

describe("a policy not in force in the year shown", () => {
  const catalogue = { measures: [{ id: "a" }, { id: "b" }, { id: "c" }], byId: new Map() };
  const windows = { a: { first: 2030, last: 2031 }, b: { first: 2026, last: 2026 }, c: { first: 2027, last: 2029 } };
  const source = (year, pe, obr) =>
    ["a", "b", "c"].map((id) => ({ reform_id: id, reform_name: id, year, policyengine_value: pe, obr_static: null, obr_behavioural: obr }));
  const statuses = (year, pe, obr) =>
    Object.fromEntries(comparisonRows(source(year, pe, obr), ["a", "b", "c"], year, true, catalogue, windows).map((row) => [row.id, row.status]));

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
      // Counted among those with an official figure: the chart draws C too
      "For 2 of the 3 policies with an official figure this year our static estimate is within £200m of the official static costing; the largest gap is Employer NI relief (−£6.2bn vs −£6.5bn).",
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
      "Difference: PolicyEngine minus the official static costing.",
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
      "Difference: PolicyEngine minus the official static costing.",
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
    "Difference: PolicyEngine minus the official post-behavioural costing.",
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
