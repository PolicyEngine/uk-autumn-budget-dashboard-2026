import { afterEach, describe, expect, it, vi } from "vitest";
import { GA_INIT_SCRIPT, GA_MEASUREMENT_ID, TOOL_NAME, linkEvent, trackEngagement, trackEvent, trackLinkClicks } from "./analytics";

afterEach(() => {
  delete window.gtag;
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const link = (html) => {
  document.body.innerHTML = html;
  return document.querySelector("a");
};

describe("analytics", () => {
  it("configures policyengine.org's GA property, with the page view tagged as this tool", () => {
    expect(GA_MEASUREMENT_ID).toBe("G-2YHG89FY0N");
    expect(TOOL_NAME).toBe("autumn-budget-2026");
    expect(GA_INIT_SCRIPT).toContain(`gtag('config', '${GA_MEASUREMENT_ID}', { tool_name: '${TOOL_NAME}' })`);
  });

  it("sends nothing, and does not throw, without gtag on the page", () => {
    expect(() => trackEvent("view_opened", { view: "policies" })).not.toThrow();
  });

  it("sends an event through gtag, tagged with the tool's name", () => {
    window.gtag = vi.fn();
    trackEvent("view_opened", { view: "policies" });
    expect(window.gtag).toHaveBeenCalledWith("event", "view_opened", { view: "policies", tool_name: "autumn-budget-2026" });
  });

  it("names a download by its file, and a post by its slug and where its link sits", () => {
    expect(linkEvent(link('<a href="/uk/autumn-budget-2026/reports/report.pdf" download>PDF</a>'))).toEqual(["report_downloaded", { file: "report.pdf" }]);
    expect(linkEvent(link('<div class="policy-card"><a href="https://www.policyengine.org/uk/research/fuel-duty-cut-extension">Read</a></div>'))).toEqual([
      "policy_brief_opened",
      { slug: "fuel-duty-cut-extension", placement: "policies" },
    ]);
    expect(linkEvent(link('<div class="methodology-tab"><a href="https://www.policyengine.org/uk/research/carers-allowance-taper">Read</a></div>'))[1].placement).toBe("methodology");
  });

  it("names a link to another site by its address and host, and sends nothing for the page's own links", () => {
    expect(linkEvent(link('<a href="https://www.gov.uk/budget">Source</a>'))).toEqual([
      "outbound_click",
      { url: "https://www.gov.uk/budget", target_hostname: "www.gov.uk" },
    ]);
    expect(linkEvent(link('<a href="/uk/autumn-budget-2026?tab=policies">Policies</a>'))).toBeNull();
    expect(linkEvent(link('<a href="#methodology">Methodology</a>'))).toBeNull();
    expect(linkEvent(link('<a href="mailto:hello@policyengine.org">Email</a>'))).toBeNull();
  });

  it("sends a link's event on a click, and stops when asked", () => {
    window.gtag = vi.fn();
    const a = link('<a href="https://www.policyengine.org/uk/research/pension-tax-allowance"><span>Read</span></a>');
    a.addEventListener("click", (event) => event.preventDefault());
    const stop = trackLinkClicks();
    a.querySelector("span").click();
    expect(window.gtag).toHaveBeenCalledWith("event", "policy_brief_opened", {
      slug: "pension-tax-allowance",
      placement: "other",
      tool_name: "autumn-budget-2026",
    });
    stop();
    a.click();
    expect(window.gtag).toHaveBeenCalledTimes(1);
  });

  it("sends each scroll depth once, the first time the page reaches it", () => {
    window.gtag = vi.fn();
    vi.spyOn(document.documentElement, "scrollHeight", "get").mockReturnValue(2000);
    const scrollTo = (y) => {
      window.scrollY = y;
      window.dispatchEvent(new Event("scroll"));
    };
    const stop = trackEngagement();
    // 1,232px of scrollable height: 2,000px of page, less jsdom's 768px window
    scrollTo(310); // 25%
    scrollTo(620); // 50%
    scrollTo(100);
    scrollTo(1232); // 100%, passing 75%
    const depths = window.gtag.mock.calls.filter(([, name]) => name === "scroll_depth").map(([, , params]) => params);
    expect(depths).toEqual([
      { percent: 25, tool_name: "autumn-budget-2026" },
      { percent: 50, tool_name: "autumn-budget-2026" },
      { percent: 75, tool_name: "autumn-budget-2026" },
      { percent: 100, tool_name: "autumn-budget-2026" },
    ]);
    stop();
    scrollTo(0);
    scrollTo(1232);
    expect(window.gtag).toHaveBeenCalledTimes(4);
  });

  it("sends time on the tool at 30, 60, 120 and 300 seconds while the tab is visible, and stops when asked", () => {
    vi.useFakeTimers();
    window.gtag = vi.fn();
    const stop = trackEngagement();
    vi.advanceTimersByTime(60_000);
    expect(window.gtag.mock.calls.map(([, , params]) => params.seconds)).toEqual([30, 60]);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    vi.advanceTimersByTime(60_000);
    expect(window.gtag).toHaveBeenCalledTimes(2);
    stop();
    vi.advanceTimersByTime(300_000);
    expect(window.gtag).toHaveBeenCalledTimes(2);
  });
});
