import { Card } from "@/components/ui";

export default function SplitGroupsLoading() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading split groups"
      className="flex flex-col gap-8 pb-12"
    >
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div className="flex flex-col gap-2">
          <div className="h-3 w-40 animate-pulse rounded-full bg-hairline" />
          <div className="h-8 w-52 animate-pulse rounded-md bg-hairline" />
          <div className="h-4 w-80 max-w-full animate-pulse rounded-md bg-hairline/70" />
        </div>
        <div className="flex items-center gap-2.5">
          <div className="h-10 w-32 animate-pulse rounded-pill bg-hairline" />
          <div className="h-10 w-40 animate-pulse rounded-pill bg-hairline" />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {[0, 1, 2].map((idx) => (
          <Card key={idx} variant="section" padding="md" className="h-72">
            <div className="flex h-full flex-col justify-between">
              <div className="space-y-3">
                <div className="h-5 w-32 animate-pulse rounded-pill bg-hairline" />
                <div className="h-6 w-48 animate-pulse rounded-md bg-hairline" />
                <div className="h-4 w-56 animate-pulse rounded-md bg-hairline/70" />
              </div>
              <div className="h-24 w-full animate-pulse rounded-[14px] bg-canvas-parchment" />
              <div className="h-9 w-full animate-pulse rounded-pill bg-hairline" />
            </div>
          </Card>
        ))}
      </div>

      <span className="sr-only">Loading split groups...</span>
    </div>
  );
}
