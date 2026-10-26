// How the forecast feeds the dashboard's baseline: one neutral line, with
// the detail (basis, years, the policyengine-uk parameter each series sets)
// under "More info". The parameter paths come from the outlook data.

import { Calculator } from "lucide-react";
import Disclosure from "../../Disclosure";
import { seriesName } from "../../../utils/livingStandards/forecastWords";

export default function ForecastFeedNote({ forecast }) {
  const series = forecast.sections.flatMap((s) => s.series).filter((s) => s.parameter);
  return (
    <div className="forecast-feed">
      <div className="forecast-feed-head">
        <span className="forecast-feed-icon" aria-hidden="true">
          <Calculator size={16} strokeWidth={1.8} />
        </span>
        <div>
          <h3>What this means for the Budget figures</h3>
          <p>
            The baseline grows wages, benefits, prices and rents at these rates, so the dashboard&apos;s incomes and
            poverty figures start from them.
          </p>
        </div>
      </div>
      <Disclosure inCard title="More info">
        <ul className="ls-about-notes">
          <li>Each figure is the growth in a calendar year&apos;s average on the year before.</li>
          <li>
            A financial year takes the growth of the calendar year it starts in. 2031-32 is past the OBR forecast and
            uses policyengine-uk&apos;s long-run assumptions.
          </li>
          <li>Benefit rates in the baseline follow a lagged CPI index built from this forecast.</li>
          {series.length > 0 && (
            <li>
              The policyengine-uk parameter each series sets:
              <ul className="forecast-feed-params">
                {series.map((s) => (
                  <li key={s.key}>
                    {seriesName(s)}: <code>{s.parameter}</code>
                  </li>
                ))}
              </ul>
            </li>
          )}
        </ul>
      </Disclosure>
    </div>
  );
}
