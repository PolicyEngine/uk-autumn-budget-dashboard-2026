/**
 * Budget day (#105): the page labels the package total "Sum of measures"
 * while the combined run is stale, and drops the label once
 * refresh-combined has rerun it for exactly the live measures.
 *
 * The page is rendered on the real public files, with budgetary_impact.csv
 * given the reform_members column in each state.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import App from "./App";

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
const BUDGETARY = readFileSync(join(PUBLIC, "data", "budgetary_impact.csv"), "utf8");
const COMBINED = "autumn_budget_2026_combined";

/** The real budgetary file with the members column, the combined run's
 * cell set to `members`. */
function withMembers(members) {
  const [header, ...lines] = BUDGETARY.trim().split("\n");
  return [
    `${header},reform_members`,
    ...lines.map((line) => `${line},${line.startsWith(`${COMBINED},`) ? members : ""}`),
  ].join("\n");
}

const LIVE = [
  ...new Set(
    BUDGETARY.trim()
      .split("\n")
      .slice(1)
      .map((line) => line.split(",")[0])
      .filter((id) => id !== COMBINED),
  ),
].sort();

let budgetary;

function serve(input) {
  const url = typeof input === "string" ? input : input.url;
  const { pathname } = new URL(url, "http://localhost");
  if (pathname === "/data/budgetary_impact.csv") {
    return new Response(budgetary, { status: 200 });
  }
  try {
    return new Response(readFileSync(join(PUBLIC, pathname)), { status: 200 });
  } catch {
    return new Response("", { status: 404 });
  }
}

beforeEach(() => {
  window.history.replaceState({}, "", "/");
  vi.stubGlobal("fetch", vi.fn(async (input) => serve(input)));
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const LABEL = /Sum of measures: the total adds up each measure/;

describe("the package total on Budget day", () => {
  it("is labelled the sum of measures while the combined run is stale", async () => {
    // publish-measure blanked the members when a member's rows changed
    budgetary = withMembers("");
    render(<App />);
    expect(await screen.findByText(LABEL, {}, { timeout: 5000 })).toBeInTheDocument();
  });

  it("is labelled while a newly live measure is not in the combined run", async () => {
    budgetary = withMembers(LIVE.slice(1).join("+"));
    render(<App />);
    expect(await screen.findByText(LABEL, {}, { timeout: 5000 })).toBeInTheDocument();
  });

  it("drops the label once the combined run covers every live measure", async () => {
    budgetary = withMembers(LIVE.join("+"));
    render(<App />);
    await screen.findAllByRole("heading", { name: "Public finances" }, { timeout: 5000 });
    expect(screen.queryByText(LABEL)).not.toBeInTheDocument();
  });

  it("is not labelled for a file from before the members column", async () => {
    budgetary = BUDGETARY;
    render(<App />);
    await screen.findAllByRole("heading", { name: "Public finances" }, { timeout: 5000 });
    expect(screen.queryByText(LABEL)).not.toBeInTheDocument();
  });
});
