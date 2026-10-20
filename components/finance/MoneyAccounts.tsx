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
  if (data.length < 2) return <p className="money-empty">잔액 추이를 그릴 자료가 모자랍니다.</p>;
  const W = 700, H = 240, PAD = { t: 14, r: 56, b: 24, l: 4 };
  const values = data.map((d) => d.balance);
  const max = Math.max(...values), min = Math.min(...values, 0);
  const x = (i: number) => PAD.l + (i / (data.length - 1)) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - (v - min) / Math.max(1, max - min)) * (H - PAD.t - PAD.b);
  const line = data.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(d.balance).toFixed(1)}`).join(" ");
  const area = `${line} L${x(data.length - 1).toFixed(1)} ${y(min)} L${x(0).toFixed(1)} ${y(min)} Z`;
  const short = (v: number) => (v >= 10000 ? `${Math.round(v / 10000).toLocaleString("ko-KR")}만` : Math.round(v).toLocaleString("ko-KR"));
  return (
    <svg className="money-balance-spark" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="통장 잔액 추이">
      {[max, (max + min) / 2, min].map((t, i) => (
        <g key={i}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="#eeeeee" />
          <text x={W - PAD.r + 8} y={y(t) + 4} fontSize="11" fill="#797979">{short(t)}</text>
        </g>
      ))}
      <path d={area} fill="#f4f4f4" />
      <path d={line} fill="none" stroke="#616161" strokeWidth="2" strokeLinejoin="round" />
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
        <button type="button" className={view === "summary" ? "active" : ""} onClick={() => setView("summary")}>요약</button>
        {accounts.map(a => <button key={a.key} type="button" className={view === a.key ? "active" : ""} onClick={() => setView(a.key)}>{a.label}</button>)}
      </div>

        <div className="money-grid">
          <div className="money-stack">
            <section className="money-card">
              <p className="money-label">{view === "summary" ? "통장 잔액 합계" : `${view} 잔액`}</p>
              <div className="money-amount">{balance == null ? "자료 없음" : wonFmt(balance)}</div>
              <p className="money-sub">명세서 기준 · 최근 6개월</p>
              {history === null ? <p className="money-empty">불러오는 중입니다.</p> : <Spark data={spark} />}
            </section>

            <section className="money-card">
              <p className="money-label">CASH ACCOUNTS</p>
              <div className="money-card-header"><h2>통장</h2></div>
              {accounts.length === 0 ? <p className="money-empty">잔액 정보가 없습니다.</p> : accounts.map((a) => (
                <div key={a.key} className="money-account-row">
                  <span className="money-account-label">
                    <span className="money-account-icon">▤</span>
                    <span>
                      {a.label}
                      <span className="money-sub" style={{ display: "block" }}>{a.at} 기준</span>
                    </span>
                  </span>
                  <span className="money-right">
                    <span style={{ fontWeight: 650, display: "block" }}>{wonFmt(a.balance)}</span>
                    <button type="button" className="money-text-button" onClick={() => onTransactions({ account: a.label })}>
                      거래 보기 →
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
            <div className="money-card-header"><h2>법인카드</h2></div>
            {cardSummary.numbers.length > 0 && (
              <p className="money-sub" style={{ marginTop: -6 }}>{cardSummary.numbers.join(" · ")}</p>
            )}
            <div className="money-summary-row"><button type="button" className="money-text-button" onClick={() => onTransactions({ account: "국내 카드" })}>국내 카드</button><span style={{ fontWeight: 650 }}>{wonFmt(cardSummary.domestic)}</span></div>
            <div className="money-summary-row"><button type="button" className="money-text-button" onClick={() => onTransactions({ account: "해외 카드" })}>해외 카드</button><span style={{ fontWeight: 650 }}>{wonFmt(cardSummary.foreign)}</span></div>
            <p className="money-note">카드 순사용액은 매입일(없으면 승인일) 기준이며 취소를 포함합니다. 통장에서 빠지는 카드대금 결제일과 다릅니다.</p>
          </section>
          </div>
        </div>
    </>
  );
}
