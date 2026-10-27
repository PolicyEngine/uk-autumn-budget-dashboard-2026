import { describe, expect, it, vi } from "vitest";
import { buildChartCsv } from "./chartCsv";
import { downloadFrame, frameCsv, frameFileName, frameSvg, slugify, titleWithPeriod } from "./exportFrame";
import { cardSelection, policiesLabel } from "./downloadContext";
import { chartDownloads } from "./chartDownloads";
import * as downloadFile from "./downloadFile";

const NOW = new Date("2026-10-27T12:00:00Z");

describe("a downloaded chart's frame", () => {
  it("adds the period to a title that names no year, and keeps one that does", () => {
    expect(titleWithPeriod("Revenue impact", "2027-28 to 2031-32")).toBe("Revenue impact, 2027-28 to 2031-32");
    expect(titleWithPeriod("Impact by income decile, 2027-28", "2028-29")).toBe("Impact by income decile, 2027-28");
  });

  it("names the policies and the Options choices, then the source, provisional label and date", () => {
    const frame = downloadFrame({
      title: "Impact by income decile, 2027-28",
      policies: "All 9 policies",
      selection: "% of net income · Before housing costs",
      provisional: "Provisional figures",
      now: NOW,
    });
    expect(frame.subtitle).toBe("All 9 policies · % of net income · Before housing costs");
    expect(frame.footer).toBe(
      "Source: PolicyEngine UK, UK Autumn Budget 2026 dashboard · Provisional figures · 27 October 2026",
    );
    expect(downloadFrame({ title: "X, 2027-28", now: NOW }).footer).not.toMatch(/Provisional/);
  });

  it("names the file after the title with its year", () => {
    expect(slugify("Impact by income decile, 2027-28")).toBe("impact-by-income-decile-2027-28");
    expect(frameFileName({ title: "Revenue impact, 2027-28 to 2031-32" }, "x")).toBe("revenue-impact-2027-28-to-2031-32");
    expect(frameFileName(null, "fallback")).toBe("fallback");
  });

  it("labels the selection: all, one, or the names", () => {
    const policies = [{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }];
    expect(policiesLabel(["a", "b", "c"], policies)).toBe("All 3 policies");
    expect(policiesLabel(["b"], policies)).toBe("B");
    expect(policiesLabel(["a", "c"], policies)).toBe("2 of 3 policies: A, C");
  });

  it("reads the card's Options choices, not a neighbouring card's", () => {
    document.body.innerHTML = `
      <div class="results-container">
        <div class="card"><div class="chart-download" id="one"></div>
          <div class="control-bar"><div class="control-bar-options"><button><span class="control-bar-summary">£ per household</span></button></div></div></div>
        <div class="card"><div class="chart-download"></div>
          <div class="control-bar"><div class="control-bar-options"><button><span class="control-bar-summary">Gini</span></button></div></div></div>
      </div>`;
    expect(cardSelection(document.getElementById("one"))).toBe("£ per household");
  });
});

describe("the CSV's frame lines", () => {
  const csv = buildChartCsv({
    title: "Impact by income decile",
    units: "£",
    columns: [{ key: "decile", label: "Decile" }, { key: "v", label: "Value", decimals: 2 }],
    rows: [{ decile: "1", v: 2 }],
  });
  const frame = downloadFrame({ title: "Impact by income decile, 2027-28", policies: "All 9 policies", selection: "£ per household", now: NOW });

  it("come after the file's own '#' lines, before the header row, after the byte-order mark", () => {
    const text = frameCsv(csv, frame);
    expect(text.startsWith("﻿# Impact by income decile")).toBe(true);
    const lines = text.slice(1).split("\r\n");
    const header = lines.findIndex((line) => !/^"?#/.test(line));
    expect(lines[header]).toBe("Decile,Value");
    expect(lines.slice(0, header)).toEqual(
      expect.arrayContaining([
        "\"# Chart: Impact by income decile, 2027-28\"",
        "# Policies: All 9 policies",
        "# Options: £ per household",
        '"# Source: PolicyEngine UK, UK Autumn Budget 2026 dashboard · 27 October 2026"',
      ]),
    );
    expect(lines[header + 1]).toBe("1,2");
  });
});

describe("the framed image", () => {
  it("draws the title, subtitle and footer round the plot at 1200px", async () => {
    const built = { svg: '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400" viewBox="0 0 800 400"><rect width="10" height="10"/></svg>', width: 800, height: 400 };
    const frame = downloadFrame({ title: "Revenue impact", period: "2027-28 to 2031-32", policies: "All 9 policies", now: NOW });
    const out = await frameSvg(built, frame, {});
    expect(out.width).toBe(1200);
    expect(out.height).toBeGreaterThan(400 * 1.42);
    expect(out.svg).toContain("Revenue impact, 2027-28 to 2031-32");
    expect(out.svg).toContain("All 9 policies");
    expect(out.svg).toContain("Source: PolicyEngine UK, UK Autumn Budget 2026 dashboard");
    expect(out.svg).toContain('viewBox="0 0 800 400"');
    expect(new DOMParser().parseFromString(out.svg, "image/svg+xml").querySelector("parsererror")).toBeNull();
  });

  it("is left alone without a frame", async () => {
    const built = { svg: "<svg/>", width: 1, height: 1 };
    expect(await frameSvg(built, null)).toBe(built);
  });
});

describe("chartDownloads", () => {
  it("names the CSV after the frame and writes its lines", () => {
    const spy = vi.spyOn(downloadFile, "downloadFile").mockImplementation(() => {});
    const formats = chartDownloads({ chartRef: { current: null }, name: "old-name", exportOptions: {}, csv: () => "﻿# T\r\nA\r\n1\r\n" });
    formats.csv(downloadFrame({ title: "Impact by income decile, 2027-28", now: NOW }));
    expect(spy.mock.calls[0][1]).toBe("impact-by-income-decile-2027-28.csv");
    expect(spy.mock.calls[0][0]).toContain("Chart: Impact by income decile, 2027-28");
    formats.csv();
    expect(spy.mock.calls[1][1]).toBe("old-name.csv");
    spy.mockRestore();
  });

  it("offers no image for an unpublished year or a table", () => {
    const base = { chartRef: { current: null }, name: "n", exportOptions: {}, csv: () => "a" };
    expect(Object.keys(chartDownloads({ ...base, published: false }))).toEqual(["csv"]);
    expect(Object.keys(chartDownloads({ ...base, image: false }))).toEqual(["csv"]);
    expect(Object.keys(chartDownloads(base))).toEqual(["csv", "png", "svg"]);
  });
});
