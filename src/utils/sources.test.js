import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SOURCES } from "./sources";

const BUDGET_DAY_KEYS = ["obr_efo_current", "budget_documents"];

describe("the dashboard's sources", () => {
  it("include the intro's Budget-day keys, as https links", () => {
    for (const id of BUDGET_DAY_KEYS) {
      expect(SOURCES[id], id).toBeDefined();
      expect(SOURCES[id].url, id).toMatch(/^https:\/\//);
    }
  });

  const linked = Object.values(SOURCES).filter((source) => source.url);

  it("are all https", () => {
    for (const source of linked) expect(source.url, source.label).toMatch(/^https:\/\//);
  });

  it("each link once", () => {
    // The intro's Budget-day keys may point at a page another key names
    // until Budget day (the March EFO), so they are left out here
    const urls = Object.entries(SOURCES)
      .filter(([id, source]) => source.url && !BUDGET_DAY_KEYS.includes(id))
      .map(([, source]) => source.url);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("each have a label", () => {
    for (const source of Object.values(SOURCES)) expect(source.label.length).toBeGreaterThan(0);
  });

  it("link the policyengine.py release the published run used", () => {
    const { engine } = JSON.parse(readFileSync(join(__dirname, "..", "..", "public", "data", "policy_parameters.json"), "utf8"));
    expect(SOURCES.policyengine_py_release.label).toBe(`policyengine.py ${engine.policyengine}`);
    expect(SOURCES.policyengine_py_release.url).toBe(`https://github.com/PolicyEngine/policyengine.py/releases/tag/${engine.policyengine}`);
  });

  it("open the October 2026 EFO itself, not the OBR's EFO page", () => {
    // obr.uk/efo/economic-and-fiscal-outlook-october-2026/ was a 404 on
    // Budget day; the download is the EFO document (checked 28 October 2026)
    for (const id of ["obr_efo_current", "obr_efo_october_2026"]) {
      expect(SOURCES[id].url, id).toBe("https://obr.uk/download/economic-and-fiscal-outlook-october-2026/");
      expect(SOURCES[id].label, id).toMatch(/October 2026/);
    }
  });
});

describe("every external link in the components", () => {
  // A hand-written target="_blank" link says so to a screen reader, as
  // SourceLink and MethodUi's ExternalLink do
  const files = ["InfoSections.jsx", "livingStandards/HeadlineTile.jsx", "OverviewDrawer.jsx", "PolicyCards.jsx"];
  it("pairs target=_blank with rel and the hidden new-tab label", () => {
    for (const file of files) {
      const text = readFileSync(join(__dirname, "..", "components", file), "utf8");
      const blanks = text.match(/<a\s[^>]*target="_blank"[^>]*>[\s\S]*?<\/a>/g) ?? [];
      expect(blanks.length, file).toBeGreaterThan(0);
      for (const a of blanks) {
        expect(a, file).toMatch(/rel="noopener noreferrer"/);
        expect(a, file).toMatch(/\(opens in a new tab\)/);
      }
    }
  });
});
