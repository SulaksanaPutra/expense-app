import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATIONS_DIR = path.resolve(__dirname, "../supabase/migrations");

function loadAllMigrations(): string {
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  return files
    .map((f) => fs.readFileSync(path.join(MIGRATIONS_DIR, f), "utf8"))
    .join("\n\n");
}

function extractTableBlock(sql: string, tableName: string): string {
  const regex = new RegExp(
    `CREATE TABLE public\\.${tableName}\\s*\\(([\\s\\S]*?)\\n\\);`,
    "i",
  );
  const match = sql.match(regex);
  expect(match, `Table public.${tableName} must exist`).not.toBeNull();
  return match![1];
}

const REQUIRED_TABLES = [
  "users",
  "groups",
  "group_members",
  "expenses",
  "expense_revisions",
  "settlements",
  "billing_cycles",
  "recurring_rules",
  "reminder_logs",
  "group_audit_logs",
] as const;

describe("Supabase Postgres Schema & RLS Migrations", () => {
  const fullSql = loadAllMigrations();

  it("creates all 9 domain model tables", () => {
    for (const table of REQUIRED_TABLES) {
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
        table: "recurring_rules",
        centsCols: ["amount_cents"],
        currencyCols: ["currency"],
      },
      {
        table: "expenses",
        centsCols: ["amount_cents", "original_amount_cents"],
        currencyCols: ["currency", "original_currency"],
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
  });

  it("enables Row-Level Security (ENABLE ROW LEVEL SECURITY) on all 9 tables", () => {
    for (const table of REQUIRED_TABLES) {
      const rlsRegex = new RegExp(
        `ALTER TABLE public\\.${table}\\s+ENABLE ROW LEVEL SECURITY;`,
        "i",
      );
      expect(fullSql, `${table} must enable RLS`).toMatch(rlsRegex);
    }
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

  it("enforces group isolation and ADMIN-only mutations via RLS policies", () => {
    // Member read isolation on all group-scoped tables
    expect(fullSql).toMatch(
      /ON public\.groups[\s\S]*?FOR SELECT[\s\S]*?public\.is_group_member\(id\)/i,
    );
    expect(fullSql).toMatch(
      /ON public\.expenses[\s\S]*?FOR SELECT[\s\S]*?public\.is_group_member\(group_id\)/i,
    );
    expect(fullSql).toMatch(
      /ON public\.settlements[\s\S]*?FOR SELECT[\s\S]*?public\.is_group_member\(group_id\)/i,
    );
    expect(fullSql).toMatch(
      /ON public\.group_audit_logs[\s\S]*?FOR SELECT[\s\S]*?public\.is_group_member\(group_id\)/i,
    );

    // ADMIN-only mutations enforced at DB/RLS level
    expect(fullSql).toMatch(
      /ON public\.groups[\s\S]*?FOR UPDATE[\s\S]*?public\.is_group_admin\(id\)/i,
    );
    expect(fullSql).toMatch(
      /ON public\.group_members[\s\S]*?FOR UPDATE[\s\S]*?public\.is_group_admin\(group_id\)/i,
    );
    expect(fullSql).toMatch(
      /ON public\.billing_cycles[\s\S]*?FOR INSERT[\s\S]*?public\.is_group_admin\(group_id\)/i,
    );
    expect(fullSql).toMatch(
      /ON public\.billing_cycles[\s\S]*?FOR UPDATE[\s\S]*?public\.is_group_admin\(group_id\)/i,
    );
    expect(fullSql).toMatch(
      /ON public\.recurring_rules[\s\S]*?FOR INSERT[\s\S]*?public\.is_group_admin\(group_id\)/i,
    );
    expect(fullSql).toMatch(
      /ON public\.recurring_rules[\s\S]*?FOR UPDATE[\s\S]*?public\.is_group_admin\(group_id\)/i,
    );

    // Locked expense & non-archived guards
    expect(fullSql).toMatch(/is_locked = FALSE/i);
    expect(fullSql).toMatch(/public\.is_group_not_archived/i);
  });

  it("enforces member departure balance guards, archive rules columns, and ARCHIVED read-only triggers across expenses, settlements, and recurring_rules", () => {
    expect(fullSql).toMatch(/trip_auto_archive_enabled\s+BOOLEAN/i);
    expect(fullSql).toMatch(/trip_auto_archive_days\s+INTEGER/i);
    expect(fullSql).toMatch(/residential_lease_prompt_enabled\s+BOOLEAN/i);
    expect(fullSql).toMatch(/zero_balance_since\s+TIMESTAMPTZ/i);
    expect(fullSql).toMatch(/lease_prompt_snoozed_until\s+TIMESTAMPTZ/i);

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
      /ON public\.recurring_rules[\s\S]*?FOR DELETE[\s\S]*?public\.is_group_not_archived\(group_id\)/i,
    );

    expect(fullSql).toMatch(
      /CREATE TRIGGER trg_expenses_reject_archived[\s\S]*?BEFORE INSERT OR UPDATE OR DELETE ON public\.expenses/i,
    );
    expect(fullSql).toMatch(
      /CREATE TRIGGER trg_settlements_reject_archived[\s\S]*?BEFORE INSERT OR UPDATE OR DELETE ON public\.settlements/i,
    );
    expect(fullSql).toMatch(
      /CREATE TRIGGER trg_recurring_rules_reject_archived[\s\S]*?BEFORE INSERT OR UPDATE OR DELETE ON public\.recurring_rules/i,
    );
    expect(fullSql).toMatch(
      /CREATE TRIGGER trg_group_members_departure_guard[\s\S]*?BEFORE DELETE ON public\.group_members/i,
    );
  });

  it("provisions private receipts storage bucket, storage RLS policies, and atomic 500 MB quota RPCs", () => {
    expect(fullSql).toMatch(/INSERT INTO storage\.buckets[\s\S]*?'receipts'/i);
    expect(fullSql).toMatch(/CREATE POLICY "receipts_insert_own"[\s\S]*?ON storage\.objects/i);
    expect(fullSql).toMatch(
      /CREATE POLICY "receipts_select_owner_or_group_member"[\s\S]*?ON storage\.objects/i,
    );
    expect(fullSql).toMatch(/CREATE POLICY "receipts_delete_own"[\s\S]*?ON storage\.objects/i);
    expect(fullSql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.reserve_receipt_storage_bytes/i,
    );
    expect(fullSql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.release_receipt_storage_bytes/i,
    );
  });

  it("supports active member recurring rule ownership and idempotent cron materialization", () => {
    expect(fullSql).toMatch(
      /ALTER TABLE public\.recurring_rules[\s\S]*?ADD COLUMN IF NOT EXISTS created_by UUID/i,
    );
    expect(fullSql).toMatch(
      /CREATE POLICY "recurring_rules_insert_active_member"[\s\S]*?ON public\.recurring_rules[\s\S]*?public\.is_active_group_member\(group_id\)/i,
    );
    expect(fullSql).toMatch(
      /CREATE POLICY "recurring_rules_update_admin_or_creator"[\s\S]*?ON public\.recurring_rules/i,
    );
    expect(fullSql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS idx_expenses_recurring_rule_occurrence_uniq[\s\S]*?ON public\.expenses\(recurring_rule_id,\s*recurring_occurrence_date\)/i,
    );
    expect(fullSql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.materialize_due_recurring_rules/i,
    );
  });
});
