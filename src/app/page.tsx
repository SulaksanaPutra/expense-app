export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center px-6 py-12">
      <section className="w-full rounded-card border border-hairline bg-canvas p-8">
        <div className="mb-3 inline-flex items-center rounded-pill border border-hairline bg-canvas-parchment px-3 py-1 text-xs font-semibold uppercase tracking-wider text-ink-muted-48">
          LedgerSplit
        </div>
        <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">
          Shared Expense Ledger
        </h1>
        <p className="mt-3 text-[17px] leading-[1.47] text-ink-muted-80">
          Group-isolated expense tracking, deterministic cent-exact splits, and
          immutable settlement records.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <span className="inline-flex items-center rounded-pill bg-primary px-5 py-2.5 text-sm font-medium text-on-primary">
            Ready for App Shell
          </span>
        </div>
      </section>
    </main>
  );
}
