import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { sanitizeRedirectPath } from "./redirects";

export function hasSupabaseEnv(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

export async function getAuthenticatedUser(): Promise<User | null> {
  // Opt into per-request dynamic rendering even when env vars are unset at build time.
  await cookies();

  if (!hasSupabaseEnv()) {
    return null;
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user ?? null;
}

export async function requireAuthenticatedUser(
  currentPath?: string,
): Promise<User> {
  const user = await getAuthenticatedUser();
  if (!user) {
    const safeNext = currentPath
      ? sanitizeRedirectPath(currentPath, "")
      : "";
    if (safeNext) {
      redirect(`/login?next=${encodeURIComponent(safeNext)}`);
    }
    redirect("/login");
  }

  return user;
}
