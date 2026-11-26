export const DEFAULT_AUTH_REDIRECT = "/dashboard";

export const PROTECTED_ROUTE_PREFIXES = [
  "/dashboard",
  "/expenses",
  "/split-groups",
  "/settings",
] as const;

export function isProtectedRoute(pathname: string): boolean {
  return PROTECTED_ROUTE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * Ensures redirect targets stay strictly on-origin relative paths and
 * cannot bounce back into auth endpoints or open external URLs.
 */
export function sanitizeRedirectPath(
  rawPath: string | null | undefined,
  fallback: string = DEFAULT_AUTH_REDIRECT,
): string {
  if (!rawPath) {
    return fallback;
  }

  const trimmed = rawPath.trim();
  if (
    !trimmed.startsWith("/") ||
    trimmed.startsWith("//") ||
    trimmed.includes("\\") ||
    /[\u0000-\u001F\u007F]/.test(trimmed)
  ) {
    return fallback;
  }

  try {
    const parsed = new URL(trimmed, "http://localhost");
    if (parsed.origin !== "http://localhost") {
      return fallback;
    }

    if (
      parsed.pathname === "/login" ||
      parsed.pathname.startsWith("/auth/")
    ) {
      return fallback;
    }

    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}

type SearchParamsLike =
  | { get(name: string): string | null }
  | Record<string, string | string[] | undefined>;

function readParam(params: SearchParamsLike, key: string): string | null {
  if (typeof (params as { get?: unknown }).get === "function") {
    return (params as { get(name: string): string | null }).get(key);
  }
  const value = (params as Record<string, string | string[] | undefined>)[key];
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value) && typeof value[0] === "string") {
    return value[0];
  }
  return null;
}

export function resolveRedirectParam(
  params: SearchParamsLike,
  fallback: string = DEFAULT_AUTH_REDIRECT,
): string {
  const raw = readParam(params, "next") ?? readParam(params, "redirect");
  return sanitizeRedirectPath(raw, fallback);
}

export function buildLoginRedirectUrl(
  requestUrl: string | URL,
  pathname: string,
  search: string = "",
): URL {
  const loginUrl = new URL("/login", requestUrl);
  const fullTarget = `${pathname}${search}`;
  const safeTarget = sanitizeRedirectPath(fullTarget, "");
  if (safeTarget) {
    loginUrl.searchParams.set("next", safeTarget);
  }
  return loginUrl;
}
