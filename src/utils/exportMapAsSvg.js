/**
 * Export the constituency map as a standalone SVG file, with a title, a
 * description and, when a constituency is selected, its card.
 *
 * The map's own SVG carries everything else: the seats with their fills
 * as attributes, the hatch pattern in <defs> and the legend. The export
 * clones it as it is, so the file shows exactly what the page shows.
 */

import {
  createSvgElement,
  createSvgText,
  createSvgRect,
  createSvgGroup,
  createSvgTspan,
  addSvgNamespaces,
  serializeSvg,
  DEFAULT_FONT,
} from "./svgHelpers";
import { downloadSvg } from "./downloadFile";
import { LEGEND_INSET, MAP_LEGEND_CLASS } from "./geography/legend";
import { CHART_COLOURS } from "./chartTheme";

/** The class of the map's zoomable group, whose transform is reset. */
export const MAP_ZOOM_LAYER_CLASS = "map-zoom-layer";

// How long to wait for the logo before exporting without it.
const LOGO_TIMEOUT_MS = 3000;

/**
 * An image as a data URL, so the exported file needs nothing else. A data
 * URL is used as it is.
 *
 * @param {string} url - URL or path to the image
 * @returns {Promise<string>}
 */
async function imageToBase64(url) {
  if (url.startsWith("data:")) return url;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("the logo did not load")),
      LOGO_TIMEOUT_MS,
    );
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      clearTimeout(timer);
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = (error) => {
      clearTimeout(timer);
      reject(error);
    };
    img.src = url;
  });
}

// Style constants
const STYLES = {
  padding: 20,
  titleFontSize: 18,
  descriptionFontSize: 13,
  lineHeight: 1.5,
  titleDescGap: 8,
  footerHeight: 40,
  cardWidth: 250,
  cardPadding: 12,
  cardRadius: 8,
  cardWrap: 40,
  colors: {
    title: CHART_COLOURS.text,
    description: CHART_COLOURS.axisTitle,
    background: CHART_COLOURS.surface,
    cardBorder: CHART_COLOURS.grid,
    cardText: CHART_COLOURS.axisTitle,
    gain: CHART_COLOURS.gainText,
    loss: CHART_COLOURS.lossText,
    neutral: CHART_COLOURS.axisTitle,
  },
};

/**
 * Wrap text to fit within a maximum character width.
 *
 * @param {string} text - Text to wrap
 * @param {number} maxCharsPerLine - Maximum characters per line
 * @returns {string[]} - Array of lines
 */
function wrapTextSimple(text, maxCharsPerLine = 100) {
  const words = text.split(" ");
  const lines = [];
  let currentLine = "";

  words.forEach((word) => {
    if (currentLine && (currentLine + " " + word).length > maxCharsPerLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = currentLine ? currentLine + " " + word : word;
    }
  });

  if (currentLine) lines.push(currentLine);
  return lines;
}

/**
 * Calculate header height based on title and description.
 *
 * @param {string} title - Chart title
 * @param {string} description - Chart description
 * @returns {number} - Header height in pixels
 */
function calculateHeaderHeight(title, description) {
  const {
    padding,
    titleFontSize,
    descriptionFontSize,
    lineHeight,
    titleDescGap,
  } = STYLES;

  let height = padding; // Top padding

  if (title) {
    height += titleFontSize + titleDescGap;
  }

  if (description) {
    const lines = wrapTextSimple(description);
    height += lines.length * descriptionFontSize * lineHeight;
  }

  height += padding; // Bottom padding before content

  return height;
}

/**
 * Create the title element.
 *
 * @param {string} title - Title text
 * @param {number} y - Y position
 * @returns {SVGTextElement}
 */
function createTitle(title, y) {
  return createSvgText(title, {
    x: STYLES.padding,
    y,
    fontSize: STYLES.titleFontSize,
    fontWeight: "600",
    fill: STYLES.colors.title,
  });
}

/**
 * Create the description element with word wrapping.
 *
 * @param {string} description - Description text
 * @param {number} y - Y position
 * @returns {SVGTextElement}
 */
function createDescription(description, y) {
  const { padding, descriptionFontSize, lineHeight, colors } = STYLES;

  const textElement = createSvgElement("text", { x: padding, y });
  textElement.setAttribute(
    "style",
    `font-family: ${DEFAULT_FONT}; font-size: ${descriptionFontSize}px; font-weight: 400; fill: ${colors.description};`,
  );

  const lines = wrapTextSimple(description);

  lines.forEach((line, index) => {
    const tspan = createSvgTspan(line, {
      x: padding,
      dy: index === 0 ? "0" : `${descriptionFontSize * lineHeight}px`,
    });
    textElement.appendChild(tspan);
  });

  return textElement;
}

const DIRECTION_COLOURS = {
  gain: STYLES.colors.gain,
  loss: STYLES.colors.loss,
};

/** How each kind of card line is set: size, weight, and the gap above. */
function lineStyle(line) {
  switch (line.kind) {
    case "value":
      return {
        fontSize: 18,
        fontWeight: "700",
        fill: DIRECTION_COLOURS[line.direction] ?? STYLES.colors.neutral,
        gap: 24,
      };
    case "interval":
      return {
        fontSize: line.emphasis ? 13 : 12,
        fontWeight: line.emphasis ? "700" : "600",
        fill: STYLES.colors.title,
        gap: 18,
      };
    default:
      return {
        fontSize: 11,
        fontWeight: "400",
        fill: STYLES.colors.cardText,
        gap: 15,
      };
  }
}

/**
 * Lay out the selected constituency's card: its title and lines, as the
 * page's tooltip shows them (the same strings; nothing is reformatted).
 *
 * @param {{title: string, lines: Array<{kind: string, text: string}>}} card
 * @returns {Array<{text: string, y: number, style: Object}>} and height
 */
function layoutCard(card) {
  const { cardPadding, cardWrap } = STYLES;
  const placed = [];
  let y = cardPadding + 14;
  wrapTextSimple(card.title, cardWrap - 6).forEach((text, index) => {
    if (index > 0) y += 17;
    placed.push({
      text,
      y,
      style: { fontSize: 14, fontWeight: "600", fill: STYLES.colors.title },
    });
  });
  card.lines.forEach((line) => {
    const style = lineStyle(line);
    const wrap = line.kind === "value" ? cardWrap : cardWrap + 4;
    wrapTextSimple(line.text, wrap).forEach((text, index) => {
      y += index === 0 ? style.gap : style.fontSize + 3;
      placed.push({ text, y, style });
    });
  });
  return { placed, height: y + cardPadding };
}

/**
 * Add the card for the selected constituency.
 *
 * @param {SVGElement} svg - The SVG element to add the card to
 * @param {Object} card - `{title, lines}`, as for the page's tooltip
 * @param {number} x - X position
 * @param {number} y - Y position
 */
function createTooltipCard(svg, card, x, y) {
  const { cardWidth, cardPadding, cardRadius, colors } = STYLES;
  const { placed, height } = layoutCard(card);
  const group = createSvgGroup({ className: "map-export-card" });
  group.appendChild(
    createSvgElement("rect", {
      x,
      y,
      width: cardWidth,
      height,
      fill: colors.background,
      stroke: colors.cardBorder,
      "stroke-width": "1",
      rx: cardRadius,
    }),
  );
  placed.forEach(({ text, y: offset, style }) => {
    group.appendChild(
      createSvgText(text, {
        x: x + cardPadding,
        y: y + offset,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        fill: style.fill,
      }),
    );
  });
  svg.appendChild(group);
}

/**
 * Export a D3 map as an SVG file.
 *
 * @param {SVGSVGElement} svgElement - The SVG element containing the map
 * @param {string} filename - The filename for the downloaded SVG (without extension)
 * @param {Object} options - Export options
 * @param {string} options.title - Title to display above the map
 * @param {string} options.description - Description text below the title
 * @param {Object} options.logo - Logo configuration
 * @param {string} options.logo.href - URL/path to logo image
 * @param {number} options.logo.width - Logo width
 * @param {number} options.logo.height - Logo height
 * @param {{title: string, lines: Array}} [options.tooltip] - The selected
 *   constituency's card, as the page's tooltip shows it
 * @returns {Promise<boolean>} - True if export was successful
 */
export async function exportMapAsSvg(
  svgElement,
  filename = "map",
  options = {},
) {
  const built = await buildMapSvg(svgElement, options);
  if (!built) return false;
  downloadSvg(built.svg, filename);
  return true;
}

/**
 * Build the map's export SVG without downloading it, for the SVG and PNG
 * downloads alike. Takes the same options as exportMapAsSvg.
 *
 * @returns {Promise<{svg: string, width: number, height: number}|null>}
 */
export async function buildMapSvg(svgElement, options = {}) {
  const { title, description, logo, tooltip } = options;

  if (!svgElement) {
    console.error("exportMapAsSvg: No SVG element provided");
    return null;
  }

  // Clone the SVG
  const clonedSvg = svgElement.cloneNode(true);

  // Reset the zoom for a clean export. The legend and logo sit outside the
  // zoomable group, so it is found by its class.
  const zoomLayer = clonedSvg.querySelector(`g.${MAP_ZOOM_LAYER_CLASS}`);
  if (zoomLayer) {
    zoomLayer.removeAttribute("transform");
  }

  // On a wide screen the legend sits left of the drawing area, in the
  // corner of what is shown. The file shows the drawing area alone, so the
  // legend goes to its corner.
  const legend = clonedSvg.querySelector(`g.${MAP_LEGEND_CLASS}`);
  if (legend) {
    // Hidden on screen (the page's key is HTML); drawn in the file
    legend.removeAttribute("display");
    legend.removeAttribute("aria-hidden");
    legend.style.removeProperty("display");
    legend.setAttribute(
      "transform",
      `translate(${LEGEND_INSET}, ${LEGEND_INSET})`,
    );
  }

  // Remove existing image elements with relative URLs (won't work in standalone SVG)
  const existingImages = clonedSvg.querySelectorAll("image");
  existingImages.forEach((img) => {
    const href =
      img.getAttribute("href") ||
      img.getAttributeNS("http://www.w3.org/1999/xlink", "href");
    if (href && !href.startsWith("data:")) {
      img.remove();
    }
  });

  // Get dimensions
  const width = 800;
  const height = 600;

  // Calculate layout
  const headerHeight = calculateHeaderHeight(title, description);
  const totalHeight = headerHeight + height + STYLES.footerHeight;

  // Update SVG dimensions
  clonedSvg.setAttribute("width", width);
  clonedSvg.setAttribute("height", totalHeight);
  clonedSvg.setAttribute("viewBox", `0 0 ${width} ${totalHeight}`);
  clonedSvg.removeAttribute("role");
  clonedSvg.removeAttribute("aria-label");
  addSvgNamespaces(clonedSvg);

  // Keep the pattern definitions at the top level, where every renderer
  // resolves them, and move the rest of the map down below the header.
  const definitions = Array.from(clonedSvg.children).filter(
    (child) => child.localName === "defs",
  );
  const existingContent = Array.from(clonedSvg.childNodes).filter(
    (child) => !definitions.includes(child),
  );
  const contentGroup = createSvgGroup({
    transform: `translate(0, ${headerHeight})`,
  });
  existingContent.forEach((child) => contentGroup.appendChild(child));
  clonedSvg.appendChild(contentGroup);

  // Add white background
  const background = createSvgRect({
    x: 0,
    y: 0,
    width,
    height: totalHeight,
    fill: STYLES.colors.background,
  });
  clonedSvg.insertBefore(background, contentGroup);

  // Add title
  let currentY = STYLES.padding;
  if (title) {
    const titleElement = createTitle(title, currentY + STYLES.titleFontSize);
    clonedSvg.insertBefore(titleElement, contentGroup);
    currentY += STYLES.titleFontSize + STYLES.titleDescGap;
  }

  // Add description
  if (description) {
    const descElement = createDescription(
      description,
      currentY + STYLES.descriptionFontSize,
    );
    clonedSvg.insertBefore(descElement, contentGroup);
  }

  // Embed the logo at the bottom right, below the map
  if (logo?.href) {
    try {
      const base64Logo = await imageToBase64(logo.href);
      const logoImage = createSvgElement("image", {
        width: logo.width,
        height: logo.height,
        x: width - logo.width - 10,
        y: headerHeight + height + (STYLES.footerHeight - logo.height) / 2,
      });
      // Set both href and xlink:href for maximum browser compatibility
      logoImage.setAttribute("href", base64Logo);
      logoImage.setAttributeNS(
        "http://www.w3.org/1999/xlink",
        "xlink:href",
        base64Logo,
      );
      clonedSvg.appendChild(logoImage);
    } catch (error) {
      console.warn("exportMapAsSvg: Failed to embed logo", error);
    }
  }

  // Add the selected constituency's card
  if (tooltip) {
    const cardX = width - STYLES.cardWidth - 20;
    const cardY = headerHeight + 20;
    createTooltipCard(clonedSvg, tooltip, cardX, cardY);
  }

  return {
    svg: serializeSvg(clonedSvg),
    width: Number(clonedSvg.getAttribute("width")) || width,
    height: Number(clonedSvg.getAttribute("height")) || 0,
  };
}

export default exportMapAsSvg;
