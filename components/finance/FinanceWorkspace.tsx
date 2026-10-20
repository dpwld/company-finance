"use client";

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
import { fetchSpendRules, fetchChargeSplits, fetchMoneyHistory, fetchMoneyCategories, fetchBudgets, fetchMoneyMonth, importParsed, type BankTx, type CardCharge, type ChargeSplit, type TaxInvoice } from "@/lib/data/finance";
import type { ParseResult } from "@/lib/finance/parse";
import { EvidenceUploader } from "./EvidenceUploader";
import { fmtWon, monthLabel } from "./shared";
import { MoneyShell } from "./MoneyShell";
import { MoneyDashboard } from "./MoneyDashboard";
import { MoneySpending } from "./MoneySpending";
import { MoneyRecurring } from "./MoneyRecurring";
import { MoneyBudget } from "./MoneyBudget";
import { moneyMonths, moneyTransactionRows, type MoneyTransactionTarget, type MoneyTransactionRow, type MoneyTransactionFilters } from "@/lib/finance/transactions";
import { MoneyTransactionDetail } from "./MoneyTransactionDetail";
import { MoneyMonthPicker } from "./MoneyMonthPicker";
import { MoneyTransactions } from "./MoneyTransactions";
// 개편 전 Spending 화면(도넛·추이·Non-spending 묶음)을 그대로 쓴다.
import { MoneyAccounts } from "./MoneyAccounts";
import { SpendRulesModal } from "./SpendRulesModal";

const NAV_TITLE: Record<string, { title: string }> = {
  home: { title: "Financial overview" },
  recurring: { title: "Recurring payments" },
  spend: { title: "Spending" },
  budget: { title: "Budget" },
  accounts: { title: "Accounts & cards" },
  tx: { title: "Transactions" },
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
  /** Monthly sheet(시산표)는 분할 줄까지 합산해야 해서 워크스페이스에서 한 번만 읽는다. */
  const [sheetSplits, setSheetSplits] = useState<ChargeSplit[]>([]);
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
    fetchMoneyHistory().then((history) => { if (alive) { const available = moneyMonths(history.cards, history.bank); setMonths(available); if (!selectedInitialMonth.current) { selectedInitialMonth.current = true; if (available.length) setMonth(available[0]); } } }).catch(() => {});
    return () => { alive = false; };
  }, [lastImport]);

  function openTransaction(target: MoneyTransactionTarget) {
    const row = moneyTransactionRows(data?.cards ?? [], data?.bank ?? []).find((item) => item.kind === target.kind && item.id === target.id);
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
    } catch { setExportError("Could not create a backup. Check your connection and access to Company Finance."); }
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
          Mobile is optimized for viewing. Use a desktop to import and categorize transactions.
        </div>
        {uploadError && <Alert tone="danger" title="Upload failed">{uploadError}</Alert>}
        {lastImport && <Alert tone="success" title={lastImport} />}

        <MoneyShell
          nav={tab}
          onNav={(id) => { setTxFilters({}); setTab(id); }}
          title={NAV_TITLE[tab]?.title ?? "Financial overview"}
          subtitle={monthLabel(month)}
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
              <MoneyMonthPicker month={month} months={months} onChange={setMonth} />
              <button type="button" className="money-primary" onClick={() => fileRef.current?.click()}>Import statements</button>
              <EvidenceUploader
                month={month}
                bank={data?.bank ?? []}
                cards={data?.cards ?? []}
                disabled={data === null}
                onApplied={() => { reload(month); setEvVersion((v) => v + 1); }}
              />
              <button type="button" onClick={() => { setData(null); setLoadError(false); reload(month); setEvVersion((v) => v + 1); }}>Refresh</button>
              <button type="button" onClick={() => setRulesOpen(true)}>Category rules</button>
              <button type="button" onClick={() => setHelpOpen(true)} aria-label="About Company Finance">Data guide</button>
            </>
          }
        >
          {loadError && <Alert tone="danger" title="Could not load data. Check your connection and refresh." style={{ marginBottom: 12 }} />}
          {data === null ? (
            <div style={{ display: "grid", placeItems: "center", padding: 48 }}><Spinner /></div>
          ) : (
            <div key={`${tab}-${evVersion}`} className="sx-anim-view">
              {tab === "home" && <MoneyDashboard month={month} bank={data.bank} cards={data.cards} splits={sheetSplits} onReview={() => openTransactions({ category: "uncategorized" })} onNav={(id) => { setTxFilters({}); setTab(id); }} onOpenTransaction={openTransaction} />}
              {tab === "spend" && <MoneySpending onMonthChange={setMonth} onTransactions={openTransactions} onOpenTransaction={openTransaction} month={month} bank={data.bank} cards={data.cards} splits={sheetSplits} />}
              {tab === "budget" && <MoneyBudget month={month} bank={data.bank} cards={data.cards} splits={sheetSplits} />}
              {tab === "tx" && <MoneyTransactions key={`${month}-${JSON.stringify(txFilters)}`} initialFilters={txFilters} month={month} evVersion={evVersion} bank={data.bank} cards={data.cards} onChanged={refreshMoney} />}
              {tab === "recurring" && <MoneyRecurring month={month} cards={data.cards} bank={data.bank} onTransactions={openTransactions} onOpenTransaction={openTransaction} />}
              {tab === "accounts" && <MoneyAccounts month={month} bank={data.bank} cards={data.cards} onTransactions={openTransactions} />}
            </div>
          )}
        </MoneyShell>
      </div>

      {detail && <MoneyTransactionDetail key={detail.key} detail={detail} evVersion={evVersion} onClose={() => setDetail(null)} onChanged={refreshMoney} />}


      <SpendRulesModal open={rulesOpen} onClose={() => setRulesOpen(false)} onChanged={refreshMoney} />

      <Modal
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        title="About Company Finance"
        size="lg"
        footer={
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <Button disabled={exporting} onClick={() => void exportBackup()}>{exporting ? "Preparing backup…" : "Export data & categories"}</Button>
            <Button onClick={() => setHelpOpen(false)}>Done</Button>
          </div>
        }
      >
        {exportError && <Alert tone="danger" title={exportError} />}
        <p>Review bank, card, and Hometax statements before importing. Duplicate records are skipped.</p>
        <p>Net card spending uses the posting month, or the approval date when unavailable. Bank cash flow and balances are shown separately.</p>
        <p>Only your categories and saved rules are used. Lower priority numbers run first; unmatched records stay uncategorized. Preview rules before applying them to existing transactions.</p>
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
              {counts.cards.length > 0 && <Badge tone="info">Card transactions: {counts.cards.length} records</Badge>}
              {counts.bank.length > 0 && <Badge tone="info">Bank transactions: {counts.bank.length} records</Badge>}
              {counts.invoices.length > 0 && <Badge tone="info">Tax invoices: {counts.invoices.length} records</Badge>}
              {counts.month && <Badge tone="neutral">{counts.month}</Badge>}
            </div>
            {counts.warnings.map((w, i) => (
              <Alert key={i} tone="warning" title={w} />
            ))}
            <div style={{ color: "var(--text-muted)", fontSize: "var(--text-xs)" }}>
              {[
                ...counts.cards.slice(0, 5).map((c) => `Card · ${c.approval_date ?? "N/A"} · ${c.merchant} · ${fmtWon(c.amount)} KRW`),
                ...counts.bank.slice(0, 5).map((b) => `Bank · ${b.tx_date} · ${b.counterparty} · ${fmtWon(b.withdrawal ?? b.deposit)} KRW`),
                ...counts.invoices.slice(0, 5).map((v) => `Invoice · ${v.issue_date} · ${v.counterparty_name} · ${fmtWon(v.total_amount)} KRW`),
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
