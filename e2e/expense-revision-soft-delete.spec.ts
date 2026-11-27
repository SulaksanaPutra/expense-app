import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import {
  authenticateContextAsUser,
  cleanupE2EGroupsForUser,
  createAdminSupabase,
  ensureE2EUser,
} from "./helpers/supabase-auth";

const E2E_ADMIN_EMAIL = "e2e-80-admin@ledgersplit.test";
const E2E_ADMIN_NAME = "Alex Rivera";
const E2E_MEMBER_EMAIL = "e2e-80-member@ledgersplit.test";
const E2E_MEMBER_NAME = "Elena Rostova";
const E2E_THIRD_EMAIL = "e2e-80-third@ledgersplit.test";
const E2E_THIRD_NAME = "Marcus Vance";

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

test.describe("Issue #80 — Pre-lock Expense editing (ExpenseRevision), notifications & soft-delete", () => {
  let adminUserId = "";
  let memberUserId = "";
  let thirdUserId = "";

  test.beforeAll(async () => {
    const [adminUser, memberUser, thirdUser] = await Promise.all([
      ensureE2EUser(E2E_ADMIN_EMAIL, E2E_ADMIN_NAME),
      ensureE2EUser(E2E_MEMBER_EMAIL, E2E_MEMBER_NAME),
      ensureE2EUser(E2E_THIRD_EMAIL, E2E_THIRD_NAME),
    ]);
    adminUserId = adminUser.id;
    memberUserId = memberUser.id;
    thirdUserId = thirdUser.id;
    await cleanupE2EGroupsForUser(adminUserId);
  });

  test.afterAll(async () => {
    if (adminUserId) {
      await cleanupE2EGroupsForUser(adminUserId);
    }
  });

  test("enforces role/lock gates, records ExpenseRevision & share-shift notifications, and soft-deletes across desktop & mobile", async ({
    page,
    context,
    baseURL,
  }, testInfo) => {
    const isMobile = testInfo.project.name.includes("mobile");
    const tag = isMobile ? "mobile" : "desktop";
    const resolvedBaseUrl = baseURL || "http://127.0.0.1:3180";
    const screenshotDir = resolveScreenshotDir();
    fs.mkdirSync(screenshotDir, { recursive: true });

    await cleanupE2EGroupsForUser(adminUserId);

    const admin = createAdminSupabase();
    const groupId = crypto.randomUUID();
    const groupName = `[E2E] Issue 80 Apt 4B ${tag}`;
    const slug = `e2e-80-${tag}-${Date.now()}`;

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
      invite_token: `tok-80-${tag}-${Date.now()}`,
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
        share_percentage: 33.34,
        joined_at: "2026-10-01T00:00:00.000Z",
      },
      {
        group_id: groupId,
        user_id: memberUserId,
        role: "MEMBER",
        status: "ACTIVE",
        share_percentage: 33.33,
        joined_at: "2026-10-02T00:00:00.000Z",
      },
      {
        group_id: groupId,
        user_id: thirdUserId,
        role: "MEMBER",
        status: "ACTIVE",
        share_percentage: 33.33,
        joined_at: "2026-10-03T00:00:00.000Z",
      },
    ]);
    if (membersErr) throw membersErr;

    const now = new Date();
    const cycleSlug = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

    const memberOwnId = crypto.randomUUID();
    const adminOwnId = crypto.randomUUID();
    const lockedId = crypto.randomUUID();

    const { error: expErr } = await admin.from("expenses").insert([
      {
        id: memberOwnId,
        group_id: groupId,
        created_by: memberUserId,
        paid_by: memberUserId,
        description: `[E2E] Elena Groceries ${tag}`,
        category: "Groceries & Food",
        expense_date: `${cycleSlug}-20T12:00:00.000Z`,
        amount_cents: 9000,
        currency: "USD",
        split_method: "EQUAL",
        split_breakdown: [
          { user_id: adminUserId, share_cents: 3000, percentage: 33.33 },
          { user_id: memberUserId, share_cents: 3000, percentage: 33.34 },
          { user_id: thirdUserId, share_cents: 3000, percentage: 33.33 },
        ],
        is_locked: false,
      },
      {
        id: adminOwnId,
        group_id: groupId,
        created_by: adminUserId,
        paid_by: adminUserId,
        description: `[E2E] Alex Internet ${tag}`,
        category: "Utilities",
        expense_date: `${cycleSlug}-18T12:00:00.000Z`,
        amount_cents: 6000,
        currency: "USD",
        split_method: "EQUAL",
        split_breakdown: [
          { user_id: adminUserId, share_cents: 2000, percentage: 33.34 },
          { user_id: memberUserId, share_cents: 2000, percentage: 33.33 },
          { user_id: thirdUserId, share_cents: 2000, percentage: 33.33 },
        ],
        is_locked: false,
      },
      {
        id: lockedId,
        group_id: groupId,
        created_by: memberUserId,
        paid_by: memberUserId,
        description: `[E2E] Locked Coffee ${tag}`,
        category: "Dining Out",
        expense_date: `${cycleSlug}-10T12:00:00.000Z`,
        amount_cents: 3000,
        currency: "USD",
        split_method: "EQUAL",
        split_breakdown: [
          { user_id: adminUserId, share_cents: 1000, percentage: 33.33 },
          { user_id: memberUserId, share_cents: 1000, percentage: 33.34 },
          { user_id: thirdUserId, share_cents: 1000, percentage: 33.33 },
        ],
        is_locked: false,
      },
    ]);
    if (expErr) throw expErr;

    // Lock `[E2E] Locked Coffee` via a CLOSED BillingCycle covering days 01..12
    const { error: bcErr } = await admin.from("billing_cycles").insert({
      group_id: groupId,
      period_start: `${cycleSlug}-01`,
      period_end: `${cycleSlug}-12`,
      status: "CLOSED",
      closed_by: adminUserId,
      closed_at: new Date().toISOString(),
    });
    if (bcErr) throw bcErr;

    // 1. Authenticate as MEMBER (Elena) and verify permission gates + edit flow
    await authenticateContextAsUser(context, resolvedBaseUrl, E2E_MEMBER_EMAIL);
    await page.goto(`/expenses?group=${groupId}&cycle=${cycleSlug}`, {
      waitUntil: "networkidle",
    });
    await assertNoHorizontalOverflow(page);

    const totalCard = page.getByTestId("kpi-total-group-expenses");
    await expect(totalCard).toContainText("$180.00");

    // Non-creator unlocked expense (Alex Internet) -> Edit/Delete hidden for MEMBER
    await page
      .getByRole("button", { name: `Actions for [E2E] Alex Internet ${tag}` })
      .click();
    await expect(
      page.getByRole("menuitem", { name: "View Split Details" }),
    ).toBeVisible();
    await expect(
      page.getByRole("menuitem", { name: "Edit Expense" }),
    ).toBeHidden();
    await expect(
      page.getByRole("menuitem", { name: "Delete Expense" }),
    ).toBeHidden();
    await page.keyboard.press("Escape");

    // Locked expense (Locked Coffee) -> Edit/Delete hidden even for creator
    await page
      .getByRole("button", { name: `Actions for [E2E] Locked Coffee ${tag}` })
      .click();
    await expect(
      page.getByRole("menuitem", { name: "Edit Expense" }),
    ).toBeHidden();
    await page.keyboard.press("Escape");

    // Creator's own unlocked expense (Elena Groceries) -> Edit & Delete available
    await page
      .getByRole("button", { name: `Actions for [E2E] Elena Groceries ${tag}` })
      .click();
    await page.getByRole("menuitem", { name: "Edit Expense" }).click();

    const editDialog = page.getByRole("dialog", { name: "Edit Expense" });
    await expect(editDialog).toBeVisible();
    await editDialog.getByLabel(/Total Bill Amount/i).fill("120.00");
    await editDialog
      .getByLabel(/Description/i)
      .fill(`[E2E] Edited Groceries ${tag}`);

    const [patchRes] = await Promise.all([
      page.waitForResponse(
        (res) =>
          res.url().includes(`/api/groups/${groupId}/expenses/${memberOwnId}`) &&
          res.request().method() === "PATCH",
      ),
      editDialog
        .getByRole("button", { name: /Save Changes \(\$120\.00\)/i })
        .click(),
    ]);
    expect(patchRes.status()).toBe(200);
    await expect(editDialog).toBeHidden();

    // Verify updated row and KPI ($180 -> $210.00)
    const editedRow = page.getByTestId(`expense-row-${memberOwnId}`);
    await expect(editedRow).toContainText(`[E2E] Edited Groceries ${tag}`);
    await expect(editedRow).toContainText("$120.00");
    await expect(totalCard).toContainText("$210.00");

    // Verify ExpenseRevision and share-shift notifications persisted in Supabase
    const { data: revisions } = await admin
      .from("expense_revisions")
      .select("id, updated_by, old_snapshot, new_snapshot")
      .eq("expense_id", memberOwnId);
    expect(revisions).toHaveLength(1);
    expect(revisions![0].updated_by).toBe(memberUserId);

    const { data: adminNotifs } = await admin
      .from("notifications")
      .select("id, user_id, delta_cents, description, is_read")
      .eq("expense_id", memberOwnId)
      .eq("user_id", adminUserId);
    expect(adminNotifs).toHaveLength(1);
    expect(adminNotifs![0].delta_cents).toBe(1000);

    // 2. Switch to ADMIN (Alex), inspect share-shift notification, capture screenshot, then soft-delete Elena's expense
    await context.clearCookies();
    await authenticateContextAsUser(context, resolvedBaseUrl, E2E_ADMIN_EMAIL);
    await page.goto(`/expenses?group=${groupId}&cycle=${cycleSlug}`, {
      waitUntil: "networkidle",
    });
    await assertNoHorizontalOverflow(page);

    // Notification bell shows unread share-shift notification
    const notifBell = page.getByRole("button", {
      name: /Notifications \(\d+ unread\)/i,
    });
    await expect(notifBell).toBeVisible();
    await notifBell.click();
    const notifPopover = page.getByRole("region", { name: "Notifications" });
    await expect(notifPopover).toContainText("Expense share updated");
    await expect(notifPopover).toContainText("$30.00 to $40.00");
    await page.keyboard.press("Escape");

    await page.screenshot({
      path: path.join(screenshotDir, `issue-80-${tag}.png`),
      fullPage: true,
    });

    // ADMIN can soft-delete Elena's unlocked expense via ConfirmDialog
    await page
      .getByRole("button", {
        name: `Actions for [E2E] Edited Groceries ${tag}`,
      })
      .click();
    await page.getByRole("menuitem", { name: "Delete Expense" }).click();

    const confirmDialog = page.getByRole("dialog", { name: "Delete Expense" });
    await expect(confirmDialog).toBeVisible();

    const [delRes] = await Promise.all([
      page.waitForResponse(
        (res) =>
          res.url().includes(`/api/groups/${groupId}/expenses/${memberOwnId}`) &&
          res.request().method() === "DELETE",
      ),
      confirmDialog.getByRole("button", { name: "Delete Expense" }).click(),
    ]);
    expect(delRes.status()).toBe(200);
    await expect(confirmDialog).toBeHidden();

    // Soft-deleted row excluded from ledger list & KPI balances ($210 -> $90.00)
    await expect(
      page.getByTestId(`expense-row-${memberOwnId}`),
    ).toBeHidden();
    await expect(totalCard).toContainText("$90.00");

    // Reload to confirm server-side exclusion of deleted_at IS NOT NULL
    await page.reload({ waitUntil: "networkidle" });
    await expect(
      page.getByTestId(`expense-row-${memberOwnId}`),
    ).toBeHidden();
    await expect(totalCard).toContainText("$90.00");
    await assertNoHorizontalOverflow(page);

    const { data: deletedRow } = await admin
      .from("expenses")
      .select("deleted_at")
      .eq("id", memberOwnId)
      .single();
    expect(deletedRow?.deleted_at).not.toBeNull();
  });
});
