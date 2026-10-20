import { createClient } from "@/lib/transport";
import type { ParsedBankTx, ParsedCard, ParsedInvoice } from "@/lib/finance/parse";

/* Supabase data layer for the Finance tool (admin-only via RLS).
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
  tipsEligible: boolean | null;
  tipsNote: string;
  /** Spending 탭 분류 키 (SPEND_CATEGORIES + income/internal/card_payment). */
  spendCategory: string;
  /** TIPS 지원금으로 집행/수령된 건 — 카테고리와 별개의 체크 플래그. */
  tipsFunded: boolean;
  accountLabel: string;
  /** 업로드한 파일 이름 — 계좌 구분(accountOf)의 유일한 단서다. */
  sourceFile: string;
  matchedInvoice: string | null;
  /** Explicitly confirmed TIPS withdrawal paired with this general-account deposit. */
  tipsRefundSourceId?: string | null;
  tipsRefundSource?: BankTx | null;
  /** 분개 계정과목 (재무제표용) — AI 제안 + 인라인 확정. */
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
  classification: string;
  /** Spending 탭 분류 키. */
  spendCategory: string;
  /** TIPS 지원금으로 집행된 건 — 카테고리와 별개의 체크 플래그. */
  tipsFunded: boolean;
  remarks: string;
  transferred: string;
  amount: number | null;
  purchaseDate: string | null;
  cardMeta: Record<string, string>;
  month: string;
  /** 분개 계정과목 (재무제표용) — AI 제안 + 인라인 확정. */
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
  /** 증빙 업로드에서 AI로 등록된 건이면 그 증빙 파일 id. */
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
    tipsEligible: r.tips_eligible == null ? null : Boolean(r.tips_eligible),
    tipsNote: (r.tips_note as string) ?? "",
    spendCategory: (r.spend_category as string) ?? "",
    tipsFunded: Boolean(r.tips_funded),
    accountLabel: (r.account_label as string) ?? "",
    sourceFile: (r.source_file as string) ?? "",
    matchedInvoice: (r.matched_invoice as string) ?? null,
    tipsRefundSourceId: (r.tips_refund_source_id as string) ?? null,
    tipsRefundSource: r.tips_refund_source ? mapBank(r.tips_refund_source as Record<string, unknown>) : null,
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
    classification: (r.classification as string) ?? "",
    spendCategory: (r.spend_category as string) ?? "",
    tipsFunded: Boolean(r.tips_funded),
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

/** TIPS(RCMS) 창 — 카드 이용기간 기준 [당월 9일, 익월 9일).
    예: "2026-07" = 2026-07-09 ~ 2026-08-08. */
export function tipsBounds(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  const nextY = m === 12 ? y + 1 : y;
  const nextM = m === 12 ? 1 : m + 1;
  return { from: `${month}-09`, to: `${nextY}-${String(nextM).padStart(2, "0")}-09` };
}

/** 달력월 조회 — 카드는 승인일, 은행은 거래일, 세금계산서는 작성일 기준으로
    같은 [1일, 말일] 창에 모인다. (예전에는 카드만 청구월(month 컬럼)로 묶여
    은행과 창이 어긋났다.) 승인일이 없는 카드 건은 예전처럼 month 컬럼으로 담는다. */
export async function fetchFinanceMonth(month: string): Promise<{ bank: BankTx[]; cards: CardCharge[]; invoices: TaxInvoice[] }> {
  const sb = createClient();
  const { from, to } = monthBounds(month);
  const [bankRes, cardRes, invRes] = await Promise.all([
    sb.from("bank_transactions").select("*").gte("tx_date", from).lt("tx_date", to).order("tx_date").order("tx_time"),
    sb.from("card_charges").select("*")
      .or(`and(approval_date.gte.${from},approval_date.lt.${to}),and(approval_date.is.null,month.eq.${month})`)
      .order("approval_date"),
    sb.from("tax_invoices").select("*").gte("issue_date", from).lt("issue_date", to).order("issue_date"),
  ]);
  const err = bankRes.error || cardRes.error || invRes.error;
  if (err) throw err;
  return {
    bank: (bankRes.data ?? []).map(mapBank),
    cards: (cardRes.data ?? []).map(mapCard),
    invoices: (invRes.data ?? []).map(mapInvoice),
  };
}

/** TIPS(RCMS) 탭 전용 조회 — 카드 이용기간 [당월 9일, 익월 9일) 창.
    카드 승인일과 은행 거래일 모두 같은 창으로 맞춰 한 화면에서 대사할 수 있게 한다. */
export async function fetchTipsMonth(month: string): Promise<{ bank: BankTx[]; cards: CardCharge[] }> {
  const sb = createClient();
  const { from, to } = tipsBounds(month);
  const [bankRes, cardRes] = await Promise.all([
    sb.from("bank_transactions").select("*").gte("tx_date", from).lt("tx_date", to).order("tx_date").order("tx_time"),
    sb.from("card_charges").select("*").gte("approval_date", from).lt("approval_date", to).order("approval_date"),
  ]);
  const err = bankRes.error || cardRes.error;
  if (err) throw err;
  return { bank: (bankRes.data ?? []).map(mapBank), cards: (cardRes.data ?? []).map(mapCard) };
}

/** Rows evidence can attach to, over a WIDE window (previous month 1st →
   end of this month) regardless of billing-month bucketing. A "0721쿠팡"
   receipt in the July folder belongs to a charge billed in AUGUST — matching
   only against the on-screen month made such files permanently unmatched. */
export async function fetchMatchWindow(month: string): Promise<{ bank: BankTx[]; cards: CardCharge[] }> {
  const sb = createClient();
  const [y, m] = month.split("-").map(Number);
  const prev = m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, "0")}-01`;
  // 끝은 익월 9일 — TIPS 이용기간(당월 9일~익월 8일)에 드는 익월 초 거래까지
  // 후보에 넣어야 "1007…" 같은 증빙이 이 달 장부에서 붙는다.
  const next = m === 12 ? `${y + 1}-01-09` : `${y}-${String(m + 1).padStart(2, "0")}-09`;
  const [bankRes, cardRes] = await Promise.all([
    sb.from("bank_transactions").select("*").gte("tx_date", prev).lt("tx_date", next).order("tx_date"),
    sb.from("card_charges").select("*").gte("approval_date", prev).lt("approval_date", next).order("approval_date"),
  ]);
  const err = bankRes.error || cardRes.error;
  if (err) throw err;
  return { bank: (bankRes.data ?? []).map(mapBank), cards: (cardRes.data ?? []).map(mapCard) };
}

/** Months that have any data, newest first (for the month picker). */
/** 거래 분할 줄 — 한 카드 결제를 카테고리별 여러 줄로 쪼갠 것. */
export interface ChargeSplit {
  id: string;
  /** 분할 대상 — 카드 결제 건이면 cardChargeId, 은행 이체 건이면 bankTxId. */
  cardChargeId: string;
  bankTxId: string;
  label: string;
  amount: number;
  spendCategory: string;
  /** TIPS 지원금 집행 체크 (2026-10-01 SQL). */
  tipsFunded: boolean;
  /** 세부항목별 분개(Transactions 탭). 2026-08-05d SQL. */
  debitAccount: string;
  creditAccount: string;
  /** 세부항목별 TIPS 처리(TIPS 탭). */
  classification: string;
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
    tipsFunded: Boolean(r.tips_funded),
    debitAccount: (r.debit_account as string) ?? "",
    creditAccount: (r.credit_account as string) ?? "",
    classification: (r.classification as string) ?? "",
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

const splitKey = (t: SplitTarget) => ("cardChargeId" in t ? "card_charge_id" : "bank_tx_id");
const splitId = (t: SplitTarget) => ("cardChargeId" in t ? t.cardChargeId : t.bankTxId);

/** 해당 거래의 분할을 통째로 교체 (빈 배열 = 분할 해제). 카드·이체 공용. */
export async function saveChargeSplits(
  target: SplitTarget | string,
  lines: { label: string; amount: number; spendCategory: string; classification?: string; status?: string; remarks?: string }[],
): Promise<void> {
  const t: SplitTarget = typeof target === "string" ? { cardChargeId: target } : target;
  const response = await fetch("/api/splits", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ target: t, lines }) });
  if (!response.ok) throw new Error(((await response.json() as any)).error?.message || "분할 저장 실패");
}

export async function updateChargeSplit(
  id: string,
  patch: { spendCategory?: string; tipsFunded?: boolean; debitAccount?: string; creditAccount?: string; classification?: string; status?: string; remarks?: string },
): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.spendCategory !== undefined) row.spend_category = patch.spendCategory;
  if (patch.tipsFunded !== undefined) row.tips_funded = patch.tipsFunded;
  if (patch.debitAccount !== undefined) row.debit_account = patch.debitAccount;
  if (patch.creditAccount !== undefined) row.credit_account = patch.creditAccount;
  if (patch.classification !== undefined) row.classification = patch.classification;
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.remarks !== undefined) row.remarks = patch.remarks;
  const { error } = await createClient().from("charge_splits").update(row).eq("id", id);
  if (error) throw error;
}

/** 분류 규칙 — 패턴이 상대처/가맹점/적요에 포함되면 해당 카테고리로 자동 분류. */
export interface SpendRule {
  id: string;
  pattern: string;
  category: string;
  matchMode?: "contains" | "exact";
}

export async function fetchSpendRules(): Promise<SpendRule[]> {
  const { data, error } = await createClient()
    .from("spend_rules")
    .select("id, pattern, category, match_mode")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r: any) => ({ id: r.id as string, pattern: (r.pattern as string) ?? "", category: (r.category as string) ?? "", matchMode: r.match_mode === "exact" ? "exact" : "contains" }));
}

export async function insertSpendRule(pattern: string, category: string, createdByKey = "", matchMode: "contains" | "exact" = "exact"): Promise<SpendRule> {
  const table = createClient().from("spend_rules");
  const existing = matchMode === "exact" ? (await fetchSpendRules()).find((rule) => rule.matchMode === "exact" && rule.pattern.trim().toLocaleLowerCase() === pattern.trim().toLocaleLowerCase()) : null;
  const query = existing
    ? table.update({ category }).eq("id", existing.id)
    : table.insert({ pattern: pattern.trim(), category, created_by_key: createdByKey, match_mode: matchMode });
  const { data, error } = await query.select("id, pattern, category, match_mode").single();
  if (error) throw error;
  return { id: data.id as string, pattern: data.pattern as string, category: data.category as string, matchMode: data.match_mode === "exact" ? "exact" : "contains" };
}

export async function deleteSpendRule(id: string): Promise<void> {
  const { error } = await createClient().from("spend_rules").delete().eq("id", id);
  if (error) throw error;
}

/** 규칙 매칭: 주어진 텍스트들 중 하나라도 패턴을 포함하면 그 규칙의 카테고리. */
/** 담당자가 이미 확정한 TIPS 판정 이력 — 월과 무관하게 최근 것부터.
    AI 분류에 예시로 넣어, 지난달에 내린 판정을 이번 달에도 그대로 따르게 한다. */
export interface ConfirmedTipsCase {
  merchant: string;
  itemName: string;
  classification: string;
  status: string;
  note: string;
}

export async function fetchConfirmedTipsHistory(limit = 150): Promise<ConfirmedTipsCase[]> {
  const { data, error } = await createClient()
    .from("card_charges")
    .select("merchant,item_name,classification,status,remarks,approval_date")
    .neq("status", "")
    .order("approval_date", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    merchant: (r.merchant as string) ?? "",
    itemName: (r.item_name as string) ?? "",
    classification: (r.classification as string) ?? "",
    status: (r.status as string) ?? "",
    note: (r.remarks as string) ?? "",
  })).filter((c: any) => c.merchant || c.itemName);
}

export function matchSpendRule(rules: SpendRule[], texts: (string | null | undefined)[]): string | null {
  const hay = texts.filter(Boolean).join(" ").toLowerCase();
  if (!hay) return null;
  for (const r of rules) {
    const p = r.pattern.trim().toLowerCase();
    if (p && (r.matchMode === "exact" ? (texts[0] ?? "").trim().toLocaleLowerCase() === p : hay.includes(p))) return r.category;
  }
  return null;
}

/** Spending 추이용 경량 조회 — 지정한 월 목록의 (월, 금액, 분류)만. */
export async function fetchSpendSeries(months: string[]): Promise<{
  cards: { month: string; amount: number | null; status: string; spendCategory: string; tipsFunded: boolean }[];
  bank: { month: string; deposit: number | null; withdrawal: number | null; spendCategory: string; tipsFunded: boolean }[];
}> {
  const sb = createClient();
  const from = `${months[0]}-01`;
  // "-31" 상한은 31일 없는 달에서 date 비교가 22008로 죽는다 — 다음 달 1일 미만으로.
  const [ly, lm] = months[months.length - 1].split("-").map(Number);
  const to = lm === 12 ? `${ly + 1}-01-01` : `${ly}-${String(lm + 1).padStart(2, "0")}-01`;
  // 카드는 본문(fetchFinanceMonth)과 같은 승인일 달력월 기준 — 청구월(month
  // 컬럼, 이용기간 9일~익월 8일)로 묶으면 추이 바와 탭 합계가 어긋난다.
  // 승인일이 없는 건만 예전처럼 month 컬럼으로 담는다.
  const [cardsRes, bankRes] = await Promise.all([
    sb.from("card_charges").select("month, approval_date, amount, status, spend_category, tips_funded")
      .or(`and(approval_date.gte.${from},approval_date.lt.${to}),and(approval_date.is.null,month.in.(${months.join(",")}))`),
    sb.from("bank_transactions").select("tx_date, deposit, withdrawal, spend_category, tips_funded").gte("tx_date", from).lt("tx_date", to),
  ]);
  if (cardsRes.error) throw cardsRes.error;
  if (bankRes.error) throw bankRes.error;
  return {
    cards: (cardsRes.data ?? []).map((r: any) => ({
      month: ((r.approval_date as string) ?? "").slice(0, 7) || ((r.month as string) ?? ""),
      amount: (r.amount as number) ?? null,
      status: (r.status as string) ?? "",
      spendCategory: (r.spend_category as string) ?? "",
      tipsFunded: Boolean(r.tips_funded),
    })),
    bank: (bankRes.data ?? []).map((r: any) => ({
      month: ((r.tx_date as string) ?? "").slice(0, 7),
      deposit: (r.deposit as number) ?? null,
      withdrawal: (r.withdrawal as number) ?? null,
      spendCategory: (r.spend_category as string) ?? "",
      tipsFunded: Boolean(r.tips_funded),
    })),
  };
}

export async function fetchFinanceMonths(): Promise<string[]> {
  const sb = createClient();
  const [cards, bank] = await Promise.all([
    sb.from("card_charges").select("month"),
    sb.from("bank_transactions").select("tx_date"),
  ]);
  const months = new Set<string>();
  for (const r of cards.data ?? []) if (r.month) months.add(r.month as string);
  for (const r of bank.data ?? []) months.add((r.tx_date as string).slice(0, 7));
  return [...months].sort().reverse();
}

/** Upsert parsed rows; duplicates (same dedupe_key) are skipped. Returns inserted counts. */
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
      if (c.classification) patch.classification = c.classification;
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
      if (b.tips_note) patch.tips_note = b.tips_note;
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

/* 반복 결제·잔액 추이는 여러 달을 한꺼번에 봐야 한다. fetchSpendSeries는 월별
   합계만 주므로(가맹점·잔액이 없다) 가벼운 행 단위로 따로 읽는다. */
export interface HistoryCard { date: string; merchant: string; amount: number; status: string; spendCategory: string; tipsFunded: boolean }
export interface HistoryBank { date: string; time: string; balance: number | null; sourceFile: string; deposit: number | null; withdrawal: number | null }

export async function fetchFinanceHistory(months: string[]): Promise<{ cards: HistoryCard[]; bank: HistoryBank[] }> {
  const sb = createClient();
  const from = `${months[0]}-01`;
  const [ly, lm] = months[months.length - 1].split("-").map(Number);
  const to = lm === 12 ? `${ly + 1}-01-01` : `${ly}-${String(lm + 1).padStart(2, "0")}-01`;
  const [cardsRes, bankRes] = await Promise.all([
    sb.from("card_charges").select("approval_date, merchant, amount, status, spend_category, tips_funded")
      .gte("approval_date", from).lt("approval_date", to).order("approval_date"),
    sb.from("bank_transactions").select("tx_date, tx_time, balance, source_file, deposit, withdrawal")
      .gte("tx_date", from).lt("tx_date", to).order("tx_date").order("tx_time"),
  ]);
  if (cardsRes.error) throw cardsRes.error;
  if (bankRes.error) throw bankRes.error;
  return {
    cards: (cardsRes.data ?? []).map((r: any) => ({
      date: (r.approval_date as string) ?? "",
      merchant: (r.merchant as string) ?? "",
      amount: Number(r.amount) || 0,
      status: (r.status as string) ?? "",
      spendCategory: (r.spend_category as string) ?? "",
      tipsFunded: Boolean(r.tips_funded),
    })),
    bank: (bankRes.data ?? []).map((r: any) => ({
      date: (r.tx_date as string) ?? "",
      time: (r.tx_time as string) ?? "",
      balance: (r.balance as number) ?? null,
      sourceFile: (r.source_file as string) ?? "",
      deposit: (r.deposit as number) ?? null,
      withdrawal: (r.withdrawal as number) ?? null,
    })),
  };
}

/* 카테고리별 월 예산. 예전에는 app_settings 'spend_budget'에 JSON으로 넣었는데
   그 테이블은 쓰기가 admin 전용이라 Finance 담당자가 저장할 수 없었다 —
   has_tool('finance') 범위의 전용 테이블로 옮겼다. */
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


/** Native money screens use purchase-date months. TIPS APIs above keep their original window. */
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
    let query = sb.from("bank_transactions").select("*, tips_refund_source:bank_transactions!tips_refund_source_id(*)").order("id").range(offset, offset + pageSize - 1);
    if (from && to) query = query.gte("tx_date", from).lt("tx_date", to);
    const { data, error } = await query;
    if (error) throw error;
    bank.push(...(data ?? []).map(mapBank));
    if ((data?.length ?? 0) < pageSize) break;
  }
  const rules = (await fetchSpendRules()).filter((rule) => rule.matchMode === "exact").reverse();
  return {
    cards: cards.map((row) => ({ ...row, spendCategory: row.spendCategory || matchSpendRule(rules, [row.merchant || row.itemName || "카드 결제"]) || "" })),
    bank: bank.map((row) => ({ ...row, spendCategory: row.spendCategory || matchSpendRule(rules, [row.counterparty || row.description || "계좌 거래"]) || "" })),
  };
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
  if (!name || name.length > 40 || name === "TIPS 환급 차감") throw new Error("카테고리 이름은 1~40자로 입력하세요. TIPS 환급 차감은 계산 항목입니다.");
  const key = `custom:${name}`;
  const { error } = await createClient().from("finance_categories").upsert({ key }, { ignoreDuplicates: true });
  if (error) throw error;
  return key;
}
