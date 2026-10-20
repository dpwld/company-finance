"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchMoneyMonth, fetchMoneyBankHistory, type BankTx, type CardCharge, type ChargeSplit } from "@/lib/data/finance";
import { accountBalances, cumulativeMoney, moneyEntries, moneyTotals } from "@/lib/finance/money";
import { catColor, spendCategory, spendCategoryLabel, wonFmt } from "@/lib/finance/spend";
import { moneyTransactionRows, type MoneyTransactionTarget } from "@/lib/finance/transactions";
import { MoneyBalanceCard, MoneyNeedsCategory, MoneySummary } from "./MoneySummaryCards";
import { MoneyTrendChart } from "./MoneyCharts";

/* 대시보드 — 시안의 첫 화면.
   왼쪽: 이번 달 지출(큰 숫자 + 전월 대비 누적 추이) · 최근 거래
   오른쪽: 분류 필요 · 통장 잔액 · 이 달 요약 · 카테고리별 지출 */

interface Props {
  month: string;
  bank: BankTx[];
  cards: CardCharge[];
  splits: ChargeSplit[];

  onNav: (id: string) => void;
  onReview: () => void;
  onOpenTransaction: (target: MoneyTransactionTarget) => void;
}

const prevMonthOf = (month: string): string => {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

export function MoneyDashboard({ month, bank, cards, splits, onNav, onReview, onOpenTransaction }: Props) {
  // 미분류 거래를 한 장씩 밀어서 분류하는 화면 (Rocket Money Category Review)
  const [bankHistory, setBankHistory] = useState<BankTx[]>(bank);
  useEffect(() => { let alive = true; fetchMoneyBankHistory().then((rows) => { if (alive) setBankHistory(rows); }).catch(() => {}); return () => { alive = false; }; }, [bank]);
  /* 전월 자료는 어느 달 것인지 함께 들고 있는다 — 달을 바꾼 직후 이전 달
     결과가 잠깐 섞여 보이지 않게, 비우는 대신 달이 맞을 때만 쓴다. */
  const [loaded, setLoaded] = useState<{ month: string; bank: BankTx[]; cards: CardCharge[] } | null>(null);
  useEffect(() => {
    let alive = true;
    fetchMoneyMonth(prevMonthOf(month))
      .then((d) => { if (alive) setLoaded({ month, bank: d.bank, cards: d.cards }); })
      .catch(() => { if (alive) setLoaded({ month, bank: [], cards: [] }); });
    return () => { alive = false; };
  }, [month]);
  const prev = loaded?.month === month ? loaded : null;

  const totals = useMemo(() => moneyTotals(cards, bank, splits), [cards, bank, splits]);
  const current = useMemo(() => cumulativeMoney(moneyEntries(cards, bank), month), [bank, cards, month]);
  const previous = useMemo(
    () => cumulativeMoney(moneyEntries(prev?.cards ?? [], prev?.bank ?? []), prevMonthOf(month)),
    [prev, month],
  );

  const spent = totals.spending;
  const prevSpent = previous[previous.length - 1] ?? 0;
  const diff = spent - prevSpent;

  const accounts = useMemo(() => accountBalances(bankHistory, month), [bankHistory, month]);
  const recent = useMemo(() => moneyTransactionRows(cards, bank)
    .sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5), [cards, bank]);

  const topCategories = useMemo(
    () => Object.entries(totals.byCategory).sort((a, b) => b[1] - a[1]).slice(0, 6),
    [totals],
  );

  return (
    <div className="money-dash">
      <div className="money-stack">
        <section className="money-card">
          <p className="money-label">Net card spending this month</p>
          <div className="money-amount">{wonFmt(spent)}</div>
          <p className={`money-trend${diff > 0 ? " money-negative" : ""}`}>
            {prev === null ? "Comparing with last month…"
              : prevSpent === 0 ? "No spending recorded last month."
                : diff === 0 ? "Same as last month."
                  : `Compared with last month: ${wonFmt(Math.abs(diff))} ${diff > 0 ? "more" : "less"} spent`}
          </p>
          {totals.unknownAmountCount > 0 && <p className="money-note money-negative">KRW amount pending {totals.unknownAmountCount} records excluded from totals.</p>}
          <MoneyTrendChart current={current} previous={previous} month={month} />
          <div className="money-legend">
            <span><i />Selected month</span>
            <span><i style={{ background: "#c7c7c7" }} />Last month</span>
          </div>
        </section>

        <section className="money-card">
          <div className="money-card-header">
            <h2>Recent transactions</h2>
            <button type="button" className="money-text-button" onClick={() => onNav("tx")}>View all →</button>
          </div>
          {recent.length === 0 ? <p className="money-empty">No transactions this month.</p> : recent.map((r) => {
            const cat = spendCategory(r.category);
            return (
              <button key={r.key} type="button" className="money-tx" aria-label={`${r.name} Transaction details`} onClick={() => onOpenTransaction(r)}>
                <span className="money-merchant-icon">{cat?.emoji ?? "₩"}</span>
                <span className="money-merchant-info">
                  <span className="money-merchant-name">{r.name}</span>
                  <span className="money-sub" style={{ display: "block" }}>
                    {r.date.slice(5).replace("-", "/")} · {spendCategoryLabel(r.category)}
                  </span>
                </span>
                <span className={`money-tx-amount${(r.amount ?? 0) > 0 ? "" : " money-negative"}`}>
                  {r.amount == null ? "KRW amount pending" : `${r.amount > 0 ? "+" : ""}${wonFmt(Math.abs(r.amount))}`}
                </span>
              </button>
            );
          })}
        </section>
      </div>

      <div className="money-stack">
        <MoneyNeedsCategory bank={bank} cards={cards} onReview={onReview} />

        <MoneyBalanceCard accounts={accounts} cards={cards} />

        <MoneySummary bank={bank} cards={cards} splits={splits} />

        <section className="money-card">
          <div className="money-card-header">
            <h2>Spending by category</h2>
            <button type="button" className="money-text-button" onClick={() => onNav("spend")}>View details →</button>
          </div>
          {topCategories.length === 0 ? <p className="money-empty">No categorized spending yet.</p> : topCategories.map(([key, amount]) => {
            const cat = spendCategory(key);
            return (
              <div key={key} className="money-summary-row">
                <span>
                  <i className="money-dot" style={{ background: cat ? catColor(cat.hue) : "#c7c7c7" }} />
                  {spendCategoryLabel(key)}
                </span>
                <span style={{ fontWeight: 650 }}>{wonFmt(amount)}</span>
              </div>
            );
          })}
        </section>
      </div>


    </div>
  );
}
