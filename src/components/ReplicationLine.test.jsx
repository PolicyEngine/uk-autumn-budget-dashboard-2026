import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import ReplicationLine, { replicationLinks } from "./ReplicationLine";

describe("Reproduce these results", () => {
  it("links the code, and the policyengine.py release the lockfile pins", () => {
    expect(replicationLinks({ policyengine: "6.10.0" }).map(({ label, href }) => [label, href])).toEqual([
      ["replication code", "https://github.com/PolicyEngine/uk-autumn-budget-dashboard-2026"],
      ["policyengine.py 6.10.0", "https://pypi.org/project/policyengine/6.10.0/"],
    ]);
  });

  it("leaves the package out when its version is not known", () => {
    expect(replicationLinks({ policyengine: "" }).map((link) => link.key)).toEqual(["code"]);
    expect(replicationLinks({}).map((link) => link.key)).toEqual(["code"]);
  });

  it("renders each as a chip with an icon, opening in a new tab", () => {
    vi.stubEnv("NEXT_PUBLIC_POLICYENGINE_VERSION", "6.10.2");
    render(<ReplicationLine />);
    const section = screen.getByRole("region", { name: "Reproduce these results" });
    expect(section.textContent.replace(/ \(opens in a new tab\)/g, "")).toBe(
      "Built with our replication code on policyengine.py 6.10.2.",
    );
    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual([
      "replication code (opens in a new tab)",
      "policyengine.py 6.10.2 (opens in a new tab)",
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
