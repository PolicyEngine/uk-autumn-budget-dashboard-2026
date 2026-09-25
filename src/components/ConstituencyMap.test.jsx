import { afterEach, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import ConstituencyMap from "./ConstituencyMap";

afterEach(() => vi.unstubAllGlobals());

it("states when a selected policy has no constituency estimates", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url) => ({
    text: async () => "reform_id,year,constituency_code,constituency_name,average_gain,relative_change\nthreshold_freeze_extension,2027,E14000001,Example,1,0.1\n",
    json: async () => ({ type: "FeatureCollection", features: [] }),
  })));
  render(<ConstituencyMap selectedPolicies={["threshold_freeze_extension", "bus_fare_cap"]} selectedYear={2027} />);
  expect(await screen.findByText(/Complete constituency estimates for the selected policies are not available/)).toBeInTheDocument();
});
