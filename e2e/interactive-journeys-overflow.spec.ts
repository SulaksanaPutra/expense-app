import fs from "node:fs";
import path from "node:path";
import { expect, test, type Download, type Locator, type Page } from "@playwright/test";
import {
  authenticateContextAsUser,
  cleanupE2EGroupsForUser,
  createAdminSupabase,
  deleteE2EUsersById,
  ensureE2EUser,
} from "./helpers/supabase-auth";

const E2E_ALEX_EMAIL = "e2e-90-alex@ledgersplit.test";
const E2E_ALEX_NAME = "Alex Rivera";
const E2E_ELENA_EMAIL = "e2e-90-elena@ledgersplit.test";
const E2E_ELENA_NAME = "Elena Rostova";

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

function getCurrentCycleSlug(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

async function assertNoHorizontalOverflow(page: Page) {
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.innerWidth);
}

async function assertDialogUsableInViewport(
  page: Page,
  dialog: Locator,
  primaryButton?: Locator,
) {
  await expect(dialog).toBeVisible();
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  const box = await dialog.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThan(240);
  expect(box!.x).toBeGreaterThanOrEqual(-1);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width + 1);
  expect(box!.height).toBeLessThanOrEqual(viewport!.height + 1);

  if (primaryButton) {
    await expect(primaryButton).toBeVisible();
    const btnBox = await primaryButton.boundingBox();
    expect(btnBox).not.toBeNull();
    expect(btnBox!.x).toBeGreaterThanOrEqual(0);
    expect(btnBox!.x + btnBox!.width).toBeLessThanOrEqual(viewport!.width + 1);
  }
  await assertNoHorizontalOverflow(page);
}

async function dismissAllToasts(page: Page) {
  const closeToastBtns = page.getByRole("button", { name: "Close notification" });
  while ((await closeToastBtns.count()) > 0) {
    await closeToastBtns.first().click();
  }
}

async function readDownloadText(download: Download): Promise<string> {
  const filePath = await download.path();
  if (!filePath) {
    throw new Error("Playwright download path was null.");
  }
  return fs.readFileSync(filePath, "utf8");
}

test.describe("Issue #90 — Interactive E2E Journeys & Desktop/Mobile Overflow Suite", () => {
  let alexUserId = "";
  let elenaUserId = "";

  test.beforeAll(async () => {
    fs.mkdirSync(resolveScreenshotDir(), { recursive: true });
    const [alex, elena] = await Promise.all([
      ensureE2EUser(E2E_ALEX_EMAIL, E2E_ALEX_NAME),
      ensureE2EUser(E2E_ELENA_EMAIL, E2E_ELENA_NAME),
    ]);
    alexUserId = alex.id;
    elenaUserId = elena.id;
    await cleanupE2EGroupsForUser(alexUserId);
  });

  test.afterAll(async () => {
    if (alexUserId) {
      await cleanupE2EGroupsForUser(alexUserId);
    }
    if (elenaUserId) {
      await cleanupE2EGroupsForUser(elenaUserId);
    }
    await deleteE2EUsersById([alexUserId, elenaUserId]);
  });

  test("executes full connected journeys (login, create group, join invite, split+FX, simplify & partial settle, adjustment & close cycle, settings, reminder cooldown, CSV export) with zero overflow across desktop & mobile", async ({
    page,
    context,
    browser,
    baseURL,
  }, testInfo) => {
    test.setTimeout(240_000);

    const isMobile = testInfo.project.name.includes("mobile");
    const tag = isMobile ? "mobile" : "desktop";
    const resolvedBaseUrl = baseURL || "http://127.0.0.1:3100";
    const cycleSlug = getCurrentCycleSlug();

    // Ensure clean state before run
    await cleanupE2EGroupsForUser(alexUserId);
    const admin = createAdminSupabase();
    await admin
      .from("users")
      .update({
        instant_settlement_tag: null,
        personal_share_cap_cents: null,
        receipt_storage_used_bytes: 0,
      })
      .in("id", [alexUserId, elenaUserId]);
    await admin
      .from("reminder_logs")
      .delete()
      .in("creditor_id", [alexUserId, elenaUserId]);
    await admin
      .from("notifications")
      .delete()
      .in("user_id", [alexUserId, elenaUserId]);

    // -----------------------------------------------------------------------
    // 1. Login & Auth Guard Journey + /join invalid token check
    // -----------------------------------------------------------------------
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login\?next=%2Fdashboard/);
    await expect(
      page.getByRole("button", { name: /Send Magic Link/i }),
    ).toBeVisible();
    await assertNoHorizontalOverflow(page);

    await page.getByLabel(/Email address/i).fill("invalid-email");
    await page.getByRole("button", { name: /Send Magic Link/i }).click();
    await expect(
      page.getByText("Enter an email address in the format you@example.com."),
    ).toBeVisible();
    await assertNoHorizontalOverflow(page);

    await page.goto("/join/invalid-group-slug?token=tampered-token");
    await expect(
      page.getByRole("heading", { name: "Invalid invitation link" }),
    ).toBeVisible();
    await assertNoHorizontalOverflow(page);

    // -----------------------------------------------------------------------
    // 2. Authenticate as Alex, check Mobile Drawer, Create Group & Modal Usability
    // -----------------------------------------------------------------------
    await authenticateContextAsUser(context, resolvedBaseUrl, E2E_ALEX_EMAIL);
    await page.goto("/split-groups", { waitUntil: "networkidle" });
    await expect(
      page.getByRole("heading", { name: "Split Groups", exact: true }),
    ).toBeVisible();
    await assertNoHorizontalOverflow(page);

    if (isMobile) {
      await page.getByRole("button", { name: "Open navigation menu" }).click();
      const drawer = page.getByRole("dialog", { name: "Mobile navigation" });
      await assertDialogUsableInViewport(
        page,
        drawer,
        drawer.getByRole("button", { name: "Close navigation menu" }),
      );
      await expect(
        drawer.getByRole("button", { name: /Active Group/i }),
      ).toBeVisible();
      await drawer
        .getByRole("button", { name: "Close navigation menu" })
        .click();
      await expect(drawer).toBeHidden();
    }

    // Create Group interactively
    await page
      .getByRole("button", { name: /Create New Group/i })
      .first()
      .click();
    const createDialog = page.getByRole("dialog", { name: "Create New Group" });
    await assertDialogUsableInViewport(
      page,
      createDialog,
      createDialog.getByRole("button", { name: "Create Group" }),
    );

    const groupName = `[E2E] Issue 90 Residence ${tag}`;
    await createDialog.getByLabel(/Group Name/i).fill(groupName);
    await createDialog.getByLabel(/Operational Budget/i).fill("3000.00");

    const [createGroupRes] = await Promise.all([
      page.waitForResponse(
        (res) =>
          res.url().includes("/api/groups") && res.request().method() === "POST",
      ),
      createDialog.getByRole("button", { name: "Create Group" }).click(),
    ]);
    expect(createGroupRes.status()).toBe(201);
    const createdGroupJson = (await createGroupRes.json()) as {
      group: { id: string };
    };
    const groupId = createdGroupJson.group.id;
    expect(groupId).toBeTruthy();

    await expect(createDialog).toBeHidden();
    await expect(page.getByTestId("spotlight-partition")).toBeVisible();
    await assertNoHorizontalOverflow(page);
    await dismissAllToasts(page);

    const inviteValue = await page.getByLabel("Group invite link").inputValue();
    expect(inviteValue).toMatch(/\/join\/.+\?token=.+/);
    const inviteUrl = new URL(inviteValue, resolvedBaseUrl);
    const invitePath = `${inviteUrl.pathname}${inviteUrl.search}`;

    // Check Edit Ratios, Archive Rules, and Audit Log drawer at current viewport
    await page.getByRole("button", { name: "Edit Ratios" }).first().click();
    const ratiosDialog = page.getByRole("dialog", {
      name: /Edit Split Rules & Ratios/i,
    });
    await assertDialogUsableInViewport(
      page,
      ratiosDialog,
      ratiosDialog.getByRole("button", { name: /Save Ratios/i }),
    );
    await ratiosDialog.getByRole("button", { name: "Cancel" }).click();
    await expect(ratiosDialog).toBeHidden();

    await page.getByRole("button", { name: "Archive Rules" }).first().click();
    const archiveDialog = page.getByRole("dialog", { name: /Archive Rules/i });
    await assertDialogUsableInViewport(
      page,
      archiveDialog,
      archiveDialog.getByRole("button", { name: /Save Rules/i }),
    );
    await archiveDialog.getByRole("button", { name: "Cancel" }).click();
    await expect(archiveDialog).toBeHidden();

    await page
      .getByTestId("spotlight-partition")
      .getByRole("button", { name: "Log", exact: true })
      .click();
    const auditDrawer = page.getByTestId("audit-log-drawer");
    await assertDialogUsableInViewport(
      page,
      auditDrawer,
      auditDrawer.getByRole("button", { name: "Close", exact: true }),
    );
    await auditDrawer.getByRole("button", { name: "Close", exact: true }).click();
    await expect(auditDrawer).toBeHidden();

    // -----------------------------------------------------------------------
    // 3. Join via Invite Journey (Elena)
    // -----------------------------------------------------------------------
    const elenaCtx = await browser.newContext({
      viewport: isMobile
        ? { width: 375, height: 812 }
        : { width: 1280, height: 800 },
    });

    try {
      const elenaPage = await elenaCtx.newPage();

      // Unauthenticated invite preview
      await elenaPage.goto(invitePath, { waitUntil: "networkidle" });
      await expect(
        elenaPage.getByRole("heading", { name: `Join ${groupName}` }),
      ).toBeVisible();
      await expect(
        elenaPage.getByRole("link", { name: new RegExp(`Sign in to Join ${groupName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) }),
      ).toBeVisible();
      await assertNoHorizontalOverflow(elenaPage);

      // Authenticated Elena joins via invite
      await authenticateContextAsUser(elenaCtx, resolvedBaseUrl, E2E_ELENA_EMAIL);
      await elenaPage.goto(invitePath, { waitUntil: "networkidle" });
      await assertNoHorizontalOverflow(elenaPage);

      const joinBtn = elenaPage.getByRole("button", { name: `Join ${groupName}` });
      await expect(joinBtn).toBeVisible();
      const [joinRes] = await Promise.all([
        elenaPage.waitForResponse(
          (res) =>
            res.url().includes("/api/groups/join") &&
            res.request().method() === "POST",
        ),
        joinBtn.click(),
      ]);
      expect(joinRes.status()).toBe(200);
      await expect(elenaPage).toHaveURL(new RegExp(`/split-groups\\?group=${groupId}`));
      await expect(elenaPage.getByText("Elena Rostova")).toBeVisible();
      await assertNoHorizontalOverflow(elenaPage);
    } finally {
      await elenaCtx.close();
    }

    // -----------------------------------------------------------------------
    // 4. Add Expense with Split + FX & Quick Search Dialog (/dashboard)
    // -----------------------------------------------------------------------
    await page.goto(`/dashboard?group=${groupId}&cycle=${cycleSlug}`, {
      waitUntil: "networkidle",
    });
    await assertNoHorizontalOverflow(page);

    // Quick Search dialog usability check
    if (isMobile) {
      await page
        .getByRole("button", { name: "Search expenses and groups" })
        .click();
    } else {
      await page.keyboard.press("Control+k");
    }
    const searchDialog = page.getByRole("dialog", { name: "Quick Search" });
    await assertDialogUsableInViewport(page, searchDialog);
    await searchDialog.getByRole("button", { name: "Close dialog" }).click();
    await expect(searchDialog).toBeHidden();

    // Open Add Expense modal via TopBar CTA
    await page.getByRole("button", { name: "Add Expense" }).click();
    const addDialog = page.getByRole("dialog", { name: "Add Expense" });
    const saveExpenseBtn = addDialog.getByRole("button", {
      name: /Save Expense/i,
    });
    await assertDialogUsableInViewport(page, addDialog, saveExpenseBtn);

    const fxDesc = `[E2E] Euro Villa Deposit ${tag}`;
    await addDialog.getByLabel(/Total Bill Amount/i).fill("100.00");
    await addDialog.getByLabel(/Description/i).fill(fxDesc);
    await addDialog.getByLabel(/^Date/i).fill(`${cycleSlug}-01`);

    const fxResPromise = page.waitForResponse(
      (res) =>
        res.url().includes("/api/fx") &&
        res.url().includes("from=EUR") &&
        res.url().includes("to=USD"),
    );
    await addDialog.getByRole("button", { name: /Currency/i }).click();
    await addDialog.getByRole("option", { name: /EUR/i }).click();
    const fxRes = await fxResPromise;
    expect(fxRes.status()).toBe(200);

    const rateInput = addDialog.getByRole("textbox", { name: /Exchange Rate/i });
    await rateInput.fill("1.20");
    await expect(addDialog.getByTestId("fx-base-total")).toContainText(
      "$120.00 USD",
    );
    await expect(addDialog.getByTestId(`split-share-${alexUserId}`)).toContainText(
      "$60.00 (50%)",
    );
    await expect(addDialog.getByTestId(`split-share-${elenaUserId}`)).toContainText(
      "$60.00 (50%)",
    );

    const [createExpRes] = await Promise.all([
      page.waitForResponse(
        (res) =>
          res.url().includes(`/api/groups/${groupId}/expenses`) &&
          res.request().method() === "POST",
      ),
      saveExpenseBtn.click(),
    ]);
    expect(createExpRes.status()).toBe(201);
    await expect(addDialog).toBeHidden();
    await dismissAllToasts(page);

    // -----------------------------------------------------------------------
    // 5. Simplify Switch & Partial Settle (RecordSettlementModal)
    // -----------------------------------------------------------------------
    const peerCard = page.getByTestId("peer-balances-card");
    await expect(
      peerCard.getByTestId(`peer-balance-amount-${elenaUserId}-${alexUserId}`),
    ).toHaveText("+$60.00");

    const simplifySwitch = peerCard.getByRole("switch", { name: /Simplify/i });
    const [simplifyOffRes] = await Promise.all([
      page.waitForResponse(
        (res) =>
          res.url().includes(`/api/groups/${groupId}/simplify`) &&
          res.request().method() === "PATCH",
      ),
      simplifySwitch.click(),
    ]);
    expect(simplifyOffRes.status()).toBe(200);
    await expect(simplifySwitch).toHaveAttribute("aria-checked", "false");

    const [simplifyOnRes] = await Promise.all([
      page.waitForResponse(
        (res) =>
          res.url().includes(`/api/groups/${groupId}/simplify`) &&
          res.request().method() === "PATCH",
      ),
      simplifySwitch.click(),
    ]);
    expect(simplifyOnRes.status()).toBe(200);
    await expect(simplifySwitch).toHaveAttribute("aria-checked", "true");
    await dismissAllToasts(page);

    // Elena opens RecordSettlementModal and makes a $25.00 partial settlement
    const settleCtx = await browser.newContext({
      viewport: isMobile
        ? { width: 375, height: 812 }
        : { width: 1280, height: 800 },
    });
    try {
      await authenticateContextAsUser(
        settleCtx,
        resolvedBaseUrl,
        E2E_ELENA_EMAIL,
      );
      const settlePage = await settleCtx.newPage();
      await settlePage.goto(`/dashboard?group=${groupId}&cycle=${cycleSlug}`, {
        waitUntil: "networkidle",
      });
      await assertNoHorizontalOverflow(settlePage);

      await settlePage
        .getByTestId("peer-balances-card")
        .getByRole("button", { name: /Settle Up/i })
        .click();

      const settleDialog = settlePage.getByRole("dialog", {
        name: "Record Settlement",
      });
      const markSettledBtn = settleDialog.getByRole("button", {
        name: /Mark as Settled/i,
      });
      await assertDialogUsableInViewport(
        settlePage,
        settleDialog,
        markSettledBtn,
      );

      const settleAmount = settleDialog.getByLabel(/Settlement Amount \(USD\)/i);
      await settleAmount.fill("25.00");
      await expect(
        settleDialog.getByTestId("settlement-progress-hint"),
      ).toContainText("Partial payment: $35.00 will remain unsettled.");

      const [settleRes] = await Promise.all([
        settlePage.waitForResponse(
          (res) =>
            res.url().includes(`/api/groups/${groupId}/settlements`) &&
            res.request().method() === "POST",
        ),
        markSettledBtn.click(),
      ]);
      expect(settleRes.status()).toBe(201);
      await expect(settleDialog).toBeHidden();
      await expect(settlePage.getByTestId("kpi-you-owe")).toContainText(
        "-$35.00",
      );
    } finally {
      await settleCtx.close();
    }

    // -----------------------------------------------------------------------
    // 6. Offsetting Adjustment, Recurring Modal Check & Close Cycle (/expenses)
    // -----------------------------------------------------------------------
    await page.goto(`/expenses?group=${groupId}&cycle=${cycleSlug}`, {
      waitUntil: "networkidle",
    });
    await assertNoHorizontalOverflow(page);
    await expect(page.getByText("LOCKED").first()).toBeVisible();

    // Check Recurring tab & Add Recurring Rule modal usability at 375px
    await page.getByRole("tab", { name: "Recurring" }).click();
    await expect(page.getByTestId("recurring-rules-panel")).toBeVisible();
    await assertNoHorizontalOverflow(page);
    await page.getByRole("button", { name: /Add Recurring Rule/i }).click();
    const recDialog = page.getByRole("dialog", { name: "Add Recurring Rule" });
    await assertDialogUsableInViewport(
      page,
      recDialog,
      recDialog.getByRole("button", { name: "Save Rule" }),
    );
    await recDialog.getByRole("button", { name: "Cancel" }).click();
    await expect(recDialog).toBeHidden();

    await page.getByRole("tab", { name: "All Expenses" }).click();

    // Log Offsetting Adjustment on the locked FX expense (-$10.00 -> $110.00 net, Elena owes $30.00)
    await page
      .getByRole("button", { name: `Actions for ${fxDesc}` })
      .click();
    await page.getByRole("menuitem", { name: /Log Adjustment/i }).click();

    const adjDialog = page.getByRole("dialog", {
      name: "Log Offsetting Adjustment",
    });
    const saveAdjBtn = adjDialog.getByRole("button", {
      name: /Save Adjustment/i,
    });
    await assertDialogUsableInViewport(page, adjDialog, saveAdjBtn);
    await adjDialog.getByLabel(/Amount/i).fill("-10.00");

    const [adjRes] = await Promise.all([
      page.waitForResponse(
        (res) =>
          res.url().includes(`/api/groups/${groupId}/expenses`) &&
          res.request().method() === "POST",
      ),
      saveAdjBtn.click(),
    ]);
    expect(adjRes.status()).toBe(201);
    await expect(adjDialog).toBeHidden();
    await expect(
      page.getByText(`Adjustment: ${fxDesc}`, { exact: true }),
    ).toBeVisible();
    await dismissAllToasts(page);

    // Close & Lock Billing Cycle via ConfirmDialog
    await page.getByRole("button", { name: /Close & Lock Cycle/i }).click();
    const closeConfirmDialog = page.getByRole("dialog");
    const confirmCloseBtn = closeConfirmDialog.getByRole("button", {
      name: /Close & Lock Cycle/i,
    });
    await assertDialogUsableInViewport(
      page,
      closeConfirmDialog,
      confirmCloseBtn,
    );
    await confirmCloseBtn.click();
    await expect(page.getByText("Closed Period")).toBeVisible();
    await assertNoHorizontalOverflow(page);
    await dismissAllToasts(page);

    // -----------------------------------------------------------------------
    // 7. Update Settings & Payment Handle Modal (/settings)
    // -----------------------------------------------------------------------
    await page.goto(`/settings?group=${groupId}&cycle=${cycleSlug}`, {
      waitUntil: "networkidle",
    });
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await assertNoHorizontalOverflow(page);

    await page
      .getByRole("button", { name: "Add", exact: true })
      .first()
      .click();
    const pmDialog = page.getByRole("dialog", { name: "Add Settlement Handle" });
    await assertDialogUsableInViewport(
      page,
      pmDialog,
      pmDialog.getByRole("button", { name: "Add Handle" }),
    );
    await pmDialog.getByRole("button", { name: "Cancel" }).click();
    await expect(pmDialog).toBeHidden();

    const settlementTagValue = `alex-90-${tag}`;
    await page.getByLabel(/Instant Settlement Tag/i).fill(settlementTagValue);
    await page.getByLabel(/Personal Share Cap/i).fill("1500.00");
    await page.getByRole("button", { name: /Save Changes/i }).click();
    await expect(page.getByText("Settings saved")).toBeVisible();
    await dismissAllToasts(page);

    await page.reload({ waitUntil: "networkidle" });
    await expect(page.getByLabel(/Instant Settlement Tag/i)).toHaveValue(
      settlementTagValue,
    );
    await expect(page.getByLabel(/Personal Share Cap/i)).toHaveValue("1500.00");
    await assertNoHorizontalOverflow(page);

    // -----------------------------------------------------------------------
    // 8. Reminder Cooldown + Export CSV + Representative Screenshot (/dashboard)
    // -----------------------------------------------------------------------
    await page.goto(`/dashboard?group=${groupId}&cycle=${cycleSlug}`, {
      waitUntil: "networkidle",
    });
    await expect(page.getByTestId("settled-closed-period-badge")).toHaveText(
      "Settled / Closed Period",
    );
    await assertNoHorizontalOverflow(page);

    const remindElenaBtn = page.getByTestId(
      `remind-peer-btn-${groupId}-${elenaUserId}`,
    );
    await expect(remindElenaBtn).toBeEnabled();
    const [remindRes] = await Promise.all([
      page.waitForResponse(
        (res) =>
          res.url().includes(`/api/groups/${groupId}/reminders`) &&
          res.request().method() === "POST",
      ),
      remindElenaBtn.click(),
    ]);
    expect(remindRes.status()).toBe(201);
    await expect(remindElenaBtn).toBeDisabled();
    await expect(remindElenaBtn).toHaveText("Reminded today (24h remaining)");

    // Confirm 429 cooldown enforcement
    const rateLimitedRes = await page.request.post(
      `${resolvedBaseUrl}/api/groups/${groupId}/reminders`,
      { data: { debtor_id: elenaUserId } },
    );
    expect(rateLimitedRes.status()).toBe(429);

    // Export CSV
    const [csvDownload] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: /Export CSV/i }).click(),
    ]);
    const csvText = await readDownloadText(csvDownload);
    expect(csvText).toContain("\r\n");
    expect(csvText).toContain(fxDesc);
    expect(csvText).toContain(`Adjustment: ${fxDesc}`);
    expect(csvText).toContain("$120.00");
    expect(csvText).toContain("-$10.00");

    await dismissAllToasts(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await assertNoHorizontalOverflow(page);

    await page.screenshot({
      path: path.join(resolveScreenshotDir(), `issue-90-${tag}.png`),
      fullPage: true,
    });
  });
});
