import SourceLink from "../SourceLink";
import TitleIcon from "../TitleIcon";
import "./singleYearMethodNotes.css";

// The longer notes of "About these figures" (SINGLE_YEAR_METHOD): a short
// lead, then one point per idea, each fact once
function Note({ icon, lead, points }) {
  return (
    <div className="method-note">
      <p className="method-note-lead">
        <TitleIcon name={icon} bare size={14} className="method-note-icon" />
        {lead}
      </p>
      <ul>
        {points.map((point, index) => (
          <li key={index}>{point}</li>
        ))}
      </ul>
    </div>
  );
}

export const CHANGE_BY_POLICY_NOTE = (
  <Note
    icon="hbars"
    lead="Each bar is one policy on its own."
    points={[
      "It is switched to its Budget setting, with every other selected policy at pre-Budget law, against the same baseline.",
      "Policies can interact, so their own effects need not add up to the combined change.",
      "A difference of £1 or more shows as “Interaction between policies”, so the bars add up to the headline change.",
    ]}
  />
);

export const EVERY_POLICY_NOTE = (
  <Note
    icon="receipt"
    lead="Each side is a policyengine-uk simulation of your household, with the policies' parameter and formula changes, as in the national figures."
    points={[
      "The fuel duty deferral includes the VAT on the lower pump price.",
      "The VAT changes apply to the petrol, diesel and electricity spending you enter.",
      "The employer NI relief for under-25s changes what employers pay, with wages held fixed, so it is £0 for every household (an employer cost).",
      <>
        The Warm Home Discount top-up is shown for a household that would get it, if received. Not every eligible
        household receives it: the national figures pay it to 85% of Pension Credit households and 70% of other
        eligible households (<SourceLink source="desnz_whd_ia">DESNZ receipt rates</SourceLink>).
      </>,
    ]}
  />
);

export const WHO_IS_A_CHILD_NOTE = (
  <Note
    icon="users"
    lead="Everyone under 16, and a 16- to 19-year-old in full-time non-advanced education (school or college) begun before 19, as you answer for each."
    points={[
      "Child Benefit counts such a young person until 20.",
      "Universal Credit stops at the 1 September after their 19th birthday, so a 19-year-old counts for Child Benefit but not Universal Credit.",
    ]}
  />
);

export const COUNCIL_TAX_NOTE = (
  <Note
    icon="building"
    lead="Estimated from your band and your region's average Band D for 2026-27, and taken off net income."
    points={[
      <>
        Band D averages: <SourceLink source="mhclg_council_tax">MHCLG</SourceLink> for England, tax-base weighted by
        region; the <SourceLink source="wales_council_tax">Welsh</SourceLink> and{" "}
        <SourceLink source="scotland_council_tax">Scottish</SourceLink> governments.
      </>,
      "Grown to the chosen year with policyengine-uk's OBR Council Tax forecast.",
      "Northern Ireland has domestic rates, which are not modelled.",
      "No selected policy changes it.",
    ]}
  />
);
