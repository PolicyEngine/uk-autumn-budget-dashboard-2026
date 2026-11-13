import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import ObrDifferencePanel from "./ObrDifferencePanel";
import { POLICY_DETAILS } from "../utils/policyDetails";
import { OBR_NOTES_WRITTEN_FOR } from "../utils/obrDeviationNotes";

afterEach(cleanup);

const bus = POLICY_DETAILS.find((entry) => entry.id === "bus_fare_cap_2027");
const row = (description) => ({
  id: bus.id, name: bus.name, measure: { id: bus.id, description },
  pe: 0, obr: -0.18, notComparable: "The fare cap already applies on both policy sides.",
});

it("uses the native comparison's own reason rather than the archived cap-end explanation", () => {
  render(<ObrDifferencePanel row={row(bus.writtenFor)} year={2027} yearLabel="2027-28" obrKind="static" />);
  expect(screen.getByText(/The fare cap already applies on both policy sides/)).toBeInTheDocument();
  expect(screen.queryByText(/The cap ends in December/)).toBeNull();
});

it("keeps the original short reason only for its archived description", () => {
  render(<ObrDifferencePanel row={row(OBR_NOTES_WRITTEN_FOR[bus.id])} year={2029} yearLabel="2029-30" obrKind="static" />);
  expect(screen.getByText(/The cap ends in December 2027/)).toBeInTheDocument();
});
