import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { render } from "@testing-library/react";
import { CHANGE_BY_POLICY_NOTE, COUNCIL_TAX_NOTE, EVERY_POLICY_NOTE, WHO_IS_A_CHILD_NOTE } from "./singleYearMethodNotes";

describe("About these figures", () => {
  it("names no measure, so every line stays true whatever is selected or published", () => {
    // Review r8 of #104: "Employer NI relief: … £0 for households" and
    // "Warm Home Discount top-up: paid in 2026-27 only" rendered for any
    // result, and would stay if the Budget changed either measure
    const registry = readFileSync(join(fileURLToPath(import.meta.url), "..", "..", "..", "uk_budget_data", "reforms.py"), "utf8");
    const names = [...registry.matchAll(/^\s*name="([^"]+)"/gm)].map((match) => match[1].toLowerCase());
    expect(names.length).toBeGreaterThan(5);
    for (const note of [CHANGE_BY_POLICY_NOTE, COUNCIL_TAX_NOTE, EVERY_POLICY_NOTE, WHO_IS_A_CHILD_NOTE]) {
      const { container, unmount } = render(note);
      const text = container.textContent;
      expect(text.length).toBeGreaterThan(0);
      for (const name of names) expect(text.toLowerCase()).not.toContain(name);
      expect(text).not.toMatch(/deferral|freeze|unfrozen|top-up|Warm Home Discount|employer NI|\bNI relief|asset disposal|\bBADR\b|tax protection|2026-27 only|No selected policy/i);
      unmount();
    }
  });
});
