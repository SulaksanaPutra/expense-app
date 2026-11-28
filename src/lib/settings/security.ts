import { randomBytes } from "node:crypto";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export interface EnrolledPasskey {
  id: string;
  credentialId: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  provider: "supabase" | "webauthn";
}

export interface ActiveDeviceSession {
  id: string;
  deviceLabel: string;
  browser: string;
  os: string;
  deviceType: "desktop" | "mobile";
  location: string;
  ipAddress: string;
  createdAt: string;
  lastActiveAt: string;
  isCurrent: boolean;
}

export interface SsoProviderStatus {
  googleConnected: boolean;
  email: string;
  providerLabel: string;
  statusLabel: string;
  twoFactorEnforced: boolean;
}

export interface SecuritySessionsData {
  sso: SsoProviderStatus;
  passkeys: EnrolledPasskey[];
  sessions: ActiveDeviceSession[];
}

export interface RequestDeviceMeta {
  userAgent?: string | null;
  ipAddress?: string | null;
  location?: string | null;
  currentSessionId?: string | null;
}

interface StoredSessionRecord {
  id: string;
  deviceLabel: string;
  browser: string;
  os: string;
  deviceType: "desktop" | "mobile";
  location: string;
  ipAddress: string;
  createdAt: string;
  lastActiveAt: string;
}

export function parseUserAgentToDevice(userAgent: string | null | undefined): {
  deviceLabel: string;
  browser: string;
  os: string;
  deviceType: "desktop" | "mobile";
} {
  const ua = (userAgent ?? "").trim();
  if (!ua) {
    return {
      deviceLabel: "Web Browser · Current Session",
      browser: "Browser",
      os: "Unknown OS",
      deviceType: "desktop",
    };
  }

  let os = "Desktop";
  let hardware = "Desktop";
  let deviceType: "desktop" | "mobile" = "desktop";

  if (/iPhone/i.test(ua)) {
    os = "iOS";
    hardware = "iPhone";
    deviceType = "mobile";
  } else if (/iPad/i.test(ua)) {
    os = "iPadOS";
    hardware = "iPad";
    deviceType = "mobile";
  } else if (/Android/i.test(ua)) {
    os = "Android";
    hardware = "Android Device";
    deviceType = "mobile";
  } else if (/Macintosh|Mac OS X/i.test(ua)) {
    os = "macOS";
    hardware = "Mac";
  } else if (/Windows/i.test(ua)) {
    os = "Windows";
    hardware = "Windows PC";
  } else if (/Linux/i.test(ua)) {
    os = "Linux";
    hardware = "Linux Workstation";
  }

  let browser = "Browser";
  if (/Edg\//i.test(ua)) {
    browser = "Edge";
  } else if (/Firefox\//i.test(ua)) {
    browser = "Firefox";
  } else if (/Chrome\//i.test(ua) || /CriOS\//i.test(ua)) {
    browser = "Chrome";
  } else if (/Safari\//i.test(ua)) {
    browser = deviceType === "mobile" ? "Safari Mobile" : "Safari";
  }

  const deviceLabel =
    deviceType === "mobile"
      ? `${hardware} · ${browser}`
      : `${hardware} · ${browser} (${os})`;

  return { deviceLabel, browser, os, deviceType };
}

export function extractSessionIdFromJwt(
  accessToken: string | null | undefined,
): string | null {
  if (!accessToken || typeof accessToken !== "string") return null;
  const parts = accessToken.split(".");
  if (parts.length < 2) return null;
  try {
    const payloadJson = Buffer.from(parts[1], "base64url").toString("utf8");
    const parsed = JSON.parse(payloadJson) as { session_id?: unknown };
    return typeof parsed.session_id === "string" && parsed.session_id.trim()
      ? parsed.session_id.trim()
      : null;
  } catch {
    return null;
  }
}

export function normalizeStoredPasskeys(raw: unknown): EnrolledPasskey[] {
  if (!Array.isArray(raw)) return [];
  const results: EnrolledPasskey[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const id = typeof rec.id === "string" ? rec.id.trim() : "";
    const credentialId =
      typeof rec.credentialId === "string" ? rec.credentialId.trim() : "";
    const name = typeof rec.name === "string" ? rec.name.trim() : "";
    if (!id || !credentialId || !name) continue;
    results.push({
      id,
      credentialId,
      name,
      createdAt:
        typeof rec.createdAt === "string"
          ? rec.createdAt
          : new Date().toISOString(),
      lastUsedAt: typeof rec.lastUsedAt === "string" ? rec.lastUsedAt : null,
      provider: rec.provider === "supabase" ? "supabase" : "webauthn",
    });
  }
  return results;
}

function normalizeStoredSessions(raw: unknown): StoredSessionRecord[] {
  if (!Array.isArray(raw)) return [];
  const results: StoredSessionRecord[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const id = typeof rec.id === "string" ? rec.id.trim() : "";
    const deviceLabel =
      typeof rec.deviceLabel === "string" ? rec.deviceLabel.trim() : "";
    if (!id || !deviceLabel) continue;
    results.push({
      id,
      deviceLabel,
      browser: typeof rec.browser === "string" ? rec.browser : "Browser",
      os: typeof rec.os === "string" ? rec.os : "Unknown OS",
      deviceType: rec.deviceType === "mobile" ? "mobile" : "desktop",
      location:
        typeof rec.location === "string" && rec.location.trim()
          ? rec.location.trim()
          : "Current region",
      ipAddress:
        typeof rec.ipAddress === "string" && rec.ipAddress.trim()
          ? rec.ipAddress.trim()
          : "127.0.0.1",
      createdAt:
        typeof rec.createdAt === "string"
          ? rec.createdAt
          : new Date().toISOString(),
      lastActiveAt:
        typeof rec.lastActiveAt === "string"
          ? rec.lastActiveAt
          : new Date().toISOString(),
    });
  }
  return results;
}

export function extractSsoStatus(user: Pick<User, "email" | "app_metadata" | "identities">): SsoProviderStatus {
  const email = user.email ?? "";
  const providers = Array.isArray(user.app_metadata?.providers)
    ? (user.app_metadata.providers as unknown[]).filter(
        (p): p is string => typeof p === "string",
      )
    : [];
  const primaryProvider =
    typeof user.app_metadata?.provider === "string"
      ? user.app_metadata.provider
      : "";
  const identityProviders = Array.isArray(user.identities)
    ? user.identities.map((i) => i.provider)
    : [];

  const googleConnected =
    primaryProvider === "google" ||
    providers.includes("google") ||
    identityProviders.includes("google");

  return {
    googleConnected,
    email,
    providerLabel: "Google Workspace SSO",
    statusLabel: googleConnected ? "Active" : "Available",
    twoFactorEnforced: googleConnected,
  };
}

export function buildSecuritySessionsData(
  user: Pick<User, "id" | "email" | "app_metadata" | "user_metadata" | "identities">,
  meta: RequestDeviceMeta = {},
): SecuritySessionsData {
  const metadata = (user.user_metadata ?? {}) as Record<string, unknown>;
  const passkeys = normalizeStoredPasskeys(metadata.passkeys);
  const storedSessions = normalizeStoredSessions(metadata.active_sessions);
  const revokedIds = new Set(
    Array.isArray(metadata.revoked_session_ids)
      ? (metadata.revoked_session_ids as unknown[]).filter(
          (id): id is string => typeof id === "string",
        )
      : [],
  );

  const currentId = meta.currentSessionId?.trim() || `session-current-${user.id.slice(0, 8)}`;
  const nowIso = new Date().toISOString();
  const parsed = parseUserAgentToDevice(meta.userAgent);
  const cleanIp =
    meta.ipAddress?.split(",")[0]?.trim() || "127.0.0.1";
  const cleanLocation = meta.location?.trim() || "Current session";

  const activeById = new Map<string, ActiveDeviceSession>();
  for (const s of storedSessions) {
    if (revokedIds.has(s.id)) continue;
    activeById.set(s.id, {
      ...s,
      isCurrent: s.id === currentId,
    });
  }

  const existingCurrent = activeById.get(currentId);
  activeById.set(currentId, {
    id: currentId,
    deviceLabel: existingCurrent?.deviceLabel || parsed.deviceLabel,
    browser: parsed.browser,
    os: parsed.os,
    deviceType: parsed.deviceType,
    location: existingCurrent?.location || cleanLocation,
    ipAddress: cleanIp !== "127.0.0.1" ? cleanIp : existingCurrent?.ipAddress || cleanIp,
    createdAt: existingCurrent?.createdAt || nowIso,
    lastActiveAt: nowIso,
    isCurrent: true,
  });

  const sessions = Array.from(activeById.values()).sort((a, b) => {
    if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
    return b.lastActiveAt.localeCompare(a.lastActiveAt);
  });

  return {
    sso: extractSsoStatus(user),
    passkeys,
    sessions,
  };
}

export async function revokeUserDeviceSession(params: {
  supabase: SupabaseClient<Database>;
  user: User;
  sessionId: string;
  currentSessionId: string | null;
  requestMeta?: RequestDeviceMeta;
}): Promise<
  | {
      ok: true;
      revokedSessionId: string;
      revokedCurrentSession: boolean;
      sessions: ActiveDeviceSession[];
    }
  | { ok: false; status: number; message: string }
> {
  const targetId = params.sessionId.trim();
  if (!targetId) {
    return {
      ok: false,
      status: 400,
      message: "Session ID is required to revoke a device.",
    };
  }

  const currentData = buildSecuritySessionsData(params.user, {
    ...params.requestMeta,
    currentSessionId: params.currentSessionId,
  });

  const targetSession = currentData.sessions.find((s) => s.id === targetId);
  if (!targetSession) {
    return {
      ok: false,
      status: 404,
      message: "Active device session not found or already revoked.",
    };
  }

  const metadata = (params.user.user_metadata ?? {}) as Record<string, unknown>;
  const existingRevoked = Array.isArray(metadata.revoked_session_ids)
    ? (metadata.revoked_session_ids as unknown[]).filter(
        (id): id is string => typeof id === "string",
      )
    : [];

  const nextRevokedIds = Array.from(new Set([...existingRevoked, targetId])).slice(-50);
  const remainingSessions = currentData.sessions
    .filter((s) => s.id !== targetId)
    .map((session) => ({
      id: session.id,
      deviceLabel: session.deviceLabel,
      browser: session.browser,
      os: session.os,
      deviceType: session.deviceType,
      location: session.location,
      ipAddress: session.ipAddress,
      createdAt: session.createdAt,
      lastActiveAt: session.lastActiveAt,
    }));

  const { error: updateError } = await params.supabase.auth.updateUser({
    data: {
      ...metadata,
      active_sessions: remainingSessions,
      revoked_session_ids: nextRevokedIds,
    },
  });

  if (updateError) {
    return {
      ok: false,
      status: 500,
      message: updateError.message || "Failed to revoke active session.",
    };
  }

  if (targetSession.isCurrent) {
    await params.supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
  } else {
    // Also terminate remote Supabase refresh tokens when revoking another device.
    await params.supabase.auth.signOut({ scope: "others" }).catch(() => undefined);
  }

  return {
    ok: true,
    revokedSessionId: targetId,
    revokedCurrentSession: targetSession.isCurrent,
    sessions: currentData.sessions.filter((s) => s.id !== targetId),
  };
}

export function createWebAuthnChallenge(): string {
  return randomBytes(32).toString("base64url");
}

export async function saveEnrolledPasskey(params: {
  supabase: SupabaseClient<Database>;
  user: User;
  credentialId: string;
  name: string;
  provider?: "supabase" | "webauthn";
}): Promise<
  | { ok: true; passkey: EnrolledPasskey; passkeys: EnrolledPasskey[] }
  | { ok: false; status: number; message: string }
> {
  const credentialId = params.credentialId.trim();
  const name = params.name.trim();
  if (!credentialId) {
    return {
      ok: false,
      status: 400,
      message: "Passkey credential ID is required.",
    };
  }
  if (!name) {
    return {
      ok: false,
      status: 400,
      message: "Passkey name is required.",
    };
  }

  const metadata = (params.user.user_metadata ?? {}) as Record<string, unknown>;
  const existing = normalizeStoredPasskeys(metadata.passkeys);
  const nowIso = new Date().toISOString();

  const already = existing.find((p) => p.credentialId === credentialId);
  const passkey: EnrolledPasskey = already ?? {
    id: `pk-${randomBytes(8).toString("hex")}`,
    credentialId,
    name: name.slice(0, 80),
    createdAt: nowIso,
    lastUsedAt: nowIso,
    provider: params.provider === "supabase" ? "supabase" : "webauthn",
  };

  const nextPasskeys = already
    ? existing
    : [passkey, ...existing].slice(0, 10);

  const { error: updateError } = await params.supabase.auth.updateUser({
    data: {
      ...metadata,
      passkeys: nextPasskeys,
    },
  });

  if (updateError) {
    return {
      ok: false,
      status: 500,
      message: updateError.message || "Failed to save enrolled passkey.",
    };
  }

  return {
    ok: true,
    passkey,
    passkeys: nextPasskeys,
  };
}

export async function removeEnrolledPasskey(params: {
  supabase: SupabaseClient<Database>;
  user: User;
  passkeyId: string;
}): Promise<
  | { ok: true; removedPasskeyId: string; passkeys: EnrolledPasskey[] }
  | { ok: false; status: number; message: string }
> {
  const targetId = params.passkeyId.trim();
  if (!targetId) {
    return { ok: false, status: 400, message: "Passkey ID is required." };
  }

  const metadata = (params.user.user_metadata ?? {}) as Record<string, unknown>;
  const existing = normalizeStoredPasskeys(metadata.passkeys);
  if (!existing.some((p) => p.id === targetId)) {
    return { ok: false, status: 404, message: "Passkey not found." };
  }

  const nextPasskeys = existing.filter((p) => p.id !== targetId);
  const { error: updateError } = await params.supabase.auth.updateUser({
    data: {
      ...metadata,
      passkeys: nextPasskeys,
    },
  });

  if (updateError) {
    return {
      ok: false,
      status: 500,
      message: updateError.message || "Failed to remove passkey.",
    };
  }

  return {
    ok: true,
    removedPasskeyId: targetId,
    passkeys: nextPasskeys,
  };
}
