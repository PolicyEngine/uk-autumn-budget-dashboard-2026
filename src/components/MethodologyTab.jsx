import { useEffect } from "react";
import GeographyMethodology from "./GeographyMethodology";
import LivingStandardsMethod from "./methodology/LivingStandardsMethod";
import ForecastFeedMethod, { FORECAST_FEED_ANCHOR } from "./methodology/ForecastFeedMethod";
import FactList from "./methodology/FactList";
import MethodGlossary from "./methodology/MethodGlossary";
import SectionHeading from "./SectionHeading";
import { HIGHEST_PERCENTILE, LOWEST_PERCENTILE, ordinal } from "../utils/incomePosition";
import { METHOD_ANCHORS } from "./methodology/anchors";
import { SINGLE_YEAR_METHOD } from "../utils/singleYear";
import MethodContents, { revealAnchor } from "./methodology/MethodContents";
import { unavailableMeasures } from "./methodology/measures";
import { SCATTER_BINS } from "../utils/publication/scatter";
import { AGE_BANDS, AGE_BAND_SOURCE, MIN_SAMPLE_SIZE } from "../utils/ageImpact";
import { EARLY_YEAR, LAST_DISPLAY_YEAR } from "../utils/displayYears";
import { fiscalYearTick } from "../utils/chartTheme";
import { useMeasureCatalogue } from "../utils/measureCatalogue";
import { OPEN_VIEW_EVENT } from "../utils/methodLink";
import { AnchorLink, ExternalLink, ReasonList, SourceLink, Tag, Topic } from "./methodology/MethodUi";
import { glossaryAnchor } from "./methodology/glossary";
import { Calculator, ChartColumn, Compass, Database, House, TrendingUp, TriangleAlert } from "lucide-react";
import "./methodology/Methodology.css";
import { scrollBelowBars, smoothUnlessReduced } from "../utils/pageScroll";

/**
 * The ids of the Methodology view's sections and of the topics other
 * views link to (the map to `geography`, the age cards to `young`), so a
 * key's id must not change.
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

/**
 * The sections in the contents, in page order: `icon` for the contents
 * list, `titleIcon` (TitleIcon) for the section's heading. Figures by area
 * and results by age are topics of Population impact.
 */
export const METHOD_CONTENTS = [
  { id: METHOD_SECTIONS.overview, title: "At a glance", icon: Compass, titleIcon: "compass" },
  { id: METHOD_SECTIONS.data, title: "Data", icon: Database, titleIcon: "database" },
  { id: METHOD_SECTIONS.model, title: "Model and policies", icon: Calculator, titleIcon: "calculator" },
  { id: METHOD_SECTIONS.population, title: "Population impact", icon: ChartColumn, titleIcon: "bars" },
  { id: METHOD_SECTIONS.personal, title: "Household calculator", icon: House, titleIcon: "house" },
  { id: METHOD_SECTIONS.living, title: "Pre-measures forecast", icon: TrendingUp, titleIcon: "trend" },
  { id: METHOD_SECTIONS.limitations, title: "Limitations", icon: TriangleAlert, titleIcon: "alert" },
];

const SECTION_ICONS = Object.fromEntries(METHOD_CONTENTS.map(({ id, titleIcon }) => [id, titleIcon]));

// The Limitations topic on the forecast, linked from the Data and Model
// sections
const ECONOMIC_ASSUMPTIONS = "method-economic-assumptions";

const pounds = (value) => `£${Math.round(value).toLocaleString("en-GB")}`;
const SCATTER_CHANGE_MAX = SCATTER_BINS.change_edges[SCATTER_BINS.change_edges.length - 1];
const SCATTER_CHANGE_EDGE_LIST = SCATTER_BINS.change_edges.filter((edge) => edge > 0).map(pounds);
const yearRange = `${fiscalYearTick(EARLY_YEAR)} to ${fiscalYearTick(LAST_DISPLAY_YEAR)}`;

/**
 * A section of the view, laid out as the other views' sections are: a
 * heading with its icon and a one-line summary, then its topics, each
 * folded until asked for.
 */
function MethodSection({ id, title, summary, children }) {
  return (
    <section id={id} className="method-section" aria-label={title}>
      <SectionHeading id={`${id}-heading`} icon={SECTION_ICONS[id]} title={title} subtitle={summary} />
      {children && <div className="card method-card method-topics">{children}</div>}
    </section>
  );
}

/** A link to another view (at one of its sub-tabs), switched to in place. */
function ViewLink({ tab, sub, age, hash, onShowTab, className, children }) {
  return (
    <a
      className={className}
      href={`?tab=${tab}${sub ? `&sub=${sub}` : ""}${age ? `&age=${age}` : ""}${hash ? `#${hash}` : ""}`}
      onClick={(event) => {
        event.preventDefault();
        // By age's group (?age=) goes with its sub-tab
        if (sub && age) onShowTab(tab, sub, { age });
        else if (sub) onShowTab(tab, sub);
        else onShowTab(tab);
        if (hash) {
          setTimeout(() => {
            scrollBelowBars(document.getElementById(hash), { behavior: smoothUnlessReduced() });
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

/**
 * Opened at an anchor (a link from another view, an address with a hash,
 * or a changed hash): open the topic it is folded in and bring it into view. The target
 * may load after the view (the forecast's notes), so look for up to 3
 * seconds.
 */
function useRevealLinkedAnchor() {
  useEffect(() => {
    let timer = 0;
    const reveal = (id) => {
      clearTimeout(timer);
      let tries = 0;
      const attempt = () => {
        if (revealAnchor(id, { smooth: false })) return;
        if ((tries += 1) < 30) timer = setTimeout(attempt, 100);
      };
      timer = setTimeout(attempt, 150);
    };
    const hash = window.location.hash.slice(1);
    if (hash) reveal(decodeURIComponent(hash));
    const onOpenView = (event) => {
      const { tab, anchor } = event.detail || {};
      if (tab === "methodology" && anchor) reveal(anchor);
    };
    const onHashChange = () => {
      const id = window.location.hash.slice(1);
      if (id) reveal(decodeURIComponent(id));
    };
    window.addEventListener(OPEN_VIEW_EVENT, onOpenView);
    window.addEventListener("hashchange", onHashChange);
    return () => {
      clearTimeout(timer);
      window.removeEventListener(OPEN_VIEW_EVENT, onOpenView);
      window.removeEventListener("hashchange", onHashChange);
    };
  }, []);
}

/**
 * The Methodology view: how the other views' figures are made, gathered in
 * one place, with a contents list beside it. Each section says in one line
 * what it covers; everything else is in its folded topics, and each note
 * is said once. The policy descriptions stay on Policies.
 *
 * @param {Object} props
 * @param {(tab: string, sub?: string) => void} props.onShowTab - Switch to another view (at a sub-tab)
 */
function MethodologyTab({ onShowTab }) {
  const catalogue = useMeasureCatalogue();
  const UNAVAILABLE = unavailableMeasures(catalogue);
  useRevealLinkedAnchor();

  return (
    <div className="methodology-tab">
      <MethodContents sections={METHOD_CONTENTS} />

      <div className="method-body">
        <MethodSection
          id={METHOD_SECTIONS.overview}
          title="At a glance"
          summary={
            <>
              We run <SourceLink id="policyengine_uk_model">PolicyEngine UK</SourceLink>{" "}on a
              survey of UK households with and without each policy, {yearRange}; weights scale the survey to the UK.
            </>
          }
        >
          <Topic
            id={METHOD_ANCHORS.glossary}
            title="Terms the charts use"
            preview="Net income, housing costs, deciles, poverty, Gini and other terms, one line each"
          >
            <MethodGlossary />
          </Topic>
        </MethodSection>

        <MethodSection
          id={METHOD_SECTIONS.data}
          title="Data"
          summary={
            <>
              Households from the <SourceLink id="frs_2024_25">Family Resources Survey 2024-25</SourceLink>,
              which feed <SourceLink id="microcosm">Microcosm UK 2024-25</SourceLink>.
            </>
          }
        >
          <Topic title="The dataset" preview="Dataset · Pipeline · Survey · Weights · Projection · Small groups">
            <FactList
              items={[
                [
                  "Dataset",
                  <>
                    The national file (<code>microcosm_uk_2024_25</code>): the policyengine.py release
                    this build uses (in About this dashboard&apos;s Built with) certifies it and pins
                    it with the model version, so the two cannot drift apart.
                  </>,
                ],
                [
                  "Pipeline",
                  {
                    value: (
                      <>
                        <SourceLink id="microcosm_site">Microcosm</SourceLink>{" "}builds the dataset: a sequence of
                        stages adds to each Family Resources Survey household what the survey does not
                        record; calibration then sets each record&apos;s weight.
                      </>
                    ),
                    more: [
                      "The stages draw on other surveys and on administrative statistics for high incomes, wealth, spending, travel, benefit take-up, capital gains, pension salary sacrifice and student loans.",
                      "The same stages feed two files: the national file, which the release certifies with the model, and a local-area file for constituencies and local authorities, which that certificate does not cover.",
                      "Both files come from survey microdata that the UK Data Service supplies under licence, so they are not public downloads.",
                    ],
                  },
                ],
                [
                  "Survey",
                  "A survey household can appear as several records, each of which links to the household it came from.",
                ],
                [
                  "Weights",
                  {
                    value: (
                      <>
                        Calibration fits them to published totals for the UK, its nations and the English regions (
                        <SourceLink id="uk_calibration_targets">calibration targets</SourceLink>); the release
                        pins the calibration with the data.
                      </>
                    ),
                    more: [
                      "The totals include HMRC income and tax statistics, DWP benefit caseloads, forecasts the OBR published before the October 2026 one, and ONS population estimates.",
                      "The local-area file's calibration targets constituency and local-authority totals as well.",
                    ],
                  },
                ],
                [
                  "Projection",
                  <>
                    We project incomes and prices to each year we show, with the growth rates of
                    the <SourceLink id="obr_efo_current" />, which we apply over{" "}
                    <SourceLink id="policyengine_uk">policyengine-uk</SourceLink>&apos;s own
                    assumptions (the OBR&apos;s March 2026 forecast); after the forecast period,
                    the OBR&apos;s long-run assumptions (
                    <SourceLink id="obr_fiscal_risks">Fiscal risks and sustainability</SourceLink>).
                    Some series keep the March path (
                    <AnchorLink id={ECONOMIC_ASSUMPTIONS}>economic assumptions</AnchorLink>).
                  </>,
                ],
                [
                  "Small groups",
                  <>
                    A figure for a small group rests on few survey households, so the page leaves
                    out or marks such figures: see the{" "}
                    <AnchorLink id={METHOD_ANCHORS.byIncome}>income deciles</AnchorLink>,{" "}
                    <AnchorLink id={METHOD_ANCHORS.scatter}>household scatter</AnchorLink>,{" "}
                    <AnchorLink id={METHOD_SECTIONS.geography}>figures by area</AnchorLink> and{" "}
                    <AnchorLink id={METHOD_SECTIONS.young}>results by age</AnchorLink>.
                  </>,
                ],
              ]}
            />
            <p className="method-more">
              <SourceLink id="uk_data_pipeline">Read how the pipeline builds Microcosm UK today, stage by stage</SourceLink>.
              The page describes the current pipeline, which may be newer than this dashboard&apos;s data.
            </p>
          </Topic>
          {/* Sign-off covers every public file, so it sits here rather than
              under the household scatter (scripts/check_public_data.py) */}
          <Topic title="Published files" preview="Sign-off">
            <FactList
              items={[
                [
                  "Sign-off",
                  {
                    value:
                      "We list each public data file with a named reviewer and a digest of the exact bytes they reviewed. A changed file fails the publication checks until a reviewer reviews it again.",
                    more: [
                      "We can publish a file awaiting sign-off as pending, for at most 14 days after its entry; after that it fails the checks until a reviewer signs it off.",
                    ],
                  },
                ],
              ]}
            />
          </Topic>
        </MethodSection>

        <MethodSection
          id={METHOD_SECTIONS.model}
          title="Model and policies"
          summary={
            <>
              The model works out each household&apos;s taxes, benefits and{" "}
              <Term id="netIncome">net income</Term>; what each policy does and how we model it is on{" "}
              <ViewLink tab="policies" onShowTab={onShowTab}>
                Policies
              </ViewLink>
              .
            </>
          }
        >
          <Topic title="The model" preview="Model · Baseline · Static · Years · Prices">
            <FactList
              items={[
                [
                  "Model",
                  <>
                    PolicyEngine UK (<SourceLink id="policyengine_uk">policyengine-uk</SourceLink>), which we run
                    through <SourceLink id="policyengine_py_release">policyengine.py</SourceLink>{" "}on
                    the <AnchorLink id={METHOD_SECTIONS.data}>data above</AnchorLink>. We write measures
                    as parameter changes where possible, or build them from tested measure
                    templates. We write three of the policies here by hand, and publish them
                    only after two reviewers have checked the exact run.
                  </>,
                ],
                [
                  "Baseline",
                  {
                    value: "Current law.",
                    more: [
                      "It has no zero rate of VAT on domestic electricity, so the zero rate in force from 1 October 2026 to 31 March 2027 counts as part of the Budget's zero rate, as Table 6.1 counts it.",
                      <>
                        Fuel duty is 60.59p a litre from April 2027 (
                        <AnchorLink id={ECONOMIC_ASSUMPTIONS}>economic assumptions</AnchorLink>).
                      </>,
                      "The model holds the National Living Wage at £12.71 an hour from April 2026. It sets Universal Credit's minimum income floor, the benefit cap's earnings exemption and the childcare earnings tests.",
                      "It holds Carer's Allowance's own earnings limit at £204 a week, so a carer earning between £204 and the higher limit the Budget's Carer's Allowance change sets gets no Carer's Allowance in either run.",
                      <>
                        Benefit rates, including the Pension Credit guarantee, rise as we describe
                        under <AnchorLink id={FORECAST_FEED_ANCHOR}>how the forecast feeds the baseline</AnchorLink>.
                      </>,
                    ],
                  },
                ],
                [
                  "Static",
                  <>
                    Estimates are <Term id="static">static</Term>; each policy's card says what its
                    estimate holds fixed.
                  </>,
                ],
                ["Years", "Fiscal years, April to March: 2027-28 runs from April 2027 to March 2028."],
                [
                  "Prices",
                  <>
                    <ViewLink tab="dashboard" onShowTab={onShowTab}>Population impact</ViewLink> and{" "}
                    <ViewLink tab="household" onShowTab={onShowTab}>Household calculator</ViewLink>{" "}figures
                    are in <Term id="real">cash terms</Term>{" "}for the year on screen, with no adjustment for
                    inflation.
                  </>,
                ],
              ]}
            />
          </Topic>
          {UNAVAILABLE.length > 0 && (
            <Topic title="Unavailable policies" preview="Policies with no verified results in the current publication">
              <ReasonList items={UNAVAILABLE} />
            </Topic>
          )}
          <Topic title="Not modelled" preview="Why some Budget policies have no figures here">
            <p className="method-more">
              Some Budget policies act on something the model or its survey data do not hold, such as
              prices, ISAs or business mileage, or have rules not yet published, so they cannot be
              costed household by household. The rise in income tax rates on savings income is
              modelled but held back from this release, because the data miss ISA interest and some
              other savings income.{" "}
              <ViewLink tab="policies" hash="budget-measures-not-modelled" onShowTab={onShowTab}>
                Budget policies we do not model
              </ViewLink>
              , on Policies, lists each with its reason.
            </p>
          </Topic>
        </MethodSection>

        <MethodSection
          id={METHOD_SECTIONS.population}
          title="Population impact"
          summary={
            <>
              <ViewLink tab="dashboard" onShowTab={onShowTab}>Population impact</ViewLink>{" "}adds up
              weighted household changes by income, age and area, never one household alone.
            </>
          }
        >
          <Topic
            id={METHOD_ANCHORS.publicFinances}
            title="Public finances"
            preview="Budgetary impact · Net change · Official costings"
          >
            <p className="method-more">
              The{" "}
              <ViewLink tab="dashboard" sub="finances" onShowTab={onShowTab}>revenue chart</ViewLink>{" "}
              shows the change in the government&apos;s balance.
            </p>
            <FactList
              items={[
                [
                  "Budgetary impact",
                  {
                    value: "Taxes the government collects less benefits and other spending, in £ billion a year.",
                    more: ["It counts indirect taxes, such as VAT and fuel duty, as well as taxes on income."],
                  },
                ],
                [
                  "Net change",
                  <>
                    With several policies selected, the net line is their run together when we publish one
                    for that selection, and otherwise adds their separate effects (see{" "}
                    <AnchorLink id={METHOD_SECTIONS.limitations}>limitations</AnchorLink>).
                  </>,
                ],
                [
                  "Official costings",
                  {
                    value: (
                      <>
                        Budget 2026 publishes one costing per measure, after behavioural responses
                        (Table 6.1 of the{" "}
                        <SourceLink id="budget_documents">Budget document</SourceLink>; the{" "}
                        <SourceLink id="obr_budget_2026_costings">policy costings document</SourceLink>{" "}
                        prints the same figures measure by measure). Ours is static, so where the
                        costing includes behaviour the comparison allows a wider margin.
                      </>
                    ),
                    more: [
                      "Before we publish a policy, each year's figure must be within the larger of 25% of the official one and £50m where the costing includes behaviour, and within the larger of 10% and £50m where it assumes no behavioural response or the policy is a payment rather than a tax. A reviewer can accept a larger gap only with a written reason.",
                      "Ours count each tax year's liability. The official figures are on a National Accounts basis, so a change in the tax people pay through Self Assessment appears about a year later in theirs.",
                      "A reviewer can mark a year not comparable, such as a year after a policy ends or an early year of a Self Assessment change; the card then says so, with the reason, and shows no difference.",
                      <>
                        Our fuel duty figures cover households&apos; own fuel only (
                        <AnchorLink id="method-business-fuel">business fuel use</AnchorLink>), a narrower
                        base than the official costing&apos;s. They also include the VAT on the duty,
                        which the official figure, for fuel duty receipts, leaves out.
                      </>,
                    ],
                  },
                ],
              ]}
            />
          </Topic>
          <Topic
            id={METHOD_ANCHORS.byIncome}
            title="Households by income"
            preview="Income deciles · Absolute change · Relative change"
          >
            <p className="method-more">
              The{" "}
              <ViewLink tab="dashboard" sub="all" onShowTab={onShowTab}>decile charts</ViewLink>{" "}
              split the change by income group.
            </p>
            <FactList
              items={[
                [
                  "Income deciles",
                  {
                    value: "Ten groups of equal numbers of people, by household income.",
                    more: [
                      <>
                        The ranking uses baseline <Term id="equivalised">equivalised</Term>{" "}household net
                        income <Term id="housingCosts">before housing costs</Term> (the{" "}
                        <SourceLink id="dwp_hbai">HBAI</SourceLink> measure).
                      </>,
                      "Negative incomes count as zero for the ranking.",
                      "The decile charts leave out households without a decile.",
                      "When a decile's change comes from only one or two survey households, we do not publish its figures, nor that year's winners and losers figure for all households; a package also leaves out the cells its members withhold. That is the minimum the UK Data Service requires for survey data it supplies under its End User Licence. We show the rest of the measure.",
                    ],
                  },
                ],
                ["Absolute change", "The average change in household net income per household, in £ a year."],
                [
                  "Relative change",
                  <>
                    The decile&apos;s total change as a percentage of its total baseline net income
                    (the income under{" "}
                    <AnchorLink id={METHOD_ANCHORS.poverty}>Inequality</AnchorLink>).
                  </>,
                ],
              ]}
            />
          </Topic>
          <Topic
            id={METHOD_ANCHORS.poverty}
            title="Poverty and inequality"
            preview="Poverty rate · Inequality · Which run"
          >
            <FactList
              items={[
                [
                  "Poverty rate",
                  {
                    value: (
                      <>
                        The share of people in households in{" "}
                        <Term id="absolutePoverty">absolute poverty</Term>{" "}before housing costs, with
                        and without the policies.
                      </>
                    ),
                    more: [
                      <>
                        The poverty rate uses <SourceLink id="dwp_hbai">HBAI</SourceLink>{" "}
                        income, which is before indirect taxes, so the VAT and fuel duty policies do
                        not change it.
                      </>,
                      "The poverty figures leave out the £100 energy payment to households, as policyengine-uk treats the 2022 council tax rebate.",
                      "People moved out of or into poverty are the change in the rate times that year's population in the current-law projection, to the nearest 1,000.",
                    ],
                  },
                ],
                [
                  "Inequality",
                  <>
                    The relative change in the <Term id="gini">Gini coefficient</Term> of{" "}
                    <Term id="equivalised">equivalised</Term> household net income, counting each person.{" "}
                    This income includes public services in kind, such as the NHS and schools, and is
                    after fuel duty and other duties, counting any change in VAT, so the VAT and fuel
                    duty policies change it.
                  </>,
                ],
                [
                  "Which run",
                  <>
                    Neither adds up across policies, so each comes from one run: a policy&apos;s{" "}
                    <Term id="ownRuns">own</Term>, or the combined run when the selection includes every policy.
                  </>,
                ],
              ]}
            />
          </Topic>
          {/* Pavel's review MT1 to MT4: where this dashboard's definitions
              differ from the PolicyEngine app's */}
          <Topic
            id="definitions-compared"
            title="Our definitions and the PolicyEngine app's"
            preview="Inequality · Income deciles · Winners and losers · Poverty · Budget"
          >
            <FactList
              items={[
                [
                  "Inequality",
                  "The app uses HBAI income and counts each household once. Here inequality counts each person and uses the income that Poverty and inequality describes.",
                ],
                [
                  "Income deciles",
                  "The app ranks households by household net income, without adjusting for household size, so its deciles differ.",
                ],
                [
                  "Winners and losers",
                  {
                    value: "Each chart has its own no-change threshold. None uses the app's 0.1% and 5% bands.",
                    more: [
                      <>
                        By age: as under <AnchorLink id={METHOD_SECTIONS.young}>Results by age</AnchorLink>.
                      </>,
                      "Figures by area: under 50p (or 0.005% of income) either way is no change. The map's Little change is under £10 (or 0.1%) either way.",
                      "Household scatter: under £1 either way is no change.",
                    ],
                  },
                ],
                [
                  "Poverty",
                  "The headline poverty measure here is absolute, before housing costs; the app's is relative, before housing costs. A child is a dependent child as HBAI defines one; the PolicyEngine app counts everyone aged 0 to 17.",
                ],
                [
                  "Budget",
                  "Here we cost a policy by its change in the government's balance, as Public finances sets out. The app costs it as the change in households' taxes less benefits.",
                ],
              ]}
            />
          </Topic>
          <Topic
            id={METHOD_ANCHORS.scatter}
            title="Household scatter"
            preview="Bands · Gain, loss, no change · Disclosure"
          >
            <p className="method-more">The spread of changes behind the averages, as groups of households.</p>
            <FactList
              items={[
                [
                  "Household scatter bands",
                  {
                    value: "Groups of households by income and by change in income.",
                    more: [
                      `Income: 2027-28 baseline net income, in ${pounds(SCATTER_BINS.income_band_width)} bands up to ${pounds(SCATTER_BINS.income_max)}, so a group is the same households in every year.`,
                      <>
                        Change: band edges either way at
                        <span className="method-chips">
                          {SCATTER_CHANGE_EDGE_LIST.map((edge) => (
                            <Tag key={edge}>{edge}</Tag>
                          ))}
                        </span>
                      </>,
                      `Changes of ${pounds(SCATTER_CHANGE_MAX)} or more either way form one open band at each end, outside the chart's −£5,000 to £5,000 axis.`,
                      "About 500 dots; each income group's share follows its number of households in 2027-28.",
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
                    value: `We weight the counts and round them to the nearest ${SCATTER_BINS.round_to.toLocaleString("en-GB")}.`,
                    more: ["Groups come from one simulation of the selection; the scatter never adds them up."],
                  },
                ],
              ]}
            />
          </Topic>
          <Topic
            id={METHOD_SECTIONS.geography}
            title="Figures by area"
            preview="Disclosure checks · 90% intervals · Map colours · Local calibration"
          >
            <p className="method-more">
              Constituency figures come from the same survey as the national ones. We publish each
              only after disclosure checks, with a 90% interval, and the map colours a
              constituency only when its interval is narrow enough to place it.
            </p>
            <GeographyMethodology />
          </Topic>
          <Topic
            id={METHOD_SECTIONS.young}
            title="Results by age"
            preview="Age bands · Change by year · Who counts · Pensioners"
          >
            <p className="method-more">
              The{" "}
              <ViewLink tab="dashboard" sub="age" age="16-24" hash="young-people" onShowTab={onShowTab}>
                results by age
              </ViewLink>{" "}
              count winners and losers in each age band and single year of age.
            </p>
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
                ["Single year of age", "One bar per year of age across the chosen age group; 90 and over is one bar."],
                [
                  "Change by year",
                  {
                    lead: "The Change by year chart on By age:",
                    points: [
                      "Each point is a whole fiscal year: the run of all the selected policies together when we publish one, otherwise the sum of each policy's own effect; the curve between points never goes past them.",
                      "A label names the policy behind each of the largest year-on-year steps.",
                      "Breakdown by policy stacks each policy's own change, with the net change as the line; the running total adds each year's change from the first year.",
                      "The chart shows no share of income: the results by age carry no income to divide by.",
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
                      `A band or age with fewer than ${MIN_SAMPLE_SIZE} records in the dataset is not shown. Microcosm builds several records from one survey household, so this counts records, not households.`,
                      "When an age band or single year of age rests on one or two survey households, it is not published: a single year takes the other single years of its band with it, and a band takes every row but all ages.",
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
                    People at or over <Term id="statePensionAge">State Pension age</Term>, on{" "}
                    <ViewLink tab="dashboard" sub="age" age="pensioners" onShowTab={onShowTab}>By age, with Pensioners chosen</ViewLink>.
                  </>,
                ],
                [
                  "Winners and losers",
                  {
                    value: "Household net income rises or falls by more than 0.01%; otherwise no change.",
                    more: ["The 0.01% is of baseline net income, and a baseline below £1 counts as £1."],
                  },
                ],
              ]}
            />
          </Topic>
        </MethodSection>

        <MethodSection
          id={METHOD_SECTIONS.personal}
          title="Household calculator"
          summary={
            <span id={METHOD_SECTIONS.singleYear} className="method-anchor">
              We apply the same model and policies to one household&apos;s answers on the{" "}
              <ViewLink tab="household" onShowTab={onShowTab}>
                Household calculator tab
              </ViewLink>
              .
            </span>
          }
        >
          <Topic
            id={METHOD_ANCHORS.householdCalc}
            title="How the household calculation works"
            preview={SINGLE_YEAR_METHOD.map(([term]) => term).join(" · ")}
          >
            <FactList items={SINGLE_YEAR_METHOD.map(([term, text]) => [term, text])} />
          </Topic>
          <Topic
            id={METHOD_ANCHORS.incomePosition}
            title="Where your income sits"
            preview="Income · Tenths · Distribution · Who moves · Among all households"
          >
            <FactList
              items={[
                [
                  "Income",
                  <>
                    Household net income after taxes (including fuel duty and any change in VAT) and
                    with benefits, divided by your household&apos;s size on the HBAI scale. Unlike the
                    income under <AnchorLink id={METHOD_ANCHORS.poverty}>Inequality</AnchorLink>, it
                    leaves out public services in kind.
                  </>,
                ],
                [
                  "Tenths",
                  "The tenths' average changes are the decile charts' own, and those charts rank people by HBAI income without VAT and fuel duty, so a household near a boundary may sit in the next tenth there. The average UK household's change has no published % of net income.",
                ],
                [
                  "Distribution",
                  `We publish it from the ${ordinal(LOWEST_PERCENTILE)} to the ${ordinal(HIGHEST_PERCENTILE)} percentile, as averages over bands one percentile wide; the chart leaves out the lowest and highest 1%.`,
                ],
                [
                  "Who moves",
                  "We rank everyone before and after the selected policies: a person moves up when the whole percentile (or tenth) of their rank is higher after. We do not publish a share from fewer than 10 survey households.",
                ],
                [
                  "Among all households",
                  "The Population impact scatter: each household sits by its 2027-28 net income before the policies, with no adjustment for household size, in every year, and you by yours. Each dot is a group of households.",
                ],
              ]}
            />
          </Topic>
        </MethodSection>

        <MethodSection
          id={METHOD_SECTIONS.living}
          title="Pre-measures forecast"
          summary={
            <>
              Current-law incomes and poverty on{" "}
              <ViewLink tab="outlook" sub="living" onShowTab={onShowTab}>
                Living standards
              </ViewLink>{" "}
              and{" "}
              <ViewLink tab="outlook" sub="poverty" onShowTab={onShowTab}>
                Poverty
              </ViewLink>
              , from the forecast on{" "}
              <ViewLink tab="outlook" sub="forecast" onShowTab={onShowTab}>
                Forecast changes
              </ViewLink>
              , where the March 2026 forecast stays beside it for comparison.
            </>
          }
        >
          {/* The Forecast changes sub-tab links here */}
          <Topic
            id={FORECAST_FEED_ANCHOR}
            title="How the forecast feeds the baseline"
            preview="Growth rates · Years past the forecast · Parameters"
          >
            <ForecastFeedMethod />
          </Topic>
          <LivingStandardsMethod />
        </MethodSection>

        <MethodSection
          id={METHOD_SECTIONS.limitations}
          title="Limitations"
          summary="Some charts add up separate policy runs, some inputs and the weights do not follow the October 2026 forecast, fuel duty covers households' own fuel only, and surveys under-record some incomes."
        >
          <Topic title="Policies added up" preview="Revenue, decile and age charts · Household scatter · Winners and losers">
            <p className="method-more">
              We simulate each policy on its own, and the full package of policies together in one
              run. Where several are selected, the decile charts add up the policies&apos; separate
              effects, so they leave out interactions between policies (
              <Term id="ownRuns">policies we run on their own</Term>). The revenue chart&apos;s net line
              is the run of the selected policies together when we publish one, and otherwise adds
              up the separate effects. The average-change age charts read the package&apos;s run when
              the selection is the full package, and otherwise add up the separate effects. The{" "}
              <AnchorLink id={METHOD_ANCHORS.scatter}>household scatter</AnchorLink>, the winners
              and losers charts, the headline poverty and inequality figures and the{" "}
              <AnchorLink id={METHOD_SECTIONS.geography}>figures by area</AnchorLink>{" "}come from a
              run of the whole selection, so they include interactions, and show nothing for a
              selection with no such run.
            </p>
          </Topic>
          <Topic
            id={ECONOMIC_ASSUMPTIONS}
            title="Economic assumptions"
            preview="The October 2026 forecast · What keeps the March path · Weights · Fuel duty"
          >
            <p className="method-more">
              The Budget figures grow prices, earnings, rents, mortgage interest, other incomes and
              council tax at the rates of the <SourceLink id="obr_efo_current" />, in the baseline
              and the reform alike; we apply them over policyengine-uk&apos;s March 2026 rates, with these exceptions:
            </p>
            <ul className="method-list">
              <li>The fuel volumes behind fuel duty, and the population, keep the March 2026 path.</li>
              <li>
                2025 keeps policyengine-uk&apos;s figures, not the October forecast&apos;s revisions:
                average earnings growth stays at 5.3%, against October&apos;s 4.1%.
              </li>
              <li>Mortgage interest keeps policyengine-uk&apos;s growth from 2030, where the OBR&apos;s table stops.</li>
              <li>
                CPI after housing costs and social rents are PolicyEngine&apos;s own derivations from
                the October figures, not OBR series.
              </li>
              <li>The weights keep the certified dataset&apos;s calibration to earlier OBR forecasts.</li>
            </ul>
            <p className="method-more">
              Current law&apos;s fuel duty is 60.59p a litre from April 2027, then rises each April
              with that forecast&apos;s RPI. The OBR gives 60.59p from 1 July 2027; HMRC has set no
              April rate, so applying it from April is our assumption.
            </p>
          </Topic>
          <Topic id="method-business-fuel" title="Business fuel use" preview="Fuel duty on households' own purchases only">
            <p className="method-more">
              We model fuel duty on households' own petrol and diesel purchases. Duty on fuel
              for vans, lorries and business use of cars, roughly half of fuel duty receipts, is
              not in the model, so a change in fuel duty moves revenue by less here than in a
              full costing.
            </p>
          </Topic>
          <Topic title="Survey coverage" preview="Where the survey data move a policy's figures">
            <p className="method-more">
              Surveys under-record some incomes and hold few households in some groups. Known effects
              on the policies here:
            </p>
            <ul className="method-list">
              <li>
                More pensioners gain from the tax reduction for pensioners in our data than in the
                Treasury&apos;s costing: about 670,000 in 2027-28, against 500,000.
              </li>
              <li>The data hold few small traders, the people the trading allowance reaches.</li>
              <li>Electricity spending grows with CPI, not the energy price cap; the electricity VAT zero rate scales with it.</li>
            </ul>
            <p className="method-more">
              The{" "}
              <ViewLink tab="policies" onShowTab={onShowTab}>
                policy notes
              </ViewLink>{" "}
              give each policy&apos;s other modelling limits.
            </p>
          </Topic>
        </MethodSection>
      </div>
    </div>
  );
}

export default MethodologyTab;
