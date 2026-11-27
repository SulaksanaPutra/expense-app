import fs from "node:fs";
import path from "node:path";
import type { BrowserContext } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const CHUNK_SIZE = 3180;

function loadEnvLocal(): Record<string, string> {
  const envPath = path.resolve(process.cwd(), ".env.local");
  const out: Record<string, string> = {};
  if (!fs.existsSync(envPath)) return out;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx <= 0) continue;
    out[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim();
  }
  return out;
}

export function getSupabaseConfig() {
  const fileEnv = loadEnvLocal();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || fileEnv.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || fileEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY || fileEnv.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !anonKey || !serviceKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, or SUPABASE_SERVICE_ROLE_KEY for E2E.",
    );
  }
  const projectRef = new URL(url).hostname.split(".")[0];
  return { url, anonKey, serviceKey, projectRef };
}

export function createAdminSupabase() {
  const { url, serviceKey } = getSupabaseConfig();
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function ensureE2EUser(email: string, fullName: string) {
  const admin = createAdminSupabase();
  const { data: listed, error: listErr } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  });
  if (listErr) throw listErr;

  let user = listed.users.find(
    (u) => u.email?.toLowerCase() === email.toLowerCase(),
  );

  if (!user) {
    const { data: created, error: createErr } =
      await admin.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: { full_name: fullName },
      });
    if (createErr || !created.user) {
      throw createErr || new Error("Failed to create E2E user");
    }
    user = created.user;
  }

  const { error: upsertErr } = await admin.from("users").upsert(
    {
      id: user.id,
      email,
      full_name: fullName,
    },
    { onConflict: "id" },
  );
  if (upsertErr) throw upsertErr;

  return user;
}

export async function authenticateContextAsUser(
  context: BrowserContext,
  baseUrl: string,
  email: string,
) {
  const { url, anonKey, projectRef } = getSupabaseConfig();
  const admin = createAdminSupabase();

  const { data: linkData, error: linkErr } =
    await admin.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
  if (linkErr || !linkData?.properties?.hashed_token) {
    throw linkErr || new Error("Failed to generate magiclink token");
  }

  const anonClient = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: otpData, error: otpErr } = await anonClient.auth.verifyOtp({
    token_hash: linkData.properties.hashed_token,
    type: "magiclink",
  });
  if (otpErr || !otpData.session) {
    throw otpErr || new Error("Failed to verify generated OTP for E2E session");
  }

  const cookieName = `sb-${projectRef}-auth-token`;
  const encoded = `base64-${Buffer.from(JSON.stringify(otpData.session), "utf8").toString("base64url")}`;
  const originUrl = new URL(baseUrl);

  const cookies: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    httpOnly: boolean;
    sameSite: "Lax";
    secure: boolean;
  }> = [];

  if (encoded.length <= CHUNK_SIZE) {
    cookies.push({
      name: cookieName,
      value: encoded,
      domain: originUrl.hostname,
      path: "/",
      httpOnly: false,
      sameSite: "Lax",
      secure: originUrl.protocol === "https:",
    });
  } else {
    const chunks = Math.ceil(encoded.length / CHUNK_SIZE);
    for (let i = 0; i < chunks; i++) {
      cookies.push({
        name: `${cookieName}.${i}`,
        value: encoded.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE),
        domain: originUrl.hostname,
        path: "/",
        httpOnly: false,
        sameSite: "Lax",
        secure: originUrl.protocol === "https:",
      });
    }
  }

  await context.addCookies(cookies);
}

export async function cleanupE2EGroupsForUser(userId: string) {
  const admin = createAdminSupabase();
  const { data: ownedGroups } = await admin
    .from("groups")
    .select("id, name")
    .eq("created_by", userId)
    .ilike("name", "[E2E]%");

  if (!ownedGroups || ownedGroups.length === 0) return;

  const ids = ownedGroups.map((g) => g.id);
  await admin.from("group_audit_logs").delete().in("group_id", ids);
  await admin.from("group_members").delete().in("group_id", ids);
  await admin.from("groups").delete().in("id", ids);
}
