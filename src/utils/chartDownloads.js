import { buildChartSvg } from "./exportChartAsSvg";
import { downloadFile, downloadSvg } from "./downloadFile";
import { downloadSvgAsPng } from "./rasteriseSvg";
import { unpublishedCsv } from "./chartCsv";
import { frameCsv, frameFileName, frameSvg } from "./exportFrame";

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
 * A year not yet published has only its CSV, marked as not published.
 * `image: false` leaves the PNG and SVG out (a table has no chart). With
 * no `csv` there is nothing to download, and it returns null.
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
