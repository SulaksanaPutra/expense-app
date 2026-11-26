import { Button, Card, CardDescription, CardHeader, CardTitle } from "@/components/ui";

export interface ProtectedRoutePlaceholderProps {
  title: string;
  description: string;
  userEmail?: string;
}

export function ProtectedRoutePlaceholder({
  title,
  description,
  userEmail,
}: ProtectedRoutePlaceholderProps) {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl items-center justify-center px-4 py-12">
      <Card padding="lg" className="w-full">
        <CardHeader>
          <div>
            <CardTitle>{title}</CardTitle>
            <CardDescription className="mt-1">{description}</CardDescription>
            {userEmail && (
              <p className="mt-2 text-[13px] text-ink-muted-80">
                Signed in as {userEmail}
              </p>
            )}
          </div>
          <form action="/auth/signout" method="POST">
            <Button type="submit" variant="secondary" size="sm">
              Sign out
            </Button>
          </form>
        </CardHeader>
      </Card>
    </main>
  );
}
