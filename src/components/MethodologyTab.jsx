import GeographyMethodology from "./GeographyMethodology";
import LifecycleAbout from "./LifecycleAbout";
import SectionHeading from "./SectionHeading";

const RESEARCH = [
  ["https://policyengine.org/uk/research/uk-two-child-limit", "two-child limit"],
  ["https://policyengine.org/uk/research/fuel-duty-freeze-2025", "fuel duty freeze"],
  ["https://policyengine.org/uk/research/rail-fares-freeze-2025", "rail fares freeze"],
  ["https://policyengine.org/uk/research/uk-salary-sacrifice-cap", "salary sacrifice cap"],
];

/** The ids of the Methodology view's sections, for links to them. */
export const METHOD_SECTIONS = {
  geography: "figures-by-area",
  lifetime: "lifetime-model",
  sources: "sources-and-versions",
};

/**
 * The Methodology view: how the other views' figures are made, gathered in
 * one place. Each note is said here and nowhere else on the page; the
 * policy descriptions stay with Population impact, and the Living
 * standards view keeps its own provenance line.
 *
 * @param {Object} props
 * @param {(tab: string) => void} props.onShowTab - Switch to another view
 */
function MethodologyTab({ onShowTab }) {
  return (
    <div className="methodology-tab">
      <div id={METHOD_SECTIONS.geography} className="method-section">
        <SectionHeading
          title="Figures by area"
          subtitle="How the constituency figures on Population impact are estimated."
        />
        <section className="report-section card method-card">
          <GeographyMethodology />
        </section>
      </div>

      <div id={METHOD_SECTIONS.lifetime} className="method-section">
        <SectionHeading
          title="Lifetime model"
          subtitle="The model behind Personal impact, with its own policy values."
        />
        <section className="report-section card method-card">
          <LifecycleAbout />
        </section>
      </div>

      <div id={METHOD_SECTIONS.sources} className="method-section">
        <SectionHeading
          title="Sources and versions"
          subtitle="Where the methods are written up, and where the versions behind these figures are stated."
        />
        <section className="report-section card method-card">
          <p>
            Methods and sources: our research on the{" "}
            {RESEARCH.map(([href, label], index) => (
              <span key={href}>
                <a href={href} target="_blank" rel="noopener noreferrer">
                  {label}
                </a>
                {index < RESEARCH.length - 2 ? ", " : index === RESEARCH.length - 2 ? " and " : ""}
              </span>
            ))}
            .
          </p>
          <p>
            The replication code and the engine version behind these figures
            are in the line at the foot of the page. The{" "}
            <a
              href="?tab=living"
              onClick={(event) => {
                event.preventDefault();
                onShowTab("living");
              }}
            >
              Living standards
            </a>{" "}
            view uses a separate baseline, with its engine and data noted on
            that tab.
          </p>
        </section>
      </div>
    </div>
  );
}

export default MethodologyTab;
