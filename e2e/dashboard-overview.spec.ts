import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import {
  authenticateContextAsUser,
  cleanupE2EGroupsForUser,
  createAdminSupabase,
  ensureE2EUser,
} from "./helpers/supabase-auth";

const E2E_ALEX_EMAIL = "e2e-84-alex@ledgersplit.test";
const E2E_ALEX_NAME = "Alex Rivera";
const E2E_ELENA_EMAIL = "e2e-84-elena@ledgersplit.test";
const E2E_ELENA_NAME = "Elena Rostova";
const E2E_MARCUS_EMAIL = "e2e-84-marcus@ledgersplit.test";
const E2E_MARCUS_NAME = "Marcus Vance";

function resolveScreenshotDir(): string {
  return path.resolve(process.cwd(), ".verification", "screenshots");
}

function getCycleAndPrevCycle(): {
  currentCycle: string;
  prevCycle: string;
  prevPeriodStart: string;
  prevPeriodEnd: string;
} {
  const now = new Date();
  const curY = now.getUTCFullYear();
  const curM = now.getUTCMonth(); // 0-based
  const currentCycle = `${curY}-${String(curM + 1).padStart(2, "0")}`;

  const prevDate = new Date(Date.UTC(curY, curM - 1, 1));
  const prevY = prevDate.getUTCFullYear();
  const prevM = prevDate.getUTCMonth();
  const prevCycle = `${prevY}-${String(prevM + 1).padStart(2, "0")}`;
  const prevPeriodStart = `${prevCycle}-01`;
  const lastDay = new Date(Date.UTC(prevY, prevM + 1, 0)).getUTCDate();
  const prevPeriodEnd = `${prevCycle}-${String(lastDay).padStart(2, "0")}`;

  return { currentCycle, prevCycle, prevPeriodStart, prevPeriodEnd };
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

test.describe("Issue #84 — Dashboard (/dashboard) cycle spend vs cumulative balances", () => {
  let alexUserId = "";
  let elenaUserId = "";
  let marcusUserId = "";

  test.beforeAll(async () => {
    const [alex, elena, marcus] = await Promise.all([
      ensureE2EUser(E2E_ALEX_EMAIL, E2E_ALEX_NAME),
      ensureE2EUser(E2E_ELENA_EMAIL, E2E_ELENA_NAME),
      ensureE2EUser(E2E_MARCUS_EMAIL, E2E_MARCUS_NAME),
    ]);
    alexUserId = alex.id;
    elenaUserId = elena.id;
    marcusUserId = marcus.id;
    await cleanupE2EGroupsForUser(alexUserId);
  });

  test.afterAll(async () => {
    if (alexUserId) {
      await cleanupE2EGroupsForUser(alexUserId);
    }
    const admin = createAdminSupabase();
    for (const uid of [alexUserId, elenaUserId, marcusUserId]) {
      if (uid) {
        await admin.auth.admin.deleteUser(uid).catch(() => {});
      }
    }
  });

  test("verifies cycle-scoped spend, category breakdown, closed period badge, All Groups per-group isolation, and pagination across desktop & mobile", async ({
    page,
    context,
    baseURL,
  }, testInfo) => {
    const isMobile = testInfo.project.name.includes("mobile");
    const tag = isMobile ? "mobile" : "desktop";
    const resolvedBaseUrl = baseURL || "http://127.0.0.1:3100";
    const screenshotDir = resolveScreenshotDir();
    fs.mkdirSync(screenshotDir, { recursive: true });

    await cleanupE2EGroupsForUser(alexUserId);

    const admin = createAdminSupabase();
    const group1Id = crypto.randomUUID();
    const group2Id = crypto.randomUUID();
    const stamp = Date.now();
    const { currentCycle, prevCycle, prevPeriodStart, prevPeriodEnd } =
      getCycleAndPrevCycle();

    const { error: grpErr } = await admin.from("groups").insert([
      {
        id: group1Id,
        name: `[E2E] Issue 84 Apt 4B ${tag}`,
        slug: `e2e-84-apt-${tag}-${stamp}`,
        group_type: "RESIDENTIAL",
        status: "ACTIVE",
        base_currency: "USD",
        default_split_mode: "EQUAL",
        simplify_debts: true,
        operational_budget_cents: 300000,
        billing_cycle_anchor_day: 1,
        invite_token: `tok-84-1-${tag}-${stamp}`,
        invite_token_version: 1,
        created_by: alexUserId,
      },
      {
        id: group2Id,
        name: `[E2E] Issue 84 Tahoe ${tag}`,
        slug: `e2e-84-tahoe-${tag}-${stamp}`,
        group_type: "TRIP",
        status: "ACTIVE",
        base_currency: "USD",
        default_split_mode: "EQUAL",
        simplify_debts: true,
        operational_budget_cents: 100000,
        billing_cycle_anchor_day: 1,
        invite_token: `tok-84-2-${tag}-${stamp}`,
        invite_token_version: 1,
        created_by: alexUserId,
      },
    ]);
    if (grpErr) throw grpErr;

    const { error: memErr } = await admin.from("group_members").insert([
      {
        group_id: group1Id,
        user_id: alexUserId,
        role: "ADMIN",
        status: "ACTIVE",
        share_percentage: 33.34,
      },
      {
        group_id: group1Id,
        user_id: elenaUserId,
        role: "MEMBER",
        status: "ACTIVE",
        share_percentage: 33.33,
      },
      {
        group_id: group1Id,
        user_id: marcusUserId,
        role: "MEMBER",
        status: "ACTIVE",
        share_percentage: 33.33,
      },
      {
        group_id: group2Id,
        user_id: alexUserId,
        role: "ADMIN",
        status: "ACTIVE",
        share_percentage: 50,
      },
      {
        group_id: group2Id,
        user_id: elenaUserId,
        role: "MEMBER",
        status: "ACTIVE",
        share_percentage: 50,
      },
    ]);
    if (memErr) throw memErr;

    // Seed CLOSED billing cycles for prevCycle on both groups
    const { error: bcErr } = await admin.from("billing_cycles").insert([
      {
        group_id: group1Id,
        period_start: prevPeriodStart,
        period_end: prevPeriodEnd,
        status: "CLOSED",
        closed_by: alexUserId,
        closed_at: new Date().toISOString(),
      },
      {
        group_id: group2Id,
        period_start: prevPeriodStart,
        period_end: prevPeriodEnd,
        status: "CLOSED",
        closed_by: alexUserId,
        closed_at: new Date().toISOString(),
      },
    ]);
    if (bcErr) throw bcErr;

    // Seed historical closed-cycle expenses ($120 Apt 4B + $60 Tahoe = $180.00)
    // and current open-cycle expenses ($240 Apt 4B + $40 Tahoe = $280.00, 6 txns)
    // Cumulative per-group balances (zero settlements):
    //   Apt 4B: Elena -> Alex +$90.00 (Marcus net $0.00)
    //   Tahoe:  Alex -> Elena -$50.00
    //   Overall Net = +$40.00 Net Owed to You
    const { error: expErr } = await admin.from("expenses").insert([
      {
        group_id: group1Id,
        created_by: alexUserId,
        paid_by: alexUserId,
        description: `[E2E] Prev ConEd Power ${tag}`,
        category: "Utilities",
        expense_date: `${prevCycle}-14T15:00:00.000Z`,
        amount_cents: 12000,
        currency: "USD",
        split_method: "EQUAL",
        is_locked: false,
        split_breakdown: [
          { user_id: alexUserId, share_cents: 4000, percentage: 33.34 },
          { user_id: elenaUserId, share_cents: 4000, percentage: 33.33 },
          { user_id: marcusUserId, share_cents: 4000, percentage: 33.33 },
        ],
      },
      {
        group_id: group2Id,
        created_by: elenaUserId,
        paid_by: elenaUserId,
        description: `[E2E] Prev Rental Car ${tag}`,
        category: "Transit & Travel",
        expense_date: `${prevCycle}-20T18:30:00.000Z`,
        amount_cents: 6000,
        currency: "USD",
        split_method: "EQUAL",
        is_locked: false,
        split_breakdown: [
          { user_id: alexUserId, share_cents: 3000, percentage: 50 },
          { user_id: elenaUserId, share_cents: 3000, percentage: 50 },
        ],
      },
      {
        group_id: group1Id,
        created_by: marcusUserId,
        paid_by: marcusUserId,
        description: `[E2E] Cur Trader Joe's ${tag}`,
        category: "Groceries & Food",
        expense_date: `${currentCycle}-18T14:00:00.000Z`,
        amount_cents: 9000,
        currency: "USD",
        split_method: "EQUAL",
        is_locked: false,
        split_breakdown: [
          { user_id: alexUserId, share_cents: 3000, percentage: 33.34 },
          { user_id: elenaUserId, share_cents: 3000, percentage: 33.33 },
          { user_id: marcusUserId, share_cents: 3000, percentage: 33.33 },
        ],
      },
      {
        group_id: group1Id,
        created_by: alexUserId,
        paid_by: alexUserId,
        description: `[E2E] Cur House Pizza ${tag}`,
        category: "Dining Out",
        expense_date: `${currentCycle}-16T20:00:00.000Z`,
        amount_cents: 6000,
        currency: "USD",
        split_method: "EQUAL",
        is_locked: false,
        split_breakdown: [
          { user_id: alexUserId, share_cents: 2000, percentage: 33.34 },
          { user_id: elenaUserId, share_cents: 2000, percentage: 33.33 },
          { user_id: marcusUserId, share_cents: 2000, percentage: 33.33 },
        ],
      },
      {
        group_id: group2Id,
        created_by: elenaUserId,
        paid_by: elenaUserId,
        description: `[E2E] Cur Gondola Tickets ${tag}`,
        category: "Entertainment",
        expense_date: `${currentCycle}-15T10:00:00.000Z`,
        amount_cents: 4000,
        currency: "USD",
        split_method: "EQUAL",
        is_locked: false,
        split_breakdown: [
          { user_id: alexUserId, share_cents: 2000, percentage: 50 },
          { user_id: elenaUserId, share_cents: 2000, percentage: 50 },
        ],
      },
      {
        group_id: group1Id,
        created_by: alexUserId,
        paid_by: alexUserId,
        description: `[E2E] Cur Cleaning Supplies ${tag}`,
        category: "Home Goods",
        expense_date: `${currentCycle}-10T11:00:00.000Z`,
        amount_cents: 3000,
        currency: "USD",
        split_method: "EQUAL",
        is_locked: false,
        split_breakdown: [
          { user_id: alexUserId, share_cents: 1000, percentage: 33.34 },
          { user_id: elenaUserId, share_cents: 1000, percentage: 33.33 },
          { user_id: marcusUserId, share_cents: 1000, percentage: 33.33 },
        ],
      },
      {
        group_id: group1Id,
        created_by: elenaUserId,
        paid_by: elenaUserId,
        description: `[E2E] Cur Paper Towels ${tag}`,
        category: "Home Goods",
        expense_date: `${currentCycle}-08T11:00:00.000Z`,
        amount_cents: 3000,
        currency: "USD",
        split_method: "EQUAL",
        is_locked: false,
        split_breakdown: [
          { user_id: alexUserId, share_cents: 1000, percentage: 33.34 },
          { user_id: elenaUserId, share_cents: 1000, percentage: 33.33 },
          { user_id: marcusUserId, share_cents: 1000, percentage: 33.33 },
        ],
      },
      {
        group_id: group1Id,
        created_by: marcusUserId,
        paid_by: marcusUserId,
        description: `[E2E] Cur Dish Soap ${tag}`,
        category: "Home Goods",
        expense_date: `${currentCycle}-04T11:00:00.000Z`,
        amount_cents: 3000,
        currency: "USD",
        split_method: "EQUAL",
        is_locked: false,
        split_breakdown: [
          { user_id: alexUserId, share_cents: 1000, percentage: 33.34 },
          { user_id: elenaUserId, share_cents: 1000, percentage: 33.33 },
          { user_id: marcusUserId, share_cents: 1000, percentage: 33.33 },
        ],
      },
    ]);
    if (expErr) throw expErr;

    await authenticateContextAsUser(context, resolvedBaseUrl, E2E_ALEX_EMAIL);

    // 1. Open Dashboard in All Groups mode for currentCycle
    await page.goto(`/dashboard?group=all&cycle=${currentCycle}`, {
      waitUntil: "networkidle",
    });
    await assertNoHorizontalOverflow(page);

    await expect(page.getByTestId("settled-closed-period-badge")).toHaveCount(0);

    const totalCard = page.getByTestId("kpi-total-spent");
    await expect(totalCard).toContainText("$280.00");
    await expect(totalCard).toContainText("Your share: $100.00");
    await expect(totalCard).toContainText("6 transactions");

    const catCard = page.getByTestId("category-breakdown-card");
    await expect(catCard).toContainText("$280.00 / $4,000.00 target budget");
    await expect(catCard).toContainText("Budget Buffer");
    await expect(catCard).toContainText("Groceries & Food");

    // Cumulative all-time balances isolated per group (no cross-group netting)
    await expect(page.getByTestId("kpi-you-are-owed")).toContainText("+$90.00");
    await expect(page.getByTestId("kpi-you-owe")).toContainText("-$50.00");
    await expect(page.getByTestId("overall-net-settlement")).toContainText(
      "+$40.00 Net Owed to You",
    );

    const aptGroupBox = page.getByTestId(`peer-balance-group-${group1Id}`);
    const tahoeGroupBox = page.getByTestId(`peer-balance-group-${group2Id}`);
    await expect(
      aptGroupBox.getByTestId(`peer-balance-amount-${elenaUserId}-${alexUserId}`),
    ).toHaveText("+$90.00");
    await expect(
      tahoeGroupBox.getByTestId(`peer-balance-amount-${alexUserId}-${elenaUserId}`),
    ).toHaveText("-$50.00");

    // Capture full-page screenshot for current viewport (desktop or mobile)
    await page.screenshot({
      path: path.join(screenshotDir, `issue-84-${tag}.png`),
      fullPage: true,
    });

    // 2. Verify Recent Shared Transactions pagination (6 items: 5 on page 1, 1 on page 2)
    const txCard = page.getByTestId("recent-shared-transactions-card");
    await expect(txCard.getByText(`[E2E] Cur Trader Joe's ${tag}`)).toBeVisible();
    await expect(txCard.getByText(`[E2E] Cur Dish Soap ${tag}`)).toBeHidden();

    const paginationNav = txCard.getByRole("navigation", { name: "Pagination" });
    await paginationNav.getByRole("button", { name: "Next", exact: true }).click();
    await expect(txCard.getByText(`[E2E] Cur Dish Soap ${tag}`)).toBeVisible();
    await paginationNav.getByRole("button", { name: "Previous", exact: true }).click();

    // Open row action menu -> View Split Details
    await txCard
      .getByRole("button", {
        name: `Actions for [E2E] Cur Trader Joe's ${tag}`,
      })
      .click();
    await page.getByRole("menuitem", { name: "View Split Details" }).click();
    const inspectDialog = page.getByRole("dialog", {
      name: `[E2E] Cur Trader Joe's ${tag}`,
    });
    await expect(inspectDialog).toBeVisible();
    await inspectDialog.getByRole("button", { name: "Close", exact: true }).click();

    // 3. Switch ?cycle= to closed historical cycle via TopBar cycle picker
    await page.getByRole("button", { name: "Select billing cycle" }).click();
    const prevDate = new Date(
      Date.UTC(
        Number(prevCycle.split("-")[0]),
        Number(prevCycle.split("-")[1]) - 1,
        1,
      ),
    );
    const prevLabel = new Intl.DateTimeFormat("en-US", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(prevDate);
    await page.getByRole("option", { name: prevLabel }).click();

    await expect(page).toHaveURL(new RegExp(`cycle=${prevCycle}`));
    await assertNoHorizontalOverflow(page);

    // Closed historical cycle shows Settled / Closed Period badge in header
    await expect(page.getByTestId("settled-closed-period-badge")).toHaveText(
      "Settled / Closed Period",
    );

    // Cycle-scoped widgets update to prevCycle ($180.00, Utilities & Transit & Travel)
    await expect(totalCard).toContainText("$180.00");
    await expect(totalCard).toContainText("2 transactions");
    await expect(catCard).toContainText("Utilities");
    await expect(catCard).toContainText("Transit & Travel");
    await expect(txCard.getByText(`[E2E] Prev ConEd Power ${tag}`)).toBeVisible();
    await expect(txCard.getByText(`[E2E] Cur Trader Joe's ${tag}`)).toBeHidden();

    // Cumulative Peer Balances remain live all-time (+$90.00, -$50.00, +$40.00 net)
    await expect(page.getByTestId("kpi-you-are-owed")).toContainText("+$90.00");
    await expect(page.getByTestId("kpi-you-owe")).toContainText("-$50.00");
    await expect(page.getByTestId("overall-net-settlement")).toContainText(
      "+$40.00 Net Owed to You",
    );

    // 4. Filter dashboard by single group (Apt 4B)
    await page.getByRole("button", { name: "Filter dashboard by group" }).click();
    await page
      .getByRole("option", { name: `[E2E] Issue 84 Apt 4B ${tag}` })
      .click();

    await expect(page).toHaveURL(new RegExp(`group=${group1Id}`));
    await expect(totalCard).toContainText("$120.00");
    await expect(catCard).toContainText("$120.00 / $3,000.00 target budget");
    await expect(page.getByTestId("overall-net-settlement")).toContainText(
      "+$90.00 Net Owed to You",
    );
    await assertNoHorizontalOverflow(page);
  });
});
