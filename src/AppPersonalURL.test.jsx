import { beforeAll, afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import App, { preloadAllViews } from "./App";
import { dashboardFixtureFetch } from "./test/dashboardFixture";
import { fixtureJson, fixtureText } from "./test/publicationFixture";
import { artifactSha256 } from "./utils/publication/digest";
import { DEFAULT_DISPLAY_YEAR } from "./utils/displayYears";

// Every view's code is in before a test renders it (App.jsx lazyView)
beforeAll(preloadAllViews, 60_000);

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
  expect(await screen.findByText("Household calculator is unavailable for the selected policies")).toBeInTheDocument();
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
  const reason = "Household calculator is unavailable for the selected policies";
  const notice = (await screen.findByText(reason)).closest(".publication-unavailable");
  fireEvent.click(within(notice).getByRole("button", { name: /^Remove .* from the selection$/ }));
  await waitFor(() => expect(screen.queryByText(reason)).toBeNull());
  expect(new URLSearchParams(window.location.search).get("policies") ?? "").not.toContain("epsilon");
  expect(calls.some((call) => call.method === "POST" || call.url.includes("/api/household-impact"))).toBe(false);
});

// Review of 428d209, finding 3: a later snapshot remounts the views, and
// must restore exactly the selection the reader had, an empty one included.
describe("a later snapshot keeps the reader's selection", () => {
  const REASON = "Household calculator is unavailable for the selected policies";
  const policies = () => new URLSearchParams(window.location.search).get("policies");
  // The fixture's measures cover 2032 and 2033 only, and Household calculator
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
    expect(await screen.findByText(/Updated with the latest published results/)).toBeInTheDocument();
  };
  const householdCalls = (calls) => calls.filter((call) => call.method === "POST" || call.url.includes("/api/household-impact"));

  it("shows a stale personal measure as unavailable instead of dropping it", async () => {
    const calls = [];
    open("/?tab=household&policies=alpha,beta", await serve(), calls);
    await waitFor(() => expect(document.querySelector(".personal-impact-tab")).not.toBeNull());
    expect(policies()).toBe("alpha,beta");
    expect(screen.queryByText(REASON)).toBeNull();
    // Before the withdrawal the example cards may ask the household API in
    // the background (useExampleFigures); once beta is stale nothing more
    // is asked for the selection
    await publish(await serve({ beta: "stale" }, 1), calls);
    expect(await screen.findByText(REASON)).toBeInTheDocument();
    expect(policies()).toBe("alpha,beta");
    const asked = householdCalls(calls).length;
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(householdCalls(calls)).toHaveLength(asked);
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
  // selection survives a view without the policy pill. The fixture has no
  // combined run of its whole package, so the population tabs pick one
  // policy at a time; the Household calculator keeps the multi-select
  // selection these tests follow.
  // The year pill shares the count class, so read the policy pill's
  const selectedCount = () => Number(document.querySelector(".band-policy .policy-selector-count")?.textContent);

  it("adds a newly published measure to a default selection", async () => {
    const calls = [];
    open("/?tab=household", await serve({ beta: "staged" }), calls);
    await waitFor(() => expect(selectedCount()).toBeGreaterThan(0));
    const before = selectedCount();
    expect(policies()).toBeNull();
    await publish(await serve({}, 1), calls);
    await waitFor(() => expect(selectedCount()).toBe(before + 1));
    expect(policies()).toBeNull();
    expect(screen.queryByText("Some selected policies are unavailable")).toBeNull();
  });

  it("drops a withdrawn measure from a default selection without blocking the figures", async () => {
    const calls = [];
    open("/?tab=household", await serve(), calls);
    await waitFor(() => expect(selectedCount()).toBeGreaterThan(0));
    const before = selectedCount();
    await publish(await serve({ beta: "withdrawn" }, 1), calls);
    await waitFor(() => expect(selectedCount()).toBe(before - 1));
    expect(policies()).toBeNull();
    expect(screen.queryByText("Some selected policies are unavailable")).toBeNull();
  });

  it("keeps a chosen selection across a view without the policy pill and a later snapshot", async () => {
    const calls = [];
    open("/?tab=household&policies=alpha", await serve(), calls);
    await waitFor(() => expect(selectedCount()).toBe(1));
    fireEvent.click(screen.getByRole("tab", { name: "Methodology" }));
    await publish(await serve({}, 1), calls);
    fireEvent.click(screen.getByRole("tab", { name: "Household calculator" }));
    expect(selectedCount()).toBe(1);
    expect(policies()).toBe("alpha");
  });

  it("writes a selection to the address only once the reader chooses one", async () => {
    const calls = [];
    // A view: the landing page keeps the bare address whatever is chosen
    open("/?tab=household", await serve(), calls);
    await waitFor(() => expect(selectedCount()).toBeGreaterThan(0));
    const all = selectedCount();
    expect(policies()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Policies / }));
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    await waitFor(() => expect(selectedCount()).toBe(all - 1));
    expect(policies().split(",")).toHaveLength(all - 1);
  });

  // One policy at a time on the population tabs (no combined run of the
  // whole package in the fixture)
  const chosenName = () => document.querySelector(".band-policy .policy-selector-chosen")?.textContent;

  it("opens the population tabs on one policy, the first in the catalogue's order, and names it in the address", async () => {
    const calls = [];
    open("/?tab=dashboard", await serve(), calls);
    await waitFor(() => expect(chosenName()).toBeTruthy());
    expect(policies()?.split(",")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /^Policies / }));
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Select all" })).toBeNull();
    const radios = screen.getAllByRole("radio");
    expect(radios.filter((radio) => radio.checked)).toHaveLength(1);
    // Picking another selects only it
    fireEvent.click(radios[1]);
    await waitFor(() => expect(screen.getAllByRole("radio").filter((radio) => radio.checked)).toHaveLength(1));
    expect(policies()?.split(",")).toHaveLength(1);
    expect(screen.getAllByRole("radio")[1].checked).toBe(true);
  });

  it("keeps each tab's own choice: one policy for the population tabs, every policy for the Household calculator", async () => {
    const calls = [];
    open("/?tab=dashboard&policies=alpha,beta", await serve(), calls);
    await waitFor(() => expect(chosenName()).toBeTruthy());
    // A link naming several opens on the first of them
    expect(policies()?.split(",")).toHaveLength(1);
    const one = policies();
    fireEvent.click(screen.getByRole("tab", { name: "Household calculator" }));
    await waitFor(() => expect(selectedCount()).toBeGreaterThan(1));
    fireEvent.click(screen.getByRole("tab", { name: "Population impact" }));
    await waitFor(() => expect(policies()).toBe(one));
    // The Policies tab shows every policy's card, whatever is chosen
    fireEvent.click(screen.getByRole("tab", { name: "Policies" }));
    await waitFor(() => expect(document.querySelectorAll(".policy-details-content [aria-label^='See its effect']").length).toBeGreaterThan(1));
  });
});

describe("the header's year in the address", () => {
  // The page renders once while the publication loads, then remounts the
  // views on the loaded snapshot (App.jsx, key={snapshot}), so an element
  // found during loading can be gone a moment later: wait for the
  // published policies' cards first
  const published = () =>
    waitFor(() => expect(document.querySelectorAll(".policy-details-content [aria-label^='See its effect']").length).toBeGreaterThan(0));

  it("opens a shared link on its ?year= and keeps it there", async () => {
    // (the default year stays out of the address, so a kept 2030 was read)
    vi.stubGlobal("fetch", dashboardFixtureFetch());
    window.history.replaceState({}, "", "/?tab=policies&year=2030");
    render(<App />);
    await published();
    expect(await screen.findByRole("button", { name: /^Year 2030-31/ })).toBeInTheDocument();
    await waitFor(() => expect(new URLSearchParams(window.location.search).get("year")).toBe("2030"));
  });

  it("drops a year it does not offer (an old 2026) and opens the default", async () => {
    vi.stubGlobal("fetch", dashboardFixtureFetch());
    window.history.replaceState({}, "", "/?tab=policies&year=2026");
    render(<App />);
    await published();
    expect(await screen.findByRole("tab", { name: /Policies/ })).toBeInTheDocument();
    await waitFor(() => expect(new URLSearchParams(window.location.search).get("year")).toBeNull());
  });
});
