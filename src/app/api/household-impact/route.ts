/**
 * Forwards the Personal impact view's household to the household impact
 * app on Modal (src/uk_budget_data/modal_household.py), at the URL in
 * HOUSEHOLD_IMPACT_API_URL: a server-side variable, set in the Vercel
 * project, so the browser never needs the app's address.
 *
 * The app's answers, its refusals included, pass through with their
 * status. With no app configured, or none answering in time, the route
 * answers 503, which the view shows as "Household results aren't
 * available yet."
 */

// Seconds Vercel lets this route run: a cold start restores the app's
// memory snapshot, then calculates
export const maxDuration = 60;

// Stop waiting for the app a little before Vercel stops the route
const TIMEOUT_MS = (maxDuration - 5) * 1000;

const UNAVAILABLE = { detail: "Household results aren't available yet." };

export async function POST(request: Request): Promise<Response> {
  const base = process.env.HOUSEHOLD_IMPACT_API_URL?.replace(/\/+$/, "");
  if (!base) return Response.json(UNAVAILABLE, { status: 503 });

  const body = await request.text();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const answer = await fetch(`${base}/household-impact`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: controller.signal,
      cache: "no-store",
    });
    return new Response(await answer.text(), {
      status: answer.status,
      headers: {
        "Content-Type": answer.headers.get("Content-Type") ?? "application/json",
      },
    });
  } catch {
    return Response.json(UNAVAILABLE, { status: 503 });
  } finally {
    clearTimeout(timer);
  }
}
