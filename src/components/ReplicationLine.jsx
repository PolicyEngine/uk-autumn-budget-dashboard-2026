import { ArrowUpRight, FlaskConical, Github, Package } from "lucide-react";

/**
 * "Reproduce these results", above the site footer: a light card with what
 * it is for, then a chip for the repository and one for each Python
 * package the figures come from, at the version this build's uv.lock pins
 * (read in next.config.ts), each opening in a new tab. A version not known
 * leaves its chip out, never guessed.
 */
const REPO = "PolicyEngine/uk-autumn-budget-dashboard-2026";

/** The chips' links: the code, then each package whose version is known. */
export function replicationLinks({ policyengine, policyengineUk } = {}) {
  const links = [
    {
      key: "code",
      label: "Replication code",
      detail: REPO,
      title: `${REPO} on GitHub`,
      href: `https://github.com/${REPO}`,
      Icon: Github,
    },
  ];
  const packages = [
    ["policyengine", "policyengine.py", policyengine],
    ["policyengine-uk", "policyengine-uk", policyengineUk],
  ];
  for (const [pypi, name, version] of packages) {
    if (!version) continue;
    links.push({
      key: pypi,
      label: `${name} ${version}`,
      detail: null,
      title: `${name} ${version} on PyPI`,
      href: `https://pypi.org/project/${pypi}/${encodeURIComponent(version)}/`,
      Icon: Package,
    });
  }
  return links;
}

function ReplicationLine() {
  const links = replicationLinks({
    policyengine: process.env.NEXT_PUBLIC_POLICYENGINE_VERSION,
    policyengineUk: process.env.NEXT_PUBLIC_POLICYENGINE_UK_VERSION,
  });
  return (
    <section id="replication" className="replication-line" aria-labelledby="replication-title">
      <div className="replication-card">
        <div className="replication-head">
          <span className="replication-icon" aria-hidden="true">
            <FlaskConical size={18} strokeWidth={2} />
          </span>
          <div className="replication-words">
            <h2 className="replication-title" id="replication-title">
              Reproduce these results
            </h2>
            <p className="replication-lead">Every figure comes from open code and a pinned model version.</p>
          </div>
        </div>
        <ul className="replication-links">
          {links.map(({ key, label, detail, title, href, Icon }) => (
            <li key={key}>
              <a className="replication-chip" href={href} title={title} target="_blank" rel="noopener noreferrer">
                <Icon className="replication-chip-icon" size={16} strokeWidth={2} aria-hidden="true" />
                <span className="replication-chip-words">
                  <span className="replication-chip-label">{label}</span>
                  {detail && <span className="replication-chip-detail">{detail}</span>}
                </span>
                <ArrowUpRight className="replication-chip-arrow" size={14} strokeWidth={2.2} aria-hidden="true" />
                <span className="visually-hidden"> (opens in a new tab)</span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export default ReplicationLine;
