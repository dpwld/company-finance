import { invoiceApprovalKey } from "./invoiceIntegrity";
import * as XLSX from "xlsx";

/* Deterministic parser for the finance uploads (no AI — accounting numbers).
   Recognizes, by header names (not positions):
   ① 카드결제내역 sheet of "NN월 결제예정금액조회.xlsx" → card charges
   ② 이체내역서 sheet (corporate account transfers) → bank transactions
   ③ Hometax 전자세금계산서 목록 (best effort until a real sample arrives) */

export interface ParsedCard {
  /** true = accountant worksheet row (결제예정금액조회) — its 상태·명칭·분류
     values are authoritative and merge into an existing row on import. */
  enriched: boolean;
  approval_date: string | null;
  merchant: string;
  industry: string;
  pay_method: string;
  status: string;
  vat: number | null;
  item_name: string;
  classification: string;
  remarks: string;
  transferred: string;
  amount: number | null;
  purchase_date: string | null;
  card_meta: Record<string, string>;
  month: string;
  dedupe_key: string;
}

export interface ParsedBankTx {
  /** worksheet variant carries the accountant's 상태/명칭/처리된 항목/기타 */
  enriched: boolean;
  tx_date: string;
  tx_time: string;
  counterparty: string;
  deposit: number | null;
  withdrawal: number | null;
  balance: number | null;
  description: string;
  status: string;
  memo: string;
  category: string;
  tips_note: string;
  account_label: string;
  dedupe_key: string;
}

export interface ParsedInvoice {
  direction: "sale" | "purchase";
  issue_date: string;
  counterparty_name: string;
  counterparty_bizno: string;
  item: string;
  supply_amount: number;
  tax_amount: number;
  total_amount: number;
  dedupe_key: string;
}

export interface ParseResult {
  cards: ParsedCard[];
  bank: ParsedBankTx[];
  invoices: ParsedInvoice[];
  month: string | null;
  warnings: string[];
}

const CARD_META_KEYS = [
  "승인번호", "과세유형", "가맹점상태", "가맹점번호", "가맹점사업자번호",
  "대표자성명", "가맹점주소", "가맹점전화번호", "부서번호", "부서명",
  // raw KB card download ("NN월 결제일" 서식) extras
  "청구일", "카드번호", "이용자명", "할인금액", "청구회차", "잔여회차",
  "청구원금", "수수료", "연체원금",
  // 승인내역조회 서식 extras
  "승인구분", "승인방식", "가맹점사업자등록번호", "할부개월수",
];

/** Foreign-currency amount string ("USD amount", "negative FX amount") — the
   KRW billing amount arrives later in the enriched settlement sheet, so we
   keep amount null and preserve the original for the ledger. */
function fxString(v: unknown): string | null {
  const s = clean(v);
  return /^-?\s*(?:[$€£¥]|USD|EUR|JPY|GBP)\s*[\d,.]+$/i.test(s) ? s : null;
}

function clean(v: unknown): string {
  if (v == null) return "";
  let s = String(v).trim();
  if (s.startsWith("'")) s = s.slice(1); // Excel text-prefix apostrophe
  return s;
}

function toNumber(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = clean(v).replace(/[,₩\s원]/g, "");
  if (s === "" || s === "-") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** "20260508" / "2026.06.30" / "2026-06-30" / Date → "2026-05-08". */
function toDate(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
  }
  const s = clean(v);
  let m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{4})[.\-/]\s?(\d{1,2})[.\-/]\s?(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  return null;
}

/** "2026.06.30 19:29:34" → { date, time }. */
function toDateTime(v: unknown): { date: string | null; time: string } {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return {
      date: toDate(v),
      time: `${String(v.getHours()).padStart(2, "0")}:${String(v.getMinutes()).padStart(2, "0")}:${String(v.getSeconds()).padStart(2, "0")}`,
    };
  }
  const s = clean(v);
  const t = s.match(/(\d{1,2}:\d{2}(?::\d{2})?)/);
  return { date: toDate(s), time: t ? t[1] : "" };
}

type Row = Record<string, unknown>;

/* KB raw downloads put account metadata above the table (계좌번호/총잔액/…),
   so scan the first rows for the actual header row instead of assuming row 0. */
const HEADER_HINTS = ["거래일시", "승인일", "가맹점명", "작성일자"];

function headerRowIndex(ws: XLSX.WorkSheet): number {
  const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "" });
  for (let i = 0; i < Math.min(grid.length, 15); i++) {
    const cells = (grid[i] ?? []).map((h) => clean(h));
    if (HEADER_HINTS.some((k) => cells.includes(k))) return i;
  }
  return 0;
}

function sheetRows(ws: XLSX.WorkSheet, headerRow: number): Row[] {
  return XLSX.utils.sheet_to_json<Row>(ws, { defval: "", raw: true, range: headerRow });
}

function headersOf(ws: XLSX.WorkSheet, headerRow: number): string[] {
  const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, range: headerRow, defval: "" });
  return ((grid[0] as unknown[]) ?? []).map((h) => clean(h));
}

/** Month "yyyy-mm" = the most frequent month among the row dates (filenames
    like "7월 결제일(6월 카드내역)" are ambiguous, so trust the data). */
/** Corporate-card billing month for an approval date ("yyyy-mm-dd"): charges
    on/after the 9th roll into the NEXT month's bill (전월9일~당월8일 = 당월분). */
function billingMonth(dateStr: string | null): string {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return "";
  let year = y;
  let month = m + (d >= 9 ? 1 : 0);
  if (month > 12) { month = 1; year += 1; }
  return `${year}-${String(month).padStart(2, "0")}`;
}

function guessMonth(dates: (string | null)[]): string | null {
  const freq = new Map<string, number>();
  for (const d of dates) if (d) freq.set(d.slice(0, 7), (freq.get(d.slice(0, 7)) ?? 0) + 1);
  let best: string | null = null;
  for (const [m, n] of freq) if (best === null || n > (freq.get(best) ?? 0)) best = m;
  return best;
}

export async function parseFinanceFile(file: File): Promise<ParseResult> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const result: ParseResult = { cards: [], bank: [], invoices: [], month: null, warnings: [] };

  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    const headerRow = headerRowIndex(ws);
    const headers = headersOf(ws, headerRow);
    const has = (h: string) => headers.some((x) => x.startsWith(h));

    if (has("승인일") && has("가맹점명") && (has("합계") || has("승인금액"))) {
      // ① corporate-card charges — enriched 결제예정금액조회 (합계) or the raw
      //   KB download "NN월 결제일(…카드내역).xls" (승인금액)
      for (const r of sheetRows(ws, headerRow)) {
        const approval = toDate(r["승인일"]);
        const merchant = clean(r["가맹점명"]);
        const amount = toNumber(r["합계"]) ?? toNumber(r["승인금액"]);
        if (!merchant && amount == null) continue;
        const meta: Record<string, string> = {};
        for (const k of CARD_META_KEYS) if (clean(r[k])) meta[k] = clean(r[k]);
        // Foreign-currency approval (non-KRW source amount) — amount stays
        // null (KRW comes with the enriched settlement sheet); keep the original.
        if (amount == null) {
          const fx = fxString(r["승인금액"]) ?? fxString(r["합계"]);
          if (fx) meta["해외승인금액"] = fx;
        }
        // Two very different "상태" columns: the RAW KB 승인내역조회 carries the
        // APPROVAL state (정상/취소 — bookkeeping noise, park it in meta so the
        // TIPS status starts 미확인), while the enriched 결제예정금액조회
        // worksheet carries the accountant's REAL classification
        // (처리불가/확인필요/접수완료…) which must import as the status.
        const isApprovalReport = has("승인구분");
        if (isApprovalReport && clean(r["상태"])) meta["승인상태"] = clean(r["상태"]);
        // 승인번호 keys the same charge across 승인내역조회 and the enriched
        // sheet (first upload wins). KB reuses the approval number on the
        // CANCELLATION row, so the sign disambiguates the +/− pair.
        const apprNo = meta["승인번호"] ?? "";
        const neg = (amount != null && amount < 0) || (meta["해외승인금액"] ?? "").trim().startsWith("-");
        result.cards.push({
          enriched: !isApprovalReport,
          approval_date: approval,
          merchant,
          industry: clean(r["업종"] ?? r["업종명"]),
          pay_method: clean(r["결제방법"]),
          status: isApprovalReport ? "" : clean(r["상태"]),
          vat: toNumber(r["부가세"]),
          item_name: clean(r["명칭"]),
          classification: clean(r["처리된 항목"]),
          remarks: clean(r["기타"]),
          transferred: clean(r["이체여부"]),
          amount,
          purchase_date: toDate(r["매입일"]),
          card_meta: meta,
          month: "", // filled below once the file month is known
          dedupe_key: apprNo
            ? `c|${approval ?? ""}|${apprNo}|${neg ? "-" : "+"}`
            : `c|${approval ?? ""}|${merchant}|${amount ?? ""}|`,
        });
      }
    } else if (has("거래일시") && has("출금액")) {
      // ② corporate account transfers (이체내역서) — the accountant worksheet
      //   variant adds 상태/명칭/처리된 항목/기타 columns
      const bankEnriched = has("처리된 항목");
      const outKey = headers.find((h) => h.startsWith("출금액"))!;
      const inKey = headers.find((h) => h.startsWith("입금액"))!;
      const balKey = headers.find((h) => h.startsWith("잔액"));
      for (const r of sheetRows(ws, headerRow)) {
        const { date, time } = toDateTime(r["거래일시"]);
        if (!date) continue;
        const counterparty = clean(r["보낸분/받는분"] ?? r["내용"]);
        const withdrawal = toNumber(r[outKey]);
        const deposit = toNumber(r[inKey]);
        const balance = balKey ? toNumber(r[balKey]) : null;
        result.bank.push({
          enriched: bankEnriched,
          tx_date: date,
          tx_time: time,
          counterparty,
          deposit: deposit || null,
          withdrawal: withdrawal || null,
          balance,
          description: clean(r["적요"]),
          status: clean(r["상태"]),
          memo: clean(r["명칭"] ?? r["메모"]),
          category: clean(r["처리된 항목"]),
          tips_note: clean(r["기타"]),
          account_label: clean(r["처리점"]) || "KB",
          dedupe_key: `b|${date} ${time}|${counterparty}|${withdrawal ?? 0}|${deposit ?? 0}|${balance ?? ""}`,
        });
      }
    } else if (has("작성일자") && (has("공급가액") || has("합계금액"))) {
      // ③ Hometax e-tax-invoice list (best effort — refine with a real sample)
      const isSale = /매출/.test(file.name) || /매출/.test(name);
      for (const r of sheetRows(ws, headerRow)) {
        const issue = toDate(r["작성일자"]);
        if (!issue) continue;
        const counterparty = clean(isSale ? (r["공급받는자상호"] ?? r["상호"]) : (r["공급자상호"] ?? r["상호"]));
        const bizno = clean(isSale ? (r["공급받는자사업자등록번호"] ?? r["사업자등록번호"]) : (r["공급자사업자등록번호"] ?? r["사업자등록번호"]));
        const supply = toNumber(r["공급가액"]) ?? 0;
        const tax = toNumber(r["세액"]) ?? 0;
        const total = toNumber(r["합계금액"]) ?? supply + tax;
        result.invoices.push({
          direction: isSale ? "sale" : "purchase",
          issue_date: issue,
          counterparty_name: counterparty,
          counterparty_bizno: bizno,
          item: clean(r["품목명"] ?? r["품목"]),
          supply_amount: supply,
          tax_amount: tax,
          total_amount: total,
          dedupe_key: invoiceApprovalKey(clean(r["승인번호"])) ?? `i|${clean(r["승인번호"]) || `${issue}|${counterparty}|${total}`}`,
        });
      }
      if (!/매출|매입/.test(file.name + name)) {
        result.warnings.push(`"${name}": 매출/매입 구분을 파일명에서 찾지 못해 매입으로 처리했어요. 파일명에 '매출' 또는 '매입'을 포함해 주세요.`);
      }
    } else if (headers.length) {
      result.warnings.push(`"${name}" 시트는 인식하지 못했어요 (헤더: ${headers.slice(0, 6).join(", ")}…).`);
    }
  }

  // Month attribution differs by source:
  //  - RAW KB rows follow the billing cycle (9th of prev month → 8th of this
  //    month = this month's bill), per row.
  //  - The accountant WORKSHEET ("06월 결제예정금액조회") is already one
  //    managed bucket — its file name says which month, and its rows may
  //    deliberately span outside the strict cycle. Trust the file name.
  for (const c of result.cards) c.month = billingMonth(c.approval_date);
  const billFreq = new Map<string, number>();
  for (const c of result.cards) if (c.month) billFreq.set(c.month, (billFreq.get(c.month) ?? 0) + 1);
  let topBill: string | null = null;
  for (const [mm, n] of billFreq) if (topBill === null || n > (billFreq.get(topBill) ?? 0)) topBill = mm;

  const nameM = file.name.match(/(\d{1,2})\s*월/);
  let worksheetMonth: string | null = null;
  if (nameM) {
    // year = majority year among the row dates (a January sheet named "01월"
    // may carry December approvals, but the majority is still January's year)
    const yearFreq = new Map<string, number>();
    for (const d of [...result.cards.map((c) => c.approval_date), ...result.bank.map((b) => b.tx_date)]) {
      if (d) yearFreq.set(d.slice(0, 4), (yearFreq.get(d.slice(0, 4)) ?? 0) + 1);
    }
    let topYear: string | null = null;
    for (const [yy, n] of yearFreq) if (topYear === null || n > (yearFreq.get(topYear) ?? 0)) topYear = yy;
    if (topYear) worksheetMonth = `${topYear}-${nameM[1].padStart(2, "0")}`;
  }
  const enrichedMonth = worksheetMonth ?? topBill;
  if (enrichedMonth) for (const c of result.cards) if (c.enriched) c.month = enrichedMonth;
  result.month = (result.cards.some((c) => c.enriched) ? enrichedMonth : topBill)
    ?? topBill ?? guessMonth(result.bank.map((b) => b.tx_date));

  if (!result.cards.length && !result.bank.length && !result.invoices.length) {
    throw new Error("인식 가능한 시트가 없어요: 결제예정금액조회.xlsx 또는 홈택스 세금계산서 목록 파일을 올려주세요.");
  }
  return result;
}
