import { JoinGroupClient } from "@/components/split-groups/JoinGroupClient";
import { getAuthenticatedUser, hasSupabaseEnv } from "@/lib/auth/guards";
import { verifySignedInviteToken } from "@/lib/groups/invite-token";
import { previewGroupInvite } from "@/lib/groups/onboarding";
import { createAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

interface JoinGroupPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function JoinGroupPage({
  params,
  searchParams,
}: JoinGroupPageProps) {
  const { slug } = await params;
  const resolvedSearchParams = await searchParams;
  const rawToken = resolvedSearchParams.token;
  const token =
    typeof rawToken === "string"
      ? rawToken
      : Array.isArray(rawToken) && typeof rawToken[0] === "string"
        ? rawToken[0]
        : "";

  const verifiedToken = verifySignedInviteToken({
    token,
    expectedSlug: slug,
  });

  if (!verifiedToken.ok) {
    return (
      <main className="flex min-h-screen w-full items-center justify-center bg-canvas-parchment px-4 py-12">
        <JoinGroupClient
          state={{
            status: "invalid",
            code: verifiedToken.code,
            message: verifiedToken.message,
            slug,
          }}
        />
      </main>
    );
  }

  if (!hasSupabaseEnv() || !hasSupabaseAdminEnv()) {
    return (
      <main className="flex min-h-screen w-full items-center justify-center bg-canvas-parchment px-4 py-12">
        <JoinGroupClient
          state={{
            status: "invalid",
            code: "SERVER_CONFIG_ERROR",
            message:
              "Invite onboarding requires Supabase service configuration on the server.",
            slug,
          }}
        />
      </main>
    );
  }

  const [user, adminSupabase] = await Promise.all([
    getAuthenticatedUser(),
    Promise.resolve(createAdminClient()),
  ]);

  const preview = await previewGroupInvite(adminSupabase, {
    slug,
    token,
    currentUserId: user?.id ?? null,
  });

  if (!preview.ok) {
    return (
      <main className="flex min-h-screen w-full items-center justify-center bg-canvas-parchment px-4 py-12">
        <JoinGroupClient
          state={{
            status: "invalid",
            code: preview.code,
            message: preview.message,
            slug,
          }}
        />
      </main>
    );
  }

  return (
    <main className="flex min-h-screen w-full items-center justify-center bg-canvas-parchment px-4 py-12">
      <JoinGroupClient
        state={{
          status: "valid",
          invite: preview.invite,
          token,
          isAuthenticated: Boolean(user),
          userEmail: user?.email ?? null,
        }}
      />
    </main>
  );
}
