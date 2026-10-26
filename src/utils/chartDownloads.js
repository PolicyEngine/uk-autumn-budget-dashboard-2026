import { buildChartSvg, exportChartAsSvg } from "./exportChartAsSvg";
import { downloadFile } from "./downloadFile";
import { downloadSvgAsPng } from "./rasteriseSvg";
import { unpublishedCsv } from "./chartCsv";

/**
 * The formats a chart's Download menu offers (ChartDownloadMenu): its data
 * as CSV, and the chart as PNG and SVG, built from the Recharts chart in
 * `chartRef` with `exportOptions` (title, description, legend, logo).
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
 * @param {string} spec.name - File name without extension
 * @param {Object} spec.exportOptions
 * @param {() => string} [spec.csv] - The chart's CSV text
 * @param {boolean} [spec.published]
 * @param {boolean} [spec.image]
 */
export function chartDownloads({ chartRef, name, exportOptions, csv, published = true, image = true }) {
  if (!csv) return null;
  const formats = {
    csv: () =>
      downloadFile(published ? csv() : unpublishedCsv(csv()), `${name}.csv`, "text/csv;charset=utf-8"),
  };
  if (published && image) {
    formats.png = async () => downloadSvgAsPng(await buildChartSvg(chartRef, exportOptions), name);
    formats.svg = () => exportChartAsSvg(chartRef, name, exportOptions);
  }
  return formats;
}
