import { CHART_COLOURS } from "./chartTheme";
/**
 * PNG downloads, rasterised from the same SVG the SVG download writes.
 */

/**
 * Draw an SVG string onto a canvas and return it as a PNG blob.
 *
 * @param {string} svg - A standalone SVG document (images embedded as data
 *   URLs, as the export builders produce)
 * @param {number} width - The SVG's width in CSS pixels
 * @param {number} height - The SVG's height in CSS pixels
 * @param {number} [scale=2] - Device pixel ratio of the PNG
 * @returns {Promise<Blob>}
 */
export function svgToPngBlob(svg, width, height, scale = 2) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(
      new Blob([svg], { type: "image/svg+xml;charset=utf-8" }),
    );
    const image = new Image();
    const draw = () => {
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      const context = canvas.getContext("2d");
      context.fillStyle = CHART_COLOURS.surface;
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("PNG encoding failed"))),
        "image/png",
      );
    };
    // Drawn once decoded, its embedded font (Inter) with it
    image.onload = () => {
      const decoded = typeof image.decode === "function" ? image.decode().catch(() => {}) : Promise.resolve();
      decoded.then(draw);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("The SVG could not be drawn"));
    };
    image.src = url;
  });
}

/** Trigger a download of a blob. */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Rasterise a built export SVG ({svg, width, height}) and download it as
 * `${filename}.png` at 2x.
 */
export async function downloadSvgAsPng(built, filename, scale = 2) {
  if (!built) return false;
  const blob = await svgToPngBlob(built.svg, built.width, built.height, scale);
  downloadBlob(blob, `${filename}.png`);
  return true;
}
