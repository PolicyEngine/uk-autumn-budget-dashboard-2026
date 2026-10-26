import { ArrowUpRight, Github, Package } from "lucide-react";

/**
 * "Reproduce these results", above the site footer, as one centred
 * sentence with a link (and its icon) to the repository and one to the
 * policyengine.py release this build's uv.lock
 * pins (read in next.config.ts), each opening in a new tab. A missing
 * version leaves its link out, never guessed.
 */
const REPO = "PolicyEngine/uk-autumn-budget-dashboard-2026";

/** The chips' links: the code, then the package release when its version is known. */
export function replicationLinks({ policyengine } = {}) {
  const links = [
    {
      key: "code",
      label: "replication code",
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

/** One link in the sentence: its icon, its words, an arrow on hover. */
function SentenceLink({ label, title, href, Icon }) {
  return (
    <a className="replication-link" href={href} title={title} target="_blank" rel="noopener noreferrer">
      <Icon className="replication-link-icon" size={14} strokeWidth={2} aria-hidden="true" />
      <span className="replication-link-label">{label}</span>
      <ArrowUpRight className="replication-link-arrow" size={12} strokeWidth={2.2} aria-hidden="true" />
      <span className="visually-hidden"> (opens in a new tab)</span>
    </a>
  );
}

/**
 * One sentence: "Reproduce these results with our replication code, built
 * on policyengine.py 6.10.2." (the second clause only when the version is
 * known).
 */
function ReplicationLine() {
  const [code, pkg] = replicationLinks({ policyengine: process.env.NEXT_PUBLIC_POLICYENGINE_VERSION });
  return (
    <section id="replication" className="replication-line" aria-label="Reproduce these results">
      <p className="replication-sentence">
        Reproduce these results with our <SentenceLink label={code.label} title={code.title} href={code.href} Icon={code.Icon} />
        {pkg && (
          <>
            , built on <SentenceLink label={pkg.label} title={pkg.title} href={pkg.href} Icon={pkg.Icon} />
          </>
        )}
        .
      </p>
    </section>
  );
}

export default ReplicationLine;
