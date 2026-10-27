import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { findColourViolations, scanCss, scanInlineFills, scanJs } from "./test/colourGuard";

// One colour template (docs/COLOURS.md): colour literals live only in the
// tokens (src/app/globals.css's :root blocks) and their JS mirror
// (src/utils/chartTheme.js). Everything else takes a token.
describe("colour guard", () => {
  it("finds no colour literal outside the token files", () => {
    const violations = findColourViolations(resolve(__dirname, ".."));
    expect(
      violations,
      `Colour literals outside the token files. Use a --c-* token (CSS) or CHART_COLOURS / POLICY_RAMPS / INCOME_RAMP (JS); see docs/COLOURS.md:\n  ${violations.join("\n  ")}\n`,
    ).toEqual([]);
  });

  it("catches hex, rgb() and named colours in CSS, but not tokens or masks", () => {
    const css = [
      ":root { --c-gain: #319795; }",
      ".a { color: #fff; }",
      ".b { box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1); }",
      ".c { background: white; white-space: nowrap; }",
      ".d { color: var(--c-gain); border-color: transparent; fill: currentColor; }",
      ".e { mask-image: linear-gradient(black, transparent); }",
      ".f { --local: #abc; }",
    ].join("\n");
    expect(scanCss(css, { tokensAllowed: true }).map((v) => v.line)).toEqual([2, 3, 4, 7]);
    // Outside globals.css even a :root token may not hold a literal
    expect(scanCss(css).map((v) => v.line)).toEqual([1, 2, 3, 4, 7]);
  });

  it("reads JS strings and JSX attributes, not comments, issue numbers or entities", () => {
    const js = [
      'const a = "#D97706";',
      "// #fff in a comment",
      'const b = { background: "white", label: "policyengine-uk #2616" };',
      'const c = <rect fill="#319795" />;',
      'const d = "&#160;";',
      "const e = `0 4px 12px rgba(17, 24, 39, 0.08)`;",
      'const f = <Tag tone="teal" />;',
    ].join("\n");
    expect(scanJs(js).map((v) => v.line)).toEqual([1, 3, 4, 6]);
  });

  it("flags inline fill= and stroke= literals in JSX", () => {
    const jsx = '<g><rect fill="#fff" /><path stroke="black" /><path stroke="currentColor" fill="none" /><rect fill={`${x}`} /></g>';
    expect(scanInlineFills(jsx).map((v) => v.found)).toEqual(['fill="#fff"', 'stroke="black"']);
  });
});
