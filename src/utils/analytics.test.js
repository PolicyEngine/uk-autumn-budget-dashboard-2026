import { afterEach, describe, expect, it, vi } from "vitest";
import { GA_INIT_SCRIPT, GA_MEASUREMENT_ID, linkEvent, trackEvent, trackLinkClicks } from "./analytics";

afterEach(() => {
  delete window.gtag;
  document.body.innerHTML = "";
});

const link = (html) => {
  document.body.innerHTML = html;
  return document.querySelector("a");
};

describe("analytics", () => {
  it("configures policyengine.org's GA property", () => {
    expect(GA_MEASUREMENT_ID).toBe("G-2YHG89FY0N");
    expect(GA_INIT_SCRIPT).toContain(`gtag('config', '${GA_MEASUREMENT_ID}')`);
  });

  it("sends nothing, and does not throw, without gtag on the page", () => {
    expect(() => trackEvent("view_opened", { view: "policies" })).not.toThrow();
  });

  it("sends an event through gtag when it is on the page", () => {
    window.gtag = vi.fn();
    trackEvent("view_opened", { view: "policies" });
    expect(window.gtag).toHaveBeenCalledWith("event", "view_opened", { view: "policies" });
  });

  it("names a download by its file, and a post by its slug and where its link sits", () => {
    expect(linkEvent(link('<a href="/uk/autumn-budget-2026/reports/report.pdf" download>PDF</a>'))).toEqual(["report_downloaded", { file: "report.pdf" }]);
    expect(linkEvent(link('<div class="policy-card"><a href="https://www.policyengine.org/uk/research/fuel-duty-cut-extension">Read</a></div>'))).toEqual([
      "policy_brief_opened",
      { slug: "fuel-duty-cut-extension", placement: "policies" },
    ]);
    expect(linkEvent(link('<div class="methodology-tab"><a href="https://www.policyengine.org/uk/research/carers-allowance-taper">Read</a></div>'))[1].placement).toBe("methodology");
    expect(linkEvent(link('<a href="https://www.gov.uk/budget">Source</a>'))).toBeNull();
  });

  it("sends a link's event on a click, and stops when asked", () => {
    window.gtag = vi.fn();
    const a = link('<a href="https://www.policyengine.org/uk/research/pension-tax-allowance"><span>Read</span></a>');
    a.addEventListener("click", (event) => event.preventDefault());
    const stop = trackLinkClicks();
    a.querySelector("span").click();
    expect(window.gtag).toHaveBeenCalledWith("event", "policy_brief_opened", { slug: "pension-tax-allowance", placement: "other" });
    stop();
    a.click();
    expect(window.gtag).toHaveBeenCalledTimes(1);
  });
});
