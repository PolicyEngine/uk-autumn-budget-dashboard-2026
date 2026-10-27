import { describe, expect, it } from "vitest";
import { replicationLinks } from "./ReplicationLine";

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

});

describe("the build's versions, said once", () => {
  it("are in About this dashboard's Built with only: no line at the foot of every tab", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const src = join(fileURLToPath(import.meta.url), "..", "..");
    expect(readFileSync(join(src, "App.jsx"), "utf8")).not.toMatch(/<ReplicationLine/);
    expect(readFileSync(join(src, "components", "OverviewDrawer.jsx"), "utf8")).toMatch(/replicationLinks\(/);
    // Nothing points at the removed line
    expect(readFileSync(join(src, "components", "MethodologyTab.jsx"), "utf8")).not.toMatch(/id="replication"/);
  });
});
