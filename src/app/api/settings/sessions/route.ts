import { NextResponse, type NextRequest } from "next/server";
import { hasSupabaseEnv } from "@/lib/auth/guards";
import {
  buildSecuritySessionsData,
  extractSessionIdFromJwt,
  revokeUserDeviceSession,
} from "@/lib/settings/security";
import { createClient } from "@/lib/supabase/server";

function getRequestDeviceMeta(request: NextRequest, currentSessionId: string | null) {
  return {
    userAgent: request.headers.get("user-agent"),
    ipAddress:
      request.headers.get("x-forwarded-for") ||
      request.headers.get("x-real-ip") ||
      null,
    location:
      request.headers.get("x-vercel-ip-city") ||
      request.headers.get("cf-ipcity") ||
      null,
    currentSessionId,
  };
}

export async function GET(request: NextRequest) {
  if (!hasSupabaseEnv()) {
    return NextResponse.json(
      { error: "Supabase environment is not configured." },
      { status: 503 },
    );
  }

  const supabase = await createClient();
  const [
    {
      data: { user },
      error: authError,
    },
    sessionRes,
  ] = await Promise.all([
    supabase.auth.getUser(),
    supabase.auth.getSession?.() ?? Promise.resolve({ data: { session: null } }),
  ]);

  if (authError || !user) {
    return NextResponse.json(
      { error: "Authentication required." },
      { status: 401 },
    );
  }

  const currentSessionId = extractSessionIdFromJwt(
    sessionRes?.data?.session?.access_token,
  );
  const data = buildSecuritySessionsData(
    user,
    getRequestDeviceMeta(request, currentSessionId),
  );

  return NextResponse.json({ ok: true, ...data }, { status: 200 });
}

export async function DELETE(request: NextRequest) {
  if (!hasSupabaseEnv()) {
    return NextResponse.json(
      { error: "Supabase environment is not configured." },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON request body." },
      { status: 400 },
    );
  }

  const sessionId =
    body && typeof body === "object" && typeof (body as Record<string, unknown>).sessionId === "string"
      ? ((body as Record<string, unknown>).sessionId as string).trim()
      : "";

  if (!sessionId) {
    return NextResponse.json(
      { error: "sessionId is required." },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const [
    {
      data: { user },
      error: authError,
    },
    sessionRes,
  ] = await Promise.all([
    supabase.auth.getUser(),
    supabase.auth.getSession?.() ?? Promise.resolve({ data: { session: null } }),
  ]);

  if (authError || !user) {
    return NextResponse.json(
      { error: "Authentication required." },
      { status: 401 },
    );
  }

  const currentSessionId = extractSessionIdFromJwt(
    sessionRes?.data?.session?.access_token,
  );
  const result = await revokeUserDeviceSession({
    supabase,
    user,
    sessionId,
    currentSessionId,
    requestMeta: getRequestDeviceMeta(request, currentSessionId),
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.message },
      { status: result.status },
    );
  }

  return NextResponse.json(result, { status: 200 });
}
