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
const E2E_MEMBER_EMAIL = "e2e-member@ledgersplit.test";
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

test.describe("Issue #79 — Expenses ledger (/expenses), Personal Share cap & Cmd+K search", () => {
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
  });

  test("verifies KPI cards, Personal Share cap ProgressBar, filtering, pagination, and Cmd+K search across desktop & mobile", async ({
    page,
    context,
    baseURL,
  }, testInfo) => {
    const isMobile = testInfo.project.name.includes("mobile");
    const tag = isMobile ? "mobile" : "desktop";
    const resolvedBaseUrl = baseURL || "http://127.0.0.1:3100";
    const screenshotDir = resolveScreenshotDir();
    fs.mkdirSync(screenshotDir, { recursive: true });

    await cleanupE2EGroupsForUser(adminUserId);
    await authenticateContextAsUser(context, resolvedBaseUrl, E2E_ADMIN_EMAIL);

    const admin = createAdminSupabase();
    // Set personal_share_cap_cents = 160000 ($1,600.00) on adminUserId
    await admin
      .from("users")
      .update({ personal_share_cap_cents: 160000 })
      .eq("id", adminUserId);

    const groupId = crypto.randomUUID();
    const groupName = `[E2E] Issue 79 Apt 4B ${tag}`;
    const slug = `e2e-79-${tag}-${Date.now()}`;

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
      invite_token: `tok-79-${tag}-${Date.now()}`,
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

    // Seed 9 expenses in 2026-11 so pagination displays 2 pages (7 + 2)
    const now = new Date();
    const cycleYear = now.getUTCFullYear();
    const cycleMonthIdx = now.getUTCMonth();
    const cycleSlug = `${cycleYear}-${String(cycleMonthIdx + 1).padStart(2, "0")}`;

    const seededExpenses = Array.from({ length: 9 }, (_, i) => {
      const idx = i + 1;
      const isElenaPayer = idx % 2 === 0;
      const amountCents = idx * 4000; // 4000..36000 -> total 180000 ($1,800.00), Alex share $900.00
      const half = amountCents / 2;
      const day = String(Math.min(27, idx + 1)).padStart(2, "0");
      return {
        group_id: groupId,
        created_by: isElenaPayer ? memberUserId : adminUserId,
        paid_by: isElenaPayer ? memberUserId : adminUserId,
        description: isElenaPayer
          ? `[E2E] ConEd Power #${idx} ${tag}`
          : `[E2E] Whole Foods #${idx} ${tag}`,
        category: isElenaPayer ? "Utilities" : "Groceries & Food",
        expense_date: `${cycleSlug}-${day}T12:00:00.000Z`,
        amount_cents: amountCents,
        currency: "USD",
        split_method: "EQUAL",
        split_breakdown: [
          { user_id: adminUserId, share_cents: half, percentage: 50 },
          { user_id: memberUserId, share_cents: half, percentage: 50 },
        ],
      };
    });

    const { error: expErr } = await admin.from("expenses").insert(seededExpenses);
    if (expErr) throw expErr;

    // 1. Navigate to /expenses scoped to group + current cycle
    await page.goto(`/expenses?group=${groupId}&cycle=${cycleSlug}`, {
      waitUntil: "networkidle",
    });
    await assertNoHorizontalOverflow(page);

    // 2. Assert 3 KPI cards & Personal Share cap progress bar
    const totalCard = page.getByTestId("kpi-total-group-expenses");
    await expect(totalCard).toContainText("$1,800.00");
    await expect(totalCard).toContainText("9 aggregate transactions");

    const personalCard = page.getByTestId("kpi-personal-share");
    await expect(personalCard).toContainText("$900.00");
    await expect(personalCard).toContainText("56.3%");
    await expect(personalCard).toContainText("Monthly limit threshold: $1,600.00");
    await expect(personalCard.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "56",
    );

    const unsettledCard = page.getByTestId("kpi-unsettled-pending");
    await expect(unsettledCard).toContainText("Next group settlement:");

    // Capture full-view screenshot for visual verification
    await page.screenshot({
      path: path.join(screenshotDir, `issue-79-${tag}.png`),
      fullPage: true,
    });

    // 3. Verify Pagination (7 items on page 1, 2 items on page 2)
    const paginationNav = page.getByRole("navigation", { name: "Pagination" });
    await expect(page.getByText(`[E2E] Whole Foods #9 ${tag}`)).toBeVisible();
    await expect(page.getByText(`[E2E] Whole Foods #1 ${tag}`)).toBeHidden();
    await paginationNav.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.getByText(`[E2E] Whole Foods #1 ${tag}`)).toBeVisible();
    await paginationNav.getByRole("button", { name: "Previous", exact: true }).click();

    // 4. Verify SegmentedControl Tabs & Category chip filtering
    await page.getByRole("tab", { name: "Paid by Me" }).click();
    await expect(page.getByText(`[E2E] Whole Foods #9 ${tag}`)).toBeVisible();
    await expect(page.getByText(`[E2E] ConEd Power #8 ${tag}`)).toBeHidden();

    await page.getByRole("tab", { name: "Split with Me" }).click();
    await expect(page.getByText(`[E2E] ConEd Power #8 ${tag}`)).toBeVisible();
    await expect(page.getByText(`[E2E] Whole Foods #9 ${tag}`)).toBeHidden();

    await page.getByRole("tab", { name: "All Expenses" }).click();

    // Category pill filter
    await page.getByRole("button", { name: /Utilities/i }).click();
    await expect(page.getByText(`[E2E] ConEd Power #8 ${tag}`)).toBeVisible();
    await expect(page.getByText(`[E2E] Whole Foods #9 ${tag}`)).toBeHidden();
    await page.getByRole("button", { name: "All", exact: true }).click();

    // 5. Verify Cmd+K Global Search opens, searches /api/search, and navigates to matching expense
    await page.keyboard.press("Control+k");
    const searchDialog = page.getByRole("dialog", { name: "Quick Search" });
    await expect(searchDialog).toBeVisible();

    const quickInput = searchDialog.getByPlaceholder(
      /Search expenses, merchants, or split groups/i,
    );
    await quickInput.fill(`Whole Foods #1 ${tag}`);

    const expenseResult = searchDialog.getByRole("button", {
      name: new RegExp(`Whole Foods #1 ${tag}`, "i"),
    });
    await expect(expenseResult).toBeVisible({ timeout: 10000 });
    await expenseResult.click();

    await expect(page).toHaveURL(/\/expenses\?/);
    await expect(page.getByText(`[E2E] Whole Foods #1 ${tag}`)).toBeVisible();
    await assertNoHorizontalOverflow(page);
  });
});
