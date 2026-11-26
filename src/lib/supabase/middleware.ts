import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/types/database";
import {
  buildLoginRedirectUrl,
  DEFAULT_AUTH_REDIRECT,
  isProtectedRoute,
  resolveRedirectParam,
} from "@/lib/auth/redirects";

function applyResponseCookies(
  source: NextResponse,
  target: NextResponse,
): NextResponse {
  source.cookies.getAll().forEach((cookie) => {
    target.cookies.set(cookie);
  });
  return target;
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const { pathname, search } = request.nextUrl;

  if (!supabaseUrl || !supabaseAnonKey) {
    if (isProtectedRoute(pathname)) {
      return NextResponse.redirect(
        buildLoginRedirectUrl(request.url, pathname, search),
      );
    }
    return supabaseResponse;
  }

  const supabase = createServerClient<Database>(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        supabaseResponse = NextResponse.next({
          request,
        });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options),
        );
      },
    },
  });

  // Refresh session if expired; required for Server Components.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && isProtectedRoute(pathname)) {
    const loginRedirect = NextResponse.redirect(
      buildLoginRedirectUrl(request.url, pathname, search),
    );
    return applyResponseCookies(supabaseResponse, loginRedirect);
  }

  if (user && pathname === "/login") {
    const targetPath = resolveRedirectParam(
      request.nextUrl.searchParams,
      DEFAULT_AUTH_REDIRECT,
    );
    const appRedirect = NextResponse.redirect(
      new URL(targetPath, request.url),
    );
    return applyResponseCookies(supabaseResponse, appRedirect);
  }

  return supabaseResponse;
}
