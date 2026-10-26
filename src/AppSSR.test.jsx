// @vitest-environment node
import { renderToString } from "react-dom/server";
import { expect, it } from "vitest";
import App from "./App";

it("prerenders the shell without a browser or any Budget figures", () => {
  expect(typeof window).toBe("undefined");
  const html = renderToString(<App />);
  expect(html).toContain("UK Autumn Budget 2026");
  for (const label of ["Population impact", "Household impact", "Before the Budget", "Policies", "Methodology"]) {
    expect(html).toContain(label);
  }
  // The landing page, whole, with no view mounted under it
  expect(html).toContain("What Autumn Budget 2026 means");
  expect(html).toContain('class="landing-backdrop"');
  expect(html).not.toContain('role="tabpanel"');
  expect(html).not.toContain('id="revenue"');
  expect(html).not.toContain('class="chart-plot');
  expect(html).not.toContain("£");
});
