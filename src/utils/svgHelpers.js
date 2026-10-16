/**
 * SVG helper utilities for creating and manipulating SVG elements.
 */

const SVG_NS = "http://www.w3.org/2000/svg";
const XMLNS_NS = "http://www.w3.org/2000/xmlns/";
const XLINK_NS = "http://www.w3.org/1999/xlink";

// Default font stack used throughout the application
const DEFAULT_FONT = "system-ui, -apple-system, sans-serif";

/**
 * Create an SVG element with the given tag name and attributes.
 *
 * @param {string} tagName - The SVG element tag name
 * @param {Object} attributes - Key-value pairs of attributes to set
 * @returns {SVGElement}
 */
export function createSvgElement(tagName, attributes = {}) {
  const element = document.createElementNS(SVG_NS, tagName);
  for (const [key, value] of Object.entries(attributes)) {
    element.setAttribute(key, String(value));
  }
  return element;
}

/**
 * Create an SVG text element with styling.
 * Uses both SVG attributes and inline styles for maximum compatibility.
 *
 * @param {string} content - Text content
 * @param {Object} options - Text options
 * @param {number} options.x - X position
 * @param {number} options.y - Y position
 * @param {number} options.fontSize - Font size in pixels
 * @param {string} options.fontWeight - Font weight (e.g., "400", "600")
 * @param {string} options.fill - Text colour
 * @returns {SVGTextElement}
 */
export function createSvgText(
  content,
  { x, y, fontSize, fontWeight = "400", fill = "#374151" },
) {
  const text = createSvgElement("text", {
    x,
    y,
    fill,
    "font-family": DEFAULT_FONT,
    "font-size": `${fontSize}px`,
    "font-weight": fontWeight,
  });
  // Also set via style attribute for broader compatibility
  text.setAttribute(
    "style",
    `font-family: ${DEFAULT_FONT}; font-size: ${fontSize}px; font-weight: ${fontWeight}; fill: ${fill};`,
  );
  text.textContent = content;
  return text;
}

/**
 * Create an SVG rectangle element.
 *
 * @param {Object} options - Rectangle options
 * @param {number} options.x - X position
 * @param {number} options.y - Y position
 * @param {number} options.width - Width
 * @param {number} options.height - Height
 * @param {string} options.fill - Fill colour
 * @returns {SVGRectElement}
 */
export function createSvgRect({ x, y, width, height, fill }) {
  return createSvgElement("rect", { x, y, width, height, fill });
}

/**
 * Create an SVG line element.
 *
 * @param {Object} options - Line options
 * @param {number} options.x1 - Start X
 * @param {number} options.y1 - Start Y
 * @param {number} options.x2 - End X
 * @param {number} options.y2 - End Y
 * @param {string} options.stroke - Stroke colour
 * @param {number} options.strokeWidth - Stroke width
 * @returns {SVGLineElement}
 */
export function createSvgLine({ x1, y1, x2, y2, stroke, strokeWidth = 2 }) {
  return createSvgElement("line", {
    x1,
    y1,
    x2,
    y2,
    stroke,
    "stroke-width": strokeWidth,
  });
}

/**
 * Create an SVG group element with optional transform.
 *
 * @param {Object} options - Group options
 * @param {string} options.transform - Transform attribute value
 * @param {string} options.className - Class name
 * @returns {SVGGElement}
 */
export function createSvgGroup({ transform, className } = {}) {
  const attrs = {};
  if (transform) attrs.transform = transform;
  if (className) attrs.class = className;
  return createSvgElement("g", attrs);
}

/**
 * Create a tspan element for multi-line text.
 *
 * @param {string} content - Text content
 * @param {Object} options - Tspan options
 * @param {number} options.x - X position
 * @param {string} options.dy - Vertical offset (e.g., "0" or "20px")
 * @returns {SVGTSpanElement}
 */
export function createSvgTspan(content, { x, dy }) {
  const tspan = createSvgElement("tspan", { x, dy });
  tspan.textContent = content;
  return tspan;
}

/**
 * Add required XML namespaces to an SVG element for standalone export.
 *
 * @param {SVGSVGElement} svg - The SVG element
 */
export function addSvgNamespaces(svg) {
  // As namespace declarations, not plain attributes: a serializer then
  // writes each once, where a plain "xmlns" attribute can be written twice
  // and leave the file unreadable as XML.
  if (!svg.hasAttribute("xmlns")) {
    svg.setAttributeNS(XMLNS_NS, "xmlns", SVG_NS);
  }
  if (!svg.hasAttribute("xmlns:xlink")) {
    svg.setAttributeNS(XMLNS_NS, "xmlns:xlink", XLINK_NS);
  }
}

/**
 * Serialize an SVG element to a string with XML declaration.
 *
 * @param {SVGSVGElement} svg - The SVG element
 * @returns {string} - The serialized SVG string
 */
export function serializeSvg(svg) {
  const serializer = new XMLSerializer();
  const svgString = serializer.serializeToString(svg);
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + svgString;
}

export { SVG_NS, DEFAULT_FONT };
