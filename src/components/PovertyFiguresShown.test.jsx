// The poverty and people-affected switch (utils/povertyFigures.js) on: turning it back on brings every figure back.
// The cases are in test/povertyFiguresCases.jsx, shared with
// PovertyFiguresWithheld.test.jsx, which runs them with the switch off.
import { describe, vi } from "vitest";
import { describePovertyFigures } from "../test/povertyFiguresCases";

vi.mock("../utils/povertyFigures", async (importOriginal) => ({
  ...(await importOriginal()),
  POVERTY_FIGURES_SHOWN: true,
}));

const files = vi.hoisted(() => ({ current: {} }));
vi.mock("../hooks/useDataFile", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, default: (name, ...rest) => files.current[name] ?? actual.default(name, ...rest) };
});
const catalogueRef = vi.hoisted(() => ({ current: null }));
vi.mock("../utils/measureCatalogue", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useMeasureCatalogue: () => catalogueRef.current ?? actual.useMeasureCatalogue() };
});
// By age's rows: none, so every card draws its empty state (AgeSection.test.jsx),
// unless a case sets its own (the age-group fallback)
const ageRowsRef = vi.hoisted(() => ({ current: null }));
vi.mock("./YoungPeopleSection", async (importOriginal) => ({
  ...(await importOriginal()),
  useAgeImpactRows: () => ageRowsRef.current ?? { status: "ready", rows: [] },
}));
vi.mock("recharts", async () => {
  const actual = await vi.importActual("recharts");
  return { ...actual, ResponsiveContainer: ({ children }) => <div style={{ width: 800, height: 400 }}>{children}</div> };
});

describe("poverty and people-affected figures, switch on", () => {
  describePovertyFigures(true, { files, catalogueRef, ageRowsRef });
});
