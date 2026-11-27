import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import {
  authenticateContextAsUser,
  cleanupE2EGroupsForUser,
  createAdminSupabase,
  ensureE2EUser,
} from "./helpers/supabase-auth";

const E2E_ALICE_EMAIL = "e2e-85-alice@ledgersplit.test";
const E2E_ALICE_NAME = "Alice Rivera";
const E2E_BOB_EMAIL = "e2e-85-bob@ledgersplit.test";
const E2E_BOB_NAME = "Bob Chen";
const E2E_CHARLIE_EMAIL = "e2e-85-charlie@ledgersplit.test";
const E2E_CHARLIE_NAME = "Charlie Patel";
const E2E_LIAM_EMAIL = "e2e-85-liam@ledgersplit.test";
const E2E_LIAM_NAME = "Liam Brooks";

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

async function deleteTestUsers(userIds: string[]) {
  const admin = createAdminSupabase();
  for (const id of userIds) {
    if (!id) continue;
    try {
      await admin.from("users").delete().eq("id", id);
    } catch {
      // Ignore if FK constraints exist on unrelated records
    }
    try {
      await admin.auth.admin.deleteUser(id);
    } catch {
      // Ignore auth cleanup errors
    }
  }
}

test.describe("Issue #85 — Hybrid Locking (Cycle Close + Pairwise Watermark) & Offsetting Adjustments", () => {
  let aliceId = "";
  let bobId = "";
  let charlieId = "";
  let liamId = "";

  test.beforeAll(async () => {
    const [alice, bob, charlie, liam] = await Promise.all([
      ensureE2EUser(E2E_ALICE_EMAIL, E2E_ALICE_NAME),
      ensureE2EUser(E2E_BOB_EMAIL, E2E_BOB_NAME),
      ensureE2EUser(E2E_CHARLIE_EMAIL, E2E_CHARLIE_NAME),
      ensureE2EUser(E2E_LIAM_EMAIL, E2E_LIAM_NAME),
    ]);
    aliceId = alice.id;
    bobId = bob.id;
    charlieId = charlie.id;
    liamId = liam.id;
    await cleanupE2EGroupsForUser(aliceId);
  });

  test.afterAll(async () => {
    if (aliceId) {
      await cleanupE2EGroupsForUser(aliceId);
    }
    await deleteTestUsers([aliceId, bobId, charlieId, liamId]);
  });

  test("verifies pairwise 4-way watermark lock, Offsetting Adjustment mode, and ADMIN Close & Lock Cycle across desktop & mobile", async ({
    page,
    context,
    baseURL,
  }, testInfo) => {
    const isMobile = testInfo.project.name.includes("mobile");
    const tag = isMobile ? "mobile" : "desktop";
    const resolvedBaseUrl = baseURL || "http://127.0.0.1:3180";
    const screenshotDir = resolveScreenshotDir();
    fs.mkdirSync(screenshotDir, { recursive: true });

    await cleanupE2EGroupsForUser(aliceId);

    const admin = createAdminSupabase();
    const groupId = crypto.randomUUID();
    const groupName = `[E2E] Issue 85 Apt 4B ${tag}`;
    const slug = `e2e-85-${tag}-${Date.now()}`;
    const now = new Date();
    const cycleSlug = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    const expenseDateIso = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 10, 12, 0, 0),
    ).toISOString();

    const { error: groupErr } = await admin.from("groups").insert({
      id: groupId,
      name: groupName,
      slug,
      group_type: "RESIDENTIAL",
      status: "ACTIVE",
      base_currency: "USD",
      default_split_mode: "EQUAL",
      simplify_debts: false,
      operational_budget_cents: 450000,
      billing_cycle_anchor_day: 1,
      invite_token: `e2e-85-token-${Date.now()}`,
    });
    expect(groupErr).toBeNull();

    const { error: membersErr } = await admin.from("group_members").insert([
      { group_id: groupId, user_id: aliceId, role: "ADMIN", status: "ACTIVE", share_percentage: 25 },
      { group_id: groupId, user_id: bobId, role: "MEMBER", status: "ACTIVE", share_percentage: 25 },
      { group_id: groupId, user_id: charlieId, role: "MEMBER", status: "ACTIVE", share_percentage: 25 },
      { group_id: groupId, user_id: liamId, role: "MEMBER", status: "ACTIVE", share_percentage: 25 },
    ]);
    expect(membersErr).toBeNull();

    const fourWayId = crypto.randomUUID();
    const twoWayId = crypto.randomUUID();
    const { error: expErr } = await admin.from("expenses").insert([
      {
        id: fourWayId,
        group_id: groupId,
        created_by: charlieId,
        paid_by: aliceId,
        description: "4-Way Internet & Power",
        category: "Utilities",
        expense_date: expenseDateIso,
        amount_cents: 12000,
        currency: "USD",
        split_method: "EQUAL",
        split_breakdown: [
          { user_id: aliceId, share_cents: 3000, percentage: 25 },
          { user_id: bobId, share_cents: 3000, percentage: 25 },
          { user_id: charlieId, share_cents: 3000, percentage: 25 },
          { user_id: liamId, share_cents: 3000, percentage: 25 },
        ],
        is_locked: false,
      },
      {
        id: twoWayId,
        group_id: groupId,
        created_by: charlieId,
        paid_by: charlieId,
        description: "Charlie & Liam Coffee",
        category: "Groceries & Food",
        expense_date: expenseDateIso,
        amount_cents: 4000,
        currency: "USD",
        split_method: "EQUAL",
        split_breakdown: [
          { user_id: charlieId, share_cents: 2000, percentage: 50 },
          { user_id: liamId, share_cents: 2000, percentage: 50 },
        ],
        is_locked: false,
      },
    ]);
    expect(expErr).toBeNull();

    // Bob settles $30.00 with Alice -> triggers Pairwise Settlement Watermark lock on 4-way expense
    await authenticateContextAsUser(context, resolvedBaseUrl, E2E_BOB_EMAIL);
    const settleRes = await page.request.post(
      `${resolvedBaseUrl}/api/groups/${groupId}/settlements`,
      {
        data: {
          payer_id: bobId,
          recipient_id: aliceId,
          amount_cents: 3000,
          payment_rail: "VENMO",
        },
      },
    );
    expect(settleRes.status()).toBe(201);

    // Verify in DB that 4-way expense is_locked = true while Charlie & Liam's expense is still false
    const { data: afterSettleRows } = await admin
      .from("expenses")
      .select("id, is_locked")
      .in("id", [fourWayId, twoWayId]);
    const fourWayAfter = afterSettleRows?.find((r) => r.id === fourWayId);
    const twoWayAfter = afterSettleRows?.find((r) => r.id === twoWayId);
    expect(fourWayAfter?.is_locked).toBe(true);
    expect(twoWayAfter?.is_locked).toBe(false);

    // Authenticate as Charlie (non-settling member) and open /expenses
    await authenticateContextAsUser(context, resolvedBaseUrl, E2E_CHARLIE_EMAIL);
    await page.goto(
      `${resolvedBaseUrl}/expenses?group=${encodeURIComponent(groupId)}&cycle=${encodeURIComponent(cycleSlug)}`,
      { waitUntil: "domcontentloaded" },
    );

    await expect(page.getByText("4-Way Internet & Power")).toBeVisible();
    await assertNoHorizontalOverflow(page);

    // Charlie's action menu on locked 4-way expense offers Log Adjustment (not Edit Expense)
    await page
      .getByRole("button", { name: /Actions for 4-Way Internet & Power/i })
      .click();
    await expect(
      page.getByRole("menuitem", { name: /Log Adjustment/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("menuitem", { name: /Edit Expense/i }),
    ).toHaveCount(0);

    await page.getByRole("menuitem", { name: /Log Adjustment/i }).click();
    await expect(
      page.getByRole("heading", { name: /Log Offsetting Adjustment/i }),
    ).toBeVisible();

    const amountInput = page.getByLabel(/Amount/i);
    await amountInput.fill("-20.00");
    await page.getByRole("button", { name: /Save Adjustment/i }).click();

    await expect(
      page.getByText("Adjustment: 4-Way Internet & Power", { exact: true }),
    ).toBeVisible();
    await assertNoHorizontalOverflow(page);

    // Now authenticate as Alice (ADMIN) and Close & Lock Billing Cycle
    await authenticateContextAsUser(context, resolvedBaseUrl, E2E_ALICE_EMAIL);
    await page.goto(
      `${resolvedBaseUrl}/expenses?group=${encodeURIComponent(groupId)}&cycle=${encodeURIComponent(cycleSlug)}`,
      { waitUntil: "domcontentloaded" },
    );

    const closeCycleBtn = page.getByRole("button", {
      name: /Close & Lock Cycle/i,
    });
    await expect(closeCycleBtn).toBeVisible();
    await closeCycleBtn.click();

    const confirmBtn = page
      .getByRole("dialog")
      .getByRole("button", { name: /Close & Lock Cycle/i });
    await confirmBtn.click();

    await expect(page.getByText("Closed Period")).toBeVisible();
    await assertNoHorizontalOverflow(page);

    await page.screenshot({
      path: path.join(screenshotDir, `issue-85-${tag}.png`),
      fullPage: true,
    });

    // Verify all cycle expenses are now locked in DB
    const { data: afterCloseRows } = await admin
      .from("expenses")
      .select("id, is_locked")
      .eq("group_id", groupId)
      .is("deleted_at", null);
    expect(afterCloseRows?.every((r) => r.is_locked)).toBe(true);
  });
});
