import { ProtectedRoutePlaceholder } from "@/components/auth/ProtectedRoutePlaceholder";
import { requireAuthenticatedUser } from "@/lib/auth/guards";

export default async function SettingsPage() {
  const user = await requireAuthenticatedUser("/settings");

  return (
    <ProtectedRoutePlaceholder
      title="Settings"
      description="Profile preferences, settlement handles, notifications, and storage quota."
      userEmail={user.email ?? undefined}
    />
  );
}
