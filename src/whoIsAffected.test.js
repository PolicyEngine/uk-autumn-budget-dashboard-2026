import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The page is too large to render in a unit test, so this reads its source.
const app = readFileSync(join(__dirname, "App.jsx"), "utf8");
const css = readFileSync(join(__dirname, "app", "globals.css"), "utf8");

describe("the page's results by demographic group", () => {
  it("has a Who is affected section with both cards", () => {
    const start = app.indexOf('title="Who is affected"');
    expect(start).toBeGreaterThan(-1);
    const section = app.slice(start, app.indexOf("</section>", start));
    expect(section).toContain("<DemographicChart");
    expect(section).toContain("<PovertyByAgeChart");
  });

  it("styles both as cards, like the other charts", () => {
    for (const root of [".demographic-chart", ".poverty-by-age-chart"]) {
      // In the card lists that clear a component's own box and size its title
      expect(css.split(root).length - 1).toBeGreaterThanOrEqual(2);
    }
  });
});
