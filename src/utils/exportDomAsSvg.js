/**
 * The image downloads of a card drawn in HTML, not as a Recharts SVG (the
 * dumbbells, tile grids, tables, the region table): the card's plot redrawn
 * as a plain SVG from what the page shows, so it is as crisp as any other
 * chart's file and takes the same frame (exportFrame.frameSvg) round it.
 *
 * Each element's box is drawn from its on-screen position and computed
 * style (its fill, border and corner radius, so the token colours the page
 * uses), each line of text as SVG text at its place, and inline SVGs (icons)
 * as they are. Tooltips, the card's own logo (the frame draws it) and
 * anything visually hidden are left out; a box that clips its contents
 * (overflow hidden) clips them in the file too.
 *
 * Null where nothing can be measured (jsdom, a hidden card).
 */

// Never drawn: hover tips, the card's logo, its Download, screen-reader text
const SKIP = [
  "[role='tooltip']",
  ".chart-logo",
  ".chart-download",
  "[data-export='skip']",
  "script",
  "style",
  "template",
  "noscript",
].join(",");

// The SVG presentation properties an inline icon's elements keep, resolved
// (currentColor, var(--c-*)) from the page
const SVG_PROPS = [
  "fill",
  "fill-opacity",
  "stroke",
  "stroke-width",
  "stroke-opacity",
  "stroke-dasharray",
  "stroke-linecap",
  "stroke-linejoin",
  "opacity",
  "font-size",
  "font-weight",
  "font-family",
  "text-anchor",
  "dominant-baseline",
];

// Inter's ascent less half its content height: the baseline sits this many
// ems below the middle of a line's text box
const BASELINE_FROM_MIDDLE = 0.3633;

const escapeXml = (text) =>
  String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const round = (value) => Math.round(value * 100) / 100;

/** "rgba(1, 2, 3, 0.5)" -> { color: "rgb(1, 2, 3)", alpha: 0.5 }; null when transparent. */
export function parseColour(value) {
  if (!value || value === "transparent") return null;
  const match = value.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/);
  if (!match) return { color: value, alpha: 1 };
  let alpha = match[4] === undefined ? 1 : parseFloat(match[4]);
  if (match[4]?.endsWith("%")) alpha /= 100;
  if (!(alpha > 0)) return null;
  return { color: `rgb(${match[1]}, ${match[2]}, ${match[3]})`, alpha };
}

const px = (value) => parseFloat(value) || 0;

/** A corner radius ("4px", "50%") in pixels for a box of `size`. */
function radius(value, size) {
  if (!value) return 0;
  const first = String(value).split(/\s+/)[0];
  if (first.endsWith("%")) return (parseFloat(first) / 100) * size;
  return px(first);
}

function isHidden(element, style, rect) {
  if (style.display === "none") return true;
  if (element.matches?.(SKIP)) return true;
  // Screen-reader-only text: a 1px clipped box
  if (style.position === "absolute" && rect.width <= 1 && rect.height <= 1) return true;
  if (style.clip && /rect\(0(px)?,? 0(px)?,? 0(px)?,? 0(px)?\)/.test(style.clip)) return true;
  return false;
}

/** The box an element covers; for display: contents, its children's. */
function boxOf(element) {
  const rect = element.getBoundingClientRect();
  if (rect.width > 0 || rect.height > 0) return rect;
  let box = null;
  for (const child of Array.from(element.children)) {
    const style = getComputedStyle(child);
    const childRect = boxOf(child);
    if (isHidden(child, style, childRect) || !(childRect.width > 0 && childRect.height > 0)) continue;
    box = box
      ? {
          left: Math.min(box.left, childRect.left),
          top: Math.min(box.top, childRect.top),
          right: Math.max(box.right, childRect.right),
          bottom: Math.max(box.bottom, childRect.bottom),
        }
      : { left: childRect.left, top: childRect.top, right: childRect.right, bottom: childRect.bottom };
  }
  return box ? { ...box, width: box.right - box.left, height: box.bottom - box.top } : rect;
}

/** An <img> as a data URL (same-origin images), or null. */
function imageData(image) {
  try {
    if (image.src.startsWith("data:")) return image.src;
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    canvas.getContext("2d").drawImage(image, 0, 0);
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

/** An inline <svg> at its place, its styles resolved so it stands alone. */
function inlineSvg(element, rect) {
  const clone = element.cloneNode(true);
  const sources = [element, ...element.querySelectorAll("*")];
  const targets = [clone, ...clone.querySelectorAll("*")];
  sources.forEach((source, index) => {
    const target = targets[index];
    const style = getComputedStyle(source);
    const declarations = SVG_PROPS.map((prop) => {
      const value = style.getPropertyValue(prop);
      return value ? `${prop}: ${value}` : null;
    }).filter(Boolean);
    target.removeAttribute("class");
    if (declarations.length) target.setAttribute("style", declarations.join("; "));
  });
  if (!clone.getAttribute("viewBox")) {
    clone.setAttribute("viewBox", `0 0 ${round(rect.width)} ${round(rect.height)}`);
  }
  clone.setAttribute("x", round(rect.left));
  clone.setAttribute("y", round(rect.top));
  clone.setAttribute("width", round(rect.width));
  clone.setAttribute("height", round(rect.height));
  clone.removeAttribute("aria-hidden");
  return new XMLSerializer().serializeToString(clone).replace(/\sxmlns="http:\/\/www\.w3\.org\/2000\/svg"/, "");
}

/** A text node, one <text> per line it is laid out on. */
function textLines(node, style, opacity) {
  const raw = node.textContent;
  if (!raw || !raw.trim()) return [];
  const range = document.createRange();
  const words = [];
  for (const match of raw.matchAll(/\S+/g)) {
    range.setStart(node, match.index);
    range.setEnd(node, match.index + match[0].length);
    const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 || r.height > 0);
    if (!rects.length) continue;
    words.push({ text: match[0], rect: rects[0] });
  }
  range.detach?.();
  const lines = [];
  for (const word of words) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.rect.top - word.rect.top) < word.rect.height / 2) {
      last.words.push(word.text);
      last.right = word.rect.right;
    } else {
      lines.push({ words: [word.text], rect: word.rect, right: word.rect.right });
    }
  }
  const fill = parseColour(style.color);
  if (!fill) return [];
  const size = px(style.fontSize);
  const transform = style.textTransform;
  const spacing = style.letterSpacing && style.letterSpacing !== "normal" ? px(style.letterSpacing) : 0;
  return lines.map((line) => {
    let text = line.words.join(" ");
    if (transform === "uppercase") text = text.toUpperCase();
    else if (transform === "lowercase") text = text.toLowerCase();
    const y = line.rect.top + line.rect.height / 2 + size * BASELINE_FROM_MIDDLE;
    const alpha = fill.alpha * opacity;
    return {
      box: { left: line.rect.left, top: line.rect.top, right: line.right, bottom: line.rect.bottom },
      svg:
        `<text x="${round(line.rect.left)}" y="${round(y)}" fill="${fill.color}"` +
        (alpha < 1 ? ` fill-opacity="${round(alpha)}"` : "") +
        ` font-family="${escapeXml(style.fontFamily)}" font-size="${round(size)}" font-weight="${style.fontWeight}"` +
        (style.fontStyle === "italic" ? ' font-style="italic"' : "") +
        (spacing ? ` letter-spacing="${round(spacing)}"` : "") +
        ` xml:space="preserve">${escapeXml(text)}</text>`,
    };
  });
}

/** An element's fill and border, as SVG. */
function boxShapes(rect, style, opacity) {
  if (!(rect.width > 0 && rect.height > 0)) return [];
  const shapes = [];
  // A % radius is an ellipse's; a length one is circular, at most half the
  // shorter side (a pill's 999px)
  const percent = String(style.borderTopLeftRadius).trim().endsWith("%");
  const rx = percent
    ? Math.min(radius(style.borderTopLeftRadius, rect.width), rect.width / 2)
    : Math.min(radius(style.borderTopLeftRadius, 0), rect.width / 2, rect.height / 2);
  const ry = percent ? Math.min(radius(style.borderTopLeftRadius, rect.height), rect.height / 2) : rx;
  const corner = rx > 0 ? ` rx="${round(rx)}" ry="${round(ry)}"` : "";
  const background = parseColour(style.backgroundColor);
  if (background) {
    const alpha = background.alpha * opacity;
    shapes.push(
      `<rect x="${round(rect.left)}" y="${round(rect.top)}" width="${round(rect.width)}" height="${round(rect.height)}"${corner} fill="${background.color}"${alpha < 1 ? ` fill-opacity="${round(alpha)}"` : ""}/>`,
    );
  }
  const sides = ["Top", "Right", "Bottom", "Left"].map((side) => ({
    side,
    width: style[`border${side}Style`] === "none" || style[`border${side}Style`] === "hidden" ? 0 : px(style[`border${side}Width`]),
    colour: parseColour(style[`border${side}Color`]),
    dashed: style[`border${side}Style`] === "dashed" || style[`border${side}Style`] === "dotted",
  }));
  const drawn = sides.filter((s) => s.width > 0 && s.colour);
  if (!drawn.length) return shapes;
  const dash = (s) => (s.dashed ? ` stroke-dasharray="${round(s.width * 3)} ${round(s.width * 2)}"` : "");
  const alpha = (s) => s.colour.alpha * opacity;
  const same =
    drawn.length === 4 && drawn.every((s) => s.width === drawn[0].width && s.colour.color === drawn[0].colour.color);
  if (same) {
    const s = drawn[0];
    const half = s.width / 2;
    const innerRx = Math.max(0, rx - half);
    const innerRy = Math.max(0, ry - half);
    shapes.push(
      `<rect x="${round(rect.left + half)}" y="${round(rect.top + half)}" width="${round(rect.width - s.width)}" height="${round(rect.height - s.width)}"` +
        (innerRx > 0 ? ` rx="${round(innerRx)}" ry="${round(innerRy)}"` : "") +
        ` fill="none" stroke="${s.colour.color}" stroke-width="${round(s.width)}"${alpha(s) < 1 ? ` stroke-opacity="${round(alpha(s))}"` : ""}${dash(s)}/>`,
    );
    return shapes;
  }
  for (const s of drawn) {
    const half = s.width / 2;
    const [x1, y1, x2, y2] = {
      Top: [rect.left, rect.top + half, rect.right, rect.top + half],
      Bottom: [rect.left, rect.bottom - half, rect.right, rect.bottom - half],
      Left: [rect.left + half, rect.top, rect.left + half, rect.bottom],
      Right: [rect.right - half, rect.top, rect.right - half, rect.bottom],
    }[s.side];
    shapes.push(
      `<line x1="${round(x1)}" y1="${round(y1)}" x2="${round(x2)}" y2="${round(y2)}" stroke="${s.colour.color}" stroke-width="${round(s.width)}"${alpha(s) < 1 ? ` stroke-opacity="${round(alpha(s))}"` : ""}${dash(s)}/>`,
    );
  }
  return shapes;
}

/**
 * Draw `elements` (top to bottom on the page: a plot, then its legend) as
 * one SVG, in the page's own layout.
 *
 * @param {Element[]} elements
 * @returns {{svg: string, width: number, height: number, legendTop?: number}|null}
 *   `legendTop` where a second element (the legend) starts
 */
export function buildDomSvg(elements) {
  const roots = elements.filter(Boolean);
  if (!roots.length || typeof document === "undefined" || typeof getComputedStyle !== "function") return null;
  const bounds = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
  const NO_CLIP = { left: -Infinity, top: -Infinity, right: Infinity, bottom: Infinity };
  // What is drawn widens the file, as far as the box clipping it
  const grow = (box, clip = NO_CLIP) => {
    const left = Math.max(box.left, clip.left);
    const top = Math.max(box.top, clip.top);
    const right = Math.min(box.right, clip.right);
    const bottom = Math.min(box.bottom, clip.bottom);
    if (!(right >= left && bottom >= top)) return;
    bounds.left = Math.min(bounds.left, left);
    bounds.top = Math.min(bounds.top, top);
    bounds.right = Math.max(bounds.right, right);
    bounds.bottom = Math.max(bounds.bottom, bottom);
  };
  const outside = (box, clip) =>
    box.right < clip.left || box.left > clip.right || box.bottom < clip.top || box.top > clip.bottom;
  const clips = [];

  const walk = (element, parentOpacity, clip) => {
    const rect = element.getBoundingClientRect();
    // Scrolled out of its box: nothing of it shows
    if ((rect.width > 0 || rect.height > 0) && outside(rect, clip)) return "";
    const style = getComputedStyle(element);
    if (isHidden(element, style, rect)) return "";
    const opacity = parentOpacity * (style.opacity === "" ? 1 : parseFloat(style.opacity));
    if (!(opacity > 0)) return "";
    const visible = style.visibility !== "hidden" && style.visibility !== "collapse";
    const tag = element.tagName.toLowerCase();

    if (tag === "svg") {
      if (!visible || !(rect.width > 0 && rect.height > 0)) return "";
      grow(rect, clip);
      const svg = inlineSvg(element, rect);
      return opacity < 1 ? `<g opacity="${round(opacity)}">${svg}</g>` : svg;
    }
    if (tag === "img") {
      if (!visible || !(rect.width > 0 && rect.height > 0)) return "";
      const href = imageData(element);
      if (!href) return "";
      grow(rect, clip);
      return `<image x="${round(rect.left)}" y="${round(rect.top)}" width="${round(rect.width)}" height="${round(rect.height)}" href="${href}"${opacity < 1 ? ` opacity="${round(opacity)}"` : ""}/>`;
    }

    const parts = [];
    if (visible) {
      const shapes = boxShapes(rect, style, opacity);
      if (shapes.length) grow(rect, clip);
      parts.push(...shapes);
    }
    // A box that clips: overflow hidden, or a scroll box taller than it
    // shows (the file shows what the page does). A box that scrolls
    // sideways (a wide table on a phone) is drawn whole.
    const clipX = /hidden|clip/.test(style.overflowX);
    const clipY =
      /hidden|clip/.test(style.overflowY) ||
      (/auto|scroll/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 1);
    const clipping = (clipX || clipY) && rect.width > 0 && rect.height > 0;
    const own = clipping
      ? {
          left: clipX ? Math.max(clip.left, rect.left) : clip.left,
          right: clipX ? Math.min(clip.right, rect.right) : clip.right,
          top: clipY ? Math.max(clip.top, rect.top) : clip.top,
          bottom: clipY ? Math.min(clip.bottom, rect.bottom) : clip.bottom,
        }
      : clip;
    const children = [];
    for (const node of Array.from(element.childNodes)) {
      if (node.nodeType === 1) {
        children.push(walk(node, opacity, own));
      } else if (node.nodeType === 3 && visible) {
        for (const line of textLines(node, style, opacity)) {
          if (outside(line.box, own)) continue;
          grow(line.box, own);
          children.push(line.svg);
        }
      }
    }
    const inner = children.join("");
    if (inner && clipping) {
      const id = `dom-clip-${clips.length}`;
      const [x, w] = clipX ? [rect.left, rect.width] : [rect.left - 1e4, rect.width + 2e4];
      const [y, h] = clipY ? [rect.top, rect.height] : [rect.top - 1e4, rect.height + 2e4];
      clips.push(
        `<clipPath id="${id}"><rect x="${round(x)}" y="${round(y)}" width="${round(w)}" height="${round(h)}"/></clipPath>`,
      );
      parts.push(`<g clip-path="url(#${id})">${inner}</g>`);
    } else {
      parts.push(inner);
    }
    return parts.join("");
  };

  const drawn = [];
  const tops = [];
  for (const root of roots) {
    const box = boxOf(root);
    if (!(box.width > 0 && box.height > 0)) continue;
    grow(box);
    tops.push(box.top);
    drawn.push(walk(root, 1, NO_CLIP));
  }
  if (!drawn.length || !(bounds.right > bounds.left) || !(bounds.bottom > bounds.top)) return null;

  const PAD = 4;
  const left = Math.floor(bounds.left) - PAD;
  const top = Math.floor(bounds.top) - PAD;
  const width = Math.ceil(bounds.right) + PAD - left;
  const height = Math.ceil(bounds.bottom) + PAD - top;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    (clips.length ? `<defs>${clips.join("")}</defs>` : "") +
    `<g transform="translate(${-left} ${-top})">${drawn.join("")}</g>` +
    "</svg>";
  const legendTop = tops.length > 1 ? tops[1] - top - 2 : null;
  return { svg, width, height, ...(legendTop > 0 && legendTop < height ? { legendTop } : {}) };
}

/**
 * The plot of a card drawn in HTML and its key: `root`, then the card's
 * `.chart-legend` where that is outside it and shows something.
 */
export function domExportElements(root) {
  if (!root) return [];
  const legend = root.parentElement?.querySelector(":scope > .chart-legend");
  const withLegend = legend && !root.contains(legend) && legend.textContent.trim() ? [legend] : [];
  return [root, ...withLegend];
}
