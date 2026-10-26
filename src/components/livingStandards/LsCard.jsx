import { useRef } from "react";
import ChartDownloadMenu from "../ChartDownloadMenu";
import Disclosure from "../Disclosure";
import { CHART_LOGO } from "../../utils/chartLogo";
import { fyDash } from "../../utils/livingStandards/outlook";
import { plainWords } from "./sources";
import TitleIcon from "../TitleIcon";

/**
 * A Living standards chart card in the dashboard's card layout: the title
 * with its period ("…, 2027-28 to 2031-32") and the Download menu, the
 * summary sentence as the description, the in-card controls on one row,
 * the plot (with its legend and logo), and a closed "About this chart".
 * Nothing else sits under the plot: the definition (about), the notes and
 * the source line (last) are all inside "About this chart". Each part is a
 * direct child of the card, so two cards side by side share rows and line
 * up.
 *
 * children fill the plot, legend and logo rows: LsLineChart or LsBarChart,
 * or a <div className="chart-plot"> for anything else.
 *
 * source is the line shown in the card; sourceText the same in plain
 * words, which the PNG and SVG carry after the definition (the CSV carries
 * its own source line).
 *
 * download: { filename, csv: () => string, legendItems?, image?: false }.
 */
export default function LsCard({
  // The card's element id, for a link to it (a twin card's)
  id,
  title,
  // One line under the title: which side of a pair the card is (with or
  // without the measures) and a link to its twin
  subtitle,
  icon,
  period,
  summary,
  about,
  controls,
  download,
  children,
  notes,
  source,
  sourceText,
  // A footer of the card's own in place of "About this chart" (e.g. a
  // measures chart's "More info")
  footer,
  className = "",
}) {
  const plotRef = useRef(null);
  const fullTitle = period ? `${title}, ${period}` : title;
  const aboutText = typeof about === "string" ? fyDash(plainWords(about)) : "";
  const downloadSpec = download && {
    chartRef: plotRef,
    name: download.filename,
    exportOptions: {
      title: fullTitle,
      description: [aboutText, sourceText && `Source: ${sourceText}`].filter(Boolean).join(" "),
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

  return (
    <div id={id} className={`ls-card ${className}`.trim()}>
      <div className="chart-header">
        <div>
          <h3>
            {icon && <TitleIcon name={icon} />}
            {/* The years are on the axes, the From/to pill and the headline
                sentence; the downloads keep them in their titles */}
            <span className="title-text">{title}</span>
          </h3>
          {subtitle && <p className="ls-card-subtitle">{subtitle}</p>}
          {summary && <p className="chart-description">{summary}</p>}
        </div>
        {downloadSpec && <ChartDownloadMenu download={downloadSpec} chartTitle={fullTitle} />}
      </div>
      <div className="chart-controls ls-controls">{controls}</div>
      {/* display: contents, so the plot, legend and logo are rows of the card */}
      <div className="ls-chart-rows" ref={plotRef}>
        {children}
      </div>
      <div className="ls-card-footer">
        {footer}
        {!footer && (about || aboutNotes.length > 0 || source) && (
          <Disclosure inCard title="About this chart">
            {about && <p>{text(about)}</p>}
            {aboutNotes.length > 0 && (
              <ul className="ls-about-notes">
                {aboutNotes.map((n, i) => (
                  <li key={typeof n === "string" ? n : i}>{text(n)}</li>
                ))}
              </ul>
            )}
            {source && <p className="ls-source">{source}</p>}
          </Disclosure>
        )}
      </div>
    </div>
  );
}
