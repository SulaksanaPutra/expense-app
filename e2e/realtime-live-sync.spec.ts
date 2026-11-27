import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import {
  authenticateContextAsUser,
  cleanupE2EGroupsForUser,
  createAdminSupabase,
  ensureE2EUser,
} from "./helpers/supabase-auth";

const E2E_ALEX_EMAIL = "e2e-88-alex@ledgersplit.test";
const E2E_ALEX_NAME = "Alex Rivera";
const E2E_ELENA_EMAIL = "e2e-88-elena@ledgersplit.test";
const E2E_ELENA_NAME = "Elena Rostova";

function resolveScreenshotDir(): string {
  const cwd = process.cwd();
  const marker = `${path.sep}.worktrees${path.sep}`;
  const idx = cwd.indexOf(marker);
  const repoRoot = idx >= 0 ? cwd.slice(0, idx) : cwd;
  return path.resolve(repoRoot, ".verification", "screenshots");
}

function getCurrentCycleSlug(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
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

test.describe("Issue #88 — Supabase Realtime Live Sync pill & Notification Bell", () => {
  let alexUserId = "";
  let elenaUserId = "";

  test.beforeAll(async () => {
    const [alex, elena] = await Promise.all([
      ensureE2EUser(E2E_ALEX_EMAIL, E2E_ALEX_NAME),
      ensureE2EUser(E2E_ELENA_EMAIL, E2E_ELENA_NAME),
    ]);
    alexUserId = alex.id;
    elenaUserId = elena.id;
    await cleanupE2EGroupsForUser(alexUserId);
  });

  test.afterAll(async () => {
    const admin = createAdminSupabase();
    if (alexUserId) {
      await cleanupE2EGroupsForUser(alexUserId);
    }
    for (const uid of [alexUserId, elenaUserId]) {
      if (uid) {
        await admin.from("notifications").delete().eq("user_id", uid);
        await admin.auth.admin.deleteUser(uid).catch(() => {});
      }
    }
  });

  test("reflects Realtime status transitions and streams new expenses, share revisions, and settlements into Dashboard and Notification Bell without reload", async ({
    page,
    context,
    browser,
    baseURL,
  }, testInfo) => {
    test.setTimeout(90_000);
    const isMobile = testInfo.project.name.includes("mobile");
    const tag = isMobile ? "mobile" : "desktop";
    const resolvedBaseUrl = baseURL || "http://127.0.0.1:3100";
    const screenshotDir = resolveScreenshotDir();
    fs.mkdirSync(screenshotDir, { recursive: true });

    await cleanupE2EGroupsForUser(alexUserId);
    const admin = createAdminSupabase();
    await admin
      .from("notifications")
      .delete()
      .in("user_id", [alexUserId, elenaUserId]);

    const groupId = crypto.randomUUID();
    const stamp = Date.now();
    const cycle = getCurrentCycleSlug();

    const { error: grpErr } = await admin.from("groups").insert({
      id: groupId,
      name: `[E2E] Issue 88 Live Sync ${tag}`,
      slug: `e2e-88-live-${tag}-${stamp}`,
      group_type: "RESIDENTIAL",
      status: "ACTIVE",
      base_currency: "USD",
      default_split_mode: "EQUAL",
      simplify_debts: true,
      operational_budget_cents: 300000,
      billing_cycle_anchor_day: 1,
      invite_token: `tok-88-${tag}-${stamp}`,
      invite_token_version: 1,
      created_by: alexUserId,
    });
    if (grpErr) throw grpErr;

    const { error: memErr } = await admin.from("group_members").insert([
      {
        group_id: groupId,
        user_id: alexUserId,
        role: "ADMIN",
        status: "ACTIVE",
        share_percentage: 50,
      },
      {
        group_id: groupId,
        user_id: elenaUserId,
        role: "MEMBER",
        status: "ACTIVE",
        share_percentage: 50,
      },
    ]);
    if (memErr) throw memErr;

    await authenticateContextAsUser(context, resolvedBaseUrl, E2E_ELENA_EMAIL);

    // 1. Verify Live Sync pill is subscribed on /dashboard (and omitted from TopBar)
    await page.goto(`/dashboard?group=${groupId}&cycle=${cycle}`, {
      waitUntil: "networkidle",
    });
    await assertNoHorizontalOverflow(page);

    const topBar = page.locator("header").first();
    await expect(topBar.getByText("Live Sync")).toHaveCount(0);

    const liveSyncPill = page.locator('[data-sync-status="subscribed"]');
    await expect(liveSyncPill).toBeVisible({ timeout: 20_000 });
    await expect(liveSyncPill).toHaveText("Live Sync");

    // 2. Verify Live Sync pill transitions to Offline and recovers to Live Sync
    await context.setOffline(true);
    const offlinePill = page.locator('[data-sync-status="offline"]');
    await expect(offlinePill).toBeVisible({ timeout: 10_000 });
    await expect(offlinePill).toHaveText("Offline");

    await context.setOffline(false);
    await expect(page.locator('[data-sync-status="subscribed"]')).toBeVisible({
      timeout: 20_000,
    });

    // 3. Open second authenticated context as Alex to perform mutations while Elena watches live
    const alexCtx = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });

    try {
      await authenticateContextAsUser(
        alexCtx,
        resolvedBaseUrl,
        E2E_ALEX_EMAIL,
      );
      const alexPage = await alexCtx.newPage();

      // 3a. Alex creates a new expense ($60.00 split evenly -> Elena owes $30.00)
      const createRes = await alexPage.request.post(
        `${resolvedBaseUrl}/api/groups/${groupId}/expenses`,
        {
          data: {
            paid_by: alexUserId,
            description: `[E2E] Live Coffee ${tag}`,
            category: "Food & Drink",
            amount_cents: 6000,
            expense_date: `${cycle}-14T12:00:00.000Z`,
            split_method: "EQUAL",
            split_breakdown: [
              { user_id: alexUserId, share_cents: 3000, percentage: 50 },
              { user_id: elenaUserId, share_cents: 3000, percentage: 50 },
            ],
          },
        },
      );
      expect(createRes.status()).toBe(201);
      const createJson = (await createRes.json()) as {
        expense: { id: string };
      };
      const expenseId = createJson.expense.id;

      // Elena's Dashboard updates WITHOUT manual page.reload()
      await expect(
        page.getByText(`[E2E] Live Coffee ${tag}`).first(),
      ).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId("kpi-total-spent")).toContainText("$60.00", {
        timeout: 15_000,
      });
      await expect(page.getByTestId("kpi-you-owe")).toContainText("-$30.00", {
        timeout: 15_000,
      });
      await expect(page.getByTestId("notification-unread-dot")).toBeVisible({
        timeout: 15_000,
      });

      // 3b. Alex edits the unlocked expense ($60.00 -> $80.00, Elena's share $30 -> $40)
      const patchRes = await alexPage.request.patch(
        `${resolvedBaseUrl}/api/groups/${groupId}/expenses/${expenseId}`,
        {
          data: {
            paid_by: alexUserId,
            description: `[E2E] Live Coffee Revised ${tag}`,
            category: "Food & Drink",
            amount_cents: 8000,
            expense_date: `${cycle}-14T12:00:00.000Z`,
            split_method: "EQUAL",
            split_breakdown: [
              { user_id: alexUserId, share_cents: 4000, percentage: 50 },
              { user_id: elenaUserId, share_cents: 4000, percentage: 50 },
            ],
          },
        },
      );
      expect(patchRes.status()).toBe(200);

      await expect(
        page.getByText(`[E2E] Live Coffee Revised ${tag}`).first(),
      ).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId("kpi-total-spent")).toContainText("$80.00", {
        timeout: 15_000,
      });
      await expect(page.getByTestId("kpi-you-owe")).toContainText("-$40.00", {
        timeout: 15_000,
      });

      // 3c. Alex records a $40.00 settlement (Elena -> Alex)
      const settleRes = await alexPage.request.post(
        `${resolvedBaseUrl}/api/groups/${groupId}/settlements`,
        {
          data: {
            payer_id: elenaUserId,
            recipient_id: alexUserId,
            amount_cents: 4000,
            payment_rail: "VENMO",
          },
        },
      );
      expect(settleRes.status()).toBe(201);

      await expect(page.getByTestId("kpi-you-owe")).toContainText("$0.00", {
        timeout: 20_000,
      });

      // 4. Verify Notification Bell lists all 3 live notifications with unread dot & count
      const bellBtn = page.getByRole("button", {
        name: "Notifications (3 unread)",
      });
      await expect(bellBtn).toBeVisible({ timeout: 15_000 });
      await bellBtn.click();

      const popover = page.locator("#topbar-notifications-popover");
      await expect(popover).toBeVisible();
      await expect(popover.getByText("3 unread")).toBeVisible();
      await expect(popover.getByText("New Expense Logged")).toBeVisible();
      await expect(popover.getByText("Expense share updated")).toBeVisible();
      await expect(popover.getByText("Settlement confirmed")).toBeVisible();
      await assertNoHorizontalOverflow(page);

      // Capture verification screenshot with Live Sync pill and Notification Bell popover open
      await page.screenshot({
        path: path.join(screenshotDir, `issue-88-${tag}.png`),
        fullPage: true,
      });

      // 5. Click Mark all read -> unread dot disappears and persists across reload
      const [markReadRes] = await Promise.all([
        page.waitForResponse(
          (res) =>
            res.url().includes("/api/notifications") &&
            res.request().method() === "PATCH",
        ),
        popover.getByRole("button", { name: "Mark all read" }).click(),
      ]);
      expect(markReadRes.status()).toBe(200);
      await expect(
        page.getByTestId("notification-unread-dot"),
      ).not.toBeVisible();
      await expect(
        page.getByRole("button", { name: "Notifications" }),
      ).toBeVisible();

      await page.reload({ waitUntil: "networkidle" });
      await expect(
        page.getByTestId("notification-unread-dot"),
      ).not.toBeVisible();
      await expect(
        page.getByRole("button", { name: "Notifications" }),
      ).toBeVisible();

      // 6. Also verify Live Sync pill on /expenses
      await page.goto(`/expenses?group=${groupId}&cycle=${cycle}`, {
        waitUntil: "networkidle",
      });
      await expect(page.locator('[data-sync-status="subscribed"]')).toBeVisible({
        timeout: 20_000,
      });
      await assertNoHorizontalOverflow(page);
    } finally {
      await alexCtx.close();
    }
  });
});
