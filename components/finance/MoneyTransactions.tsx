"use client";

import { useEffect, useMemo, useState } from "react";
import {
  fetchSpendRules, fetchMoneyHistory, fetchMoneyCategories, matchSpendRule, updateBankTx, updateCardCharge,
  type BankTx, type CardCharge, type SpendRule,
} from "@/lib/data/finance";
import { fetchEvidence, type EvidenceFile, type EvidenceLink } from "@/lib/data/evidence";
import { ALL_CATEGORY_KEYS, SPEND_CATEGORY_OPTIONS, spendCategoryLabel, wonFmt } from "@/lib/finance/spend";
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
  tipsExcluded: boolean;
  initialFilters?: MoneyTransactionFilters;
}

const EMPTY_BANK: BankTx[] = [];
const EMPTY_CARDS: CardCharge[] = [];
const TYPES = ["전체 유형", "출금·사용", "입금·취소", "카드 사용", "카드 취소", "통장 출금", "통장 입금", "내부이체", "카드대금", "TIPS 환급"];

export function MoneyTransactions({ month, bank: monthBank, cards: monthCards, evVersion, onChanged, tipsExcluded, initialFilters = {} }: Props) {
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
    if (range === "all") fetchMoneyHistory().then((rows) => { if (alive) setHistory(rows); }).catch(() => { if (alive) setError("전체 기간 거래를 불러오지 못했습니다."); });
    return () => { alive = false; };
  }, [range, historyVersion]);
  const [q, setQ] = useState(initialFilters.query ?? "");
  const [account, setAccount] = useState(initialFilters.account ?? "전체 계좌·카드");
  const [category, setCategory] = useState(initialFilters.category ?? "");
  const [type, setType] = useState(initialFilters.type ?? TYPES[0]);
  const [sort, setSort] = useState<"recent" | "amount" | "oldest">("recent");
  const [page, setPage] = useState(0);
  const [detail, setDetail] = useState<Row | null>(null);
  const [ev, setEv] = useState<{ files: EvidenceFile[]; links: EvidenceLink[] } | null>(null);
  const [rules, setRules] = useState<SpendRule[]>([]);
  const job = useAiJob("spend-classify");

  useEffect(() => {
    let alive = true;
    fetchEvidence(month, { cards: cards.map((c) => c.id), bank: bank.map((b) => b.id) })
      .then((d) => { if (alive) setEv(d); }).catch(() => {});
    fetchSpendRules().then((r) => { if (alive) setRules(r); }).catch(() => {});
    return () => { alive = false; };
  }, [month, evVersion, cards, bank]);

  const rows = useMemo(() => moneyTransactionRows(cards, bank, tipsExcluded), [cards, bank, tipsExcluded]);

  const accounts = useMemo(() => [...new Set(["전체 계좌·카드", "일반 통장", "TIPS 통장", "국내 카드", "해외 카드", ...rows.map((r) => r.account)])], [rows]);

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
    cards: cards.filter((c) => !c.spendCategory && c.amount && !(c.status || "").includes("취소")),
    bank: bank.filter((b) => !b.spendCategory && (b.withdrawal || b.deposit)),
  }), [cards, bank]);
  const pending = unclassified.cards.length + unclassified.bank.length;

  /* 미분류 일괄 분류 — 규칙이 먼저(결정적, 토큰 0), 남은 것만 AI로 보낸다.
     모듈 스코프 잡으로 돌려 화면을 옮겨도 끝까지 진행된다. */
  function aiCategorize() {
    const cardsSnap = [...unclassified.cards];
    const bankSnap = [...unclassified.bank];
    const rulesSnap = [...rules];
    const evSnap = ev;
    startJob("spend-classify", async (h) => {
      let targetCards = cardsSnap;
      let targetBank = bankSnap;
      const total = targetCards.length + targetBank.length;
      let applied = 0;
      h.progress(0, total);
      if (rulesSnap.length > 0) {
        const ruledCards = targetCards.filter((c) => matchSpendRule(rulesSnap, [c.merchant, c.industry, c.itemName]));
        const ruledBank = targetBank.filter((b) => matchSpendRule(rulesSnap, [b.counterparty, b.description]));
        for (const c of ruledCards) {
          const cat = matchSpendRule(rulesSnap, [c.merchant, c.industry, c.itemName])!;
          await updateCardCharge(c.id, cat === "tips_funded" ? { tips_funded: true } : { spend_category: cat });
        }
        for (const b of ruledBank) {
          const cat = matchSpendRule(rulesSnap, [b.counterparty, b.description])!;
          await updateBankTx(b.id, cat === "tips_funded" ? { tips_funded: true } : { spend_category: cat });
        }
        targetCards = targetCards.filter((c) => !ruledCards.includes(c));
        targetBank = targetBank.filter((b) => !ruledBank.includes(b));
      }
      const fileNames = (kind: "card" | "bank", id: string) =>
        (evSnap?.links ?? [])
          .filter((l) => (kind === "card" ? l.cardChargeId : l.bankTxId) === id)
          .map((l) => evSnap?.files.find((f) => f.id === l.evidenceId)?.fileName)
          .filter((n): n is string => Boolean(n));
      for (let i = 0; i < Math.max(targetCards.length, targetBank.length, 1); i += 120) {
        const cardsChunk = targetCards.slice(i, i + 120);
        const bankChunk = targetBank.slice(i, i + 120);
        if (!cardsChunk.length && !bankChunk.length) break;
        const res = await fetch("/api/finance/spend-classify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cards: cardsChunk.map((c) => ({
              id: c.id, approvalDate: c.approvalDate, merchant: c.merchant, industry: c.industry,
              itemName: c.itemName, amount: c.amount, evidence: fileNames("card", c.id),
            })),
            bank: bankChunk.map((b) => ({
              id: b.id, txDate: b.txDate, counterparty: b.counterparty, description: b.description,
              deposit: b.deposit, withdrawal: b.withdrawal, evidence: fileNames("bank", b.id),
            })),
            rules: rulesSnap.map((r) => `${r.pattern} → ${r.category}`),
          }),
        });
        const json = (await res.json() as any);
        if (!res.ok) throw new Error(json.detail || json.error || `HTTP ${res.status}`);
        for (const c of json.cards ?? []) {
          if (ALL_CATEGORY_KEYS.includes(c.category)) await updateCardCharge(c.id, { spend_category: c.category });
          h.progress(++applied, total);
        }
        for (const b of json.bank ?? []) {
          if (ALL_CATEGORY_KEYS.includes(b.category)) await updateBankTx(b.id, { spend_category: b.category });
          h.progress(++applied, total);
        }
      }
      refresh();
      return `${applied}건 분류 완료`;
    });
  }

  function exportCsv() {
    const head = "날짜,거래명,계좌·카드,분류,유형,금액,메모";
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
        {range === "all" && history === null && <p className="money-note">전체 기간 거래를 불러오는 중입니다.</p>}
        <div className="money-card-header">
          <h2>거래 내역 {shown.length}건</h2>
          <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {job.running
              ? <span className="money-sub">AI 분류 중 {job.done}/{job.total}</span>
              : job.message && <span className="money-sub">{job.message}</span>}
            <button type="button" className="money-primary" disabled={job.running || pending === 0} onClick={aiCategorize}>
              AI 자동 분류{pending ? ` (${pending})` : ""}
            </button>
            <button type="button" className="money-text-button" onClick={exportCsv}>CSV 내보내기</button>
          </span>
        </div>

        {category === "uncategorized" && <div className="money-review-banner"><span>미분류 거래를 정리하세요. 같은 거래명도 함께 분류할 수 있습니다.</span><button type="button" onClick={() => setCategory("")}>모든 거래 보기</button></div>}
        <div className="money-toolbar">
          <select aria-label="기간 필터" value={range} onChange={(e) => { setRange(e.target.value as "month" | "all"); setPage(0); }}><option value="month">선택한 달</option><option value="all">전체 기간</option></select>
          <select value={sort} onChange={(e) => { setSort(e.target.value as "recent" | "amount" | "oldest"); setPage(0); }} aria-label="정렬">
            <option value="recent">최신 거래순</option>
            <option value="amount">큰 금액순</option><option value="oldest">오래된 거래순</option>
          </select>
          <input placeholder="가맹점, 거래명, 분류 검색" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} aria-label="거래 검색" />
          <select value={account} onChange={(e) => { setAccount(e.target.value); setPage(0); }} aria-label="계좌·카드">
            {accounts.map((a) => <option key={a}>{a}</option>)}
          </select>
          <select value={category} onChange={(e) => { setCategory(e.target.value); setPage(0); }} aria-label="분류">
            <option value="">모든 분류</option><option value="uncategorized">미분류</option>{tipsExcluded && <option value="tips_refund">TIPS 환급 차감</option>}
            {categoryOptions.filter((o) => o.value).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select value={type} onChange={(e) => { setType(e.target.value); setPage(0); }} aria-label="유형">
            {TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </div>

        {shown.length === 0 ? <p className="money-empty">조건에 맞는 거래가 없습니다.</p> : (
          <div className="money-table-wrap">
            <table>
              <thead>
                <tr><th>날짜</th><th>거래명</th><th>계좌·카드</th><th>분류</th><th>유형</th><th className="money-right">금액</th></tr>
              </thead>
              <tbody>
                {shown.slice(currentPage * 25, currentPage * 25 + 25).map((r) => (
                  <tr key={r.key} tabIndex={0} role="button" aria-label={`${r.name} 거래 상세`} onClick={() => setDetail(r)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setDetail(r); } }}>
                    <td className="money-muted">{r.date.replaceAll("-", ".")}</td>
                    <td>
                      {r.name}
                      {evCount.get(r.key) ? (
                        <span title={`증빙 ${evCount.get(r.key)}건`} style={{ marginLeft: 6, fontSize: 11, color: "#404040" }}>
                          📎{evCount.get(r.key)! > 1 ? evCount.get(r.key) : ""}
                        </span>
                      ) : null}
                    </td>
                    <td className="money-muted">{r.account}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <button type="button" disabled={r.category === "tips_refund"} aria-label={`${r.name} 카테고리 변경`} onKeyDown={(e) => e.stopPropagation()} onClick={() => setCategorySubject(r)}>{spendCategoryLabel(r.category)} ⌄</button>
                    </td>
                    <td className="money-muted">{r.type}</td>
                    <td className={`money-right${(r.amount ?? 0) < 0 ? " money-negative" : ""}`} style={{ fontWeight: 650 }}>
                      {r.amount == null ? "원화 미확정" : `${r.amount > 0 ? "+" : "−"}${wonFmt(Math.abs(r.amount))}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="money-card-header" style={{ marginTop: 16 }}><span className="money-sub">{shown.length ? `${currentPage * 25 + 1}–${Math.min((currentPage + 1) * 25, shown.length)} / ${shown.length}건` : "0건"}</span><span><button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>이전</button> <button type="button" disabled={(currentPage + 1) * 25 >= shown.length} onClick={() => setPage(currentPage + 1)}>다음</button></span></div>
      </section>

      {categorySubject && <MoneyCategoryPicker subject={categorySubject} onClose={() => setCategorySubject(null)} onSaved={() => { refresh(); setDetail(null); }} />}
      {detail && <MoneyTransactionDetail key={detail.key} detail={detail} evVersion={evVersion} onClose={() => setDetail(null)} onChanged={refresh} />}
    </>
  );
}
