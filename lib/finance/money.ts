import type { BankTx, CardCharge } from "@/lib/data/finance";
import { ACCOUNT_LABEL, accountOf } from "./accounts";

/** Rocket Money uses purchase dates; TIPS retains its separate approval-date window. */
export const moneyCardDate = (card: Pick<CardCharge, "purchaseDate" | "approvalDate">) => card.purchaseDate || card.approvalDate || "";
export const exactMerchantKey = (name: string) => name.trim().toLocaleLowerCase();
export const netCardAmount = (card: Pick<CardCharge, "amount" | "status">) =>
  card.status.includes("취소") && (card.amount == null || card.amount >= 0) ? 0 : card.amount;
export const isMoneyUncategorized = (key: string) => !key || key === "uncategorized";
export const TIPS_REFUND_CATEGORY = "tips_refund";

export function isVerifiedTipsRefund(row: BankTx): boolean {
  const source = row.tipsRefundSource;
  return Boolean(source && row.tipsRefundSourceId === source.id && accountOf(row.sourceFile) === "general" &&
    accountOf(source.sourceFile) === "tips" && (row.deposit ?? 0) > 0 && !row.withdrawal &&
    source.withdrawal === row.deposit && !source.deposit);
}

export interface MoneyEntry {
  id: string;
  kind: "card" | "bank";
  date: string;
  name: string;
  amount: number | null;
  category: string;
  refund: boolean;
}
interface Split { cardChargeId: string; bankTxId?: string; amount: number; spendCategory: string }

/** Monetary view only: the source ledger, TIPS flags and actual bank balances stay intact. */
export function moneyEntries(cards: CardCharge[], bank: BankTx[], excludeTips: boolean): MoneyEntry[] {
  const entries: MoneyEntry[] = cards.map((c) => ({
    id: c.id, kind: "card", date: moneyCardDate(c), name: c.merchant || c.itemName || "카드 결제",
    amount: netCardAmount(c), category: isMoneyUncategorized(c.spendCategory) ? "" : c.spendCategory, refund: false,
  }));
  if (!excludeTips) return entries;
  for (const b of bank) {
    if (isVerifiedTipsRefund(b)) {
      entries.push({ id: b.id, kind: "bank", date: b.txDate, name: b.counterparty || "TIPS 환급", amount: -b.deposit!, category: TIPS_REFUND_CATEGORY, refund: true });
    } else if (accountOf(b.sourceFile) === "general" && (b.withdrawal ?? 0) > 0 && !b.deposit && !["internal", "card_payment"].includes(b.spendCategory)) {
      entries.push({ id: b.id, kind: "bank", date: b.txDate, name: b.counterparty || b.description || "통장 출금", amount: b.withdrawal, category: isMoneyUncategorized(b.spendCategory) ? "" : b.spendCategory, refund: false });
    }
  }
  return entries;
}

export function moneyTotals(cards: CardCharge[], bank: BankTx[], excludeTips: boolean, splits: Split[] = []) {
  const byCategory: Record<string, number> = {};
  let unknownAmountCount = 0, invalidSplitCount = 0;
  const refundTotal = bank.filter(isVerifiedTipsRefund).reduce((sum, row) => sum + row.deposit!, 0);
  const add = (category: string, amount: number) => { byCategory[category] = (byCategory[category] ?? 0) + amount; };
  for (const row of moneyEntries(cards, bank, excludeTips)) {
    if (row.amount == null) { unknownAmountCount++; continue; }
    const parts = row.refund ? [] : splits.filter((s) => (row.kind === "card" ? s.cardChargeId : s.bankTxId) === row.id);
    if (parts.length && parts.every((s) => Number.isFinite(s.amount)) && Math.abs(parts.reduce((sum, s) => sum + s.amount, 0) - row.amount) < 0.01) {
      parts.forEach((s) => add(s.spendCategory, s.amount));
    } else {
      if (parts.length) invalidSplitCount++;
      if (row.amount) add(row.category, row.amount);
    }
  }
  return {
    byCategory, spending: Object.values(byCategory).reduce((sum, value) => sum + value, 0),
    uncategorized: byCategory[""] ?? 0, refundTotal, unknownAmountCount, invalidSplitCount,
    income: bank.reduce((sum, b) => sum + (b.deposit ?? 0), 0),
    outgoing: bank.reduce((sum, b) => sum + (b.withdrawal ?? 0), 0),
    cardPaymentTotal: bank.filter((b) => b.spendCategory === "card_payment").reduce((sum, b) => sum + (b.withdrawal ?? 0), 0),
    internalTotal: bank.filter((b) => b.spendCategory === "internal").reduce((sum, b) => sum + (b.withdrawal ?? 0), 0),
  };
}

export function cumulativeMoney(entries: MoneyEntry[], month: string): number[] {
  const [year, mon] = month.split("-").map(Number);
  const days = new Array<number>(new Date(year, mon, 0).getDate()).fill(0);
  for (const row of entries) if (row.date.startsWith(month)) {
    const day = Number(row.date.slice(8, 10));
    if (day > 0 && day <= days.length) days[day - 1] += row.amount ?? 0;
  }
  let sum = 0;
  return days.map((amount) => (sum += amount));
}

export function recurringMerchants(cards: CardCharge[]) {
  const groups = new Map<string, CardCharge[]>();
  for (const card of cards) {
    const key = exactMerchantKey(card.merchant || card.itemName);
    if (!key || !moneyCardDate(card)) continue;
    groups.set(key, [...(groups.get(key) ?? []), card]);
  }
  return [...groups.entries()].flatMap(([key, rows]) => {
    const purchases = rows.filter((c) => (netCardAmount(c) ?? 0) > 0);
    const months = new Set(purchases.map((c) => moneyCardDate(c).slice(0, 7))).size;
    if (months < 3) return [];
    const latest = [...purchases].sort((a, b) => moneyCardDate(b).localeCompare(moneyCardDate(a)))[0];
    return [{ key, merchant: latest.merchant || latest.itemName, months, times: rows.length,
      total: rows.reduce((sum, c) => sum + (netCardAmount(c) ?? 0), 0), last: moneyCardDate(latest) }];
  }).sort((a, b) => b.total - a.total);
}

export function accountBalances(bank: BankTx[], month: string) {
  return (["general", "tips"] as const).flatMap((key) => {
    const rows = bank.filter((b) => b.txDate.slice(0, 7) <= month && accountOf(b.sourceFile) === key)
      .sort((a, b) => `${a.txDate} ${a.txTime}`.localeCompare(`${b.txDate} ${b.txTime}`) || a.id.localeCompare(b.id));
    const latest = rows.findLastIndex((b) => b.balance != null);
    if (latest < 0) return [];
    const balance = rows.slice(latest + 1).reduce((sum, b) => sum + (b.deposit ?? 0) - (b.withdrawal ?? 0), rows[latest].balance!);
    return [{ key, label: ACCOUNT_LABEL[key], balance, at: rows.at(-1)!.txDate }];
  });
}
