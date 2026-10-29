// The poverty and people-affected switch (utils/povertyFigures.js) off, as it ships.
// The cases are in test/povertyFiguresCases.jsx, shared with
// PovertyFiguresShown.test.jsx, which runs them with the switch on.
import { describe, vi } from "vitest";
import { describePovertyFigures } from "../test/povertyFiguresCases";

vi.mock("../utils/povertyFigures", async (importOriginal) => ({
  ...(await importOriginal()),
  POVERTY_FIGURES_SHOWN: false,
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
// By age's rows: none, so every card draws its empty state (AgeSection.test.jsx)
vi.mock("./YoungPeopleSection", async (importOriginal) => ({
  ...(await importOriginal()),
  useAgeImpactRows: () => ({ status: "ready", rows: [] }),
}));
vi.mock("recharts", async () => {
  const actual = await vi.importActual("recharts");
  return { ...actual, ResponsiveContainer: ({ children }) => <div style={{ width: 800, height: 400 }}>{children}</div> };
});

describe("poverty and people-affected figures, switch off", () => {
  describePovertyFigures(false, { files, catalogueRef });
});
