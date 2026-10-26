import GeographyMethodology from "./GeographyMethodology";
import LivingStandardsMethod from "./methodology/LivingStandardsMethod";
import ForecastFeedMethod from "./methodology/ForecastFeedMethod";
import FactList from "./methodology/FactList";
import MethodGlossary from "./methodology/MethodGlossary";
import { HIGHEST_PERCENTILE, LOWEST_PERCENTILE, ordinal } from "../utils/incomePosition";
import { HOUSEHOLD_ABOUT_ID, METHOD_ANCHORS } from "./methodology/anchors";
import MethodContents, { goToSection } from "./methodology/MethodContents";
import { NOT_MODELLED, unavailableMeasures } from "./methodology/measures";
import { SCATTER_BINS } from "../utils/publication/scatter";
import { AGE_BANDS, AGE_BAND_SOURCE, MIN_SAMPLE_SIZE } from "../utils/ageImpact";
import { SINGLE_AGE_FIRST, SINGLE_AGE_LAST } from "./youngPeople/youngPeopleData";
import { FIRST_DISPLAY_YEAR, LAST_DISPLAY_YEAR } from "../utils/displayYears";
import { fiscalYearTick } from "../utils/chartTheme";
import { useMeasureCatalogue } from "../utils/measureCatalogue";
import { AnchorLink, BackToTop, ExternalLink, Callout, IconChip, ReasonList, SourceLink, Tag } from "./methodology/MethodUi";
import { glossaryAnchor } from "./methodology/glossary";
import {
  ArrowRight,
  Calculator,
  ChevronDown,
  ChartColumn,
  Compass,
  Database,
  House,
  Info,
  MapPinned,
  TrendingUp,
  TriangleAlert,
  Users,
} from "lucide-react";
import "./methodology/Methodology.css";

/**
 * The ids of the Methodology view's sections, for links to them. Other
 * views link with these (the map to `geography`, Household impact to
 * `singleYear`), so a key's id must not change.
 */
export const METHOD_SECTIONS = {
  overview: "method-overview",
  data: "method-data",
  model: "method-model",
  population: "method-population",
  geography: "method-area",
  young: "method-young",
  personal: "method-personal",
  singleYear: "method-single-year",
  living: "method-living",
  limitations: "method-limitations",
};

/** The sections in the contents, in page order (the household calculation's block sits inside Household impact). */
export const METHOD_CONTENTS = [
  { id: METHOD_SECTIONS.overview, title: "At a glance", icon: Compass },
  { id: METHOD_SECTIONS.data, title: "Data", icon: Database },
  { id: METHOD_SECTIONS.model, title: "Model and measures", icon: Calculator },
  { id: METHOD_SECTIONS.population, title: "Population impact", icon: ChartColumn },
  { id: METHOD_SECTIONS.geography, title: "Figures by area", icon: MapPinned },
  { id: METHOD_SECTIONS.young, title: "Young people", icon: Users },
  { id: METHOD_SECTIONS.personal, title: "Household impact", icon: House },
  { id: METHOD_SECTIONS.living, title: "Pre-measures forecast", icon: TrendingUp },
  { id: METHOD_SECTIONS.limitations, title: "Limitations", icon: TriangleAlert },
];

const SECTION_ICONS = Object.fromEntries(METHOD_CONTENTS.map(({ id, icon }) => [id, icon]));

const pounds = (value) => `£${Math.round(value).toLocaleString("en-GB")}`;
const SCATTER_CHANGE_MAX = SCATTER_BINS.change_edges[SCATTER_BINS.change_edges.length - 1];
const SCATTER_CHANGE_EDGE_LIST = SCATTER_BINS.change_edges.filter((edge) => edge > 0).map(pounds);
const SCATTER_CHANGE_EDGES = SCATTER_CHANGE_EDGE_LIST.join(", ");
const yearRange = `${fiscalYearTick(FIRST_DISPLAY_YEAR)} to ${fiscalYearTick(LAST_DISPLAY_YEAR)}`;

/**
 * A section of the view: a header (icon and title), a short summary that
 * reads on its own, then the technical details, closed until asked for.
 */
function MethodSection({ id, title, summary, details, children, detailsLabel = "Technical details" }) {
  return (
    <section id={id} className="method-section" aria-labelledby={`${id}-title`}>
      <div className="section-heading method-section-heading">
        <IconChip icon={SECTION_ICONS[id]} />
        <div className="method-section-titles">
          <h2 id={`${id}-title`} tabIndex={-1}>
            {title}
          </h2>
        </div>
      </div>
      {summary && <div className="method-summary">{summary}</div>}
      {children}
      {details && (
        <details className="method-details">
          <summary>
            {detailsLabel}
            <ChevronDown aria-hidden="true" strokeWidth={1.75} />
          </summary>
          <div className="method-details-body">{details}</div>
        </details>
      )}
      {id !== METHOD_SECTIONS.overview && <BackToTop targetId={METHOD_SECTIONS.overview} />}
    </section>
  );
}

/** A link to another view (at one of its sub-tabs), switched to in place. */
function ViewLink({ tab, sub, age, hash, onShowTab, children }) {
  return (
    <a
      href={`?tab=${tab}${sub ? `&sub=${sub}` : ""}${age ? `&age=${age}` : ""}${hash ? `#${hash}` : ""}`}
      onClick={(event) => {
        event.preventDefault();
        // By age's group (?age=) goes with its sub-tab
        if (sub && age) onShowTab(tab, sub, { age });
        else if (sub) onShowTab(tab, sub);
        else onShowTab(tab);
        if (hash) {
          setTimeout(() => {
            document.getElementById(hash)?.scrollIntoView?.({ behavior: "smooth" });
          }, 50);
        }
      }}
    >
      {children}
    </a>
  );
}

/** A shared term, linked to its definition under "Terms used on the charts". */
const Term = ({ id, children }) => <AnchorLink id={glossaryAnchor(id)}>{children}</AnchorLink>;

/** A link to another section of this view. */
function SectionLink({ id, children }) {
  return (
    <a
      href={`#${id}`}
      onClick={(event) => {
        event.preventDefault();
        goToSection(id);
      }}
    >
      {children}
    </a>
  );
}

/**
 * The Methodology view: how the other views' figures are made, gathered in
 * one place, with a contents list beside it. Each note is said here and
 * nowhere else on the page; the policy descriptions stay on Policies, and
 * the household calculation with Household impact's "About these
 * figures". Pre-measures forecast states the engine, data, notes and gaps
 * of that view's projections.
 *
 * @param {Object} props
 * @param {(tab: string, sub?: string) => void} props.onShowTab - Switch to another view (at a sub-tab)
 */
function MethodologyTab({ onShowTab }) {
  const catalogue = useMeasureCatalogue();
  const UNAVAILABLE = unavailableMeasures(catalogue);
  const policyNotes = (text) => (
    <ViewLink tab="policies" onShowTab={onShowTab}>
      {text}
    </ViewLink>
  );

  return (
    <div className="methodology-tab">
      <MethodContents sections={METHOD_CONTENTS} />

      <div className="method-body">
        <MethodSection
          id={METHOD_SECTIONS.overview}
          title="At a glance"
          summary={
            <p>
              We run <SourceLink id="policyengine_uk_model">PolicyEngine UK</SourceLink> on a
              representative survey of UK households, with and without each measure, and weight
              the difference up to the whole country.
            </p>
          }
        >
          <MethodGlossary />
        </MethodSection>

        <MethodSection
          id={METHOD_SECTIONS.data}
          title="Data"
          summary={
            <p>
              The households come from the{" "}
              <SourceLink id="frs_2024_25">Family Resources Survey, 2024-25</SourceLink>, built
              into <SourceLink id="microcosm">Microcosm UK 2024-25</SourceLink>, where each one
              carries a weight: how many UK households it stands for. Their incomes and prices are
              projected forward to each year shown with{" "}
              <SourceLink id="policyengine_uk">policyengine-uk</SourceLink>&apos;s economic
              assumptions.
            </p>
          }
          details={
            <FactList
              items={[
                [
                  "Dataset",
                  <>
                    The national file (<code>microcosm_uk_2024_25</code>), certified and pinned with
                    the model version in the{" "}
                    <SourceLink id="policyengine_py_release">policyengine.py release</SourceLink>, so
                    the two cannot drift apart.
                  </>,
                ],
                [
                  "Survey",
                  "A survey household can appear as several records, each linked to the household it was made from.",
                ],
                ["Weights", "Calibrated; the release pins the calibration with the data."],
                [
                  "Projection",
                  <>
                    Over the forecast period, the <SourceLink id="obr_efo_current" />; after it,
                    the OBR&apos;s long-run assumptions (
                    <SourceLink id="obr_fiscal_risks">Fiscal risks and sustainability</SourceLink>).
                  </>,
                ],
                [
                  "Small groups",
                  <>
                    A figure for a small group rests on few survey households, so the page leaves
                    out or marks such figures: see the{" "}
                    <AnchorLink id={METHOD_ANCHORS.scatter}>household scatter</AnchorLink>,{" "}
                    <SectionLink id={METHOD_SECTIONS.geography}>figures by area</SectionLink> and{" "}
                    <SectionLink id={METHOD_SECTIONS.young}>young people</SectionLink>.
                  </>,
                ],
              ]}
            />
          }
        />

        <MethodSection
          id={METHOD_SECTIONS.model}
          title="Model and measures"
          summary={
            <>
              <p>
                <SourceLink id="policyengine_uk_model">PolicyEngine UK</SourceLink> works out each
                household&apos;s taxes, benefits and <Term id="netIncome">net income</Term> under
                current law, then again with a measure; the difference between the two runs is the
                measure&apos;s effect. The estimates are <Term id="static">static</Term>: households
                do not change their behaviour in response.
              </p>
              <p className="method-pointer">
                What each measure does and how it is modelled is on{" "}
                <ViewLink tab="policies" onShowTab={onShowTab}>
                  Policies
                  <ArrowRight aria-hidden="true" strokeWidth={1.75} />
                </ViewLink>
              </p>
            </>
          }
          details={
            <>
              <FactList
                items={[
                  [
                    "Model",
                    <>
                      PolicyEngine UK (<SourceLink id="policyengine_uk">policyengine-uk</SourceLink>), run
                      through <SourceLink id="policyengine_py_release">policyengine.py</SourceLink> on
                      the <SectionLink id={METHOD_SECTIONS.data}>dataset above</SectionLink>.
                    </>,
                  ],
                  ["Baseline", "The Plan 2 measure's baseline also uses modelled student loan repayments."],
                  [
                    "Static",
                    "Fuel and electricity spending are held fixed, and wages do not respond to employer National Insurance.",
                  ],
                  ["Years", "Fiscal years: 2027 means 2027-28."],
                  [
                    "Prices",
                    <>
                      <ViewLink tab="dashboard" onShowTab={onShowTab}>Population impact</ViewLink> and{" "}
                      <ViewLink tab="household" onShowTab={onShowTab}>Household impact</ViewLink> figures
                      are in <Term id="real">cash terms</Term> for the year shown, not adjusted for
                      inflation.
                    </>,
                  ],
                ]}
              />
              <p className="method-more">
                Measures are written as parameter changes where possible, or built from tested
                measure templates.
              </p>
            </>
          }
        >

          {UNAVAILABLE.length > 0 && (
            <div className="card method-card mm-card">
              <h3 className="method-card-title">Unavailable measures</h3>
              <p className="method-more">
                These measures have no verified results in the current publication.
              </p>
              <ReasonList items={UNAVAILABLE} />
            </div>
          )}

          <div className="card method-card mm-card method-muted-card">
            <h3 className="method-card-title">Not modelled</h3>
            <p className="method-more">Measures the household model cannot cost, and why.</p>
            <ReasonList items={NOT_MODELLED} icon />
          </div>
        </MethodSection>

        <MethodSection
          id={METHOD_SECTIONS.population}
          title="Population impact"
          summary={
            <p>
              The national charts on{" "}
              <ViewLink tab="dashboard" onShowTab={onShowTab}>Population impact</ViewLink> add up
              every household&apos;s change with its weight: the{" "}
              <ViewLink tab="dashboard" sub="finances" onShowTab={onShowTab}>revenue chart</ViewLink> as
              the change in the government&apos;s balance, the{" "}
              <ViewLink tab="dashboard" sub="all" onShowTab={onShowTab}>decile charts</ViewLink> by
              income group, and the household scatter for the spread behind the averages. Counts
              are rounded and no household is ever shown on its own.
            </p>
          }
          details={
            <>
              <h3 id={METHOD_ANCHORS.publicFinances} className="method-details-title method-anchor">Public finances</h3>
              <FactList
                items={[
                  [
                    "Budgetary impact",
                    {
                      value: "Taxes collected less benefits and other spending, in £ billion a year.",
                      more: ["Each measure's figure is net of every tax and spending change it causes."],
                    },
                  ],
                  [
                    "Exceptions",
                    {
                      value: "A measure whose published description says it is costed another way follows that description.",
                      more: ["For example, from a Treasury cost estimate or from the change in loan repayments."],
                    },
                  ],
                  ["Years", `Fiscal years ${yearRange}.`],
                  [
                    "Net impact",
                    <>
                      With several measures selected, the net line adds their separate effects (see{" "}
                      <SectionLink id={METHOD_SECTIONS.limitations}>limitations</SectionLink>).
                    </>,
                  ],
                  [
                    "OBR comparison",
                    {
                      value: "Opens on the OBR's static costing, like ours, where it has one.",
                      more: ["Choose Post-behavioural to include the OBR's estimate of behavioural responses."],
                    },
                  ],
                ]}
              />
              <h3 id={METHOD_ANCHORS.byIncome} className="method-details-title method-anchor">Households by income</h3>
              <FactList
                items={[
                  [
                    "Income deciles",
                    {
                      value: "Ten groups of equal numbers of people, by household income.",
                      more: [
                        <>
                          Ranked by baseline <Term id="equivalised">equivalised</Term> household net
                          income <Term id="housingCosts">before housing costs</Term> (the{" "}
                          <SourceLink id="dwp_hbai">HBAI</SourceLink> measure).
                        </>,
                        "Negative incomes count as zero for the ranking.",
                        "Households without a decile are left out.",
                      ],
                    },
                  ],
                  ["Absolute change", "The average change in household net income per household, in £ a year."],
                  ["Relative change", "The decile's total change as a percentage of its total baseline net income."],
                ]}
              />
              <h3 id={METHOD_ANCHORS.poverty} className="method-details-title method-anchor">Poverty and inequality</h3>
              <FactList
                items={[
                  [
                    "Poverty rate",
                    {
                      value: (
                        <>
                          The share of people in households below the{" "}
                          <Term id="absolutePoverty">absolute poverty</Term> line before housing costs
                          (60% of the 2024-25 <Term id="median">median</Term>, held in real terms), with
                          and without the policies.
                        </>
                      ),
                      more: [
                        <>
                          The poverty line is measured on <SourceLink id="dwp_hbai">HBAI</SourceLink>{" "}
                          income, which is before indirect taxes, so the VAT and fuel duty measures do
                          not change it.
                        </>,
                        "People lifted out or pushed in are the change in the rate times that year's population in the current-law projection, to the nearest 1,000.",
                      ],
                    },
                  ],
                  [
                    "Inequality",
                    <>
                      The relative change in the <Term id="gini">Gini coefficient</Term> of{" "}
                      <Term id="equivalised">equivalised</Term> household net income, people weighted.
                    </>,
                  ],
                  [
                    "Which run",
                    <>
                      Neither adds up across policies, so each is read from one run: a policy&apos;s{" "}
                      <Term id="ownRuns">own</Term>, or the combined run when every policy is selected.
                    </>,
                  ],
                ]}
              />
              <h3 id={METHOD_ANCHORS.scatter} className="method-details-title method-anchor">Household scatter</h3>
              <FactList
                items={[
                  [
                    "Household scatter bands",
                    {
                      value: "Households grouped by income and by change in income.",
                      more: [
                        `Income: 2027-28 baseline net income, in ${pounds(SCATTER_BINS.income_band_width)} bands up to ${pounds(SCATTER_BINS.income_max)}, so a group is the same households in every year.`,
                        <>
                          Change: band edges either way at
                          <span className="method-chips" aria-label={`Band edges: ${SCATTER_CHANGE_EDGES}`}>
                            {SCATTER_CHANGE_EDGE_LIST.map((edge) => (
                              <Tag key={edge}>{edge}</Tag>
                            ))}
                          </span>
                        </>,
                        `Changes of ${pounds(SCATTER_CHANGE_MAX)} or more either way form one open band at each end, outside the chart's −£5,000 to £5,000 axis.`,
                        "About 500 dots, shared out by each income group's households in 2027-28.",
                        "A group's k-th dot sits at its k-th quantile of change, so it keeps its row between years.",
                      ],
                    },
                  ],
                  [
                    "Gain, loss, no change",
                    {
                      value: "No change is under £1 either way; a gain is £1 or more up, a loss £1 or more down.",
                      more: ["Gain bands include their lower edge and loss bands their upper one, so the bands mirror about zero."],
                    },
                  ],
                  [
                    "Disclosure",
                    {
                      value: `Counts are weighted and rounded to the nearest ${SCATTER_BINS.round_to.toLocaleString("en-GB")}.`,
                      more: ["Groups come from one simulation of the selection and are never added up."],
                    },
                  ],
                  [
                    "Sign-off",
                    {
                      value: "A named reviewer signs off every public data file before it is published.",
                      more: ["A file awaiting sign-off is marked pending, and a pending file expires after 14 days at most."],
                    },
                  ],
                ]}
              />
            </>
          }
        />

        <MethodSection
          id={METHOD_SECTIONS.geography}
          title="Figures by area"
          summary={
            <p>
              Regional and constituency figures come from the same survey. Each is published only
              after disclosure checks, with a 90% interval, and the map colours a constituency only
              when its interval is narrow enough to place it.
            </p>
          }
          details={<GeographyMethodology />}
        />

        <MethodSection
          id={METHOD_SECTIONS.young}
          title="Young people"
          summary={
            <p>
              The{" "}
              <ViewLink tab="dashboard" sub="age" age="16-24" hash="young-people" onShowTab={onShowTab}>
                results by age
              </ViewLink>{" "}
              split everyone into the Office for National Statistics&apos; age bands, with 16 to 24
              as young people, and count who is better or worse off in each.
            </p>
          }
          details={
            <FactList
              items={[
                [
                  "Age bands",
                  {
                    value: (
                      <>
                        {AGE_BANDS.filter((band) => band.label !== "All ages")
                          .map((band) => band.label)
                          .join(", ")
                          .replace(/, ([^,]*)$/, " and $1")}
                        : the ONS Labour Force Survey age groups (A05), with 16 to 24 as the ONS
                        definition of young people.
                      </>
                    ),
                    more: [
                      <>
                        <ExternalLink href={AGE_BAND_SOURCE.url}>ONS A05 SA</ExternalLink>{" "}
                        splits 16 to 24 into 16 to 17 and 18 to 24.
                      </>,
                      <>
                        Children are under 16, as in{" "}
                        <SourceLink id="ons_mid_year_estimates">ONS population statistics</SourceLink> and{" "}
                        <SourceLink id="dwp_hbai">HBAI</SourceLink>.
                      </>,
                      "Unlike HBAI, 16- to 19-year-olds in full-time non-advanced education count in 16 to 24, not as children.",
                      "Each chart also shows all ages.",
                    ],
                  },
                ],
                ["Single year of age", `One bar per year of age from ${SINGLE_AGE_FIRST} to ${SINGLE_AGE_LAST}.`],
                [
                  "Change by year",
                  {
                    lead: "The Young people and Pensioners charts by year:",
                    points: [
                      "Each point is a whole fiscal year, the sum of each selected measure's own effect; the curve between points never goes past them.",
                      "A label names the measure behind each of the largest year-on-year steps.",
                      "Breakdown by measure stacks each measure's own change, with the net change as the line; the running total adds each year's change from the first year.",
                      "No share of income is shown: the results by age carry no income to divide by.",
                    ],
                  },
                ],
                [
                  "Who counts",
                  {
                    value: (
                      <>
                        People in households with an{" "}
                        <AnchorLink id={METHOD_ANCHORS.byIncome}>income decile</AnchorLink>.
                      </>
                    ),
                    more: [
                      `A band or age with fewer than ${MIN_SAMPLE_SIZE} survey records is not shown.`,
                      <>
                        Each person counts their whole household&apos;s change in net income, not
                        equivalised, and averages are <Term id="perPerson">per person</Term>.
                      </>,
                    ],
                  },
                ],
                [
                  "Pensioners",
                  <>
                    People at or over <Term id="statePensionAge">State Pension age</Term>: 66 in
                    2026-27 and 67 from 2027-28, as in{" "}
                    <SourceLink id="policyengine_uk">policyengine-uk</SourceLink>. Their results are on{" "}
                    <ViewLink tab="dashboard" sub="age" age="pensioners" onShowTab={onShowTab}>By age, with Pensioners chosen</ViewLink>.
                  </>,
                ],
                [
                  "Better or worse off",
                  {
                    value: "Household net income rises or falls by more than 0.01%; otherwise unchanged.",
                    more: ["The 0.01% is of baseline net income, with a baseline below £1 counted as £1."],
                  },
                ],
              ]}
            />
          }
        />

          <MethodSection
            id={METHOD_SECTIONS.personal}
            title="Household impact"
            summary={
              <div id={METHOD_SECTIONS.singleYear} className="method-anchor">
                <h3 className="method-card-title">Household calculation</h3>
                <p>
                  The same model and measures, applied to one household&apos;s answers. How it works
                  is under{" "}
                  <ViewLink tab="household" hash={HOUSEHOLD_ABOUT_ID} onShowTab={onShowTab}>
                    &ldquo;About these figures&rdquo;
                  </ViewLink>
                  , below the results on the{" "}
                  <ViewLink tab="household" onShowTab={onShowTab}>
                    Household impact tab
                  </ViewLink>
                  .
                </p>
              </div>
            }
            details={
              <>
                <h3 id={METHOD_ANCHORS.incomePosition} className="method-details-title method-anchor">
                  Your place in the UK
                </h3>
                <FactList
                  items={[
                    [
                      "Income",
                      "Household net income after taxes (VAT and fuel duty included) and with benefits, divided by your household's size on the HBAI scale. Public spending in kind, such as the NHS and schools, is left out for everyone.",
                    ],
                    [
                      "Tenths",
                      "The tenths' average changes are the decile charts' own, ranked by HBAI income without VAT and fuel duty, so a household near a boundary may sit in the next tenth there. The average UK household's change has no published % of net income.",
                    ],
                    [
                      "Distribution",
                      `Published from the ${ordinal(LOWEST_PERCENTILE)} to the ${ordinal(HIGHEST_PERCENTILE)} percentile, as averages over bands one percentile wide; the lowest and highest 1% are not drawn.`,
                    ],
                    [
                      "Who moves",
                      "Everyone is ranked before and after the selected policies: a person moves up when the whole percentile (or tenth) of their rank is higher after. A share from fewer than 10 survey households is not published.",
                    ],
                    [
                      "Among all households",
                      "The Population impact scatter: each household sits by its 2027-28 net income before the policies, not adjusted for household size, in every year, and you by yours. Each dot is a group of households.",
                    ],
                  ]}
                />
              </>
            }
          />

          <MethodSection
            id={METHOD_SECTIONS.living}
            title="Pre-measures forecast"
            summary={
              <p>
                Incomes and poverty under current law, with no measures applied, are projected on
                the engine and data below: they are the{" "}
                <ViewLink tab="outlook" sub="living" onShowTab={onShowTab}>
                  Living standards
                </ViewLink>{" "}
                and{" "}
                <ViewLink tab="outlook" sub="poverty" onShowTab={onShowTab}>
                  Poverty
                </ViewLink>{" "}
                tabs of the Pre-measures forecast, whose{" "}
                <ViewLink tab="outlook" sub="forecast" onShowTab={onShowTab}>
                  Forecast changes
                </ViewLink>{" "}
                tab shows the forecast they are built on.{" "}
                <ViewLink tab="dashboard" onShowTab={onShowTab}>Population impact</ViewLink>&apos;s{" "}
                <ViewLink tab="dashboard" sub="living" onShowTab={onShowTab}>Living standards</ViewLink>{" "}
                and <ViewLink tab="dashboard" sub="poverty" onShowTab={onShowTab}>Poverty</ViewLink>{" "}
                tabs show the selected measures&apos; effect.
              </p>
            }
            details={<LivingStandardsMethod />}
            detailsLabel="Engine, data and gaps"
          >
            {/* Linked from the Forecast changes sub-tab, so not folded away */}
            <ForecastFeedMethod />
          </MethodSection>

        <MethodSection
            id={METHOD_SECTIONS.limitations}
            title="Limitations"
            summary={
              <p>
                Most charts add up measures run separately, the economic assumptions follow one OBR
                forecast, and surveys under-record some incomes. Each is explained below.
              </p>
            }
            details={
              <div className="method-callouts">
                <Callout icon={Info} title="Measures added up">
                  Each measure is also simulated on its own. Where several are selected, the
                  revenue, decile and age charts add up their separate effects, so they leave out
                  interactions between measures (<Term id="ownRuns">measures run on their own</Term>);
                  the <AnchorLink id={METHOD_ANCHORS.scatter}>household scatter</AnchorLink> and the
                  shares better and worse off come from a run of the whole selection, so they include them, and show
                  nothing for a selection with no such run.
                </Callout>
                <Callout icon={Info} title="Economic assumptions">
                  The economic assumptions and the weights follow the{" "}
                  <SourceLink id="obr_efo_current" />. Rebasing them on a new forecast is a separate
                  step.
                </Callout>
                <Callout icon={Info} title="Survey coverage">
                  The {policyNotes("policy notes")} say where this affects a measure.
                </Callout>
              </div>
            }
          />
      </div>
    </div>
  );
}

export default MethodologyTab;
