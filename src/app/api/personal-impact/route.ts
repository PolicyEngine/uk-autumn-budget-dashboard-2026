import { calculatePersonalImpact, PersonalImpactError } from "@/lib/personalImpactApi";

export const maxDuration = 300;

export async function POST(request: Request) {
  // Retain the dedicated Python service as an explicit override. Drill previews
  // use the PolicyEngine UK household API adapter without deployment secrets.
  const apiUrl = process.env.BUDGET_API_URL;
  try {
    const body = await request.json();
    const policyIds = Array.isArray(body?.policy_ids) ? body.policy_ids : [];
    const hasMockPolicy = policyIds.some((id: unknown) =>
      typeof id === "string" && id.startsWith("mock_"),
    );
    // The optional Python service predates the mock package. Always use the
    // verified UK API adapter for the drill's featured mock IDs.
    if (apiUrl && !hasMockPolicy && process.env.NEXT_PUBLIC_MOCK !== "1") {
      const response = await fetch(`${apiUrl.replace(/\/$/, "")}/api/personal-impact`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(300_000),
      });
      return new Response(await response.text(), {
        status: response.status,
        headers: { "Content-Type": "application/json" },
      });
    }
    return Response.json(await calculatePersonalImpact(body));
  } catch (error) {
    if (error instanceof PersonalImpactError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof SyntaxError) {
      return Response.json({ error: "Enter valid household details." }, { status: 400 });
    }
    return Response.json({ error: "The household calculator is unavailable. Please retry." }, { status: 503 });
  }
}
