"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchMoneyBankHistory, type BankTx, type CardCharge } from "@/lib/data/finance";
import { accountBalances, netCardAmount } from "@/lib/finance/money";
import { monthlyAccountBalances, type MoneyTransactionFilters } from "@/lib/finance/transactions";
import { MoneyBalanceCard } from "./MoneySummaryCards";
import { recentMonths, wonFmt } from "@/lib/finance/spend";

/* 계좌와 자산 — 시안의 "계좌·자산" 화면.
   요약과 사용자가 가져온 명세서 출처별 계좌 서브탭.
   계좌는 업로드 파일명으로 가린다(accounts.ts). */

interface Props {
  month: string;
  bank: BankTx[];
  cards: CardCharge[];
  onTransactions: (filters: MoneyTransactionFilters) => void;
}

function Spark({ data }: { data: { date: string; balance: number }[] }) {
  if (data.length < 2) return <p className="money-empty">Not enough data to show the balance trend.</p>;
  const W = 700, H = 240, PAD = { t: 14, r: 56, b: 24, l: 4 };
  const values = data.map((d) => d.balance);
  const max = Math.max(...values), min = Math.min(...values, 0);
  const x = (i: number) => PAD.l + (i / (data.length - 1)) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - (v - min) / Math.max(1, max - min)) * (H - PAD.t - PAD.b);
  const line = data.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(d.balance).toFixed(1)}`).join(" ");
  const area = `${line} L${x(data.length - 1).toFixed(1)} ${y(min)} L${x(0).toFixed(1)} ${y(min)} Z`;
  const short = (v: number) => new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(v);
  return (
    <svg className="money-balance-spark" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Bank balance trend">
      {[max, (max + min) / 2, min].map((t, i) => (
        <g key={i}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="#eeeeee" />
          <text x={W - PAD.r + 8} y={y(t) + 4} fontSize="11" fill="#797979">{short(t)}</text>
        </g>
      ))}
      <path d={area} fill="#e0f2fe" />
      <path d={line} fill="none" stroke="#0284c7" strokeWidth="2" strokeLinejoin="round" />
      {[0, data.length - 1].map((i) => (
        <text key={i} x={x(i)} y={H - 6} fontSize="11" fill="#797979" textAnchor={i ? "end" : "start"}>
          {data[i].date.slice(2).replace(/-/g, ".")}
        </text>
      ))}
    </svg>
  );
}

export function MoneyAccounts({ month, bank, cards, onTransactions }: Props) {
  const months = useMemo(() => recentMonths(month, 6), [month]);
  const [history, setHistory] = useState<BankTx[] | null>(null);
  const [view, setView] = useState<string>("summary");

  useEffect(() => {
    let alive = true;
    fetchMoneyBankHistory()
      .then((rows) => { if (alive) setHistory(rows); })
      .catch(() => { if (alive) setHistory(bank); });
    return () => { alive = false; };
  }, [bank]);

  /** 계좌별 현재 잔액 — 이 달 마지막 거래 기준. */
  const accounts = useMemo(() => accountBalances(history ?? bank, month), [history, bank, month]);
  const total = accounts.reduce((a, b) => a + b.balance, 0);

  /* 시안과 같이 국내·해외로 나눈다. 해외 건은 승인구분이 '해외'이거나
     원화가 아직 안 정해져 해외승인금액만 있는 건. */
  const cardSummary = useMemo(() => {
    const live = cards;
    const isForeign = (c: CardCharge) =>
      (c.cardMeta?.["승인구분"] ?? "").includes("해외") || Boolean(c.cardMeta?.["해외승인금액"]);
    const numbers = [...new Set(cards.map((c) => c.cardMeta?.["카드번호"]).filter(Boolean))];
    return {
      domestic: live.filter((c) => !isForeign(c)).reduce((a, c) => a + (netCardAmount(c) ?? 0), 0),
      foreign: live.filter(isForeign).reduce((a, c) => a + (netCardAmount(c) ?? 0), 0),
      numbers,
    };
  }, [cards]);

  const spark = useMemo(() => monthlyAccountBalances(history ?? bank, months, view), [history, bank, months, view]);
  const balance = view === "summary" ? total : accounts.find((account) => account.key === view)?.balance;

  return (
    <>
      <div className="money-tabs">
        <button type="button" className={view === "summary" ? "active" : ""} onClick={() => setView("summary")}>Overview</button>
        {accounts.map(a => <button key={a.key} type="button" className={view === a.key ? "active" : ""} onClick={() => setView(a.key)}>{a.label}</button>)}
      </div>

        <div className="money-grid">
          <div className="money-stack">
            <section className="money-card">
              <p className="money-label">{view === "summary" ? "Total bank balance" : `${view} balance`}</p>
              <div className="money-amount">{balance == null ? "No data" : wonFmt(balance)}</div>
              <p className="money-sub">Based on statements · Last 6 months</p>
              {history === null ? <p className="money-empty">Loading…</p> : <Spark data={spark} />}
            </section>

            <section className="money-card">
              <p className="money-label">CASH ACCOUNTS</p>
              <div className="money-card-header"><h2>Bank accounts</h2></div>
              {accounts.length === 0 ? <p className="money-empty">No balances available.</p> : accounts.map((a) => (
                <div key={a.key} className="money-account-row">
                  <span className="money-account-label">
                    <span className="money-account-icon">▤</span>
                    <span>
                      {a.label}
                      <span className="money-sub" style={{ display: "block" }}>As of {a.at}</span>
                    </span>
                  </span>
                  <span className="money-right">
                    <span style={{ fontWeight: 650, display: "block" }}>{wonFmt(a.balance)}</span>
                    <button type="button" className="money-text-button" onClick={() => onTransactions({ account: a.label })}>
                      View transactions →
                    </button>
                  </span>
                </div>
              ))}
            </section>
          </div>

          <div className="money-stack">
          <MoneyBalanceCard accounts={accounts} cards={cards} />
          <section className="money-card">
            <p className="money-label">CARD SPENDING</p>
            <div className="money-card-header"><h2>Company cards</h2></div>
            {cardSummary.numbers.length > 0 && (
              <p className="money-sub" style={{ marginTop: -6 }}>{cardSummary.numbers.join(" · ")}</p>
            )}
            <div className="money-summary-row"><button type="button" className="money-text-button" onClick={() => onTransactions({ account: "Domestic cards" })}>Domestic cards</button><span style={{ fontWeight: 650 }}>{wonFmt(cardSummary.domestic)}</span></div>
            <div className="money-summary-row"><button type="button" className="money-text-button" onClick={() => onTransactions({ account: "International cards" })}>International cards</button><span style={{ fontWeight: 650 }}>{wonFmt(cardSummary.foreign)}</span></div>
            <p className="money-note">Net card spending uses posting dates (approval dates if unavailable) and includes cancellations. These dates differ from bank settlement dates.</p>
          </section>
          </div>
        </div>
    </>
  );
}
