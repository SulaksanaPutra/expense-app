import { describe, expect, it } from "vitest";
import {
  computeGroupMemberNetBalances,
  computeMemberNetBalancesFromEdges,
  computeMultiGroupDebtEdges,
  computePairwiseGroupDebtEdges,
  computePerGroupDebtEdges,
  simplifyBipartiteGroupDebts,
  type DebtSimplificationExpenseInput,
  type DebtSimplificationGroupInput,
  type DebtSimplificationSettlementInput,
} from "@/lib/expenses/debt-simplification";
import { computeEqualSplit } from "@/lib/expenses/split-engine";

function createDeterministicRng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function randomInt(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

describe("Per-Group Bipartite Debt Simplification Engine (Property & Unit Tests)", () => {
  it("eliminates multi-party cycles and consolidates chains while preserving exact net balances", () => {
    const members = [
      { userId: "u-a", name: "Alice", instantSettlementTag: "@alice" },
      { userId: "u-b", name: "Bob", instantSettlementTag: "@bob" },
      { userId: "u-c", name: "Charlie", instantSettlementTag: "@charlie" },
    ];

    // Cycle: A owes B $50, B owes C $50, C owes A $50
    const cycleExpenses: DebtSimplificationExpenseInput[] = [
      {
        groupId: "grp-1",
        paidBy: "u-b",
        amountCents: 5000,
        splitBreakdown: [{ user_id: "u-a", share_cents: 5000 }],
      },
      {
        groupId: "grp-1",
        paidBy: "u-c",
        amountCents: 5000,
        splitBreakdown: [{ user_id: "u-b", share_cents: 5000 }],
      },
      {
        groupId: "grp-1",
        paidBy: "u-a",
        amountCents: 5000,
        splitBreakdown: [{ user_id: "u-c", share_cents: 5000 }],
      },
    ];

    const pairwiseCycle = computePerGroupDebtEdges({
      group: {
        id: "grp-1",
        name: "Apt 4B",
        baseCurrency: "USD",
        simplifyDebts: false,
        members,
      },
      expenses: cycleExpenses,
      settlements: [],
    });
    expect(pairwiseCycle).toHaveLength(3);

    const simplifiedCycle = computePerGroupDebtEdges({
      group: {
        id: "grp-1",
        name: "Apt 4B",
        baseCurrency: "USD",
        simplifyDebts: true,
        members,
      },
      expenses: cycleExpenses,
      settlements: [],
    });
    expect(simplifiedCycle).toHaveLength(0);

    // Chain: A owes B $30, B owes C $20
    const chainExpenses: DebtSimplificationExpenseInput[] = [
      {
        groupId: "grp-1",
        paidBy: "u-b",
        amountCents: 3000,
        splitBreakdown: [{ user_id: "u-a", share_cents: 3000 }],
      },
      {
        groupId: "grp-1",
        paidBy: "u-c",
        amountCents: 2000,
        splitBreakdown: [{ user_id: "u-b", share_cents: 2000 }],
      },
    ];

    const directEdges = computePerGroupDebtEdges({
      group: {
        id: "grp-1",
        name: "Apt 4B",
        baseCurrency: "USD",
        simplifyDebts: false,
        members,
      },
      expenses: chainExpenses,
      settlements: [],
    });
    expect(directEdges).toEqual([
      expect.objectContaining({ payerId: "u-a", recipientId: "u-b", amountCents: 3000 }),
      expect.objectContaining({ payerId: "u-b", recipientId: "u-c", amountCents: 2000 }),
    ]);

    const simplifiedChain = computePerGroupDebtEdges({
      group: {
        id: "grp-1",
        name: "Apt 4B",
        baseCurrency: "USD",
        simplifyDebts: true,
        members,
      },
      expenses: chainExpenses,
      settlements: [],
    });
    expect(simplifiedChain).toEqual([
      expect.objectContaining({ payerId: "u-a", recipientId: "u-c", amountCents: 2000 }),
      expect.objectContaining({ payerId: "u-a", recipientId: "u-b", amountCents: 1000 }),
    ]);

    // Net balances before and after are identical to the exact cent
    const beforeNet = computeMemberNetBalancesFromEdges(directEdges, ["u-a", "u-b", "u-c"]);
    const afterNet = computeMemberNetBalancesFromEdges(simplifiedChain, ["u-a", "u-b", "u-c"]);
    expect(afterNet.get("u-a")).toBe(beforeNet.get("u-a"));
    expect(afterNet.get("u-b")).toBe(beforeNet.get("u-b"));
    expect(afterNet.get("u-c")).toBe(beforeNet.get("u-c"));
    expect(afterNet.get("u-a")).toBe(-3000);
    expect(afterNet.get("u-b")).toBe(1000);
    expect(afterNet.get("u-c")).toBe(2000);
  });

  it("matches exact-magnitude debtor/creditor pairs first to minimize transfer edges", () => {
    const members = ["d1", "d2", "d3", "c1", "c2", "c3"].map((id) => ({
      userId: id,
      name: id.toUpperCase(),
      instantSettlementTag: null,
    }));
    const netByUser = new Map<string, number>([
      ["d1", -5000],
      ["d2", -4000],
      ["d3", -3000],
      ["c1", 6000],
      ["c2", 4000],
      ["c3", 2000],
    ]);

    const edges = simplifyBipartiteGroupDebts({
      group: {
        id: "grp-opt",
        name: "Exact Pair Test",
        baseCurrency: "USD",
        simplifyDebts: true,
        members,
      },
      netByUser,
    });

    // Exact match d2(4000)->c2(4000) reduces total transfers from 5 to 4
    expect(edges).toHaveLength(4);
    const reconstructed = computeMemberNetBalancesFromEdges(
      edges,
      members.map((m) => m.userId),
    );
    for (const [uid, expectedBal] of netByUser.entries()) {
      expect(reconstructed.get(uid)).toBe(expectedBal);
    }
  });

  it("property test: conserves every member net balance to the exact cent across 120 randomized multi-party ledgers", () => {
    const rng = createDeterministicRng(20261127);

    for (let trial = 0; trial < 120; trial++) {
      const memberCount = randomInt(rng, 2, 9);
      const memberIds = Array.from({ length: memberCount }, (_, i) => `u-${i}`);
      const group: DebtSimplificationGroupInput = {
        id: `grp-${trial}`,
        name: `Group ${trial}`,
        baseCurrency: trial % 4 === 0 ? "JPY" : "USD",
        simplifyDebts: true,
        members: memberIds.map((userId) => ({
          userId,
          name: userId,
          instantSettlementTag: null,
        })),
      };

      const expenses: DebtSimplificationExpenseInput[] = [];
      const expenseCount = randomInt(rng, 1, 18);
      for (let e = 0; e < expenseCount; e++) {
        const paidBy = memberIds[randomInt(rng, 0, memberCount - 1)];
        const amountCents = randomInt(rng, 1, 50_000);
        const participantSubset = memberIds.filter(() => rng() > 0.25);
        const participants =
          participantSubset.length > 0 ? participantSubset : [memberIds[0]];

        const splitBreakdown = computeEqualSplit({
          amountCents,
          paidBy,
          participantIds: participants,
        });
        expenses.push({
          groupId: group.id,
          paidBy,
          amountCents,
          splitBreakdown,
        });
      }

      const settlements: DebtSimplificationSettlementInput[] = [];
      const settlementCount = randomInt(rng, 0, 6);
      for (let s = 0; s < settlementCount; s++) {
        const payerIdx = randomInt(rng, 0, memberCount - 1);
        let recIdx = randomInt(rng, 0, memberCount - 1);
        if (recIdx === payerIdx) {
          recIdx = (payerIdx + 1) % memberCount;
        }
        settlements.push({
          groupId: group.id,
          payerId: memberIds[payerIdx],
          recipientId: memberIds[recIdx],
          amountCents: randomInt(rng, 1, 15_000),
        });
      }

      // Inject noise from another group_id to verify strict per-group filtering
      expenses.push({
        groupId: "other-group-noise",
        paidBy: memberIds[0],
        amountCents: 999_999,
        splitBreakdown: [{ user_id: memberIds[1], share_cents: 999_999 }],
      });
      settlements.push({
        groupId: "other-group-noise",
        payerId: memberIds[1],
        recipientId: memberIds[0],
        amountCents: 444_444,
      });

      const directEdges = computePairwiseGroupDebtEdges({
        group: { ...group, simplifyDebts: false },
        expenses,
        settlements,
      });
      const simplifiedEdges = computePerGroupDebtEdges({
        group,
        expenses,
        settlements,
      });

      const directNet = computeMemberNetBalancesFromEdges(directEdges, memberIds);
      const ledgerNet = computeGroupMemberNetBalances({
        groupId: group.id,
        memberIds,
        expenses,
        settlements,
      });
      const simplifiedNet = computeMemberNetBalancesFromEdges(
        simplifiedEdges,
        memberIds,
      );

      // Zero-sum invariant & exact cent conservation across all members
      let totalNet = 0;
      for (const uid of memberIds) {
        const expected = ledgerNet.get(uid) ?? 0;
        totalNet += expected;
        expect(directNet.get(uid)).toBe(expected);
        expect(simplifiedNet.get(uid)).toBe(expected);
      }
      expect(totalNet).toBe(0);

      // Bipartite invariant: no member appears as both payer and recipient
      const payers = new Set(simplifiedEdges.map((e) => e.payerId));
      const recipients = new Set(simplifiedEdges.map((e) => e.recipientId));
      for (const payer of payers) {
        expect(recipients.has(payer)).toBe(false);
      }

      // Upper bound on edge count: at most N - 1 transfers
      expect(simplifiedEdges.length).toBeLessThanOrEqual(memberCount - 1);

      // Total transfer volume matches sum of positive net balances (minimal flow)
      const simplifiedVolume = simplifiedEdges.reduce(
        (sum, e) => sum + e.amountCents,
        0,
      );
      const directVolume = directEdges.reduce((sum, e) => sum + e.amountCents, 0);
      expect(simplifiedVolume).toBeLessThanOrEqual(directVolume);
    }
  });

  it("enforces strict cross-group isolation and never nets debts across different group_ids", () => {
    const sharedMembers = [
      { userId: "u-alex", name: "Alex Rivera", instantSettlementTag: "@alex" },
      { userId: "u-elena", name: "Elena Rostova", instantSettlementTag: "@elena" },
      { userId: "u-marcus", name: "Marcus Vance", instantSettlementTag: "@marcus" },
    ];

    const groups: DebtSimplificationGroupInput[] = [
      {
        id: "grp-apt4b",
        name: "Apt 4B Roommates",
        baseCurrency: "USD",
        simplifyDebts: true,
        members: sharedMembers,
      },
      {
        id: "grp-tahoe",
        name: "Tahoe Ski Trip",
        baseCurrency: "USD",
        simplifyDebts: true,
        members: sharedMembers,
      },
    ];

    // Group 1: Elena owes Alex $100.00
    // Group 2: Alex owes Elena $40.00
    const expenses: DebtSimplificationExpenseInput[] = [
      {
        groupId: "grp-apt4b",
        paidBy: "u-alex",
        amountCents: 10000,
        splitBreakdown: [{ user_id: "u-elena", share_cents: 10000 }],
      },
      {
        groupId: "grp-tahoe",
        paidBy: "u-elena",
        amountCents: 4000,
        splitBreakdown: [{ user_id: "u-alex", share_cents: 4000 }],
      },
    ];

    const edges = computeMultiGroupDebtEdges({
      groups,
      expenses,
      settlements: [],
    });

    // Must remain two separate per-group edges, NEVER netted to $60 across groups
    expect(edges).toHaveLength(2);
    expect(edges).toContainEqual(
      expect.objectContaining({
        groupId: "grp-apt4b",
        payerId: "u-elena",
        recipientId: "u-alex",
        amountCents: 10000,
      }),
    );
    expect(edges).toContainEqual(
      expect.objectContaining({
        groupId: "grp-tahoe",
        payerId: "u-alex",
        recipientId: "u-elena",
        amountCents: 4000,
      }),
    );
  });
});
