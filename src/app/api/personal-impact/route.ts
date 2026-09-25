export async function POST(request: Request) {
  const apiUrl = process.env.BUDGET_API_URL ||
    (process.env.NODE_ENV === "development" ? "http://127.0.0.1:8001" : null);
  if (!apiUrl) {
    return Response.json({ error: "Household calculator backend is not configured." }, { status: 503 });
  }
  try {
    const response = await fetch(`${apiUrl}/api/personal-impact`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: await request.text(),
      signal: AbortSignal.timeout(300_000),
    });
    return new Response(await response.text(), {
      status: response.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    return Response.json({ error: "The household calculator is unavailable." }, { status: 503 });
  }
}
