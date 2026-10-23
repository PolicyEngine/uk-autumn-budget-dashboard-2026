import { useId, useRef, useState } from "react";
import ChartDownloadMenu from "../ChartDownloadMenu";
import { CHART_LOGO } from "../../utils/chartLogo";
import { buildChartSvg, exportChartAsSvg } from "../../utils/exportChartAsSvg";
import { downloadFile } from "../../utils/downloadFile";
import { downloadSvgAsPng } from "../../utils/rasteriseSvg";
import { fyDash } from "../../utils/livingStandards/outlook";
import { Note, plainWords } from "./sources";

/** An in-card disclosure, closed by default: what the chart measures. */
function AboutChart({ text }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="ls-about">
      <button
        type="button"
        className="ls-about-toggle"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
      >
        About this chart
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s" }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <p id={id} className="ls-about-content">
          {text}
        </p>
      )}
    </div>
  );
}

/**
 * A Living standards chart card in the dashboard's card layout: title and
 * Download menu, the summary sentence as the description, in-card
 * controls, the plot, then the visible notes, the source line and an
 * "About this chart" disclosure (the definition). Each part is a direct
 * child of the card, so two cards side by side share rows and line up.
 *
 * children fill the plot, legend and logo rows: LsLineChart or LsBarChart,
 * or a <div className="chart-plot"> for anything else.
 *
 * download: { filename, csv: () => string, legendItems?, image?: false }.
 * The CSV is the chart's own data; the PNG and SVG are built from the
 * Recharts chart in the plot (left out when image is false).
 */
export default function LsCard({ title, summary, about, controls, download, children, footer, notes, source }) {
  const plotRef = useRef(null);
  let formats = null;
  if (download) {
    const options = {
      title,
      description: typeof about === "string" ? about : "",
      legendItems: download.legendItems || [],
      logo: CHART_LOGO,
      // The legend is drawn outside the chart's SVG
      reservedLegendHeight: 0,
    };
    formats = {
      csv: () => downloadFile(download.csv(), `${download.filename}.csv`, "text/csv;charset=utf-8"),
    };
    if (download.image !== false) {
      formats.png = async () => downloadSvgAsPng(await buildChartSvg(plotRef, options), download.filename);
      formats.svg = () => exportChartAsSvg(plotRef, download.filename, options);
    }
  }
  const visibleNotes = (notes || []).filter(Boolean);

  return (
    <div className="ls-card">
      <div className="chart-header">
        <div>
          <h3>{title}</h3>
          {summary && <p className="chart-description">{summary}</p>}
        </div>
        {formats && <ChartDownloadMenu formats={formats} chartTitle={title} />}
      </div>
      <div className="chart-controls ls-controls">{controls}</div>
      {/* display: contents, so the plot, legend and logo are rows of the card */}
      <div className="ls-chart-rows" ref={plotRef}>
        {children}
      </div>
      <div className="ls-card-footer">
        {footer}
        {visibleNotes.map((n) => (
          <Note key={typeof n === "string" ? n : undefined}>{typeof n === "string" ? fyDash(plainWords(n)) : n}</Note>
        ))}
        {source && <p className="ls-source">{source}</p>}
        {about && <AboutChart text={about} />}
      </div>
    </div>
  );
}
