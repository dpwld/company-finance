"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchMoneyHistory, type BankTx, type CardCharge } from "@/lib/data/finance";
import { moneyCardDate, netCardAmount, recurringMerchants } from "@/lib/finance/money";
import type { MoneyTransactionFilters, MoneyTransactionTarget } from "@/lib/finance/transactions";
import { MoneyFrequentMerchants } from "./MoneySummaryCards";
import { wonFmt } from "@/lib/finance/spend";

interface Props {
  month: string;
  cards: CardCharge[];
  bank: BankTx[];

  onTransactions: (filters: MoneyTransactionFilters) => void;
  onOpenTransaction: (target: MoneyTransactionTarget) => void;
}
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

export function MoneyRecurring({ month, cards: monthCards, bank, onTransactions, onOpenTransaction }: Props) {
  const [cards, setCards] = useState<CardCharge[] | null>(null);
  const [error, setError] = useState(false);
  const [view, setView] = useState<"list" | "calendar">("list");
  useEffect(() => {
    let alive = true;
    fetchMoneyHistory().then((history) => { if (alive) { setCards(history.cards); setError(false); } })
      .catch(() => { if (alive) setError(true); });
    return () => { alive = false; };
  }, [monthCards]);
  const recurring = useMemo(() => recurringMerchants(cards ?? []), [cards]);
  const [year, mon] = month.split("-").map(Number);
  const days = new Date(year, mon, 0).getDate();
  const offset = new Date(year, mon - 1, 1).getDay();

  return (
    <>
      <div className="money-tabs">
        <button type="button" className={view === "list" ? "active" : ""} onClick={() => setView("list")}>반복 결제</button>
        <button type="button" className={view === "calendar" ? "active" : ""} onClick={() => setView("calendar")}>결제 캘린더</button>
      </div>
      {view === "list" ? (
        <div className="money-grid"><section className="money-card">
          <div className="money-card-header"><h2>반복 카드 결제 후보</h2><span className="money-tag">전체 기간</span></div>
          <p className="money-note">3개 이상 서로 다른 월에 사용한 같은 거래명입니다. 정기 구독 확정 정보나 다음 결제일은 아닙니다.</p>
          {error ? <p role="alert" className="money-negative">반복 결제 이력을 불러오지 못했습니다.</p>
            : cards === null ? <p className="money-empty">불러오는 중입니다.</p>
              : recurring.length === 0 ? <p className="money-empty">반복 결제 후보가 없습니다.</p>
                : recurring.map((row) => (
                  <div key={row.key} className="money-account-row">
                    <span className="money-account-label"><span className="money-merchant-icon">↻</span><span>
                      <span className="money-merchant-name">{row.merchant}</span>
                      <span className="money-sub" style={{ display: "block" }}>{row.months}개월 · {row.times}건 · 최근 {row.last}</span>
                    </span></span>
                    <span className="money-right"><strong>{wonFmt(row.total)}</strong><span className="money-sub" style={{ display: "block" }}>전체 기간 순사용 합계</span>
                      <button type="button" className="money-text-button" onClick={() => onTransactions({ range: "all", query: row.merchant })}>거래 보기</button>
                    </span>
                  </div>
                ))}
        </section><div className="money-stack">
          <MoneyFrequentMerchants bank={bank} cards={monthCards} onMerchant={(query) => onTransactions({ range: "all", query })} />
          <section className="money-card"><h2>반복 결제 분석</h2><p className="money-note">여러 달에 걸쳐 사용한 가맹점을 찾습니다. 실제 결제 기록으로 패턴을 확인할 수 있습니다.</p><button type="button" onClick={() => setView("calendar")}>캘린더 보기 →</button></section>
        </div></div>
      ) : (
        <section className="money-card">
          <div className="money-card-header"><h2>{mon}월 결제 캘린더</h2><span className="money-tag">전체 카드 · 실제 매입일 기준</span></div>
          <div className="money-calendar">
            {WEEKDAYS.map((day) => <div key={day} className="money-calendar-cell" style={{ minHeight: 0, textAlign: "center" }}>{day}</div>)}
            {Array.from({ length: offset }, (_, index) => <div key={`blank-${index}`} className="money-calendar-cell" />)}
            {Array.from({ length: days }, (_, index) => {
              const date = `${month}-${String(index + 1).padStart(2, "0")}`;
              return <div key={date} className="money-calendar-cell"><span className="money-muted">{index + 1}</span>
                {monthCards.filter((card) => moneyCardDate(card) === date).map((card) => <button key={card.id} type="button" aria-label={`${card.merchant || card.itemName} 거래 상세`} onClick={() => onOpenTransaction({ kind: "card", id: card.id })}>
                  {card.merchant || card.itemName} {netCardAmount(card) == null ? "원화 미확정" : wonFmt(netCardAmount(card)!)}
                </button>)}
              </div>;
            })}
          </div>
          <p className="money-note">반복 결제 여부와 관계없이 취소를 포함한 실제 카드 기록을 표시합니다. 매입일이 없으면 승인일을 사용합니다.</p>
        </section>
      )}
    </>
  );
}
