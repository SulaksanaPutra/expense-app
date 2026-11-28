"use client";

import * as React from "react";
import { KeyRound, Monitor, Plus, Smartphone, Trash2 } from "lucide-react";
import {
  AlertBanner,
  Badge,
  Button,
  Card,
  ConfirmDialog,
} from "@/components/ui";
import type { ToastItem } from "@/components/ui";
import type {
  ActiveDeviceSession,
  EnrolledPasskey,
  SecuritySessionsData,
} from "@/lib/settings/security";
import { createClient } from "@/lib/supabase/client";

export interface SecuritySessionsCardProps {
  initialData: SecuritySessionsData;
  onToast?: (toast: Omit<ToastItem, "id">) => void;
}

function GoogleMark() {
  return (
    <svg
      className="h-4 w-4 shrink-0"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
      />
    </svg>
  );
}

function base64UrlToUint8Array(input: string): Uint8Array<ArrayBuffer> {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const padLen = (4 - (padded.length % 4)) % 4;
  const normalized = padded + "=".repeat(padLen);
  const binary = atob(normalized);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function stringToUint8Array(input: string): Uint8Array<ArrayBuffer> {
  const encoded = new TextEncoder().encode(input);
  const buffer = new ArrayBuffer(encoded.byteLength);
  const bytes = new Uint8Array(buffer);
  bytes.set(encoded);
  return bytes;
}

function formatRelativeTime(isoString: string): string {
  const parsed = new Date(isoString);
  if (Number.isNaN(parsed.getTime())) return "Recently active";
  const diffMs = Date.now() - parsed.getTime();
  if (diffMs < 60_000) return "Just now";
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}

function formatShortDate(isoString: string): string {
  const parsed = new Date(isoString);
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(parsed);
}

function defaultPasskeyName(): string {
  if (typeof navigator === "undefined") return "Browser Passkey";
  const ua = navigator.userAgent || "";
  if (/iPhone/i.test(ua)) return "iPhone Passkey";
  if (/iPad/i.test(ua)) return "iPad Passkey";
  if (/Macintosh|Mac OS X/i.test(ua)) return "Mac Touch ID Passkey";
  if (/Windows/i.test(ua)) return "Windows Hello Passkey";
  if (/Android/i.test(ua)) return "Android Passkey";
  return "Device Passkey";
}

function isSupabasePasskeyUnavailableError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("not enabled") ||
    lower.includes("disabled") ||
    lower.includes("not found") ||
    lower.includes("404") ||
    lower.includes("501") ||
    lower.includes("unsupported") ||
    lower.includes("webauthn")
  );
}

export function SecuritySessionsCard({
  initialData,
  onToast,
}: SecuritySessionsCardProps) {
  const [sessions, setSessions] = React.useState<ActiveDeviceSession[]>(
    initialData.sessions,
  );
  const [passkeys, setPasskeys] = React.useState<EnrolledPasskey[]>(
    initialData.passkeys,
  );
  const [enrollingPasskey, setEnrollingPasskey] = React.useState(false);
  const [removingPasskeyId, setRemovingPasskeyId] = React.useState<
    string | null
  >(null);
  const [revokeTarget, setRevokeTarget] =
    React.useState<ActiveDeviceSession | null>(null);
  const [revokingSession, setRevokingSession] = React.useState(false);
  const [securityError, setSecurityError] = React.useState<string | null>(null);

  const handleAddPasskey = async () => {
    setSecurityError(null);

    if (
      typeof window === "undefined" ||
      !("PublicKeyCredential" in window) ||
      typeof navigator === "undefined" ||
      !navigator.credentials?.create
    ) {
      setSecurityError(
        "Passkeys (WebAuthn) are not supported in this browser or device.",
      );
      return;
    }

    setEnrollingPasskey(true);
    const friendlyName = defaultPasskeyName();

    try {
      // 1. Attempt native Supabase Auth passkey registration when available.
      let usedSupabaseNative = false;
      try {
        const supabase = createClient() as unknown as {
          auth?: {
            registerPasskey?: (opts?: {
              friendlyName?: string;
            }) => Promise<{
              data?: { passkey?: { id?: string; friendly_name?: string } } | null;
              error?: { message?: string } | null;
            }>;
          };
        };

        if (typeof supabase?.auth?.registerPasskey === "function") {
          const nativeRes = await supabase.auth.registerPasskey({
            friendlyName,
          });
          if (!nativeRes.error) {
            usedSupabaseNative = true;
            const credentialId =
              nativeRes.data?.passkey?.id || `sb-pk-${Date.now()}`;
            const saveRes = await fetch("/api/settings/passkeys", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                credentialId,
                name: nativeRes.data?.passkey?.friendly_name || friendlyName,
                provider: "supabase",
              }),
            });
            const savePayload = (await saveRes.json().catch(() => ({}))) as {
              ok?: boolean;
              passkeys?: EnrolledPasskey[];
            };
            if (saveRes.ok && Array.isArray(savePayload.passkeys)) {
              setPasskeys(savePayload.passkeys);
            } else {
              setPasskeys((prev) => [
                {
                  id: credentialId,
                  credentialId,
                  name: friendlyName,
                  createdAt: new Date().toISOString(),
                  lastUsedAt: new Date().toISOString(),
                  provider: "supabase",
                },
                ...prev,
              ]);
            }
          } else if (
            nativeRes.error.message &&
            !isSupabasePasskeyUnavailableError(nativeRes.error.message)
          ) {
            throw new Error(nativeRes.error.message);
          }
        }
      } catch (nativeErr) {
        if (
          nativeErr instanceof Error &&
          (nativeErr.name === "NotAllowedError" ||
            nativeErr.name === "AbortError")
        ) {
          throw nativeErr;
        }
        // Fall through to standard WebAuthn ceremony if Supabase native passkey endpoint is disabled.
      }

      // 2. Fallback to standard WebAuthn navigator.credentials.create + server registration API.
      if (!usedSupabaseNative) {
        const challengeRes = await fetch("/api/settings/passkeys", {
          method: "GET",
        });
        const challengePayload = (await challengeRes
          .json()
          .catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
          challenge?: string;
          rp?: { id?: string; name?: string };
          user?: { id?: string; name?: string; displayName?: string };
        };

        if (
          !challengeRes.ok ||
          !challengePayload.challenge ||
          !challengePayload.user?.id
        ) {
          throw new Error(
            challengePayload.error ||
              "Unable to initialize WebAuthn passkey challenge.",
          );
        }

        const publicKeyOptions: PublicKeyCredentialCreationOptions = {
          challenge: base64UrlToUint8Array(challengePayload.challenge),
          rp: {
            name: challengePayload.rp?.name || "LedgerSplit",
            id: challengePayload.rp?.id || window.location.hostname,
          },
          user: {
            id: stringToUint8Array(challengePayload.user.id),
            name: challengePayload.user.name || initialData.sso.email,
            displayName:
              challengePayload.user.displayName || initialData.sso.email,
          },
          pubKeyCredParams: [
            { type: "public-key", alg: -7 },
            { type: "public-key", alg: -257 },
          ],
          authenticatorSelection: {
            residentKey: "preferred",
            userVerification: "preferred",
          },
          timeout: 60_000,
          attestation: "none",
        };

        const credential = await navigator.credentials.create({
          publicKey: publicKeyOptions,
        });

        if (!credential || !credential.id) {
          throw new Error("No passkey credential was returned by your device.");
        }

        const registerRes = await fetch("/api/settings/passkeys", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            credentialId: credential.id,
            name: friendlyName,
            provider: "webauthn",
          }),
        });
        const registerPayload = (await registerRes
          .json()
          .catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
          passkeys?: EnrolledPasskey[];
        };

        if (!registerRes.ok || !Array.isArray(registerPayload.passkeys)) {
          throw new Error(
            registerPayload.error || "Unable to save enrolled passkey.",
          );
        }

        setPasskeys(registerPayload.passkeys);
      }

      onToast?.({
        tone: "success",
        title: "Passkey enrolled",
        description: `${friendlyName} is now active for passwordless sign-in.`,
      });
    } catch (error) {
      if (
        error instanceof Error &&
        (error.name === "NotAllowedError" || error.name === "AbortError")
      ) {
        setSecurityError("Passkey enrollment was cancelled or timed out.");
      } else {
        setSecurityError(
          error instanceof Error
            ? error.message
            : "Unable to enroll passkey. Please try again.",
        );
      }
    } finally {
      setEnrollingPasskey(false);
    }
  };

  const handleRemovePasskey = async (passkey: EnrolledPasskey) => {
    setSecurityError(null);
    setRemovingPasskeyId(passkey.id);
    try {
      const res = await fetch("/api/settings/passkeys", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passkeyId: passkey.id }),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        passkeys?: EnrolledPasskey[];
      };
      if (!res.ok || !Array.isArray(payload.passkeys)) {
        setSecurityError(payload.error || "Unable to remove passkey.");
        return;
      }
      setPasskeys(payload.passkeys);
      onToast?.({
        tone: "info",
        title: "Passkey removed",
        description: `${passkey.name} has been removed from your account.`,
      });
    } catch {
      setSecurityError("Network error while removing passkey.");
    } finally {
      setRemovingPasskeyId(null);
    }
  };

  const handleConfirmRevoke = async () => {
    if (!revokeTarget) return;
    setSecurityError(null);
    setRevokingSession(true);
    try {
      const res = await fetch("/api/settings/sessions", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: revokeTarget.id }),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        sessions?: ActiveDeviceSession[];
      };

      if (!res.ok) {
        setSecurityError(
          payload.error || "Unable to revoke the selected session.",
        );
        setRevokingSession(false);
        return;
      }

      if (Array.isArray(payload.sessions)) {
        setSessions(payload.sessions);
      } else {
        setSessions((prev) => prev.filter((s) => s.id !== revokeTarget.id));
      }

      const revokedLabel = revokeTarget.deviceLabel;
      setRevokeTarget(null);
      setRevokingSession(false);
      onToast?.({
        tone: "success",
        title: "Session revoked",
        description: `${revokedLabel} has been signed out.`,
      });
    } catch {
      setSecurityError("Network error while revoking active session.");
      setRevokingSession(false);
    }
  };

  return (
    <Card
      variant="section"
      padding="lg"
      data-testid="security-sessions-card"
      className="flex flex-col gap-5"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-[17px] font-semibold tracking-tight text-ink">
            Security &amp; Active Sessions
          </h2>
          <p className="mt-0.5 text-[12px] text-ink-muted-48">
            Manage authentication credentials and active browser sessions.
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          loading={enrollingPasskey}
          leftIcon={<Plus className="h-3.5 w-3.5" aria-hidden="true" />}
          onClick={handleAddPasskey}
          className="shrink-0"
        >
          {enrollingPasskey ? "Enrolling..." : "Add Passkey"}
        </Button>
      </div>

      {securityError && (
        <AlertBanner
          tone="error"
          title="Security action failed"
          description={securityError}
          onDismiss={() => setSecurityError(null)}
        />
      )}

      {/* Google Workspace SSO Status */}
      <Card
        variant="sub-card"
        padding="sm"
        className="flex items-center justify-between gap-4 p-3.5"
      >
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-hairline bg-canvas">
            <GoogleMark />
          </div>
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold text-ink">
              {initialData.sso.providerLabel}
            </div>
            <div className="truncate text-[11px] text-ink-muted-48">
              {initialData.sso.googleConnected
                ? `Connected as ${initialData.sso.email} · 2FA Enforced`
                : `Signed in as ${initialData.sso.email} · Email & Passkey Auth`}
            </div>
          </div>
        </div>
        <Badge
          tone={initialData.sso.googleConnected ? "success" : "neutral"}
          size="sm"
          className="shrink-0"
        >
          {initialData.sso.statusLabel}
        </Badge>
      </Card>

      {/* Enrolled Passkeys */}
      {passkeys.length > 0 && (
        <div className="flex flex-col gap-2" data-testid="enrolled-passkeys-list">
          <div className="text-[12px] font-semibold tracking-wider text-ink-muted-48 uppercase">
            Enrolled Passkeys
          </div>
          {passkeys.map((pk) => (
            <Card
              key={pk.id}
              variant="sub-card"
              padding="sm"
              className="flex items-center justify-between gap-3 p-3.5"
            >
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-hairline bg-canvas text-[#0066cc]">
                  <KeyRound className="h-4 w-4" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-medium text-ink">
                    {pk.name}
                  </div>
                  <div className="truncate text-[11px] text-ink-muted-48 tabular-nums">
                    Added {formatShortDate(pk.createdAt) || "recently"}
                  </div>
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                loading={removingPasskeyId === pk.id}
                aria-label={`Remove ${pk.name}`}
                onClick={() => handleRemovePasskey(pk)}
                className="h-7 shrink-0 px-2 text-[12px] text-[#dc2626] hover:bg-red-50 hover:text-[#b91c1c]"
                leftIcon={<Trash2 className="h-3.5 w-3.5" aria-hidden="true" />}
              >
                Remove
              </Button>
            </Card>
          ))}
        </div>
      )}

      {/* Active Devices */}
      <div className="flex flex-col gap-2" data-testid="active-devices-list">
        <div className="text-[12px] font-semibold tracking-wider text-ink-muted-48 uppercase">
          Active Devices
        </div>

        {sessions.map((session) => (
          <Card
            key={session.id}
            variant="sub-card"
            padding="sm"
            data-testid={`active-device-${session.id}`}
            className="flex items-center justify-between gap-4 p-3.5"
          >
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-hairline bg-canvas text-ink-muted-48">
                {session.deviceType === "mobile" ? (
                  <Smartphone className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Monitor className="h-4 w-4" aria-hidden="true" />
                )}
              </div>
              <div className="min-w-0">
                <div className="truncate text-[13px] font-medium text-ink">
                  {session.deviceLabel}
                </div>
                <div className="truncate text-[11px] text-ink-muted-48 tabular-nums">
                  {session.isCurrent
                    ? `${session.location} · IP ${session.ipAddress}`
                    : `${session.location} · ${formatRelativeTime(session.lastActiveAt)}`}
                </div>
              </div>
            </div>

            {session.isCurrent ? (
              <Badge tone="success" size="sm" className="shrink-0">
                This device
              </Badge>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setRevokeTarget(session)}
                className="h-7 shrink-0 px-2 text-[12px] font-medium !text-[#dc2626] hover:bg-red-50 hover:!text-[#b91c1c]"
              >
                Revoke
              </Button>
            )}
          </Card>
        ))}
      </div>

      {/* Revoke Session Confirmation */}
      <ConfirmDialog
        open={Boolean(revokeTarget)}
        onClose={() => {
          if (!revokingSession) setRevokeTarget(null);
        }}
        onConfirm={handleConfirmRevoke}
        title="Revoke Active Session?"
        description={
          revokeTarget
            ? `Revoking ${revokeTarget.deviceLabel} will immediately terminate that session and require signing in again on that device.`
            : ""
        }
        confirmLabel="Revoke Session"
        cancelLabel="Cancel"
        variant="danger"
        loading={revokingSession}
      />
    </Card>
  );
}
