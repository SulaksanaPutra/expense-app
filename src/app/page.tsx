import { redirect } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/auth/guards";
import { DEFAULT_AUTH_REDIRECT } from "@/lib/auth/redirects";

export default async function HomePage() {
  const user = await getAuthenticatedUser();
  if (user) {
    redirect(DEFAULT_AUTH_REDIRECT);
  }
  redirect("/login");
}
