import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { checkPublicFiles } from "../../scripts/check-public-files.mjs";

// The build runs scripts/check-public-files.mjs before `next build`, so a
// rule that lapses inside Budget week stops every deploy: with sign-off on,
// any pending review row; with it off, as committed, a pending row that
// lets a file carry area codes. The Budget is on 28 October 2026 and the
// briefing is due by 07:00 on the 29th: the repository must pass on each day
// of Budget week, not only today.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const BUDGET_WEEK = Array.from({ length: 8 }, (_, i) => `2026-10-${23 + i}`);

describe("the build's public-file check through Budget week", () => {
  it.each(BUDGET_WEEK)("passes on %s", (day) => {
    expect(checkPublicFiles(ROOT, new Date(`${day}T12:00:00Z`))).toEqual([]);
  });
});
