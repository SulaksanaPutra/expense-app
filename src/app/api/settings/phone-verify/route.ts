import { NextResponse, type NextRequest } from "next/server";
import { hasSupabaseEnv } from "@/lib/auth/guards";
import {
  createPhoneVerificationChallenge,
  normalizePhoneNumber,
  verifyPhoneVerificationChallenge,
} from "@/lib/settings/service";
import { createClient } from "@/lib/supabase/server";

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

  if (!body || typeof body !== "object") {
    return NextResponse.json(
      { error: "Invalid verification payload." },
      { status: 400 },
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

  const record = body as Record<string, unknown>;
  const action = typeof record.action === "string" ? record.action.trim() : "";
  const phoneCheck = normalizePhoneNumber(
    typeof record.phone_number === "string" ? record.phone_number : null,
  );

  if (!phoneCheck.ok || !phoneCheck.value) {
    return NextResponse.json(
      {
        error: !phoneCheck.ok
          ? phoneCheck.message
          : "Enter a valid phone number first.",
      },
      { status: 400 },
    );
  }

  if (action === "send") {
    const challenge = createPhoneVerificationChallenge({
      userId: user.id,
      phoneNumber: phoneCheck.value,
    });

    await supabase
      .from("users")
      .update({
        phone_number: phoneCheck.value,
        phone_verified: false,
      })
      .eq("id", user.id);

    const hasExternalSmsGateway = Boolean(
      process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN,
    );

    return NextResponse.json(
      {
        ok: true,
        phoneNumber: phoneCheck.value,
        challengeToken: challenge.challengeToken,
        expiresAt: challenge.expiresAt,
        deliveryMode: hasExternalSmsGateway ? "sms" : "sandbox",
        ...(hasExternalSmsGateway ? {} : { sandboxCode: challenge.code }),
      },
      { status: 200 },
    );
  }

  if (action === "verify") {
    const code = typeof record.code === "string" ? record.code.trim() : "";
    const challengeToken =
      typeof record.challengeToken === "string"
        ? record.challengeToken.trim()
        : "";

    if (!/^\d{6}$/.test(code)) {
      return NextResponse.json(
        { error: "Enter the 6-digit verification code." },
        { status: 400 },
      );
    }

    const check = verifyPhoneVerificationChallenge({
      userId: user.id,
      phoneNumber: phoneCheck.value,
      code,
      challengeToken,
    });

    if (!check.ok) {
      return NextResponse.json({ error: check.message }, { status: 400 });
    }

    const { error: updateErr } = await supabase
      .from("users")
      .update({
        phone_number: phoneCheck.value,
        phone_verified: true,
      })
      .eq("id", user.id);

    if (updateErr) {
      return NextResponse.json(
        { error: updateErr.message || "Unable to verify phone number." },
        { status: 500 },
      );
    }

    return NextResponse.json(
      {
        ok: true,
        phoneNumber: phoneCheck.value,
        phoneVerified: true,
      },
      { status: 200 },
    );
  }

  return NextResponse.json(
    { error: "action must be 'send' or 'verify'." },
    { status: 400 },
  );
}
