// Incomes and poverty under current law, before any Budget measure: the
// last section of Population impact's Living standards and Poverty
// sub-tabs, under the measures' effect. Ported from
// PolicyEngine/uk-living-standards-outlook (branch review-1-fixes,
// db0c8e4). It reads public/data/living_standards_outlook.json, which runs
// on its own engine version; the Methodology view states that version, the
// data's status, its notes and what the baseline leaves out. The cards'
// choices are in the address (?ls_from, ?ls_to, ?ls_growth, …).

import SectionHeading from "../SectionHeading";
import SourceLink from "../SourceLink";
import { GrowthCard, IncomesOverTimeCard, InequalityOverTimeCard, PovertyOverTimeCard } from "./sections/ViewCards";
import WhoIsInPovertySection from "./sections/WhoIsInPovertySection";
import { OutlookStatus, useOutlook } from "./useOutlook";
import "./LivingStandards.css";

// Each section is one row of two cards that line up (a card alone takes the
// full width). A card shows one view at a time, with a Show pill; notes and
// sources sit in its "About this chart". The subtitle says plainly that it
// is without the measures.
const SECTIONS = {
  incomes: {
    title: "Incomes under current law",
    subtitle: (
      <>
        Without the measures: incomes before any Budget measure, on the{" "}
        <SourceLink source="obr_efo_march_2026">OBR March 2026</SourceLink> forecast.
      </>
    ),
    cards: [IncomesOverTimeCard, GrowthCard],
  },
  poverty: {
    title: "Poverty under current law",
    subtitle: "Without the measures: poverty before any Budget measure.",
    cards: [PovertyOverTimeCard, WhoIsInPovertySection],
  },
};

/**
 * One baseline section, "incomes" or "poverty". Cards whose data block is
 * missing are skipped; a pair with one card left renders it full width.
 */
export default function CurrentLawSection({ id }) {
  const { loading, data, error } = useOutlook();
  const section = SECTIONS[id];
  const cards = data ? section.cards.filter((S) => !S.requires || data[S.requires]) : [];
  return (
    <>
      <OutlookStatus loading={loading} error={error} />
      {cards.length > 0 && (
        <>
          <SectionHeading title={section.title} subtitle={section.subtitle} />
          <section id={`current-law-${id}`} className="report-section ls-section">
            <div className="charts-grid">
              {cards.map((S, j) => (
                <S key={j} data={data} />
              ))}
            </div>
          </section>
        </>
      )}
    </>
  );
}

/**
 * Inequality over time under current law, as one card for the Inequality
 * section, beside the measures' effect on it; nothing until the outlook is
 * read (the incomes section above says it is loading).
 */
export function CurrentLawInequalityCard() {
  const { data } = useOutlook();
  if (!data?.[InequalityOverTimeCard.requires]) return null;
  return <InequalityOverTimeCard data={data} />;
}
