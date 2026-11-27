import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import {
  authenticateContextAsUser,
  cleanupE2EGroupsForUser,
  createAdminSupabase,
  ensureE2EUser,
} from "./helpers/supabase-auth";

const E2E_ADMIN_EMAIL = "e2e-fx-admin@ledgersplit.test";
const E2E_ADMIN_NAME = "Alex Rivera";
const E2E_MEMBER_EMAIL = "e2e-fx-member@ledgersplit.test";
const E2E_MEMBER_NAME = "Elena Rostova";
const E2E_THIRD_EMAIL = "e2e-fx-third@ledgersplit.test";
const E2E_THIRD_NAME = "Marcus Vance";

function resolveScreenshotDir(): string {
  const worktreeParentVerification = path.resolve(
    process.cwd(),
    "../../.verification/screenshots",
  );
  if (fs.existsSync(path.resolve(process.cwd(), "../../.verification"))) {
    return worktreeParentVerification;
  }
  return path.resolve(process.cwd(), ".verification/screenshots");
}

const SCREENSHOT_DIR = resolveScreenshotDir();

async function assertNoHorizontalOverflow(page: import("@playwright/test").Page) {
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.innerWidth);
}

test.describe("Issue #77 — Foreign-Currency FX Spot Rate, Manual Override & Audit Persistence", () => {
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

  test("fetches live FX spot rate, marks MANUAL_OVERRIDE on edit, recalculates splits, and persists FX audit columns across desktop & mobile", async ({
    page,
    context,
    baseURL,
  }, testInfo) => {
    const isMobile = testInfo.project.name.includes("mobile");
    const tag = isMobile ? "mobile" : "desktop";
    const resolvedBaseUrl = baseURL || "http://127.0.0.1:3100";

    await cleanupE2EGroupsForUser(adminUserId);
    await authenticateContextAsUser(context, resolvedBaseUrl, E2E_ADMIN_EMAIL);

    // 1. Seed a 3-member USD group
    const admin = createAdminSupabase();
    const groupId = crypto.randomUUID();
    const groupName = `[E2E] Issue 77 FX Group ${tag}`;
    const slug = `e2e-77-${tag}-${Date.now()}`;

    const { error: groupErr } = await admin.from("groups").insert({
      id: groupId,
      name: groupName,
      slug,
      group_type: "TRIP",
      status: "ACTIVE",
      base_currency: "USD",
      default_split_mode: "EQUAL",
      simplify_debts: true,
      billing_cycle_anchor_day: 1,
      invite_token: `tok-77-${tag}-${Date.now()}`,
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

    try {
      // 2. Navigate to /dashboard scoped to the seeded group and open AddEditExpenseModal
      await page.goto(`/dashboard?group=${groupId}`, {
        waitUntil: "networkidle",
      });
      await assertNoHorizontalOverflow(page);

      await page.getByRole("button", { name: /Quick Add/i }).first().click();
      const dialog = page.getByRole("dialog", { name: "Add Expense" });
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText(`Logging to ${groupName}`);

      // 3. Enter €100.00 and Description, then select EUR currency -> triggers /api/fx?from=EUR&to=USD
      await dialog.getByLabel(/Total Bill Amount/i).fill("100.00");
      await dialog
        .getByLabel(/Description/i)
        .fill(`[E2E] Paris Hotel ${tag}`);

      const fxResponsePromise = page.waitForResponse(
        (res) =>
          res.url().includes("/api/fx") &&
          res.url().includes("from=EUR") &&
          res.url().includes("to=USD"),
      );

      await dialog.getByRole("button", { name: /Currency/i }).click();
      await dialog.getByRole("option", { name: /EUR/i }).click();

      const fxRes = await fxResponsePromise;
      expect(fxRes.status()).toBe(200);
      const fxPayload = (await fxRes.json()) as { rate: number; source: string };
      expect(fxPayload.rate).toBeGreaterThan(0);
      expect(fxPayload.source).toBe("API");

      await expect(dialog.getByTestId("fx-conversion-box")).toBeVisible();
      await expect(dialog.getByTestId("fx-rate-source-badge")).toHaveText(
        "API Spot Rate",
      );
      await expect(dialog.getByTestId("fx-base-total")).toContainText("USD");

      // 4. Edit Exchange Rate to 1.25 -> marks Manual Override and recalculates splits ($125.00 -> $41.67 / $41.67 / $41.66)
      const rateInput = dialog.getByRole("textbox", { name: /Exchange Rate/i });
      await rateInput.fill("1.25");

      await expect(dialog.getByTestId("fx-rate-source-badge")).toHaveText(
        "Manual Override",
      );
      await expect(dialog.getByTestId("fx-base-total")).toContainText(
        "$125.00 USD",
      );
      await expect(
        dialog.getByTestId(`split-share-${adminUserId}`),
      ).toContainText("$41.67 (33.34%)");
      await expect(
        dialog.getByTestId(`split-share-${memberUserId}`),
      ).toContainText("$41.67 (33.33%)");
      await expect(
        dialog.getByTestId(`split-share-${thirdUserId}`),
      ).toContainText("$41.66 (33.33%)");

      const saveBtn = dialog.getByRole("button", { name: /Save Expense/i });
      await expect(saveBtn).toBeEnabled();
      await expect(saveBtn).toContainText("Save Expense ($125.00)");

      await assertNoHorizontalOverflow(page);
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, `issue-77-${tag}.png`),
        fullPage: false,
      });

      // 5. Submit and verify persisted DB row + all FX audit columns
      const [createRes] = await Promise.all([
        page.waitForResponse(
          (res) =>
            res.url().includes(`/api/groups/${groupId}/expenses`) &&
            res.request().method() === "POST",
        ),
        saveBtn.click(),
      ]);

      expect(createRes.status()).toBe(201);
      const createJson = await createRes.json();
      const createdId = createJson.expense.id as string;
      expect(createdId).toBeTruthy();

      await expect(dialog).toBeHidden();

      const { data: persistedRow, error: fetchRowErr } = await admin
        .from("expenses")
        .select("*")
        .eq("id", createdId)
        .single();
      if (fetchRowErr) throw fetchRowErr;

      expect(persistedRow.amount_cents).toBe(12500);
      expect(persistedRow.currency).toBe("USD");
      expect(persistedRow.original_amount_cents).toBe(10000);
      expect(persistedRow.original_currency).toBe("EUR");
      expect(Number(persistedRow.exchange_rate)).toBe(1.25);
      expect(persistedRow.exchange_rate_source).toBe("MANUAL_OVERRIDE");
      expect(persistedRow.split_breakdown).toEqual([
        { user_id: adminUserId, share_cents: 4167, percentage: 33.34 },
        { user_id: memberUserId, share_cents: 4167, percentage: 33.33 },
        { user_id: thirdUserId, share_cents: 4166, percentage: 33.33 },
      ]);

      // 6. Verify Dashboard renders converted USD amount + Orig: €100.00
      await expect(page.getByText(`[E2E] Paris Hotel ${tag}`)).toBeVisible();
      await expect(page.getByText("$125.00")).toBeVisible();
      await expect(page.getByText("Orig: €100.00")).toBeVisible();
      await assertNoHorizontalOverflow(page);
    } finally {
      await cleanupE2EGroupsForUser(adminUserId);
    }
  });
});
