// The Living standards view's method, in the Methodology view: the engine
// and data its baseline runs on and their status, the prices and sources,
// the notes on the data, and what the baseline leaves out. Each is said
// here and nowhere else. Read from public/data/living_standards_outlook.json
// (meta), the file the Living standards view draws; the notes are written by
// this repo's pipeline (uk-budget-data living-standards).

import { useEffect, useState } from "react";
import FactList from "./FactList";
import { TriangleAlert } from "lucide-react";
import { ExternalLink, SourceLink, Tag } from "./MethodUi";
import { describeDataset, fyDash, fyLabel, loadOutlook, periodLabel, splitSource } from "../../utils/livingStandards/outlook";
import { HBAI_URL, plainWords, scrubNote } from "../livingStandards/sources";
import { METHOD_ANCHORS } from "./anchors";

// Notes said elsewhere: the validation status (Status, below) and the Budget
// forecast date (the Forecast changes subtitle).
const UNVALIDATED = /unvalidated|not yet validated/i;
const SAID_ELSEWHERE = [UNVALIDATED, /OBR forecast is due on/i];

// A package's GitHub release, by the version the outlook file records
// (each tag is the bare version, e.g. policyengine.py 6.10.2, policyengine-uk 2.132.6)
const releaseUrl = (repo, version) => `https://github.com/PolicyEngine/${repo}/releases/tag/${version}`;

/** The deflators in a few words, from meta.deflator. */
function deflatorWords(text = "") {
  if (/consumer_price_index_ahc|CPI after housing costs/i.test(text)) {
    return "CPI; CPI after housing costs for AHC";
  }
  return /OBR CPI/i.test(text) ? "CPI" : null;
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
    value: (
      <>
        Patched for {span} (
        <ExternalLink href={fix.upstream_fix_url}>
          {fix.upstream_fix.replace(/^PolicyEngine\//, "").replace("#", " #")}
        </ExternalLink>
        )
      </>
    ),
    more: [
      `policyengine-uk ${engine} ends the protection of pre-2026 claimants' UC health element after ${last}, so every claimant falls to the new-claimant rate; the fix is in ${fix.fixed_in}.`,
      "Here, protected claimants keep the protected amount and new claimants the new-claimant amount, both uprated with benefits.",
      `${Math.round(fix.new_claimant_share * 100)}% of claimants count as new, as in ${last}.`,
    ],
  };
}

// In the data's notes, a policyengine-uk pull request ("policyengine-uk#2531")
// and the HBAI statistics are named in words; each becomes a link
const NOTE_LINKS = /(policyengine-uk ?#\d+|Households Below Average Income)/;
function linkNote(note) {
  if (typeof note !== "string" || !NOTE_LINKS.test(note)) return note;
  return note.split(NOTE_LINKS).map((part, index) => {
    const pr = part.match(/^policyengine-uk ?#(\d+)$/);
    if (pr) {
      return (
        <ExternalLink key={index} href={`https://github.com/PolicyEngine/policyengine-uk/pull/${pr[1]}`}>
          {part}
        </ExternalLink>
      );
    }
    if (part === "Households Below Average Income") {
      return (
        <ExternalLink key={index} href={HBAI_URL}>
          {part}
        </ExternalLink>
      );
    }
    return part;
  });
}

/**
 * The data's notes on each chart, moved here from the cards' About this
 * chart, which keep only what is needed to read the chart and link here.
 */
function ChartNotes({ outlook, meta }) {
  if (!outlook) return null;
  const groups = [
    ["Incomes over time", [meta.cpi_ahc_note]],
    ["Inequality over time", outlook.inequality?.notes],
    ["Growth across the distribution", outlook.income_by_decile?.notes],
    ["Poverty over time", outlook.poverty?.notes],
    ["Depth of poverty", outlook.deep_poverty?.notes],
    ["Who is in poverty", (outlook.poverty_by_group?.notes || []).filter((n) => !/^Region/.test(n))],
  ]
    .map(([title, notes]) => [title, (notes || []).filter(Boolean).map(scrubNote).map(linkNote)])
    .filter(([, notes]) => notes.length);
  if (!groups.length) return null;
  return (
    <div id={METHOD_ANCHORS.lsNotes} className="card method-card method-anchor">
      <h3 className="method-card-title">Notes on the forecast charts</h3>
      <FactList items={groups.map(([title, notes]) => [title, { points: notes }, TriangleAlert])} />
    </div>
  );
}

/** The engine, data and status of the Living standards baseline, then its notes and gaps. */
export default function LivingStandardsMethod() {
  const [meta, setMeta] = useState(null);
  const [outlook, setOutlook] = useState(null);

  useEffect(() => {
    let live = true;
    loadOutlook().then((r) => {
      // Without the file this says nothing; the Living standards view
      // reports the error.
      if (live && r.data?.meta) {
        setMeta(r.data.meta);
        setOutlook(r.data);
      }
    });
    return () => {
      live = false;
    };
  }, []);

  if (!meta) return null;

  const ds = describeDataset(meta.dataset);
  const dataset = [ds.name, ds.date].filter(Boolean).join(", ") + (ds.id ? ` (${ds.id})` : "");
  // The outlook's status, from its own notes
  const unvalidated = (meta.notes || []).some((n) => UNVALIDATED.test(n));
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
            [
              "Model",
              <>
                <ExternalLink href={releaseUrl("policyengine.py", meta.policyengine)}>policyengine {meta.policyengine}</ExternalLink>{" "}
                (<ExternalLink href={releaseUrl("policyengine-uk", meta.policyengine_uk)}>policyengine-uk {meta.policyengine_uk}</ExternalLink>)
              </>,
            ],
            ["Data", dataset],
            unvalidated && ["Status", <Tag key="status" tone="warning">Unvalidated</Tag>],
            meta.headline_start_year &&
              meta.headline_end_year && ["Period", periodLabel(meta.headline_start_year, meta.headline_end_year)],
            meta.real_price_base && [
              "Prices",
              `${fyDash(meta.real_price_base)} prices` +
                (deflatorWords(meta.deflator) ? ` (${deflatorWords(meta.deflator)})` : ""),
            ],
            meta.uc_health_element_extension?.applied && [
              "UC health element",
              ucHealthElementFix({ fix: meta.uc_health_element_extension, engine: meta.policyengine_uk }),
            ],
            [
              "Sources",
              {
                value: (
                  <>
                    <ExternalLink href={hbai.url || HBAI_URL}>DWP HBAI</ExternalLink>
                    ; <SourceLink id="obr_efo_current" />
                  </>
                ),
                more: notes.map((n) => linkNote(text(n))),
              },
            ],
          ].filter(Boolean)}
        />
      </div>

      <ChartNotes outlook={outlook} meta={meta} />

      {caveats.length > 0 && (
        <div className="card method-card">
          <h3 className="method-card-title">What the baseline leaves out</h3>
          <p className="method-lead">Gaps and simplifications that change how the projections read.</p>
          <ul className="method-list method-list-icons method-list-caveats">
            {caveats.map((c) => (
              <li key={c}>
                <TriangleAlert aria-hidden="true" strokeWidth={1.75} />
                <span>{linkNote(text(c))}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
