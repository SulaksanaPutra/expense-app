import fs from "node:fs";
import path from "node:path";
import { expect, test, type Download } from "@playwright/test";
import {
  authenticateContextAsUser,
  cleanupE2EGroupsForUser,
  createAdminSupabase,
  ensureE2EUser,
} from "./helpers/supabase-auth";

const E2E_ALEX_EMAIL = "e2e-89-alex@ledgersplit.test";
const E2E_ALEX_NAME = "Alex Rivera";
const E2E_ELENA_EMAIL = "e2e-89-elena@ledgersplit.test";
const E2E_ELENA_NAME = "Elena Rostova";

function resolveScreenshotDir(): string {
  const rootVerification = path.resolve(
    process.cwd(),
    "../../.verification/screenshots",
  );
  if (fs.existsSync(path.resolve(process.cwd(), "../../.verification"))) {
    return rootVerification;
  }
  return path.resolve(process.cwd(), ".verification/screenshots");
}

function getCurrentAndPrevCycle(): { currentCycle: string; prevCycle: string } {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const currentCycle = `${y}-${String(m + 1).padStart(2, "0")}`;
  const prev = new Date(Date.UTC(y, m - 1, 1));
  const prevCycle = `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, "0")}`;
  return { currentCycle, prevCycle };
}

async function assertNoHorizontalOverflow(
  page: import("@playwright/test").Page,
) {
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.innerWidth);
}

async function readDownloadText(download: Download): Promise<string> {
  const filePath = await download.path();
  if (!filePath) {
    throw new Error("Playwright download path was null.");
  }
  return fs.readFileSync(filePath, "utf8");
}

function parseRfc4180Csv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\r" && input[i + 1] === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += 1;
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

test.describe("Issue #89 — CSV & JSON Ledger Exports across Dashboard, Expenses, Settings", () => {
  let alexUserId = "";
  let elenaUserId = "";

  test.beforeAll(async () => {
    fs.mkdirSync(resolveScreenshotDir(), { recursive: true });
    const [alex, elena] = await Promise.all([
      ensureE2EUser(E2E_ALEX_EMAIL, E2E_ALEX_NAME),
      ensureE2EUser(E2E_ELENA_EMAIL, E2E_ELENA_NAME),
    ]);
    alexUserId = alex.id;
    elenaUserId = elena.id;
    await cleanupE2EGroupsForUser(alexUserId);
  });

  test.afterAll(async () => {
    if (alexUserId) {
      await cleanupE2EGroupsForUser(alexUserId);
    }
    const admin = createAdminSupabase();
    for (const uid of [alexUserId, elenaUserId]) {
      if (uid) {
        await admin.auth.admin.deleteUser(uid).catch(() => {});
      }
    }
  });

  test("exports scoped RFC-4180 CSV on Dashboard & Expenses and full CSV/JSON history on Settings across desktop & mobile", async ({
    page,
    context,
    baseURL,
  }, testInfo) => {
    const isMobile = testInfo.project.name.includes("mobile");
    const tag = isMobile ? "mobile" : "desktop";
    const resolvedBaseUrl = baseURL || "http://127.0.0.1:3100";
    const { currentCycle, prevCycle } = getCurrentAndPrevCycle();

    await cleanupE2EGroupsForUser(alexUserId);
    const admin = createAdminSupabase();

    const groupUsdId = crypto.randomUUID();
    const groupJpyId = crypto.randomUUID();
    const groupArchivedId = crypto.randomUUID();
    const stamp = Date.now();

    const { error: grpErr } = await admin.from("groups").insert([
      {
        id: groupUsdId,
        name: `[E2E] Issue 89 Apt 4B ${tag}`,
        slug: `e2e-89-apt-${tag}-${stamp}`,
        group_type: "RESIDENTIAL",
        status: "ACTIVE",
        base_currency: "USD",
        default_split_mode: "EQUAL",
        simplify_debts: true,
        operational_budget_cents: 300_000,
        billing_cycle_anchor_day: 1,
        invite_token: `tok-89-usd-${tag}-${stamp}`,
        invite_token_version: 1,
        created_by: alexUserId,
      },
      {
        id: groupJpyId,
        name: `[E2E] Issue 89 Tokyo ${tag}`,
        slug: `e2e-89-tokyo-${tag}-${stamp}`,
        group_type: "TRIP",
        status: "ACTIVE",
        base_currency: "JPY",
        default_split_mode: "EQUAL",
        simplify_debts: true,
        operational_budget_cents: 200_000,
        billing_cycle_anchor_day: 1,
        invite_token: `tok-89-jpy-${tag}-${stamp}`,
        invite_token_version: 1,
        created_by: alexUserId,
      },
      {
        id: groupArchivedId,
        name: `[E2E] Issue 89 Euro Archive ${tag}`,
        slug: `e2e-89-eur-${tag}-${stamp}`,
        group_type: "TRIP",
        status: "ACTIVE",
        base_currency: "EUR",
        default_split_mode: "EQUAL",
        simplify_debts: true,
        operational_budget_cents: null,
        billing_cycle_anchor_day: 1,
        invite_token: `tok-89-eur-${tag}-${stamp}`,
        invite_token_version: 1,
        created_by: alexUserId,
      },
    ]);
    if (grpErr) throw grpErr;

    const { error: memErr } = await admin.from("group_members").insert([
      {
        group_id: groupUsdId,
        user_id: alexUserId,
        role: "ADMIN",
        status: "ACTIVE",
        share_percentage: 50,
      },
      {
        group_id: groupUsdId,
        user_id: elenaUserId,
        role: "MEMBER",
        status: "ACTIVE",
        share_percentage: 50,
      },
      {
        group_id: groupJpyId,
        user_id: alexUserId,
        role: "ADMIN",
        status: "ACTIVE",
        share_percentage: 50,
      },
      {
        group_id: groupJpyId,
        user_id: elenaUserId,
        role: "MEMBER",
        status: "ACTIVE",
        share_percentage: 50,
      },
      {
        group_id: groupArchivedId,
        user_id: alexUserId,
        role: "ADMIN",
        status: "ACTIVE",
        share_percentage: 100,
      },
    ]);
    if (memErr) throw memErr;

    const { error: expErr } = await admin.from("expenses").insert([
      {
        group_id: groupUsdId,
        created_by: alexUserId,
        paid_by: alexUserId,
        description: `[E2E] Apt Coffee, "Special" ${tag}`,
        category: "Groceries & Food",
        expense_date: `${currentCycle}-12T12:00:00.000Z`,
        amount_cents: 18250,
        currency: "USD",
        original_amount_cents: 16820,
        original_currency: "EUR",
        exchange_rate: 1.085018,
        exchange_rate_source: "MANUAL_OVERRIDE",
        split_method: "EQUAL",
        is_locked: false,
        split_breakdown: [
          { user_id: alexUserId, share_cents: 9125, percentage: 50 },
          { user_id: elenaUserId, share_cents: 9125, percentage: 50 },
        ],
      },
      {
        group_id: groupUsdId,
        created_by: elenaUserId,
        paid_by: elenaUserId,
        description: `[E2E] Apt Prev Power ${tag}`,
        category: "Utilities",
        expense_date: `${prevCycle}-10T12:00:00.000Z`,
        amount_cents: -2550,
        currency: "USD",
        split_method: "EXACT",
        is_locked: false,
        split_breakdown: [
          { user_id: alexUserId, share_cents: -1275 },
          { user_id: elenaUserId, share_cents: -1275 },
        ],
      },
      {
        group_id: groupJpyId,
        created_by: alexUserId,
        paid_by: alexUserId,
        description: `[E2E] Tokyo Rail Pass ${tag}`,
        category: "Transit & Travel",
        expense_date: `${currentCycle}-14T09:00:00.000Z`,
        amount_cents: 28400,
        currency: "JPY",
        original_amount_cents: 19000,
        original_currency: "USD",
        exchange_rate: 149.473684,
        exchange_rate_source: "API",
        split_method: "EQUAL",
        is_locked: false,
        split_breakdown: [
          { user_id: alexUserId, share_cents: 14200, percentage: 50 },
          { user_id: elenaUserId, share_cents: 14200, percentage: 50 },
        ],
      },
      {
        group_id: groupArchivedId,
        created_by: alexUserId,
        paid_by: alexUserId,
        description: `[E2E] Euro Archived Hotel ${tag}`,
        category: "Transit & Travel",
        expense_date: "2025-06-10T10:00:00.000Z",
        amount_cents: 45075,
        currency: "EUR",
        split_method: "EQUAL",
        split_breakdown: [
          { user_id: alexUserId, share_cents: 45075, percentage: 100 },
        ],
        is_locked: true,
      },
    ]);
    if (expErr) throw expErr;

    const { error: archiveErr } = await admin
      .from("groups")
      .update({ status: "ARCHIVED" })
      .eq("id", groupArchivedId);
    if (archiveErr) throw archiveErr;

    const { error: setErr } = await admin.from("settlements").insert({
      group_id: groupUsdId,
      payer_id: elenaUserId,
      recipient_id: alexUserId,
      amount_cents: 5000,
      currency: "USD",
      payment_rail: "VENMO",
      settled_at: `${currentCycle}-15T15:00:00.000Z`,
    });
    if (setErr) throw setErr;

    await authenticateContextAsUser(context, resolvedBaseUrl, E2E_ALEX_EMAIL);

    // 1. Dashboard Export CSV (All Groups, currentCycle)
    await page.goto(`/dashboard?group=all&cycle=${currentCycle}`, {
      waitUntil: "networkidle",
    });
    await assertNoHorizontalOverflow(page);

    const [dashDownload] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: /Export CSV/i }).click(),
    ]);
    expect(dashDownload.suggestedFilename()).toBe(
      `ledgersplit-all-groups-${currentCycle}.csv`,
    );
    const dashCsv = await readDownloadText(dashDownload);
    expect(dashCsv).toContain("\r\n");
    const dashRows = parseRfc4180Csv(dashCsv);
    expect(dashRows).toHaveLength(3); // Header + USD + JPY in currentCycle
    expect(dashCsv).toContain(`[E2E] Apt Coffee, ""Special"" ${tag}`);
    expect(dashCsv).toContain(`[E2E] Tokyo Rail Pass ${tag}`);
    expect(dashCsv).toContain("$182.50");
    expect(dashCsv).toContain("¥28,400");
    expect(dashCsv).toContain("MANUAL_OVERRIDE");
    expect(dashCsv).not.toContain(`[E2E] Apt Prev Power ${tag}`);
    expect(dashCsv).not.toContain(`[E2E] Euro Archived Hotel ${tag}`);

    // 2. Expenses Export CSV (scoped to Tokyo JPY group, currentCycle)
    await page.goto(`/expenses?group=${groupJpyId}&cycle=${currentCycle}`, {
      waitUntil: "networkidle",
    });
    await assertNoHorizontalOverflow(page);

    const [expDownload] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: /Export CSV/i }).click(),
    ]);
    const expCsv = await readDownloadText(expDownload);
    expect(expCsv).toContain("\r\n");
    const expRows = parseRfc4180Csv(expCsv);
    expect(expRows).toHaveLength(2); // Header + Tokyo Rail Pass only
    expect(expRows[1]).toContain("¥14,200");
    expect(expRows[1]).toContain("¥28,400");
    expect(expRows[1]).toContain("JPY");
    expect(expRows[1]).toContain("28400");
    expect(expRows[1]).toContain("API");
    expect(expCsv).not.toContain(`[E2E] Apt Coffee`);

    // 3. Settings Export Ledger History (CSV & JSON across all groups incl. Archived & Settlements)
    await page.goto(`/settings?group=${groupUsdId}&cycle=${currentCycle}`, {
      waitUntil: "networkidle",
    });
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await assertNoHorizontalOverflow(page);

    await page.screenshot({
      path: path.join(resolveScreenshotDir(), `issue-89-${tag}.png`),
      fullPage: true,
    });

    const [settingsCsvDownload] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "CSV", exact: true }).click(),
    ]);
    expect(settingsCsvDownload.suggestedFilename()).toBe(
      "ledgersplit-full-ledger-history.csv",
    );
    const settingsCsv = await readDownloadText(settingsCsvDownload);
    const settingsCsvRows = parseRfc4180Csv(settingsCsv);
    // Header + 4 expenses (incl. prev cycle & archived EUR) + 1 settlement = 6
    expect(settingsCsvRows).toHaveLength(6);
    expect(settingsCsv).toContain(`[E2E] Euro Archived Hotel ${tag}`);
    expect(settingsCsv).toContain("€450.75");
    expect(settingsCsv).toContain("-$25.50");
    expect(settingsCsv).toContain("SETTLEMENT");

    const [settingsJsonDownload] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "JSON", exact: true }).click(),
    ]);
    expect(settingsJsonDownload.suggestedFilename()).toBe(
      "ledgersplit-full-ledger-history.json",
    );
    const settingsJson = JSON.parse(await readDownloadText(settingsJsonDownload)) as {
      groups: Array<{ id: string; base_currency: string }>;
      expenses: Array<{
        description: string;
        base_currency: string;
        amount_cents: number;
        amount_formatted: string;
        amount_decimal: string;
        fx_audit: {
          original_amount_cents: number;
          original_currency: string;
          exchange_rate: number;
          exchange_rate_source: string;
        } | null;
      }>;
      settlements: Array<{
        amount_cents: number;
        amount_formatted: string;
        base_currency: string;
      }>;
    };

    expect(settingsJson.groups).toHaveLength(3);
    expect(settingsJson.expenses).toHaveLength(4);
    const aptJsonExp = settingsJson.expenses.find((e) =>
      e.description.includes("Apt Coffee"),
    );
    expect(aptJsonExp).toMatchObject({
      base_currency: "USD",
      amount_cents: 18250,
      amount_formatted: "$182.50",
      amount_decimal: "182.50",
      fx_audit: {
        original_amount_cents: 16820,
        original_currency: "EUR",
        exchange_rate: 1.085018,
        exchange_rate_source: "MANUAL_OVERRIDE",
      },
    });
    expect(settingsJson.settlements).toHaveLength(1);
    expect(settingsJson.settlements[0]).toMatchObject({
      base_currency: "USD",
      amount_cents: 5000,
      amount_formatted: "$50.00",
    });

    await assertNoHorizontalOverflow(page);
  });
});
