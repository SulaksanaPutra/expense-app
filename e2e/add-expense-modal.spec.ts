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
const E2E_THIRD_EMAIL = "e2e-third@ledgersplit.test";
const E2E_THIRD_NAME = "Marcus Vance";
const SCREENSHOT_DIR = path.resolve(process.cwd(), ".verification/screenshots");

async function assertNoHorizontalOverflow(page: import("@playwright/test").Page) {
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.innerWidth);
}

test.describe("Issue #74 — Minor-unit Split Engine & AddEditExpenseModal (create mode)", () => {
  let adminUserId = "";
  let memberUserId = "";
  let thirdUserId = "";

  test.beforeAll(async () => {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
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

  test("verifies 3-way $100.00 payer-first penny rounding, disabled-until-valid gate, and persistence across desktop & mobile", async ({
    page,
    context,
    baseURL,
  }, testInfo) => {
    const isMobile = testInfo.project.name.includes("mobile");
    const tag = isMobile ? "mobile" : "desktop";
    const resolvedBaseUrl = baseURL || "http://127.0.0.1:3100";

    await cleanupE2EGroupsForUser(adminUserId);
    await authenticateContextAsUser(context, resolvedBaseUrl, E2E_ADMIN_EMAIL);

    // 1. Seed a 3-member active group owned by adminUserId
    const admin = createAdminSupabase();
    const groupId = crypto.randomUUID();
    const groupName = `[E2E] Issue 74 Group ${tag}`;
    const slug = `e2e-74-${tag}-${Date.now()}`;

    const { error: groupErr } = await admin.from("groups").insert({
      id: groupId,
      name: groupName,
      slug,
      group_type: "RESIDENTIAL",
      status: "ACTIVE",
      base_currency: "USD",
      default_split_mode: "EQUAL",
      simplify_debts: true,
      billing_cycle_anchor_day: 1,
      invite_token: `tok-${tag}-${Date.now()}`,
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

    // 2. Open /split-groups and trigger Quick Split
    await page.goto("/split-groups", { waitUntil: "networkidle" });
    await assertNoHorizontalOverflow(page);

    await page
      .getByRole("button", { name: `Quick Split for ${groupName}` })
      .click();

    const dialog = page.getByRole("dialog", { name: "Add Expense" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(`Logging to ${groupName}`);

    // Desktop sidebar must not overlap modal
    if (!isMobile) {
      const sidebarBox = await page
        .getByTestId("desktop-sidebar")
        .boundingBox();
      const dialogBox = await dialog.boundingBox();
      expect(sidebarBox).not.toBeNull();
      expect(dialogBox).not.toBeNull();
    }

    // 3. Verify Save Expense is disabled initially
    const saveBtn = dialog.getByRole("button", { name: /Save Expense/i });
    await expect(saveBtn).toBeDisabled();

    // 4. Enter $100.00 and verify deterministic payer-first 3334 / 3333 / 3333 split
    await dialog.getByLabel(/Total Bill Amount/i).fill("100.00");
    await expect(dialog.getByTestId(`split-share-${adminUserId}`)).toContainText(
      "$33.34 (33.34%)",
    );
    await expect(
      dialog.getByTestId(`split-share-${memberUserId}`),
    ).toContainText("$33.33 (33.33%)");
    await expect(dialog.getByTestId(`split-share-${thirdUserId}`)).toContainText(
      "$33.33 (33.33%)",
    );

    // Still disabled without Description
    await expect(saveBtn).toBeDisabled();

    // Fill Description -> Save Expense becomes enabled
    await dialog
      .getByLabel(/Description/i)
      .fill(`[E2E] Whole Foods ${tag}`);
    await expect(saveBtn).toBeEnabled();

    // 5. Verify Exact Amounts mismatch disables Save Expense
    await dialog.getByRole("tab", { name: "Exact Amounts" }).click();
    const payerExactInput = dialog.getByLabel(
      `${E2E_ADMIN_NAME} exact amount`,
    );
    await payerExactInput.fill("40.00");
    await expect(saveBtn).toBeDisabled();
    await expect(dialog.getByTestId("split-balance-bar")).toContainText(
      "Over by $6.66",
    );

    // 6. Switch back to Split Evenly, capture screenshot of balanced modal
    await dialog.getByRole("tab", { name: "Split Evenly" }).click();
    await expect(dialog.getByTestId("split-balance-bar")).toContainText(
      "$100.00 of $100.00 assigned (100%)",
    );
    await expect(saveBtn).toBeEnabled();
    await assertNoHorizontalOverflow(page);

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, `issue-74-${tag}.png`),
      fullPage: false,
    });

    // 7. Submit and assert persisted Expense + split_breakdown JSONB in Group.base_currency
    const [createExpenseRes] = await Promise.all([
      page.waitForResponse(
        (res) =>
          res.url().includes(`/api/groups/${groupId}/expenses`) &&
          res.request().method() === "POST",
      ),
      saveBtn.click(),
    ]);

    expect(createExpenseRes.status()).toBe(201);
    const createdJson = await createExpenseRes.json();
    expect(createdJson.expense.currency).toBe("USD");
    expect(createdJson.expense.amount_cents).toBe(10000);
    expect(createdJson.expense.split_breakdown).toEqual([
      { user_id: adminUserId, share_cents: 3334, percentage: 33.34 },
      { user_id: memberUserId, share_cents: 3333, percentage: 33.33 },
      { user_id: thirdUserId, share_cents: 3333, percentage: 33.33 },
    ]);

    await expect(dialog).toBeHidden();

    // 8. Navigate to /dashboard, verify expense appears and Quick Add + TopBar + Add Expense open modal
    await page.goto(`/dashboard?group=${groupId}`, { waitUntil: "networkidle" });
    await expect(page.getByText(`[E2E] Whole Foods ${tag}`)).toBeVisible();
    await assertNoHorizontalOverflow(page);

    await page.getByRole("button", { name: /Quick Add/i }).click();
    await expect(page.getByRole("dialog", { name: "Add Expense" })).toBeVisible();
    await page
      .getByRole("dialog", { name: "Add Expense" })
      .getByRole("button", { name: "Cancel" })
      .click();
    await expect(page.getByRole("dialog", { name: "Add Expense" })).toBeHidden();

    await page.getByRole("button", { name: "Add Expense" }).click();
    await expect(page.getByRole("dialog", { name: "Add Expense" })).toBeVisible();
    await page
      .getByRole("dialog", { name: "Add Expense" })
      .getByRole("button", { name: "Cancel" })
      .click();
  });
});
