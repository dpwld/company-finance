"use client";

import type { BankTx, CardCharge, ChargeSplit } from "@/lib/data/finance";
import { accountBalances, isMoneyUncategorized, moneyEntries, moneyTotals, netCardAmount } from "@/lib/finance/money";
import { moneyTransactionRows } from "@/lib/finance/transactions";
import { wonFmt } from "@/lib/finance/spend";

type MoneyData = { bank: BankTx[]; cards: CardCharge[] };

export function MoneyNeedsCategory({ bank, cards, onReview }: MoneyData & { onReview: () => void }) {
  const rows = moneyTransactionRows(cards, bank);
  const count = rows.filter((row) => isMoneyUncategorized(row.category)).length;
  return <section className="money-card money-needs">
    <p className="money-label">NEEDS CATEGORIZATION</p>
    <h2 style={{ fontSize: 17, margin: 0, fontWeight: 650 }}>{rows.length === 0 ? "No transactions to categorize" : count ? "Needs categorization" : "All categorized"}</h2>
    <p className="money-note">{rows.length === 0 ? "Import transactions to see your categorization progress." : count ? `Uncategorized transactions: ${count} records. Assign categories to see spending breakdowns.` : "All transactions this month are categorized."}</p>
    {count > 0 && <button type="button" className="money-primary" style={{ width: "100%", marginTop: 6 }} onClick={onReview}>Uncategorized {count} records to review →</button>}
    <p className="money-note">All transactions in the selected month</p>
  </section>;
}

export function MoneySummary({ bank, cards, splits }: MoneyData & { splits: ChargeSplit[] }) {
  const totals = moneyTotals(cards, bank, splits);
  const cardNet = cards.reduce((sum, row) => sum + (netCardAmount(row) ?? 0), 0);
  const values: [string, number][] = [
    ["Bank deposits", totals.income], ["Bank withdrawals", totals.outgoing], ["Net card spending", cardNet],
    ["Card cancellations & refunds", -cards.reduce((sum, row) => sum + Math.min(0, netCardAmount(row) ?? 0), 0)],
  ];
  return <section className="money-card">
    <p className="money-label">SUMMARY</p>
    <div className="money-card-header"><h2>Monthly summary</h2></div>
    {values.map(([label, value]) => <div className="money-summary-row" key={label}><span className="money-muted">{label}</span><span style={{ fontWeight: 650 }}>{wonFmt(value === 0 ? 0 : value)}</span></div>)}
    <p className="money-note">Bank cash flow and card spending are calculated separately. Net card spending uses posting dates and includes cancellations.</p>
    {totals.unknownAmountCount > 0 && <p className="money-note money-negative">KRW amount pending {totals.unknownAmountCount} records excluded from totals.</p>}
  </section>;
}

export function MoneyFrequentMerchants({ bank, cards, onMerchant }: MoneyData & { onMerchant: (merchant: string) => void }) {
  const groups = new Map<string, { count: number; amount: number }>();
  for (const row of moneyEntries(cards, bank)) {
    if ((row.amount ?? 0) <= 0) continue;
    const group = groups.get(row.name) ?? { count: 0, amount: 0 };
    group.count++; group.amount += row.amount!; groups.set(row.name, group);
  }
  const frequent = [...groups].sort((a, b) => b[1].count - a[1].count).slice(0, 4);
  return <section className="money-card">
    <p className="money-label">FREQUENT SPEND</p>
    <div className="money-card-header"><h2>Frequent merchants</h2></div>
    {frequent.length === 0 ? <p className="money-empty">No spending yet.</p> : frequent.map(([name, group]) => <div key={name} className="money-summary-row">
      <button type="button" className="money-text-button" style={{ textAlign: "left" }} onClick={() => onMerchant(name)}>{name}<span className="money-sub" style={{ display: "block" }}>{group.count} records</span></button>
      <span style={{ fontWeight: 650 }}>{wonFmt(group.amount)}</span>
    </div>)}
  </section>;
}

export function MoneyBalanceCard({ accounts, cards }: { accounts: ReturnType<typeof accountBalances>; cards: CardCharge[] }) {
  const balanceTotal = accounts.reduce((sum, account) => sum + account.balance, 0);
  const cardUsed = cards.reduce((sum, card) => sum + (netCardAmount(card) ?? 0), 0);
  return (
        <section className="money-card">
          <div className="money-card-header"><h2>Bank balances</h2></div>
          {accounts.length === 0 ? <p className="money-empty">No balances available.</p> : (
            <>
              {accounts.map((a) => (
                <div key={a.key} className="money-account-row">
                  <span className="money-account-label">
                    <span className="money-account-icon">▤</span>
                    <span>
                      {a.label}
                      <span className="money-sub" style={{ display: "block" }}>As of {a.at}</span>
                    </span>
                  </span>
                  <span style={{ fontWeight: 650 }}>{wonFmt(a.balance)}</span>
                </div>
              ))}
              <div className="money-account-row">
                <span className="money-account-label">
                  <span className="money-account-icon">▤</span>
                  <span>
                    KB company cards
                    <span className="money-sub" style={{ display: "block" }}>Net spending this month · Not an outstanding balance</span>
                  </span>
                </span>
                <span style={{ fontWeight: 650 }}>{wonFmt(cardUsed)}</span>
              </div>
              <div className="money-cash-total">
                <span>Total bank balance</span><span>{wonFmt(balanceTotal)}</span>
              </div>
            </>
          )}
        </section>
  );
}
