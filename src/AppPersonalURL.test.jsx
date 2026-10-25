import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import App from "./App";
import { dashboardFixtureFetch } from "./test/dashboardFixture";
import { fixtureJson, fixtureText } from "./test/publicationFixture";
import { artifactSha256 } from "./utils/publication/digest";
import { DEFAULT_DISPLAY_YEAR } from "./utils/displayYears";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it.each(["epsilon", "never_published"])("holds the requested household measure %s without calling the household API", async (id) => {
  const calls = [];
  const published = dashboardFixtureFetch();
  vi.stubEnv("NEXT_PUBLIC_HOUSEHOLD_API_URL", "https://api.test/api/household-impact");
  vi.stubGlobal("fetch", async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? "GET" });
    return published(url, init);
  });
  window.history.replaceState({}, "", `/?tab=household&policies=${id}`);
  render(<App />);
  expect(await screen.findByText("Household impact is unavailable for the selected measures")).toBeInTheDocument();
  expect(new URLSearchParams(window.location.search).get("policies")).toBe(id);
  expect(calls.some((call) => call.method === "POST" || call.url.includes("/api/household-impact"))).toBe(false);
  expect(screen.queryByRole("region", { name: "Results" })).toBeNull();
  expect(document.body).not.toHaveTextContent("£0");
});

it("lets the reader remove an unavailable household measure without calling the household API", async () => {
  const calls = [];
  const published = dashboardFixtureFetch();
  vi.stubEnv("NEXT_PUBLIC_HOUSEHOLD_API_URL", "https://api.test/api/household-impact");
  vi.stubGlobal("fetch", async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? "GET" });
    return published(url, init);
  });
  window.history.replaceState({}, "", "/?tab=household&policies=epsilon");
  render(<App />);
  const reason = "Household impact is unavailable for the selected measures";
  const notice = (await screen.findByText(reason)).closest(".publication-unavailable");
  fireEvent.click(within(notice).getByRole("button", { name: /^Remove .* from the selection$/ }));
  await waitFor(() => expect(screen.queryByText(reason)).toBeNull());
  expect(new URLSearchParams(window.location.search).get("policies") ?? "").not.toContain("epsilon");
  expect(calls.some((call) => call.method === "POST" || call.url.includes("/api/household-impact"))).toBe(false);
});

// Review of 428d209, finding 3: a later snapshot remounts the views, and
// must restore exactly the selection the reader had, an empty one included.
describe("a later snapshot keeps the reader's selection", () => {
  const REASON = "Household impact is unavailable for the selected measures";
  const policies = () => new URLSearchParams(window.location.search).get("policies");
  // The fixture's measures cover 2032 and 2033 only, and Household impact
  // needs the title band's year. So alpha's and beta's receipts are also
  // published for it, re-bound through the production digest functions.
  const serve = async (statuses = {}, revision = 0) => {
    const manifest = fixtureJson("manifest.json");
    const overrides = {};
    for (const id of ["alpha", "beta"]) {
      const entry = manifest.measures[id];
      const previous = entry.artifact;
      const receipt = fixtureJson(`${previous}/receipt.json`);
      receipt.execution_receipt.years = [DEFAULT_DISPLAY_YEAR, ...receipt.execution_receipt.years];
      entry.years = receipt.execution_receipt.years;
      entry.artifact_sha256 = await artifactSha256(receipt);
      entry.artifact = `artifacts/${id}/${entry.artifact_sha256.slice(0, 16)}`;
      if (entry.approval) entry.approval = { ...entry.approval, artifact_sha256: entry.artifact_sha256 };
      overrides[`${entry.artifact}/receipt.json`] = JSON.stringify(receipt);
      for (const file of Object.keys(receipt.dashboard.files)) overrides[`${entry.artifact}/${file}`] = fixtureText(`${previous}/${file}`);
    }
    for (const [id, status] of Object.entries(statuses)) manifest.measures[id] = { ...manifest.measures[id], status };
    manifest.revision += revision;
    overrides["manifest.json"] = JSON.stringify(manifest);
    return dashboardFixtureFetch({ overrides });
  };
  const open = (url, fetcher, calls) => {
    vi.stubEnv("NEXT_PUBLIC_HOUSEHOLD_API_URL", "https://api.test/api/household-impact");
    vi.stubGlobal("fetch", async (requested, init = {}) => {
      calls.push({ url: String(requested), method: init.method ?? "GET" });
      return fetcher(requested, init);
    });
    window.history.replaceState({}, "", url);
    render(<App />);
  };
  const publish = async (fetcher, calls) => {
    vi.stubGlobal("fetch", async (requested, init = {}) => {
      calls.push({ url: String(requested), method: init.method ?? "GET" });
      return fetcher(requested, init);
    });
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    expect(await screen.findByText(/Newer results were published while this page was open/)).toBeInTheDocument();
  };
  const householdCalls = (calls) => calls.filter((call) => call.method === "POST" || call.url.includes("/api/household-impact"));

  it("shows a withdrawn personal measure as unavailable instead of dropping it", async () => {
    const calls = [];
    open("/?tab=household&policies=alpha,beta", await serve(), calls);
    await waitFor(() => expect(document.querySelector(".personal-impact-tab")).not.toBeNull());
    expect(policies()).toBe("alpha,beta");
    expect(screen.queryByText(REASON)).toBeNull();
    await publish(await serve({ beta: "withdrawn" }, 1), calls);
    expect(await screen.findByText(REASON)).toBeInTheDocument();
    expect(policies()).toBe("alpha,beta");
    expect(householdCalls(calls)).toEqual([]);
  });

  it("keeps a selection narrowed by removal when a later snapshot adds nothing", async () => {
    const calls = [];
    open("/?tab=household&policies=alpha,epsilon", await serve(), calls);
    const notice = (await screen.findByText(REASON)).closest(".publication-unavailable");
    fireEvent.click(within(notice).getByRole("button", { name: /^Remove .* from the selection$/ }));
    await waitFor(() => expect(policies()).toBe("alpha"));
    expect(document.querySelector(".personal-impact-tab")).not.toBeNull();
    await publish(await serve({}, 1), calls);
    expect(policies()).toBe("alpha");
    expect(screen.queryByText(REASON)).toBeNull();
    expect(document.querySelector(".personal-impact-tab")).not.toBeNull();
  });

  it("keeps an empty personal selection empty", async () => {
    const calls = [];
    open("/?tab=household&policies=epsilon", await serve(), calls);
    const notice = (await screen.findByText(REASON)).closest(".publication-unavailable");
    fireEvent.click(within(notice).getByRole("button", { name: /^Remove .* from the selection$/ }));
    await waitFor(() => expect(policies()).toBe(""));
    await publish(await serve({}, 1), calls);
    expect(policies()).toBe("");
    expect(householdCalls(calls)).toEqual([]);
  });

  // Review of 15439f4, finding 2: the default is every displayable measure,
  // not a list pinned at the first snapshot the reader saw, and a chosen
  // selection survives a view without the policy pill.
  // The year pill shares the count class, so read the policy pill's
  const selectedCount = () => Number(document.querySelector(".band-policy .policy-selector-count")?.textContent);

  it("adds a newly published measure to a default selection", async () => {
    const calls = [];
    open("/", await serve({ beta: "staged" }), calls);
    await waitFor(() => expect(selectedCount()).toBeGreaterThan(0));
    const before = selectedCount();
    expect(policies()).toBeNull();
    await publish(await serve({}, 1), calls);
    await waitFor(() => expect(selectedCount()).toBe(before + 1));
    expect(policies()).toBeNull();
    expect(screen.queryByText("Some selected measures are unavailable")).toBeNull();
  });

  it("drops a withdrawn measure from a default selection without blocking the figures", async () => {
    const calls = [];
    open("/", await serve(), calls);
    await waitFor(() => expect(selectedCount()).toBeGreaterThan(0));
    const before = selectedCount();
    await publish(await serve({ beta: "withdrawn" }, 1), calls);
    await waitFor(() => expect(selectedCount()).toBe(before - 1));
    expect(policies()).toBeNull();
    expect(screen.queryByText("Some selected measures are unavailable")).toBeNull();
    expect(screen.queryByText(/Select policies to analyse their impact/)).toBeNull();
  });

  it("keeps a chosen selection across a view without the policy pill and a later snapshot", async () => {
    const calls = [];
    open("/?policies=alpha", await serve(), calls);
    await waitFor(() => expect(selectedCount()).toBe(1));
    fireEvent.click(screen.getByRole("tab", { name: "Methodology" }));
    expect(policies()).toBe("alpha");
    await publish(await serve({}, 1), calls);
    expect(policies()).toBe("alpha");
    fireEvent.click(screen.getByRole("tab", { name: "Population impact" }));
    expect(selectedCount()).toBe(1);
    expect(policies()).toBe("alpha");
  });

  it("writes a selection to the address only once the reader chooses one", async () => {
    const calls = [];
    open("/", await serve(), calls);
    await waitFor(() => expect(selectedCount()).toBeGreaterThan(0));
    const all = selectedCount();
    expect(policies()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Select policies" }));
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    await waitFor(() => expect(selectedCount()).toBe(all - 1));
    expect(policies().split(",")).toHaveLength(all - 1);
  });

  it("hands the selection back to the publication when the reader picks every measure", async () => {
    const calls = [];
    open("/?policies=", await serve({ beta: "staged" }), calls);
    fireEvent.click(await screen.findByRole("button", { name: "All measures" }));
    await waitFor(() => expect(selectedCount()).toBeGreaterThan(0));
    const before = selectedCount();
    expect(policies()).toBeNull();
    await publish(await serve({}, 1), calls);
    await waitFor(() => expect(selectedCount()).toBe(before + 1));
  });

  it("keeps an empty population selection empty", async () => {
    const calls = [];
    open("/?policies=", await serve(), calls);
    expect(await screen.findByText(/Select policies to analyse their impact/)).toBeInTheDocument();
    expect(policies()).toBe("");
    await publish(await serve({}, 1), calls);
    expect(screen.getByText(/Select policies to analyse their impact/)).toBeInTheDocument();
    expect(policies()).toBe("");
  });
});
