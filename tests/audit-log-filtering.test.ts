import { describe, expect, it } from "vitest";
import {
  buildAuditLogExportPayload,
  filterAuditLogEntries,
  type GroupAuditLogEntry,
} from "@/lib/groups/audit-log";
import { simplifyBipartiteGroupDebts } from "@/lib/expenses/debt-simplification";

const SAMPLE_ENTRIES: GroupAuditLogEntry[] = [
  {
    id: "exp-1",
    groupId: "grp-1",
    category: "LEDGER",
    eventType: "EXPENSE_ADDED",
    actorId: "u1",
    actorName: "Jordan Doe",
    summary: 'Jordan Doe added expense "Whole Foods Market"',
    details: ["$368.40 · 3-Way Equal"],
    createdAt: "2026-11-26T14:14:00.000Z",
  },
  {
    id: "settle-1",
    groupId: "grp-1",
    category: "LEDGER",
    eventType: "SETTLEMENT_RECORDED",
    actorId: "u2",
    actorName: "Marcus Kim",
    summary: "Marcus Kim settled $120.00 with Jordan Doe",
    details: ["Payment rail: VENMO"],
    createdAt: "2026-11-24T11:05:00.000Z",
  },
  {
    id: "rule-1",
    groupId: "grp-1",
    category: "RATIOS",
    eventType: "RATIOS_UPDATED",
    actorId: "u1",
    actorName: "Jordan Doe",
    summary: "Updated default split rule to 3-Way Equal",
    details: ["Jordan Doe: 50% -> 33.3%"],
    createdAt: "2026-11-12T09:22:00.000Z",
  },
  {
    id: "gov-1",
    groupId: "grp-1",
    category: "GOVERNANCE",
    eventType: "MEMBER_JOINED",
    actorId: "u3",
    actorName: "Alex Lee",
    summary: "Jordan Doe invited Alex Lee via invite link",
    details: ["Passkey verified"],
    createdAt: "2026-11-01T08:00:00.000Z",
  },
];

describe("Issue #109 — Audit Log filtering, export & always-on simplification", () => {
  it("filters audit log entries by category tab (ALL, EXPENSES, RULES, SETTLEMENTS)", () => {
    expect(filterAuditLogEntries(SAMPLE_ENTRIES, "ALL")).toHaveLength(4);
    expect(
      filterAuditLogEntries(SAMPLE_ENTRIES, "EXPENSES").map((e) => e.id),
    ).toEqual(["exp-1"]);
    expect(
      filterAuditLogEntries(SAMPLE_ENTRIES, "RULES").map((e) => e.id),
    ).toEqual(["rule-1", "gov-1"]);
    expect(
      filterAuditLogEntries(SAMPLE_ENTRIES, "SETTLEMENTS").map((e) => e.id),
    ).toEqual(["settle-1"]);
  });

  it("filters audit log entries by search query across summary, actor, and details", () => {
    expect(
      filterAuditLogEntries(SAMPLE_ENTRIES, "ALL", "whole foods").map(
        (e) => e.id,
      ),
    ).toEqual(["exp-1"]);
    expect(
      filterAuditLogEntries(SAMPLE_ENTRIES, "ALL", "venmo").map((e) => e.id),
    ).toEqual(["settle-1"]);
    expect(
      filterAuditLogEntries(SAMPLE_ENTRIES, "RULES", "passkey").map(
        (e) => e.id,
      ),
    ).toEqual(["gov-1"]);
    expect(
      filterAuditLogEntries(SAMPLE_ENTRIES, "EXPENSES", "venmo"),
    ).toHaveLength(0);
  });

  it("builds valid JSON export payload for filtered audit log entries", () => {
    const filtered = filterAuditLogEntries(SAMPLE_ENTRIES, "EXPENSES");
    const json = buildAuditLogExportPayload("Apartment 4B Shared", filtered);
    const parsed = JSON.parse(json) as {
      groupName: string;
      totalEvents: number;
      events: GroupAuditLogEntry[];
    };
    expect(parsed.groupName).toBe("Apartment 4B Shared");
    expect(parsed.totalEvents).toBe(1);
    expect(parsed.events[0].id).toBe("exp-1");
  });

  it("simplifies multi-member balances with always-on bipartite minimization", () => {
    const netByUser = new Map<string, number>([
      ["jordan", 58000],
      ["marcus", -29000],
      ["alex", -29000],
    ]);

    const edges = simplifyBipartiteGroupDebts({
      group: {
        id: "grp-1",
        name: "Apartment 4B Shared",
        baseCurrency: "USD",
        simplifyDebts: true,
        members: [
          { userId: "jordan", name: "Jordan Doe", instantSettlementTag: null },
          { userId: "marcus", name: "Marcus Kim", instantSettlementTag: null },
          { userId: "alex", name: "Alex Lee", instantSettlementTag: null },
        ],
      },
      netByUser,
    });

    expect(edges).toHaveLength(2);
    expect(edges.map((e) => e.amountCents)).toEqual([29000, 29000]);
    expect(edges.every((e) => e.recipientId === "jordan")).toBe(true);
  });
});
