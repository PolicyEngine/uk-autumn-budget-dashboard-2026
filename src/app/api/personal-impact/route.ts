import { calculatePersonalImpact, MODEL_VERSION, PersonalImpactError } from "@/lib/personalImpactApi";

export const maxDuration = 300;

export async function POST(request: Request) {
  const apiUrl = process.env.BUDGET_API_URL;
  try {
    const body = await request.json();
    if (apiUrl) {
      const base = apiUrl.replace(/\/$/, "");
      const health = await fetch(`${base}/api/health`, {
        cache: "no-store", signal: AbortSignal.timeout(10_000),
      });
      if (!health.ok) throw new PersonalImpactError("The pinned household engine is unavailable.", 503);
      const metadata = await health.json();
      if (metadata.status !== "healthy" || metadata.versions?.["policyengine-uk"] !== MODEL_VERSION ||
          metadata.versions?.["policyengine-core"] !== "3.32.5") {
        throw new PersonalImpactError("The household engine does not match the drill dataset build.", 503);
      }
      const response = await fetch(`${base}/api/personal-impact`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body), signal: AbortSignal.timeout(300_000),
      });
      if (!response.ok) {
        const detail = await response.json().catch(() => null);
        return Response.json({ error: typeof detail?.detail === "string" ? detail.detail : "Check the household inputs and selected measures." }, { status: response.status });
      }
      return Response.json(await response.json());
    }
    if (process.env.NEXT_PUBLIC_MOCK === "1") {
      throw new PersonalImpactError("Configure BUDGET_API_URL for the pinned drill household engine.", 503);
    }
    return Response.json(await calculatePersonalImpact(body));
  } catch (error) {
    if (error instanceof PersonalImpactError) return Response.json({ error: error.message }, { status: error.status });
    if (error instanceof SyntaxError) return Response.json({ error: "Enter valid household details." }, { status: 400 });
    return Response.json({ error: "The household calculator is unavailable. Please retry." }, { status: 503 });
  }
}
