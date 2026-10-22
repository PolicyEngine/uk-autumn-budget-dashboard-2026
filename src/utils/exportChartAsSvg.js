/**
 * Export Recharts charts as SVG files with title, description, and legend.
 */

import {
  createSvgElement,
  createSvgText,
  createSvgRect,
  createSvgLine,
  createSvgGroup,
  createSvgTspan,
  addSvgNamespaces,
  serializeSvg,
} from "./svgHelpers";
import { measureTextWidth, wrapText, estimateTextHeight } from "./textMeasure";
import { downloadSvg } from "./downloadFile";

/**
 * Convert an image URL to a base64 data URL.
 * This allows embedding images directly in the SVG for standalone export.
 *
 * @param {string} url - URL or path to the image
 * @returns {Promise<string>} - Base64 data URL
 */
async function imageToBase64(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = reject;
    img.src = url;
  });
}

// Style constants
const STYLES = {
  padding: 20,
  titleFontSize: 18,
  descriptionFontSize: 13,
  legendFontSize: 12,
  lineHeight: 1.5,
  titleDescGap: 8,
  legendIconSize: 14,
  legendIconTextGap: 6,
  legendItemGap: 24,
  colors: {
    title: "#374151",
    description: "#4b5563",
    legendText: "#374151",
    background: "white",
  },
};

// SVG style properties to inline for consistent rendering
const SVG_STYLE_PROPERTIES = [
  "fill",
  "stroke",
  "stroke-width",
  "stroke-dasharray",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-opacity",
  "fill-opacity",
  "opacity",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "text-anchor",
  "dominant-baseline",
  "alignment-baseline",
  "visibility",
  "display",
];

/**
 * Recursively inline computed styles onto SVG elements.
 * This ensures the SVG looks the same when opened outside the browser.
 *
 * @param {Element} clonedElement - The cloned element to modify
 * @param {Element} originalElement - The original element to get computed styles from
 */
function inlineComputedStyles(clonedElement, originalElement) {
  const computedStyle = window.getComputedStyle(originalElement);

  const styleValues = SVG_STYLE_PROPERTIES.map((prop) => {
    const value = computedStyle.getPropertyValue(prop);
    return value && value !== "none" && value !== "normal"
      ? `${prop}: ${value}`
      : null;
  }).filter(Boolean);

  if (styleValues.length > 0) {
    const existingStyle = clonedElement.getAttribute("style") || "";
    const newStyle = existingStyle
      ? `${existingStyle}; ${styleValues.join("; ")}`
      : styleValues.join("; ");
    clonedElement.setAttribute("style", newStyle);
  }

  // Process children recursively
  const clonedChildren = clonedElement.children;
  const originalChildren = originalElement.children;

  for (
    let i = 0;
    i < clonedChildren.length && i < originalChildren.length;
    i++
  ) {
    inlineComputedStyles(clonedChildren[i], originalChildren[i]);
  }
}

/**
 * Calculate the width of a single legend item.
 *
 * @param {Object} item - Legend item with label
 * @returns {number} Width in pixels
 */
function calculateItemWidth(item) {
  const { legendFontSize, legendIconSize, legendIconTextGap } = STYLES;
  const textWidth = measureTextWidth(item.label, {
    fontSize: legendFontSize,
  });
  return legendIconSize + legendIconTextGap + textWidth;
}

/**
 * Calculate legend layout with multi-row wrapping.
 * Returns an array of rows, each containing items that fit within maxWidth.
 *
 * @param {Array<{color: string, label: string, type: string}>} items - Legend items
 * @param {number} maxWidth - Maximum width available for legend
 * @returns {Array<Array<Object>>} Array of rows, each row is an array of items with computed widths
 */
function calculateLegendLayout(items, maxWidth) {
  const { legendItemGap } = STYLES;

  if (items.length === 0) return [];

  const rows = [];
  let currentRow = [];
  let currentRowWidth = 0;

  items.forEach((item) => {
    const itemWidth = calculateItemWidth(item);
    const gapWidth = currentRow.length > 0 ? legendItemGap : 0;
    const widthWithItem = currentRowWidth + gapWidth + itemWidth;

    if (currentRow.length > 0 && widthWithItem > maxWidth) {
      // Start a new row
      rows.push({
        items: currentRow,
        width: currentRowWidth,
      });
      currentRow = [{ ...item, width: itemWidth }];
      currentRowWidth = itemWidth;
    } else {
      // Add to current row
      currentRow.push({ ...item, width: itemWidth });
      currentRowWidth = widthWithItem;
    }
  });

  // Don't forget the last row
  if (currentRow.length > 0) {
    rows.push({
      items: currentRow,
      width: currentRowWidth,
    });
  }

  return rows;
}

/**
 * Create an SVG legend from legend items with multi-row support.
 *
 * @param {Array<{color: string, label: string, type: string}>} items - Legend items
 * @param {number} maxWidth - Maximum width available for legend (used for centering rows)
 * @param {number} yPosition - Y position for the first row of the legend
 * @param {Object} options - Additional options
 * @param {number} options.legendAreaWidth - Width of the area to center legend within
 * @returns {{element: SVGGElement, height: number}} Legend group and total height
 */
function createLegend(items, maxWidth, yPosition, options = {}) {
  const {
    legendFontSize,
    legendIconSize,
    legendIconTextGap,
    legendItemGap,
    colors,
  } = STYLES;

  const legendRowGap = 8; // Vertical gap between rows
  const legendAreaWidth = options.legendAreaWidth || maxWidth;

  // Calculate multi-row layout
  const rows = calculateLegendLayout(items, maxWidth);

  // Create legend group
  const legendGroup = createSvgGroup({ className: "exported-legend" });
  let currentY = yPosition;

  rows.forEach((row) => {
    // Center this row within the legend area
    const rowStartX = (legendAreaWidth - row.width) / 2;
    let currentX = rowStartX;

    row.items.forEach((item) => {
      const itemGroup = createSvgGroup();

      // Draw icon based on type
      if (item.type === "line") {
        const line = createSvgLine({
          x1: currentX,
          y1: currentY,
          x2: currentX + legendIconSize,
          y2: currentY,
          stroke: item.color,
          strokeWidth: 2,
        });
        itemGroup.appendChild(line);
      } else {
        const rect = createSvgRect({
          x: currentX,
          y: currentY - legendIconSize / 2,
          width: legendIconSize,
          height: legendIconSize,
          fill: item.color,
        });
        itemGroup.appendChild(rect);
      }

      // Draw label with proper font styling (matching axis titles)
      const text = createSvgText(item.label, {
        x: currentX + legendIconSize + legendIconTextGap,
        y: currentY + legendFontSize / 3,
        fontSize: legendFontSize,
        fontWeight: "500",
        fill: colors.legendText,
      });
      itemGroup.appendChild(text);

      legendGroup.appendChild(itemGroup);
      currentX += item.width + legendItemGap;
    });

    currentY += legendFontSize + legendRowGap;
  });

  // Calculate total height of legend
  const totalHeight =
    rows.length > 0 ? rows.length * (legendFontSize + legendRowGap) : 0;

  return { element: legendGroup, height: totalHeight };
}

/**
 * Create SVG title element.
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
 * Create SVG description element with word wrapping.
 *
 * @param {string} description - Description text
 * @param {number} y - Y position
 * @param {number} maxWidth - Maximum width for text wrapping
 * @returns {SVGTextElement}
 */
function createDescription(description, y, maxWidth) {
  const { descriptionFontSize, lineHeight, padding, colors } = STYLES;

  const textElement = createSvgElement("text", { x: padding, y });
  textElement.setAttribute(
    "style",
    `font-family: system-ui, -apple-system, sans-serif; font-size: ${descriptionFontSize}px; font-weight: 400; fill: ${colors.description};`,
  );

  const lines = wrapText(description, maxWidth, {
    fontSize: descriptionFontSize,
  });

  lines.forEach((line, index) => {
    const tspan = createSvgTspan(line, {
      x: padding,
      dy: index === 0 ? "0" : `${descriptionFontSize * lineHeight}px`,
    });
    textElement.appendChild(tspan);
  });

  return textElement;
}

/**
 * Calculate the header height needed for title and description.
 *
 * @param {Object} options - Options containing title and description
 * @param {number} chartWidth - Chart width for text wrapping calculation
 * @returns {number} - Header height in pixels
 */
function calculateHeaderHeight({ title, description }, chartWidth) {
  const {
    padding,
    titleFontSize,
    descriptionFontSize,
    lineHeight,
    titleDescGap,
  } = STYLES;
  let height = 0;

  if (title) {
    height += titleFontSize + padding;
  }

  if (description) {
    const maxWidth = chartWidth - padding * 2;
    const descHeight = estimateTextHeight(description, maxWidth, {
      fontSize: descriptionFontSize,
      lineHeight,
    });
    height += descHeight + titleDescGap;
  }

  if (title || description) {
    height += padding; // Bottom padding before chart
  }

  return height;
}

/**
 * Export a Recharts chart as an SVG file.
 *
 * @param {React.RefObject} containerRef - Ref to the chart container element
 * @param {string} filename - The filename for the downloaded SVG (without extension)
 * @param {Object} options - Export options
 * @param {string} options.title - Title to display above the chart
 * @param {string} options.description - Description text below the title
 * @param {Array<{color: string, label: string, type: string}>} options.legendItems - Legend items
 * @param {Object} options.logo - Logo configuration
 * @param {string} options.logo.href - URL/path to logo image
 * @param {number} options.logo.width - Logo width
 * @param {number} options.logo.height - Logo height
 * @param {number} options.logo.padding - Padding from edges
 * @returns {Promise<boolean>} - True if export was successful
 */
export async function exportChartAsSvg(
  containerRef,
  filename = "chart",
  options = {},
) {
  const built = await buildChartSvg(containerRef, options);
  if (!built) return false;
  downloadSvg(built.svg, filename);
  return true;
}

/**
 * Build the export SVG (title, description, chart, legend and logo) without
 * downloading it, for the SVG and PNG downloads alike.
 *
 * Takes the same options as exportChartAsSvg, plus:
 * @param {string} [options.svgSelector] - Selector for the chart's SVG when
 *   it is not a Recharts chart (default: the Recharts wrapper's SVG)
 * @param {number} [options.reservedLegendHeight] - Space the chart keeps for
 *   a legend when it has no Recharts legend (default 60)
 * @returns {Promise<{svg: string, width: number, height: number}|null>}
 */
export async function buildChartSvg(containerRef, options = {}) {
  const {
    title,
    description,
    legendItems = [],
    logo,
    svgSelector,
    reservedLegendHeight = 60,
  } = options;

  if (!containerRef?.current) {
    console.error("exportChartAsSvg: No container ref provided");
    return null;
  }

  // Find the SVG element within the Recharts container (or the selector)
  const svgElement = svgSelector
    ? containerRef.current.querySelector(svgSelector)
    : containerRef.current
        .querySelector(".recharts-wrapper")
        ?.querySelector("svg");

  if (!svgElement) {
    console.error("exportChartAsSvg: No SVG element found in container");
    return null;
  }

  // Get dimensions
  const bbox = svgElement.getBoundingClientRect();
  const chartWidth = bbox.width;
  const chartHeight = bbox.height;

  // Clone and prepare SVG
  const clonedSvg = svgElement.cloneNode(true);
  inlineComputedStyles(clonedSvg, svgElement);

  // Find and measure the original Recharts legend before removing it
  // We need to know how much space it occupied so we can position our legend correctly
  const originalLegendWrapper = svgElement
    .closest(".recharts-wrapper")
    ?.querySelector(".recharts-legend-wrapper");
  let originalLegendHeight = reservedLegendHeight; // Default fallback
  if (originalLegendWrapper) {
    const legendRect = originalLegendWrapper.getBoundingClientRect();
    originalLegendHeight = legendRect.height;
  }

  // Remove the original Recharts legend from the clone (we'll add our own in the footer)
  const clonedLegend = clonedSvg.querySelector(".recharts-legend-wrapper");
  if (clonedLegend) {
    clonedLegend.remove();
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

  // Layout: the plot (with its unit label and axes), the legend, then the
  // logo at the bottom right, inside a uniform padding. No title or
  // description is drawn: the title names the file and the SVG <title>.
  const PAD = 24;
  const plotHeight = Math.max(0, chartHeight - originalLegendHeight);
  const legend = legendItems.length
    ? legendItems.some((item) => item.group)
      ? createGroupedLegend(legendItems, chartWidth)
      : createLegend(legendItems, chartWidth - STYLES.padding * 2, 0, {
          legendAreaWidth: chartWidth,
        })
    : null;
  const legendGap = legend ? 16 : 0;
  const legendHeight = legend ? legend.height : 0;
  const logoWidth = logo?.href ? logo.width : 0;
  const logoHeight = logo?.href ? logo.height : 0;
  const logoGap = logo?.href ? 12 : 0;

  const width = chartWidth + PAD * 2;
  const height =
    PAD + plotHeight + legendGap + legendHeight + logoGap + logoHeight + PAD;

  clonedSvg.setAttribute("width", width);
  clonedSvg.setAttribute("height", height);
  clonedSvg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  addSvgNamespaces(clonedSvg);

  // The plot, clipped to its own height (the on-screen legend space goes)
  const existingContent = Array.from(clonedSvg.childNodes);
  const contentGroup = createSvgGroup({ transform: `translate(${PAD}, ${PAD})` });
  existingContent.forEach((child) => contentGroup.appendChild(child));
  const clipId = `export-plot-clip-${Math.random().toString(36).slice(2, 8)}`;
  const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
  const clip = document.createElementNS("http://www.w3.org/2000/svg", "clipPath");
  clip.setAttribute("id", clipId);
  clip.appendChild(createSvgRect({ x: 0, y: 0, width: chartWidth, height: plotHeight }));
  defs.appendChild(clip);
  contentGroup.setAttribute("clip-path", `url(#${clipId})`);

  const background = createSvgRect({
    x: 0,
    y: 0,
    width,
    height,
    fill: STYLES.colors.background,
  });

  // Accessible name: the chart's title, not drawn
  if (title) {
    const titleElement = document.createElementNS("http://www.w3.org/2000/svg", "title");
    titleElement.textContent = title;
    clonedSvg.appendChild(titleElement);
  }
  clonedSvg.appendChild(defs);
  clonedSvg.appendChild(background);
  clonedSvg.appendChild(contentGroup);

  if (legend) {
    const legendGroup = createSvgGroup({
      transform: `translate(${PAD}, ${PAD + plotHeight + legendGap})`,
    });
    legendGroup.appendChild(legend.element);
    clonedSvg.appendChild(legendGroup);
  }

  if (logo?.href) {
    try {
      const base64Logo = await imageToBase64(logo.href);
      const logoImage = createSvgElement("image", {
        width: logoWidth,
        height: logoHeight,
      });
      logoImage.setAttribute("href", base64Logo);
      logoImage.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", base64Logo);
      logoImage.setAttribute("x", width - PAD - logoWidth);
      logoImage.setAttribute("y", height - PAD - logoHeight);
      clonedSvg.appendChild(logoImage);
    } catch (error) {
      console.warn("exportChartAsSvg: Failed to embed logo", error);
    }
  }

  return {
    svg: serializeSvg(clonedSvg),
    width,
    height,
  };
}

/**
 * The on-screen grouped legend, drawn in SVG: "Raise revenue" and "Cost
 * revenue" columns side by side (one item a line), then the net line
 * centred under them; the block centred in `areaWidth`.
 *
 * @param {Array<{color: string, label: string, type: string, group?: string}>} items
 *   Items with `group` "raise" or "cost"; items without a group (the net
 *   line) go under the columns.
 */
export function createGroupedLegend(items, areaWidth) {
  const { legendFontSize, legendIconSize, legendIconTextGap, colors } = STYLES;
  const rowHeight = legendFontSize + 8;
  const headingHeight = 18;
  const columnGap = 32;
  const groups = [
    ["Raise revenue", items.filter((item) => item.group === "raise")],
    ["Cost revenue", items.filter((item) => item.group === "cost")],
  ].filter(([, groupItems]) => groupItems.length > 0);
  const rest = items.filter((item) => !item.group);

  const itemWidth = (item) =>
    legendIconSize +
    legendIconTextGap +
    measureTextWidth(item.label, { fontSize: legendFontSize, fontWeight: "500" });
  const columns = groups.map(([heading, groupItems]) => ({
    heading,
    items: groupItems,
    width: Math.max(
      measureTextWidth(heading, { fontSize: 11, fontWeight: "600" }),
      ...groupItems.map(itemWidth),
    ),
  }));
  const blockWidth =
    columns.reduce((sum, column) => sum + column.width, 0) +
    columnGap * Math.max(0, columns.length - 1);
  const columnsHeight =
    headingHeight + Math.max(0, ...columns.map((column) => column.items.length)) * rowHeight;

  const group = createSvgGroup({ className: "exported-legend" });
  let x = (areaWidth - blockWidth) / 2;
  const drawItem = (item, itemX, itemY) => {
    if (item.type === "line") {
      group.appendChild(
        createSvgLine({
          x1: itemX,
          y1: itemY,
          x2: itemX + legendIconSize,
          y2: itemY,
          stroke: item.color,
          strokeWidth: 2,
        }),
      );
    } else {
      group.appendChild(
        createSvgRect({
          x: itemX,
          y: itemY - legendIconSize / 2 + 2,
          width: legendIconSize - 4,
          height: legendIconSize - 4,
          fill: item.color,
        }),
      );
    }
    group.appendChild(
      createSvgText(item.label, {
        x: itemX + legendIconSize + legendIconTextGap,
        y: itemY + legendFontSize / 3,
        fontSize: legendFontSize,
        fontWeight: "500",
        fill: colors.legendText,
      }),
    );
  };
  columns.forEach((column) => {
    group.appendChild(
      createSvgText(column.heading, {
        x,
        y: 11,
        fontSize: 11,
        fontWeight: "600",
        fill: "#6B7280",
      }),
    );
    column.items.forEach((item, index) => {
      drawItem(item, x, headingHeight + rowHeight * index + rowHeight / 2);
    });
    x += column.width + columnGap;
  });
  let height = columnsHeight;
  rest.forEach((item) => {
    const restWidth = itemWidth(item);
    drawItem(item, (areaWidth - restWidth) / 2, height + 6 + rowHeight / 2);
    height += rowHeight + 6;
  });
  return { element: group, height };
}

export default exportChartAsSvg;
