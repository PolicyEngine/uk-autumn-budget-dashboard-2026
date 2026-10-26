import { Github, Package } from "lucide-react";

/**
 * "Reproduce these results", above the site footer: a chip to the
 * repository and one to the policyengine.py release this build's uv.lock
 * pins (read in next.config.ts), each opening in a new tab. A missing
 * version leaves its chip out, never guessed.
 */
const REPO = "PolicyEngine/uk-autumn-budget-dashboard-2026";

/** The chips' links: the code, then the package release when its version is known. */
export function replicationLinks({ policyengine } = {}) {
  const links = [
    {
      key: "code",
      label: "Replication code",
      title: `${REPO} on GitHub`,
      href: `https://github.com/${REPO}`,
      Icon: Github,
    },
  ];
  if (policyengine) {
    links.push({
      key: "package",
      label: `policyengine.py ${policyengine}`,
      title: `policyengine.py ${policyengine} on PyPI`,
      href: `https://pypi.org/project/policyengine/${encodeURIComponent(policyengine)}/`,
      Icon: Package,
    });
  }
  return links;
}

function ReplicationLine() {
  const links = replicationLinks({ policyengine: process.env.NEXT_PUBLIC_POLICYENGINE_VERSION });
  return (
    <section id="replication" className="replication-line" aria-labelledby="replication-title">
      <span className="replication-title" id="replication-title">
        Reproduce these results
      </span>
      <ul className="replication-links">
        {links.map(({ key, label, title, href, Icon }) => (
          <li key={key}>
            <a className="replication-chip" href={href} title={title} target="_blank" rel="noopener noreferrer">
              <Icon size={14} strokeWidth={2} aria-hidden="true" />
              {label}
              <span className="visually-hidden"> (opens in a new tab)</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default ReplicationLine;
