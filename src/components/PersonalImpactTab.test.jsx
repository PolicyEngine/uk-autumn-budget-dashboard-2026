import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import PersonalImpactTab from "./PersonalImpactTab";

const POLICIES = [
  { id: "two_child_limit", name: "2 child limit repeal" },
  { id: "rail_fares_freeze", name: "Rail fares freeze" },
  { id: "dividend_tax_increase_2pp", name: "Dividend tax increase (+2pp)" },
];
const ALL = POLICIES.map((policy) => policy.id);

// Invented figures
const ANSWER = {
  year: 2029,
  net_income: { before: 30000, after: 30512.4, change: 512.4 },
  measures: {
    included: ["dividend_tax_increase_2pp", "two_child_limit"],
    not_affected: ["dividend_tax_increase_2pp"],
    not_modelled: [
      {
        id: "rail_fares_freeze",
        reason: "This measure spreads a national cost over households by how much they use rail.",
      },
    ],
  },
  versions: {},
};

function stubFetch(respond) {
  const fetchMock = vi.fn(respond);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const calculate = () => fireEvent.click(screen.getByRole("button", { name: "Calculate" }));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the Personal impact view", () => {
  it("posts the household, the selected measures and its own year", async () => {
    const fetchMock = stubFetch(async () => Response.json(ANSWER));
    render(<PersonalImpactTab selectedPolicies={ALL} policies={POLICIES} />);
    calculate();
    await screen.findByText("£30,512");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/household-impact");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body);
    expect(body.year).toBe(2029);
    expect(body.policies).toEqual(ALL);
    expect(body.household.age).toBe(40);
  });

  it("shows net income before and after the Budget, and the change", async () => {
    stubFetch(async () => Response.json(ANSWER));
    render(<PersonalImpactTab selectedPolicies={ALL} policies={POLICIES} />);
    calculate();
    const result = await screen.findByRole("region", { name: "Your result" });
    expect(within(result).getByText("Net income before the Budget")).toBeInTheDocument();
    expect(within(result).getByText("£30,000")).toBeInTheDocument();
    expect(within(result).getByText("£30,512")).toBeInTheDocument();
    expect(within(result).getByText("+£512")).toBeInTheDocument();
  });

  it("says which measures the figures include and which they can't", async () => {
    stubFetch(async () => Response.json(ANSWER));
    render(<PersonalImpactTab selectedPolicies={ALL} policies={POLICIES} />);
    calculate();
    const result = await screen.findByRole("region", { name: "Your result" });
    const notAffected = within(result).getByRole("list", {
      name: "Not affected by your answers",
    });
    expect(notAffected).toHaveTextContent("Dividend tax increase (+2pp)");
    const notModelled = within(result).getByRole("list", { name: "Not included" });
    expect(notModelled).toHaveTextContent("Rail fares freeze");
    expect(notModelled).toHaveTextContent("by how much they use rail");
  });

  it("calculates for the year its own control shows", async () => {
    const fetchMock = stubFetch(async () => Response.json({ ...ANSWER, year: 2030 }));
    render(<PersonalImpactTab selectedPolicies={ALL} policies={POLICIES} />);
    fireEvent.click(screen.getByRole("button", { name: "Year, 2029-30" }));
    fireEvent.click(screen.getByRole("option", { name: "2030-31" }));
    calculate();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).year).toBe(2030);
  });

  it("shows that it is calculating only after 300 ms", async () => {
    stubFetch(() => new Promise(() => {}));
    render(<PersonalImpactTab selectedPolicies={ALL} policies={POLICIES} />);
    calculate();
    expect(screen.queryByText("Calculating…")).toBeNull();
    expect(await screen.findByText("Calculating…", {}, { timeout: 1000 })).toBeInTheDocument();
  });

  it.each([404, 503])(
    "says household results aren't available when the route answers %i",
    async (status) => {
      stubFetch(async () => Response.json({ detail: "unavailable" }, { status }));
      render(<PersonalImpactTab selectedPolicies={ALL} policies={POLICIES} />);
      calculate();
      expect(
        await screen.findByText("Household results aren't available yet."),
      ).toBeInTheDocument();
    },
  );

  it("asks for a policy when none is selected", () => {
    stubFetch(async () => Response.json(ANSWER));
    render(<PersonalImpactTab selectedPolicies={[]} policies={POLICIES} />);
    expect(
      screen.getByText("Choose at least one policy in the bar above."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Calculate" })).toBeDisabled();
  });
});
