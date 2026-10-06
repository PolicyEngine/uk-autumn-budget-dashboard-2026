import { afterEach, expect, it, vi } from "vitest";
import { POST } from "./route";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const request = () => new Request("http://localhost/api/personal-impact", { method: "POST", body: JSON.stringify({ employment_income: 30000, policy_ids: [] }) });

it("uses the configured pinned Python backend in MOCK mode", async () => {
  vi.stubEnv("NEXT_PUBLIC_MOCK", "1");
  vi.stubEnv("BUDGET_API_URL", "http://127.0.0.1:8000");
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ status: "healthy", versions: { "policyengine-uk": "2.120.0", "policyengine-core": "3.32.17" } }))
    .mockResolvedValueOnce(Response.json({ baseline_only: true, policies: {} }));
  vi.stubGlobal("fetch", fetch);
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(fetch.mock.calls.map(call => call[0])).toEqual(["http://127.0.0.1:8000/api/health", "http://127.0.0.1:8000/api/personal-impact"]);
});

it("blocks mismatched engines before sending household inputs", async () => {
  vi.stubEnv("NEXT_PUBLIC_MOCK", "1");
  vi.stubEnv("BUDGET_API_URL", "http://127.0.0.1:8000");
  const fetch = vi.fn().mockResolvedValue(Response.json({ status: "healthy", versions: { "policyengine-uk": "2.90.2", "policyengine-core": "3.32.17" } }));
  vi.stubGlobal("fetch", fetch);
  expect((await POST(request())).status).toBe(503);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("does not fall back to the public API when a mock backend is absent", async () => {
  vi.stubEnv("NEXT_PUBLIC_MOCK", "1");
  vi.stubEnv("BUDGET_API_URL", "");
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  expect((await POST(request())).status).toBe(503);
  expect(fetch).not.toHaveBeenCalled();
});
