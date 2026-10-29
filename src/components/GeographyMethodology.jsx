import { CATEGORY_BREAKS } from "../utils/geography/classify";
import { formatFigure } from "../utils/geography/format";
import { CalendarClock, EyeOff, Hash, Layers, Palette, Ruler, ShieldCheck, Target, Info } from "lucide-react";
import FactList from "./methodology/FactList";
import { ExternalLink } from "./methodology/MethodUi";
import "./GeographyMethodology.css";

export const METHOD_NOTE_URL =
  "https://github.com/PolicyEngine/microcosm/issues/1131";

const breaks = (outcome) => {
  const { small, large } = CATEGORY_BREAKS[outcome];
  const show = (text) => formatFigure(outcome, text, { signed: false });
  return { small: show(small), large: show(large) };
};

/**
 * How the figures by constituency are estimated and protected,
 * as a fact grid. Shown on the Methodology view; the map links to it.
 */
function GeographyMethodology() {
  const percent = breaks("relative_change");
  const pounds = breaks("average_change");

  return (
    <div className="geography-method">
      <FactList
        className="method-checklist"
        items={[
          [
            "At least 10 households",
            {
              points: [
                "Every published figure rests on at least 10 survey households.",
                "No single household dominates it: each figure is checked against dominance and p% rules before it is published.",
              ],
            },
            ShieldCheck,
          ],
          [
            "90% intervals",
            {
              points: [
                "Each figure comes with a 90% interval, from resampling survey households with their weights held fixed.",
                "Holding the weights fixed leaves out some of the uncertainty, so the intervals understate it.",
              ],
            },
            Ruler,
          ],
          [
            "Rounding",
            <>
              Figures are rounded to the precision the data supports, so a
              less certain figure has fewer digits.
            </>,
            Hash,
          ],
          [
            "Approximate",
            <>
              An approximate figure rests on few survey households. Its
              interval understates the uncertainty, so read it as a rough
              guide.
            </>,
            Info,
          ],
          [
            "Not published",
            <>
              Some figures are not published, to protect the confidentiality
              of survey respondents. The map shows these constituencies as no
              data, and the tables mark them.
            </>,
            EyeOff,
          ],
          [
            "Map colours",
            {
              lead: "The map groups figures into categories with breaks fixed in advance:",
              points: [
                `little change: under ${percent.small} of income (${pounds.small} a year) either way;`,
                `small change: up to ${percent.large} (${pounds.large});`,
                "large change: more.",
                "A constituency is coloured only when its interval lies within one category or two neighbouring ones; otherwise it is too uncertain to classify, and the map shows it as no data.",
              ],
            },
            Palette,
          ],
          [
            "Local-area dataset",
            <>
              Constituency figures come from Microcosm&apos;s local-area
              dataset, in which each household belongs to one constituency,
              not from the national file behind the other figures. The data
              certificate covers only the national file, so read them as
              estimates.
            </>,
            Layers,
          ],
          [
            "Local calibration",
            {
              points: [
                "The local-area file is calibrated to local totals of council tax bands, electricity and gas use, employment and self-employment income, Universal Credit, age, tenure and rents.",
                "Savings, property, pension and road-fuel incomes, and carers, are calibrated by region at most, so the map for a policy acting on them follows age, tenure and earnings, not observed local totals.",
              ],
            },
            Target,
          ],
          [
            "Later years",
            <>
              Each household keeps its constituency in every year; later years
              use that year&apos;s household weights.
            </>,
            CalendarClock,
          ],
        ]}
      />
      <p className="method-more">
        <ExternalLink href={METHOD_NOTE_URL}>Read the method note for constituency figures</ExternalLink>
        .
      </p>
    </div>
  );
}

export default GeographyMethodology;
