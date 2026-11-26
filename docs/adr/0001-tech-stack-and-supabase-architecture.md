# ADR-0001: Tech Stack and Supabase Backend Architecture

- **Status:** Accepted
- **Date:** 2026-11-26

## Context

LedgerSplit is a multi-user shared expense and roommate ledger web application requiring persistent relational storage, group-isolated access control, real-time balance synchronization ("Live Sync"), receipt file storage (500 MB per-user quota), and scheduled recurring expense generation.

## Decision

1. **Frontend / Full-Stack Framework:** Next.js (App Router, React, TypeScript, Tailwind CSS) deployed on Vercel. Server Components handle persistent navigation chrome and initial data hydration; Client Components handle interactive modals, segmented controls, and optimistic/live balance updates.
2. **Database & Auth:** Postgres via Supabase with Row-Level Security (RLS) enforcing strict per-group membership isolation and Admin vs. Member permission boundaries.
3. **Authentication & Onboarding:** Passwordless magic link and Google OAuth via Supabase Auth. Group invite URLs (`/join/[slug]?token=...`) carry signed invite tokens that bind newly authenticated users to the target group.
4. **Realtime & Storage:** Supabase Realtime subscriptions power the header `Live Sync` indicator and live ledger updates. S3-compatible Supabase Storage hosts uploaded receipt attachments, tracked against each user's 500 MB storage quota.
5. **Scheduled Jobs:** Supabase `pg_cron` or Vercel Cron executes daily recurring-expense materialization (`RecurringRule` → `Expense`) and automated group archival checks (`Archive Rules`).

## Consequences

- **Positive:** Single-vendor managed Postgres, Auth, Realtime, and Storage reduces operational overhead while enforcing group boundaries directly at the database layer via RLS.
- **Negative:** Requires careful RLS policy design and server-side validation for financial invariants (locking, penny rounding, pairwise watermarks) so client state cannot bypass ledger rules.
