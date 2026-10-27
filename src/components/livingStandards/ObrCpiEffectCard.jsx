// Effect of the Budget's policies on CPI inflation (OBR): the OBR's own
// estimate, year by year, of how the Budget's policies change CPI
// inflation, from public/data/obr_cpi_policy_effect.json (obrCpiEffect.js;
// filled by hand on Budget day, docs/obr-cpi-policy-effect.md). Drawn on
// Forecast changes under the prices group, full width; not drawn at all
// until the file is published. Bars in neutral colours: a lower or higher
// CPI rate is neither a gain nor a loss on its own.

import { useEffect, useState } from "react";
import LsCard from "./LsCard";
import { LsBarChart } from "./LsCharts";
import ControlBar from "../ControlBar";
import ViewToggle from "../ViewToggle";
import ViewLink from "../ViewLink";
import { CHART_COLOURS } from "../../utils/chartTheme";
import { buildChartCsv } from "../../utils/chartCsv";
import {
  basisWords,
  cachedObrCpiEffect,
  effectRows,
  loadObrCpiEffect,
  obrCpiEffectSentence,
  obrCpiEffectTitle,
  ppAxis,
  ppText,
  ppText2,
  ppSize2,
} from "../../utils/livingStandards/obrCpiEffect";

export const OBR_CPI_EFFECT_ANCHOR = "obr-cpi-effect";
export const HOUSEHOLDS_LINK = "See the policies' effect on households →";

// The total, and each measure in turn; the indirect effect (the output gap) grey
const TOTAL_COLOUR = CHART_COLOURS.marketIncome;
const MEASURE_COLOURS = [
  CHART_COLOURS.marketIncome,
  CHART_COLOURS.ageOlder,
  CHART_COLOURS.pensionContributions,
  CHART_COLOURS.ageChildren,
  CHART_COLOURS.agePension,
  CHART_COLOURS.highlight,
];
const INDIRECT_COLOUR = CHART_COLOURS.noChange;

const SHOWS = [
  { value: "total", label: "Total" },
  { value: "measures", label: "By policy" },
];

/** The file's state, read once per page: null while loading. */
function useObrCpiEffect() {
  const [state, setState] = useState(() => cachedObrCpiEffect());
  useEffect(() => {
    if (state) return undefined;
    let live = true;
    loadObrCpiEffect().then((r) => {
      if (live) setState(r);
    });
    return () => {
      live = false;
    };
  }, [state]);
  return state;
}

/** The series for each measure, in the file's order, in neutral colours. */
function measureSeries(effect) {
  let next = 0;
  return effect.measures.map((m, j) => ({
    key: `m${j}`,
    name: m.name,
    colour: m.indirect ? INDIRECT_COLOUR : MEASURE_COLOURS[next++ % MEASURE_COLOURS.length],
  }));
}

/** The source in plain words, for the downloads and the card. */
export function obrCpiSourceText(effect) {
  const where = [effect.sourceTable, effect.page && `page ${effect.page}`, effect.sourceFile].filter(Boolean).join(", ");
  return `OBR, ${effect.efo}: ${where}`;
}

/**
 * @param {Object} props
 * @param {"chart"|"table"} [props.view] - Chart or table, shared with the forecast cards
 * @param {(view: string) => void} [props.onViewChange]
 * @param {(tab: string, sub?: string) => void} [props.onShowTab] - Opens Population impact in place
 */
export default function ObrCpiEffectCard({ view = "chart", onViewChange, onShowTab }) {
  const state = useObrCpiEffect();
  if (state?.status !== "ready") return null;
  return <LoadedCard effect={state.effect} view={view} onViewChange={onViewChange} onShowTab={onShowTab} />;
}

function LoadedCard({ effect, view, onViewChange, onShowTab }) {
  const hasMeasures = effect.measures.length > 0;
  const [show, setShow] = useState("total");
  const title = obrCpiEffectTitle(effect);
  const rows = effectRows(effect);
  const measures = measureSeries(effect);
  const byMeasure = show === "measures" && hasMeasures;
  const series = byMeasure ? measures : [{ key: "total", name: "All policies", colour: TOTAL_COLOUR }];
  const basis = basisWords(effect.basis);
  const period = `${rows[0].year} to ${rows[rows.length - 1].year}`;
  const sourceText = obrCpiSourceText(effect);
  const sentence = obrCpiEffectSentence(effect.years);
  const about = `The OBR's estimate of how the Budget's policies change CPI inflation in each year, in percentage points, by ${basis.replace(/s$/, "")}. It is the OBR's figure, not PolicyEngine's: PolicyEngine's estimates of the policies are on Population impact.`;
  const notes = [
    effect.previous &&
      `These are the figures for ${effect.budget}, shown as an example: on Budget day the card shows this Budget's figures from the OBR's new Economic and fiscal outlook.`,
    hasMeasures &&
      measures.some((m, j) => effect.measures[j].indirect) &&
      `${effect.measures.filter((m) => m.indirect).map((m) => m.name).join(" and ")}: the indirect effect of the whole package through the economy, not a policy of its own.`,
    ...effect.notes,
  ];
  const csv = () =>
    buildChartCsv({
      title,
      units: `Effect on CPI inflation (percentage points); ${basis}`,
      source: sourceText,
      columns: [
        { key: "year", label: "Year" },
        ...measures.map((m) => ({ key: m.key, label: m.name, decimals: 4 })),
        { key: "total", label: "Total", decimals: 4 },
      ],
      rows,
      notes: notes.filter(Boolean),
    });

  const values = byMeasure
    ? rows.flatMap((r) => {
        const parts = measures.map((m) => r[m.key]);
        return [parts.filter((v) => v < 0).reduce((a, b) => a + b, 0), parts.filter((v) => v > 0).reduce((a, b) => a + b, 0)];
      })
    : rows.map((r) => r.total);
  const axis = ppAxis(values);

  const common = {
    id: OBR_CPI_EFFECT_ANCHOR,
    title,
    icon: "tag",
    period,
    summary: sentence,
    subtitle: (
      <ViewLink tab="dashboard" onShowTab={onShowTab}>
        {HOUSEHOLDS_LINK}
      </ViewLink>
    ),
    about,
    notes,
    sourceText,
    source: (
      <>
        Source:{" "}
        {effect.efoUrl ? (
          <a href={effect.efoUrl} target="_blank" rel="noopener noreferrer">
            OBR, {effect.efo}
          </a>
        ) : (
          `OBR, ${effect.efo}`
        )}
        {`: ${[effect.sourceTable, effect.page && `page ${effect.page}`, effect.sourceFile].filter(Boolean).join(", ")}.`}
      </>
    ),
    controls: hasMeasures && (
      <ControlBar
        name={title}
        options={[{ label: "Show", value: show, onChange: setShow, options: SHOWS }]}
      />
    ),
    viewToggle: onViewChange && <ViewToggle value={view} onChange={onViewChange} name={title} />,
  };

  if (view === "table") {
    return (
      <LsCard {...common} download={{ filename: "obr-cpi-policy-effect", image: false, csv }}>
        <div className="chart-plot ls-table-wrapper">
          <table className="ls-table">
            <thead>
              <tr>
                <th>Year</th>
                {byMeasure && measures.map((m) => <th key={m.key}>{m.name}</th>)}
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.year}>
                  <td>{row.year}</td>
                  {byMeasure && measures.map((m) => <td key={m.key}>{ppText2(row[m.key])}</td>)}
                  <td>{ppText2(row.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </LsCard>
    );
  }

  return (
    <LsCard
      {...common}
      download={{ filename: "obr-cpi-policy-effect", legendItems: series.map((s) => ({ label: s.name, color: s.colour })), csv }}
    >
      <LsBarChart
        data={rows}
        series={series}
        xFormat={String}
        yFormat={ppText}
        tooltipFormat={ppSize2}
        showPlus
        yLabel="Effect on CPI inflation (percentage points)"
        yDomain={axis.domain}
        yTicks={axis.ticks}
        stacked={byMeasure}
        stackOffset={byMeasure ? "sign" : undefined}
        legendItems={byMeasure ? undefined : []}
        maxBarSize={64}
      />
    </LsCard>
  );
}
