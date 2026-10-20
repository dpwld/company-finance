/** Deterministic date/name matcher. Aliases are supplied by the current user. */
let MERCHANT_ALIASES: [string, string][] = [];
const merchantText = (value: string) => value.normalize("NFC").toLowerCase().replace(/[\s()（）,*'"._-]+/g, "");
export function configureMerchantAliases(value: [string, string][]) { MERCHANT_ALIASES = value.filter(pair => pair.length === 2 && pair.every(item => typeof item === "string" && item.trim())).map(([from,to]) => [merchantText(from), merchantText(to)]); }

export function normalizeMerchant(s: string): string {
  // macOS에서 올라온 파일명은 NFD(자소 분리)라 한글 정규식이 걸리지 않는다.
  const lower = s.normalize("NFC").toLowerCase().replace(/[\s()（）,*'"._-]+/g, "");
  for (const [name, canon] of MERCHANT_ALIASES) if (lower.includes(name)) return canon;
  return lower;
}

/** A matchable outgoing row — card charge or bank withdrawal. */
export interface SpendCandidate {
  id: string;
  kind: "card" | "bank";
  /** yyyy-mm-dd */
  date: string | null;
  /** merchant (card) or counterparty (bank) */
  name: string;
}

/** 파일명이 가리킬 수 있는 달 — 조회 중인 달과 그 앞뒤 달.
   카드 이용기간이 당월 9일~익월 8일이라 익월 초(1~8일) 날짜도 이 장부에
   속하고, 반대로 전월 9~31일 날짜도 속한다. 앞에 있는 것부터 맞춰 보므로
   "0907" 같은 MMDD는 조회 중인 달로 먼저 읽힌다. */
function candidateMonths(month: string): { y: string; m: string }[] {
  const [y, m] = month.split("-").map(Number);
  const prevY = m === 1 ? y - 1 : y;
  const prevM = m === 1 ? 12 : m - 1;
  const nextY = m === 12 ? y + 1 : y;
  const nextM = m === 12 ? 1 : m + 1;
  return [
    { y: String(y), m: String(m).padStart(2, "0") },
    { y: String(prevY), m: String(prevM).padStart(2, "0") },
    { y: String(nextY), m: String(nextM).padStart(2, "0") },
  ];
}

/** Dates ("yyyy-mm-dd") referenced by a filename, given the ledger month. */
export function datesFromFilename(name: string, month: string): string[] {
  const months = candidateMonths(month);
  const base = name.normalize("NFC").replace(/\.[^.]+$/, "");
  const dates = new Set<string>();

  // leading YYMMDD (260617) or MMDD (0608) — this month or the previous one
  let rest = base;
  let ym: { y: string; m: string } | null = null;
  let mm = base.match(/^(\d{2})(\d{2})(\d{2})[_\s-]?/);
  if (mm) {
    const hit = months.find((c) => `20${mm![1]}` === c.y && mm![2] === c.m);
    if (hit) {
      dates.add(`${hit.y}-${mm[2]}-${mm[3]}`);
      ym = hit;
      rest = base.slice(mm[0].length);
    }
  }
  if (!ym) {
    mm = base.match(/^(\d{2})(\d{2})[_\s-]?/);
    if (mm) {
      const hit = months.find((c) => mm![1] === c.m);
      if (hit) {
        dates.add(`${hit.y}-${hit.m}-${mm[2]}`);
        ym = hit;
        rest = base.slice(mm[0].length);
      }
    }
  }

  // embedded day list/ranges like "11~12,15,16,22~26,29일" — the days belong
  // to the prefix month when one matched, else the ledger month
  const listYm = ym ?? months[0];
  const listM = rest.match(/(\d{1,2}(?:~\d{1,2})?(?:,\d{1,2}(?:~\d{1,2})?)+)일?/);
  if (listM) {
    for (const part of listM[1].split(",")) {
      const r = part.split("~").map(Number);
      const [a, b] = r.length === 2 ? r : [r[0], r[0]];
      for (let d = a; d <= b && d <= 31; d++) dates.add(`${listYm.y}-${listYm.m}-${String(d).padStart(2, "0")}`);
    }
  }
  return [...dates];
}

/** The merchant-ish token of a filename (text between the date prefix and the
   doc-kind suffix like 영수증/주문내역/Receipt/invoice). Parenthesised text is
   a description, not the merchant — "쿠팡(공기청정기,제습기)" → "쿠팡". */
export function merchantTokenFromFilename(name: string): string {
  const full = name.normalize("NFC").replace(/\.[^.]+$/, "");
  // 괄호 안이 설명이 아니라 업체명인 경우가 있다 — "0720_3D프린팅(AMKorea)_견적서".
  // 별칭은 토큰 → 괄호 안 → 파일명 전체 순으로 확인해, 앞쪽에서 걸리면 그 값을 쓴다.
  const parenText = (full.match(/[（(]([^）)]*)[）)]/g) ?? []).join(" ");

  let base = full;
  base = base.replace(/^(\d{6}|\d{4})[_\s-]?/, "");
  base = base.replace(/[（(][^）)]*[）)]/g, "");
  base = base.replace(/(\d{1,2}(?:~\d{1,2})?(?:,\d{1,2}(?:~\d{1,2})?)+)일?/, "");
  base = base.split(/[_\s]/)[0] ?? base;
  base = base.replace(
    /영수증|수납영수증|카드영수증|신용카드영수증|결제영수증|주문내역서|주문내역|주문상세정보|주문상세|결제정보|수료증|이체확인증|자동이체확인증|확인증|이체증|세금계산서|전자세금계산서|거래명세표|거래명세서|매출전표|결제내역|결제확인|납부확인|납부정보|상세내역|관리비고지서|부과총괄표|관리비|견적서|최종견적서|사업자등록증|통장사본|신청내역|신청서|접수증|교육과정|제품사진|사진\d*|사용량|사용화면|증빙\d*|메일내용|메일요청내용|receipt|invoice|license|payment|email/gi,
    "",
  );
  const token = normalizeMerchant(base);
  if (aliasOf(token)) return token;
  // 토큰이 업체로 안 읽히면 괄호 안·파일명 전체에서 아는 업체를 찾아본다
  for (const text of [parenText, full]) {
    const canon = aliasOf(normalizeMerchant(text));
    if (canon) return canon;
  }
  return token;
}

/** 정규화된 문자열이 별칭에 걸리면 대표값, 아니면 null. */
function aliasOf(normalized: string): string | null {
  if (!normalized) return null;
  for (const [name, canon] of MERCHANT_ALIASES) if (normalized.includes(name)) return canon;
  return null;
}

export interface NameMatch {
  fileName: string;
  /** confident: date + merchant both agree */
  auto: { id: string; kind: "card" | "bank" }[];
  /** date agrees but merchant unclear (single candidate that day) */
  suggested: { id: string; kind: "card" | "bank" }[];
}

export function matchByName(fileName: string, month: string, candidates: SpendCandidate[]): NameMatch {
  const dates = datesFromFilename(fileName, month);
  const token = merchantTokenFromFilename(fileName);
  const out: NameMatch = { fileName, auto: [], suggested: [] };
  if (!dates.length) return out;

  const onDates = candidates.filter((c) => c.date && dates.includes(c.date));
  if (!onDates.length) return out;

  const merchantHits = token
    ? onDates.filter((c) => {
        const cm = normalizeMerchant(c.name);
        return (cm && (cm.includes(token) || token.includes(cm))) || sharesChunk(token, cm);
      })
    : [];

  if (merchantHits.length === 1) {
    out.auto = merchantHits.map((c) => ({ id: c.id, kind: c.kind }));
  } else if (merchantHits.length > 1) {
    out.suggested = merchantHits.map((c) => ({ id: c.id, kind: c.kind }));
  } else if (onDates.length === 1) {
    // Date-only suggestion — but not when the filename names a clearly
    // DIFFERENT merchant (a receipt issued a day after its approval otherwise
    // gets pinned to whatever else happened that day).
    const only = onDates[0];
    if (!token) out.suggested = [{ id: only.id, kind: only.kind }];
  }
  return out;
}

/** Any common 3-char run between the two normalized names. */
function sharesChunk(a: string, b: string): boolean {
  if (a.length < 3 || b.length < 3) return false;
  for (let i = 0; i <= a.length - 3; i++) if (b.includes(a.slice(i, i + 3))) return true;
  return false;
}

/**
 * 파일명 앞머리의 날짜로 이 증빙이 속한 "장부 달"을 정한다 (YYYY-MM).
 * 장부는 카드 이용기간(당월 9일~익월 8일) 단위이므로, 날짜가 8일 이하면
 * 전달 장부에 속한다. 예: "1007…"은 10월이 아니라 2026-09 장부다.
 * 연도 표기가 없으면 조회 중인 달에 가장 가까운 해로 읽는다(12월↔1월 경계).
 * 날짜로 안 읽히면 null — 호출부가 조회 중인 달을 그대로 쓴다.
 */
export function monthFromFileName(name: string, viewedMonth: string): string | null {
  const base = name.normalize("NFC").replace(/\.[^.]+$/, "");
  let y: number;
  let mo: number;
  let d: number;

  const ymd = base.match(/^(\d{2})(\d{2})(\d{2})(?=\D|$)/);
  if (ymd) {
    y = 2000 + Number(ymd[1]);
    mo = Number(ymd[2]);
    d = Number(ymd[3]);
  } else {
    const md = base.match(/^(\d{2})(\d{2})(?=\D|$)/);
    if (!md) return null;
    mo = Number(md[1]);
    d = Number(md[2]);
    const [viewYear, viewMonth] = viewedMonth.split("-").map(Number);
    if (!viewYear || !viewMonth) return null;
    let best = viewYear;
    let bestGap = Infinity;
    for (const year of [viewYear - 1, viewYear, viewYear + 1]) {
      const gap = Math.abs(year * 12 + mo - (viewYear * 12 + viewMonth));
      if (gap < bestGap) { bestGap = gap; best = year; }
    }
    y = best;
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;

  // 이용기간이 당월 9일에 시작하므로 1~8일은 앞 달 장부로 돌린다.
  if (d <= 8) {
    mo -= 1;
    if (mo === 0) { mo = 12; y -= 1; }
  }
  return `${y}-${String(mo).padStart(2, "0")}`;
}
