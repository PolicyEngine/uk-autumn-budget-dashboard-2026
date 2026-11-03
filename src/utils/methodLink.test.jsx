import { afterEach, describe, expect, it } from "vitest";
import { policyCardHref } from "./methodLink";

describe("policyCardHref (AH4)", () => {
  afterEach(() => window.history.replaceState(null, "", "/"));

  it("keeps the year and the selection, and swaps only the tab, with no sub-tab", () => {
    window.history.replaceState(null, "", "/?year=2028&policies=a,b&tab=dashboard&sub=age");
    expect(policyCardHref("x")).toBe(`?tab=policies&year=2028&policies=${encodeURIComponent("a,b")}#policy-x`);
  });

  it("is the tab alone on a page with no query", () => {
    expect(policyCardHref("x")).toBe("?tab=policies#policy-x");
  });
});
