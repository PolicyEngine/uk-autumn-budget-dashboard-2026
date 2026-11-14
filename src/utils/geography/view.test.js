import { describe, expect, it } from "vitest";
import { viewState } from "./view";

const choice = { kind: "package", reform: "combined--a+b" };

describe("the area view's notices", () => {
  it("asks for a reload when newer results were published after the page loaded", () => {
    const view = viewState({ data: { status: "stale", table: null }, choice, year: 2029, outcome: "relative_change", place: "by region" });
    expect(view).toMatchObject({
      kind: "notice",
      reason: "We have published newer results since this page loaded.",
      detail: "Reload the page to see them.",
    });
  });

  it.each(["unavailable", "error"])("shows no figure for a %s file", (status) => {
    const view = viewState({ data: { status, table: null }, choice, year: 2029, outcome: "relative_change", place: "by region" });
    expect(view.kind).toBe("notice");
  });
});
