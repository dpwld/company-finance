export interface SpendCategory {
  key: string;
  label: string;
  emoji: string;
  /** 도넛/아이콘 파스텔 색상 (고정 hue). */
  hue: number;
}

export const SPEND_CATEGORIES: SpendCategory[] = [];
export const SPEND_CATEGORY_OPTIONS = [{ value: "", label: "미분류" }];
export const spendCategoryLabel = (key: string): string => key.startsWith("custom:") ? key.slice(7) : "미분류";
export const spendCategory = (key: string): SpendCategory | undefined => key.startsWith("custom:") ? { key, label: spendCategoryLabel(key), emoji: "●", hue: [...key].reduce((a,c) => a+c.charCodeAt(0),0)%300 } : undefined;
export const catColor = (hue: number, l = 60) => `hsl(0 0% ${Math.max(20, Math.min(80, l - 25 + hue / 10))}%)`;
export const catSoft = (_hue: number) => `hsl(0 0% 94%)`;

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

export const wonFmt = (n: number) => `₩${Math.round(n).toLocaleString()}`;

/** yyyy-mm의 전월. */
export function prevMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
