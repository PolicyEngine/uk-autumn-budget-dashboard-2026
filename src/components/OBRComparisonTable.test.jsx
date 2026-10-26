import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render as renderReact,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import OBRComparisonTable, { OBR_UNAVAILABLE, ObrComparisonFoot } from "./OBRComparisonTable";

// The chart/table choice: two icon buttons (ViewToggle)
const viewRadio = (label) => screen.getByRole("radio", { name: `Show as ${label.toLowerCase()}` });
const show = (label) => fireEvent.click(viewRadio(label));
import { DISPLAY_YEARS } from "../utils/displayYears";
import { geographyFetch } from "../test/geographyFixture";
import { buildMeasureCatalogue, MeasureCatalogueProvider } from "../utils/measureCatalogue";
import { parseDashboardCsv } from "../utils/loadDashboard";
import { ALPHA, BETA, YEAR, measureCatalogueFixture } from "../test/measureCatalogueFixture";

vi.mock("../utils/publication/flat", () => ({
  loadVerifiedFlatCsv: (name) => fetch(`/data/${name}`).then((response) => response.text()),
}));

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
  it("shows a PolicyEngine figure for a year the OBR didn't cost, with a dash for the OBR", async () => {
    vi.stubGlobal(
      "fetch",
      geographyFetch({
        "/data/obr_comparison.csv": OBR_COMPARISON,
        "/data/budgetary_impact.csv": BUDGETARY_IMPACT,
      }),
    );
    render(<OBRComparisonTable selectedPolicies={["two_child_limit"]} />);
    await screen.findByRole("radio", { name: "Show as chart" });
    show("Table");

    const row = screen.getByRole("row", { name: /2 child limit repeal/ });
    const cells = within(row).getAllByRole("cell");
    // The policy, then PolicyEngine and the OBR for each year shown
    const column = 1 + 2 * DISPLAY_YEARS.indexOf(2031);
    expect(cells[column]).toHaveTextContent("−£3.6bn");
    expect(cells[column + 1]).toHaveTextContent("—");
    // A year both costed still pairs them, on the static basis by default
    const column2030 = 1 + 2 * DISPLAY_YEARS.indexOf(2030);
    expect(cells[column2030]).toHaveTextContent("−£3.4bn");
    expect(cells[column2030 + 1]).toHaveTextContent("−£3.3bn");
  });

  it("starts on the static OBR basis and switches to post-behavioural", async () => {
    vi.stubGlobal(
      "fetch",
      geographyFetch({
        "/data/obr_comparison.csv": OBR_COMPARISON,
        "/data/budgetary_impact.csv": BUDGETARY_IMPACT,
      }),
    );
    render(<OBRComparisonTable selectedPolicies={["two_child_limit"]} />);
    const basis = await screen.findByRole("button", { name: "OBR basis: Static" });
    show("Table");
    fireEvent.click(basis);
    fireEvent.click(screen.getByRole("option", { name: /Post-behavioural/ }));
    const row = screen.getByRole("row", { name: /2 child limit repeal/ });
    const cells = within(row).getAllByRole("cell");
    const column2030 = 1 + 2 * DISPLAY_YEARS.indexOf(2030);
    expect(cells[column2030 + 1]).toHaveTextContent("−£3.5bn");
  });

  it("keeps the intro to one short sentence naming this year's OBR costings, from the sources config", async () => {
    vi.stubGlobal(
      "fetch",
      geographyFetch({
        "/data/obr_comparison.csv": OBR_COMPARISON,
        "/data/budgetary_impact.csv": BUDGETARY_IMPACT,
      }),
    );
    const { container } = render(
      <OBRComparisonTable selectedPolicies={["two_child_limit"]} />,
    );
    await waitFor(() => expect(container.querySelector(".comparison-description")).not.toBeNull());
    expect(container.querySelector(".comparison-description").textContent.replace(/\s+/g, " ").trim()).toBe(
      "PolicyEngine's static estimates against the OBR's Autumn Budget 2026 costings, £bn a year; positive values raise revenue.",
    );
    expect(container).not.toHaveTextContent("November 2025");
  });
});

describe("the OBR comparison's chart and table switch", () => {
  it("shows the chart by default and swaps it for the table", async () => {
    vi.stubGlobal(
      "fetch",
      geographyFetch({
        "/data/obr_comparison.csv": OBR_COMPARISON,
        "/data/budgetary_impact.csv": BUDGETARY_IMPACT,
      }),
    );
    const { container } = render(
      <OBRComparisonTable selectedPolicies={["two_child_limit"]} />,
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

describe("the OBR comparison at 2031-32", () => {
  it("plots PolicyEngine's 2031-32 figure on the dumbbell, with the OBR not yet published", async () => {
    vi.stubGlobal(
      "fetch",
      geographyFetch({
        "/data/obr_comparison.csv": OBR_COMPARISON,
        "/data/budgetary_impact.csv": BUDGETARY_IMPACT,
      }),
    );
    const { container } = render(
      <OBRComparisonTable
        selectedPolicies={["two_child_limit"]}
        selectedYear={2031}
      />,
    );
    await screen.findByRole("heading", {
      name: /PolicyEngine and OBR estimates, 2031-32/,
    });
    const row = await waitFor(() => {
      const found = container.querySelector(
        '.obr-dumbbell-row[data-policy="two_child_limit"]',
      );
      expect(found).not.toBeNull();
      return found;
    });
    expect(row.querySelectorAll(".obr-dumbbell-dot.pe")).toHaveLength(1);
    expect(row.querySelectorAll(".obr-dumbbell-dot.obr")).toHaveLength(0);
    expect(row).toHaveTextContent("−£3.6bn");
    expect(row).toHaveTextContent("OBR not yet published");
  });

  it("reads 'Not yet published' when no file covers 2031-32, never £0", async () => {
    artifactRows = artifactRows.filter((row) => Number(row.year) !== 2031);
    // A receipt-verified snapshot which stops at 2030-31
    vi.stubGlobal(
      "fetch",
      geographyFetch({
        "/data/obr_comparison.csv": OBR_COMPARISON,
        "/data/budgetary_impact.csv": BUDGETARY_IMPACT.split("\n")
          .slice(0, 2)
          .join("\n"),
      }),
    );
    const { container } = render(
      <OBRComparisonTable
        selectedPolicies={["two_child_limit"]}
        selectedYear={2031}
      />,
    );
    const empty = await screen.findByText("Not yet published", {
      selector: ".obr-dumbbell-empty",
    });
    expect(empty).toBeInTheDocument();
    expect(container.querySelector(".obr-dumbbell-dot")).toBeNull();
    expect(container.querySelector(".obr-dumbbell")).not.toHaveTextContent(
      "£0",
    );

    show("Table");
    const row = screen.getByRole("row", { name: /2 child limit repeal/ });
    const cells = within(row).getAllByRole("cell");
    const column = 1 + 2 * DISPLAY_YEARS.indexOf(2031);
    expect(cells[column]).toHaveTextContent("—");
    expect(cells[column + 1]).toHaveTextContent("—");
  });
});


it("orders OBR rows from the catalogue rather than CSV insertion order", async () => {
  const fixture = measureCatalogueFixture({ held: false });
  const catalogue = buildMeasureCatalogue({ ...fixture, tablesByKey: Object.fromEntries([ALPHA, BETA].map((id) => [id, { budgetary_impact: fixture.budgetary.filter((row) => row.reform_id === id) }])) });
  const csv = ["reform_id,reform_name,year,obr_static_value,obr_post_behavioural_value", `${ALPHA},CSV first,${YEAR},-1,-2`, `${BETA},CSV second,${YEAR},1,2`].join("\n");
  vi.stubGlobal("fetch", vi.fn(async () => new Response(csv)));
  const { container } = renderReact(<MeasureCatalogueProvider catalogue={catalogue}><OBRComparisonTable selectedPolicies={[ALPHA, BETA]} selectedYear={YEAR} /></MeasureCatalogueProvider>);
  await screen.findByRole("radio", { name: "Show as chart" });
  show("Table");
  expect([...container.querySelectorAll(".policy-name-cell")].map((node) => node.textContent)).toEqual(catalogue.displayable.map((measure) => measure.label));
  expect(catalogue.displayable.map((measure) => measure.id)).toEqual([BETA, ALPHA]);
});

describe("before the OBR costs the measures", () => {
  it("says the comparison is not available and pairs nothing", async () => {
    const catalogue = buildMeasureCatalogue(measureCatalogueFixture({ held: false }));
    vi.stubGlobal("fetch", geographyFetch({ "/data/obr_comparison.csv": OBR_COMPARISON }));
    renderReact(
      <MeasureCatalogueProvider catalogue={catalogue}>
        <OBRComparisonTable selectedPolicies={[ALPHA]} selectedYear={YEAR} />
      </MeasureCatalogueProvider>,
    );
    expect(await screen.findByText("The OBR has not costed the selected measures.")).toBeInTheDocument();
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
      <div data-testid="foot"><ObrComparisonFoot selectedPolicies={selectedPolicies} selectedYear={YEAR} /></div>
      <OBRComparisonTable selectedPolicies={selectedPolicies} selectedYear={YEAR} />
    </MeasureCatalogueProvider>,
  );

  it("offers the comparison when the OBR file costs a selected measure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(COSTED)));
    renderBoth([ALPHA]);
    const foot = screen.getByTestId("foot");
    expect(await within(foot).findByText("Compare with OBR estimates")).toBeInTheDocument();
  });

  it("shows nothing while no OBR file can be bound to the approved results", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("not bound"); }));
    renderBoth([ALPHA]);
    expect(await screen.findByText(/The OBR comparison is unavailable/)).toBeInTheDocument();
    expect(screen.getByTestId("foot")).toBeEmptyDOMElement();
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
      <MeasureCatalogueProvider catalogue={catalogue}><ObrComparisonFoot selectedPolicies={[]} selectedYear={YEAR} /></MeasureCatalogueProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
