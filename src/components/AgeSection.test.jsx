import { describe, expect, it } from "vitest";
import { ageGroupFrom, ageWindow, groupAges, groupSubject, AGE_GROUP_OPTIONS } from "../utils/ageGroups";
import { oldAgeSubGroup } from "../App";

describe("By age's age groups", () => {
  it("offers every band, pensioners and all ages, and reads ?age= with 16 to 24 as the default", () => {
    expect(AGE_GROUP_OPTIONS.map((group) => group.key)).toEqual(["0-15", "16-24", "25-34", "35-49", "50-64", "65+", "pensioners", "all"]);
    expect(ageGroupFrom("pensioners")).toBe("pensioners");
    expect(ageGroupFrom("nonsense")).toBe("16-24");
    expect(ageGroupFrom(null)).toBe("16-24");
  });

  it("names each group as a sentence's subject", () => {
    expect(groupSubject("16-24")).toBe("16 to 24-year-olds");
    expect(groupSubject("0-15")).toBe("Under-16s");
    expect(groupSubject("65+")).toBe("People aged 65 and over");
    expect(groupSubject("pensioners")).toBe("Pensioners");
  });

  it("gives each group its ages, and the single-year chart only those ages", () => {
    expect(groupAges("16-24", 2027)).toEqual([16, 24]);
    expect(groupAges("pensioners", 2026)).toEqual([66, 90]);
    expect(groupAges("pensioners", 2027)).toEqual([67, 90]);
    expect(ageWindow("16-24", 2027)).toEqual([16, 24]);
    expect(ageWindow("pensioners", 2027)).toEqual([67, 90]);
    expect(ageWindow("65+", 2027)).toEqual([65, 90]);
    expect(ageWindow("all", 2027)).toEqual([0, 90]);
  });

  it("turns the old Young people and Pensioners sub-tab links into By age with the group chosen", () => {
    expect(oldAgeSubGroup({ search: "?sub=young" })).toBe("16-24");
    expect(oldAgeSubGroup({ search: "?tab=dashboard&sub=pensioners" })).toBe("pensioners");
    expect(oldAgeSubGroup({ search: "?sub=age" })).toBeNull();
  });
});

describe("By age's cards share one age group", async () => {
  const { vi } = await import("vitest");
  const { fireEvent, render, screen, within } = await import("@testing-library/react");
  vi.mock("./YoungPeopleSection", async (original) => ({
    ...(await original()),
    useAgeImpactRows: () => ({ status: "ready", rows: [] }),
  }));
  vi.mock("recharts", async () => {
    const actual = await vi.importActual("recharts");
    return { ...actual, ResponsiveContainer: ({ children }) => <div style={{ width: 800, height: 400 }}>{children}</div> };
  });

  it("chosen in any card's Options, it changes all four and the address", async () => {
    const { default: AgeSection } = await import("./AgeSection");
    const { POVERTY_FIGURES_SHOWN } = await import("../utils/povertyFigures");
    window.history.replaceState({}, "", "/?sub=age&age=16-24");
    render(<AgeSection selectedPolicies={[]} selectedYear={2027} policies={[]} />);
    const pills = () => screen.getAllByRole("button", { name: /^Options:/ });
    // Three while the winners and losers shares are withheld (povertyFigures.js)
    expect(pills()).toHaveLength(POVERTY_FIGURES_SHOWN ? 4 : 3);
    for (const pill of pills()) expect(pill.getAttribute("aria-label")).toMatch(/^Options: 16 to 24/);
    // Choose 50 to 64 in the second card (Change by year)
    fireEvent.click(pills()[1]);
    const dialog = screen.getByRole("dialog");
    const group = within(dialog).getAllByRole("radiogroup")[0];
    fireEvent.click(within(group).getByRole("radio", { name: /50 to 64/ }));
    for (const pill of pills()) expect(pill.getAttribute("aria-label")).toMatch(/^Options: 50 to 64/);
    expect(new URLSearchParams(window.location.search).get("age")).toBe("50-64");
  });

  it("with All ages against All ages, Effect of each policy's pill reads All ages once", async () => {
    const { default: AgeSection } = await import("./AgeSection");
    window.history.replaceState({}, "", "/?sub=age&age=all");
    render(<AgeSection selectedPolicies={[]} selectedYear={2027} policies={[]} />);
    const pills = screen.getAllByRole("button", { name: /^Options:/ });
    // Average change by age, Change by year, Effect of each policy, Winners and losers
    // By age opens Compare with on 25 to 34; with All ages chosen there too,
    // the pill reads All ages once
    expect(pills[2].getAttribute("aria-label")).toMatch(/25 to 34/);
    fireEvent.click(pills[2]);
    const compare = within(screen.getByRole("dialog")).getAllByRole("radiogroup")[1];
    fireEvent.click(within(compare).getByRole("radio", { name: "All ages" }));
    expect(screen.getAllByRole("button", { name: /^Options:/ })[2].getAttribute("aria-label")).toBe("Options: All ages");
  });

  it("opens Effect of each policy on 16 to 24 compared with 25 to 34", async () => {
    const { default: AgeSection } = await import("./AgeSection");
    window.history.replaceState({}, "", "/?sub=age");
    render(<AgeSection selectedPolicies={[]} selectedYear={2027} policies={[]} />);
    const pill = screen.getAllByRole("button", { name: /^Options:/ })[2];
    expect(pill.getAttribute("aria-label")).toBe("Options: 16 to 24 · 25 to 34");
    fireEvent.click(pill);
    const [group, compare] = within(screen.getByRole("dialog")).getAllByRole("radiogroup");
    expect(within(group).getByRole("radio", { name: "16 to 24" })).toHaveAttribute("aria-checked", "true");
    expect(within(compare).getByRole("radio", { name: "25 to 34" })).toHaveAttribute("aria-checked", "true");
  });
});
