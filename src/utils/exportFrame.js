/**
 * The frame every downloaded chart image gets, so the file explains itself
 * away from the page: a header with the chart's title (with its year or
 * years) and a line saying what is shown (the policies, the Options
 * choices), the plot as the chart's own builder drew it, then a footer with
 * the source, the provisional label while the figures are provisional, the
 * date, and the PolicyEngine logo.
 *
 * One path for every chart and the map: ChartDownloadMenu composes the
 * frame (downloadFrame) when a download runs and hands it to the format;
 * chartDownloads and the map wrap their built SVG in it (frameSvg). The CSV
 * gets the same facts as leading "#" lines (frameCsv), and every file is
 * named after the framed title (frameFileName).
 */
import { CHART_COLOURS } from "./chartTheme";

export const EXPORT_SOURCE = "Source: PolicyEngine UK, UK Autumn Budget 2026 dashboard";

// The dashboard's face (Inter), then the system faces it falls back to
const FONT = "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
// The image's width in CSS pixels (2x in the PNG: 2400 pixels)
export const FRAME_WIDTH = 1200;
// The plot is scaled to fill the frame's width, a half-width card's plot
// as much as a full-width one's, unless that makes it taller than this
export const MAX_PLOT_HEIGHT = 1000;
// A legend below the plot is scaled apart from it, no more than this, so a
// half-width card's legend does not grow with its plot
export const MAX_LEGEND_SCALE = 1.25;
const PAD = 32;
const TITLE_SIZE = 24;
const SUBTITLE_SIZE = 15;
const FOOTER_SIZE = 13;
const LINE = 1.4;

const YEAR = /\b\d{4}-\d{2}\b/;

/** "27 October 2026" */
export function exportDate(now = new Date()) {
  return now.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

/** The chart's title with the period it shows, when the title has none. */
export function titleWithPeriod(title, period) {
  if (!title) return period ?? "Chart";
  return period && !YEAR.test(title) ? `${title}, ${period}` : title;
}

/** "Impact by income decile, 2027-28" -> "impact-by-income-decile-2027-28" */
export function slugify(text) {
  return String(text)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/£/g, "")
    .replace(/%/g, "pc")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120)
    .replace(/-+$/g, "");
}

/** The file name (without extension) for a frame, or `fallback` with none. */
export function frameFileName(frame, fallback) {
  const slug = frame?.title ? slugify(frame.title) : "";
  return slug || fallback;
}

/**
 * The frame for one download.
 *
 * @param {Object} spec
 * @param {string} spec.title - The chart's title
 * @param {string} [spec.period] - Its year or years, added when the title has none
 * @param {string|null} [spec.policies] - "All 9 policies", or the names
 * @param {string} [spec.selection] - The Options choices ("% of net income · Before housing costs")
 * @param {string|null} [spec.provisional] - The provisional label, while provisional
 * @param {Date} [spec.now]
 * @returns {{title: string, subtitle: string, footer: string, policies: string|null,
 *   selection: string, provisional: string|null, date: string}}
 */
export function downloadFrame({ title, period, policies = null, selection = "", provisional = null, now } = {}) {
  const date = exportDate(now);
  return {
    title: titleWithPeriod(title, period),
    subtitle: [policies, selection].filter(Boolean).join(" · "),
    footer: [EXPORT_SOURCE, provisional, date].filter(Boolean).join(" · "),
    policies,
    selection: selection || "",
    provisional,
    date,
  };
}

/**
 * The CSV with the frame's facts as leading "#" lines, after the file's
 * own (its title and units), before the header row: every reader that
 * skips "#" lines reads it as before.
 */
export function frameCsv(csvText, frame) {
  if (!frame) return csvText;
  const bom = csvText.startsWith("﻿") ? "﻿" : "";
  const body = bom ? csvText.slice(1) : csvText;
  const eol = body.includes("\r\n") ? "\r\n" : "\n";
  const lines = body.split(eol);
  let lead = 0;
  while (lead < lines.length && /^"?#/.test(lines[lead])) lead += 1;
  const quote = (text) => (/[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text);
  const extra = [
    `# Chart: ${frame.title}`,
    frame.policies && `# Policies: ${frame.policies}`,
    frame.selection && `# Options: ${frame.selection}`,
    `# ${frame.footer}`,
  ]
    .filter(Boolean)
    .map(quote);
  return bom + [...lines.slice(0, lead), ...extra, ...lines.slice(lead)].join(eol);
}

const escapeXml = (text) =>
  String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

let measureContext;
/** Text width in pixels; an estimate where there is no canvas (tests). */
export function measure(text, size, weight = 400) {
  if (measureContext === undefined) {
    try {
      measureContext = document.createElement("canvas").getContext("2d") ?? null;
    } catch {
      measureContext = null;
    }
  }
  if (!measureContext) return text.length * size * 0.55;
  measureContext.font = `${weight} ${size}px ${FONT}`;
  return measureContext.measureText(text).width;
}

/** Word-wrap `text` to `width`. */
export function wrapLines(text, width, size, weight = 400) {
  const lines = [];
  let line = "";
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && measure(next, size, weight) > width) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function textBlock(lines, { x, y, size, weight, fill }) {
  const tspans = lines
    .map((line, index) => `<tspan x="${x}" dy="${index === 0 ? 0 : size * LINE}">${escapeXml(line)}</tspan>`)
    .join("");
  return `<text x="${x}" y="${y}" fill="${fill}" font-family="${escapeXml(FONT)}" font-size="${size}" font-weight="${weight}" style="font-family: ${escapeXml(FONT)}; font-size: ${size}px; font-weight: ${weight}; fill: ${fill};">${tspans}</text>`;
}

/** An image as a data URL, so the file needs nothing else; null if it fails. */
async function logoDataUrl(href) {
  if (!href || typeof Image === "undefined") return null;
  if (href.startsWith("data:")) return href;
  return new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    const timer = setTimeout(() => resolve(null), 3000);
    image.onload = () => {
      clearTimeout(timer);
      try {
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        canvas.getContext("2d").drawImage(image, 0, 0);
        resolve(canvas.toDataURL("image/png"));
      } catch {
        resolve(null);
      }
    };
    image.onerror = () => {
      clearTimeout(timer);
      resolve(null);
    };
    image.src = href;
  });
}

/**
 * How much the plot is scaled: to the frame's inner width, whatever the
 * card's width on the page, unless that makes it taller than
 * MAX_PLOT_HEIGHT; the aspect ratio is kept.
 */
export function plotScale(built, inner = FRAME_WIDTH - PAD * 2) {
  if (!(built?.width > 0) || !(built?.height > 0)) return 1;
  return Math.min(inner / built.width, MAX_PLOT_HEIGHT / built.height);
}

/**
 * The parts of a built export the frame draws, top to bottom, each with
 * its own scale: the plot filling the width (plotScale), then its legend,
 * where the builder marks one (legendTop), at no more than
 * MAX_LEGEND_SCALE. Without a legend, the whole at the plot's scale.
 *
 * @returns {Array<{top: number, sourceHeight: number, width: number, height: number}>}
 *   `top` and `sourceHeight` in the built SVG's units, the size in the frame's
 */
export function framePieces(built, inner = FRAME_WIDTH - PAD * 2) {
  const split = built.legendTop > 0 && built.legendTop < built.height ? built.legendTop : null;
  const plot = { width: built.width, height: split ?? built.height };
  const scale = plotScale(plot, inner);
  const pieces = [{ top: 0, sourceHeight: plot.height, width: built.width * scale, height: plot.height * scale }];
  if (split) {
    const legendScale = Math.min(scale, MAX_LEGEND_SCALE);
    const sourceHeight = built.height - split;
    pieces.push({ top: split, sourceHeight, width: built.width * legendScale, height: sourceHeight * legendScale });
  }
  return pieces;
}

const toBase64 = (buffer) => {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
};

/**
 * The page's own Inter faces (the @font-face rules next/font writes, under
 * its family name, which the plot's inlined styles name first), as CSS
 * with each file inlined as a data URL, declared under that name and as
 * "Inter". "" where there is none (tests) or it cannot be read.
 */
export async function fontFaceCss(doc = typeof document === "undefined" ? null : document) {
  if (!doc?.styleSheets) return "";
  const faces = [];
  for (const sheet of Array.from(doc.styleSheets)) {
    let rules;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    for (const rule of Array.from(rules ?? [])) {
      if (rule.type !== 5 /* CSSRule.FONT_FACE_RULE */) continue;
      const family = rule.style.getPropertyValue("font-family").replace(/["']/g, "").trim();
      if (!/inter/i.test(family) || /fallback/i.test(family)) continue;
      const url = rule.style.getPropertyValue("src").match(/url\(\s*["']?([^"')]+)["']?\s*\)/)?.[1];
      if (url) faces.push({ family, url, rule });
    }
  }
  const css = [];
  for (const { family, url, rule } of faces) {
    try {
      const href = new URL(url, rule.parentStyleSheet?.href || doc.baseURI).href;
      const response = await fetch(href);
      if (!response.ok) continue;
      const data = `data:font/woff2;base64,${toBase64(await response.arrayBuffer())}`;
      const weight = rule.style.getPropertyValue("font-weight") || "100 900";
      const style = rule.style.getPropertyValue("font-style") || "normal";
      for (const name of family.toLowerCase() === "inter" ? [family] : [family, "Inter"]) {
        css.push(
          `@font-face{font-family:"${name}";src:url(${data}) format("woff2");font-weight:${weight};font-style:${style};}`,
        );
      }
    } catch {
      // Left to the fallback faces
    }
  }
  return css.join("");
}

let fontCssPromise;
/** fontFaceCss, read once a page (and only once it is non-empty). */
async function embeddedFontCss() {
  if (!fontCssPromise) {
    fontCssPromise = fontFaceCss().catch(() => "");
  }
  const css = await fontCssPromise;
  if (!css) fontCssPromise = undefined;
  return css;
}

/**
 * Wrap a built export ({svg, width, height}: the plot and its legend, no
 * title or logo) in the frame: header, plot scaled to the frame's width,
 * footer with the logo. Returns the same shape.
 *
 * @param {{svg: string, width: number, height: number}|null} built
 * @param {Object|null} frame - From downloadFrame
 * @param {{logo?: {href: string, width: number, height: number}, logoHref?: string}} [options]
 *   `logoHref` is an embedded (data URL) logo, used as is
 */
export async function frameSvg(built, frame, { logo } = {}) {
  if (!built || !frame) return built;
  const width = FRAME_WIDTH;
  const inner = width - PAD * 2;
  const pieces = framePieces(built, inner);
  const plotHeight = pieces.reduce((sum, piece) => sum + piece.height, 0);

  // Header: the title, then what is shown
  const titleLines = wrapLines(frame.title, inner, TITLE_SIZE, 600);
  const subtitleLines = frame.subtitle ? wrapLines(frame.subtitle, inner, SUBTITLE_SIZE) : [];
  let y = PAD + TITLE_SIZE;
  const parts = [textBlock(titleLines, { x: PAD, y, size: TITLE_SIZE, weight: 600, fill: CHART_COLOURS.text })];
  y += (titleLines.length - 1) * TITLE_SIZE * LINE;
  if (subtitleLines.length) {
    y += SUBTITLE_SIZE * LINE + 6;
    parts.push(textBlock(subtitleLines, { x: PAD, y, size: SUBTITLE_SIZE, weight: 400, fill: CHART_COLOURS.axisTitle }));
    y += (subtitleLines.length - 1) * SUBTITLE_SIZE * LINE;
  }
  const plotTop = y + 20;

  // Footer: a rule, the source line on the left, the logo on the right
  const logoWidth = logo?.width ? logo.width * 1.25 : 0;
  const logoHeight = logo?.height ? logo.height * 1.25 : 0;
  const footerLines = wrapLines(frame.footer, inner - (logoWidth ? logoWidth + 24 : 0), FOOTER_SIZE);
  const footerTextHeight = FOOTER_SIZE + (footerLines.length - 1) * FOOTER_SIZE * LINE;
  const footerHeight = Math.max(footerTextHeight, logoHeight);
  const ruleY = plotTop + plotHeight + 16;
  const footerTop = ruleY + 16;
  const height = Math.ceil(footerTop + footerHeight + PAD);

  parts.push(`<line x1="${PAD}" y1="${ruleY}" x2="${width - PAD}" y2="${ruleY}" stroke="${CHART_COLOURS.grid}" stroke-width="1"/>`);
  parts.push(
    textBlock(footerLines, {
      x: PAD,
      y: footerTop + (footerHeight - footerTextHeight) / 2 + FOOTER_SIZE * 0.85,
      size: FOOTER_SIZE,
      weight: 400,
      fill: CHART_COLOURS.tick,
    }),
  );
  const logoHref = logo?.href ? await logoDataUrl(logo.href) : null;
  if (logoHref) {
    parts.push(
      `<image x="${width - PAD - logoWidth}" y="${footerTop + (footerHeight - logoHeight) / 2}" width="${logoWidth}" height="${logoHeight}" href="${logoHref}" xlink:href="${logoHref}"/>`,
    );
  }

  // Inter, embedded, so the PNG (drawn from the SVG as an image, which
  // sees none of the page's fonts) and the SVG away from the page use it
  const fontCss = await embeddedFontCss();

  // The plot (and its legend): the built SVG as nested <svg>s, each
  // showing its part through its viewBox, scaled and centred
  const body = built.svg.replace(/^\s*<\?xml[^>]*\?>\s*/, "");
  let pieceTop = plotTop;
  const plot = pieces
    .map((piece) => {
      const x = PAD + (inner - piece.width) / 2;
      const nested = body.replace(/^<svg\b([^>]*)>/, (match, attributes) => {
        const kept = attributes
          .replace(/\s(width|height|x|y)="[^"]*"/g, "")
          .replace(/\sviewBox="[^"]*"/, "");
        return `<svg${kept} x="${x}" y="${pieceTop}" width="${piece.width}" height="${piece.height}" viewBox="0 ${piece.top} ${built.width} ${piece.sourceHeight}">`;
      });
      pieceTop += piece.height;
      return nested;
    })
    .join("");

  const svg =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<title>${escapeXml(frame.title)}</title>` +
    `<desc>${escapeXml([frame.subtitle, frame.footer].filter(Boolean).join(". "))}</desc>` +
    (fontCss ? `<defs><style>${fontCss}</style></defs>` : "") +
    `<rect x="0" y="0" width="${width}" height="${height}" fill="${CHART_COLOURS.surface}"/>` +
    parts.join("") +
    plot +
    "</svg>";
  return { svg, width, height };
}
