import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import {
  authenticateContextAsUser,
  cleanupE2EGroupsForUser,
  createAdminSupabase,
  ensureE2EUser,
} from "./helpers/supabase-auth";

const E2E_ADMIN_EMAIL = "e2e-83-admin@ledgersplit.test";
const E2E_ADMIN_NAME = "Alex Rivera";
const E2E_ELENA_EMAIL = "e2e-83-elena@ledgersplit.test";
const E2E_ELENA_NAME = "Elena Rostova";
const E2E_MARCUS_EMAIL = "e2e-83-marcus@ledgersplit.test";
const E2E_MARCUS_NAME = "Marcus Vance";

async function assertNoHorizontalOverflow(
  page: import("@playwright/test").Page,
) {
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.innerWidth);
}

test.describe("Issue #83 — Per-group bipartite debt simplification & Peer Balances Simplify Switch", () => {
  let adminUserId = "";
  let elenaUserId = "";
  let marcusUserId = "";

  test.beforeAll(async () => {
    const [adminUser, elenaUser, marcusUser] = await Promise.all([
      ensureE2EUser(E2E_ADMIN_EMAIL, E2E_ADMIN_NAME),
      ensureE2EUser(E2E_ELENA_EMAIL, E2E_ELENA_NAME),
      ensureE2EUser(E2E_MARCUS_EMAIL, E2E_MARCUS_NAME),
    ]);
    adminUserId = adminUser.id;
    elenaUserId = elenaUser.id;
    marcusUserId = marcusUser.id;
    await cleanupE2EGroupsForUser(adminUserId);
  });

  test.afterAll(async () => {
    if (adminUserId) {
      await cleanupE2EGroupsForUser(adminUserId);
    }
    const admin = createAdminSupabase();
    for (const uid of [adminUserId, elenaUserId, marcusUserId]) {
      if (uid) {
        await admin.auth.admin.deleteUser(uid).catch(() => {});
      }
    }
  });

  test("toggles Simplify immediately with net balance conservation & strict cross-group isolation across desktop & mobile", async ({
    page,
    context,
    baseURL,
  }, testInfo) => {
    const isMobile = testInfo.project.name.includes("mobile");
    const tag = isMobile ? "mobile" : "desktop";
    const resolvedBaseUrl = baseURL || "http://127.0.0.1:3100";

    const parentVerification = path.resolve(
      process.cwd(),
      "..",
      "..",
      ".verification",
    );
    const screenshotDir = fs.existsSync(parentVerification)
      ? path.join(parentVerification, "screenshots")
      : path.resolve(process.cwd(), ".verification", "screenshots");
    fs.mkdirSync(screenshotDir, { recursive: true });

    await cleanupE2EGroupsForUser(adminUserId);

    const admin = createAdminSupabase();
    const group1Id = crypto.randomUUID();
    const group2Id = crypto.randomUUID();
    const stamp = Date.now();

    const { error: grpErr } = await admin.from("groups").insert([
      {
        id: group1Id,
        name: `[E2E] Issue 83 Apt 4B ${tag}`,
        slug: `e2e-83-apt-${tag}-${stamp}`,
        group_type: "RESIDENTIAL",
        status: "ACTIVE",
        base_currency: "USD",
        default_split_mode: "EQUAL",
        simplify_debts: true,
        operational_budget_cents: 300000,
        billing_cycle_anchor_day: 1,
        invite_token: `tok-83-1-${tag}-${stamp}`,
        invite_token_version: 1,
        created_by: adminUserId,
      },
      {
        id: group2Id,
        name: `[E2E] Issue 83 Tahoe ${tag}`,
        slug: `e2e-83-tahoe-${tag}-${stamp}`,
        group_type: "TRIP",
        status: "ACTIVE",
        base_currency: "USD",
        default_split_mode: "EQUAL",
        simplify_debts: true,
        operational_budget_cents: null,
        billing_cycle_anchor_day: 1,
        invite_token: `tok-83-2-${tag}-${stamp}`,
        invite_token_version: 1,
        created_by: adminUserId,
      },
    ]);
    if (grpErr) throw grpErr;

    const { error: memErr } = await admin.from("group_members").insert([
      {
        group_id: group1Id,
        user_id: adminUserId,
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
        user_id: adminUserId,
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

    const now = new Date();
    const cycleSlug = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    const expDate1 = new Date(now.getTime() - 2 * 3600 * 1000).toISOString();
    const expDate2 = new Date(now.getTime() - 1 * 3600 * 1000).toISOString();

    // Group 1 (Apt 4B):
    //   Alex pays $60.00 split 3 ways (Elena owes Alex $20, Marcus owes Alex $20)
    //   Marcus pays $90.00 split 3 ways (Alex owes Marcus $30, Elena owes Marcus $30)
    //   Net: Alex = +$10.00, Marcus = +$40.00, Elena = -$50.00
    //   Simplified: Elena -> Marcus $40.00, Elena -> Alex +$10.00 (2 edges)
    //   Direct:     Alex -> Marcus -$10.00, Elena -> Alex +$20.00, Elena -> Marcus $30.00 (3 edges)
    //
    // Group 2 (Tahoe):
    //   Elena pays $40.00 split 2 ways (Alex owes Elena -$20.00)
    const { error: expErr } = await admin.from("expenses").insert([
      {
        group_id: group1Id,
        created_by: adminUserId,
        paid_by: adminUserId,
        description: `[E2E] Groceries ${tag}`,
        category: "Groceries & Food",
        expense_date: expDate1,
        amount_cents: 6000,
        currency: "USD",
        split_method: "EQUAL",
        split_breakdown: [
          { user_id: adminUserId, share_cents: 2000, percentage: 33.34 },
          { user_id: elenaUserId, share_cents: 2000, percentage: 33.33 },
          { user_id: marcusUserId, share_cents: 2000, percentage: 33.33 },
        ],
      },
      {
        group_id: group1Id,
        created_by: marcusUserId,
        paid_by: marcusUserId,
        description: `[E2E] Electric & Gas ${tag}`,
        category: "Utilities",
        expense_date: expDate2,
        amount_cents: 9000,
        currency: "USD",
        split_method: "EQUAL",
        split_breakdown: [
          { user_id: adminUserId, share_cents: 3000, percentage: 33.34 },
          { user_id: elenaUserId, share_cents: 3000, percentage: 33.33 },
          { user_id: marcusUserId, share_cents: 3000, percentage: 33.33 },
        ],
      },
      {
        group_id: group2Id,
        created_by: elenaUserId,
        paid_by: elenaUserId,
        description: `[E2E] Ski Pass ${tag}`,
        category: "Entertainment",
        expense_date: expDate2,
        amount_cents: 4000,
        currency: "USD",
        split_method: "EQUAL",
        split_breakdown: [
          { user_id: adminUserId, share_cents: 2000, percentage: 50 },
          { user_id: elenaUserId, share_cents: 2000, percentage: 50 },
        ],
      },
    ]);
    if (expErr) throw expErr;

    await authenticateContextAsUser(context, resolvedBaseUrl, E2E_ADMIN_EMAIL);

    // 1. Navigate to single-group Dashboard view
    await page.goto(`/dashboard?group=${group1Id}&cycle=${cycleSlug}`, {
      waitUntil: "networkidle",
    });
    await assertNoHorizontalOverflow(page);

    const peerCard = page.getByTestId("peer-balances-card");
    const simplifySwitch = peerCard.getByRole("switch", { name: /Simplify/i });
    await expect(simplifySwitch).toHaveAttribute("aria-checked", "true");

    // Verify simplified edges and net balance
    await expect(
      peerCard.getByTestId(`peer-balance-amount-${elenaUserId}-${adminUserId}`),
    ).toHaveText("+$10.00");
    await expect(
      peerCard.getByTestId(`peer-balance-amount-${elenaUserId}-${marcusUserId}`),
    ).toHaveText("$40.00");
    await expect(
      peerCard.getByTestId(`peer-balance-amount-${adminUserId}-${marcusUserId}`),
    ).toHaveCount(0);

    const netFooter = page.getByTestId("overall-net-settlement");
    await expect(netFooter).toContainText("+$10.00 Net Owed to You");

    // Capture screenshot of Dashboard with Peer Balances & Simplify ON
    await page.screenshot({
      path: path.join(screenshotDir, `issue-83-${tag}.png`),
      fullPage: true,
    });

    // 2. Toggle Simplify OFF -> pairs & amounts update immediately, net balance stays +$10.00
    const patchPromise = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/groups/${group1Id}/simplify`) &&
        res.request().method() === "PATCH",
    );
    await simplifySwitch.click();
    await expect(simplifySwitch).toHaveAttribute("aria-checked", "false");

    await expect(
      peerCard.getByTestId(`peer-balance-amount-${adminUserId}-${marcusUserId}`),
    ).toHaveText("-$10.00");
    await expect(
      peerCard.getByTestId(`peer-balance-amount-${elenaUserId}-${adminUserId}`),
    ).toHaveText("+$20.00");
    await expect(
      peerCard.getByTestId(`peer-balance-amount-${elenaUserId}-${marcusUserId}`),
    ).toHaveText("$30.00");
    await expect(netFooter).toContainText("+$10.00 Net Owed to You");

    const patchRes = await patchPromise;
    expect(patchRes.status()).toBe(200);

    // 3. Reload page to confirm Group.simplify_debts = false persisted in Postgres
    await page.reload({ waitUntil: "networkidle" });
    await expect(
      page.getByTestId("peer-balances-card").getByRole("switch", { name: /Simplify/i }),
    ).toHaveAttribute("aria-checked", "false");
    await expect(
      page
        .getByTestId("peer-balances-card")
        .getByTestId(`peer-balance-amount-${adminUserId}-${marcusUserId}`),
    ).toHaveText("-$10.00");

    // Toggle back ON
    const patchOnPromise = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/groups/${group1Id}/simplify`) &&
        res.request().method() === "PATCH",
    );
    await page
      .getByTestId("peer-balances-card")
      .getByRole("switch", { name: /Simplify/i })
      .click();
    await expect(
      page.getByTestId("peer-balances-card").getByRole("switch", { name: /Simplify/i }),
    ).toHaveAttribute("aria-checked", "true");
    expect((await patchOnPromise).status()).toBe(200);

    // 4. Verify All Groups view enforces strict cross-group isolation
    await page.goto(`/dashboard?group=all&cycle=${cycleSlug}`, {
      waitUntil: "networkidle",
    });
    await assertNoHorizontalOverflow(page);

    const group1Card = page.getByTestId(`peer-balance-group-${group1Id}`);
    const group2Card = page.getByTestId(`peer-balance-group-${group2Id}`);
    await expect(
      group1Card.getByTestId(`peer-balance-amount-${elenaUserId}-${adminUserId}`),
    ).toHaveText("+$10.00");
    await expect(
      group2Card.getByTestId(`peer-balance-amount-${adminUserId}-${elenaUserId}`),
    ).toHaveText("-$20.00");
    await expect(page.getByTestId("overall-net-settlement")).toContainText(
      "-$10.00 Net You Owe",
    );
  });
});
