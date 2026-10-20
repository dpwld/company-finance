"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchBudgets, fetchMoneyCategories, saveBudget, type BankTx, type CardCharge, type ChargeSplit } from "@/lib/data/finance";
import { SPEND_CATEGORIES, catColor, spendCategoryLabel, wonFmt } from "@/lib/finance/spend";

import { moneyTotals } from "@/lib/finance/money";

/* 예산 — 시안의 "예산" 화면.
   왼쪽: 카테고리 / 예산(입력) / 사용액 / 남은 예산 표
   오른쪽: LEFT TO SPEND 링 + 설정한 예산·카드 사용
   예산은 finance_budgets 테이블에 카테고리당 한 줄로 저장한다(매달 같은 기준). */

interface Props {
  month: string;
  bank: BankTx[];
  cards: CardCharge[];
  splits: ChargeSplit[];
  tipsExcluded: boolean;
}

/** 남은 예산 링 — 쓴 비율만큼 채운다. */
function Ring({ ratio, label, sub }: { ratio: number; label: string; sub: string }) {
  const pct = Math.max(0, Math.min(1, ratio));
  const over = ratio > 1;
  const color = over ? "#5d5d5d" : "#616161";
  return (
    <div className="money-donut-layout">
      <div className="money-donut" role="img" aria-label={`${label} ${sub}`}
        style={{ background: `conic-gradient(${color} 0deg ${(pct * 360).toFixed(1)}deg, #eeeeee ${(pct * 360).toFixed(1)}deg 360deg)` }}>
        <div className="money-donut-center">
          <span className="money-sub">{sub}</span>
          <strong style={over ? { color } : undefined}>{label}</strong>
        </div>
      </div>
    </div>
  );
}

export function parseBudgetAmount(raw: string): number {
  const value = raw.trim();
  const amount = value ? Number(value) : 0;
  if ((value && !/^\d+$/.test(value)) || !Number.isSafeInteger(amount) || amount < 0) throw new Error("예산은 0 이상의 정수 금액으로 입력하세요.");
  return amount;
}

export function MoneyBudget({ month, bank, cards, splits, tipsExcluded }: Props) {
  const [customCategories, setCustomCategories] = useState<string[]>([]);
  const [budget, setBudget] = useState<Record<string, number>>({});
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchMoneyCategories().then((keys) => { if (alive) setCustomCategories(keys); }).catch(() => {});
    fetchBudgets().then((b) => { if (alive) { setBudget(b); setLoaded(true); } }).catch(() => { if (alive) setError("저장된 예산을 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요."); });
    return () => { alive = false; };
  }, []);

  const totals = useMemo(() => moneyTotals(cards, bank, tipsExcluded, splits), [cards, bank, tipsExcluded, splits]);
  const actual = totals.byCategory;

  /* 예산을 잡은 카테고리를 먼저, 그다음 이 달에 쓴 카테고리를 금액 순으로. */
  const rows = useMemo(() => {
    const keys = [...new Set([...SPEND_CATEGORIES.map((c) => c.key), ...customCategories, ...Object.keys(budget), ...Object.keys(actual)])].filter((key) => key !== "tips_refund")
      .sort((a, b) => (budget[b] ?? 0) - (budget[a] ?? 0) || (actual[b] ?? 0) - (actual[a] ?? 0));
    return keys.map((key) => {
      const cat = SPEND_CATEGORIES.find((c) => c.key === key);
      const plan = budget[key] ?? 0;
      const used = actual[key] ?? 0;
      return { key, label: spendCategoryLabel(key), color: catColor(cat?.hue ?? 0), plan, used, left: plan - used };
    });
  }, [budget, actual, customCategories]);

  const planTotal = Object.values(budget).reduce((a, v) => a + v, 0);
  const usedTotal = totals.spending;

  async function commit() {
    setError(null); setSaved(false);
    let changes: [string, number][];
    try { changes = Object.entries(draft).map(([key, raw]) => [key, parseBudgetAmount(raw)]); }
    catch (err) { setError((err as Error).message); return; }
    setSaving(true);
    try {
      for (const [key, amount] of changes) {
        if (amount !== (budget[key] ?? 0)) await saveBudget(key, amount);
        setBudget((previous) => { const next = { ...previous }; if (amount) next[key] = amount; else delete next[key]; return next; });
        setDraft((previous) => { const next = { ...previous }; delete next[key]; return next; });
      }
      setSaved(true);
    } catch {
      setError("저장하지 못한 예산이 있습니다. 완료된 항목은 유지되며 남은 입력을 다시 저장할 수 있습니다.");
    } finally { setSaving(false); }
  }

  return (
    <div className="money-grid">
      <section className="money-card">
        <div className="money-card-header">
          <h2>월 지출 예산</h2>
          <span className="money-tag">{Number(month.slice(5, 7))}월 · {tipsExcluded ? "자체 부담액" : "카드 순사용액"}</span>
        </div>
        {totals.unknownAmountCount > 0 && <p className="money-note money-negative">원화 미확정 {totals.unknownAmountCount}건은 사용액에 포함되지 않았습니다.</p>}
        {error && <p role="alert" className="money-note money-negative">{error}</p>}
        {rows.length === 0 ? <p className="money-empty">이 달에 분류된 지출이 없습니다.</p> : (
          <div className="money-table-wrap">
            <table>
              <thead>
                <tr><th>카테고리</th><th>예산</th><th className="money-right">사용액</th><th className="money-right">남은 예산</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} style={{ cursor: "default" }}>
                    <td><i className="money-dot" style={{ background: r.color }} />{r.label}</td>
                    <td>
                      <input
                        className="money-budget-input"
                        type="number" min="0" step="10000"
                        inputMode="numeric"
                        placeholder="설정하기"
                        disabled={saving || !loaded}
                        value={draft[r.key] ?? (r.plan ? String(r.plan) : "")}
                        onChange={(e) => { setDraft((d) => ({ ...d, [r.key]: e.target.value })); setSaved(false); }}
                        aria-label={`${r.label} 예산`}
                      />
                    </td>
                    <td className="money-right">{wonFmt(r.used)}</td>
                    <td className={`money-right${r.plan && r.left < 0 ? " money-negative" : ""}`}>
                      {r.plan ? wonFmt(r.left) : <span className="money-muted">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}><button type="button" className="money-primary" disabled={saving || !loaded} onClick={() => void commit()}>{saving ? "저장 중…" : "예산 저장"}</button></div>
        {saved && <p role="status" className="money-trend">예산을 저장했습니다.</p>}
        <p className="money-note">
          예산 저장을 누르면 계정에 저장됩니다. 예산은 매달 같은 기준으로 쓰이고, 비우면 설정이 지워집니다.
        </p>
      </section>

      <section className="money-card">
        <p className="money-label">LEFT TO SPEND</p>
        <div className="money-card-header"><h2>남은 예산</h2></div>
        {planTotal === 0 ? (
          <Ring ratio={0} label="—" sub="예산을 설정하세요" />
        ) : (
          <Ring
            ratio={usedTotal / planTotal}
            label={wonFmt(planTotal - usedTotal)}
            sub={planTotal - usedTotal >= 0 ? "남음" : "초과"}
          />
        )}
        <div className="money-summary-row"><span className="money-muted">설정한 예산</span><span style={{ fontWeight: 650 }}>{wonFmt(planTotal)}</span></div>
        <div className="money-summary-row"><span className="money-muted">이 달 지출</span><span style={{ fontWeight: 650 }}>{wonFmt(usedTotal)}</span></div>
        <p className="money-note">선택한 기준의 전체 지출을 반영합니다. 미분류도 포함하며 확인된 TIPS 환급은 전체 부담액에서 차감합니다.</p>
      </section>
    </div>
  );
}
