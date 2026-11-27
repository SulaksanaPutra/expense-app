import type { SplitBreakdownItem } from "@/types/database";

export interface DebtSimplificationMember {
  userId: string;
  name: string;
  instantSettlementTag: string | null;
}

export interface DebtSimplificationGroupInput {
  id: string;
  name: string;
  baseCurrency: string;
  simplifyDebts: boolean;
  members: readonly DebtSimplificationMember[];
}

export interface DebtSimplificationExpenseInput {
  groupId: string;
  paidBy: string;
  amountCents: number;
  splitBreakdown: readonly SplitBreakdownItem[];
}

export interface DebtSimplificationSettlementInput {
  groupId: string;
  payerId: string;
  recipientId: string;
  amountCents: number;
}

export interface SimplifiedDebtEdge {
  groupId: string;
  groupName: string;
  currency: string;
  payerId: string;
  payerName: string;
  recipientId: string;
  recipientName: string;
  recipientInstantTag: string | null;
  amountCents: number;
}

/**
 * Computes exact integer minor-unit net balances for every member within a single `groupId`.
 * Positive balance = creditor (is owed money). Negative balance = debtor (owes money).
 * Strictly ignores expenses and settlements belonging to any other group_id.
 */
export function computeGroupMemberNetBalances(params: {
  groupId: string;
  memberIds?: readonly string[];
  expenses: readonly DebtSimplificationExpenseInput[];
  settlements: readonly DebtSimplificationSettlementInput[];
}): Map<string, number> {
  const { groupId, memberIds = [], expenses, settlements } = params;
  const netByUser = new Map<string, number>();

  for (const userId of memberIds) {
    netByUser.set(userId, 0);
  }

  for (const exp of expenses) {
    if (exp.groupId !== groupId) continue;
    const paid = Math.trunc(exp.amountCents);
    if (paid !== 0) {
      netByUser.set(exp.paidBy, (netByUser.get(exp.paidBy) ?? 0) + paid);
    }
    for (const part of exp.splitBreakdown) {
      if (!part || typeof part.user_id !== "string") continue;
      const share = Math.trunc(part.share_cents);
      if (share !== 0) {
        netByUser.set(part.user_id, (netByUser.get(part.user_id) ?? 0) - share);
      } else if (!netByUser.has(part.user_id)) {
        netByUser.set(part.user_id, 0);
      }
    }
  }

  for (const s of settlements) {
    if (s.groupId !== groupId) continue;
    const amt = Math.trunc(s.amountCents);
    if (amt === 0) continue;
    netByUser.set(s.payerId, (netByUser.get(s.payerId) ?? 0) + amt);
    netByUser.set(s.recipientId, (netByUser.get(s.recipientId) ?? 0) - amt);
  }

  return netByUser;
}

/**
 * Computes the net balance per user implied by a list of directed debt edges.
 * For each edge (payerId -> recipientId, amountCents):
 *   recipient receives +amountCents, payer sends -amountCents.
 */
export function computeMemberNetBalancesFromEdges(
  edges: readonly Pick<SimplifiedDebtEdge, "payerId" | "recipientId" | "amountCents">[],
  seedMemberIds: readonly string[] = [],
): Map<string, number> {
  const netByUser = new Map<string, number>();
  for (const userId of seedMemberIds) {
    netByUser.set(userId, 0);
  }

  for (const edge of edges) {
    const amt = Math.trunc(edge.amountCents);
    if (amt === 0) continue;
    netByUser.set(edge.payerId, (netByUser.get(edge.payerId) ?? 0) - amt);
    netByUser.set(edge.recipientId, (netByUser.get(edge.recipientId) ?? 0) + amt);
  }

  return netByUser;
}

/**
 * Bipartite graph debt simplification within a single group.
 * Partitions members into debtors (net < 0) and creditors (net > 0), matches
 * exact-magnitude pairs first to minimize transfer count, then greedily matches
 * remaining largest debtor and creditor until all balances clear.
 *
 * Invariants:
 * - Strictly isolated to a single group_id.
 * - Integer minor units only (zero floating-point arithmetic).
 * - Every member's net balance before and after simplification is identical to the cent.
 * - Output graph is strictly bipartite (no cycles, no user both pays and receives).
 */
export function simplifyBipartiteGroupDebts(params: {
  group: DebtSimplificationGroupInput;
  netByUser: ReadonlyMap<string, number>;
}): SimplifiedDebtEdge[] {
  const { group, netByUser } = params;
  const memberById = new Map(group.members.map((m) => [m.userId, m]));

  const debtors: Array<{ userId: string; amount: number }> = [];
  const creditors: Array<{ userId: string; amount: number }> = [];

  for (const [userId, rawBal] of netByUser.entries()) {
    const bal = Math.trunc(rawBal);
    if (bal < 0) {
      debtors.push({ userId, amount: -bal });
    } else if (bal > 0) {
      creditors.push({ userId, amount: bal });
    }
  }

  debtors.sort((a, b) => b.amount - a.amount || a.userId.localeCompare(b.userId));
  creditors.sort((a, b) => b.amount - a.amount || a.userId.localeCompare(b.userId));

  const edges: SimplifiedDebtEdge[] = [];

  const pushEdge = (payerId: string, recipientId: string, amountCents: number) => {
    if (amountCents <= 0 || payerId === recipientId) return;
    const payerInfo = memberById.get(payerId);
    const recipientInfo = memberById.get(recipientId);
    edges.push({
      groupId: group.id,
      groupName: group.name,
      currency: group.baseCurrency,
      payerId,
      payerName: payerInfo?.name ?? "Member",
      recipientId,
      recipientName: recipientInfo?.name ?? "Member",
      recipientInstantTag: recipientInfo?.instantSettlementTag ?? null,
      amountCents,
    });
  };

  // Phase 1: Exact-amount bipartite pairing reduces component edge count where exact matches exist.
  for (const debtor of debtors) {
    if (debtor.amount <= 0) continue;
    const exactCreditor = creditors.find(
      (c) => c.amount === debtor.amount && c.userId !== debtor.userId,
    );
    if (exactCreditor) {
      const transfer = debtor.amount;
      debtor.amount = 0;
      exactCreditor.amount = 0;
      pushEdge(debtor.userId, exactCreditor.userId, transfer);
    }
  }

  // Phase 2: Two-pointer greedy matching across remaining debtors & creditors.
  const remainingDebtors = debtors.filter((d) => d.amount > 0);
  const remainingCreditors = creditors.filter((c) => c.amount > 0);

  let dIdx = 0;
  let cIdx = 0;

  while (dIdx < remainingDebtors.length && cIdx < remainingCreditors.length) {
    const debtor = remainingDebtors[dIdx];
    const creditor = remainingCreditors[cIdx];
    const transfer = Math.min(debtor.amount, creditor.amount);

    if (transfer > 0) {
      pushEdge(debtor.userId, creditor.userId, transfer);
    }

    debtor.amount -= transfer;
    creditor.amount -= transfer;
    if (debtor.amount === 0) dIdx += 1;
    if (creditor.amount === 0) cIdx += 1;
  }

  return edges.sort(
    (x, y) =>
      y.amountCents - x.amountCents ||
      x.payerId.localeCompare(y.payerId) ||
      x.recipientId.localeCompare(y.recipientId),
  );
}

/**
 * Computes direct pairwise debt edges strictly within a single group (simplify_debts = false).
 * Nets opposing direct obligations between the exact same pair of members inside group.id,
 * without consolidating multi-person chains across third parties.
 */
export function computePairwiseGroupDebtEdges(params: {
  group: DebtSimplificationGroupInput;
  expenses: readonly DebtSimplificationExpenseInput[];
  settlements: readonly DebtSimplificationSettlementInput[];
}): SimplifiedDebtEdge[] {
  const { group, expenses, settlements } = params;
  const memberById = new Map(group.members.map((m) => [m.userId, m]));

  const pairMap = new Map<string, number>();
  const addDirected = (fromId: string, toId: string, amount: number) => {
    const intAmount = Math.trunc(amount);
    if (fromId === toId || intAmount === 0) return;
    const [a, b] = fromId < toId ? [fromId, toId] : [toId, fromId];
    const key = `${a}::${b}`;
    const signed = fromId < toId ? intAmount : -intAmount;
    pairMap.set(key, (pairMap.get(key) ?? 0) + signed);
  };

  for (const exp of expenses) {
    if (exp.groupId !== group.id) continue;
    for (const part of exp.splitBreakdown) {
      if (!part || typeof part.user_id !== "string") continue;
      if (part.user_id !== exp.paidBy) {
        addDirected(part.user_id, exp.paidBy, Math.trunc(part.share_cents));
      }
    }
  }

  for (const s of settlements) {
    if (s.groupId !== group.id) continue;
    addDirected(s.payerId, s.recipientId, -Math.trunc(s.amountCents));
  }

  const edges: SimplifiedDebtEdge[] = [];
  for (const [key, net] of pairMap.entries()) {
    if (net === 0) continue;
    const [a, b] = key.split("::");
    const payerId = net > 0 ? a : b;
    const recipientId = net > 0 ? b : a;
    const amountCents = Math.abs(net);
    const payerInfo = memberById.get(payerId);
    const recipientInfo = memberById.get(recipientId);
    edges.push({
      groupId: group.id,
      groupName: group.name,
      currency: group.baseCurrency,
      payerId,
      payerName: payerInfo?.name ?? "Member",
      recipientId,
      recipientName: recipientInfo?.name ?? "Member",
      recipientInstantTag: recipientInfo?.instantSettlementTag ?? null,
      amountCents,
    });
  }

  return edges.sort(
    (x, y) =>
      y.amountCents - x.amountCents ||
      x.payerId.localeCompare(y.payerId) ||
      x.recipientId.localeCompare(y.recipientId),
  );
}

/**
 * Computes settlement edges for a single group according to `group.simplifyDebts`.
 * Strictly isolated to `group.id`.
 */
export function computePerGroupDebtEdges(params: {
  group: DebtSimplificationGroupInput;
  expenses: readonly DebtSimplificationExpenseInput[];
  settlements: readonly DebtSimplificationSettlementInput[];
}): SimplifiedDebtEdge[] {
  const { group, expenses, settlements } = params;

  if (group.simplifyDebts) {
    const netByUser = computeGroupMemberNetBalances({
      groupId: group.id,
      memberIds: group.members.map((m) => m.userId),
      expenses,
      settlements,
    });
    return simplifyBipartiteGroupDebts({ group, netByUser });
  }

  return computePairwiseGroupDebtEdges({ group, expenses, settlements });
}

/**
 * Computes debt edges across multiple groups by running `computePerGroupDebtEdges`
 * independently per `group.id`. Never nets debts across distinct groups.
 */
export function computeMultiGroupDebtEdges(params: {
  groups: readonly DebtSimplificationGroupInput[];
  expenses: readonly DebtSimplificationExpenseInput[];
  settlements: readonly DebtSimplificationSettlementInput[];
}): SimplifiedDebtEdge[] {
  return params.groups.flatMap((group) =>
    computePerGroupDebtEdges({
      group,
      expenses: params.expenses,
      settlements: params.settlements,
    }),
  );
}
