// @vitest-environment node
import { renderToString } from "react-dom/server";
import { expect, it } from "vitest";
import App from "./App";

it("prerenders the shell without a browser or any Budget figures", () => {
  expect(typeof window).toBe("undefined");
  const html = renderToString(<App />);
  expect(html).toContain("UK Autumn Budget 2026");
  for (const label of ["Population impact", "Personal impact", "Living standards", "Methodology"]) {
    expect(html).toContain(label);
  }
  expect(html).toContain("Loading published measures");
  expect(html).not.toContain('id="revenue"');
  expect(html).not.toContain('class="chart-plot');
  expect(html).not.toContain("£");
});
