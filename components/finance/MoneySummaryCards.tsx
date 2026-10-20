"use client";

import type { BankTx, CardCharge, ChargeSplit } from "@/lib/data/finance";
import { accountBalances, isMoneyUncategorized, moneyEntries, moneyTotals, netCardAmount } from "@/lib/finance/money";
import { moneyTransactionRows } from "@/lib/finance/transactions";
import { wonFmt } from "@/lib/finance/spend";

type MoneyData = { bank: BankTx[]; cards: CardCharge[]; tipsExcluded: boolean };

export function MoneyNeedsCategory({ bank, cards, tipsExcluded, onReview }: MoneyData & { onReview: () => void }) {
  const rows = moneyTransactionRows(cards, bank, tipsExcluded);
  const count = rows.filter((row) => isMoneyUncategorized(row.category)).length;
  return <section className="money-card money-needs">
    <p className="money-label">NEEDS CATEGORIZATION</p>
    <h2 style={{ fontSize: 17, margin: 0, fontWeight: 650 }}>{rows.length === 0 ? "분류할 거래 없음" : count ? "분류 필요" : "분류 완료"}</h2>
    <p className="money-note">{rows.length === 0 ? "거래 자료를 가져오면 분류 현황이 표시됩니다." : count ? `카테고리가 비어 있는 거래가 ${count}건 있습니다. 분류하면 카테고리별로 확인할 수 있습니다.` : "이 달 거래는 모두 분류됐습니다."}</p>
    {count > 0 && <button type="button" className="money-primary" style={{ width: "100%", marginTop: 6 }} onClick={onReview}>미분류 {count}건 정리하기 →</button>}
    <p className="money-note">선택한 달과 TIPS 토글 기준</p>
  </section>;
}

export function MoneySummary({ bank, cards, tipsExcluded, splits }: MoneyData & { splits: ChargeSplit[] }) {
  const totals = moneyTotals(cards, bank, tipsExcluded, splits);
  const cardNet = cards.reduce((sum, row) => sum + (netCardAmount(row) ?? 0), 0);
  const values: [string, number][] = tipsExcluded ? [
    ["일반 통장 직접 출금", moneyEntries([], bank, true).filter((row) => !row.refund).reduce((sum, row) => sum + (row.amount ?? 0), 0)],
    ["카드 순사용", cardNet], ["TIPS 환급 차감", -totals.refundTotal], ["자체 부담액", totals.spending],
  ] : [
    ["통장 입금", totals.income], ["통장 출금", totals.outgoing], ["카드 순사용", cardNet],
    ["카드 취소·환급", -cards.reduce((sum, row) => sum + Math.min(0, netCardAmount(row) ?? 0), 0)],
  ];
  return <section className="money-card">
    <p className="money-label">{tipsExcluded ? "SELF-FUNDED SPEND" : "SUMMARY"}</p>
    <div className="money-card-header"><h2>{tipsExcluded ? "사업체 자체 부담" : "이 달 요약"}</h2></div>
    {values.map(([label, value]) => <div className="money-summary-row" key={label}><span className="money-muted">{label}</span><span style={{ fontWeight: 650 }}>{wonFmt(value === 0 ? 0 : value)}</span></div>)}
    <p className="money-note">{tipsExcluded ? "TIPS 통장 직접 지출 제외 · 카드대금·내부이체 중복 제외. 확인된 환급은 받은 달에 차감합니다." : "통장 흐름과 카드 사용은 각각 집계합니다. 카드 순사용은 매입일 기준이며 취소를 포함합니다."}</p>
    {totals.unknownAmountCount > 0 && <p className="money-note money-negative">원화 미확정 {totals.unknownAmountCount}건은 합계에서 제외됩니다.</p>}
  </section>;
}

export function MoneyFrequentMerchants({ bank, cards, tipsExcluded, onMerchant }: MoneyData & { onMerchant: (merchant: string) => void }) {
  const groups = new Map<string, { count: number; amount: number }>();
  for (const row of moneyEntries(cards, bank, tipsExcluded)) {
    if ((row.amount ?? 0) <= 0) continue;
    const group = groups.get(row.name) ?? { count: 0, amount: 0 };
    group.count++; group.amount += row.amount!; groups.set(row.name, group);
  }
  const frequent = [...groups].sort((a, b) => b[1].count - a[1].count).slice(0, 4);
  return <section className="money-card">
    <p className="money-label">FREQUENT SPEND</p>
    <div className="money-card-header"><h2>자주 사용한 가맹점</h2></div>
    {frequent.length === 0 ? <p className="money-empty">지출이 없습니다.</p> : frequent.map(([name, group]) => <div key={name} className="money-summary-row">
      <button type="button" className="money-text-button" style={{ textAlign: "left" }} onClick={() => onMerchant(name)}>{name}<span className="money-sub" style={{ display: "block" }}>{group.count}건</span></button>
      <span style={{ fontWeight: 650 }}>{wonFmt(group.amount)}</span>
    </div>)}
  </section>;
}

export function MoneyBalanceCard({ accounts, cards }: { accounts: ReturnType<typeof accountBalances>; cards: CardCharge[] }) {
  const balanceTotal = accounts.reduce((sum, account) => sum + account.balance, 0);
  const cardUsed = cards.reduce((sum, card) => sum + (netCardAmount(card) ?? 0), 0);
  return (
        <section className="money-card">
          <div className="money-card-header"><h2>통장 잔액</h2></div>
          {accounts.length === 0 ? <p className="money-empty">잔액 정보가 없습니다.</p> : (
            <>
              {accounts.map((a) => (
                <div key={a.key} className="money-account-row">
                  <span className="money-account-label">
                    <span className={`money-account-icon${a.key === "tips" ? " tips" : ""}`}>▤</span>
                    <span>
                      {a.label}
                      <span className="money-sub" style={{ display: "block" }}>{a.at} 기준</span>
                    </span>
                  </span>
                  <span style={{ fontWeight: 650 }}>{wonFmt(a.balance)}</span>
                </div>
              ))}
              <div className="money-account-row">
                <span className="money-account-label">
                  <span className="money-account-icon">▤</span>
                  <span>
                    KB 법인카드
                    <span className="money-sub" style={{ display: "block" }}>이 달 순사용액 · 미결제 잔액 아님</span>
                  </span>
                </span>
                <span style={{ fontWeight: 650 }}>{wonFmt(cardUsed)}</span>
              </div>
              <div className="money-cash-total">
                <span>통장 잔액 합계</span><span>{wonFmt(balanceTotal)}</span>
              </div>
            </>
          )}
        </section>
  );
}
