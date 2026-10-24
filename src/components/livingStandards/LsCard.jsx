import { useRef } from "react";
import ChartDownloadMenu from "../ChartDownloadMenu";
import Disclosure from "../Disclosure";
import { CHART_LOGO } from "../../utils/chartLogo";
import { fyDash } from "../../utils/livingStandards/outlook";
import Note from "../Note";
import { plainWords } from "./sources";

/**
 * A Living standards chart card in the dashboard's card layout: title and
 * Download menu, the summary sentence as the description, in-card
 * controls on one row, the plot, then any short state notes (footer), any
 * boxed notes (boxes: the series notes a card needs), the source line and
 * an "About this chart" disclosure holding the definition (about) and the
 * longer reading notes (notes). Each part is a direct child of the card,
 * so two cards side by side share rows and line up.
 *
 * children fill the plot, legend and logo rows: LsLineChart or LsBarChart,
 * or a <div className="chart-plot"> for anything else.
 *
 * download: { filename, csv: () => string, legendItems?, image?: false }.
 * The CSV is the chart's own data; the PNG and SVG are built from the
 * Recharts chart in the plot (left out when image is false).
 */
export default function LsCard({ title, summary, about, controls, download, children, footer, boxes, notes, source }) {
  const plotRef = useRef(null);
  const downloadSpec = download && {
    chartRef: plotRef,
    name: download.filename,
    exportOptions: {
      title,
      description: typeof about === "string" ? about : "",
      legendItems: download.legendItems || [],
      logo: CHART_LOGO,
      // The legend is drawn outside the chart's SVG
      reservedLegendHeight: 0,
    },
    csv: download.csv,
    image: download.image !== false,
  };
  const text = (n) => (typeof n === "string" ? fyDash(plainWords(n)) : n);
  const aboutNotes = (notes || []).filter(Boolean);
  const boxNotes = (boxes || []).filter(Boolean);

  return (
    <div className="ls-card">
      <div className="chart-header">
        <div>
          <h3>{title}</h3>
          {summary && <p className="chart-description">{summary}</p>}
        </div>
        {downloadSpec && <ChartDownloadMenu download={downloadSpec} chartTitle={title} />}
      </div>
      <div className="chart-controls ls-controls">{controls}</div>
      {/* display: contents, so the plot, legend and logo are rows of the card */}
      <div className="ls-chart-rows" ref={plotRef}>
        {children}
      </div>
      <div className="ls-card-footer">
        {footer}
        {boxNotes.length > 0 && (
          <div className="ls-card-box">
            {boxNotes.map((n, i) => (
              <Note key={typeof n === "string" ? n : i}>{text(n)}</Note>
            ))}
          </div>
        )}
        {source && <p className="ls-source">{source}</p>}
        {(about || aboutNotes.length > 0) && (
          <Disclosure inCard title="About this chart">
            {about && <p>{about}</p>}
            {aboutNotes.length > 0 && (
              <ul className="ls-about-notes">
                {aboutNotes.map((n, i) => (
                  <li key={typeof n === "string" ? n : i}>{text(n)}</li>
                ))}
              </ul>
            )}
          </Disclosure>
        )}
      </div>
    </div>
  );
}
