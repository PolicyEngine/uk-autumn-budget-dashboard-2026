import { buildChartSvg } from "./exportChartAsSvg";
import { downloadFile, downloadSvg } from "./downloadFile";
import { downloadSvgAsPng } from "./rasteriseSvg";
import { unpublishedCsv } from "./chartCsv";
import { frameCsv, frameFileName, frameSvg } from "./exportFrame";
import { CHART_LOGO } from "./chartLogo";

/** Whether the chart in `container` is an SVG chart (Recharts, or `svgSelector`'s). */
function hasChartSvg(container, svgSelector) {
  if (!container) return false;
  return Boolean(
    svgSelector ? container.querySelector(svgSelector) : container.querySelector(".recharts-wrapper svg"),
  );
}

/**
 * A chart drawn in HTML (a dumbbell, tiles, a table) as an SVG export:
 * exportDomAsSvg, loaded only when an image is downloaded.
 */
async function buildHtmlSvg(container) {
  const { buildDomSvg, domExportElements } = await import("./exportDomAsSvg");
  return buildDomSvg(domExportElements(container));
}

/**
 * The PNG and SVG downloads of a card drawn in HTML (a table), for a menu
 * given its own `formats`: the element `element()` returns redrawn as SVG
 * (exportDomAsSvg) in the frame, as every chart's image. A function, so a
 * ref is read only when a download runs, never during render.
 *
 * @param {() => HTMLElement|null} element
 * @param {string} name - File name without extension, without a frame
 */
export function htmlImageFormats(element, name) {
  const framed = async (frame) => {
    const built = await buildHtmlSvg(element());
    return frame ? frameSvg(built, frame, { logo: CHART_LOGO }) : built;
  };
  return {
    png: async (frame) => downloadSvgAsPng(await framed(frame), frameFileName(frame, name)),
    svg: async (frame) => {
      const built = await framed(frame);
      if (!built) return false;
      downloadSvg(built.svg, frameFileName(frame, name));
      return true;
    },
  };
}

/**
 * The formats a chart's Download menu offers (ChartDownloadMenu): its data
 * as CSV, and the chart as PNG and SVG, built from the Recharts chart in
 * `chartRef` with `exportOptions` (legend, logo; the title names the file
 * when no frame is given).
 *
 * Each format takes the menu's frame (exportFrame.downloadFrame): the
 * images get its header and footer (frameSvg), the CSV its facts as
 * leading "#" lines, and every file is named after its title with the
 * year ("impact-by-income-decile-2027-28.png").
 *
 * A chart drawn in HTML, with no Recharts SVG in `chartRef` (a dumbbell,
 * tiles, a table), is redrawn as SVG from the page (exportDomAsSvg), so
 * every card offers the same three formats.
 *
 * A year not yet published has only its CSV, marked as not published.
 * `image: false` leaves the PNG and SVG out (nothing drawn: an empty
 * selection). With no `csv` there is nothing to download, and it returns
 * null.
 *
 * ChartDownloadMenu calls it with its `download` prop; the ref is read only
 * when a download runs, never during render.
 *
 * @param {Object} spec
 * @param {{current: HTMLElement|null}} spec.chartRef
 * @param {string} spec.name - File name without extension, without a frame
 * @param {Object} spec.exportOptions
 * @param {() => string} [spec.csv] - The chart's CSV text
 * @param {boolean} [spec.published]
 * @param {boolean} [spec.image]
 */
export function chartDownloads({ chartRef, name, exportOptions = {}, csv, published = true, image = true }) {
  if (!csv) return null;
  const fileName = (frame) => frameFileName(frame, name);
  const framed = async (frame) => {
    // The frame draws the title and the logo; the builder the plot and legend
    if (!hasChartSvg(chartRef?.current, exportOptions.svgSelector)) {
      const built = await buildHtmlSvg(chartRef?.current);
      return frame ? frameSvg(built, frame, { logo: exportOptions.logo ?? CHART_LOGO }) : built;
    }
    const built = await buildChartSvg(chartRef, frame ? { ...exportOptions, logo: undefined } : exportOptions);
    return frame ? frameSvg(built, frame, { logo: exportOptions.logo }) : built;
  };
  const formats = {
    csv: (frame) =>
      downloadFile(
        frameCsv(published ? csv() : unpublishedCsv(csv()), frame),
        `${fileName(frame)}.csv`,
        "text/csv;charset=utf-8",
      ),
  };
  if (published && image) {
    formats.png = async (frame) => downloadSvgAsPng(await framed(frame), fileName(frame));
    formats.svg = async (frame) => {
      const built = await framed(frame);
      if (!built) return false;
      downloadSvg(built.svg, fileName(frame));
      return true;
    };
  }
  return formats;
}
