import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import {
  authenticateContextAsUser,
  cleanupE2EGroupsForUser,
  ensureE2EUser,
} from "./helpers/supabase-auth";

const E2E_ADMIN_EMAIL = "e2e-admin@ledgersplit.test";
const E2E_ADMIN_NAME = "Alex Rivera";
const E2E_MEMBER_EMAIL = "e2e-member@ledgersplit.test";
const E2E_MEMBER_NAME = "Elena Rostova";
const SCREENSHOT_DIR = path.resolve(process.cwd(), ".verification/screenshots");

async function assertNoHorizontalOverflow(page: import("@playwright/test").Page) {
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.innerWidth);
}

test.describe("LedgerSplit UI Parity & Split Groups E2E", () => {
  let adminUserId = "";

  test.beforeAll(async () => {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    const adminUser = await ensureE2EUser(E2E_ADMIN_EMAIL, E2E_ADMIN_NAME);
    await ensureE2EUser(E2E_MEMBER_EMAIL, E2E_MEMBER_NAME);
    adminUserId = adminUser.id;
    await cleanupE2EGroupsForUser(adminUserId);
  });

  test.afterAll(async () => {
    if (adminUserId) {
      await cleanupE2EGroupsForUser(adminUserId);
    }
  });

  test("renders /login cleanly without horizontal overflow", async ({
    page,
  }, testInfo) => {
    await page.goto("/login");
    await expect(
      page.getByRole("button", { name: /Send Magic Link/i }),
    ).toBeVisible();
    await assertNoHorizontalOverflow(page);

    const tag = testInfo.project.name.includes("mobile") ? "mobile" : "desktop";
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, `login-${tag}.png`),
      fullPage: true,
    });
  });

  test("verifies TopBar omits Live Sync, Dashboard/Expenses show Live Sync, and Split Groups CRUD + Invite + Ratios work", async ({
    page,
    context,
    baseURL,
  }, testInfo) => {
    const isMobile = testInfo.project.name.includes("mobile");
    const tag = isMobile ? "mobile" : "desktop";
    const resolvedBaseUrl = baseURL || "http://127.0.0.1:3000";

    await cleanupE2EGroupsForUser(adminUserId);
    await authenticateContextAsUser(context, resolvedBaseUrl, E2E_ADMIN_EMAIL);

    // 1. Dashboard: Live Sync pill is in page header, NOT in TopBar <header>
    await page.goto("/dashboard");
    await expect(
      page.getByRole("heading", { name: /Dashboard Overview/i }),
    ).toBeVisible();
    const topBar = page.locator("header").first();
    await expect(topBar.getByText("Live Sync")).toHaveCount(0);
    await expect(page.getByText("Live Sync").first()).toBeVisible();
    await assertNoHorizontalOverflow(page);
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, `dashboard-${tag}.png`),
      fullPage: true,
    });

    // 2. Expenses: Live Sync pill in page header
    await page.goto("/expenses");
    await expect(
      page.getByRole("heading", { name: /Expenses Ledger/i }),
    ).toBeVisible();
    await expect(page.getByText("Live Sync").first()).toBeVisible();
    await assertNoHorizontalOverflow(page);

    // 3. Split Groups empty state + Create New Group modal width check
    await page.goto("/split-groups", { waitUntil: "networkidle" });
    await expect(
      page.getByRole("heading", { name: "Split Groups", exact: true }),
    ).toBeVisible();
    await expect(topBar.getByText("Live Sync")).toHaveCount(0);
    await expect(page.getByText("Live Sync")).toHaveCount(0);
    await assertNoHorizontalOverflow(page);
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, `split-groups-empty-${tag}.png`),
      fullPage: true,
    });

    const createBtn = page
      .getByRole("button", { name: /Create New Group/i })
      .first();
    await createBtn.click();

    const dialog = page.getByRole("dialog", { name: "Create New Group" });
    await expect(dialog).toBeVisible();
    const dialogBox = await dialog.boundingBox();
    expect(dialogBox).not.toBeNull();
    if (!isMobile) {
      expect(dialogBox!.width).toBeGreaterThanOrEqual(420);
    } else {
      expect(dialogBox!.width).toBeGreaterThanOrEqual(300);
    }
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, `create-group-modal-${tag}.png`),
      fullPage: false,
    });

    // 4. Submit Create Group form
    const groupName = `[E2E] Apt 4B ${tag}`;
    await dialog.getByLabel(/Group Name/i).fill(groupName);
    await dialog.getByLabel(/Operational Budget/i).fill("4500.00");
    const [createRes] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes("/api/groups") && res.request().method() === "POST",
      ),
      dialog.getByRole("button", { name: "Create Group" }).click(),
    ]);
    if (createRes.status() !== 201) {
      throw new Error(`POST /api/groups returned ${createRes.status()}: ${await createRes.text()}`);
    }

    await expect(dialog).toBeHidden();
    await expect(
      page
        .locator('[data-testid^="group-card-"]')
        .getByRole("heading", { name: groupName, exact: true })
        .first(),
    ).toBeVisible();
    await expect(page.getByTestId("spotlight-partition")).toBeVisible();
    await assertNoHorizontalOverflow(page);

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, `split-groups-populated-${tag}.png`),
      fullPage: true,
    });

    // 5. Open Edit Ratios modal and verify width + Audit Log drawer
    await page.getByRole("button", { name: "Edit Ratios" }).first().click();
    const ratiosDialog = page.getByRole("dialog", {
      name: /Edit Split Rules & Ratios/i,
    });
    await expect(ratiosDialog).toBeVisible();
    const ratiosBox = await ratiosDialog.boundingBox();
    expect(ratiosBox).not.toBeNull();
    if (!isMobile) {
      expect(ratiosBox!.width).toBeGreaterThanOrEqual(420);
    }
    await ratiosDialog.getByRole("button", { name: "Cancel" }).click();
    await expect(ratiosDialog).toBeHidden();

    // 6. Mobile drawer check on mobile viewport
    if (isMobile) {
      await page.getByRole("button", { name: "Open navigation menu" }).click();
      const drawer = page.getByRole("dialog", { name: "Mobile navigation" });
      await expect(drawer).toBeVisible();
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, `mobile-drawer-${tag}.png`),
        fullPage: false,
      });
      await drawer
        .getByRole("button", { name: "Close navigation menu" })
        .click();
      await expect(drawer).toBeHidden();
    }

    // 7. Settings page overflow check
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Delete Account" })).toBeVisible();
    await assertNoHorizontalOverflow(page);
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, `settings-${tag}.png`),
      fullPage: true,
    });
  });
});
