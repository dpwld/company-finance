/** Cash movement and purchase cost are separate views of the same ledger. */
interface BankAmounts { deposit: number | null; withdrawal: number | null }
export type FinanceFlow = "expense" | "inflow" | "transfer" | "review";

export function bankFlow(b: BankAmounts & { spendCategory: string }): FinanceFlow {
  if ((b.deposit ?? 0) > 0 && (b.withdrawal ?? 0) > 0) return "review";
  if (b.spendCategory === "internal" || b.spendCategory === "card_payment") return "transfer";
  if ((b.deposit ?? 0) > 0) return "inflow";
  if ((b.withdrawal ?? 0) > 0) return "expense";
  return "review";
}

export function bankAmountColumn(b: BankAmounts): "deposit" | "withdrawal" | null {
  if ((b.deposit ?? 0) > 0 && (b.withdrawal ?? 0) > 0) return null;
  return (b.deposit ?? 0) > 0 ? "deposit" : "withdrawal";
}

export function bankAmount(b: BankAmounts): number | null {
  const column = bankAmountColumn(b);
  return column ? b[column] : null;
}

export function isExpenseCard(c: { amount: number | null; status: string; cardMeta: Record<string, string> }): boolean {
  if (c.status.includes("취소")) return false;
  return c.amount != null ? c.amount > 0 : !(c.cardMeta["해외승인금액"] ?? "").trim().startsWith("-");
}
