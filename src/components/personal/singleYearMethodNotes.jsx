import SourceLink from "../SourceLink";
import TitleIcon from "../TitleIcon";
import "./singleYearMethodNotes.css";

// The longer notes of "About these figures" (SINGLE_YEAR_METHOD): a
// one-line summary, the rest behind a Details toggle, one short line per
// idea, each fact once
function Note({ icon, lead, points }) {
  return (
    <div className="method-note">
      <p className="method-note-lead">
        <TitleIcon name={icon} bare size={14} className="method-note-icon" />
        {lead}
      </p>
      <details className="method-note-details">
        <summary>Details</summary>
        <ul>
          {points.map((point, index) => (
            <li key={index}>{point}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}

export const CHANGE_BY_POLICY_NOTE = (
  <Note
    icon="hbars"
    lead="Each bar is one policy on its own."
    points={[
      "We switch it on alone, with every other selected policy at current law, against the same baseline.",
      "Policies can interact, so their own effects need not add up to the combined change.",
      "A difference of £1 or more shows as “Interaction between policies”, so the bars add up to the headline change.",
    ]}
  />
);

export const EVERY_POLICY_NOTE = (
  <Note
    icon="receipt"
    lead="We simulate your household in policyengine-uk under the selected policies, as in the national figures."
    // Lines true whatever is selected: a note about one measure would stay
    // on the page when that measure changes or isn't published (#104)
    points={[
      "Fuel duty acts on the petrol and diesel spending you enter, and VAT on that and the electricity spending.",
      "We treat every couple as married, as the calculator does not ask, so the Marriage Allowance can apply. An unmarried couple with one partner over State Pension age can see a different change in Universal Credit.",
      "A policy with no effect in the chosen year shows no change.",
    ]}
  />
);

export const WHO_IS_A_CHILD_NOTE = (
  <Note
    icon="users"
    lead="Everyone under 16, and a 16- to 19-year-old in full-time non-advanced education."
    points={[
      "The education must have begun before 19 (school or college), as you answer for each.",
      "Child Benefit counts such a young person until 20.",
      "Universal Credit stops at the 1 September after their 19th birthday, so a 19-year-old counts for Child Benefit but not Universal Credit.",
    ]}
  />
);

export const COUNCIL_TAX_NOTE = (
  <Note
    icon="building"
    lead="We estimate Council Tax from your band and your council's Band D, and take it off net income."
    points={[
      <>
        Each council's Band D is policyengine-uk's, from{" "}
        <SourceLink source="mhclg_council_tax">MHCLG</SourceLink>{" "}for England and the{" "}
        <SourceLink source="wales_council_tax">Welsh</SourceLink> and{" "}
        <SourceLink source="scotland_council_tax">Scottish</SourceLink>
        {" governments. Until you pick your council, it is your region's average, which in England weights each council by its tax base."}
      </>,
      "We start from 2026-27 levels and grow them to the chosen year with policyengine-uk's OBR Council Tax forecast.",
      "Northern Ireland has domestic rates, which we do not model.",
    ]}
  />
);

export const MARGINAL_RATE_NOTE = (
  <Note
    icon="percent"
    lead="The share of an extra pound of salary that taxes and benefit withdrawals take, with everything else as you entered it."
    points={[
      "The rate we state for you is over the next £200 of your salary, the step the Child Benefit charge moves in; the chart's steps are between neighbouring points of the earnings sweep, so near a threshold they can average across it.",
      "“Of your next £1,000” applies that rate to £1,000. Where earning the next £200 lowers net income by more than £200 (a cliff, such as losing childcare support above £100,000), the sentence is about that £200 instead.",
      "Known limits: the model counts Council Tax Reduction only where it has the local scheme, so rates come out too low for people who get it elsewhere.",
    ]}
  />
);
