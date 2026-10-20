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
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

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
        <button type="button" className={view === "list" ? "active" : ""} onClick={() => setView("list")}>Recurring payments</button>
        <button type="button" className={view === "calendar" ? "active" : ""} onClick={() => setView("calendar")}>Payment calendar</button>
      </div>
      {view === "list" ? (
        <div className="money-grid"><section className="money-card">
          <div className="money-card-header"><h2>Potential recurring payments</h2><span className="money-tag">All time</span></div>
          <p className="money-note">These merchants appear in at least 3 different months. This is historical activity, not a confirmed subscription or next payment date.</p>
          {error ? <p role="alert" className="money-negative">Could not load recurring payment history.</p>
            : cards === null ? <p className="money-empty">Loading…</p>
              : recurring.length === 0 ? <p className="money-empty">No recurring payment patterns yet.</p>
                : recurring.map((row) => (
                  <div key={row.key} className="money-account-row">
                    <span className="money-account-label"><span className="money-merchant-icon">↻</span><span>
                      <span className="money-merchant-name">{row.merchant}</span>
                      <span className="money-sub" style={{ display: "block" }}>{row.months} months · {row.times} payments · Latest: {row.last}</span>
                    </span></span>
                    <span className="money-right"><strong>{wonFmt(row.total)}</strong><span className="money-sub" style={{ display: "block" }}>Net spending · All time</span>
                      <button type="button" className="money-text-button" onClick={() => onTransactions({ range: "all", query: row.merchant })}>View transactions</button>
                    </span>
                  </div>
                ))}
        </section><div className="money-stack">
          <MoneyFrequentMerchants bank={bank} cards={monthCards} onMerchant={(query) => onTransactions({ range: "all", query })} />
          <section className="money-card"><h2>Recurring payment insights</h2><p className="money-note">Find merchants used across multiple months and review patterns in your payment history.</p><button type="button" onClick={() => setView("calendar")}>View calendar →</button></section>
        </div></div>
      ) : (
        <section className="money-card">
          <div className="money-card-header"><h2>{new Date(month + "-01T00:00:00").toLocaleDateString("en-US", { month: "long" })} payment calendar</h2><span className="money-tag">All cards · Actual posting dates</span></div>
          <div className="money-calendar">
            {WEEKDAYS.map((day) => <div key={day} className="money-calendar-cell" style={{ minHeight: 0, textAlign: "center" }}>{day}</div>)}
            {Array.from({ length: offset }, (_, index) => <div key={`blank-${index}`} className="money-calendar-cell" />)}
            {Array.from({ length: days }, (_, index) => {
              const date = `${month}-${String(index + 1).padStart(2, "0")}`;
              return <div key={date} className="money-calendar-cell"><span className="money-muted">{index + 1}</span>
                {monthCards.filter((card) => moneyCardDate(card) === date).map((card) => <button key={card.id} type="button" aria-label={`${card.merchant || card.itemName} Transaction details`} onClick={() => onOpenTransaction({ kind: "card", id: card.id })}>
                  {card.merchant || card.itemName} {netCardAmount(card) == null ? "KRW amount pending" : wonFmt(netCardAmount(card)!)}
                </button>)}
              </div>;
            })}
          </div>
          <p className="money-note">Shows actual card activity including cancellations. Uses approval dates when posting dates are unavailable.</p>
        </section>
      )}
    </>
  );
}
