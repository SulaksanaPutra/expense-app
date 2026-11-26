import { ProtectedRoutePlaceholder } from "@/components/auth/ProtectedRoutePlaceholder";
import { requireAuthenticatedUser } from "@/lib/auth/guards";

export default async function SplitGroupsPage() {
  const user = await requireAuthenticatedUser("/split-groups");

  return (
    <ProtectedRoutePlaceholder
      title="Split Groups"
      description="Active household groups, split ratios, and member invitations."
      userEmail={user.email ?? undefined}
    />
  );
}
