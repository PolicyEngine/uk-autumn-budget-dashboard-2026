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

  // Calculate layout - no extra footer height needed since chart already has legend space
  const headerHeight = calculateHeaderHeight(
    { title, description },
    chartWidth,
  );
  const totalHeight = chartHeight + headerHeight;

  // Update SVG dimensions
  clonedSvg.setAttribute("width", chartWidth);
  clonedSvg.setAttribute("height", totalHeight);
  clonedSvg.setAttribute("viewBox", `0 0 ${chartWidth} ${totalHeight}`);
  addSvgNamespaces(clonedSvg);

  // Wrap existing content and translate down
  const existingContent = Array.from(clonedSvg.childNodes);
  const contentGroup = createSvgGroup({
    transform: `translate(0, ${headerHeight})`,
  });
  existingContent.forEach((child) => contentGroup.appendChild(child));
  clonedSvg.appendChild(contentGroup);

  // Add white background
  const background = createSvgRect({
    x: 0,
    y: 0,
    width: chartWidth,
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
    const maxWidth = chartWidth - STYLES.padding * 2;
    const descElement = createDescription(
      description,
      currentY + STYLES.descriptionFontSize,
      maxWidth,
    );
    clonedSvg.insertBefore(descElement, contentGroup);
  }

  // Footer layout: legend (auto width, centered) | logo (fixed width, right-aligned)
  // The legend wraps to multiple rows if needed, and the footer height adjusts dynamically
  const footerPadding = 20;
  const logoRightPadding = 10;
  const legendLogoGap = 20; // Gap between legend area and logo

  // Calculate logo dimensions
  const logoWidth = logo?.href ? logo.width : 0;
  const logoHeight = logo?.href ? logo.height : 0;

  // Calculate available width for legend (chart width minus logo space)
  const legendAreaWidth = logo?.href
    ? chartWidth - logoWidth - logoRightPadding - legendLogoGap
    : chartWidth - STYLES.padding * 2;

  // Pre-calculate legend layout to determine footer height
  let legendResult = null;
  if (legendItems.length > 0) {
    // Create a temporary legend to measure its height
    // Use a smaller max width to ensure wrapping works well
    const maxLegendWidth = legendAreaWidth - STYLES.padding;
    legendResult = createLegend(legendItems, maxLegendWidth, 0, {
      legendAreaWidth: legendAreaWidth,
    });
  }

  const legendHeight = legendResult ? legendResult.height : 0;
  const footerContentHeight = Math.max(legendHeight, logoHeight);
  const footerHeight = footerContentHeight + footerPadding * 2;

  // The chart already has legend space built in (originalLegendHeight).
  // We need to add extra height only if our new footer is taller than what was there.
  const extraFooterHeight = Math.max(0, footerHeight - originalLegendHeight);

  // Update SVG dimensions with the new footer height
  const finalTotalHeight = headerHeight + chartHeight + extraFooterHeight;
  clonedSvg.setAttribute("height", finalTotalHeight);
  clonedSvg.setAttribute("viewBox", `0 0 ${chartWidth} ${finalTotalHeight}`);

  // Update background to cover the full height
  background.setAttribute("height", finalTotalHeight);

  // Calculate footer Y position - place legend where the original legend space started
  const footerY =
    headerHeight + chartHeight - originalLegendHeight + footerPadding;

  // Add legend (centered in the legend area, left of logo)
  if (legendItems.length > 0 && legendResult) {
    // Recreate the legend at the correct Y position
    const maxLegendWidth = legendAreaWidth - STYLES.padding;
    const { element: legendGroup } = createLegend(
      legendItems,
      maxLegendWidth,
      footerY,
      { legendAreaWidth: legendAreaWidth },
    );
    clonedSvg.appendChild(legendGroup);
  }

  // Calculate logo position (anchored to right, vertically centered with legend)
  const logoX = chartWidth - logoWidth - logoRightPadding;
  const logoY = footerY + (legendHeight - logoHeight) / 2;

  // Embed logo on the right
  if (logo?.href) {
    try {
      // Convert logo to base64 for standalone SVG
      const base64Logo = await imageToBase64(logo.href);
      const logoImage = createSvgElement("image", {
        width: logo.width,
        height: logo.height,
      });
      // Set both href and xlink:href for maximum browser compatibility
      logoImage.setAttribute("href", base64Logo);
      logoImage.setAttributeNS(
        "http://www.w3.org/1999/xlink",
        "xlink:href",
        base64Logo,
      );

      // Position logo (logoX and logoY calculated above)
      logoImage.setAttribute("x", logoX);
      logoImage.setAttribute("y", logoY);

      clonedSvg.appendChild(logoImage);
    } catch (error) {
      console.warn("exportChartAsSvg: Failed to embed logo", error);
    }
  }

  return {
    svg: serializeSvg(clonedSvg),
    width: chartWidth,
    height: finalTotalHeight,
  };
}

export default exportChartAsSvg;
