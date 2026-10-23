import { CATEGORY_BREAKS } from "../utils/geography/classify";
import { formatFigure } from "../utils/geography/format";
import "./GeographyMethodology.css";

export const METHOD_NOTE_URL =
  "https://github.com/PolicyEngine/microcosm/issues/1131";

const breaks = (outcome) => {
  const { small, large } = CATEGORY_BREAKS[outcome];
  const show = (text) => formatFigure(outcome, text, { signed: false });
  return { small: show(small), large: show(large) };
};

/**
 * How the figures by region and constituency are estimated and protected.
 * Shown on the Methodology view; the map links to it.
 */
function GeographyMethodology() {
  const percent = breaks("relative_change");
  const pounds = breaks("average_change");

  return (
    <div className="geography-method">
      <p>
        The figures by region and by constituency are estimated from a
        survey of households. Before a figure is published, it passes these
        checks.
      </p>
      <ul>
        <li>
          <strong>At least 10 households.</strong> Every published figure
          rests on at least 10 survey households, and no single household
          dominates it: each figure is checked against dominance and p%
          rules before it is published.
        </li>
        <li>
          <strong>90% intervals.</strong> Each figure comes with a 90%
          interval, from resampling survey households with their weights
          held fixed. Holding the weights fixed leaves out some of the
          uncertainty, so the intervals understate it.
        </li>
        <li>
          <strong>Rounding.</strong> Figures are rounded to the precision
          the data supports, so a less certain figure has fewer digits.
        </li>
        <li>
          <strong>Approximate.</strong> An approximate figure rests on few
          survey households. Its interval understates the uncertainty, so
          read it as a rough guide.
        </li>
        <li>
          <strong>Not published.</strong> Some figures are not published,
          to protect the confidentiality of survey respondents. The map
          hatches these constituencies, and the tables mark them.
        </li>
        <li>
          <strong>Map colours.</strong> The map groups figures into
          categories with breaks fixed in advance: little change is under{" "}
          {percent.small} of income ({pounds.small} a year) either way, a
          small change is up to {percent.large} ({pounds.large}), and a
          large change is more. A constituency is coloured only when its
          interval lies within one category or two neighbouring ones;
          otherwise it is too uncertain to classify.
        </li>
        <li>
          <strong>Constituencies and regions.</strong> Regional figures
          come from Microcosm&apos;s national dataset and constituency
          figures from its local dataset, in which each household belongs
          to one constituency. Both are built from the same survey
          households but weighted separately, so constituency figures do
          not add up exactly to the regional ones.
        </li>
        <li>
          <strong>Later years.</strong> Each household keeps its
          constituency in every year; later years use that year&apos;s
          household weights.
        </li>
      </ul>
      <p>
        <a href={METHOD_NOTE_URL} target="_blank" rel="noopener noreferrer">
          Read the method note for constituency figures
        </a>
        .
      </p>
    </div>
  );
}

export default GeographyMethodology;
