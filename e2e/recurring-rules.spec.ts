import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import {
  authenticateContextAsUser,
  cleanupE2EGroupsForUser,
  createAdminSupabase,
  ensureE2EUser,
} from "./helpers/supabase-auth";

const E2E_ADMIN_EMAIL = "e2e-admin-81@ledgersplit.test";
const E2E_ADMIN_NAME = "Alex Rivera";
const E2E_MEMBER_EMAIL = "e2e-member-81@ledgersplit.test";
const E2E_MEMBER_NAME = "Elena Rostova";

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

async function assertNoHorizontalOverflow(
  page: import("@playwright/test").Page,
) {
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.innerWidth);
}

test.describe("Issue #81 — Recurring Rules tab & idempotent cron materialization", () => {
  let adminUserId = "";
  let memberUserId = "";

  test.beforeAll(async () => {
    const [adminUser, memberUser] = await Promise.all([
      ensureE2EUser(E2E_ADMIN_EMAIL, E2E_ADMIN_NAME),
      ensureE2EUser(E2E_MEMBER_EMAIL, E2E_MEMBER_NAME),
    ]);
    adminUserId = adminUser.id;
    memberUserId = memberUser.id;
    await cleanupE2EGroupsForUser(adminUserId);
  });

  test.afterAll(async () => {
    if (adminUserId) {
      await cleanupE2EGroupsForUser(adminUserId);
    }
    const admin = createAdminSupabase();
    if (memberUserId) {
      await admin.auth.admin.deleteUser(memberUserId).catch(() => {});
    }
    if (adminUserId) {
      await admin.auth.admin.deleteUser(adminUserId).catch(() => {});
    }
  });

  test("lets active member create/pause/delete RecurringRule templates and materializes due rules idempotently", async ({
    page,
    context,
    baseURL,
  }, testInfo) => {
    const isMobile = testInfo.project.name.includes("mobile");
    const tag = isMobile ? "mobile" : "desktop";
    const resolvedBaseUrl = baseURL || "http://127.0.0.1:3181";
    const screenshotDir = resolveScreenshotDir();
    fs.mkdirSync(screenshotDir, { recursive: true });

    const runtimeErrors: string[] = [];
    page.on("pageerror", (err) => runtimeErrors.push(err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        runtimeErrors.push(msg.text());
      }
    });

    await cleanupE2EGroupsForUser(adminUserId);
    // Authenticate as non-admin ACTIVE MEMBER to verify member creation & ownership controls
    await authenticateContextAsUser(context, resolvedBaseUrl, E2E_MEMBER_EMAIL);

    const admin = createAdminSupabase();
    const groupId = crypto.randomUUID();
    const groupName = `[E2E] Issue 81 Recurring ${tag}`;
    const slug = `e2e-81-${tag}-${Date.now()}`;

    const { error: groupErr } = await admin.from("groups").insert({
      id: groupId,
      name: groupName,
      slug,
      group_type: "RESIDENTIAL",
      status: "ACTIVE",
      base_currency: "USD",
      default_split_mode: "EQUAL",
      simplify_debts: true,
      operational_budget_cents: 450000,
      billing_cycle_anchor_day: 1,
      invite_token: `tok-81-${tag}-${Date.now()}`,
      invite_token_version: 1,
      created_by: adminUserId,
    });
    if (groupErr) throw groupErr;

    const { error: membersErr } = await admin.from("group_members").insert([
      {
        group_id: groupId,
        user_id: adminUserId,
        role: "ADMIN",
        status: "ACTIVE",
        share_percentage: 50,
      },
      {
        group_id: groupId,
        user_id: memberUserId,
        role: "MEMBER",
        status: "ACTIVE",
        share_percentage: 50,
      },
    ]);
    if (membersErr) throw membersErr;

    const now = new Date();
    const todayIso = now.toISOString().slice(0, 10);
    const todayDay = Math.min(Math.max(now.getUTCDate(), 1), 28);
    const cycleSlug = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

    // 1. Open /expenses and switch to Recurring tab
    await page.goto(`/expenses?group=${groupId}&cycle=${cycleSlug}`, {
      waitUntil: "networkidle",
    });
    await assertNoHorizontalOverflow(page);

    await page.getByRole("tab", { name: "Recurring" }).click();
    await expect(page.getByTestId("recurring-rules-panel")).toBeVisible();
    await assertNoHorizontalOverflow(page);

    // 2. Active member creates a due RecurringRule template
    await page.getByRole("button", { name: /Add Recurring Rule/i }).click();
    const dialog = page.getByRole("dialog", { name: "Add Recurring Rule" });
    await expect(dialog).toBeVisible();

    const fiberDesc = `[E2E] Monthly Fiber ${tag}`;
    await dialog.getByLabel(/Description/i).fill(fiberDesc);
    await dialog.getByLabel(/Amount/i).fill("90.00");
    await dialog.getByLabel(/Day of Month/i).fill(String(todayDay));
    await dialog.getByLabel(/First Run Date/i).fill(todayIso);
    await dialog.getByRole("button", { name: "Save Rule" }).click();

    await expect(dialog).toBeHidden({ timeout: 10_000 });
    const recurringPanel = page.getByTestId("recurring-rules-panel");
    await expect(
      recurringPanel.getByText(fiberDesc, { exact: true }),
    ).toBeVisible();
    await expect(recurringPanel.getByText("$90.00")).toBeVisible();

    // 3. Create a second temporary rule and delete it via ConfirmDialog
    await page.getByRole("button", { name: /Add Recurring Rule/i }).click();
    const dialog2 = page.getByRole("dialog", { name: "Add Recurring Rule" });
    const tempDesc = `[E2E] Temp Trash ${tag}`;
    await dialog2.getByLabel(/Description/i).fill(tempDesc);
    await dialog2.getByLabel(/Amount/i).fill("25.00");
    await dialog2.getByRole("button", { name: "Save Rule" }).click();
    await expect(dialog2).toBeHidden({ timeout: 10_000 });
    await expect(
      recurringPanel.getByText(tempDesc, { exact: true }),
    ).toBeVisible();

    await page.getByRole("button", { name: `Delete ${tempDesc}` }).click();
    const confirmDialog = page.getByRole("dialog", {
      name: "Delete Recurring Rule",
    });
    await expect(confirmDialog).toBeVisible();
    await confirmDialog.getByRole("button", { name: "Delete Rule" }).click();
    await expect(confirmDialog).toBeHidden({ timeout: 10_000 });
    await expect(
      recurringPanel.getByText(tempDesc, { exact: true }),
    ).toBeHidden();

    // 4. Pause then resume the Fiber rule
    await page.getByRole("button", { name: `Pause ${fiberDesc}` }).click();
    await expect(
      page.getByRole("button", { name: `Resume ${fiberDesc}` }),
    ).toBeVisible();
    await page.getByRole("button", { name: `Resume ${fiberDesc}` }).click();
    await expect(
      page.getByRole("button", { name: `Pause ${fiberDesc}` }),
    ).toBeVisible();

    // Capture desktop/mobile verification screenshot on the Recurring tab
    await page.evaluate(() => window.scrollTo(0, 0));
    await assertNoHorizontalOverflow(page);
    await page.screenshot({
      path: path.join(screenshotDir, `issue-81-${tag}.png`),
      fullPage: true,
    });

    // 5. Execute cron endpoint for todayIso -> materializes 1 expense
    const cronRes1 = await page.request.post("/api/cron/recurring-expenses", {
      data: { run_date: todayIso, group_id: groupId },
    });
    expect(cronRes1.status()).toBe(200);
    const cronJson1 = (await cronRes1.json()) as {
      ok: boolean;
      materializedCount: number;
    };
    expect(cronJson1.ok).toBe(true);
    expect(cronJson1.materializedCount).toBe(1);

    // 6. Re-running cron for the SAME date does NOT duplicate expenses
    const cronRes2 = await page.request.post("/api/cron/recurring-expenses", {
      data: { run_date: todayIso, group_id: groupId },
    });
    expect(cronRes2.status()).toBe(200);
    const cronJson2 = (await cronRes2.json()) as {
      ok: boolean;
      materializedCount: number;
    };
    expect(cronJson2.ok).toBe(true);
    expect(cronJson2.materializedCount).toBe(0);

    // 7. Verify materialized expense in DB and next_run_date advanced
    const { data: materializedRows, error: expCheckErr } = await admin
      .from("expenses")
      .select("id, description, amount_cents, is_recurring_generated, split_breakdown")
      .eq("group_id", groupId)
      .is("deleted_at", null);
    if (expCheckErr) throw expCheckErr;

    expect(materializedRows).toHaveLength(1);
    expect(materializedRows?.[0].description).toBe(fiberDesc);
    expect(materializedRows?.[0].amount_cents).toBe(9000);
    expect(materializedRows?.[0].is_recurring_generated).toBe(true);
    expect(materializedRows?.[0].split_breakdown).toHaveLength(2);

    const { data: ruleRows } = await admin
      .from("recurring_rules")
      .select("next_run_date")
      .eq("group_id", groupId);
    expect(ruleRows?.[0].next_run_date).not.toBe(todayIso);

    // 8. Reload /expenses All Expenses tab and verify Auto-generated expense renders
    await page.goto(`/expenses?group=${groupId}&cycle=${cycleSlug}`, {
      waitUntil: "networkidle",
    });
    await expect(page.getByText(fiberDesc)).toBeVisible();
    await expect(page.getByText("Auto", { exact: true })).toBeVisible();
    await assertNoHorizontalOverflow(page);

    expect(runtimeErrors).toEqual([]);
  });
});
