"use client";
import { configureMerchantAliases } from "@/lib/finance/evidenceMatch";

import { FinanceSettings } from "./FinanceSettings";
import { fetchAppSettingJson } from "@/lib/data/settings";
import { configureProject, PROJECT } from "@/lib/lumos/catalog";
import { useCurrentUser } from "@/lib/auth/CurrentUserContext";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Info, RotateCw, Upload } from "lucide-react";
import { Badge } from "@/components/ds/core/Badge";
import { Button } from "@/components/ds/core/Button";
import { Spinner } from "@/components/ds/core/Spinner";
import { Card, CardBody, CardHeader } from "@/components/ds/data/Card";
import { Alert } from "@/components/ds/feedback/Alert";
import { Modal } from "@/components/ds/feedback/Modal";
import { Tabs } from "@/components/ds/navigation/Tabs";
import { useAnyAiJob } from "@/lib/hooks/useAiJob";
import { deleteSpendRule, fetchChargeSplits, fetchMoneyHistory, fetchMoneyCategories, fetchBudgets, fetchMoneyMonth, fetchSpendRules, fetchTipsMonth, importParsed, insertSpendRule, matchSpendRule, tipsBounds, type BankTx, type CardCharge, type ChargeSplit, type SpendRule, type TaxInvoice } from "@/lib/data/finance";
import { isExpenseCard } from "@/lib/finance/recordIntegrity";
import type { ParseResult } from "@/lib/finance/parse";
import { EvidenceUploader } from "./EvidenceUploader";
import { RcmsUploader, type RcmsNotice } from "./RcmsUploader";
import { TipsTab } from "./TipsTab";
import { LumosWorkspace } from "@/components/lumos/LumosWorkspace";
import { fmtWon, monthLabel } from "./shared";
import { MoneyShell, TipsToggle } from "./MoneyShell";
import { MoneyDashboard } from "./MoneyDashboard";
import { MoneySpending } from "./MoneySpending";
import { MoneyRecurring } from "./MoneyRecurring";
import { MoneyBudget } from "./MoneyBudget";
import { moneyMonths, moneyTransactionRows, type MoneyTransactionTarget, type MoneyTransactionRow, type MoneyTransactionFilters } from "@/lib/finance/transactions";
import { MoneyTransactionDetail } from "./MoneyTransactionDetail";
import { MoneyMonthPicker } from "./MoneyMonthPicker";
import { MoneyTransactions } from "./MoneyTransactions";
// 개편 전 Spending 화면(도넛·추이·Non-spending 묶음)을 그대로 쓴다.
import { SpendingTab as LegacySpendingTab } from "./legacy/SpendingTab";
import { MoneyAccounts } from "./MoneyAccounts";
import { SpendRulesModal } from "./SpendRulesModal";

/* Finance tool: upload KB bank/card statements and Hometax invoice lists,
   review the parsed rows, then work in four views — ledger, monthly sheet,
   tax invoices, and the TIPS (RCMS) worksheet. Amounts are parsed
   deterministically; only classification goes through AI. */

const NAV_TITLE: Record<string, { title: string }> = {
  home: { title: "한국 자산 한눈에 보기" },
  recurring: { title: "반복 결제" },
  spend: { title: "지출 분석" },
  budget: { title: "예산" },
  accounts: { title: "계좌와 자산" },
  tx: { title: "거래 내역" },
  nonspend: { title: "지출 분석 (내부)" },
  tips: { title: "TIPS 연구비" },
};

interface MonthData {
  bank: BankTx[];
  cards: CardCharge[];
  invoices: TaxInvoice[];
}

interface Preview {
  fileName: string;
  result: ParseResult;
}

export function FinanceWorkspace({ initialTab = "home" }: { initialTab?: string } = {}) {
  const user = useCurrentUser();
  useEffect(() => { fetchAppSettingJson<[string,string][]>("merchant_aliases").then(value => configureMerchantAliases(value || [])).catch(() => {}); }, []);
  useEffect(() => { fetchAppSettingJson<typeof PROJECT>("project").then(value => { if(value) configureProject(value); }).catch(() => {}); }, []);
  const [tab, setTab] = useState(initialTab);
  const [txFilters, setTxFilters] = useState<MoneyTransactionFilters>({});
  const [detail, setDetail] = useState<MoneyTransactionRow | null>(null);
  const [months, setMonths] = useState<string[]>([]);
  const selectedInitialMonth = useRef(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const openTransactions = (filters: MoneyTransactionFilters = {}) => { setTxFilters(filters); setTab("tx"); };
  // 비어 있는 워크스페이스는 현재 월로 시작하고, 기존 원장이 있으면 최신 자료 월을 연다.
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [data, setData] = useState<MonthData | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [importing, setImporting] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [lastImport, setLastImport] = useState<string | null>(null);
  // bumped after the evidence flow applies, so tabs refetch their links
  const [evVersion, setEvVersion] = useState(0);
  const [helpOpen, setHelpOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [rules, setRules] = useState<SpendRule[]>([]);

  useEffect(() => {
    let alive = true;
    fetchSpendRules().then((r) => { if (alive) setRules(r); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  async function addRule(pattern: string, category: string) {
    const rule = await insertSpendRule(pattern, category);
    setRules((previous) => [...previous.filter((item) => item.id !== rule.id), rule]);
    const applied = [...(data?.cards ?? []).map((row) => ({ name: row.merchant || row.itemName, category: row.spendCategory })), ...(data?.bank ?? []).map((row) => ({ name: row.counterparty || row.description, category: row.spendCategory }))]
      .filter((row) => !row.category && matchSpendRule([rule], [row.name])).length;
    reload(month);
    return applied;
  }

  async function removeRule(id: string) {
    await deleteSpendRule(id);
    setRules((previous) => previous.filter((rule) => rule.id !== id));
    reload(month);
  }
  const [tipsExcluded, setTipsExcluded] = useState(false);
  useEffect(() => {
    try { const value = localStorage.getItem("finance-exclude-tips"); queueMicrotask(() => setTipsExcluded(value === "true")); } catch { /* optional preference */ }
  }, []);
  const toggleTips = (value: boolean) => {
    setTipsExcluded(value);
    try { localStorage.setItem("finance-exclude-tips", String(value)); } catch { /* preference remains for this visit */ }
  };
  /** Monthly sheet(시산표)는 분할 줄까지 합산해야 해서 워크스페이스에서 한 번만 읽는다. */
  const [sheetSplits, setSheetSplits] = useState<ChargeSplit[]>([]);
  /** TIPS 탭은 카드 이용기간(당월 9일~익월 8일) 창을 따로 본다 — 다른 탭은 달력월. */
  const [tipsData, setTipsData] = useState<{ bank: BankTx[]; cards: CardCharge[] } | null>(null);
  const aiRunning = useAnyAiJob();
  const [rcmsNotice, setRcmsNotice] = useState<RcmsNotice | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    fetchChargeSplits()
      .then((d) => { if (alive) setSheetSplits(d); })
      .catch(() => { /* charge_splits SQL 미실행 환경 — 분할 없이 동작 */ });
    return () => { alive = false; };
  }, [month, evVersion]);

  const reload = useCallback((m: string) => {
    fetchMoneyMonth(m)
      .then(setData)
      .catch((err) => {
        console.error("finance month load failed:", err);
        setLoadError(true);
        setData({ bank: [], cards: [], invoices: [] });
      });
  }, []);

  useEffect(() => {
    let alive = true;
    queueMicrotask(() => { if (alive) { setData(null); setLoadError(false); } });
    fetchMoneyMonth(month)
      .then((d) => { if (alive) setData(d); })
      .catch(() => { if (alive) { setLoadError(true); setData({ bank: [], cards: [], invoices: [] }); } });
    return () => { alive = false; };
  }, [month]);

  useEffect(() => {
    let alive = true;
    queueMicrotask(() => { if (alive) setTipsData(null); });
    fetchTipsMonth(month)
      .then((d) => { if (alive) setTipsData(d); })
      .catch((err) => { console.error("tips month load failed:", err); if (alive) setTipsData({ bank: [], cards: [] }); });
    return () => { alive = false; };
  }, [month, evVersion, lastImport]);

  useEffect(() => {
    let alive = true;
    fetchMoneyHistory().then((history) => { if (alive) { const available = moneyMonths(history.cards, history.bank); setMonths(available); if (!selectedInitialMonth.current) { selectedInitialMonth.current = true; if (available.length) setMonth(available[0]); } } }).catch(() => {});
    return () => { alive = false; };
  }, [lastImport]);

  function openTransaction(target: MoneyTransactionTarget) {
    const row = moneyTransactionRows(data?.cards ?? [], data?.bank ?? [], tipsExcluded).find((item) => item.kind === target.kind && item.id === target.id);
    if (row) setDetail(row);
  }
  function refreshMoney() { reload(month); setEvVersion((version) => version + 1); }

  async function exportBackup() {
    setExporting(true); setExportError("");
    try {
      const [history, categories, rules, budgets, splits] = await Promise.all([fetchMoneyHistory(), fetchMoneyCategories(), fetchSpendRules(), fetchBudgets(), fetchChargeSplits()]);
      const backup = { exportedAt: new Date().toISOString(), ...history, categories, rules, budgets, splits };
      const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }));
      const link = document.createElement("a"); link.href = url; link.download = `finance-money-backup-${new Date().toISOString().slice(0, 10)}.json`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setExportError("백업을 만들지 못했습니다. 연결과 Finance 조회 권한을 확인해 주세요."); }
    finally { setExporting(false); }
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setUploadError(null);
    setLastImport(null);
    try {
      const { parseFinanceFile } = await import("@/lib/finance/parse");
      const result = await parseFinanceFile(file);
      setPreview({ fileName: file.name, result });
    } catch (err) {
      setUploadError(String((err as Error).message ?? err));
    }
    if (fileRef.current) fileRef.current.value = "";
  }

  async function confirmImport() {
    if (!preview) return;
    setImporting(true);
    setUploadError(null);
    try {
      const counts = await importParsed(preview.result, preview.fileName);
      const skipped =
        preview.result.cards.length - counts.cards +
        preview.result.bank.length - counts.bank +
        preview.result.invoices.length - counts.invoices;
      setLastImport(
        `Imported ${counts.cards + counts.bank + counts.invoices} new rows` +
        (skipped > 0 ? ` · ${skipped} duplicates skipped` : ""),
      );
      if (preview.result.month) setMonth(preview.result.month);
      else reload(month);
      setPreview(null);
    } catch (err) {
      console.error("finance import failed:", err);
      setUploadError(String((err as Error).message ?? err));
    } finally {
      setImporting(false);
    }
  }

  const counts = preview?.result;

  return (
    <div className="sx-scroll sx-page-wide" style={{ flex: 1, minHeight: 0, overflow: "auto", padding: 24 }}>
      <div style={{ maxWidth: 1600, margin: "0 auto", display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="sx-mobile-only" style={{ padding: "8px 12px", borderRadius: "var(--radius-md)", background: "var(--surface-sunken)", border: "1px solid var(--border-subtle)", color: "var(--text-muted)", fontSize: "var(--text-xs)" }}>
          모바일에서는 조회 전용으로 쓰는 화면입니다 · 업로드·분류 작업은 데스크톱에서 해주세요
        </div>
        {uploadError && <Alert tone="danger" title="Upload failed">{uploadError}</Alert>}
        {lastImport && <Alert tone="success" title={lastImport} />}
        {rcmsNotice && (
          <Alert tone={rcmsNotice.tone} title={rcmsNotice.title} onClose={() => setRcmsNotice(null)}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {rcmsNotice.lines.map((l, i) => <span key={i}>{l}</span>)}
            </div>
          </Alert>
        )}

        <MoneyShell
          nav={tab}
          onNav={(id) => { setTxFilters({}); setTab(id); }}
          title={NAV_TITLE[tab]?.title ?? "한국 자산 한눈에 보기"}
          subtitle={`${monthLabel(month)} 기준`}
          who={user.displayName}
          actions={
            <>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  style={{ display: "none" }}
                  onChange={(e) => onFile(e.target.files?.[0])}
                />
              <TipsToggle on={tipsExcluded} onChange={toggleTips} />
              <MoneyMonthPicker month={month} months={months} onChange={setMonth} />
              <button type="button" onClick={() => fileRef.current?.click()}>자료 올리기</button>
              <EvidenceUploader
                month={month}
                bank={data?.bank ?? []}
                cards={data?.cards ?? []}
                disabled={data === null}
                onApplied={() => { reload(month); setEvVersion((v) => v + 1); }}
              />
              <RcmsUploader
                bank={data?.bank ?? []}
                disabled={data === null}
                onApplied={() => { reload(month); setEvVersion((v) => v + 1); }}
                onNotice={setRcmsNotice}
              />
              <button type="button" onClick={() => { setData(null); setLoadError(false); reload(month); setEvVersion((v) => v + 1); }}>새로고침</button>
              <button type="button" onClick={() => { fetchSpendRules().then(setRules).catch(() => {}); setRulesOpen(true); }}>분류 규칙</button>
              <button type="button" onClick={() => setHelpOpen(true)} aria-label="Finance 사용 안내">자료 정보</button>
            </>
          }
        >
          {aiRunning && (
            <div className="money-review-banner">
              <span>AI 작업이 백그라운드에서 진행 중입니다 — 다른 화면으로 이동해도 계속됩니다.</span>
            </div>
          )}
          {loadError && <Alert tone="danger" title="불러오지 못했습니다. 연결을 확인하고 새로고침 해주세요." style={{ marginBottom: 12 }} />}
          {data === null ? (
            <div style={{ display: "grid", placeItems: "center", padding: 48 }}><Spinner /></div>
          ) : (
            <div key={tab === "req" || tab === "hist" || tab === "evidence" ? "lumos" : tab} className="sx-anim-view">
              {tab === "settings" && <FinanceSettings />}
              {tab === "home" && <MoneyDashboard month={month} bank={data.bank} cards={data.cards} splits={sheetSplits} tipsExcluded={tipsExcluded} onReview={() => openTransactions({ category: "uncategorized" })} onNav={(id) => { setTxFilters({}); setTab(id); }} onOpenTransaction={openTransaction} />}
              {tab === "spend" && <MoneySpending onMonthChange={setMonth} onTransactions={openTransactions} onOpenTransaction={openTransaction} month={month} bank={data.bank} cards={data.cards} splits={sheetSplits} tipsExcluded={tipsExcluded} />}
              {tab === "budget" && <MoneyBudget month={month} bank={data.bank} cards={data.cards} splits={sheetSplits} tipsExcluded={tipsExcluded} />}
              {tab === "tx" && <MoneyTransactions key={`${month}-${JSON.stringify(txFilters)}`} initialFilters={txFilters} tipsExcluded={tipsExcluded} month={month} evVersion={evVersion} bank={data.bank} cards={data.cards} onChanged={refreshMoney} />}
              {tab === "nonspend" && <LegacySpendingTab month={month} evVersion={evVersion} bank={data.bank} cards={data.cards} onChanged={refreshMoney} />}
              {tab === "recurring" && <MoneyRecurring month={month} cards={data.cards} bank={data.bank} tipsExcluded={tipsExcluded} onTransactions={openTransactions} onOpenTransaction={openTransaction} />}
              {tab === "accounts" && <MoneyAccounts month={month} bank={data.bank} cards={data.cards} onTransactions={openTransactions} />}
              {tab === "tips" && tipsData === null && <Spinner />}
              {tab === "tips" && tipsData !== null && (
                <TipsTab
                  month={month}
                  evVersion={evVersion}
                  rows={tipsData.cards}
                  bank={tipsData.bank}
                  windowLabel={`${tipsBounds(month).from} ~ ${(() => { const t = new Date(tipsBounds(month).to); t.setDate(t.getDate() - 1); return t.toISOString().slice(0, 10); })()}`}
                  onChanged={() => { reload(month); fetchTipsMonth(month).then(setTipsData).catch(() => {}); }}
                />
              )}
              {(tab === "req" || tab === "hist" || tab === "evidence") && <LumosWorkspace tab={tab === "req" ? "request" : tab === "hist" ? "history" : "evidence"} />}
            </div>
          )}
        </MoneyShell>
      </div>

      {detail && <MoneyTransactionDetail key={detail.key} detail={detail} evVersion={evVersion} onClose={() => setDetail(null)} onChanged={refreshMoney} />}

      <SpendRulesModal
        open={rulesOpen}
        rules={rules}
        onClose={() => setRulesOpen(false)}
        onAdd={addRule}
        onDelete={removeRule}
        onError={(msg) => setUploadError(msg)}
      />

      <Modal
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        title="Finance 사용 안내"
        size="lg"
        footer={
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <Button disabled={exporting} onClick={() => void exportBackup()}>{exporting ? "백업 준비 중…" : "데이터·분류 백업"}</Button>
            <Button onClick={() => setHelpOpen(false)}>확인</Button>
          </div>
        }
      >
        {exportError && <Alert tone="danger" title={exportError} />}
        {(() => {
          const sec: React.CSSProperties = { border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-md)", padding: "12px 14px", background: "var(--surface-default)" };
          const h: React.CSSProperties = { margin: "0 0 8px", fontSize: "var(--text-sm)", fontWeight: 700, color: "var(--text-strong)", display: "flex", alignItems: "center", gap: 6 };
          const ul: React.CSSProperties = { margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 5 };
          return (
            <div style={{ display: "flex", flexDirection: "column", gap: 12, fontSize: "var(--text-sm)", color: "var(--text-default)", lineHeight: 1.65 }}>
              <p style={{ margin: 0, color: "var(--text-muted)" }}>
                KB 통장·카드 내역과 홈택스 목록을 올리면 금액은 그대로 반영되고,
                <br />
                분류만 AI가 제안합니다 — 확정은 항상 사람이 합니다.
              </p>

              <section style={sec}>
                <h4 style={h}>📥 업로드 &amp; 파싱</h4>
                <ul style={ul}>
                  <li>
                    국민은행 거래내역 · 국민카드 <b>결제예정금액조회</b>(.xlsx) · 홈택스 세금계산서 목록을 업로드합니다.
                    <br />
                    카드는 승인내역이 아니라 <b>결제예정금액조회(매입 기준)</b>를 올려야
                    해외 결제의 원화 확정액까지 들어옵니다 — 승인내역에는 달러만 있어 &ldquo;원화 미확정&rdquo;으로 남습니다.
                  </li>
                  <li>같은 파일을 다시 올려도 중복 등록되지 않습니다.</li>
                  <li>증빙은 영수증 폴더째 올리면 파일명으로 각 거래에 자동 연결됩니다 (비증빙 파일은 자동 제외).</li>
                </ul>
              </section>

              <section style={sec}>
                <h4 style={h}>🗓 집계 기준 — 두 가지 달이 있습니다</h4>
                <ul style={ul}>
                  <li>
                    <b>Spending·Transactions 탭 = 달력월</b> (1일~말일)
                    <br />
                    카드는 매입일(없으면 승인일), 은행은 거래일 기준 — 6개월 지출 추이도 같은 기준이라 탭 합계와 일치합니다.
                  </li>
                  <li>
                    <b>TIPS 탭 = 카드 이용기간</b> (당월 9일~익월 8일)
                    <br />
                    카드사 청구·RCMS 대사가 이 구간이라, 같은 달이라도 Spending 합계와 다른 게 정상입니다.
                  </li>
                </ul>
              </section>

              <section style={sec}>
                <h4 style={h}>📊 카드 사용과 자체 부담액</h4>
                <ul style={ul}>
                  <li>기본 화면은 카드 순사용액입니다. 음수 취소·환급은 매입월에 차감하며 매입일이 없으면 승인일을 사용합니다.</li>
                  <li>TIPS 지원금 제외를 켜면 일반 통장 직접 출금 + 카드 순사용액 − 확인된 TIPS 환급을 표시합니다. 카드대금과 내부이체는 중복 제외됩니다.</li>
                  <li>환급은 거래 상세에서 같은 금액의 TIPS 통장 출금과 연결해 확인합니다. 받은 달에 차감하며 TIPS 체크만으로 차감하지 않습니다.</li>
                  <li>통장 잔액과 입출금은 실제 원장을 유지합니다. 이 수치는 현금 부담 흐름이며 TIPS 최종 인정액·정산 확정액과는 다릅니다.</li>
                </ul>
              </section>

              <section style={sec}>
                <h4 style={h}>🔎 내역 조회 방법</h4>
                <ul style={ul}>
                  <li><b>은행</b> : 국민은행 → 조회/이체 → 거래내역조회 → 기간 <b>당월 1일~말일</b></li>
                  <li>
                    <b>카드</b> : 국민카드 My Biz → 이용내역 → <b>결제예정금액 조회</b> → 엑셀 다운로드
                    <br />
                    (이용기간 <b>전월 9일~당월 8일</b> · TIPS 월별정산 때 받는 바로 그 파일 — 같은 거래는 승인번호로 자동 병합)
                  </li>
                  <li><b>TIPS 이체결과</b> : RCMS → 연구비 사용 → <b>연구비 이체결과</b> → 과제·기간 선택 → 우측 상단 엑셀 버튼</li>
                </ul>
              </section>

              <section style={sec}>
                <h4 style={h}>📄 TIPS 이체결과는 왜 올리나</h4>
                <ul style={ul}>
                  <li>통장에는 &ldquo;사업체 입금&rdquo;으로만 찍혀 무슨 목적의 연구비인지 알 수 없습니다.</li>
                  <li>
                    RCMS 이체결과의 비목·지급용도를 읽어
                    <br />
                    이체일·금액이 같은 통장 거래의 <b>기타란에 사용 목적</b>을 채워 넣습니다.
                  </li>
                  <li>직원·거래처로 바로 지급된 건은 통장에 안 찍히므로 대조 대상이 아니며, 결과 안내에 따로 표시됩니다.</li>
                </ul>
              </section>
            </div>
          );
        })()}
      </Modal>

      <Modal
        open={preview !== null}
        onClose={() => setPreview(null)}
        title="Review upload"
        subtitle={preview?.fileName}
        size="md"
        footer={
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Button variant="ghost" onClick={() => setPreview(null)}>Cancel</Button>
            <Button loading={importing} onClick={confirmImport}>Import</Button>
          </div>
        }
      >
        {counts && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12, fontSize: "var(--text-sm)" }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {counts.cards.length > 0 && <Badge tone="info">카드결제 {counts.cards.length}건</Badge>}
              {counts.bank.length > 0 && <Badge tone="info">계좌거래 {counts.bank.length}건</Badge>}
              {counts.invoices.length > 0 && <Badge tone="info">세금계산서 {counts.invoices.length}건</Badge>}
              {counts.month && <Badge tone="neutral">{counts.month}</Badge>}
            </div>
            {counts.warnings.map((w, i) => (
              <Alert key={i} tone="warning" title={w} />
            ))}
            <div style={{ color: "var(--text-muted)", fontSize: "var(--text-xs)" }}>
              {[
                ...counts.cards.slice(0, 5).map((c) => `카드 · ${c.approval_date ?? "N/A"} · ${c.merchant} · ${fmtWon(c.amount)}원`),
                ...counts.bank.slice(0, 5).map((b) => `계좌 · ${b.tx_date} · ${b.counterparty} · ${fmtWon(b.withdrawal ?? b.deposit)}원`),
                ...counts.invoices.slice(0, 5).map((v) => `계산서 · ${v.issue_date} · ${v.counterparty_name} · ${fmtWon(v.total_amount)}원`),
              ].map((line, i) => (
                <div key={i} style={{ padding: "2px 0" }}>{line}</div>
              ))}
              {counts.cards.length + counts.bank.length + counts.invoices.length > 5 && <div style={{ padding: "2px 0" }}>…</div>}
            </div>
            <div style={{ color: "var(--text-subtle)", fontSize: "var(--text-xs)" }}>
              Rows already imported (same date · merchant · amount) are skipped automatically.
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
