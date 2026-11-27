import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import {
  authenticateContextAsUser,
  cleanupE2EGroupsForUser,
  createAdminSupabase,
  ensureE2EUser,
} from "./helpers/supabase-auth";

const E2E_ADMIN_EMAIL = "e2e-admin@ledgersplit.test";
const E2E_ADMIN_NAME = "Alex Rivera";
const E2E_FORMER_EMAIL = "e2e-former@ledgersplit.test";
const E2E_FORMER_NAME = "Marcus Vance";

async function assertNoHorizontalOverflow(
  page: import("@playwright/test").Page,
) {
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.innerWidth);
}

test.describe("Issue #82 — RecordSettlementModal (Log & Link), partial/full SETTLEMENT & FORMER_MEMBER", () => {
  let adminUserId = "";
  let formerUserId = "";

  test.beforeAll(async () => {
    const [adminUser, formerUser] = await Promise.all([
      ensureE2EUser(E2E_ADMIN_EMAIL, E2E_ADMIN_NAME),
      ensureE2EUser(E2E_FORMER_EMAIL, E2E_FORMER_NAME),
    ]);
    adminUserId = adminUser.id;
    formerUserId = formerUser.id;
    await cleanupE2EGroupsForUser(adminUserId);
  });

  test.afterAll(async () => {
    if (adminUserId) {
      await cleanupE2EGroupsForUser(adminUserId);
    }
  });

  test("records partial then full settlement via Venmo Log & Link as FORMER_MEMBER across desktop & mobile", async ({
    page,
    context,
    baseURL,
  }, testInfo) => {
    const isMobile = testInfo.project.name.includes("mobile");
    const tag = isMobile ? "mobile" : "desktop";
    const resolvedBaseUrl = baseURL || "http://127.0.0.1:3100";
    const screenshotDir = path.resolve(
      process.cwd(),
      ".verification/screenshots",
    );
    fs.mkdirSync(screenshotDir, { recursive: true });

    await cleanupE2EGroupsForUser(adminUserId);

    const admin = createAdminSupabase();
    await admin
      .from("users")
      .update({ instant_settlement_tag: "@alex-rivera-99" })
      .eq("id", adminUserId);

    const groupId = crypto.randomUUID();
    const groupName = `[E2E] Issue 82 Apt 4B ${tag}`;
    const slug = `e2e-82-${tag}-${Date.now()}`;

    const { error: groupErr } = await admin.from("groups").insert({
      id: groupId,
      name: groupName,
      slug,
      group_type: "RESIDENTIAL",
      status: "ACTIVE",
      base_currency: "USD",
      default_split_mode: "EQUAL",
      simplify_debts: true,
      operational_budget_cents: 300000,
      billing_cycle_anchor_day: 1,
      invite_token: `tok-82-${tag}-${Date.now()}`,
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
        share_percentage: 100,
      },
      {
        group_id: groupId,
        user_id: formerUserId,
        role: "MEMBER",
        status: "FORMER_MEMBER",
        share_percentage: 0,
      },
    ]);
    if (membersErr) throw membersErr;

    const now = new Date();
    const cycleSlug = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    const expenseDate = new Date(now.getTime() - 60 * 60 * 1000).toISOString();

    const { error: expErr } = await admin.from("expenses").insert({
      group_id: groupId,
      created_by: adminUserId,
      paid_by: adminUserId,
      description: `[E2E] Shared Utilities ${tag}`,
      category: "Utilities",
      expense_date: expenseDate,
      amount_cents: 12000,
      currency: "USD",
      split_method: "EQUAL",
      split_breakdown: [
        { user_id: adminUserId, share_cents: 6000, percentage: 50 },
        { user_id: formerUserId, share_cents: 6000, percentage: 50 },
      ],
    });
    if (expErr) throw expErr;

    await authenticateContextAsUser(context, resolvedBaseUrl, E2E_FORMER_EMAIL);

    // 1. Verify FORMER_MEMBER is blocked from logging expenses at API layer (403)
    const blockedExpRes = await page.request.post(
      `${resolvedBaseUrl}/api/groups/${groupId}/expenses`,
      {
        data: {
          description: "Unauthorized Former Member Expense",
          category: "General",
          amount_cents: 1500,
        },
      },
    );
    expect(blockedExpRes.status()).toBe(403);

    // 2. Navigate to /expenses scoped to the group & current cycle
    await page.goto(`/expenses?group=${groupId}&cycle=${cycleSlug}`, {
      waitUntil: "networkidle",
    });
    await assertNoHorizontalOverflow(page);

    await expect(page.getByText("Former Member Access")).toBeVisible();

    // 3. Verify UI AddExpenseModal blocks FORMER_MEMBER
    await page.getByRole("button", { name: "Add Expense" }).click();
    const addDialog = page.getByRole("dialog", { name: /Add Expense/i });
    await expect(
      addDialog.getByText("Former members cannot log expenses"),
    ).toBeVisible();
    await expect(
      addDialog.getByRole("button", { name: /Save Expense/i }),
    ).toBeDisabled();
    await addDialog.getByRole("button", { name: "Cancel" }).click();

    // 4. Open RecordSettlementModal via Settle now
    const unsettledCard = page.getByTestId("kpi-unsettled-pending");
    await expect(unsettledCard).toContainText("$60.00");
    await unsettledCard.getByRole("button", { name: /Settle now/i }).click();

    const settleDialog = page.getByRole("dialog", {
      name: "Record Settlement",
    });
    await expect(settleDialog).toBeVisible();

    const amountInput = settleDialog.getByLabel(/Settlement Amount \(USD\)/i);
    await expect(amountInput).toHaveValue("60.00");
    await expect(
      settleDialog.getByTestId("recipient-settlement-tag"),
    ).toContainText("@alex-rivera-99");

    const venmoLink = settleDialog.getByRole("link", { name: /Open Venmo/i });
    await expect(venmoLink).toHaveAttribute(
      "href",
      /venmo:\/\/paycharge\?txn=pay&recipients=alex-rivera-99&amount=60\.00/,
    );

    // 5. Enter partial payment ($25.00 of $60.00) and verify Log & Link updates
    await amountInput.fill("25.00");
    await expect(
      settleDialog.getByTestId("settlement-progress-hint"),
    ).toContainText("Partial payment: $35.00 will remain unsettled.");
    await expect(venmoLink).toHaveAttribute(
      "href",
      /venmo:\/\/paycharge\?txn=pay&recipients=alex-rivera-99&amount=25\.00/,
    );

    await assertNoHorizontalOverflow(page);
    await page.screenshot({
      path: path.join(screenshotDir, `issue-82-${tag}.png`),
      fullPage: true,
    });

    // 6. Submit partial settlement
    await settleDialog.getByRole("button", { name: /Mark as Settled/i }).click();
    await expect(settleDialog).toBeHidden({ timeout: 10000 });

    await expect(unsettledCard).toContainText("$35.00");
    await expect(page.getByText("LOCKED").first()).toBeVisible();

    // Verify DB settlement row persisted in Group.base_currency
    const { data: dbSettlements, error: stErr } = await admin
      .from("settlements")
      .select("amount_cents, currency, payment_rail, payer_id, recipient_id")
      .eq("group_id", groupId);
    if (stErr) throw stErr;
    expect(dbSettlements).toHaveLength(1);
    expect(dbSettlements?.[0]).toMatchObject({
      amount_cents: 2500,
      currency: "USD",
      payment_rail: "VENMO",
      payer_id: formerUserId,
      recipient_id: adminUserId,
    });

    // 7. Open modal again and settle remaining $35.00 in full
    await unsettledCard.getByRole("button", { name: /Settle now/i }).click();
    await expect(settleDialog).toBeVisible();
    await expect(
      settleDialog.getByLabel(/Settlement Amount \(USD\)/i),
    ).toHaveValue("35.00");
    await settleDialog.getByRole("button", { name: /Mark as Settled/i }).click();
    await expect(settleDialog).toBeHidden({ timeout: 10000 });

    await expect(unsettledCard).toContainText("$0.00");
    await expect(unsettledCard).toContainText("All balances settled");
    await expect(
      unsettledCard.getByRole("button", { name: /Settle now/i }),
    ).toBeDisabled();

    await assertNoHorizontalOverflow(page);
  });
});
