import { cloneElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import DemographicChart from "./DemographicChart";
import { resetGeographyCache } from "../hooks/useGeographyData";
import { geographyFetch } from "../test/geographyFixture";
import {
  MEASURE,
  TEST_POLICIES,
  demographicsCsv,
} from "../test/demographicsFixture";

vi.mock("recharts", async () => {
  const actual = await vi.importActual("recharts");
  return {
    ...actual,
    // A fixed size, so the chart draws in jsdom
    ResponsiveContainer: ({ children }) => (
      <div style={{ width: 800, height: 500 }}>
        {cloneElement(children, { width: 800, height: 500 })}
      </div>
    ),
  };
});

vi.mock("../utils/downloadFile", () => ({
  downloadFile: vi.fn(),
  downloadSvg: vi.fn(),
}));

beforeEach(() => resetGeographyCache());
afterEach(() => vi.unstubAllGlobals());

function serve(text = demographicsCsv()) {
  vi.stubGlobal(
    "fetch",
    geographyFetch(text === null ? {} : { "/data/demographics.csv": text }),
  );
}

async function renderCard(props = {}) {
  render(
    <DemographicChart
      selectedPolicies={[MEASURE]}
      policies={TEST_POLICIES}
      {...props}
    />,
  );
  return screen.findByRole("region", { name: /^Results by group/ });
}

const figures = (card) => within(card).getByRole("table");

const figureRow = (card, group) =>
  within(figures(card)).getByRole("row", { name: new RegExp(`^${group}`) });

const drawnBars = (card) =>
  card.querySelectorAll(".recharts-bar-rectangle path").length;

function choose(card, control, option) {
  fireEvent.click(within(card).getByRole("button", { name: control }));
  fireEvent.click(within(card).getByRole("option", { name: option }));
}

describe("results by demographic group", () => {
  it("shows the measure's age groups in 2029-30, as a percentage of income", async () => {
    serve();
    const card = await renderCard();
    expect(
      within(card).getByRole("heading", { level: 3 }),
    ).toHaveTextContent("Results by group, 2029-30");
    await within(card).findByRole("table");
    expect(figureRow(card, "Children \\(under 18\\)")).toHaveTextContent("+1.23%");
    expect(figureRow(card, "Children \\(under 18\\)")).toHaveTextContent(
      "1% to 1.5%",
    );
    expect(figureRow(card, "Pensioners \\(65 and over\\)")).toHaveTextContent(
      "Approximate",
    );
    expect(drawnBars(card)).toBe(3);
  });

  it("says the groups use the survey's 2024 ages and statuses", async () => {
    serve();
    const card = await renderCard();
    expect(within(card).getByText(/2024 survey data/)).toBeInTheDocument();
  });

  it("switches between the groupings, showing withheld groups as not published", async () => {
    serve();
    const card = await renderCard();
    await within(card).findByRole("table");
    choose(card, /^Group people by/, "Age bands");
    expect(figureRow(card, "80 and over")).toHaveTextContent("Not published");
    expect(figureRow(card, "25 to 34")).toHaveTextContent("+0.4%");
    // Six bands drawn, and the withheld one labelled on the chart
    expect(drawnBars(card)).toBe(6);
    expect(
      card.querySelector(".recharts-wrapper").textContent,
    ).toContain("Not published");

    choose(card, /^Group people by/, "18 to 24-year-olds");
    expect(figureRow(card, "Not in work or education")).toHaveTextContent(
      "Not published",
    );
    expect(within(card).getByText(/not the ONS's NEET measure/)).toBeInTheDocument();

    choose(card, /^Group people by/, "Employment status");
    expect(figureRow(card, "Employees")).toHaveTextContent("+0.2%");
    // A group with no row says so, rather than showing a zero
    expect(figureRow(card, "Carers")).toHaveTextContent("No data");
  });

  it("offers employment status only when the file publishes it", async () => {
    serve(demographicsCsv({ levels: ["age_group", "age_band", "young_people"] }));
    const card = await renderCard();
    await within(card).findByRole("table");
    fireEvent.click(within(card).getByRole("button", { name: /^Group people by/ }));
    const options = within(card)
      .getAllByRole("option")
      .map((option) => option.textContent.replace("✓", ""));
    expect(options).toEqual(["Age groups", "Age bands", "18 to 24-year-olds"]);
  });

  it("shows £ a year when asked", async () => {
    serve();
    const card = await renderCard();
    await within(card).findByRole("table");
    choose(card, /^Show the change as/, "£ a year");
    expect(figureRow(card, "Children \\(under 18\\)")).toHaveTextContent("+£410");
  });

  it("has its own year control", async () => {
    serve();
    const card = await renderCard();
    await within(card).findByRole("table");
    choose(card, /^Year, /, "2030-31");
    expect(
      within(card).getByRole("heading", { level: 3 }),
    ).toHaveTextContent("Results by group, 2030-31");
    expect(figureRow(card, "Children \\(under 18\\)")).toHaveTextContent("+1.5%");
  });

  it("says when a year is not yet published, and draws no bars", async () => {
    serve();
    const card = await renderCard({ initialYear: 2031 });
    expect(
      await within(card).findByText(
        "No results by group are published for this measure in 2031-32.",
      ),
    ).toBeInTheDocument();
    expect(drawnBars(card)).toBe(0);
  });

  it("says the results are not yet published when the file is missing", async () => {
    serve(null);
    const card = await renderCard();
    expect(
      await within(card).findByText("Results by group are not yet published."),
    ).toBeInTheDocument();
    expect(within(card).queryByRole("table")).toBeNull();
  });

  it("shows the package when every measure is selected, and asks for one measure otherwise", async () => {
    serve();
    const card = await renderCard({
      selectedPolicies: TEST_POLICIES.map((policy) => policy.id),
    });
    await within(card).findByRole("table");
    expect(figureRow(card, "Children \\(under 18\\)")).toHaveTextContent("-0.4%");
    expect(within(card).getByText("All measures (the full package)")).toBeInTheDocument();
  });

  it("shows nothing for a selection that is neither one measure nor all", async () => {
    serve();
    const card = await renderCard({
      selectedPolicies: ["two_child_limit", "fuel_duty_freeze"],
      policies: [...TEST_POLICIES, { id: "rail_fares_freeze", name: "Rail fares freeze" }],
    });
    expect(
      await within(card).findByText(
        "Results by group are shown for one measure at a time, or for all measures together.",
      ),
    ).toBeInTheDocument();
    expect(within(card).queryByRole("table")).toBeNull();
  });
});
