import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import {
  authenticateContextAsUser,
  cleanupE2EGroupsForUser,
  createAdminSupabase,
  deleteE2EUsersById,
  ensureE2EUser,
} from "./helpers/supabase-auth";

const E2E_EMAIL = "e2e-polish-alex@ledgersplit.test";
const E2E_NAME = "Alex Rivera";
const E2E_PEER_EMAIL = "e2e-polish-elena@ledgersplit.test";
const E2E_PEER_NAME = "Elena Rostova";

function getCycleAndPrevCycle(): { currentCycle: string; prevCycle: string } {
  const now = new Date();
  const curY = now.getUTCFullYear();
  const curM = now.getUTCMonth();
  const currentCycle = `${curY}-${String(curM + 1).padStart(2, "0")}`;

  const prevDate = new Date(Date.UTC(curY, curM - 1, 1));
  const prevCycle = `${prevDate.getUTCFullYear()}-${String(prevDate.getUTCMonth() + 1).padStart(2, "0")}`;
  return { currentCycle, prevCycle };
}

test.describe("Polish Fixes — / redirect, Cycle Prev/Next, Expenses Filter+Sort", () => {
  let alexUserId = "";
  let elenaUserId = "";

  test.beforeAll(async () => {
    const [alex, elena] = await Promise.all([
      ensureE2EUser(E2E_EMAIL, E2E_NAME),
      ensureE2EUser(E2E_PEER_EMAIL, E2E_PEER_NAME),
    ]);
    alexUserId = alex.id;
    elenaUserId = elena.id;
    await cleanupE2EGroupsForUser(alexUserId);
  });

  test.afterAll(async () => {
    if (alexUserId) {
      await cleanupE2EGroupsForUser(alexUserId);
    }
    await deleteE2EUsersById([alexUserId, elenaUserId]);
  });

  test("verifies / redirects, cycle prev/next controls, expenses filter+sort layout, and captures screenshots", async ({
    page,
    context,
    baseURL,
  }, testInfo) => {
    const isMobile = testInfo.project.name.includes("mobile");
    const tag = isMobile ? "mobile" : "desktop";
    const resolvedBaseUrl = baseURL || "http://127.0.0.1:3100";
    const screenshotDir = path.resolve(
      process.cwd(),
      ".verification",
      "screenshots",
    );
    fs.mkdirSync(screenshotDir, { recursive: true });

    const { currentCycle, prevCycle } = getCycleAndPrevCycle();

    await cleanupE2EGroupsForUser(alexUserId);
    const admin = createAdminSupabase();
    const groupId = crypto.randomUUID();
    const stamp = Date.now();

    const { error: grpErr } = await admin.from("groups").insert({
      id: groupId,
      name: `[E2E] Polish Group ${tag}`,
      slug: `e2e-polish-${tag}-${stamp}`,
      group_type: "RESIDENTIAL",
      status: "ACTIVE",
      base_currency: "USD",
      default_split_mode: "EQUAL",
      simplify_debts: true,
      operational_budget_cents: 250000,
      billing_cycle_anchor_day: 1,
      invite_token: `tok-polish-${tag}-${stamp}`,
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

    const { error: expErr } = await admin.from("expenses").insert([
      {
        group_id: groupId,
        created_by: alexUserId,
        paid_by: alexUserId,
        description: `[E2E] Current Airport Shuttle ${tag}`,
        category: "Transit & Travel",
        expense_date: `${currentCycle}-14T15:00:00.000Z`,
        amount_cents: 63000,
        currency: "USD",
        split_method: "EQUAL",
        is_locked: false,
        split_breakdown: [
          { user_id: alexUserId, share_cents: 31500, percentage: 50 },
          { user_id: elenaUserId, share_cents: 31500, percentage: 50 },
        ],
      },
      {
        group_id: groupId,
        created_by: elenaUserId,
        paid_by: elenaUserId,
        description: `[E2E] Previous Month Electric ${tag}`,
        category: "Utilities",
        expense_date: `${prevCycle}-14T15:00:00.000Z`,
        amount_cents: 14000,
        currency: "USD",
        split_method: "EQUAL",
        is_locked: false,
        split_breakdown: [
          { user_id: alexUserId, share_cents: 7000, percentage: 50 },
          { user_id: elenaUserId, share_cents: 7000, percentage: 50 },
        ],
      },
    ]);
    if (expErr) throw expErr;

    // 1. Unauthenticated / -> /login
    await page.goto("/", { waitUntil: "networkidle" });
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByText("Ready for App Shell")).toHaveCount(0);

    // 2. Authenticate and visit / -> /dashboard
    await authenticateContextAsUser(context, resolvedBaseUrl, E2E_EMAIL);
    await page.goto("/", { waitUntil: "networkidle" });
    await expect(page).toHaveURL(/\/dashboard/);

    // Navigate to seeded group + current cycle
    await page.goto(`/dashboard?group=${groupId}&cycle=${currentCycle}`, {
      waitUntil: "networkidle",
    });

    // Verify Billing Cycle Picker prev/next buttons render visibly with non-zero SVG
    const cycleGroup = page.getByRole("group", { name: "Billing cycle picker" });
    const prevBtn = cycleGroup.getByRole("button", {
      name: "Previous billing cycle",
    });
    const nextBtn = cycleGroup.getByRole("button", {
      name: "Next billing cycle",
    });
    await expect(prevBtn).toBeVisible();
    await expect(nextBtn).toBeVisible();

    const prevBox = await prevBtn.boundingBox();
    const nextBox = await nextBtn.boundingBox();
    expect(prevBox).not.toBeNull();
    expect(nextBox).not.toBeNull();
    expect(prevBox!.width).toBeGreaterThanOrEqual(20);
    expect(nextBox!.width).toBeGreaterThanOrEqual(20);

    const prevSvgBox = await prevBtn.locator("svg").boundingBox();
    const nextSvgBox = await nextBtn.locator("svg").boundingBox();
    expect(prevSvgBox).not.toBeNull();
    expect(nextSvgBox).not.toBeNull();
    expect(prevSvgBox!.width).toBeGreaterThanOrEqual(12);
    expect(nextSvgBox!.width).toBeGreaterThanOrEqual(12);

    const dashOverflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    expect(dashOverflow.scrollWidth).toBeLessThanOrEqual(dashOverflow.innerWidth);

    await page.screenshot({
      path: path.join(screenshotDir, `polish-dashboard-${tag}.png`),
      fullPage: false,
    });

    // Click Prev -> switches ?cycle= to prevCycle and updates dashboard view
    await prevBtn.click();
    await expect(page).toHaveURL(new RegExp(`cycle=${prevCycle}`));
    await expect(page.getByTestId("kpi-total-spent")).toContainText("$140.00");

    // Click Next -> switches ?cycle= back to currentCycle and updates dashboard view
    await nextBtn.click();
    await expect(page).toHaveURL(new RegExp(`cycle=${currentCycle}`));
    await expect(page.getByTestId("kpi-total-spent")).toContainText("$630.00");

    // 3. Expenses page category filter & sort listbox side-by-side
    await page.goto(`/expenses?group=${groupId}&cycle=${currentCycle}`, {
      waitUntil: "networkidle",
    });
    const filterSortGroup = page.getByTestId("expenses-filter-sort-group");
    const catGroup = filterSortGroup.getByRole("group", {
      name: "Filter by category",
    });
    const sortBtn = filterSortGroup.getByRole("button", {
      name: /Sort transactions/i,
    });
    await expect(catGroup).toBeVisible();
    await expect(sortBtn).toBeVisible();

    const catBox = await catGroup.boundingBox();
    const sortBox = await sortBtn.boundingBox();
    expect(catBox).not.toBeNull();
    expect(sortBox).not.toBeNull();
    if (!isMobile) {
      // Side-by-side on the same row with small gap (<= 24px), not justify-between void
      expect(Math.abs(catBox!.y - sortBox!.y)).toBeLessThanOrEqual(12);
      const horizontalGap = sortBox!.x - (catBox!.x + catBox!.width);
      expect(horizontalGap).toBeGreaterThanOrEqual(4);
      expect(horizontalGap).toBeLessThanOrEqual(24);
    }

    const expOverflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    expect(expOverflow.scrollWidth).toBeLessThanOrEqual(expOverflow.innerWidth);

    await page.screenshot({
      path: path.join(screenshotDir, `polish-expenses-${tag}.png`),
      fullPage: isMobile,
    });
  });
});
