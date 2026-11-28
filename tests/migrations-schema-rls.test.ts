import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATIONS_DIR = path.resolve(__dirname, "../supabase/migrations");
const V2_MIGRATION_FILE = path.join(
  MIGRATIONS_DIR,
  "20261128000002_v2_schema_migration.sql",
);

function loadAllMigrations(): string {
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  return files
    .map((f) => fs.readFileSync(path.join(MIGRATIONS_DIR, f), "utf8"))
    .join("\n\n");
}

function loadV2Migration(): string {
  return fs.readFileSync(V2_MIGRATION_FILE, "utf8");
}

function extractTableBlock(sql: string, tableName: string): string {
  const regex = new RegExp(
    `CREATE TABLE (?:IF NOT EXISTS )?public\\.${tableName}\\s*\\(([\\s\\S]*?)\\n\\);`,
    "i",
  );
  const match = sql.match(regex);
  expect(match, `Table public.${tableName} must exist`).not.toBeNull();
  return match![1];
}

const ACTIVE_V2_TABLES = [
  "users",
  "settlement_handles",
  "groups",
  "group_members",
  "group_invites",
  "expenses",
  "expense_revisions",
  "settlements",
  "billing_cycles",
  "reminder_logs",
  "group_audit_logs",
  "notifications",
] as const;

describe("Supabase Postgres Schema & RLS Migrations (v2)", () => {
  const fullSql = loadAllMigrations();
  const v2Sql = loadV2Migration();

  it("creates all 12 active v2 domain tables", () => {
    for (const table of ACTIVE_V2_TABLES) {
      extractTableBlock(fullSql, table);
    }
  });

  it("forbids FLOAT, DOUBLE, and REAL column types across all migrations", () => {
    expect(fullSql).not.toMatch(/\b(FLOAT|FLOAT4|FLOAT8|DOUBLE|REAL)\b/i);
  });

  it("uses BIGINT for every *_cents monetary column paired with VARCHAR(3) currency code", () => {
    const monetaryTables: Array<{
      table: string;
      centsCols: string[];
      currencyCols: string[];
    }> = [
      {
        table: "users",
        centsCols: ["personal_share_cap_cents"],
        currencyCols: ["base_currency"],
      },
      {
        table: "groups",
        centsCols: ["operational_budget_cents"],
        currencyCols: ["base_currency"],
      },
      {
        table: "expenses",
        centsCols: ["amount_cents"],
        currencyCols: ["currency"],
      },
      {
        table: "settlements",
        centsCols: ["amount_cents"],
        currencyCols: ["currency"],
      },
    ];

    for (const { table, centsCols, currencyCols } of monetaryTables) {
      const block = extractTableBlock(fullSql, table);

      for (const col of centsCols) {
        const colRegex = new RegExp(`\\b${col}\\s+BIGINT\\b`, "i");
        expect(block, `${table}.${col} must be BIGINT`).toMatch(colRegex);
      }

      for (const curCol of currencyCols) {
        const curRegex = new RegExp(`\\b${curCol}\\s+VARCHAR\\(3\\)`, "i");
        expect(block, `${table}.${curCol} must be VARCHAR(3)`).toMatch(
          curRegex,
        );
      }
    }

    // v2 display_currency on users is VARCHAR(3) with ISO-4217 check
    expect(v2Sql).toMatch(
      /ADD COLUMN IF NOT EXISTS display_currency VARCHAR\(3\) NOT NULL DEFAULT 'USD'/i,
    );
  });

  it("enables Row-Level Security (ENABLE ROW LEVEL SECURITY) on all 12 active v2 tables", () => {
    for (const table of ACTIVE_V2_TABLES) {
      const rlsRegex = new RegExp(
        `ALTER TABLE public\\.${table}\\s+ENABLE ROW LEVEL SECURITY;`,
        "i",
      );
      expect(fullSql, `${table} must enable RLS`).toMatch(rlsRegex);
    }
  });

  it("cleanly drops recurring_rules and all deprecated v1 columns and RPCs in v2 migration", () => {
    expect(v2Sql).toMatch(/DROP TABLE IF EXISTS public\.recurring_rules CASCADE;/i);
    expect(v2Sql).toMatch(
      /DROP FUNCTION IF EXISTS public\.materialize_due_recurring_rules\(DATE\);/i,
    );
    expect(v2Sql).toMatch(
      /DROP FUNCTION IF EXISTS public\.reserve_receipt_storage_bytes\(BIGINT,\s*BIGINT\);/i,
    );
    expect(v2Sql).toMatch(
      /DROP FUNCTION IF EXISTS public\.release_receipt_storage_bytes\(BIGINT\);/i,
    );

    // Dropped expenses columns
    for (const col of [
      "original_amount_cents",
      "original_currency",
      "exchange_rate",
      "exchange_rate_source",
      "is_recurring_generated",
      "recurring_rule_id",
      "recurring_occurrence_date",
    ]) {
      expect(v2Sql, `expenses.${col} must be dropped`).toMatch(
        new RegExp(`DROP COLUMN IF EXISTS ${col}`, "i"),
      );
    }

    // Dropped users columns
    for (const col of ["receipt_storage_used_bytes", "instant_settlement_tag"]) {
      expect(v2Sql, `users.${col} must be dropped`).toMatch(
        new RegExp(`DROP COLUMN IF EXISTS ${col}`, "i"),
      );
    }

    // Dropped groups columns
    for (const col of ["simplify_debts", "lease_end_date"]) {
      expect(v2Sql, `groups.${col} must be dropped`).toMatch(
        new RegExp(`DROP COLUMN IF EXISTS ${col}`, "i"),
      );
    }
  });

  it("creates v2 settlement_handles and group_invites tables with RLS policies and constraints", () => {
    const handlesBlock = extractTableBlock(v2Sql, "settlement_handles");
    expect(handlesBlock).toMatch(/user_id UUID NOT NULL REFERENCES public\.users\(id\)/i);
    expect(handlesBlock).toMatch(/provider IN \('VENMO', 'ZELLE', 'CASH_APP'\)/i);
    expect(handlesBlock).toMatch(/handle TEXT NOT NULL/i);
    expect(handlesBlock).toMatch(/display_note TEXT/i);
    expect(handlesBlock).toMatch(/is_default BOOLEAN NOT NULL DEFAULT FALSE/i);

    expect(v2Sql).toMatch(
      /CREATE UNIQUE INDEX idx_settlement_handles_user_default[\s\S]*?ON public\.settlement_handles\(user_id\)[\s\S]*?WHERE is_default = TRUE/i,
    );
    expect(v2Sql).toMatch(
      /CREATE POLICY "settlement_handles_select_self_or_shared_group"[\s\S]*?ON public\.settlement_handles[\s\S]*?FOR SELECT/i,
    );
    expect(v2Sql).toMatch(
      /CREATE POLICY "settlement_handles_insert_own"[\s\S]*?ON public\.settlement_handles[\s\S]*?FOR INSERT/i,
    );
    expect(v2Sql).toMatch(
      /CREATE POLICY "settlement_handles_update_own"[\s\S]*?ON public\.settlement_handles[\s\S]*?FOR UPDATE/i,
    );
    expect(v2Sql).toMatch(
      /CREATE POLICY "settlement_handles_delete_own"[\s\S]*?ON public\.settlement_handles[\s\S]*?FOR DELETE/i,
    );

    const invitesBlock = extractTableBlock(v2Sql, "group_invites");
    expect(invitesBlock).toMatch(/group_id UUID NOT NULL REFERENCES public\.groups\(id\)/i);
    expect(invitesBlock).toMatch(/invited_email TEXT NOT NULL/i);
    expect(invitesBlock).toMatch(/invited_by UUID NOT NULL REFERENCES public\.users\(id\)/i);
    expect(invitesBlock).toMatch(/token TEXT NOT NULL UNIQUE/i);
    expect(invitesBlock).toMatch(
      /status IN \('PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED'\)/i,
    );

    expect(v2Sql).toMatch(
      /CREATE POLICY "group_invites_select_members"[\s\S]*?ON public\.group_invites[\s\S]*?public\.is_group_member\(group_id\)/i,
    );
    expect(v2Sql).toMatch(
      /CREATE POLICY "group_invites_insert_admin_only"[\s\S]*?ON public\.group_invites[\s\S]*?public\.is_group_admin\(group_id\)/i,
    );
    expect(v2Sql).toMatch(
      /CREATE POLICY "group_invites_update_admin_only"[\s\S]*?ON public\.group_invites[\s\S]*?public\.is_group_admin\(group_id\)/i,
    );
    expect(v2Sql).toMatch(
      /CREATE POLICY "group_invites_delete_admin_only"[\s\S]*?ON public\.group_invites[\s\S]*?public\.is_group_admin\(group_id\)/i,
    );
  });

  it("adds v2 columns on users, groups, group_members, expenses (SHARES), and settlements", () => {
    // User v2 columns
    expect(v2Sql).toMatch(/ADD COLUMN IF NOT EXISTS timezone TEXT/i);
    expect(v2Sql).toMatch(/ADD COLUMN IF NOT EXISTS display_currency VARCHAR\(3\)/i);
    expect(v2Sql).toMatch(
      /ADD COLUMN IF NOT EXISTS auto_include_in_expenses BOOLEAN NOT NULL DEFAULT TRUE/i,
    );

    // Group v2 columns
    expect(v2Sql).toMatch(
      /ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'OTHER'[\s\S]*?category IN \('HOME', 'TRIP', 'DINING', 'UTILITIES', 'OTHER'\)/i,
    );
    expect(v2Sql).toMatch(
      /ADD COLUMN IF NOT EXISTS cycle_reset_day INTEGER NOT NULL DEFAULT 1/i,
    );
    expect(v2Sql).toMatch(
      /ADD COLUMN IF NOT EXISTS auto_settle_on_reset BOOLEAN NOT NULL DEFAULT TRUE/i,
    );
    expect(v2Sql).toMatch(
      /ADD COLUMN IF NOT EXISTS allow_any_member_add_expense BOOLEAN NOT NULL DEFAULT TRUE/i,
    );
    expect(v2Sql).toMatch(
      /ADD COLUMN IF NOT EXISTS require_receipt_over_100 BOOLEAN NOT NULL DEFAULT FALSE/i,
    );
    expect(v2Sql).toMatch(
      /ADD COLUMN IF NOT EXISTS send_cycle_close_reminders BOOLEAN NOT NULL DEFAULT TRUE/i,
    );

    // GroupMember share_units for SHARES split mode
    expect(v2Sql).toMatch(
      /ADD COLUMN IF NOT EXISTS share_units NUMERIC\(10, 4\) NOT NULL DEFAULT 1\.0000/i,
    );

    // Expense SHARES split method & group policy enforcement
    expect(v2Sql).toMatch(
      /split_method IN \('EQUAL', 'PERCENTAGE', 'EXACT', 'SHARES'\)/i,
    );
    expect(v2Sql).toMatch(
      /CREATE POLICY "expenses_insert_active_member"[\s\S]*?g\.allow_any_member_add_expense = TRUE/i,
    );
    expect(v2Sql).toMatch(/v_require_receipt[\s\S]*?ABS\(NEW\.amount_cents\) > 10000/i);

    // Settlement v2 handle FK & payment rails
    expect(v2Sql).toMatch(
      /ADD COLUMN IF NOT EXISTS settlement_handle_id UUID REFERENCES public\.settlement_handles\(id\)/i,
    );
    expect(v2Sql).toMatch(/'AUTO_SETTLED'/i);
    expect(v2Sql).toMatch(/'ZELLE'/i);
    expect(v2Sql).toMatch(/'CASH_APP'/i);
    expect(v2Sql).toMatch(/'BANK_SETTLEMENT'/i);
  });

  it("defines group-isolation membership helpers covering ACTIVE and FORMER_MEMBER", () => {
    expect(fullSql).toMatch(/CREATE OR REPLACE FUNCTION public\.is_group_member/i);
    expect(fullSql).toMatch(/status IN \('ACTIVE', 'FORMER_MEMBER'\)/i);
    expect(fullSql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.is_active_group_member/i,
    );
    expect(fullSql).toMatch(/CREATE OR REPLACE FUNCTION public\.is_group_admin/i);
    expect(fullSql).toMatch(/role = 'ADMIN'/i);
  });

  it("enforces member departure balance guards and ARCHIVED read-only triggers", () => {
    expect(fullSql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.get_member_net_balance_cents/i,
    );
    expect(fullSql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.user_has_unsettled_group_balance/i,
    );
    expect(fullSql).toMatch(
      /ON public\.users[\s\S]*?FOR DELETE[\s\S]*?NOT public\.user_has_unsettled_group_balance/i,
    );
    expect(fullSql).toMatch(
      /ON public\.group_members[\s\S]*?FOR DELETE[\s\S]*?public\.get_member_net_balance_cents\(group_id,\s*user_id\)\s*=\s*0/i,
    );
    expect(fullSql).toMatch(
      /CREATE TRIGGER trg_expenses_reject_archived[\s\S]*?BEFORE INSERT OR UPDATE OR DELETE ON public\.expenses/i,
    );
    expect(fullSql).toMatch(
      /CREATE TRIGGER trg_settlements_reject_archived[\s\S]*?BEFORE INSERT OR UPDATE OR DELETE ON public\.settlements/i,
    );
    expect(fullSql).toMatch(
      /CREATE TRIGGER trg_group_members_departure_guard[\s\S]*?BEFORE DELETE ON public\.group_members/i,
    );
  });

  it("provisions private receipts storage bucket and storage RLS policies", () => {
    expect(fullSql).toMatch(/INSERT INTO storage\.buckets[\s\S]*?'receipts'/i);
    expect(fullSql).toMatch(/CREATE POLICY "receipts_insert_own"[\s\S]*?ON storage\.objects/i);
    expect(fullSql).toMatch(
      /CREATE POLICY "receipts_select_owner_or_group_member"[\s\S]*?ON storage\.objects/i,
    );
    expect(fullSql).toMatch(/CREATE POLICY "receipts_delete_own"[\s\S]*?ON storage\.objects/i);
  });

  it("enables supabase_realtime publication on v2 ledger and notification tables", () => {
    expect(fullSql).toMatch(
      /ALTER TABLE public\.notifications REPLICA IDENTITY FULL/i,
    );
    expect(fullSql).toMatch(/pubname = 'supabase_realtime'/i);
    for (const table of [
      "notifications",
      "expenses",
      "expense_revisions",
      "settlements",
      "billing_cycles",
      "groups",
      "group_members",
      "settlement_handles",
      "group_invites",
    ]) {
      expect(fullSql).toContain(`'${table}'`);
    }
  });
});
