// The Living standards view's method, in the Methodology view: the engine
// and data its baseline runs on and their status, the prices and sources,
// the notes on the data, and what the baseline leaves out. Each is said
// here and nowhere else. Read from public/data/living_standards_outlook.json
// (meta), the file the Living standards view draws; the notes are written by
// this repo's pipeline (uk-budget-data living-standards).

import { useEffect, useState } from "react";
import FactList from "./FactList";
import { BookOpen, Info, TriangleAlert } from "lucide-react";
import { Tag } from "./MethodUi";
import { describeDataset, fyDash, fyLabel, loadOutlook, periodLabel, splitSource } from "../../utils/livingStandards/outlook";
import { HBAI_URL, OBR_EFO_TITLE, OBR_EFO_URL, plainWords } from "../livingStandards/sources";

// Notes said elsewhere: the demo status (Status, below) and the Budget
// forecast date (the Forecast changes subtitle).
const SAID_ELSEWHERE = [/unvalidated demo output/i, /OBR forecast is due on/i];

const ext = { target: "_blank", rel: "noopener noreferrer" };

/** The deflators in a few words, from meta.deflator. */
function deflatorWords(text = "") {
  if (/consumer_price_index_ahc|CPI after housing costs/i.test(text)) {
    return "incomes before housing costs deflated by OBR CPI, after housing costs by CPI after housing costs";
  }
  return /OBR CPI/i.test(text) ? "OBR CPI" : null;
}

/**
 * meta.uc_health_element_extension, when applied: the years and the upstream
 * fix this repo's pipeline reproduces on an engine without it.
 */
function ucHealthElementFix({ fix, engine }) {
  const years = (fix.years || []).map(fyLabel);
  const span = years.length > 1 ? `${years[0]} and ${years[years.length - 1]}` : years[0];
  // The last year the engine's own scenario sets: the year before the fix's first.
  const last = fix.years?.length ? fyLabel(fix.years[0] - 1) : null;
  return {
    lead: (
      <>
        policyengine-uk {engine} ends the protection of pre-2026 claimants&apos; UC health element after {last}, so
        every claimant falls to the new-claimant rate (fixed in {fix.fixed_in},{" "}
        <a href={fix.upstream_fix_url} {...ext}>
          {fix.upstream_fix}
        </a>
        ).
      </>
    ),
    points: [
      `For ${span} this baseline applies that fix itself.`,
      "Protected claimants keep the protected amount and new claimants the new-claimant amount, both uprated with benefits.",
      `${Math.round(fix.new_claimant_share * 100)}% of claimants count as new, as in ${last}.`,
    ],
  };
}

/** The engine, data and status of the Living standards baseline, then its notes and gaps. */
export default function LivingStandardsMethod() {
  const [meta, setMeta] = useState(null);

  useEffect(() => {
    let live = true;
    loadOutlook().then((r) => {
      // Without the file this says nothing; the Living standards view
      // reports the error.
      if (live && r.data?.meta) setMeta(r.data.meta);
    });
    return () => {
      live = false;
    };
  }, []);

  if (!meta) return null;

  const ds = describeDataset(meta.dataset);
  const dataset = [ds.name, ds.date && `(${ds.date}${ds.id ? `, ${ds.id}` : ""})`].filter(Boolean).join(" ");
  const hbai = splitSource(meta.outturn_source);
  const notes = (meta.notes || []).filter((n) => !SAID_ELSEWHERE.some((re) => re.test(n)));
  const caveats = meta.caveats || [];
  const text = (s) => fyDash(plainWords(s));

  return (
    <>
      <div className="card method-card">
        <h3 className="method-card-title">Engine and data</h3>
        <FactList
          items={[
            ["Model", `policyengine ${meta.policyengine} (policyengine-uk ${meta.policyengine_uk})`],
            ["Data", dataset],
            ["Status", <Tag key="status" tone="warning">Unvalidated.</Tag>],
            meta.headline_start_year &&
              meta.headline_end_year && ["Period", periodLabel(meta.headline_start_year, meta.headline_end_year)],
            meta.real_price_base && [
              "Prices",
              [`${fyDash(meta.real_price_base)} prices`, deflatorWords(meta.deflator)].filter(Boolean).join("; "),
            ],
            meta.uc_health_element_extension?.applied && [
              "UC health element",
              ucHealthElementFix({ fix: meta.uc_health_element_extension, engine: meta.policyengine_uk }),
            ],
            [
              "Sources",
              {
                points: [
                  <>
                    DWP,{" "}
                    <a href={hbai.url || HBAI_URL} {...ext}>
                      Households Below Average Income
                    </a>
                  </>,
                  <>
                    Office for Budget Responsibility,{" "}
                    <a href={OBR_EFO_URL} {...ext}>
                      {OBR_EFO_TITLE}
                    </a>
                  </>,
                ],
              },
            ],
          ].filter(Boolean)}
        />
        {notes.length > 0 && (
          <>
            <h4 className="method-subhead">
              <BookOpen aria-hidden="true" strokeWidth={1.75} />
              Notes on the sources
            </h4>
            <ul className="method-list method-list-icons">
              {notes.map((n) => (
                <li key={n}>
                  <Info aria-hidden="true" strokeWidth={1.75} />
                  <span>{text(n)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {caveats.length > 0 && (
        <div className="card method-card">
          <h3 className="method-card-title">What the baseline leaves out</h3>
          <p className="method-lead">Gaps and simplifications that change how the projections read.</p>
          <ul className="method-list method-list-icons method-list-caveats">
            {caveats.map((c) => (
              <li key={c}>
                <TriangleAlert aria-hidden="true" strokeWidth={1.75} />
                <span>{text(c)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
