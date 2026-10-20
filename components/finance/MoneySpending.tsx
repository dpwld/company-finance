"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchMoneyHistory, type BankTx, type CardCharge, type ChargeSplit } from "@/lib/data/finance";
import { catColor, recentMonths, spendCategory, spendCategoryLabel, wonFmt } from "@/lib/finance/spend";
import { moneyCardDate, moneyEntries, moneyTotals } from "@/lib/finance/money";
import type { MoneyTransactionFilters, MoneyTransactionTarget } from "@/lib/finance/transactions";
import { MoneyFrequentMerchants, MoneyNeedsCategory, MoneySummary } from "./MoneySummaryCards";
import { MoneyDonut, MoneyMonthBars } from "./MoneyCharts";
import { shiftMonth } from "./shared";

/* 지출 분석 — 시안의 "지출 분석" 화면.
   왼쪽: 최근 6개월 막대 · 카테고리 도넛 · 카테고리 표(비중·전월 대비·금액)
   오른쪽: 이 달 요약 · 자주 사용한 가맹점 · 큰 지출 */

interface Props {
  month: string;
  bank: BankTx[];
  cards: CardCharge[];
  splits: ChargeSplit[];

  onMonthChange: (month: string) => void;
  onTransactions: (filters: MoneyTransactionFilters) => void;
  onOpenTransaction: (target: MoneyTransactionTarget) => void;
}

export function MoneySpending({ month, bank, cards, splits, onMonthChange, onTransactions, onOpenTransaction }: Props) {
  /* 막대 그래프가 보는 6개월 창. 조회 월과 따로 논다 — 화살표로 작년까지
     거슬러 보되 화면의 조회 월은 그대로 둔다. 조회 월이 바뀌면 창도 따라간다. */
  const [shift, setShift] = useState({ month, offset: 0 });
  const offset = shift.month === month ? shift.offset : 0;
  const months = useMemo(() => recentMonths(shiftMonth(month, -offset), 6), [month, offset]);
  const [series, setSeries] = useState<{ month: string; amount: number }[] | null>(null);
  const [prevByCat, setPrevByCat] = useState<Record<string, number>>({});

  useEffect(() => {
    let alive = true;
    fetchMoneyHistory(months)
      .then((s) => {
        if (!alive) return;
        setSeries(months.map((m) => {
          const t = moneyTotals(s.cards.filter((x) => moneyCardDate(x).slice(0, 7) === m || (!moneyCardDate(x) && x.month === m)), s.bank.filter((x) => x.txDate.startsWith(m)), splits);
          return { month: m, amount: t.spending };
        }));
      })
      .catch(() => { if (alive) setSeries([]); });
    return () => { alive = false; };
  }, [months, splits]);

  /* 전월 대비는 막대 창과 무관하게 '보고 있는 달의 전월'과 비교한다. */
  useEffect(() => {
    let alive = true;
    const prev = shiftMonth(month, -1);
    fetchMoneyHistory([prev])
      .then((s) => {
        if (!alive) return;
        setPrevByCat(moneyTotals(s.cards, s.bank, splits).byCategory);
      })
      .catch(() => { if (alive) setPrevByCat({}); });
    return () => { alive = false; };
  }, [month, splits]);

  const totals = useMemo(() => moneyTotals(cards, bank, splits), [cards, bank, splits]);
  const spent = totals.spending;

  const rows = useMemo(() => {
    const entries = Object.entries(totals.byCategory).sort((a, b) => b[1] - a[1]);
    return entries.map(([key, amount]) => {
      const cat = spendCategory(key);
      const before = prevByCat[key] ?? 0;
      return {
        key,
        label: spendCategoryLabel(key),
        color: cat ? catColor(cat.hue) : "#c7c7c7",
        amount,
        share: Object.values(totals.byCategory).reduce((sum, n) => sum + Math.max(0, n), 0) ? Math.max(0, amount) / Object.values(totals.byCategory).reduce((sum, n) => sum + Math.max(0, n), 0) * 100 : 0,
        diff: amount - before,
        hadBefore: before > 0,
      };
    });
  }, [totals, prevByCat]);

  /* 큰 지출 — 카드·통장 출금을 통틀어 금액 순. */
  const largest = useMemo(() => {
    return moneyEntries(cards, bank).filter((row) => (row.amount ?? 0) > 0)
      .sort((a, b) => b.amount! - a.amount!).slice(0, 3)
      .map((row) => ({ ...row, key: `${row.kind}${row.id}`, amount: row.amount!, cat: row.category, type: row.kind === "card" ? "Card spending" : "Bank withdrawals" }));
  }, [cards, bank]);

  return (
    <div className="money-grid">
      <div className="money-stack">
        <section className="money-card">
          <div className="money-card-header">
            <h2>6-month spending</h2>
            <span className="money-month">
              <button type="button" aria-label="Previous 6 months"
                onClick={() => setShift({ month, offset: offset + 6 })}>‹</button>
              <span className="money-sub" style={{ minWidth: 128, textAlign: "center" }}>
                {months[0].replace("-", ".")} ~ {months[months.length - 1].replace("-", ".")}
              </span>
              <button type="button" aria-label="Next 6 months" disabled={offset === 0}
                onClick={() => setShift({ month, offset: Math.max(0, offset - 6) })}>›</button>
            </span>
          </div>
          {series === null ? <p className="money-empty">Loading…</p>
            : <MoneyMonthBars data={series} month={month} onPick={onMonthChange} />}

          <MoneyDonut
            total={spent}
            slices={rows.map((r) => ({ key: r.key, label: r.label, value: r.amount, color: r.color }))}
          />

          {rows.length === 0 ? <p className="money-empty">No categorized spending yet.</p> : (
            <div className="money-table-wrap">
              <table>
                <thead>
                  <tr><th>Category</th><th>Share</th><th>vs. last month</th><th className="money-right">Amount</th></tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.key} tabIndex={0} role="button" aria-label={`${r.label} View transactions`} onClick={() => onTransactions({ category: r.key || "uncategorized" })} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onTransactions({ category: r.key || "uncategorized" }); } }}>
                      <td><i className="money-dot" style={{ background: r.color }} />{r.label}</td>
                      <td className="money-muted">{r.share.toFixed(1)}%</td>
                      <td className={r.diff > 0 ? "money-negative" : "money-trend"}>
                        {!r.hadBefore ? "New" : r.diff === 0 ? "—" : `${r.diff > 0 ? "+" : "−"}${wonFmt(Math.abs(r.diff))}`}
                      </td>
                      <td className="money-right" style={{ fontWeight: 650 }}>{wonFmt(r.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <div className="money-stack">
        <MoneyNeedsCategory bank={bank} cards={cards} onReview={() => onTransactions({ category: "uncategorized" })} />
        <MoneySummary bank={bank} cards={cards} splits={splits} />
        <MoneyFrequentMerchants bank={bank} cards={cards} onMerchant={(query) => onTransactions({ range: "all", query })} />

        <section className="money-card">
          <p className="money-label">LARGEST PURCHASES</p>
          <div className="money-card-header"><h2>Largest expenses</h2></div>
          {largest.length === 0 ? <p className="money-empty">No spending yet.</p> : largest.map((r) => {
            const cat = spendCategory(r.cat);
            return (
              <button key={r.key} type="button" className="money-tx" aria-label={`${r.name} Transaction details`} onClick={() => onOpenTransaction(r)}>
                <span className="money-account-label">
                  <span className="money-merchant-icon">{cat?.emoji ?? "₩"}</span>
                  <span>
                    {r.name}
                    <span className="money-sub" style={{ display: "block" }}>
                      {r.date.slice(5).replace("-", "/")} · {r.type}
                    </span>
                  </span>
                </span>
                <span style={{ fontWeight: 650 }}>{wonFmt(r.amount)}</span>
              </button>
            );
          })}
        </section>
      </div>
    </div>
  );
}
