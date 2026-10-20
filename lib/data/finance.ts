import { createClient } from "@/lib/transport";
import type { ParsedBankTx, ParsedCard, ParsedInvoice } from "@/lib/finance/parse";

/* Authenticated Finance data contracts backed by owner-scoped D1.
   Uploads upsert with ignoreDuplicates on dedupe_key so re-uploading the
   same file never duplicates rows. */

export interface BankTx {
  id: string;
  txDate: string;
  txTime: string;
  counterparty: string;
  deposit: number | null;
  withdrawal: number | null;
  balance: number | null;
  description: string;
  status: string;
  memo: string;
  category: string;
  /** Spending 탭 분류 키 (사용자가 저장한 카테고리). */
  spendCategory: string;
  accountLabel: string;
  /** 업로드한 파일 이름 — 계좌 구분(accountOf)의 유일한 단서다. */
  sourceFile: string;
  matchedInvoice: string | null;
  /** 분개 계정과목 (재무제표용) — 직접 입력. */
  debitAccount: string;
  creditAccount: string;
}

export interface CardCharge {
  id: string;
  approvalDate: string | null;
  merchant: string;
  industry: string;
  status: string;
  vat: number | null;
  itemName: string;
  /** Spending 탭 분류 키. */
  spendCategory: string;
  remarks: string;
  transferred: string;
  amount: number | null;
  purchaseDate: string | null;
  cardMeta: Record<string, string>;
  month: string;
  /** 분개 계정과목 (재무제표용) — 직접 입력. */
  debitAccount: string;
  creditAccount: string;
}

export interface TaxInvoice {
  id: string;
  direction: "sale" | "purchase";
  issueDate: string;
  counterpartyName: string;
  counterpartyBizno: string;
  item: string;
  supplyAmount: number;
  taxAmount: number;
  totalAmount: number;
  matchedTx: string | null;
  /** 연결된 증빙 파일 ID. */
  evidenceId: string | null;
}

function mapBank(r: Record<string, unknown>): BankTx {
  return {
    id: r.id as string,
    txDate: r.tx_date as string,
    txTime: (r.tx_time as string) ?? "",
    counterparty: (r.counterparty as string) ?? "",
    deposit: r.deposit == null ? null : Number(r.deposit),
    withdrawal: r.withdrawal == null ? null : Number(r.withdrawal),
    balance: r.balance == null ? null : Number(r.balance),
    description: (r.description as string) ?? "",
    status: (r.status as string) ?? "",
    memo: (r.memo as string) ?? "",
    category: (r.category as string) ?? "",
    spendCategory: (r.spend_category as string) ?? "",
    accountLabel: (r.account_label as string) ?? "",
    sourceFile: (r.source_file as string) ?? "",
    matchedInvoice: (r.matched_invoice as string) ?? null,
    debitAccount: (r.debit_account as string) ?? "",
    creditAccount: (r.credit_account as string) ?? "",
  };
}

function mapCard(r: Record<string, unknown>): CardCharge {
  return {
    id: r.id as string,
    approvalDate: (r.approval_date as string) ?? null,
    merchant: (r.merchant as string) ?? "",
    industry: (r.industry as string) ?? "",
    status: (r.status as string) ?? "",
    vat: r.vat == null ? null : Number(r.vat),
    itemName: (r.item_name as string) ?? "",
    spendCategory: (r.spend_category as string) ?? "",
    remarks: (r.remarks as string) ?? "",
    transferred: (r.transferred as string) ?? "",
    amount: r.amount == null ? null : Number(r.amount),
    purchaseDate: (r.purchase_date as string) ?? null,
    cardMeta: (r.card_meta as Record<string, string>) ?? {},
    month: (r.month as string) ?? "",
    debitAccount: (r.debit_account as string) ?? "",
    creditAccount: (r.credit_account as string) ?? "",
  };
}

function mapInvoice(r: Record<string, unknown>): TaxInvoice {
  return {
    id: r.id as string,
    direction: r.direction as "sale" | "purchase",
    issueDate: r.issue_date as string,
    counterpartyName: (r.counterparty_name as string) ?? "",
    counterpartyBizno: (r.counterparty_bizno as string) ?? "",
    item: (r.item as string) ?? "",
    supplyAmount: Number(r.supply_amount ?? 0),
    taxAmount: Number(r.tax_amount ?? 0),
    totalAmount: Number(r.total_amount ?? 0),
    matchedTx: (r.matched_tx as string) ?? null,
    evidenceId: (r.evidence_id as string) ?? null,
  };
}

/** All finance rows for one month ("yyyy-mm"). */
/** 달력월 경계 — [1일, 다음달 1일). "-31"은 30일 달에서 잘못된 날짜(Postgres 22008)라
    항상 반개구간으로 자른다. */
function monthBounds(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  return {
    from: `${month}-01`,
    to: m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`,
  };
}

export interface ChargeSplit {
  id: string;
  /** 분할 대상 — 카드 결제 건이면 cardChargeId, 은행 이체 건이면 bankTxId. */
  cardChargeId: string;
  bankTxId: string;
  label: string;
  amount: number;
  spendCategory: string;
  debitAccount: string;
  creditAccount: string;
  status: string;
  remarks: string;
}

function mapSplit(r: Record<string, unknown>): ChargeSplit {
  return {
    id: r.id as string,
    cardChargeId: (r.card_charge_id as string) ?? "",
    bankTxId: (r.bank_tx_id as string) ?? "",
    label: (r.label as string) ?? "",
    amount: Number(r.amount ?? 0),
    spendCategory: (r.spend_category as string) ?? "",
    debitAccount: (r.debit_account as string) ?? "",
    creditAccount: (r.credit_account as string) ?? "",
    status: (r.status as string) ?? "",
    remarks: (r.remarks as string) ?? "",
  };
}

export async function fetchChargeSplits(): Promise<ChargeSplit[]> {
  const { data, error } = await createClient()
    .from("charge_splits")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(mapSplit);
}

/** 분할 대상 — 카드 결제 건 또는 은행 이체 건 중 하나. */
export type SplitTarget = { cardChargeId: string } | { bankTxId: string };

/** 해당 거래의 분할을 통째로 교체 (빈 배열 = 분할 해제). 카드·이체 공용. */
export async function saveChargeSplits(
  target: SplitTarget | string,
  lines: { label: string; amount: number; spendCategory: string; status?: string; remarks?: string }[],
): Promise<void> {
  const t: SplitTarget = typeof target === "string" ? { cardChargeId: target } : target;
  const response = await fetch("/api/splits", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ target: t, lines }) });
  if (!response.ok) throw new Error(((await response.json() as any)).error?.message || "분할 저장 실패");
}

export async function updateChargeSplit(
  id: string,
  patch: { spendCategory?: string; debitAccount?: string; creditAccount?: string; status?: string; remarks?: string },
): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.spendCategory !== undefined) row.spend_category = patch.spendCategory;
  if (patch.debitAccount !== undefined) row.debit_account = patch.debitAccount;
  if (patch.creditAccount !== undefined) row.credit_account = patch.creditAccount;
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.remarks !== undefined) row.remarks = patch.remarks;
  const { error } = await createClient().from("charge_splits").update(row).eq("id", id);
  if (error) throw error;
}

/** 분류 규칙 — 패턴이 상대처/가맹점/적요에 포함되면 해당 카테고리로 자동 분류. */
export async function importParsed(
  parsed: { cards: ParsedCard[]; bank: ParsedBankTx[]; invoices: ParsedInvoice[] },
  sourceFile: string,
): Promise<{ cards: number; bank: number; invoices: number }> {
  const sb = createClient();
  const out = { cards: 0, bank: 0, invoices: 0 };

  if (parsed.cards.length) {
    const { data, error } = await sb
      .from("card_charges")
      .upsert(
        parsed.cards.map(({ enriched: _e, ...c }) => ({ ...c, source_file: sourceFile })),
        { onConflict: "dedupe_key", ignoreDuplicates: true },
      )
      .select("id");
    if (error) throw error;
    out.cards = data?.length ?? 0;

    // The accountant worksheet is the source of truth for 상태·명칭·분류·금액:
    // when its row was skipped as a duplicate (the raw KB file came first),
    // merge those fields into the existing row instead of losing them.
    for (const c of parsed.cards) {
      if (!c.enriched) continue;
      const patch: Record<string, unknown> = {};
      if (c.status) patch.status = c.status;
      if (c.vat != null) patch.vat = c.vat;
      if (c.item_name) patch.item_name = c.item_name;
      if (c.remarks) patch.remarks = c.remarks;
      if (c.transferred) patch.transferred = c.transferred;
      if (c.amount != null) patch.amount = c.amount;
      if (c.month) patch.month = c.month;
      if (!Object.keys(patch).length) continue;
      const { error: mergeErr } = await sb.from("card_charges").update(patch).eq("dedupe_key", c.dedupe_key);
      if (mergeErr) throw mergeErr;
    }
  }
  if (parsed.bank.length) {
    const { data, error } = await sb
      .from("bank_transactions")
      .upsert(
        parsed.bank.map(({ enriched: _e, ...b }) => ({ ...b, source_file: sourceFile })),
        { onConflict: "dedupe_key", ignoreDuplicates: true },
      )
      .select("id");
    if (error) throw error;
    out.bank = data?.length ?? 0;

    for (const b of parsed.bank) {
      if (!b.enriched) continue;
      const patch: Record<string, unknown> = {};
      if (b.status) patch.status = b.status;
      if (b.memo) patch.memo = b.memo;
      if (b.category) patch.category = b.category;
      if (!Object.keys(patch).length) continue;
      const { error: mergeErr } = await sb.from("bank_transactions").update(patch).eq("dedupe_key", b.dedupe_key);
      if (mergeErr) throw mergeErr;
    }
  }
  if (parsed.invoices.length) {
    const { data, error } = await sb
      .from("tax_invoices")
      .upsert(parsed.invoices.map((i) => ({ ...i, source_file: sourceFile })), { onConflict: "dedupe_key", ignoreDuplicates: true })
      .select("id");
    if (error) throw error;
    out.invoices = data?.length ?? 0;
  }
  return out;
}

export async function updateCardCharge(id: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await createClient().from("card_charges").update(patch).eq("id", id);
  if (error) throw error;
}

export async function updateBankTx(id: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await createClient().from("bank_transactions").update(patch).eq("id", id);
  if (error) throw error;
}

/** Link an invoice to a bank transaction (both directions). */
export async function matchInvoice(invoiceId: string, txId: string | null): Promise<void> {
  const sb = createClient();
  const { error } = await sb.from("tax_invoices").update({ matched_tx: txId }).eq("id", invoiceId);
  if (error) throw error;
}

export async function fetchBudgets(): Promise<Record<string, number>> {
  const { data, error } = await createClient().from("finance_budgets").select("category, amount");
  if (error) throw error;
  const out: Record<string, number> = {};
  for (const r of data ?? []) out[r.category as string] = Number(r.amount) || 0;
  return out;
}

/** 0이면 행을 지운다 — 예산 없음과 0원 예산을 구분할 이유가 없다. */
export async function saveBudget(category: string, amount: number): Promise<void> {
  const sb = createClient();
  const value = Math.max(0, Math.round(amount || 0));
  const { error } = value
    ? await sb.from("finance_budgets").upsert({ category, amount: value, updated_at: new Date().toISOString() })
    : await sb.from("finance_budgets").delete().eq("category", category);
  if (error) throw error;
}


/** Purchase-date history with persisted user classifications only. */
export async function fetchMoneyHistory(months?: string[]): Promise<{ cards: CardCharge[]; bank: BankTx[] }> {
  const sb = createClient();
  const from = months?.[0] ? `${months[0]}-01` : null;
  const to = months?.length ? monthBounds(months[months.length - 1]).to : null;
  const cards: CardCharge[] = [], bank: BankTx[] = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    let query = sb.from("card_charges").select("*").order("id").range(offset, offset + pageSize - 1);
    if (from && to) query = query.or(`and(purchase_date.gte.${from},purchase_date.lt.${to}),and(purchase_date.is.null,approval_date.gte.${from},approval_date.lt.${to}),and(purchase_date.is.null,approval_date.is.null,month.in.(${months!.join(",")}))`);
    const { data, error } = await query;
    if (error) throw error;
    cards.push(...(data ?? []).map(mapCard));
    if ((data?.length ?? 0) < pageSize) break;
  }
  for (let offset = 0; ; offset += pageSize) {
    let query = sb.from("bank_transactions").select("*").order("id").range(offset, offset + pageSize - 1);
    if (from && to) query = query.gte("tx_date", from).lt("tx_date", to);
    const { data, error } = await query;
    if (error) throw error;
    bank.push(...(data ?? []).map(mapBank));
    if ((data?.length ?? 0) < pageSize) break;
  }
  return { cards, bank };
}

export async function fetchMoneyMonth(month: string): Promise<{ cards: CardCharge[]; bank: BankTx[]; invoices: TaxInvoice[] }> {
  const { from, to } = monthBounds(month);
  const [money, invoices] = await Promise.all([
    fetchMoneyHistory([month]),
    createClient().from("tax_invoices").select("*").gte("issue_date", from).lt("issue_date", to).order("issue_date"),
  ]);
  if (invoices.error) throw invoices.error;
  return { ...money, invoices: (invoices.data ?? []).map(mapInvoice) };
}

export async function fetchMoneyBankHistory(): Promise<BankTx[]> {
  const rows: BankTx[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await createClient().from("bank_transactions").select("*").order("tx_date").order("tx_time").order("id").range(offset, offset + 999);
    if (error) throw error;
    rows.push(...(data ?? []).map(mapBank));
    if ((data?.length ?? 0) < 1000) return rows;
  }
}

export async function fetchMoneyCategories(): Promise<string[]> {
  const { data, error } = await createClient().from("finance_categories").select("key").order("created_at");
  if (error) throw error;
  return (data ?? []).map((r: any) => r.key as string);
}

export async function createMoneyCategory(label: string): Promise<string> {
  const name = label.trim();
  if (!name || name.length > 40) throw new Error("카테고리 이름은 1~40자로 입력하세요.");
  const key = `custom:${name}`;
  const { error } = await createClient().from("finance_categories").upsert({ key }, { ignoreDuplicates: true });
  if (error) throw error;
  return key;
}

export interface SpendRule { id: string; pattern: string; category: string; matchMode: "contains" | "exact"; priority: number }
export { matchSpendRule } from "@/lib/finance/rules";
export async function fetchSpendRules(): Promise<SpendRule[]> {
 const { data, error } = await createClient().from("spend_rules").select("*").order("priority").order("id");
 if (error) throw error;
 return (data ?? []).map((r: any) => ({ id: r.id, pattern: r.pattern, category: r.category, matchMode: r.match_mode || "exact", priority: r.priority ?? 100 })).sort((a: SpendRule, b: SpendRule) => a.priority - b.priority || a.id.localeCompare(b.id));
}
export async function insertSpendRule(pattern: string, category: string, _createdBy = "", matchMode: "contains" | "exact" = "exact", priority = 100): Promise<SpendRule> {
 const { data, error } = await createClient().from("spend_rules").insert({ pattern: pattern.trim(), category, match_mode: matchMode, priority }).select("*").single();
 if (error) throw error;
 return { id: data.id, pattern: data.pattern, category: data.category, matchMode: data.match_mode, priority: data.priority };
}
export async function updateSpendRule(id: string, patch: { pattern: string; category: string; match_mode: "exact" | "contains"; priority: number }): Promise<void> {
 const { error } = await createClient().from("spend_rules").update(patch).eq("id", id); if(error) throw error;
}
export async function deleteSpendRule(id: string): Promise<void> {
 const { error } = await createClient().from("spend_rules").delete().eq("id", id); if(error) throw error;
}
export async function renameMoneyCategory(key: string, label: string): Promise<void> {
 const { error } = await createClient().from("finance_categories").update({ key: `custom:${label.trim()}` }).eq("key", key); if(error) throw error;
}
export async function deleteMoneyCategory(key: string): Promise<void> {
 const { error } = await createClient().from("finance_categories").delete().eq("key", key); if(error) throw error;
}
export interface RulePreview { kind: "card" | "bank"; id: string; name: string; category: string; ruleId: string }
export async function previewSpendRules(apply = false): Promise<{ matches: RulePreview[]; applied: number }> {
 const response = await fetch("/api/rules", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apply }) });
 const value = await response.json() as { matches: RulePreview[]; applied: number; error?: string }; if(!response.ok) throw new Error(value.error || "규칙 적용 실패"); return value;
}
