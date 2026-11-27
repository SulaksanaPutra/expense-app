import * as React from "react";
import { Button, Card, CardDescription, CardHeader, CardTitle } from "@/components/ui";

export interface ProtectedRoutePlaceholderProps {
  title: string;
  description: string;
  userEmail?: string;
  titleBadge?: React.ReactNode;
}

export function ProtectedRoutePlaceholder({
  title,
  description,
  userEmail,
  titleBadge,
}: ProtectedRoutePlaceholderProps) {
  return (
    <section className="mx-auto w-full max-w-3xl py-4">
      <Card padding="lg" className="w-full">
        <CardHeader>
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <CardTitle>{title}</CardTitle>
              {titleBadge}
            </div>
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
    </section>
  );
}
