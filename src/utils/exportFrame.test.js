import { describe, expect, it, vi } from "vitest";
import { buildChartCsv } from "./chartCsv";
import {
  EXPORT_FONT,
  MAX_PLOT_HEIGHT,
  downloadFrame,
  fontFaceCss,
  frameCsv,
  frameFileName,
  frameSvg,
  framePieces,
  plotScale,
  slugify,
  titleWithPeriod,
} from "./exportFrame";
import { buildChartSvg } from "./exportChartAsSvg";
import { cardSelection, policiesLabel } from "./downloadContext";
import { chartDownloads } from "./chartDownloads";
import { TICK_STYLE } from "./chartTheme";
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
  it("draws the title and subtitle above the plot at 1200px, and no source line or rule below it", async () => {
    const built = { svg: '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400" viewBox="0 0 800 400"><rect width="10" height="10"/></svg>', width: 800, height: 400 };
    const frame = downloadFrame({ title: "Revenue impact", period: "2027-28 to 2031-32", policies: "All 9 policies", now: NOW });
    const out = await frameSvg(built, frame, {});
    expect(out.width).toBe(1200);
    expect(out.height).toBeGreaterThan(400 * 1.42);
    expect(out.svg).toContain("Revenue impact, 2027-28 to 2031-32");
    expect(out.svg).toContain("All 9 policies");
    expect(out.svg).not.toContain("Source: PolicyEngine UK");
    expect(out.svg).not.toContain("27 October 2026");
    expect(out.svg).not.toContain("<line");
    expect(out.svg).toContain('viewBox="0 0 800 400"');
    expect(new DOMParser().parseFromString(out.svg, "image/svg+xml").querySelector("parsererror")).toBeNull();
  });

  it("fills the width with a half-width card's plot as with a full-width one's", async () => {
    const frame = downloadFrame({ title: "Impact by income decile, 2027-28", now: NOW });
    for (const [w, h] of [[548, 460], [1118, 540]]) {
      const built = { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"/>`, width: w, height: h };
      const out = await frameSvg(built, frame, {});
      const nested = out.svg.match(/<svg[^>]*x="([\d.]+)"[^>]*width="([\d.]+)" height="([\d.]+)" viewBox="0 0 \d+ \d+"/);
      expect(Number(nested[1])).toBeCloseTo(32);
      expect(Number(nested[2])).toBeCloseTo(1136);
      expect(Number(nested[3]) / Number(nested[2])).toBeCloseTo(h / w);
    }
  });

  it("scales a legend below the plot at the plot's own scale", async () => {
    const built = { svg: '<svg xmlns="http://www.w3.org/2000/svg" width="548" height="662"/>', width: 548, height: 662, legendTop: 446 };
    const [plot, legend] = framePieces(built);
    expect(plot).toMatchObject({ top: 0, sourceHeight: 446 });
    expect(plot.width).toBeCloseTo(1136);
    expect(legend.top).toBe(446);
    expect(legend.width).toBeCloseTo(plot.width);
    expect(legend.height / 216).toBeCloseTo(plot.width / 548);
    const out = await frameSvg(built, downloadFrame({ title: "T", now: NOW }), {});
    expect(out.svg).toContain('viewBox="0 0 548 446"');
    expect(out.svg).toContain('viewBox="0 446 548 216"');
    expect(framePieces({ width: 800, height: 400 })).toHaveLength(1);
  });

  it("keeps the aspect ratio and caps the height of a tall plot", () => {
    expect(plotScale({ width: 500, height: 410 })).toBeCloseTo(1136 / 500);
    expect(plotScale({ width: 400, height: 800 }) * 800).toBeCloseTo(MAX_PLOT_HEIGHT);
  });

  it("embeds the page's Inter faces as data URLs, under next/font's name and as Inter", async () => {
    const rule = (family, src) => ({
      type: 5,
      parentStyleSheet: { href: "http://localhost/_next/static/css/a.css" },
      style: { getPropertyValue: (name) => ({ "font-family": family, src, "font-weight": "100 900", "font-style": "normal" })[name] ?? "" },
    });
    const doc = {
      baseURI: "http://localhost/",
      styleSheets: [
        { cssRules: [rule("'inter'", 'url("../media/inter.woff2") format("woff2")'), rule("'inter Fallback'", 'local("Arial")')] },
        { get cssRules() { throw new Error("cross-origin"); } },
      ],
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer });
    const css = await fontFaceCss(doc);
    expect(fetchSpy).toHaveBeenCalledWith("http://localhost/_next/static/media/inter.woff2");
    expect(css).toContain('font-family:"inter";src:url(data:font/woff2;base64,AQID)');
    expect(css).not.toMatch(/Fallback/);
    fetchSpy.mockRestore();
    expect(await fontFaceCss({ styleSheets: [] })).toBe("");
  });

  it("is left alone without a frame", async () => {
    const built = { svg: "<svg/>", width: 1, height: 1 };
    expect(await frameSvg(built, null)).toBe(built);
  });
});

describe("the built plot", () => {
  it("keeps the tick labels drawn below the on-screen box less the legend space", async () => {
    document.body.innerHTML = `<div id="c"><div class="recharts-wrapper"><svg width="500" height="410" viewBox="0 0 500 410"><text y="398">10th</text></svg></div></div>`;
    const svg = document.querySelector("svg");
    svg.getBoundingClientRect = () => ({ width: 500, height: 410 });
    svg.getBBox = () => ({ x: 0, y: 2, width: 492, height: 400 });
    const built = await buildChartSvg({ current: document.getElementById("c") }, {});
    // The drawing (2 to 402) and 4px under it, not 410 less 60 for a legend
    expect(built.height).toBe(24 + 406 + 24);
    expect(built.svg).toMatch(/<rect x="0" y="0" width="500" height="406"/);
  });
});

describe("the downloaded footer and legend", () => {
  it("ends the image with the logo alone: no source, provisional or date line, no rule", async () => {
    const built = { svg: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400"/>', width: 800, height: 400 };
    const frame = downloadFrame({ title: "T", provisional: "Provisional figures", now: NOW });
    const logo = { href: "data:image/png;base64,AAAA", width: 100, height: 20 };
    const out = await frameSvg(built, frame, { logo });
    expect(out.svg).toContain('<image x="1043" y=');
    expect(out.svg).not.toMatch(/Source:|Provisional|27 October 2026|<line/);
    // The CSV keeps those facts
    expect(frameCsv("A\n1", frame)).toContain("Provisional figures");
  });

  it("draws the legend in the plot's tick text: its face, size and colour", async () => {
    // jsdom has no canvas: measure text at 7px a character
    const canvas = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue({ font: "", measureText: (text) => ({ width: text.length * 7 }) });
    document.body.innerHTML = '<div id="c"><div class="recharts-wrapper"><svg xmlns="http://www.w3.org/2000/svg" width="500" height="410"></svg></div></div>';
    const svg = document.querySelector("svg");
    svg.getBoundingClientRect = () => ({ width: 500, height: 410 });
    const built = await buildChartSvg({ current: document.getElementById("c") }, {
      legendItems: [{ label: "Policy A", color: "#2C6496", type: "rect" }],
    });
    const label = new DOMParser().parseFromString(built.svg, "image/svg+xml").querySelector(".exported-legend text");
    expect(label.getAttribute("font-family")).toBe(EXPORT_FONT);
    expect(label.getAttribute("font-size")).toBe(`${TICK_STYLE.fontSize}px`);
    expect(label.getAttribute("fill")).toBe(TICK_STYLE.fill);
    expect(label.getAttribute("font-weight")).toBe("400");
    canvas.mockRestore();
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
