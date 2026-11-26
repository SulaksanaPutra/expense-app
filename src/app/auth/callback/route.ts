import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  DEFAULT_AUTH_REDIRECT,
  resolveRedirectParam,
} from "@/lib/auth/redirects";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const oauthError = requestUrl.searchParams.get("error");
  const errorDescription = requestUrl.searchParams.get("error_description");
  const nextPath = resolveRedirectParam(
    requestUrl.searchParams,
    DEFAULT_AUTH_REDIRECT,
  );

  if (oauthError || !code) {
    const loginUrl = new URL("/login", requestUrl.origin);
    loginUrl.searchParams.set(
      "error",
      errorDescription || oauthError || "Authentication failed. Please try again.",
    );
    if (nextPath !== DEFAULT_AUTH_REDIRECT) {
      loginUrl.searchParams.set("next", nextPath);
    }
    return NextResponse.redirect(loginUrl);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    const loginUrl = new URL("/login", requestUrl.origin);
    loginUrl.searchParams.set(
      "error",
      "Your sign-in link is invalid or has expired. Please request a new one.",
    );
    if (nextPath !== DEFAULT_AUTH_REDIRECT) {
      loginUrl.searchParams.set("next", nextPath);
    }
    return NextResponse.redirect(loginUrl);
  }

  // Ensure a corresponding public.users profile row exists for RLS and foreign keys.
  const user = data?.user;
  if (user?.email && typeof supabase.from === "function") {
    try {
      const metadata = user.user_metadata as Record<string, unknown> | undefined;
      const metaFullName =
        typeof metadata?.full_name === "string"
          ? metadata.full_name.trim()
          : "";
      const metaName =
        typeof metadata?.name === "string" ? metadata.name.trim() : "";
      const fallbackName = user.email.split("@")[0] || "LedgerSplit User";

      await supabase.from("users").upsert(
        {
          id: user.id,
          email: user.email,
          full_name: metaFullName || metaName || fallbackName,
        },
        { onConflict: "id", ignoreDuplicates: true },
      );
    } catch {
      // Non-blocking: profile sync can also be completed in settings.
    }
  }

  return NextResponse.redirect(new URL(nextPath, requestUrl.origin));
}
