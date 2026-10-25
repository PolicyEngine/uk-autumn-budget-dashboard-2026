import { describe, expect, it } from "vitest";
import { SOURCES } from "./sources";

describe("the dashboard's sources", () => {
  const linked = Object.values(SOURCES).filter((source) => source.url);

  it("are all https", () => {
    for (const source of linked) expect(source.url, source.label).toMatch(/^https:\/\//);
  });

  it("each link once", () => {
    const urls = linked.map((source) => source.url);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("each have a label", () => {
    for (const source of Object.values(SOURCES)) expect(source.label.length).toBeGreaterThan(0);
  });
});
