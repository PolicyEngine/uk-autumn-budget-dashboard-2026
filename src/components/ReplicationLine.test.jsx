import { describe, expect, it } from "vitest";
import { replicationParts } from "./ReplicationLine";

describe("replication line", () => {
  it("names the policyengine.py version the lockfile pins", () => {
    expect(replicationParts({ policyengine: "6.10.0" })).toEqual([
      "policyengine.py 6.10.0",
    ]);
  });

  it("leaves the version out when it is not known", () => {
    expect(replicationParts({ policyengine: "" })).toEqual([]);
    expect(replicationParts({})).toEqual([]);
  });
});
