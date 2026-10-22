// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST, maxDuration } from "./route";

const APP_URL = "https://policyengine--uk-budget-2026-household-impact.modal.run";
const REQUEST = { year: 2029, policies: ["two_child_limit"], household: { age: 40 } };
const ANSWER = {
  year: 2029,
  net_income: { before: 30_000, after: 30_500, change: 500 },
};

function post(body: unknown = REQUEST): Request {
  return new Request("http://localhost/api/household-impact", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function stubFetch(implementation: typeof fetch) {
  const fetchMock = vi.fn<typeof fetch>(implementation);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("the household impact route", () => {
  it("forwards the household to the app named by HOUSEHOLD_IMPACT_API_URL", async () => {
    vi.stubEnv("HOUSEHOLD_IMPACT_API_URL", `${APP_URL}/`);
    const fetchMock = stubFetch(async () => Response.json(ANSWER));

    const response = await POST(post());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(ANSWER);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${APP_URL}/household-impact`);
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual(REQUEST);
  });

  it("passes the app's own refusal through, with its status", async () => {
    vi.stubEnv("HOUSEHOLD_IMPACT_API_URL", APP_URL);
    const refusal = { detail: [{ loc: ["body", "year"], msg: "Choose a year" }] };
    stubFetch(async () => Response.json(refusal, { status: 422 }));

    const response = await POST(post({ ...REQUEST, year: 2040 }));

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual(refusal);
  });

  it("answers 503 when no app is configured", async () => {
    vi.stubEnv("HOUSEHOLD_IMPACT_API_URL", "");
    const fetchMock = stubFetch(async () => Response.json(ANSWER));

    const response = await POST(post());

    expect(response.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers 503 when the app can't be reached", async () => {
    vi.stubEnv("HOUSEHOLD_IMPACT_API_URL", APP_URL);
    stubFetch(async () => {
      throw new TypeError("fetch failed");
    });

    const response = await POST(post());

    expect(response.status).toBe(503);
  });

  it("answers 503 when the app doesn't answer before Vercel stops the route", async () => {
    vi.useFakeTimers();
    vi.stubEnv("HOUSEHOLD_IMPACT_API_URL", APP_URL);
    stubFetch(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );

    const pending = POST(post());
    await vi.advanceTimersByTimeAsync(maxDuration * 1000);
    const response = await pending;

    expect(response.status).toBe(503);
  });
});
