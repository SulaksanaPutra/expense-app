import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import {
  authenticateContextAsUser,
  cleanupE2EGroupsForUser,
  createAdminSupabase,
  ensureE2EUser,
} from "./helpers/supabase-auth";

const E2E_ADMIN_EMAIL = "e2e-86-alex@ledgersplit.test";
const E2E_ADMIN_NAME = "Alex Rivera";
const E2E_MEMBER_EMAIL = "e2e-86-elena@ledgersplit.test";
const E2E_MEMBER_NAME = "Elena Rostova";

function resolveScreenshotDir(): string {
  return path.resolve(process.cwd(), ".verification", "screenshots");
}

function getCurrentCycleSlug(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
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

test.describe("Issue #86 — Settings (/settings) & End-to-End Consumer Wiring", () => {
  let adminUserId = "";
  let memberUserId = "";

  test.beforeAll(async () => {
    fs.mkdirSync(resolveScreenshotDir(), { recursive: true });
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
      const admin = createAdminSupabase();
      await admin
        .from("users")
        .update({
          phone_number: null,
          phone_verified: false,
          instant_settlement_tag: null,
          base_currency: "USD",
          personal_share_cap_cents: null,
          receipt_storage_used_bytes: 0,
          notification_prefs: {
            new_expense: true,
            settlement_confirmation: true,
            monthly_recap: true,
            sms_nudges_opt_in: false,
          },
        })
        .eq("id", adminUserId);
    }
  });

  test("persists settings, shows accurate 500 MB ProgressRing, handles Reset to Defaults, and wires preferences into AddEditExpenseModal, Expenses, and RecordSettlementModal", async ({
    page,
    context,
    baseURL,
  }, testInfo) => {
    const isMobile = testInfo.project.name.includes("mobile");
    const tag = isMobile ? "mobile" : "desktop";
    const resolvedBaseUrl = baseURL || "http://127.0.0.1:3100";
    const cycleSlug = getCurrentCycleSlug();

    await cleanupE2EGroupsForUser(adminUserId);
    const admin = createAdminSupabase();

    // Seed clean user settings + 94,371,840 bytes (90.0 MB = 18% of 500 MB)
    await admin
      .from("users")
      .update({
        full_name: E2E_ADMIN_NAME,
        phone_number: null,
        phone_verified: false,
        instant_settlement_tag: null,
        base_currency: "USD",
        personal_share_cap_cents: null,
        receipt_storage_used_bytes: 94_371_840,
        notification_prefs: {
          new_expense: true,
          settlement_confirmation: true,
          monthly_recap: true,
          sms_nudges_opt_in: false,
        },
      })
      .eq("id", adminUserId);

    const groupId = crypto.randomUUID();
    const nowTag = Date.now();
    const { error: groupErr } = await admin.from("groups").insert({
      id: groupId,
      name: `[E2E] Issue 86 Group ${tag}`,
      slug: `e2e-86-${tag}-${nowTag}`,
      group_type: "RESIDENTIAL",
      status: "ACTIVE",
      base_currency: "USD",
      default_split_mode: "EQUAL",
      simplify_debts: true,
      operational_budget_cents: 400_000,
      billing_cycle_anchor_day: 1,
      invite_token: `tok-86-${tag}-${nowTag}`,
      invite_token_version: 1,
      created_by: adminUserId,
    });
    if (groupErr) throw groupErr;

    const { error: memberErr } = await admin.from("group_members").insert([
      {
        group_id: groupId,
        user_id: adminUserId,
        role: "ADMIN",
        status: "ACTIVE",
        share_percentage: 60,
      },
      {
        group_id: groupId,
        user_id: memberUserId,
        role: "MEMBER",
        status: "ACTIVE",
        share_percentage: 40,
      },
    ]);
    if (memberErr) throw memberErr;

    // Seed an expense paid by Elena so Alex owes Elena, and also an expense paid by Alex so Elena owes Alex (allowing RecordSettlementModal to show Alex's @instant_settlement_tag)
    const { error: expErr } = await admin.from("expenses").insert([
      {
        group_id: groupId,
        created_by: adminUserId,
        paid_by: adminUserId,
        description: "[E2E] Monthly Apartment Rent",
        category: "Rent & Housing",
        expense_date: `${cycleSlug}-05T12:00:00.000Z`,
        amount_cents: 200_000,
        currency: "USD",
        split_method: "EQUAL",
        split_breakdown: [
          { user_id: adminUserId, share_cents: 100_000 },
          { user_id: memberUserId, share_cents: 100_000 },
        ],
      },
    ]);
    if (expErr) throw expErr;

    await authenticateContextAsUser(context, resolvedBaseUrl, E2E_ADMIN_EMAIL);

    // 1. Open /settings scoped to active group
    await page.goto(`/settings?group=${groupId}&cycle=${cycleSlug}`);
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await assertNoHorizontalOverflow(page);

    // 2. Verify Storage & Sync Quota ProgressRing displays 18% (90.0 MB of 500 MB)
    const quotaCard = page.getByTestId("storage-quota-card");
    await expect(quotaCard).toContainText("90.0 MB");
    await expect(quotaCard).toContainText("500 MB");
    await expect(quotaCard).toContainText("18%");

    // 3. Test Reset to Defaults restores modified values
    await page.getByRole("tab", { name: "Exact Shares" }).click();
    const capInput = page.getByLabel(/Personal Share Cap/i);
    await capInput.fill("999.00");
    await page.getByRole("button", { name: /Reset to Defaults/i }).click();
    await expect(capInput).toHaveValue("");
    await expect(
      page.getByRole("tab", { name: "Equal Split" }),
    ).toHaveAttribute("aria-selected", "true");

    // 4. Fill @instant_settlement_tag, Default Split Mode = Percentage, Personal Share Cap = 2000.00, and Save Changes
    const tagInput = page.getByLabel(/Instant Settlement Tag/i);
    await tagInput.fill("alex-rivera-99");
    await page.getByRole("tab", { name: "Percentage" }).click();
    await capInput.fill("2000.00");

    await page.getByRole("button", { name: /Save Changes/i }).click();
    await expect(page.getByText("Settings saved")).toBeVisible();

    // Dismiss toast notifications before capturing clean verification screenshot
    const closeToastBtns = page.getByRole("button", { name: "Close notification" });
    while ((await closeToastBtns.count()) > 0) {
      await closeToastBtns.first().click();
    }
    await page.evaluate(() => window.scrollTo(0, 0));

    await assertNoHorizontalOverflow(page);
    await page.screenshot({
      path: path.join(resolveScreenshotDir(), `issue-86-${tag}.png`),
      fullPage: true,
    });

    // 5. Verify wiring into AddEditExpenseModal
    await page.getByRole("button", { name: "Add Expense" }).click();
    const expenseDialog = page.getByRole("dialog", { name: "Add Expense" });
    await expect(expenseDialog).toBeVisible();
    await expect(
      expenseDialog.getByRole("tab", { name: "By Percentage" }),
    ).toHaveAttribute("aria-selected", "true");
    await expenseDialog.getByRole("button", { name: "Cancel" }).click();

    // 6. Verify wiring into /expenses (Personal Share Cap = $2,000.00 -> $1,000.00 = 50.0%) and RecordSettlementModal (@alex-rivera-99)
    await page.goto(`/expenses?group=${groupId}&cycle=${cycleSlug}`);
    await expect(page.getByTestId("kpi-personal-share")).toContainText(
      "Monthly limit threshold: $2,000.00",
    );
    await expect(page.getByTestId("kpi-personal-share")).toContainText("50.0%");

    await page.getByRole("button", { name: /Settle now/i }).click();
    const settleDialog = page.getByRole("dialog", {
      name: "Record Settlement",
    });
    await expect(settleDialog).toBeVisible();
    await expect(
      settleDialog.getByTestId("recipient-settlement-tag"),
    ).toContainText("@alex-rivera-99");
  });
});
