import * as XLSX from "xlsx";

/* RCMS "연구비 이체결과내역" 파서.
   RCMS → 연구비 사용 → 연구비 이체결과 → 과제·기간 선택 → 우측 상단 엑셀 다운로드.

   이 파일은 "어떤 지출이 TIPS 연구비로 나갔는지"를 알려주는 유일한 원천이다.
   통장에는 그냥 "사업체 입금"으로만 찍혀 목적을 알 수 없는데, 여기에는
   비목(직접비>연구활동비>출장비)과 지급용도(출장비(일비)_26.04.02 대표)가 들어 있다. */

export interface RcmsTransfer {
  /** 이체 실행일 (yyyy-mm-dd) — 통장 거래일과 맞춘다. */
  transferDate: string;
  /** 사용일자 (yyyy-mm-dd). */
  useDate: string;
  amount: number;
  /** "직접비>연구활동비>출장비" */
  budgetPath: string;
  /** "출장비(일비)_26.04.02 대표" — 사람이 읽는 목적. */
  purpose: string;
  /** "(국민은행) 사용자 계좌" — 받는 계좌. */
  account: string;
  vendor: string;
  /** "집행(이체) 완료" 등. */
  state: string;
  itemName: string;
}

export interface RcmsParseResult {
  rows: RcmsTransfer[];
  /** 과제번호 — 다른 과제 파일을 잘못 올렸는지 확인용. */
  projectNo: string;
  warnings: string[];
}

function clean(v: unknown): string {
  return v == null ? "" : String(v).replace(/\s+/g, " ").trim();
}

/** "2026.07.28 09:22:02" · "2026.07.28" · Date → "2026-07-28". */
function toDate(v: unknown): string {
  if (v instanceof Date) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
  }
  const s = clean(v);
  const m = s.match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  return m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : "";
}

function toNumber(v: unknown): number {
  if (typeof v === "number") return v;
  const n = Number(clean(v).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export function parseRcmsTransfers(buf: ArrayBuffer): RcmsParseResult {
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const grid = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
  const out: RcmsParseResult = { rows: [], projectNo: "", warnings: [] };
  if (!grid.length) {
    out.warnings.push("빈 파일입니다.");
    return out;
  }
  // 헤더가 줄바꿈을 포함해서(연구비\n구분) 공백을 지운 키로 찾는다
  const keyOf = (row: Record<string, unknown>, want: string) => {
    const k = Object.keys(row).find((x) => x.replace(/\s+/g, "") === want);
    return k ? row[k] : "";
  };
  for (const row of grid) {
    const amount = toNumber(keyOf(row, "사용금액"));
    const transferDate = toDate(keyOf(row, "이체일시"));
    if (!amount || !transferDate) continue;
    out.projectNo ||= clean(keyOf(row, "과제번호"));
    out.rows.push({
      transferDate,
      useDate: toDate(keyOf(row, "사용일자")),
      amount,
      budgetPath: clean(keyOf(row, "비목정보")),
      purpose: clean(keyOf(row, "지급용도")),
      account: clean(keyOf(row, "입금계좌")),
      vendor: clean(keyOf(row, "거래처명")),
      state: clean(keyOf(row, "이체상태")),
      itemName: clean(keyOf(row, "품목명")),
    });
  }
  if (!out.rows.length) out.warnings.push("이체 완료된 행을 찾지 못했습니다 · RCMS 연구비 이체결과 파일이 맞는지 확인하세요.");
  return out;
}

const shortPath = (p: string) => p.replace(/^직접비>|^간접비>/, "");

/** 통장 기타란에 넣을 한 줄.
    1건이면 "TIPS 연구비 · 연구활동비>출장비 · 출장비(일비)_26.04.02 대표",
    여러 건이 한 번에 입금됐으면 "TIPS 연구비 3건 합산 · … · … 외 2건". */
export function rcmsNote(ts: RcmsTransfer | RcmsTransfer[]): string {
  const list = Array.isArray(ts) ? ts : [ts];
  if (list.length === 1) {
    return ["TIPS 연구비", shortPath(list[0].budgetPath), list[0].purpose].filter(Boolean).join(" · ");
  }
  const paths = [...new Set(list.map((t) => shortPath(t.budgetPath)).filter(Boolean))];
  const first = list[0].purpose;
  return [
    `TIPS 연구비 ${list.length}건 합산`,
    paths.slice(0, 2).join(", ") + (paths.length > 2 ? " 외" : ""),
    first ? `${first}${list.length > 1 ? ` 외 ${list.length - 1}건` : ""}` : "",
  ].filter(Boolean).join(" · ");
}

/** 합계가 target과 정확히 같은 부분집합을 찾는다 (여러 건이 한 번에 입금된 경우).
    금액별로 도달 가능한 조합을 하나씩만 들고 가는 DP — 건수가 적어 충분히 빠르다.
    후보가 너무 많으면(계산 폭발) 포기하고 null을 돌려준다. */
export function findSubset<T extends { amount: number }>(target: number, items: T[]): T[] | null {
  if (target <= 0 || items.length === 0) return null;
  if (items.length > 24) return null;
  // sum → 그 합을 만드는 항목 인덱스들
  let reach = new Map<number, number[]>([[0, []]]);
  for (let i = 0; i < items.length; i++) {
    const amt = items[i].amount;
    if (amt <= 0) continue;
    const next = new Map(reach);
    for (const [sum, idxs] of reach) {
      const s2 = sum + amt;
      if (s2 > target || next.has(s2)) continue;
      const combo = [...idxs, i];
      if (s2 === target) return combo.map((j) => items[j]);
      next.set(s2, combo);
    }
    reach = next;
    if (reach.size > 200_000) return null;
  }
  return null;
}
