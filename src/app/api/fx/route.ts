import { NextResponse, type NextRequest } from "next/server";
import { getFallbackFxRate, isValidCurrencyCode } from "@/lib/money";

export async function GET(request: NextRequest) {
  const from = (request.nextUrl.searchParams.get("from") ?? "USD")
    .trim()
    .toUpperCase();
  const to = (request.nextUrl.searchParams.get("to") ?? "USD")
    .trim()
    .toUpperCase();

  if (!isValidCurrencyCode(from) || !isValidCurrencyCode(to)) {
    return NextResponse.json(
      { error: "Valid 3-letter ISO-4217 currency codes are required." },
      { status: 400 },
    );
  }

  if (from === to) {
    return NextResponse.json({
      ok: true,
      from,
      to,
      rate: 1,
      source: "API" as const,
    });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2000);
  try {
    const response = await fetch(
      `https://api.frankfurter.app/latest?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      {
        signal: controller.signal,
        next: { revalidate: 300 },
      },
    );

    if (response.ok) {
      const data = (await response.json()) as {
        rates?: Record<string, number>;
      };
      const liveRate = data.rates?.[to];
      if (typeof liveRate === "number" && Number.isFinite(liveRate) && liveRate > 0) {
        return NextResponse.json({
          ok: true,
          from,
          to,
          rate: Number(liveRate.toFixed(6)),
          source: "API" as const,
        });
      }
    }
  } catch {
    // Fall back to deterministic reference rate when offline or rate-limited.
  } finally {
    clearTimeout(timer);
  }

  return NextResponse.json({
    ok: true,
    from,
    to,
    rate: getFallbackFxRate(from, to),
    source: "API" as const,
  });
}
