"use client";

import { useEffect, useMemo, useState } from "react";
import {
  fetchMoneyHistory, fetchMoneyCategories, updateBankTx, updateCardCharge,
  type BankTx, type CardCharge,
} from "@/lib/data/finance";
import { fetchEvidence, type EvidenceFile, type EvidenceLink } from "@/lib/data/evidence";
import { SPEND_CATEGORY_OPTIONS, spendCategoryLabel, wonFmt } from "@/lib/finance/spend";
import { moneyTransactionRows, filterMoneyTransactions, type MoneyTransactionFilters, type MoneyTransactionRow as Row } from "@/lib/finance/transactions";
import { MoneyCategoryPicker, type CategorySubject } from "./MoneyCategoryPicker";
import { MoneyTransactionDetail } from "./MoneyTransactionDetail";
import { startJob } from "@/lib/finance/aiJobs";
import { useAiJob } from "@/lib/hooks/useAiJob";

/* 거래 내역 — 시안의 "거래 내역" 화면.
   필터 바 + 한 표에서 분류를 바로 바꾸고, 줄을 누르면 상세 창이 열린다.
   시안에 없는 기능(분개·세부항목 분할·증빙)은 그 상세 창에 모았다 —
   표에 열을 더 붙이면 시안과 멀어지고 가로로도 넘친다. */

interface Props {
  month: string;
  bank: BankTx[];
  cards: CardCharge[];
  evVersion: number;
  onChanged: () => void;

  initialFilters?: MoneyTransactionFilters;
}

const EMPTY_BANK: BankTx[] = [];
const EMPTY_CARDS: CardCharge[] = [];
const TYPES = ["All types", "Outflows & spending", "Inflows & refunds", "Card spending", "Card cancellation", "Bank withdrawals", "Bank deposits"];

export function MoneyTransactions({ month, bank: monthBank, cards: monthCards, evVersion, onChanged, initialFilters = {} }: Props) {
  const [range, setRange] = useState<"month" | "all">(initialFilters.range ?? "month");
  const [history, setHistory] = useState<{ cards: CardCharge[]; bank: BankTx[] } | null>(null);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [customCategories, setCustomCategories] = useState<string[]>([]);
  const [categorySubject, setCategorySubject] = useState<CategorySubject | null>(null);
  const [error, setError] = useState("");
  const bank = range === "all" ? history?.bank ?? EMPTY_BANK : monthBank;
  const cards = range === "all" ? history?.cards ?? EMPTY_CARDS : monthCards;
  const refresh = () => { onChanged(); setHistoryVersion((version) => version + 1); };
  useEffect(() => {
    let alive = true;
    fetchMoneyCategories().then((keys) => { if (alive) setCustomCategories(keys); }).catch(() => {});
    if (range === "all") fetchMoneyHistory().then((rows) => { if (alive) setHistory(rows); }).catch(() => { if (alive) setError("Could not load all-time transactions."); });
    return () => { alive = false; };
  }, [range, historyVersion]);
  const [q, setQ] = useState(initialFilters.query ?? "");
  const [account, setAccount] = useState(initialFilters.account ?? "All accounts & cards");
  const [category, setCategory] = useState(initialFilters.category ?? "");
  const [type, setType] = useState(initialFilters.type ?? TYPES[0]);
  const [sort, setSort] = useState<"recent" | "amount" | "oldest">("recent");
  const [page, setPage] = useState(0);
  const [detail, setDetail] = useState<Row | null>(null);
  const [ev, setEv] = useState<{ files: EvidenceFile[]; links: EvidenceLink[] } | null>(null);
  const job = useAiJob("spend-classify");

  useEffect(() => {
    let alive = true;
    fetchEvidence(month, { cards: cards.map((c) => c.id), bank: bank.map((b) => b.id) })
      .then((d) => { if (alive) setEv(d); }).catch(() => {});
    return () => { alive = false; };
  }, [month, evVersion, cards, bank]);

  const rows = useMemo(() => moneyTransactionRows(cards, bank), [cards, bank]);

  const accounts = useMemo(() => [...new Set(["All accounts & cards", "Domestic cards", "International cards", ...rows.map((r) => r.account)])], [rows]);

  /* 거래별 증빙 개수 — 세금계산서도 영수증과 같은 증빙으로 들어온다.
     줄마다 보여줘야 "이건 증빙 붙었나?"를 열어보지 않고 안다. */
  const evCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of ev?.links ?? []) {
      const key = l.cardChargeId ? `c${l.cardChargeId}` : l.bankTxId ? `b${l.bankTxId}` : "";
      if (key) m.set(key, (m.get(key) ?? 0) + 1);
    }
    return m;
  }, [ev]);

  const shown = useMemo(() => filterMoneyTransactions(rows, { query: q, account, category, type }, sort), [rows, q, account, category, type, sort]);

  const currentPage = Math.min(page, Math.max(0, Math.ceil(shown.length / 25) - 1));
  const categoryOptions = [...SPEND_CATEGORY_OPTIONS, ...[...new Set([...customCategories, ...rows.map((row) => row.category).filter((key) => key.startsWith("custom:"))])].map((value) => ({ value, label: spendCategoryLabel(value) }))];
  const unclassified = useMemo(() => ({
    cards: cards.filter((c) => (!c.spendCategory || c.spendCategory === "uncategorized") && c.amount && !(c.status || "").includes("취소")),
    bank: bank.filter((b) => (!b.spendCategory || b.spendCategory === "uncategorized") && (b.withdrawal || b.deposit)),
  }), [cards, bank]);
  const pending = unclassified.cards.length + unclassified.bank.length;

  /* Optional AI proposes only user-defined categories; the user reviews before saving. */
  function aiCategorize() {
    const cardsSnap = [...unclassified.cards];
    const bankSnap = [...unclassified.bank];
    startJob("spend-classify", async (h) => {
      let targetCards = cardsSnap;
      let targetBank = bankSnap;
      const total = targetCards.length + targetBank.length;
      let applied = 0;
      h.progress(0, total);
      for (let i = 0; i < Math.max(targetCards.length, targetBank.length, 1); i += 120) {
        const cardsChunk = targetCards.slice(i, i + 120);
        const bankChunk = targetBank.slice(i, i + 120);
        if (!cardsChunk.length && !bankChunk.length) break;
        const res = await fetch("/api/finance/spend-classify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({cards: cardsChunk.map(c=>({id:c.id})),bank: bankChunk.map(b=>({id:b.id}))}),
        });
        const json = (await res.json() as any);
        if (!res.ok) throw new Error(json.detail || json.error?.message || json.error || `HTTP ${res.status}`);
        if (!window.confirm(`AI suggested categories for ${[...(json.cards ?? []), ...(json.bank ?? [])].filter((r: any) => r.category).length} transactions. ${[...(json.cards ?? []), ...(json.bank ?? [])].filter((r: any) => r.category).map((r: any) => `${cardsSnap.find(c=>c.id===r.id)?.merchant || bankSnap.find(b=>b.id===r.id)?.counterparty || r.id}: ${spendCategoryLabel(r.category)}`).join("\n")}
Apply these suggestions?`)) continue;
        for (const c of json.cards ?? []) {
          if (customCategories.includes(c.category)) { await updateCardCharge(c.id, { spend_category: c.category }); h.progress(++applied, total); }
        }
        for (const b of json.bank ?? []) {
          if (customCategories.includes(b.category)) { await updateBankTx(b.id, { spend_category: b.category }); h.progress(++applied, total); }
        }
      }
      refresh();
      return `${applied} transactions categorized`;
    });
  }

  function exportCsv() {
    const head = "Date,Transaction,Account or card,Category,Type,Amount,Note";
    const q2 = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const body = shown.map((r) => [r.date, q2(r.name), q2(r.account), q2(spendCategoryLabel(r.category)), r.type, r.amount ?? "", q2(r.note)].join(","));
    const blob = new Blob(["﻿" + [head, ...body].join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `finance-transactions-${month}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <>
      <section className="money-card">
        {error && <p role="alert" className="money-negative">{error}</p>}
        {range === "all" && history === null && <p className="money-note">Loading all-time transactions…</p>}
        <div className="money-card-header">
          <h2>Transactions {shown.length} records</h2>
          <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {job.running
              ? <span className="money-sub">AI categorization {job.done}/{job.total}</span>
              : job.message && <span className="money-sub">{job.message}</span>}
            <button type="button" className="money-primary" disabled={job.running || pending === 0 || customCategories.length === 0} onClick={() => { if (window.confirm("Request AI suggestions for uncategorized transactions using your categories? You can review before applying. External API charges may apply.")) aiCategorize(); }}>
              Suggest categories with AI{pending ? ` (${pending})` : ""}
            </button>
            <button type="button" className="money-text-button" onClick={exportCsv}>Export CSV</button>
          </span>
        </div>

        {category === "uncategorized" && <div className="money-review-banner"><span>Review uncategorized transactions. You can categorize matching names together.</span><button type="button" onClick={() => setCategory("")}>View all transactions</button></div>}
        <div className="money-toolbar">
          <select aria-label="Date range" value={range} onChange={(e) => { setRange(e.target.value as "month" | "all"); setPage(0); }}><option value="month">Selected month</option><option value="all">All time</option></select>
          <select value={sort} onChange={(e) => { setSort(e.target.value as "recent" | "amount" | "oldest"); setPage(0); }} aria-label="Sort">
            <option value="recent">Newest first</option>
            <option value="amount">Largest amount first</option><option value="oldest">Oldest first</option>
          </select>
          <input placeholder="Search merchants, transactions, categories" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} aria-label="Search transactions" />
          <select value={account} onChange={(e) => { setAccount(e.target.value); setPage(0); }} aria-label="Accounts & cards">
            {accounts.map((a) => <option key={a}>{a}</option>)}
          </select>
          <select value={category} onChange={(e) => { setCategory(e.target.value); setPage(0); }} aria-label="Category">
            <option value="">All categories</option><option value="uncategorized">Uncategorized</option>
            {categoryOptions.filter((o) => o.value).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select value={type} onChange={(e) => { setType(e.target.value); setPage(0); }} aria-label="Type">
            {TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </div>

        {shown.length === 0 ? <p className="money-empty">No transactions match your filters.</p> : (
          <div className="money-table-wrap">
            <table>
              <thead>
                <tr><th>Date</th><th>Transaction name</th><th>Accounts &amp; cards</th><th>Category</th><th>Type</th><th className="money-right">Amount</th></tr>
              </thead>
              <tbody>
                {shown.slice(currentPage * 25, currentPage * 25 + 25).map((r) => (
                  <tr key={r.key} tabIndex={0} role="button" aria-label={`${r.name} Transaction details`} onClick={() => setDetail(r)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setDetail(r); } }}>
                    <td className="money-muted">{r.date.replaceAll("-", ".")}</td>
                    <td>
                      {r.name}
                      {evCount.get(r.key) ? (
                        <span title={`Receipts ${evCount.get(r.key)} records`} style={{ marginLeft: 6, fontSize: 11, color: "#404040" }}>
                          📎{evCount.get(r.key)! > 1 ? evCount.get(r.key) : ""}
                        </span>
                      ) : null}
                    </td>
                    <td className="money-muted">{r.account}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <button type="button" aria-label={`${r.name} Change category`} onKeyDown={(e) => e.stopPropagation()} onClick={() => setCategorySubject(r)}>{spendCategoryLabel(r.category)} ⌄</button>
                    </td>
                    <td className="money-muted">{r.type}</td>
                    <td className={`money-right${(r.amount ?? 0) < 0 ? " money-negative" : ""}`} style={{ fontWeight: 650 }}>
                      {r.amount == null ? "KRW amount pending" : `${r.amount > 0 ? "+" : "−"}${wonFmt(Math.abs(r.amount))}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="money-card-header" style={{ marginTop: 16 }}><span className="money-sub">{shown.length ? `${currentPage * 25 + 1}–${Math.min((currentPage + 1) * 25, shown.length)} / ${shown.length} records` : "0 records"}</span><span><button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</button> <button type="button" disabled={(currentPage + 1) * 25 >= shown.length} onClick={() => setPage(currentPage + 1)}>Next</button></span></div>
      </section>

      {categorySubject && <MoneyCategoryPicker subject={categorySubject} onClose={() => setCategorySubject(null)} onSaved={() => { refresh(); setDetail(null); }} />}
      {detail && <MoneyTransactionDetail key={detail.key} detail={detail} evVersion={evVersion} onClose={() => setDetail(null)} onChanged={refresh} />}
    </>
  );
}
