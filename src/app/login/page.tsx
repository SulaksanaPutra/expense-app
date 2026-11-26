import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/LoginForm";
import { getAuthenticatedUser } from "@/lib/auth/guards";
import {
  DEFAULT_AUTH_REDIRECT,
  resolveRedirectParam,
} from "@/lib/auth/redirects";

interface LoginPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const nextPath = resolveRedirectParam(params, DEFAULT_AUTH_REDIRECT);
  const user = await getAuthenticatedUser();

  if (user) {
    redirect(nextPath);
  }

  const rawError = params.error;
  const initialError =
    typeof rawError === "string"
      ? rawError
      : Array.isArray(rawError) && typeof rawError[0] === "string"
        ? rawError[0]
        : undefined;

  return (
    <main className="flex min-h-screen w-full items-center justify-center bg-canvas-parchment px-4 py-12">
      <LoginForm nextPath={nextPath} initialError={initialError} />
    </main>
  );
}
