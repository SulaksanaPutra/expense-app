import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import {
  authenticateContextAsUser,
  cleanupE2EGroupsForUser,
  createAdminSupabase,
  ensureE2EUser,
} from "./helpers/supabase-auth";

const E2E_ALEX_EMAIL = "e2e-87-alex@ledgersplit.test";
const E2E_ALEX_NAME = "Alex Rivera";
const E2E_ELENA_EMAIL = "e2e-87-elena@ledgersplit.test";
const E2E_ELENA_NAME = "Elena Rostova";
const E2E_MARCUS_EMAIL = "e2e-87-marcus@ledgersplit.test";
const E2E_MARCUS_NAME = "Marcus Vance";

function resolveScreenshotDir(): string {
  const cwd = process.cwd();
  const marker = `${path.sep}.worktrees${path.sep}`;
  const idx = cwd.indexOf(marker);
  const repoRoot = idx >= 0 ? cwd.slice(0, idx) : cwd;
  return path.resolve(repoRoot, ".verification", "screenshots");
}

function getCurrentCycleSlug(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
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

test.describe("Issue #87 — Push & opt-in Twilio SMS reminders with 24h cooldown", () => {
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

    const admin = createAdminSupabase();
    // Elena: Push/in-app only (sms_nudges_opt_in = false)
    await admin
      .from("users")
      .update({
        phone_number: "+14155550102",
        phone_verified: true,
        notification_prefs: {
          new_expense: true,
          settlement_confirmation: true,
          monthly_recap: true,
          sms_nudges_opt_in: false,
        },
      })
      .eq("id", elenaUserId);

    // Marcus: Opted into SMS nudges with verified phone number
    await admin
      .from("users")
      .update({
        phone_number: "+14155550103",
        phone_verified: true,
        notification_prefs: {
          new_expense: true,
          settlement_confirmation: true,
          monthly_recap: true,
          sms_nudges_opt_in: true,
        },
      })
      .eq("id", marcusUserId);

    await cleanupE2EGroupsForUser(alexUserId);
  });

  test.afterAll(async () => {
    const admin = createAdminSupabase();
    if (alexUserId) {
      await cleanupE2EGroupsForUser(alexUserId);
    }
    for (const uid of [alexUserId, elenaUserId, marcusUserId]) {
      if (uid) {
        await admin.from("notifications").delete().eq("user_id", uid);
        await admin.from("reminder_logs").delete().eq("creditor_id", uid);
        await admin.from("reminder_logs").delete().eq("debtor_id", uid);
        await admin.auth.admin.deleteUser(uid).catch(() => {});
      }
    }
  });

  test("enforces 24h cooldown (429), disables Remind & Send N reminders pills with remaining hours, and gates SMS on opt-in + verified phone", async ({
    page,
    context,
    browser,
    baseURL,
  }, testInfo) => {
    const isMobile = testInfo.project.name.includes("mobile");
    const tag = isMobile ? "mobile" : "desktop";
    const resolvedBaseUrl = baseURL || "http://127.0.0.1:3100";
    const screenshotDir = resolveScreenshotDir();
    fs.mkdirSync(screenshotDir, { recursive: true });

    await cleanupE2EGroupsForUser(alexUserId);
    const admin = createAdminSupabase();
    await admin.from("reminder_logs").delete().eq("creditor_id", alexUserId);
    await admin
      .from("notifications")
      .delete()
      .in("user_id", [elenaUserId, marcusUserId]);

    const groupId = crypto.randomUUID();
    const stamp = Date.now();
    const cycle = getCurrentCycleSlug();

    const { error: grpErr } = await admin.from("groups").insert({
      id: groupId,
      name: `[E2E] Issue 87 Apt 4B ${tag}`,
      slug: `e2e-87-apt-${tag}-${stamp}`,
      group_type: "RESIDENTIAL",
      status: "ACTIVE",
      base_currency: "USD",
      default_split_mode: "EQUAL",
      simplify_debts: true,
      operational_budget_cents: 300000,
      billing_cycle_anchor_day: 1,
      invite_token: `tok-87-${tag}-${stamp}`,
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
        share_percentage: 33.34,
      },
      {
        group_id: groupId,
        user_id: elenaUserId,
        role: "MEMBER",
        status: "ACTIVE",
        share_percentage: 33.33,
      },
      {
        group_id: groupId,
        user_id: marcusUserId,
        role: "MEMBER",
        status: "ACTIVE",
        share_percentage: 33.33,
      },
    ]);
    if (memErr) throw memErr;

    const { error: expErr } = await admin.from("expenses").insert({
      group_id: groupId,
      created_by: alexUserId,
      paid_by: alexUserId,
      description: `[E2E] Shared ConEd & Fiber ${tag}`,
      category: "Utilities",
      expense_date: `${cycle}-12T12:00:00.000Z`,
      amount_cents: 9000,
      currency: "USD",
      split_method: "EQUAL",
      is_locked: false,
      split_breakdown: [
        { user_id: alexUserId, share_cents: 3000, percentage: 33.34 },
        { user_id: elenaUserId, share_cents: 3000, percentage: 33.33 },
        { user_id: marcusUserId, share_cents: 3000, percentage: 33.33 },
      ],
    });
    if (expErr) throw expErr;

    await authenticateContextAsUser(context, resolvedBaseUrl, E2E_ALEX_EMAIL);

    await page.goto(`/dashboard?group=${groupId}&cycle=${cycle}`, {
      waitUntil: "networkidle",
    });
    await assertNoHorizontalOverflow(page);

    const batchBtn = page.getByTestId("send-batch-reminders-btn");
    await expect(batchBtn).toBeEnabled();
    await expect(batchBtn).toHaveText("Send 2 reminders");

    const elenaRemindBtn = page.getByTestId(
      `remind-peer-btn-${groupId}-${elenaUserId}`,
    );
    const marcusRemindBtn = page.getByTestId(
      `remind-peer-btn-${groupId}-${marcusUserId}`,
    );
    await expect(elenaRemindBtn).toBeEnabled();
    await expect(elenaRemindBtn).toHaveText("Remind");
    await expect(marcusRemindBtn).toBeEnabled();
    await expect(marcusRemindBtn).toHaveText("Remind");

    // 1. Send single reminder to Elena (Push/in-app fallback because sms_nudges_opt_in == false)
    const [elenaRes] = await Promise.all([
      page.waitForResponse(
        (res) =>
          res.url().includes(`/api/groups/${groupId}/reminders`) &&
          res.request().method() === "POST",
      ),
      elenaRemindBtn.click(),
    ]);
    expect(elenaRes.status()).toBe(201);
    const elenaBody = await elenaRes.json();
    expect(elenaBody.channel).toBe("PUSH");

    await expect(elenaRemindBtn).toBeDisabled();
    await expect(elenaRemindBtn).toHaveText("Reminded today (24h remaining)");
    await expect(batchBtn).toBeEnabled();
    await expect(batchBtn).toHaveText("Send 1 reminder");
    await assertNoHorizontalOverflow(page);

    // Dismiss toast so Peer Balances card is unobstructed in verification screenshot
    const dismissToastBtn = page.getByRole("button", {
      name: "Close notification",
    });
    if (await dismissToastBtn.isVisible().catch(() => false)) {
      await dismissToastBtn.click();
    }

    // Capture desktop/mobile verification screenshot showing active + cooldown Remind states & Send 1 reminder
    await page.screenshot({
      path: path.join(screenshotDir, `issue-87-${tag}.png`),
      fullPage: true,
    });

    // 2. Reload page and verify cooldown persists from ReminderLog
    await page.reload({ waitUntil: "networkidle" });
    await expect(elenaRemindBtn).toBeDisabled();
    await expect(elenaRemindBtn).toHaveText("Reminded today (24h remaining)");
    await expect(batchBtn).toHaveText("Send 1 reminder");

    // 3. Second API reminder within 24h for same (creditor_id, debtor_id, group_id) returns 429
    const rateLimitedRes = await page.request.post(
      `${resolvedBaseUrl}/api/groups/${groupId}/reminders`,
      {
        data: { debtor_id: elenaUserId },
      },
    );
    expect(rateLimitedRes.status()).toBe(429);
    const rateLimitedBody = await rateLimitedRes.json();
    expect(rateLimitedBody.code).toBe("REMINDER_COOLDOWN");
    expect(rateLimitedBody.remaining_hours).toBe(24);

    // 4. Click "Send 1 reminder" -> dispatches SMS to Marcus (sms_nudges_opt_in == true & phone_verified == true)
    const [batchRes] = await Promise.all([
      page.waitForResponse(
        (res) =>
          res.url().includes("/api/reminders") &&
          res.request().method() === "POST",
      ),
      batchBtn.click(),
    ]);
    expect(batchRes.status()).toBe(201);
    const batchBody = await batchRes.json();
    expect(batchBody.sent).toHaveLength(1);
    expect(batchBody.sent[0].channel).toBe("SMS");

    await expect(marcusRemindBtn).toBeDisabled();
    await expect(marcusRemindBtn).toHaveText("Reminded today (24h remaining)");
    await expect(batchBtn).toBeDisabled();
    await expect(batchBtn).toHaveText("Reminded today (24h remaining)");
    await assertNoHorizontalOverflow(page);

    // 5. Verify DB ReminderLog channel gating
    await expect
      .poll(
        async () => {
          const { data, error } = await admin
            .from("reminder_logs")
            .select("creditor_id, debtor_id, group_id, channel")
            .eq("group_id", groupId)
            .eq("creditor_id", alexUserId);
          if (error) throw error;
          return data ?? [];
        },
        { timeout: 10_000 },
      )
      .toHaveLength(2);

    const { data: logs, error: logErr } = await admin
      .from("reminder_logs")
      .select("creditor_id, debtor_id, group_id, channel")
      .eq("group_id", groupId)
      .eq("creditor_id", alexUserId);
    if (logErr) throw logErr;
    expect(logs).toHaveLength(2);
    expect(logs?.find((l) => l.debtor_id === elenaUserId)?.channel).toBe(
      "PUSH",
    );
    expect(logs?.find((l) => l.debtor_id === marcusUserId)?.channel).toBe(
      "SMS",
    );

    // 6. Verify Split Groups Spotlight shows disabled cooldown state for both debtors
    await page.goto(`/split-groups?group=${groupId}&cycle=${cycle}`, {
      waitUntil: "networkidle",
    });
    await assertNoHorizontalOverflow(page);
    await expect(page.getByTestId(`split-group-remind-${elenaUserId}`)).toBeDisabled();
    await expect(page.getByTestId(`split-group-remind-${elenaUserId}`)).toHaveText(
      "Reminded today (24h remaining)",
    );
    await expect(page.getByTestId(`split-group-remind-${marcusUserId}`)).toBeDisabled();

    // 7. Verify debtor (Elena) receives in-app REMINDER_NUDGE notification in TopBar bell
    const elenaCtx = await browser.newContext({
      viewport: isMobile
        ? { width: 375, height: 812 }
        : { width: 1280, height: 800 },
    });
    try {
      await authenticateContextAsUser(
        elenaCtx,
        resolvedBaseUrl,
        E2E_ELENA_EMAIL,
      );
      const elenaPage = await elenaCtx.newPage();
      await elenaPage.goto(`/dashboard?group=${groupId}&cycle=${cycle}`, {
        waitUntil: "networkidle",
      });
      const bellBtn = elenaPage.getByRole("button", {
        name: /Notifications/i,
      });
      await bellBtn.click();
      await expect(
        elenaPage.getByText("Settlement reminder").first(),
      ).toBeVisible();
      await expect(
        elenaPage.getByText(/sent you a settlement reminder for \$30\.00/i),
      ).toBeVisible();
    } finally {
      await elenaCtx.close();
    }
  });
});
