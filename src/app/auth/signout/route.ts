import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sanitizeRedirectPath } from "@/lib/auth/redirects";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();

  const requestUrl = new URL(request.url);
  const rawNext =
    requestUrl.searchParams.get("next") ??
    requestUrl.searchParams.get("redirect");
  const redirectTarget = sanitizeRedirectPath(rawNext, "/login");

  const finalTarget =
    redirectTarget === "/dashboard" && !rawNext ? "/login" : redirectTarget;

  return NextResponse.redirect(new URL(finalTarget, requestUrl.origin), {
    status: 303,
  });
}
