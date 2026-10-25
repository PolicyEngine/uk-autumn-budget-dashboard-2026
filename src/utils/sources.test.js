import { describe, expect, it } from "vitest";
import { SOURCES } from "./sources";

describe("the dashboard's sources", () => {
  const linked = Object.values(SOURCES).filter((source) => source.href);

  it("are all https", () => {
    for (const source of linked) expect(source.href, source.label).toMatch(/^https:\/\//);
  });

  it("each link once", () => {
    const hrefs = linked.map((source) => source.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("each have a label", () => {
    for (const source of Object.values(SOURCES)) expect(source.label.length).toBeGreaterThan(0);
  });
});
