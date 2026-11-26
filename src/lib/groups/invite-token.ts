import { createHmac, timingSafeEqual } from "node:crypto";

export interface SignedInvitePayload {
  g: string;
  s: string;
  v: number;
  iat: number;
  exp?: number;
}

export type InviteTokenVerifyErrorCode =
  | "MISSING_TOKEN"
  | "MALFORMED_TOKEN"
  | "INVALID_SIGNATURE"
  | "MISMATCHED_SLUG"
  | "EXPIRED"
  | "REVOKED";

export type VerifySignedInviteResult =
  | { ok: true; payload: SignedInvitePayload }
  | { ok: false; code: InviteTokenVerifyErrorCode; message: string };

const DEV_FALLBACK_SECRET = "ledgersplit-dev-invite-signing-secret-v1";

export function getInviteSigningSecret(explicitSecret?: string): string {
  if (explicitSecret) {
    return explicitSecret;
  }

  const serverSecret =
    process.env.INVITE_TOKEN_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (serverSecret) {
    return serverSecret;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "INVITE_TOKEN_SECRET or SUPABASE_SERVICE_ROLE_KEY must be configured in production.",
    );
  }

  return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || DEV_FALLBACK_SECRET;
}

function signPayloadEncoded(payloadB64: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(payloadB64)
    .digest("base64url");
}

export function createSignedInviteToken(params: {
  groupId: string;
  slug: string;
  version: number;
  issuedAtMs?: number;
  expiresInMs?: number;
  secret?: string;
}): string {
  const version = Math.trunc(params.version);
  if (!params.groupId || !params.slug || !Number.isInteger(version) || version < 1) {
    throw new Error("Invalid invite token parameters.");
  }

  const issuedAtMs = params.issuedAtMs ?? Date.now();
  const payload: SignedInvitePayload = {
    g: params.groupId,
    s: params.slug,
    v: version,
    iat: issuedAtMs,
  };

  if (
    typeof params.expiresInMs === "number" &&
    Number.isFinite(params.expiresInMs) &&
    params.expiresInMs > 0
  ) {
    payload.exp = issuedAtMs + Math.trunc(params.expiresInMs);
  }

  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  const signatureB64 = signPayloadEncoded(
    payloadB64,
    getInviteSigningSecret(params.secret),
  );

  return `${payloadB64}.${signatureB64}`;
}

export function verifySignedInviteToken(params: {
  token: string | null | undefined;
  expectedSlug: string;
  currentVersion?: number;
  nowMs?: number;
  secret?: string;
}): VerifySignedInviteResult {
  const rawToken = typeof params.token === "string" ? params.token.trim() : "";
  if (!rawToken) {
    return {
      ok: false,
      code: "MISSING_TOKEN",
      message: "Invite token is missing from the link.",
    };
  }

  const dotIndex = rawToken.indexOf(".");
  if (
    dotIndex <= 0 ||
    dotIndex !== rawToken.lastIndexOf(".") ||
    dotIndex === rawToken.length - 1
  ) {
    return {
      ok: false,
      code: "MALFORMED_TOKEN",
      message: "This invite link is malformed or incomplete.",
    };
  }

  const payloadB64 = rawToken.slice(0, dotIndex);
  const providedSigB64 = rawToken.slice(dotIndex + 1);

  const expectedSigB64 = signPayloadEncoded(
    payloadB64,
    getInviteSigningSecret(params.secret),
  );

  const providedBuf = Buffer.from(providedSigB64, "utf8");
  const expectedBuf = Buffer.from(expectedSigB64, "utf8");

  if (
    providedBuf.length !== expectedBuf.length ||
    !timingSafeEqual(providedBuf, expectedBuf)
  ) {
    return {
      ok: false,
      code: "INVALID_SIGNATURE",
      message: "This invite link has an invalid signature or was tampered with.",
    };
  }

  let parsed: unknown;
  try {
    const decoded = Buffer.from(payloadB64, "base64url").toString("utf8");
    parsed = JSON.parse(decoded);
  } catch {
    return {
      ok: false,
      code: "MALFORMED_TOKEN",
      message: "This invite token could not be decoded.",
    };
  }

  if (!parsed || typeof parsed !== "object") {
    return {
      ok: false,
      code: "MALFORMED_TOKEN",
      message: "This invite token payload is invalid.",
    };
  }

  const candidate = parsed as Partial<SignedInvitePayload>;
  if (
    typeof candidate.g !== "string" ||
    !candidate.g ||
    typeof candidate.s !== "string" ||
    !candidate.s ||
    typeof candidate.v !== "number" ||
    !Number.isInteger(candidate.v) ||
    candidate.v < 1 ||
    typeof candidate.iat !== "number" ||
    !Number.isFinite(candidate.iat)
  ) {
    return {
      ok: false,
      code: "MALFORMED_TOKEN",
      message: "This invite token is missing required group claims.",
    };
  }

  if (candidate.s !== params.expectedSlug) {
    return {
      ok: false,
      code: "MISMATCHED_SLUG",
      message: "This invite token does not match the requested group.",
    };
  }

  const nowMs = params.nowMs ?? Date.now();
  if (typeof candidate.exp === "number" && nowMs > candidate.exp) {
    return {
      ok: false,
      code: "EXPIRED",
      message: "This invite link has expired. Ask a group admin for a new link.",
    };
  }

  if (
    typeof params.currentVersion === "number" &&
    candidate.v !== params.currentVersion
  ) {
    return {
      ok: false,
      code: "REVOKED",
      message:
        "This invite link has been revoked by a group admin. Ask for the latest link.",
    };
  }

  return {
    ok: true,
    payload: {
      g: candidate.g,
      s: candidate.s,
      v: candidate.v,
      iat: candidate.iat,
      ...(typeof candidate.exp === "number" ? { exp: candidate.exp } : {}),
    },
  };
}
