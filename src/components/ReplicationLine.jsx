import { Github, Package } from "lucide-react";

/**
 * The links behind the About drawer's "Built with" list (OverviewDrawer):
 * the repository, and the policyengine.py release this build's uv.lock
 * pins (read in next.config.ts), its entry left out when unknown. The page
 * says them there once; no line at the foot of every tab repeats them.
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
