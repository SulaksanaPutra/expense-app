import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import {
  authenticateContextAsUser,
  cleanupE2EGroupsForUser,
  cleanupE2EReceiptsForUser,
  createAdminSupabase,
  ensureE2EUser,
} from "./helpers/supabase-auth";

const E2E_ADMIN_EMAIL = "e2e-receipt-admin@ledgersplit.test";
const E2E_ADMIN_NAME = "Alex Rivera";
const E2E_MEMBER_EMAIL = "e2e-receipt-member@ledgersplit.test";
const E2E_MEMBER_NAME = "Elena Rostova";
const QUOTA_BYTES = 524_288_000; // 500 MB

const SCREENSHOT_DIR = path.resolve(
  process.cwd(),
  "../../.verification/screenshots",
);

// Minimal valid 1x1 PNG (67 bytes)
const TINY_PNG_BUFFER = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

// Slightly larger valid PNG with text chunk (~140 bytes) for partial-overflow check
const OVERFLOW_PNG_BUFFER = Buffer.concat([
  TINY_PNG_BUFFER,
  Buffer.alloc(120, 0),
]);

async function assertNoHorizontalOverflow(
  page: import("@playwright/test").Page,
) {
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.innerWidth);
}

test.describe("Issue #78 — Receipt upload & 500 MB per-user quota degradation", () => {
  let adminUserId = "";
  let memberUserId = "";

  test.beforeAll(async () => {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    const [adminUser, memberUser] = await Promise.all([
      ensureE2EUser(E2E_ADMIN_EMAIL, E2E_ADMIN_NAME),
      ensureE2EUser(E2E_MEMBER_EMAIL, E2E_MEMBER_NAME),
    ]);
    adminUserId = adminUser.id;
    memberUserId = memberUser.id;
    await cleanupE2EGroupsForUser(adminUserId);
    await cleanupE2EReceiptsForUser(adminUserId);
  });

  test.afterAll(async () => {
    if (adminUserId) {
      await cleanupE2EGroupsForUser(adminUserId);
      await cleanupE2EReceiptsForUser(adminUserId);
    }
  });

  test("increments User.receipt_storage_used_bytes across groups and degrades non-blockingly at 500 MB", async ({
    page,
    context,
    baseURL,
  }, testInfo) => {
    const isMobile = testInfo.project.name.includes("mobile");
    const tag = isMobile ? "mobile" : "desktop";
    const resolvedBaseUrl = baseURL || "http://127.0.0.1:3100";

    await cleanupE2EGroupsForUser(adminUserId);
    await cleanupE2EReceiptsForUser(adminUserId);
    await authenticateContextAsUser(context, resolvedBaseUrl, E2E_ADMIN_EMAIL);

    const admin = createAdminSupabase();
    const groupAId = crypto.randomUUID();
    const groupBId = crypto.randomUUID();
    const groupAName = `[E2E] Issue 78 Group A ${tag}`;
    const groupBName = `[E2E] Issue 78 Group B ${tag}`;
    const nowTag = Date.now();

    const { error: groupsErr } = await admin.from("groups").insert([
      {
        id: groupAId,
        name: groupAName,
        slug: `e2e-78-a-${tag}-${nowTag}`,
        group_type: "RESIDENTIAL",
        status: "ACTIVE",
        base_currency: "USD",
        default_split_mode: "EQUAL",
        simplify_debts: true,
        billing_cycle_anchor_day: 1,
        invite_token: `tok-78a-${tag}-${nowTag}`,
        invite_token_version: 1,
        created_by: adminUserId,
      },
      {
        id: groupBId,
        name: groupBName,
        slug: `e2e-78-b-${tag}-${nowTag}`,
        group_type: "TRIP",
        status: "ACTIVE",
        base_currency: "USD",
        default_split_mode: "EQUAL",
        simplify_debts: true,
        billing_cycle_anchor_day: 1,
        invite_token: `tok-78b-${tag}-${nowTag}`,
        invite_token_version: 1,
        created_by: adminUserId,
      },
    ]);
    if (groupsErr) throw groupsErr;

    const { error: membersErr } = await admin.from("group_members").insert([
      {
        group_id: groupAId,
        user_id: adminUserId,
        role: "ADMIN",
        status: "ACTIVE",
        share_percentage: 50,
      },
      {
        group_id: groupAId,
        user_id: memberUserId,
        role: "MEMBER",
        status: "ACTIVE",
        share_percentage: 50,
      },
      {
        group_id: groupBId,
        user_id: adminUserId,
        role: "ADMIN",
        status: "ACTIVE",
        share_percentage: 50,
      },
      {
        group_id: groupBId,
        user_id: memberUserId,
        role: "MEMBER",
        status: "ACTIVE",
        share_percentage: 50,
      },
    ]);
    if (membersErr) throw membersErr;

    // 1. Upload receipt in Group A -> verifies storage upload + User.receipt_storage_used_bytes increment
    await page.goto(`/dashboard?group=${groupAId}`, { waitUntil: "networkidle" });
    await assertNoHorizontalOverflow(page);

    await page.getByRole("button", { name: /Quick Add/i }).first().click();
    const dialog = page.getByRole("dialog", { name: "Add Expense" });
    await expect(dialog).toBeVisible();

    await dialog.getByLabel(/Total Bill Amount/i).fill("40.00");
    await dialog.getByLabel(/Description/i).fill(`[E2E] Groceries Receipt ${tag}`);

    const fileInput = dialog.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: `receipt-a-${tag}.png`,
      mimeType: "image/png",
      buffer: TINY_PNG_BUFFER,
    });
    await expect(dialog).toContainText(`receipt-a-${tag}.png`);

    const [uploadResA, expenseResA] = await Promise.all([
      page.waitForResponse(
        (res) =>
          res.url().includes("/api/receipts") &&
          res.request().method() === "POST",
      ),
      page.waitForResponse(
        (res) =>
          res.url().includes(`/api/groups/${groupAId}/expenses`) &&
          res.request().method() === "POST",
      ),
      dialog.getByRole("button", { name: /Save Expense/i }).click(),
    ]);

    expect(uploadResA.status()).toBe(201);
    const uploadJsonA = await uploadResA.json();
    expect(uploadJsonA.usedBytes).toBe(TINY_PNG_BUFFER.length);
    expect(uploadJsonA.receiptUrl).toMatch(
      new RegExp(`^receipts://${adminUserId}/${groupAId}/`),
    );

    expect(expenseResA.status()).toBe(201);
    const expenseJsonA = await expenseResA.json();
    expect(expenseJsonA.expense.receipt_url).toBe(uploadJsonA.receiptUrl);
    await expect(dialog).toBeHidden();

    // Verify receipt attachment link renders on Dashboard and resolves signed URL
    await expect(
      page.getByRole("link", {
        name: `View receipt for [E2E] Groceries Receipt ${tag}`,
      }),
    ).toBeVisible();

    const signedCheck = await page.evaluate(async (receiptUrl) => {
      const res = await fetch(
        `/api/receipts?format=json&path=${encodeURIComponent(receiptUrl)}`,
      );
      return { status: res.status, body: await res.json() };
    }, uploadJsonA.receiptUrl);
    expect(signedCheck.status).toBe(200);
    expect(signedCheck.body.signedUrl).toContain("token=");

    // 2. Switch to Group B and upload a second receipt -> accumulates across all groups
    await page.goto(`/dashboard?group=${groupBId}`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /Quick Add/i }).first().click();
    await expect(dialog).toBeVisible();

    await dialog.getByLabel(/Total Bill Amount/i).fill("24.00");
    await dialog.getByLabel(/Description/i).fill(`[E2E] Transit Receipt ${tag}`);
    await dialog.locator('input[type="file"]').setInputFiles({
      name: `receipt-b-${tag}.png`,
      mimeType: "image/png",
      buffer: TINY_PNG_BUFFER,
    });

    const [uploadResB, expenseResB] = await Promise.all([
      page.waitForResponse(
        (res) =>
          res.url().includes("/api/receipts") &&
          res.request().method() === "POST",
      ),
      page.waitForResponse(
        (res) =>
          res.url().includes(`/api/groups/${groupBId}/expenses`) &&
          res.request().method() === "POST",
      ),
      dialog.getByRole("button", { name: /Save Expense/i }).click(),
    ]);

    expect(uploadResB.status()).toBe(201);
    const uploadJsonB = await uploadResB.json();
    expect(uploadJsonB.usedBytes).toBe(TINY_PNG_BUFFER.length * 2);
    expect(expenseResB.status()).toBe(201);

    const { data: userAfterB } = await admin
      .from("users")
      .select("receipt_storage_used_bytes")
      .eq("id", adminUserId)
      .single();
    expect(Number(userAfterB?.receipt_storage_used_bytes)).toBe(
      TINY_PNG_BUFFER.length * 2,
    );

    // 3. Test partial-overflow rejection (QUOTA_BYTES - 50 bytes remaining, attach 187-byte file)
    await admin
      .from("users")
      .update({ receipt_storage_used_bytes: QUOTA_BYTES - 50 })
      .eq("id", adminUserId);

    await page.goto(`/dashboard?group=${groupAId}`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /Quick Add/i }).first().click();
    await expect(dialog).toBeVisible();

    await dialog.locator('input[type="file"]').setInputFiles({
      name: `overflow-${tag}.png`,
      mimeType: "image/png",
      buffer: OVERFLOW_PNG_BUFFER,
    });

    const alertBanner = dialog.getByRole("alert");
    await expect(alertBanner).toBeVisible();
    await expect(alertBanner).toContainText(
      "Receipt storage full (500 MB). Expense will be logged without receipt.",
    );
    await expect(dialog).not.toContainText(`overflow-${tag}.png`);
    await dialog.getByRole("button", { name: "Cancel" }).click();

    // 4. Test 100% quota exhaustion (500 MB) -> clicking Attach Receipt shows AlertBanner, Expense saves without receipt
    await admin
      .from("users")
      .update({ receipt_storage_used_bytes: QUOTA_BYTES })
      .eq("id", adminUserId);

    await page.goto(`/dashboard?group=${groupAId}`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /Quick Add/i }).first().click();
    await expect(dialog).toBeVisible();

    await dialog.getByLabel(/Total Bill Amount/i).fill("50.00");
    await dialog.getByLabel(/Description/i).fill(`[E2E] Quota Full Expense ${tag}`);

    await dialog.getByRole("button", { name: /Attach Receipt/i }).click();
    await expect(dialog.getByRole("alert")).toBeVisible();
    await expect(dialog.getByRole("alert")).toContainText(
      "Receipt storage full (500 MB). Expense will be logged without receipt.",
    );

    await assertNoHorizontalOverflow(page);

    // Verify Save Expense button and AlertBanner do not overlap on desktop or mobile
    const alertBox = await dialog.getByRole("alert").boundingBox();
    const saveBtn = dialog.getByRole("button", { name: /Save Expense/i });
    const saveBox = await saveBtn.boundingBox();
    expect(alertBox).not.toBeNull();
    expect(saveBox).not.toBeNull();
    expect(alertBox!.y + alertBox!.height).toBeLessThanOrEqual(saveBox!.y + 1);

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, `issue-78-${tag}.png`),
      fullPage: false,
    });

    await expect(saveBtn).toBeEnabled();
    const [expenseNoReceiptRes] = await Promise.all([
      page.waitForResponse(
        (res) =>
          res.url().includes(`/api/groups/${groupAId}/expenses`) &&
          res.request().method() === "POST",
      ),
      saveBtn.click(),
    ]);

    expect(expenseNoReceiptRes.status()).toBe(201);
    const createdNoReceipt = await expenseNoReceiptRes.json();
    expect(createdNoReceipt.expense.receipt_url).toBeNull();
    await expect(dialog).toBeHidden();
    await expect(
      page.getByText(`[E2E] Quota Full Expense ${tag}`),
    ).toBeVisible();
  });
});
