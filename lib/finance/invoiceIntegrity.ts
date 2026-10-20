export function invoiceApprovalKey(value: string | null | undefined): string | null {
  const number = (value ?? "").replace(/[\s-]/g, "");
  return /^\d{24}$/.test(number) ? `i|${number}` : null;
}

export function validInvoiceAmounts(inv: { supplyAmount: number | null; taxAmount: number | null; totalAmount: number | null }): boolean {
  const { supplyAmount, taxAmount, totalAmount } = inv;
  return supplyAmount != null && taxAmount != null && totalAmount != null &&
    [supplyAmount, taxAmount, totalAmount].every(Number.isSafeInteger) && supplyAmount + taxAmount === totalAmount;
}

/** A review flag only: equal values can still belong to distinct invoices. */
export function possibleInvoiceDuplicates(rows: { id: string; direction: string; issueDate: string; counterpartyBizno: string; counterpartyName: string; supplyAmount: number; taxAmount: number; totalAmount: number }[]): Set<string> {
  const groups = new Map<string, string[]>();
  for (const row of rows) {
    const key = JSON.stringify([row.direction, row.issueDate, row.counterpartyBizno.replace(/\D/g, "") || row.counterpartyName.normalize("NFC"), row.supplyAmount, row.taxAmount, row.totalAmount]);
    groups.set(key, [...(groups.get(key) ?? []), row.id]);
  }
  return new Set([...groups.values()].filter((ids) => ids.length > 1).flat());
}
