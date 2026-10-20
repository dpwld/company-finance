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
  if ((value && !/^\d+$/.test(value)) || !Number.isSafeInteger(amount) || amount < 0) throw new Error("Enter a whole-number budget of zero or more.");
  return amount;
}

export function MoneyBudget({ month, bank, cards, splits }: Props) {
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
    fetchBudgets().then((b) => { if (alive) { setBudget(b); setLoaded(true); } }).catch(() => { if (alive) setError("Could not load budgets. Refresh and try again."); });
    return () => { alive = false; };
  }, []);

  const totals = useMemo(() => moneyTotals(cards, bank, splits), [cards, bank, splits]);
  const actual = totals.byCategory;

  /* 예산을 잡은 카테고리를 먼저, 그다음 이 달에 쓴 카테고리를 금액 순으로. */
  const rows = useMemo(() => {
    const keys = [...new Set([...SPEND_CATEGORIES.map((c) => c.key), ...customCategories, ...Object.keys(budget), ...Object.keys(actual)])].filter(Boolean)
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
      setError("Some budgets could not be saved. Saved items are preserved; retry the remaining changes.");
    } finally { setSaving(false); }
  }

  return (
    <div className="money-grid">
      <section className="money-card">
        <div className="money-card-header">
          <h2>Monthly spending budget</h2>
          <span className="money-tag">{Number(month.slice(5, 7))} · Net card spending</span>
        </div>
        {totals.unknownAmountCount > 0 && <p className="money-note money-negative">KRW amount pending {totals.unknownAmountCount} records excluded from spending totals.</p>}
        {error && <p role="alert" className="money-note money-negative">{error}</p>}
        {rows.length === 0 ? <p className="money-empty">Create categories in Category rules before setting budgets.</p> : (
          <div className="money-table-wrap">
            <table>
              <thead>
                <tr><th>Category</th><th>Budget</th><th className="money-right">Spent</th><th className="money-right">Remaining budget</th></tr>
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
                        placeholder="Set budget"
                        disabled={saving || !loaded}
                        value={draft[r.key] ?? (r.plan ? String(r.plan) : "")}
                        onChange={(e) => { setDraft((d) => ({ ...d, [r.key]: e.target.value })); setSaved(false); }}
                        aria-label={`${r.label} Budget`}
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
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}><button type="button" className="money-primary" disabled={saving || !loaded} onClick={() => void commit()}>{saving ? "Saving…" : "Save budgets"}</button></div>
        {saved && <p role="status" className="money-trend">Budgets saved.</p>}
        <p className="money-note">
          Save budgets to your account. The same limits apply each month. Clear a value to remove its budget.
        </p>
      </section>

      <section className="money-card">
        <p className="money-label">LEFT TO SPEND</p>
        <div className="money-card-header"><h2>Remaining budget</h2></div>
        {planTotal === 0 ? (
          <Ring ratio={0} label="—" sub="Set a budget" />
        ) : (
          <Ring
            ratio={usedTotal / planTotal}
            label={wonFmt(planTotal - usedTotal)}
            sub={planTotal - usedTotal >= 0 ? "remaining" : "over budget"}
          />
        )}
        <div className="money-summary-row"><span className="money-muted">Budgeted</span><span style={{ fontWeight: 650 }}>{wonFmt(planTotal)}</span></div>
        <div className="money-summary-row"><span className="money-muted">Spent this month</span><span style={{ fontWeight: 650 }}>{wonFmt(usedTotal)}</span></div>
        <p className="money-note">Based on net card spending, including uncategorized records. Bank withdrawals are counted separately.</p>
      </section>
    </div>
  );
}
