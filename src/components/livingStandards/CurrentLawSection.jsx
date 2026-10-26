// Incomes and poverty under current law, before any Budget measure: the
// OBR forecast's Living standards and Poverty sub-tabs, the twins
// of Population impact's sub-tabs of the same names (which show the
// measures' effect). Ported from PolicyEngine/uk-living-standards-outlook
// (branch review-1-fixes, db0c8e4). It reads
// public/data/living_standards_outlook.json, which runs on its own engine
// version; the Methodology view states that version, the data's status, its
// notes and what the baseline leaves out. The cards' choices are in the
// address (?ls_from, ?ls_to, ?ls_growth, …).

import SectionHeading from "../SectionHeading";
import TwinLink from "../TwinLink";
import { GrowthCard, IncomesOverTimeCard, InequalityOverTimeCard, PovertyOverTimeCard } from "./sections/ViewCards";
import WhoIsInPovertySection from "./sections/WhoIsInPovertySection";
import PovertyTiles from "./sections/PovertyTiles";
import { OutlookStatus } from "./useOutlook";
import "./LivingStandards.css";

// Each sub-tab is one heading, then rows of two cards (each card's years
// compared are the first choice in its Options pill) that line up (a card alone takes the full width). A card shows
// one view at a time, with a Show pill; notes and sources sit in its "About
// this chart". The subtitle says plainly that it is without the measures,
// and links to the twin with them.
const SECTIONS = {
  living: {
    title: "Living standards under current law",
    icon: "wallet",
    // The forecast it is built on is named in the page intro
    subtitle: "Current law, before any Budget measure.",
    // One card a row, so the twentieths chart has room for every year;
    // growth first
    rows: [[GrowthCard], [IncomesOverTimeCard], [InequalityOverTimeCard]],
  },
  poverty: {
    title: "Poverty under current law",
    icon: "lifebuoy",
    subtitle: "Current law, before any Budget measure.",
    // The age groups at a glance, then one card a row: both open on
    // absolute poverty before housing costs, and the bars need the width
    lead: PovertyTiles,
    rows: [[PovertyOverTimeCard], [WhoIsInPovertySection]],
  },
};

/** Section ids, kept from before the move, so old #anchors still land. */
const SECTION_IDS = { living: "current-law-incomes", poverty: "current-law-poverty" };

/**
 * One current-law sub-tab, "living" or "poverty", from the outlook
 * (useOutlook, read once by the view). Cards whose data block is missing are
 * skipped; a row with one card left renders it full width.
 *
 * @param {Object} props
 * @param {"living"|"poverty"} props.id
 * @param {{loading: boolean, data: Object|null, error: string|null}} props.outlook
 * @param {(tab: string, sub: string) => void} [props.onShowTab] - Open the twin
 */
export default function CurrentLawSection({ id, outlook, onShowTab }) {
  const { loading, data, error } = outlook;
  const section = SECTIONS[id];
  const rows = data
    ? section.rows
        .map((row) => row.filter((S) => !S.requires || data[S.requires]))
        .filter((row) => row.length > 0)
    : [];
  return (
    <>
      <OutlookStatus loading={loading} error={error} />
      {rows.length > 0 && (
        <>
          <SectionHeading
            icon={section.icon}
            title={section.title}
            subtitle={
              <>
                {section.subtitle} <TwinLink tab="dashboard" sub={id} onShow={onShowTab} />
              </>
            }
          />
          <section id={SECTION_IDS[id]} className="report-section ls-section">
            {section.lead && <section.lead data={data} />}
            {rows.map((row, i) => (
              <div key={i} className="charts-grid">
                {row.map((S, j) => (
                  <S key={j} data={data} onShowTab={onShowTab} />
                ))}
              </div>
            ))}
          </section>
        </>
      )}
    </>
  );
}
