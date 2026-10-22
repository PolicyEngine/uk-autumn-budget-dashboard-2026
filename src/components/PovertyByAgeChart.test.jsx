import { cloneElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import PovertyByAgeChart from "./PovertyByAgeChart";
import { resetGeographyCache } from "../hooks/useGeographyData";
import { geographyFetch } from "../test/geographyFixture";
import {
  MEASURE,
  POVERTY_CSV,
  TEST_POLICIES,
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

function serve(text = POVERTY_CSV) {
  vi.stubGlobal(
    "fetch",
    geographyFetch(text === null ? {} : { "/data/poverty_by_age.csv": text }),
  );
}

async function renderCard(props = {}) {
  render(
    <PovertyByAgeChart
      selectedPolicies={[MEASURE]}
      policies={TEST_POLICIES}
      {...props}
    />,
  );
  return screen.findByRole("region", { name: /^Poverty by age group/ });
}

const rateRow = (card, group) =>
  within(within(card).getByRole("table")).getByRole("row", {
    name: new RegExp(`^${group}`),
  });

const drawnBars = (card) =>
  card.querySelectorAll(".recharts-bar-rectangle path").length;

describe("poverty by age group", () => {
  it("shows each age group's rate without and with the measure, and the change", async () => {
    serve();
    const card = await renderCard();
    await within(card).findByRole("table");
    expect(
      within(card).getByRole("heading", { level: 3 }),
    ).toHaveTextContent("Poverty by age group, 2029-30");
    const children = rateRow(card, "Children \\(under 18\\)");
    expect(children).toHaveTextContent("18.40%");
    expect(children).toHaveTextContent("15.90%");
    expect(children).toHaveTextContent("−2.50pp");
    expect(rateRow(card, "Pensioners \\(65 and over\\)")).toHaveTextContent(
      "0.00pp",
    );
    const headers = within(card)
      .getAllByRole("columnheader")
      .map((header) => header.textContent);
    expect(headers).toEqual([
      "Age group",
      "Without this measure",
      "With this measure",
      "Change",
    ]);
    // Two bars for each of the three age groups
    expect(drawnBars(card)).toBe(6);
  });

  it("names the measure of poverty and the survey year of the ages", async () => {
    serve();
    const card = await renderCard();
    expect(
      within(card).getByText(/absolute poverty before housing costs/),
    ).toBeInTheDocument();
    expect(within(card).getByText(/2024 survey data/)).toBeInTheDocument();
  });

  it("shows the Budget as a whole when every measure is selected", async () => {
    serve();
    const card = await renderCard({
      selectedPolicies: TEST_POLICIES.map((policy) => policy.id),
    });
    await within(card).findByRole("table");
    expect(rateRow(card, "Children \\(under 18\\)")).toHaveTextContent("+1.20pp");
    expect(
      within(card).getByRole("columnheader", { name: "Without the Budget" }),
    ).toBeInTheDocument();
  });

  it("has its own year control", async () => {
    serve();
    const card = await renderCard();
    await within(card).findByRole("table");
    fireEvent.click(within(card).getByRole("button", { name: /^Year, / }));
    fireEvent.click(within(card).getByRole("option", { name: "2030-31" }));
    expect(
      within(card).getByRole("heading", { level: 3 }),
    ).toHaveTextContent("Poverty by age group, 2030-31");
    expect(rateRow(card, "Children \\(under 18\\)")).toHaveTextContent("−2.80pp");
  });

  it("says when a year is not yet published, and draws no bars", async () => {
    serve();
    const card = await renderCard({ initialYear: 2031 });
    expect(
      await within(card).findByText(
        "No poverty rates by age group are published for this measure in 2031-32.",
      ),
    ).toBeInTheDocument();
    expect(drawnBars(card)).toBe(0);
  });

  it("says the rates are not yet published when the file is missing", async () => {
    serve(null);
    const card = await renderCard();
    expect(
      await within(card).findByText(
        "Poverty rates by age group are not yet published.",
      ),
    ).toBeInTheDocument();
    expect(within(card).queryByRole("table")).toBeNull();
  });
});
