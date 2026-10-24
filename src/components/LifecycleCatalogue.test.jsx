import { cloneElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { buildMeasureCatalogue, MeasureCatalogueProvider } from "../utils/measureCatalogue";
import LifecycleCalculator from "./LifecycleCalculator";
import LifecycleAbout from "./LifecycleAbout";
import PersonalImpactResults from "./PersonalImpactResults";

vi.mock("recharts", async () => {
  const actual = await vi.importActual("recharts");
  return { ...actual, ResponsiveContainer: ({ children }) => <div>{cloneElement(children, { width: 800, height: 400 })}</div> };
});

const contract = (id, model = "lifecycle") => ({ key: `impact_${id}`, model, reviewed: true, description: `Reviewed ${model} calculation for ${id}.`, years: [2026], unsupported_years: [] });
const createCatalogue = (personal = true, model = "lifecycle") => buildMeasureCatalogue({
  manifest: {
    measures: Object.fromEntries(["alpha", "beta"].map((id) => [id, {
      name: `Mock ${id}`, description: `${id} public description.`, status: "approved", years: [2026], unsupported_years: [],
      ...(personal ? { personal: contract(id, model) } : {}),
    }])), combined: {},
  },
  budgetary: ["alpha", "beta"].map((id) => ({ reform_id: id, year: 2026, value: id === "alpha" ? -100 : 100 })),
});
const catalogue = createCatalogue();
const alpha = catalogue.byId.get("alpha");
const beta = catalogue.byId.get("beta");
const apiRow = {
  age: 22, year: 2026, gross_income: 30000, income_tax: 3000,
  national_insurance: 1000, student_loan_payment: 0,
  student_loan_debt_remaining: 0, baseline_net_income: 26000,
  impact_alpha: 10,
};
const wrap = (children, value = catalogue) => <MeasureCatalogueProvider catalogue={value}>{children}</MeasureCatalogueProvider>;
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

describe("reviewed compatibility in personal views", () => {
  it("describes current measures as not modelled and keeps the accurate lifetime assumptions", () => {
    const { container } = render(wrap(<LifecycleAbout />, createCatalogue(false)));
    expect(screen.getByText(alpha.label)).toBeInTheDocument();
    expect(screen.getByText(beta.label)).toBeInTheDocument();
    expect(container.textContent).toContain("No such mappings are published today");
    expect(container.textContent).toContain("On top of that profile, earnings grow by 1% a year.");
    expect(container.textContent).not.toContain(alpha.description);
    expect(container.textContent).not.toContain(beta.description);
  });

  it("withholds every legacy lifetime figure even when the API supplies matching columns", async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => ({ data: [{ ...apiRow, impact_beta: -4 }] }) });
    const { container } = render(wrap(<LifecycleCalculator selectedPolicies={[alpha.id, beta.id]} />, createCatalogue(false)));
    showResults();
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.getByText(`Not modelled: ${beta.label}, ${alpha.label}.`)).toBeInTheDocument();
    expect(container.querySelector(".age-group rect")).toBeNull();
    expect(container.querySelector(".lifecycle-summary")).not.toBeVisible();
  });

  it("keeps reviewed supported bars but suppresses the total for a missing series", async () => {
    const { container } = render(wrap(<LifecycleCalculator selectedPolicies={[alpha.id, beta.id]} />));
    showResults();
    await waitFor(() => expect(container.querySelectorAll(".age-group rect")).toHaveLength(1));
    expect(screen.getByText(`Not modelled: ${beta.label}.`)).toBeInTheDocument();
    expect(container.querySelector(".lifecycle-summary")).not.toBeVisible();
    expect(container.querySelector(".age-group rect")).toHaveAttribute("fill", alpha.color);
    expect(container.querySelector(".grouped-legend-net")).toBeNull();
    expect(container.querySelector(".net-line")).not.toHaveAttribute("d");
  });

  it("renders a reviewed unfamiliar measure with its model-specific explanation", async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => ({ data: [{ ...apiRow, impact_beta: -4 }] }) });
    const { container } = render(wrap(<LifecycleCalculator selectedPolicies={[alpha.id, beta.id]} />));
    showResults();
    await waitFor(() => expect(container.querySelectorAll(".age-group rect")).toHaveLength(2));
    expect(container.querySelector(".lifecycle-summary")).toBeVisible();
    expect(container.querySelector(".lifecycle-summary")).toHaveTextContent("+£6");
    fireEvent.click(container.querySelector(".age-group"));
    expect(screen.getByText(alpha.personal.description)).toBeInTheDocument();
    expect(screen.getByText(beta.personal.description)).toBeInTheDocument();
    expect(screen.queryByText(alpha.description)).not.toBeInTheDocument();
  });

  it("never trusts supplied policy metadata without a loaded publication catalogue", async () => {
    const { container } = render(<LifecycleCalculator policies={[alpha]} selectedPolicies={[alpha.id]} />);
    showResults();
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.getByText(`Not modelled: ${alpha.id}.`)).toBeInTheDocument();
    expect(container.querySelector(".age-group rect")).toBeNull();
    expect(container.querySelector(".lifecycle-summary")).not.toBeVisible();
  });

  it("withholds held measures despite numeric API output", async () => {
    const held = { ...alpha, displayable: false };
    const { container } = render(wrap(<LifecycleCalculator policies={[held]} selectedPolicies={[held.id]} />));
    showResults();
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.getByText(`Not modelled: ${alpha.label}.`)).toBeInTheDocument();
    expect(container.querySelector(".age-group rect")).toBeNull();
  });

  it("rejects legacy household figures and ignores an unrelated API total", () => {
    const { container } = render(wrap(<PersonalImpactResults selectedPolicies={[alpha.id, beta.id]} results={{
      years: { 2026: {} }, totals: { cumulative: 9999 },
      policies: { [alpha.id]: { name: "API internal label", years: { 2026: { net_income_change: 10 } } } },
    }} />, createCatalogue(false)));
    expect(screen.getByText(`Not modelled: ${beta.label}, ${alpha.label}.`)).toBeInTheDocument();
    expect(container.textContent).not.toContain("API internal label");
    expect(container.textContent).not.toContain("9,999");
    expect(container.querySelector(".summary-value")).toHaveTextContent("Unavailable");
  });

  it("shows only reviewed household series for supported years", () => {
    const { container } = render(wrap(<PersonalImpactResults selectedPolicies={[alpha.id, beta.id]} results={{
      years: { 2026: {} }, policies: {
        impact_alpha: { years: { 2026: { net_income_change: 10 } } },
        impact_beta: { years: { 2026: { net_income_change: -4 } } },
      },
    }} />, createCatalogue(true, "personal")));
    expect(container.querySelector(".summary-value")).toHaveTextContent("+£6");
    expect(screen.queryByText(/Not modelled:/)).not.toBeInTheDocument();
  });
});
