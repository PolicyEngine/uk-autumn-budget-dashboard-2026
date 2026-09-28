import { calculatePersonalImpact, PersonalImpactError } from "@/lib/personalImpactApi";

export const maxDuration = 300;

export async function POST(request: Request) {
  // Retain the dedicated Python service as an explicit override. Drill previews
  // use the PolicyEngine UK household API adapter without deployment secrets.
  const apiUrl = process.env.BUDGET_API_URL;
  try {
    const body = await request.json();
    if (apiUrl) {
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
