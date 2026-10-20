
/* Spending 탭 (Rocket Money 벤치마크) — 거래별 지출 카테고리 체계와 월 집계.
   카테고리 키는 DB(spend_category)에 영문으로 저장, 라벨은 한국어.
   특수 키: income(수입) / internal(내부이체) / card_payment(카드대금) —
   지출 집계에서 제외해 이중계산을 막는다. */

export interface SpendCategory {
  key: string;
  label: string;
  emoji: string;
  /** 도넛/아이콘 파스텔 색상 (고정 hue). */
  hue: number;
}

export const SPEND_CATEGORIES: SpendCategory[] = [
  { key: "payroll", label: "급여", emoji: "💰", hue: 45 },
  { key: "equipment", label: "장비·자재", emoji: "🔧", hue: 20 },
  { key: "software", label: "소프트웨어·IT", emoji: "💻", hue: 210 },
  { key: "office", label: "사무실·임차료", emoji: "🏢", hue: 260 },
  { key: "supplies", label: "사무용품·소모품", emoji: "📎", hue: 90 },
  { key: "dining", label: "식대·회식", emoji: "🍽️", hue: 350 },
  { key: "travel", label: "출장·교통", emoji: "✈️", hue: 190 },
  { key: "marketing", label: "마케팅", emoji: "📣", hue: 300 },
  { key: "legal", label: "법률·전문서비스", emoji: "⚖️", hue: 230 },
  { key: "fees", label: "수수료·이자", emoji: "🧾", hue: 30 },
  { key: "taxes", label: "세금·공과금", emoji: "🏛️", hue: 150 },
  { key: "welfare", label: "보험·복리후생", emoji: "🩺", hue: 120 },
  { key: "etc", label: "기타", emoji: "♾️", hue: 0 },
];

/** 지출 집계에서 제외되는 특수 분류. */
export const SPECIAL_CATEGORIES = [
  { key: "income", label: "수입" },
  { key: "internal", label: "내부이체 (제외)" },
  { key: "card_payment", label: "카드대금 (제외)" },
];

/* TIPS 지원금은 카테고리가 아니라 거래별 체크 플래그(tips_funded 컬럼)다 —
   거래는 급여·장비 같은 원래 카테고리를 유지한 채 체크만 되면 지출 집계에서
   빠지고, Non-spending의 지원금 집행 폴더 안에 카테고리별로 모인다.
   (2026-10-01 재설계 — 과거 spend_category='tips_funded' 데이터도 호환 처리) */
export const LEGACY_TIPS_KEY = "tips_funded";

export const ALL_CATEGORY_KEYS = [...SPEND_CATEGORIES.map((c) => c.key), ...SPECIAL_CATEGORIES.map((c) => c.key)];

/** 분류 셀렉트 공용 옵션 (Spending·Transactions·TIPS 탭 공유). */
export const SPEND_CATEGORY_OPTIONS = [
  { value: "", label: "미분류" },
  ...SPEND_CATEGORIES.map((c) => ({ value: c.key, label: `${c.emoji} ${c.label}` })),
  ...SPECIAL_CATEGORIES.map((c) => ({ value: c.key, label: c.label })),
];

export const spendCategoryLabel = (key: string): string =>
  key.startsWith("custom:") ? key.slice(7) : key === "tips_refund" ? "TIPS 환급 차감" : key === LEGACY_TIPS_KEY
    ? "TIPS 지원금"
    : SPEND_CATEGORIES.find((c) => c.key === key)?.label ?? SPECIAL_CATEGORIES.find((c) => c.key === key)?.label ?? "미분류";

export const spendCategory = (key: string): SpendCategory | undefined => SPEND_CATEGORIES.find((c) => c.key === key);

export const catColor = (hue: number, l = 60) => `hsl(0 0% ${Math.max(20, Math.min(80, l - 25 + hue / 10))}%)`;
export const catSoft = (hue: number) => `hsl(0 0% 94%)`;

/** month(yyyy-mm) 기준 최근 n개월 목록 (과거→현재). */
export function recentMonths(month: string, n: number): string[] {
  const [y, m] = month.split("-").map(Number);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(y, m - 1 - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

export interface SpendTotals {
  /** 카테고리 키 → 지출 합계 (특수 키·미분류 제외). */
  byCategory: Record<string, number>;
  /** 분류 안 된 지출 합계. */
  uncategorized: number;
  /** 전체 지출 (byCategory + uncategorized). */
  spending: number;
  /** 은행 입금 중 income으로 분류된 합 (미분류 입금 포함). */
  income: number;
  /** Non-spending: 내부이체(입+출) / 카드대금 출금 / TIPS 지원금 집행·입금 합계. */
  internalTotal: number;
  cardPaymentTotal: number;
  tipsFundedTotal: number;
  /** TIPS 집행의 원래 카테고리별 소계 — 지원금 집행 폴더 안에서 급여·장비 등으로 묶어 보여준다. */
  tipsByCategory: Record<string, number>;
  /** TIPS 지원금이 통장에 들어온 금액 (TIPARCMS 등) — 수입이 아니라 지원금 흐름. */
  tipsIncomeTotal: number;
  unknownAmountCount: number;
  invalidSplitCount: number;
}

interface CardLike { id?: string; status: string; amount: number | null; spendCategory: string; tipsFunded?: boolean }
interface SplitLike { cardChargeId: string; bankTxId?: string; amount: number; spendCategory: string; tipsFunded?: boolean }
interface BankLike { id?: string; deposit: number | null; withdrawal: number | null; spendCategory: string; tipsFunded?: boolean }

/** 카드 지출 = 승인 금액(취소 제외), 은행 지출 = 출금 중 특수 분류 제외.
   전체 타입(CardCharge/BankTx)과 시리즈 경량 행 둘 다 받는다(구조적 서브셋). */
export function computeTotals(cards: CardLike[], bank: BankLike[], splits: SplitLike[] = []): SpendTotals {
  const splitsByCharge = new Map<string, SplitLike[]>();
  const splitsByBank = new Map<string, SplitLike[]>();
  for (const sp of splits) {
    if (sp.cardChargeId) {
      const list = splitsByCharge.get(sp.cardChargeId) ?? [];
      list.push(sp);
      splitsByCharge.set(sp.cardChargeId, list);
    } else if (sp.bankTxId) {
      const list = splitsByBank.get(sp.bankTxId) ?? [];
      list.push(sp);
      splitsByBank.set(sp.bankTxId, list);
    }
  }
  const byCategory: Record<string, number> = {};
  let uncategorized = 0;
  let income = 0;
  let internalTotal = 0;
  let cardPaymentTotal = 0;
  let tipsFundedTotal = 0;
  let tipsIncomeTotal = 0;
  const tipsByCategory: Record<string, number> = {};
  let unknownAmountCount = 0;
  let invalidSplitCount = 0;

  const validSplits = (parts: SplitLike[] | undefined, amount: number | null) => {
    if (!parts?.length) return false;
    const valid = amount != null && parts.every((s) => Number.isFinite(s.amount)) &&
      Math.abs(parts.reduce((sum, s) => sum + s.amount, 0) - amount) < 0.01;
    if (!valid) invalidSplitCount++;
    return valid;
  };

  const addSpend = (key: string, amount: number, tips?: boolean) => {
    if (!amount) return;
    if (tips || key === LEGACY_TIPS_KEY) {
      // TIPS 지원금 집행: 지출에서 빼고 원래 카테고리별로 따로 모은다.
      const realKey = key === LEGACY_TIPS_KEY ? "" : key;
      tipsFundedTotal += amount;
      tipsByCategory[realKey] = (tipsByCategory[realKey] ?? 0) + amount;
      return;
    }
    if (key === "income" || key === "internal" || key === "card_payment") return;
    if (!key) uncategorized += amount;
    else byCategory[key] = (byCategory[key] ?? 0) + amount;
  };

  for (const c of cards) {
    if ((c.status || "").includes("취소") && (c.amount == null || c.amount >= 0)) continue;
    if (c.amount == null) unknownAmountCount++;
    const mySplits = c.id ? splitsByCharge.get(c.id) : undefined;
    if (validSplits(mySplits, c.amount)) {
      // 분할된 거래: 원거래 대신 분할 줄로 집계 (합계는 동일)
      for (const sp of mySplits!) addSpend(sp.spendCategory, sp.amount, sp.tipsFunded);
    } else {
      addSpend(c.spendCategory, c.amount ?? 0, c.tipsFunded);
    }
  }
  for (const b of bank) {
    if (b.withdrawal) {
      // 분할된 이체: 원거래 대신 분할 줄로 집계 (합계는 동일)
      const mySplits = b.id ? splitsByBank.get(b.id) : undefined;
      if (validSplits(mySplits, b.withdrawal) && b.spendCategory !== "internal" && b.spendCategory !== "card_payment") {
        for (const sp of mySplits!) addSpend(sp.spendCategory, sp.amount, sp.tipsFunded);
      } else {
        addSpend(b.spendCategory, b.withdrawal, b.tipsFunded);
      }
      if (!b.tipsFunded && b.spendCategory === "internal") internalTotal += b.withdrawal;
      if (!b.tipsFunded && b.spendCategory === "card_payment") cardPaymentTotal += b.withdrawal;
    }
    if (b.deposit) {
      // 입금: TIPS 지원금(체크 or 레거시 키)·내부이체는 수입이 아니다.
      // 나머지(미분류 포함)만 회사 수입으로 집계한다.
      if (b.tipsFunded || b.spendCategory === LEGACY_TIPS_KEY) tipsIncomeTotal += b.deposit;
      else if (b.spendCategory === "internal") internalTotal += b.deposit;
      else income += b.deposit;
    }
  }
  const spending = uncategorized + Object.values(byCategory).reduce((a, v) => a + v, 0);
  return { byCategory, uncategorized, spending, income, internalTotal, cardPaymentTotal, tipsFundedTotal, tipsByCategory, tipsIncomeTotal, unknownAmountCount, invalidSplitCount };
}

export const wonFmt = (n: number) => `₩${Math.round(n).toLocaleString()}`;

/** yyyy-mm의 전월. */
export function prevMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
