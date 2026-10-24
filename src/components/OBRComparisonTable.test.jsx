import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import OBRComparisonTable from "./OBRComparisonTable";
import { DISPLAY_YEARS } from "../utils/displayYears";
import { geographyFetch } from "../test/geographyFixture";

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
    fireEvent.click(await screen.findByRole("button", { name: "Table" }));

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
    fireEvent.click(screen.getByRole("button", { name: "Table" }));
    fireEvent.click(basis);
    fireEvent.click(screen.getByRole("option", { name: /Post-behavioural/ }));
    const row = screen.getByRole("row", { name: /2 child limit repeal/ });
    const cells = within(row).getAllByRole("cell");
    const column2030 = 1 + 2 * DISPLAY_YEARS.indexOf(2030);
    expect(cells[column2030 + 1]).toHaveTextContent("−£3.5bn");
  });

  it("keeps the intro to one short sentence with the EFO link", async () => {
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
    const link = await screen.findByRole("link", { name: "EFO" });
    expect(link).toHaveAttribute(
      "href",
      "https://obr.uk/efo/economic-and-fiscal-outlook-november-2025/",
    );
    expect(container.querySelector(".comparison-description").textContent.replace(/\s+/g, " ").trim()).toBe(
      "PolicyEngine's static estimates against the OBR's November 2025 costings (EFO), £bn a year; positive values raise revenue.",
    );
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
    const chart = await screen.findByRole("button", { name: "Chart" });
    const table = screen.getByRole("button", { name: "Table" });
    expect(chart).toHaveAttribute("aria-pressed", "true");
    expect(container.querySelector(".obr-dumbbell")).not.toBeNull();
    expect(screen.queryByRole("table")).toBeNull();

    fireEvent.click(table);
    expect(table).toHaveAttribute("aria-pressed", "true");
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
    // Today's placeholder files stop at 2030-31
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

    fireEvent.click(screen.getByRole("button", { name: "Table" }));
    const row = screen.getByRole("row", { name: /2 child limit repeal/ });
    const cells = within(row).getAllByRole("cell");
    const column = 1 + 2 * DISPLAY_YEARS.indexOf(2031);
    expect(cells[column]).toHaveTextContent("—");
    expect(cells[column + 1]).toHaveTextContent("—");
  });
});

describe("before the OBR costs the measures", () => {
  it("says the comparison is not available and pairs nothing", async () => {
    vi.stubGlobal(
      "fetch",
      geographyFetch({
        // Last year's costings, under last year's ids
        "/data/obr_comparison.csv": OBR_COMPARISON,
        "/data/budgetary_impact.csv": [
          "reform_id,reform_name,year,value",
          "threshold_freeze_2031_32,Threshold freeze to 2031-32,2031,3.1",
        ].join("\n"),
      }),
    );
    render(
      <OBRComparisonTable selectedPolicies={["threshold_freeze_2031_32"]} />,
    );
    expect(
      await screen.findByText(
        "Not available until the OBR publishes its costings with the Budget on 28 October.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Table" })).not.toBeInTheDocument();
  });
});
