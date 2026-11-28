import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  computeGroupLedgerMetrics,
  getSplitGroupsPageData,
  validateCreateGroupPayload,
} from "@/lib/groups/service";
import {
  formatMinorUnits,
  parseCurrencyInputToMinorUnits,
} from "@/lib/money";

const getUserMock = vi.fn();
const fromMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: getUserMock,
    },
    from: fromMock,
  })),
}));

import { POST as createGroupPost } from "@/app/api/groups/route";

describe("Money Utilities (Minor Units)", () => {
  it("parses currency inputs without floating-point drift", () => {
    expect(parseCurrencyInputToMinorUnits("19.99", "USD")).toBe(1999);
    expect(parseCurrencyInputToMinorUnits("4,500.50", "USD")).toBe(450050);
    expect(parseCurrencyInputToMinorUnits("100", "USD")).toBe(10000);
    expect(parseCurrencyInputToMinorUnits("12500", "JPY")).toBe(12500);
    expect(parseCurrencyInputToMinorUnits("12.345", "USD")).toBeNull();
    expect(parseCurrencyInputToMinorUnits("-50", "USD")).toBeNull();
    expect(parseCurrencyInputToMinorUnits("10.5", "JPY")).toBeNull();
    expect(parseCurrencyInputToMinorUnits("", "USD")).toBeNull();
  });

  it("formats minor units cleanly in the group base currency", () => {
    expect(formatMinorUnits(46250, "USD", { showPlus: true })).toBe("+$462.50");
    expect(formatMinorUnits(-8500, "USD")).toBe("-$85.00");
    expect(formatMinorUnits(0, "USD")).toBe("$0.00");
    expect(formatMinorUnits(125050, "EUR")).toBe("€1,250.50");
    expect(formatMinorUnits(12500, "JPY")).toBe("¥12,500");
  });
});

describe("Group Ledger Metrics", () => {
  it("computes cycle turnover in window and cumulative net ledger across settlements", () => {
    const metrics = computeGroupLedgerMetrics({
      expenses: [
        {
          group_id: "g1",
          paid_by: "u1",
          amount_cents: 10000,
          expense_date: "2026-11-18T12:00:00.000Z",
          split_breakdown: [
            { user_id: "u1", share_cents: 5000 },
            { user_id: "u2", share_cents: 5000 },
          ],
          deleted_at: null,
        },
        {
          group_id: "g1",
          paid_by: "u2",
          amount_cents: 4000,
          expense_date: "2026-10-02T12:00:00.000Z",
          split_breakdown: [
            { user_id: "u1", share_cents: 2000 },
            { user_id: "u2", share_cents: 2000 },
          ],
          deleted_at: null,
        },
        {
          group_id: "g1",
          paid_by: "u1",
          amount_cents: 9999,
          expense_date: "2026-11-20T12:00:00.000Z",
          split_breakdown: [{ user_id: "u1", share_cents: 9999 }],
          deleted_at: "2026-11-21T00:00:00.000Z",
        },
      ],
      settlements: [
        {
          group_id: "g1",
          payer_id: "u2",
          recipient_id: "u1",
          amount_cents: 1500,
        },
      ],
      memberIds: ["u1", "u2"],
      currentUserId: "u1",
      cycleSlug: "2026-11",
      anchorDay: 15,
    });

    // Cycle 2026-11 with anchor day 15 covers Nov 15 -> Dec 15: only the 10000 expense is inside.
    expect(metrics.cycleTurnoverCents).toBe(10000);
    expect(metrics.cycleTransactionCount).toBe(1);
    // Cumulative net for u1: +10000 - 5000 - 2000 - 1500 (received settlement) = +1500
    expect(metrics.userNetLedgerCents).toBe(1500);
    expect(metrics.netBalanceByUser.get("u2")).toBe(-1500);
    expect(metrics.isFullySettled).toBe(false);
  });
});

describe("POST /api/groups Integration", () => {
  const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key-123";
    getUserMock.mockReset();
    fromMock.mockReset();
  });

  afterEach(() => {
    if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
    if (originalAnonKey === undefined)
      delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = originalAnonKey;
  });

  it("returns 401 when request is unauthenticated", async () => {
    getUserMock.mockResolvedValueOnce({ data: { user: null }, error: null });

    const req = new NextRequest("http://localhost:3000/api/groups", {
      method: "POST",
      body: JSON.stringify({
        name: "Apt 4B Roommates",
        group_type: "RESIDENTIAL",
        base_currency: "USD",
        operational_budget_cents: 450000,
        billing_cycle_anchor_day: 1,
        lease_end_date: null,
      }),
    });

    const res = await createGroupPost(req);
    expect(res.status).toBe(401);
  });

  it("validates payload fields and rejects invalid anchor days or negative budgets", () => {
    const invalid = validateCreateGroupPayload({
      name: "",
      group_type: "INVALID",
      base_currency: "US",
      operational_budget_cents: -100,
      billing_cycle_anchor_day: 31,
      lease_end_date: "2026-02-30",
    });

    expect(invalid.ok).toBe(false);
    if (!invalid.ok) {
      expect(invalid.errors.name).toBeTruthy();
      expect(invalid.errors.group_type).toBeTruthy();
      expect(invalid.errors.base_currency).toBeTruthy();
      expect(invalid.errors.operational_budget_cents).toBeTruthy();
      expect(invalid.errors.billing_cycle_anchor_day).toBeTruthy();
      expect(invalid.errors.lease_end_date).toBeTruthy();
    }
  });

  it("creates a group and assigns creator as initial ADMIN member", async () => {
    getUserMock.mockResolvedValueOnce({
      data: {
        user: {
          id: "usr-creator-1",
          email: "alex@example.com",
          user_metadata: { full_name: "Alex Rivera" },
        },
      },
      error: null,
    });

    const groupsInsertMock = vi.fn().mockResolvedValue({ error: null });
    const membersInsertMock = vi.fn().mockResolvedValue({ error: null });
    const usersMaybeSingleMock = vi.fn().mockResolvedValue({
      data: {
        id: "usr-creator-1",
        full_name: "Alex Rivera",
        email: "alex@example.com",
      },
      error: null,
    });

    fromMock.mockImplementation((table: string) => {
      if (table === "groups") {
        return { insert: groupsInsertMock };
      }
      if (table === "group_members") {
        return { insert: membersInsertMock };
      }
      if (table === "users") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: usersMaybeSingleMock,
            }),
          }),
        };
      }
      return {};
    });

    const req = new NextRequest("http://localhost:3000/api/groups", {
      method: "POST",
      body: JSON.stringify({
        name: "Apt 4B Roommates",
        group_type: "RESIDENTIAL",
        base_currency: "USD",
        operational_budget_cents: 450000,
        billing_cycle_anchor_day: 15,
        }),
    });

    const res = await createGroupPost(req);
    expect(res.status).toBe(201);

    const payload = await res.json();

    expect(groupsInsertMock).toHaveBeenCalledTimes(1);
    const insertedGroup = groupsInsertMock.mock.calls[0][0];
    expect(insertedGroup).toMatchObject({
      name: "Apt 4B Roommates",
      group_type: "RESIDENTIAL",
      status: "ACTIVE",
      base_currency: "USD",
      operational_budget_cents: 450000,
      billing_cycle_anchor_day: 15,
      created_by: "usr-creator-1",
    });

    expect(membersInsertMock).toHaveBeenCalledTimes(1);
    expect(membersInsertMock).toHaveBeenCalledWith({
      group_id: insertedGroup.id,
      user_id: "usr-creator-1",
      role: "ADMIN",
      status: "ACTIVE",
      share_percentage: 100,
    });

    expect(payload.group.id).toBe(insertedGroup.id);
    expect(payload.group.currentUserRole).toBe("ADMIN");
    expect(payload.group.members).toHaveLength(1);
    expect(payload.group.members[0]).toMatchObject({
      userId: "usr-creator-1",
      role: "ADMIN",
      status: "ACTIVE",
      sharePercentage: 100,
    });
    expect(payload.shellGroup).toMatchObject({
      id: insertedGroup.id,
      name: "Apt 4B Roommates",
      groupType: "RESIDENTIAL",
      baseCurrency: "USD",
    });
  });

  it("supports optional lease_end_date omitted (null) and recovers missing user profile row", async () => {
    getUserMock.mockResolvedValueOnce({
      data: {
        user: {
          id: "usr-creator-2",
          email: "samira@example.com",
          user_metadata: { full_name: "Samira Patel" },
        },
      },
      error: null,
    });

    const groupsInsertMock = vi.fn().mockResolvedValue({ error: null });
    const membersInsertMock = vi
      .fn()
      .mockResolvedValueOnce({
        error: { code: "23503", message: "FK violation on user_id" },
      })
      .mockResolvedValueOnce({ error: null });
    const usersUpsertMock = vi.fn().mockResolvedValue({ error: null });

    fromMock.mockImplementation((table: string) => {
      if (table === "groups") return { insert: groupsInsertMock };
      if (table === "group_members") return { insert: membersInsertMock };
      if (table === "users") {
        return {
          upsert: usersUpsertMock,
          select: () => ({
            eq: () => ({
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
        };
      }
      return {};
    });

    const req = new NextRequest("http://localhost:3000/api/groups", {
      method: "POST",
      body: JSON.stringify({
        name: "Tahoe Ski Cabin",
        group_type: "TRIP",
        base_currency: "EUR",
        operational_budget_cents: null,
        billing_cycle_anchor_day: 1,
        lease_end_date: null,
      }),
    });

    const res = await createGroupPost(req);
    expect(res.status).toBe(201);
    expect(usersUpsertMock).toHaveBeenCalledTimes(1);
    expect(membersInsertMock).toHaveBeenCalledTimes(2);
    const payload = await res.json();
    expect(payload.group.leaseEndDate).toBeNull();
    expect(payload.group.operationalBudgetCents).toBeNull();
    expect(payload.group.groupType).toBe("TRIP");
  });

  it("hydrates SplitGroupsPageData cleanly and separates archived groups", async () => {
    const supabaseMock = {
      from: (table: string) => {
        if (table === "groups") {
          return {
            select: () => ({
              order: vi.fn().mockResolvedValue({
                data: [
                  {
                    id: "g-active",
                    name: "Apt 4B",
                    slug: "apt-4b",
                    group_type: "RESIDENTIAL",
                    status: "ACTIVE",
                    base_currency: "USD",
                    default_split_mode: "EQUAL",
                    simplify_debts: true,
                    operational_budget_cents: 400000,
                    billing_cycle_anchor_day: 1,
                    lease_end_date: null,
                    invite_token: "tok-1",
                    created_at: "2026-10-01T00:00:00Z",
                  },
                  {
                    id: "g-arch",
                    name: "Summer 2025",
                    slug: "summer-2025",
                    group_type: "TRIP",
                    status: "ARCHIVED",
                    base_currency: "USD",
                    default_split_mode: "EQUAL",
                    simplify_debts: true,
                    operational_budget_cents: null,
                    billing_cycle_anchor_day: 1,
                    lease_end_date: null,
                    invite_token: "tok-2",
                    created_at: "2025-06-01T00:00:00Z",
                  },
                ],
                error: null,
              }),
            }),
          };
        }
        if (table === "group_members") {
          return {
            select: () => ({
              in: () => ({
                order: vi.fn().mockResolvedValue({
                  data: [
                    {
                      group_id: "g-active",
                      user_id: "u1",
                      role: "ADMIN",
                      status: "ACTIVE",
                      share_percentage: 50,
                      joined_at: "2026-10-01T00:00:00Z",
                    },
                    {
                      group_id: "g-active",
                      user_id: "u2",
                      role: "MEMBER",
                      status: "ACTIVE",
                      share_percentage: 50,
                      joined_at: "2026-10-01T00:00:00Z",
                    },
                    {
                      group_id: "g-arch",
                      user_id: "u1",
                      role: "ADMIN",
                      status: "ACTIVE",
                      share_percentage: 100,
                      joined_at: "2025-06-01T00:00:00Z",
                    },
                  ],
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === "expenses") {
          return {
            select: () => ({
              in: () => ({
                is: vi.fn().mockResolvedValue({
                  data: [
                    {
                      group_id: "g-active",
                      paid_by: "u1",
                      amount_cents: 8000,
                      expense_date: "2026-11-10T10:00:00Z",
                      split_breakdown: [
                        { user_id: "u1", share_cents: 4000 },
                        { user_id: "u2", share_cents: 4000 },
                      ],
                      deleted_at: null,
                    },
                  ],
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === "settlements") {
          return {
            select: () => ({
              in: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
          };
        }
        if (table === "recurring_rules") {
          return {
            select: () => ({
              in: () => ({
                eq: vi.fn().mockResolvedValue({
                  data: [{ group_id: "g-active", is_active: true }],
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === "users") {
          return {
            select: () => ({
              in: vi.fn().mockResolvedValue({
                data: [
                  { id: "u1", full_name: "Alex Rivera", email: "alex@example.com" },
                  { id: "u2", full_name: "Elena Rostova", email: "elena@example.com" },
                ],
                error: null,
              }),
            }),
          };
        }
        return {};
      },
    };

    const result = await getSplitGroupsPageData(
      supabaseMock as never,
      "u1",
      "2026-11",
    );

    expect(result.loadError).toBeNull();
    expect(result.activeGroups).toHaveLength(1);
    expect(result.archivedGroups).toHaveLength(1);
    expect(result.activeGroups[0].cycleTurnoverCents).toBe(8000);
    expect(result.activeGroups[0].userNetLedgerCents).toBe(4000);
    expect(result.activeGroups[0].recurringRuleCount).toBe(0);
  });
});
