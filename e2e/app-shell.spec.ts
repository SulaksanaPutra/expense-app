import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import {
  authenticateContextAsUser,
  cleanupE2EGroupsForUser,
  createAdminSupabase,
  deleteE2EUsersById,
  ensureE2EUser,
} from "./helpers/supabase-auth";

const E2E_USER_EMAIL = "e2e-106-shell@ledgersplit.test";
const E2E_USER_NAME = "Jordan Doe";

function resolveScreenshotDir(): string {
  return path.resolve(process.cwd(), ".verification", "screenshots");
}

async function assertNoHorizontalOverflow(page: Page) {
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.innerWidth);
}

test.describe("Issue #106 — Static App Shell v2 Smoke & Responsive Check", () => {
  let userId = "";

  test.beforeAll(async () => {
    fs.mkdirSync(resolveScreenshotDir(), { recursive: true });
    const user = await ensureE2EUser(E2E_USER_EMAIL, E2E_USER_NAME);
    userId = user.id;
    await cleanupE2EGroupsForUser(userId);
  });

  test.afterAll(async () => {
    const admin = createAdminSupabase();
    if (userId) {
      await cleanupE2EGroupsForUser(userId);
      await admin.from("notifications").delete().eq("user_id", userId);
      await deleteE2EUsersById([userId]);
    }
  });

  test("renders App Shell v2 on desktop (1280x800) and mobile (375x812) with Notifications popover, Account menu, and zero horizontal overflow", async ({
    page,
    context,
    baseURL,
  }, testInfo) => {
    test.setTimeout(90_000);

    const isMobile = testInfo.project.name.includes("mobile");
    const resolvedBaseUrl = baseURL || "http://127.0.0.1:3100";
    const screenshotDir = resolveScreenshotDir();

    const admin = createAdminSupabase();
    await cleanupE2EGroupsForUser(userId);
    await admin.from("notifications").delete().eq("user_id", userId);

    const groupId = crypto.randomUUID();
    const stamp = Date.now();
    const { error: grpErr } = await admin.from("groups").insert({
      id: groupId,
      name: "Apartment 4B Shared",
      slug: `e2e-106-apt4b-${stamp}`,
      group_type: "RESIDENTIAL",
      status: "ACTIVE",
      base_currency: "USD",
      default_split_mode: "EQUAL",
      operational_budget_cents: 300000,
      billing_cycle_anchor_day: 1,
      invite_token: `tok-106-${stamp}`,
      invite_token_version: 1,
      created_by: userId,
    });
    if (grpErr) throw grpErr;

    const { error: memErr } = await admin.from("group_members").insert({
      group_id: groupId,
      user_id: userId,
      role: "ADMIN",
      status: "ACTIVE",
      share_percentage: 100,
    });
    if (memErr) throw memErr;

    const { error: notifErr } = await admin.from("notifications").insert([
      {
        user_id: userId,
        type: "NEW_EXPENSE",
        title: 'Marcus Kim added "ConEdison Electric"',
        description: "$140.00 · Apartment 4B Shared",
        href: `/expenses?group=${groupId}`,
        is_read: false,
      },
      {
        user_id: userId,
        type: "SETTLEMENT_CONFIRMATION",
        title: "Alex Lee marked $120.00 as settled",
        description: "Apartment 4B Shared",
        href: `/dashboard?group=${groupId}`,
        is_read: true,
      },
    ]);
    if (notifErr) throw notifErr;

    await authenticateContextAsUser(context, resolvedBaseUrl, E2E_USER_EMAIL);
    await page.goto("/dashboard", { waitUntil: "networkidle" });
    await assertNoHorizontalOverflow(page);

    // Zero LiveSyncPill or SHARED badge anywhere
    await expect(page.getByText("Live Sync")).toHaveCount(0);
    await expect(page.getByText("SHARED", { exact: true })).toHaveCount(0);

    if (!isMobile) {
      // Desktop Sidebar assertions
      const sidebar = page.getByTestId("desktop-sidebar");
      await expect(sidebar).toBeVisible();
      await expect(sidebar.getByText("LedgerSplit")).toBeVisible();
      await expect(sidebar.getByText("ACTIVE GROUP")).toBeVisible();
      await expect(
        sidebar.getByRole("button", { name: "Collapse Sidebar" }),
      ).toBeVisible();

      // Open Notifications popover, verify All | Unread filter, capture desktop screenshot
      const bellBtn = page.getByRole("button", {
        name: /Notifications \(1 unread\)/i,
      });
      await bellBtn.click();
      const popover = page.locator("#topbar-notifications-popover");
      await expect(popover).toBeVisible();
      await expect(
        popover.getByRole("tab", { name: "Unread (1)" }),
      ).toBeVisible();
      await assertNoHorizontalOverflow(page);

      await page.screenshot({
        path: path.join(screenshotDir, "issue-106-desktop.png"),
        fullPage: false,
      });

      // Test Unread filter & Mark all read
      await popover.getByRole("tab", { name: "Unread (1)" }).click();
      await expect(
        popover.getByText(/Marcus Kim added "ConEdison Electric"/i),
      ).toBeVisible();
      await expect(
        popover.getByText(/Alex Lee marked \$120\.00 as settled/i),
      ).toHaveCount(0);

      await popover.getByRole("button", { name: "Mark all read" }).click();
      await expect(popover.getByText("No unread notifications.")).toBeVisible();

      // Close notifications & test User Account menu
      await page.keyboard.press("Escape");
      const accountBtn = page.getByRole("button", { name: "User profile menu" });
      await accountBtn.click();
      const accountMenu = page.getByRole("menu", { name: "User account menu" });
      await expect(accountMenu).toBeVisible();
      await expect(accountMenu.getByText(E2E_USER_NAME)).toBeVisible();
      await expect(accountMenu.getByText(E2E_USER_EMAIL)).toBeVisible();
      await expect(accountMenu.getByText("Default Currency")).toBeVisible();
      await expect(
        accountMenu.getByRole("menuitem", { name: "Settings" }),
      ).toBeVisible();
      await expect(
        accountMenu.getByRole("menuitem", { name: /Keyboard Shortcuts/i }),
      ).toBeVisible();
      await expect(
        accountMenu.getByRole("menuitem", { name: /Export Monthly Ledger/i }),
      ).toBeVisible();
      await expect(
        accountMenu.getByRole("menuitem", { name: "Sign Out" }),
      ).toBeVisible();
      await assertNoHorizontalOverflow(page);
    } else {
      // Mobile (< 1024px) assertions
      await expect(page.getByTestId("desktop-sidebar")).toBeHidden();
      const menuBtn = page.getByRole("button", { name: "Open navigation menu" });
      await expect(menuBtn).toBeVisible();
      await assertNoHorizontalOverflow(page);

      await page.screenshot({
        path: path.join(screenshotDir, "issue-106-mobile.png"),
        fullPage: false,
      });

      // Open Mobile Drawer and verify zero horizontal overflow
      await menuBtn.click();
      const drawer = page.getByRole("dialog", { name: "Mobile navigation" });
      await expect(drawer).toBeVisible();
      await expect(drawer.getByText("ACTIVE GROUP")).toBeVisible();
      await assertNoHorizontalOverflow(page);
      await drawer
        .getByRole("button", { name: "Close navigation menu" })
        .click();
      await expect(drawer).toHaveCount(0);

      // Verify Notifications popover & Account menu fit on mobile with zero overflow
      await page.getByRole("button", { name: /Notifications/i }).click();
      await expect(
        page.locator("#topbar-notifications-popover"),
      ).toBeVisible();
      await assertNoHorizontalOverflow(page);
      await page.keyboard.press("Escape");

      await page.getByRole("button", { name: "User profile menu" }).click();
      await expect(
        page.getByRole("menu", { name: "User account menu" }),
      ).toBeVisible();
      await assertNoHorizontalOverflow(page);
    }
  });
});
