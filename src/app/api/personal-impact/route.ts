export async function POST(request: Request) {
  const apiUrl = process.env.BUDGET_API_URL || "http://127.0.0.1:8001";
  try {
    const response = await fetch(`${apiUrl}/api/personal-impact`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: await request.text(),
      signal: AbortSignal.timeout(120_000),
    });
    return new Response(await response.text(), {
      status: response.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    return Response.json({ error: "The household calculator is unavailable." }, { status: 503 });
  }
}
