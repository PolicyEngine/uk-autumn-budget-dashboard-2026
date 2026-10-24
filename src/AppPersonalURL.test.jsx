import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import App from "./App";
import { dashboardFixtureFetch } from "./test/dashboardFixture";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it.each(["epsilon", "never_published"])("holds the requested personal measure %s without calling the household API", async (id) => {
  const calls = [];
  const published = dashboardFixtureFetch();
  vi.stubEnv("NEXT_PUBLIC_HOUSEHOLD_API_URL", "https://api.test/api/household-impact");
  vi.stubGlobal("fetch", async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? "GET" });
    return published(url, init);
  });
  window.history.replaceState({}, "", `/?tab=personal&policies=${id}`);
  render(<App />);
  expect(await screen.findByText("Personal impact is unavailable for the selected measures")).toBeInTheDocument();
  expect(new URLSearchParams(window.location.search).get("policies")).toBe(id);
  expect(calls.some((call) => call.method === "POST" || call.url.includes("/api/household-impact"))).toBe(false);
  expect(screen.queryByRole("region", { name: "Results" })).toBeNull();
  expect(document.body).not.toHaveTextContent("£0");
});
