import { cloneElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { buildMeasureCatalogue, MeasureCatalogueProvider } from "../utils/measureCatalogue";
import LifecycleCalculator from "./LifecycleCalculator";
import LifecycleAbout from "./LifecycleAbout";
import PersonalImpactResults from "./PersonalImpactResults";

vi.mock("recharts", async () => {
  const actual = await vi.importActual("recharts");
  return {
    ...actual,
    ResponsiveContainer: ({ children }) => <div>{cloneElement(children, { width: 800, height: 400 })}</div>,
  };
});

const catalogue = buildMeasureCatalogue({ budgetary: [
  { reform_id: "ab2026_mock_alpha", reform_name: "Mock alpha", reform_description: "Alpha public explanation.", value: "-100" },
  { reform_id: "ab2026_mock_beta", reform_name: "Mock beta", reform_description: "Beta public explanation.", value: "100" },
] });
const alpha = catalogue.byId.get("ab2026_mock_alpha");
const beta = catalogue.byId.get("ab2026_mock_beta");
const apiRow = {
  age: 22, year: 2026, gross_income: 30000, income_tax: 3000,
  national_insurance: 1000, student_loan_payment: 0,
  student_loan_debt_remaining: 0, baseline_net_income: 26000,
  impact_ab2026_mock_alpha: 10,
};
const wrap = (children) => <MeasureCatalogueProvider catalogue={catalogue}>{children}</MeasureCatalogueProvider>;
const showResults = () => {
  if (screen.queryByRole("button", { name: "Edit details" })) fireEvent.click(screen.getByRole("button", { name: "Edit details" }));
  while (screen.queryByRole("button", { name: "Next" })) fireEvent.click(screen.getByRole("button", { name: "Next" }));
  fireEvent.click(screen.getByRole("button", { name: "See results" }));
};

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_LIFECYCLE_API_URL", "https://example.test/api/lifecycle");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [apiRow] }) }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("catalogue measures in the personal impact view", () => {
  it("shows published descriptions and uses the same catalogue colours", () => {
    const { container } = render(wrap(<LifecycleAbout />));
    expect(screen.getByText(alpha.label)).toBeInTheDocument();
    expect(screen.getByText(beta.label)).toBeInTheDocument();
    expect(container.textContent).toContain(alpha.description);
    expect(container.textContent).toContain(beta.description);
    expect([...container.querySelectorAll(".about-swatch")].map((swatch) => swatch.style.background))
      .toEqual([beta, alpha].map((measure) => {
        const span = document.createElement("span"); span.style.background = measure.color; return span.style.background;
      }));
  });

  it("keeps measures without a costing in their own group", () => {
    const neutral = buildMeasureCatalogue({ budgetary: [
      { reform_id: "uncosted_measure", reform_name: "Uncosted measure", value: "" },
    ] });
    render(<MeasureCatalogueProvider catalogue={neutral}><LifecycleAbout /></MeasureCatalogueProvider>);
    expect(screen.getByText("Other measures")).toBeInTheDocument();
    expect(screen.queryByText("Cost revenue")).not.toBeInTheDocument();
    expect(screen.queryByText("Raise revenue")).not.toBeInTheDocument();
  });

  it("keeps supported bars but withholds the total and names unsupported measures", async () => {
    const { container } = render(wrap(<LifecycleCalculator selectedPolicies={[alpha.id, beta.id]} />));
    showResults();
    await waitFor(() => expect(container.querySelectorAll(".age-group rect")).toHaveLength(1));
    expect(screen.getByText(`Not modelled: ${beta.label}.`)).toBeInTheDocument();
    expect(screen.getByText("The total for the selected measures is unavailable.")).toBeInTheDocument();
    expect(container.querySelector(".lifecycle-summary")).not.toBeVisible();
    expect(container.querySelector(".age-group rect")).toHaveAttribute("fill", alpha.color);
    expect(container.querySelector(".grouped-legend-net")).toBeNull();
    expect(container.querySelector(".net-line")).not.toHaveAttribute("d");
  });

  it("renders every supported unfamiliar measure and its public detail", async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => ({ data: [{ ...apiRow, impact_ab2026_mock_beta: -4 }] }) });
    const { container } = render(wrap(<LifecycleCalculator selectedPolicies={[alpha.id, beta.id]} />));
    showResults();
    await waitFor(() => expect(container.querySelectorAll(".age-group rect")).toHaveLength(2));
    expect(container.querySelector(".lifecycle-summary")).toBeVisible();
    expect(container.querySelector(".lifecycle-summary")).toHaveTextContent("+£6");
    expect([...container.querySelectorAll(".age-group rect")].map((bar) => bar.getAttribute("fill")))
      .toEqual(catalogue.displayable.map((measure) => measure.color));
    expect(container.querySelector(".grouped-legend-groups")).toHaveTextContent(alpha.label);
    expect(container.querySelector(".grouped-legend-groups")).toHaveTextContent(beta.label);
    fireEvent.mouseOver(container.querySelector(".age-group"));
    expect(container.querySelector(".lifecycle-tooltip")).toHaveTextContent(alpha.label);
    expect(container.querySelector(".lifecycle-tooltip")).toHaveTextContent(beta.label);
    expect(container.querySelector(".lifecycle-tooltip")).not.toHaveTextContent("undefined");
    fireEvent.click(container.querySelector(".age-group"));
    expect(screen.getByText(alpha.description)).toBeInTheDocument();
    expect(screen.getByText(beta.description)).toBeInTheDocument();
  });

  it("withholds a held measure even if the API returns its column", async () => {
    const held = { ...alpha, displayable: false };
    const { container } = render(wrap(<LifecycleCalculator policies={[held]} selectedPolicies={[held.id]} />));
    showResults();
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.getByText(`Not modelled: ${alpha.label}.`)).toBeInTheDocument();
    expect(container.querySelector(".age-group rect")).toBeNull();
  });

  it("uses published labels for legacy household results and ignores an unrelated API total", () => {
    const { container } = render(wrap(<PersonalImpactResults selectedPolicies={[alpha.id, beta.id]} results={{
      years: { 2026: {} }, totals: { cumulative: 9999 },
      policies: { [alpha.id]: { name: "API internal label", years: { 2026: { net_income_change: 10 } } } },
    }} />));
    expect(screen.getByText(`Not modelled: ${beta.label}.`)).toBeInTheDocument();
    expect(screen.getAllByText(alpha.label).length).toBeGreaterThan(0);
    expect(container.textContent).not.toContain("API internal label");
    expect(container.textContent).not.toContain("9,999");
    expect(container.querySelector(".summary-value")).toHaveTextContent("Unavailable");
  });
});
