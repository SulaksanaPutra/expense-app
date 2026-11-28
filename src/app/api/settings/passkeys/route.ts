import { NextResponse, type NextRequest } from "next/server";
import { hasSupabaseEnv } from "@/lib/auth/guards";
import {
  createWebAuthnChallenge,
  normalizeStoredPasskeys,
  removeEnrolledPasskey,
  saveEnrolledPasskey,
} from "@/lib/settings/security";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  if (!hasSupabaseEnv()) {
    return NextResponse.json(
      { error: "Supabase environment is not configured." },
      { status: 503 },
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json(
      { error: "Authentication required." },
      { status: 401 },
    );
  }

  const metadata = (user.user_metadata ?? {}) as Record<string, unknown>;
  const passkeys = normalizeStoredPasskeys(metadata.passkeys);
  const host = new URL(request.url).hostname;

  return NextResponse.json(
    {
      ok: true,
      passkeys,
      challenge: createWebAuthnChallenge(),
      rp: {
        id: host,
        name: "LedgerSplit",
      },
      user: {
        id: user.id,
        name: user.email ?? user.id,
        displayName:
          typeof metadata.full_name === "string" && metadata.full_name.trim()
            ? metadata.full_name.trim()
            : user.email ?? "LedgerSplit User",
      },
    },
    { status: 200 },
  );
}

export async function POST(request: NextRequest) {
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

  const record = (body && typeof body === "object" ? body : {}) as Record<
    string,
    unknown
  >;
  const credentialId =
    typeof record.credentialId === "string" ? record.credentialId : "";
  const name =
    typeof record.name === "string" && record.name.trim()
      ? record.name.trim()
      : "Device Passkey";
  const provider = record.provider === "supabase" ? "supabase" : "webauthn";

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json(
      { error: "Authentication required." },
      { status: 401 },
    );
  }

  const result = await saveEnrolledPasskey({
    supabase,
    user,
    credentialId,
    name,
    provider,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.message },
      { status: result.status },
    );
  }

  return NextResponse.json(result, { status: 201 });
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

  const passkeyId =
    body &&
    typeof body === "object" &&
    typeof (body as Record<string, unknown>).passkeyId === "string"
      ? ((body as Record<string, unknown>).passkeyId as string).trim()
      : "";

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json(
      { error: "Authentication required." },
      { status: 401 },
    );
  }

  const result = await removeEnrolledPasskey({
    supabase,
    user,
    passkeyId,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.message },
      { status: result.status },
    );
  }

  return NextResponse.json(result, { status: 200 });
}
