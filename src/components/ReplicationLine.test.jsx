import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import ReplicationLine, { replicationLinks } from "./ReplicationLine";

describe("Reproduce these results", () => {
  it("links the code, and the policyengine.py and policyengine-uk releases the lockfile pins", () => {
    expect(replicationLinks({ policyengine: "6.10.0", policyengineUk: "2.132.6" }).map(({ label, href }) => [label, href])).toEqual([
      ["Replication code", "https://github.com/PolicyEngine/uk-autumn-budget-dashboard-2026"],
      ["policyengine.py 6.10.0", "https://pypi.org/project/policyengine/6.10.0/"],
      ["policyengine-uk 2.132.6", "https://pypi.org/project/policyengine-uk/2.132.6/"],
    ]);
  });

  it("leaves a package out when its version is not known", () => {
    expect(replicationLinks({ policyengine: "" }).map((link) => link.key)).toEqual(["code"]);
    expect(replicationLinks({}).map((link) => link.key)).toEqual(["code"]);
    expect(replicationLinks({ policyengineUk: "2.132.6" }).map((link) => link.key)).toEqual(["code", "policyengine-uk"]);
  });

  it("renders each as a chip with an icon, opening in a new tab", () => {
    vi.stubEnv("NEXT_PUBLIC_POLICYENGINE_VERSION", "6.10.2");
    vi.stubEnv("NEXT_PUBLIC_POLICYENGINE_UK_VERSION", "2.132.6");
    render(<ReplicationLine />);
    expect(screen.getByText("Every figure comes from open code and a pinned model version.")).toBeInTheDocument();
    const section = screen.getByRole("region", { name: "Reproduce these results" });
    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual([
      "Replication codePolicyEngine/uk-autumn-budget-dashboard-2026 (opens in a new tab)",
      "policyengine.py 6.10.2 (opens in a new tab)",
      "policyengine-uk 2.132.6 (opens in a new tab)",
    ]);
    for (const link of links) {
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
      expect(link.querySelector("svg")).not.toBeNull();
    }
    expect(section.id).toBe("replication");
    vi.unstubAllEnvs();
  });
});
