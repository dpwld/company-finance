import type { BankTx, CardCharge } from "@/lib/data/finance";
import { accountOf, type AccountKey } from "./accounts";
import { accountBalances, isMoneyUncategorized, moneyCardDate, moneyEntries, netCardAmount } from "./money";
import { spendCategoryLabel } from "./spend";

export interface MoneyTransactionTarget { kind: "card" | "bank"; id: string }
export interface MoneyTransactionRow extends MoneyTransactionTarget {
  key: string; date: string; name: string; memo: string; note: string; account: string; category: string;
  amount: number | null; type: string; debit: string; credit: string;
  balance?: number | null; approvalDate?: string | null; sourceFile?: string;
}
export interface MoneyTransactionFilters {
  range?: "month" | "all"; query?: string; account?: string; category?: string; type?: string;
}

export function moneyTransactionRows(cards: CardCharge[], bank: BankTx[]): MoneyTransactionRow[] {
  return [
    ...cards.map((c) => ({
      key: `c${c.id}`, kind: "card" as const, id: c.id,
      date: moneyCardDate(c), name: c.merchant || c.itemName || "카드 결제",
      memo: c.industry || "", note: c.remarks, account: (c.cardMeta?.["승인구분"] ?? "").includes("해외") || c.cardMeta?.["해외승인금액"] ? "해외 카드" : "국내 카드", category: c.spendCategory,
      amount: netCardAmount(c) == null ? null : -netCardAmount(c)!, type: (netCardAmount(c) ?? 0) < 0 ? "카드 취소" : "카드 사용",
      debit: c.debitAccount, credit: c.creditAccount, approvalDate: c.approvalDate,
    })),
    ...bank.map((b) => ({
      key: `b${b.id}`, kind: "bank" as const, id: b.id,
      date: b.txDate, name: b.counterparty || b.description || "계좌 거래",
      memo: b.description || "", note: b.memo, account: accountOf(b.sourceFile),
      category: b.spendCategory,
      amount: (b.deposit ?? 0) - (b.withdrawal ?? 0),
      type: b.withdrawal ? "통장 출금" : "통장 입금",
      debit: b.debitAccount, credit: b.creditAccount, balance: b.balance, sourceFile: b.sourceFile,
    })),
  ];
}

export function filterMoneyTransactions(rows: MoneyTransactionRow[], filters: MoneyTransactionFilters, sort: "recent" | "amount" | "oldest" = "recent") {
  const needle = filters.query?.trim().toLocaleLowerCase("ko-KR");
  return rows.filter((r) =>
    (!filters.account || filters.account === "전체 계좌·카드" || r.account === filters.account) &&
    (!filters.category || (filters.category === "uncategorized" ? isMoneyUncategorized(r.category) : r.category === filters.category)) &&
    (!filters.type || filters.type === "전체 유형" || (filters.type === "출금·사용" ? (r.amount ?? 0) < 0 : filters.type === "입금·취소" ? (r.amount ?? 0) > 0 : r.type === filters.type)) &&
    (!needle || `${r.name} ${r.memo} ${r.note} ${spendCategoryLabel(r.category)}`.toLocaleLowerCase("ko-KR").includes(needle)),
  ).sort((a, b) => sort === "recent"
    ? b.date.localeCompare(a.date) || Math.abs(b.amount ?? 0) - Math.abs(a.amount ?? 0)
    : sort === "oldest" ? a.date.localeCompare(b.date) : Math.abs(b.amount ?? 0) - Math.abs(a.amount ?? 0));
}

export function moneyMonths(cards: CardCharge[], bank: BankTx[]) {
  return [...new Set([...cards.map((row) => moneyCardDate(row).slice(0, 7) || row.month), ...bank.map((row) => row.txDate.slice(0, 7))].filter(Boolean))].sort().reverse();
}

export function monthlyAccountBalances(bank: BankTx[], months: string[], scope: "summary" | AccountKey) {
  return months.flatMap((month) => {
    const accounts = accountBalances(bank, month).filter((account) => scope === "summary" || account.key === scope);
    return accounts.length ? [{ date: month, balance: accounts.reduce((sum, account) => sum + account.balance, 0) }] : [];
  });
}
