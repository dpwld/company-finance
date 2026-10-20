import type { BankTx, CardCharge } from "@/lib/data/finance";
import { accountOf } from "./accounts";

/** Card spending uses purchase dates, falling back to approval dates. */
export const moneyCardDate = (card: Pick<CardCharge, "purchaseDate" | "approvalDate">) => card.purchaseDate || card.approvalDate || "";
export const exactMerchantKey = (name: string) => name.trim().toLocaleLowerCase();
export const netCardAmount = (card: Pick<CardCharge, "amount" | "status">) =>
  card.status.includes("취소") && (card.amount == null || card.amount >= 0) ? 0 : card.amount;
export const isMoneyUncategorized = (key: string) => !key || key === "uncategorized";
export interface MoneyEntry {
  id: string;
  kind: "card" | "bank";
  date: string;
  name: string;
  amount: number | null;
  category: string;
}
interface Split { cardChargeId: string; bankTxId?: string; amount: number; spendCategory: string }

/** Card spending and bank cash flow remain separate to avoid counting card settlements twice. */
export function moneyEntries(cards: CardCharge[], _bank: BankTx[] = []): MoneyEntry[] {
  return cards.map(c => ({ id: c.id, kind: "card", date: moneyCardDate(c), name: c.merchant || c.itemName || "Card payment", amount: netCardAmount(c), category: isMoneyUncategorized(c.spendCategory) ? "" : c.spendCategory }));
}
export function moneyTotals(cards: CardCharge[], bank: BankTx[], splits: Split[] = []) {
  const byCategory: Record<string, number> = {};
  let unknownAmountCount = 0, invalidSplitCount = 0;
  const add = (category: string, amount: number) => { byCategory[category] = (byCategory[category] ?? 0) + amount; };
  for (const row of moneyEntries(cards, bank)) {
    if (row.amount == null) { unknownAmountCount++; continue; }
    const parts = splits.filter((s) => (row.kind === "card" ? s.cardChargeId : s.bankTxId) === row.id);
    if (parts.length && parts.every((s) => Number.isFinite(s.amount)) && Math.abs(parts.reduce((sum, s) => sum + s.amount, 0) - row.amount) < 0.01) {
      parts.forEach((s) => add(s.spendCategory, s.amount));
    } else {
      if (parts.length) invalidSplitCount++;
      if (row.amount) add(row.category, row.amount);
    }
  }
  return {
    byCategory, spending: Object.values(byCategory).reduce((sum, value) => sum + value, 0),
    uncategorized: byCategory[""] ?? 0, unknownAmountCount, invalidSplitCount,
    income: bank.reduce((sum, b) => sum + (b.deposit ?? 0), 0),
    outgoing: bank.reduce((sum, b) => sum + (b.withdrawal ?? 0), 0),
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
  return [...new Set(bank.map(b => accountOf(b.sourceFile)))].flatMap((key) => {
    const rows = bank.filter((b) => b.txDate.slice(0, 7) <= month && accountOf(b.sourceFile) === key)
      .sort((a, b) => `${a.txDate} ${a.txTime}`.localeCompare(`${b.txDate} ${b.txTime}`) || a.id.localeCompare(b.id));
    const latest = rows.findLastIndex((b) => b.balance != null);
    if (latest < 0) return [];
    const balance = rows.slice(latest + 1).reduce((sum, b) => sum + (b.deposit ?? 0) - (b.withdrawal ?? 0), rows[latest].balance!);
    return [{ key, label: key, balance, at: rows.at(-1)!.txDate }];
  });
}
