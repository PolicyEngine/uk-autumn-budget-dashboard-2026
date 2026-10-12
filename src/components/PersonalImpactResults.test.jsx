import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import PersonalImpactResults from "./PersonalImpactResults";

vi.mock("recharts", async (importOriginal) => {
  const original = await importOriginal();
  return { ...original, ResponsiveContainer: () => null };
});

it("counts six policy years and excludes boundary diagnostics from the summary", () => {
  const years = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [2025 + i, {}]));
  const view = render(<PersonalImpactResults results={{
    years, policies: {}, totals: {
      by_year: { 2025: 100, 2026: 1, 2027: 1, 2028: 1, 2029: 1, 2030: 1, 2031: 1, 2032: 10000 },
      cumulative: 10106,
    },
  }} />);
  expect(screen.getByText("Your total impact over 6 years")).toBeInTheDocument();
  expect(view.container.querySelector(".summary-value")).toHaveTextContent("+£6");
});
