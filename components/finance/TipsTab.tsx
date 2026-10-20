"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import { SavedFlash } from "@/components/common/SavedFlash";
import { CreditCard, Download, Paperclip, RefreshCcw, Scissors, Sparkles, X } from "lucide-react";
import * as XLSX from "xlsx";
import { Badge } from "@/components/ds/core/Badge";
import { Button } from "@/components/ds/core/Button";
import { Modal } from "@/components/ds/feedback/Modal";
import { EmptyState } from "@/components/ds/feedback/EmptyState";
import { Select } from "@/components/ds/forms/Select";
import { SplitModal, type SplitSubject } from "./SplitModal";
import { bankFlow, bankAmount, bankAmountColumn, isExpenseCard, type FinanceFlow } from "@/lib/finance/recordIntegrity";
import { validateClassifications, type CardProposal } from "@/lib/finance/classificationPolicy";
import { clearJobResult, startJob } from "@/lib/finance/aiJobs";
import { useAiJob } from "@/lib/hooks/useAiJob";
import {
  fetchChargeSplits, fetchConfirmedTipsHistory, updateBankTx, updateCardCharge, updateChargeSplit,
  type BankTx, type CardCharge, type ChargeSplit, type ConfirmedTipsCase,
} from "@/lib/data/finance";
import {
  deleteEvidence, evidenceUrl, fetchEvidence, linkEvidence, unlinkEvidence,
  type EvidenceFile, type EvidenceLink, type EvidenceTarget,
} from "@/lib/data/evidence";
import { cellInput, cellInputNum, downloadBlob, fmtWon, parseWon, td, tdNum, th } from "./shared";
import { useColWidths, resizeHandleStyle } from "@/lib/hooks/useColWidths";

/* 열이 많아 가로 스크롤 없이는 표가 다 보이지 않아, 이 표만 조밀하게 쓴다. */
const tdc: React.CSSProperties = { ...td, padding: "3px 6px", overflow: "hidden", overflowWrap: "anywhere" };
const tdcNum: React.CSSProperties = { ...tdNum, padding: "3px 6px" };
const thc: React.CSSProperties = { ...th, padding: "6px 6px", letterSpacing: 0 };

/* 열 너비는 여기 한 곳에서만 정하고, 표는 table-layout: fixed 로 그 값을 그대로
   쓴다. auto 였을 때는 증빙 파일명처럼 긴 내용이 있는 열이 폭을 가져가면서
   상태 셀렉트가 화살표만 남을 만큼 찌그러졌다. */
const COL_W: Record<string, number> = {
  gubun: 46, date: 64, merchant: 150, industry: 88, item: 112, vat: 72,
  amount: 92, detail: 92, classification: 120, status: 128, remarks: 136, evidence: 112,
};
const TABLE_MIN = Object.values(COL_W).reduce((a, b) => a + b, 0);

/* TIPS (RCMS) monthly spending worksheet. Every OUTGOING line for the month —
   card charges AND bank transfers (출금) — is listed so budget-eligible spend
   paid either way (card, or a wire like rent/accounting fees) can be classified
   and evidenced. Upload the receipt folder in the header; filenames auto-link,
   the AI reads leftovers, and each row offers its receipts for download. */

/* 담당자가 쓰는 상태. 복원중·복원완료는 이미 지원받은 자금을 다시 반납(집행 취소)하는
   흐름 — 루모스가 가상계좌를 주면 입금하고, 전산 반영되면 복원완료가 된다. */
const STATUS_OPTIONS = ["", "검토가능", "접수완료", "처리완료", "처리불가(연구관련X)", "확인필요", "복원중", "복원완료", "해당없음"];

/** 상태 셀렉트의 배지형 색상 — Badge 톤과 같은 계열. */
/* 배지형 상태 셀렉트의 색. arrow는 SVG data URI 안에 들어가는데 그 안에서는
   CSS 변수가 해석되지 않아(별도 문서) 화살표가 통째로 사라졌다 — arrow만 실제
   색상값으로 둔다. */
const STATUS_COLORS: Record<"success" | "danger" | "warning" | "neutral", { bg: string; fg: string; border: string; arrow: string }> = {
  success: { bg: "var(--green-50, #fafafa)", fg: "var(--green-700, #646464)", border: "var(--green-200, #e7e7e7)", arrow: "#646464" },
  danger: { bg: "var(--red-50, #f5f5f5)", fg: "var(--red-700, #3d3d3d)", border: "var(--red-200, #d5d5d5)", arrow: "#3d3d3d" },
  warning: { bg: "var(--amber-50, #fbfbfb)", fg: "var(--amber-700, #626262)", border: "var(--amber-200, #e4e4e4)", arrow: "#626262" },
  neutral: { bg: "var(--surface-sunken)", fg: "var(--text-muted)", border: "var(--border-default)", arrow: "#727272" },
};

const STATUS_TONE: Record<string, "success" | "danger" | "warning" | "neutral"> = {
  처리완료: "success",
  접수완료: "success",
  복원완료: "success",
  복원중: "warning",
  "처리불가(연구관련X)": "danger",
  확인필요: "warning",
};

/** Logical field → DB column, per source (bank has no VAT column). */
const CARD_COL: Record<string, string> = { vat: "vat", amount: "amount", classification: "classification", status: "status", remarks: "remarks" };
const BANK_COL: Record<string, string> = { amount: "withdrawal", classification: "category", status: "status", remarks: "tips_note" };

/** One outgoing line, normalised across card charges and bank withdrawals. */
interface SpendRow {
  kind: "card" | "bank";
  id: string;
  date: string | null;
  merchant: string;
  industry: string;
  itemName: string;
  vat: number | null; // card only
  amount: number | null;
  classification: string;
  status: string;
  remarks: string;
  fxPlaceholder: string;
  flow: FinanceFlow;
  amountColumn?: "deposit" | "withdrawal" | null;
}

interface Props {
  month: string;
  /** bumped by the header evidence flow — refetch links */
  evVersion: number;
  rows: CardCharge[];
  bank: BankTx[];
  /** 이 탭이 보고 있는 카드 이용기간 (예: "2026-07-09 ~ 2026-08-08"). */
  windowLabel?: string;
  onChanged: () => void;
}

export function TipsTab({ month, evVersion, rows, bank, windowLabel, onChanged }: Props) {
  const job = useAiJob("tips-classify");
  const classifying = job.running;
  // 분할(세부항목) 줄 — 분할된 카드 거래는 세부항목별로 행이 나뉜다.
  const [splits, setSplits] = useState<ChargeSplit[]>([]);
  /** 지난달까지 확정한 판정 — AI 분류에 예시로 넣어 같은 성격을 같게 판정하게 한다. */
  const [confirmedHistory, setConfirmedHistory] = useState<ConfirmedTipsCase[]>([]);
  const [splitSubject, setSplitSubject] = useState<SplitSubject | null>(null);
  const [confirmReclassify, setConfirmReclassify] = useState(false);
  const [confirmDeleteEv, setConfirmDeleteEv] = useState<EvidenceFile | null>(null);
  /** "all" | "" (미확인) | 상태 문자열 — 목록·합계가 이 필터를 따른다 */
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [flowFilter, setFlowFilter] = useState<FinanceFlow>("expense");
  const [proposals, setProposals] = useState<(CardProposal & { title: string; accepted: boolean })[]>([]);
  const [applyingProposals, setApplyingProposals] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 백그라운드 분류가 끝나면(다른 탭에 있었어도) 화면을 한 번 새로 읽는다
  const lastJobRef = useRef<number | null>(null);
  useEffect(() => {
    if (!job.finishedAt || lastJobRef.current === job.finishedAt) return;
    lastJobRef.current = job.finishedAt;
    if (job.error) return; // 오류는 아래 배지에서 job.message로 바로 보여준다
    fetchChargeSplits().then(setSplits).catch(() => {}).finally(() => onChanged());
  }, [job.finishedAt, job.error, onChanged]);

  const [savedTick, setSavedTick] = useState(0);

  const [ev, setEv] = useState<{ files: EvidenceFile[]; links: EvidenceLink[] } | null>(null);
  const [manualPick, setManualPick] = useState<Record<string, string>>({});

  // Drag-resizable columns, widths persisted per user (localStorage).
  const { widths: colW, startResize } = useColWidths("finance-tips-v2");
  const rth = (key: string, label: string, extra: React.CSSProperties = {}) => (
    <th style={{ ...thc, ...extra, width: colW[key] ?? COL_W[key], position: "relative" }}>
      {label}
      <span
        style={resizeHandleStyle}
        onMouseDown={(e: React.MouseEvent) => {
          const el = e.currentTarget.parentElement;
          startResize(key, el ? el.getBoundingClientRect().width : 120)(e);
        }}
      />
    </th>
  );

  // The worksheet lists SPENDING only: card charges that aren't cancellations
  // (positive amount / non-negative FX) + bank withdrawals. Sorted by date.
  const spendRows = useMemo<SpendRow[]>(() => {
    const cards: SpendRow[] = rows
      .filter(isExpenseCard)
      .map((c) => ({
        kind: "card", id: c.id, date: c.approvalDate, merchant: c.merchant, industry: c.industry,
        itemName: c.itemName, vat: c.vat, amount: c.amount, classification: c.classification,
        status: c.status, remarks: c.remarks, fxPlaceholder: c.cardMeta["해외승인금액"] || "원화 미확정", flow: "expense",
      }));
    // 지출(출금)이 기본이지만, RCMS에서 들어온 연구비 입금도 함께 보여준다 —
    // TIPS 이체결과로 사용 목적이 기록된 건이라 여기서 확인·수정할 수 있어야 한다.
    const banks: SpendRow[] = bank
      .filter((b) => (b.withdrawal ?? 0) > 0 || (b.deposit ?? 0) > 0)
      .map((b) => ({
        kind: "bank", id: b.id, date: b.txDate, merchant: b.counterparty, industry: b.description,
        itemName: b.memo, vat: null, amount: bankAmount(b), classification: b.category,
        status: b.status, remarks: b.tipsNote, fxPlaceholder: "입출금 확인", flow: bankFlow(b), amountColumn: bankAmountColumn(b),
      }));
    return [...cards, ...banks].sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
  }, [rows, bank]);

  const splitsByCharge = useMemo(() => {
    const m = new Map<string, ChargeSplit[]>();
    for (const s of splits) {
      const arr = m.get(s.cardChargeId) ?? [];
      arr.push(s);
      m.set(s.cardChargeId, arr);
    }
    return m;
  }, [splits]);

  // 분류 대상: 분할된 거래는 세부항목 줄이 대상, 원거래는 제외.
  const spendingCards = rows.filter(isExpenseCard);
  const splitsByBank = useMemo(() => {
    const m = new Map<string, ChargeSplit[]>();
    for (const s of splits) {
      if (!s.bankTxId) continue;
      const list = m.get(s.bankTxId) ?? [];
      list.push(s);
      m.set(s.bankTxId, list);
    }
    return m;
  }, [splits]);
  const unclassified = spendingCards.filter((c) => !c.status && !(splitsByCharge.get(c.id)?.length));
  const unclassifiedSplits = spendingCards.flatMap((c) =>
    (splitsByCharge.get(c.id) ?? []).filter((s) => !s.status).map((s) => ({ charge: c, split: s })),
  );
  const pendingClassify = unclassified.length + unclassifiedSplits.length;
  // 이미 판정된 건까지 포함한 전체 대상 — "전체 재분류"용
  const allCards = spendingCards.filter((c) => !(splitsByCharge.get(c.id)?.length));
  const allSplits = spendingCards.flatMap((c) =>
    (splitsByCharge.get(c.id) ?? []).map((s) => ({ charge: c, split: s })),
  );
  const classifyAll = allCards.length + allSplits.length;
  const needsCheck = spendRows.filter((r) => r.status === "확인필요");
  const viewRows = spendRows.filter((r) => r.flow === flowFilter);
  const shown = statusFilter === "all" ? viewRows : viewRows.filter((r) => (r.status || "") === statusFilter);
  // 필터 옵션: 고정 라벨 + 데이터에 실제로 있는 커스텀 상태(소액 미처리 등)
  const statusChoices = useMemo(() => {
    const seen = new Set(STATUS_OPTIONS);
    const extra = [...new Set(spendRows.map((r) => r.status).filter((st) => st && !seen.has(st)))];
    return [...STATUS_OPTIONS, ...extra];
  }, [spendRows]);
  const countOf = (st: string) => viewRows.filter((r) => (r.status || "") === st).length;
  // 하단 합계 — 현재 필터로 보이는 행 기준
  const totals = {
    vat: shown.reduce((a, r) => a + (r.vat ?? 0), 0),
    amount: shown.reduce((a, r) => a + (r.amount ?? 0), 0),
    unknown: shown.filter((r) => r.amount == null).length,
  };

  useEffect(() => {
    let alive = true;
    fetchEvidence(month, { cards: rows.map((r) => r.id), bank: bank.map((r) => r.id) })
      .then((data) => { if (alive) setEv(data); })
      .catch(() => { if (alive) { setEv({ files: [], links: [] }); setError("증빙 정보를 불러오지 못했습니다. 새로고침 해주세요."); } });
    fetchChargeSplits()
      .then((data) => { if (alive) setSplits(data); })
      .catch(() => { /* charge_splits SQL 미실행 환경 — 분할 없이 동작 */ });
    fetchConfirmedTipsHistory()
      .then((data) => { if (alive) setConfirmedHistory(data); })
      .catch(() => { /* 이력 조회 실패 — 학습 예시 없이 동작 */ });
    return () => { alive = false; };
  }, [month, evVersion, rows, bank]);

  const filesById = useMemo(() => new Map((ev?.files ?? []).map((f) => [f.id, f])), [ev]);
  const linksByRowId = useMemo(() => {
    const m = new Map<string, { file: EvidenceFile; link: EvidenceLink }[]>();
    for (const link of ev?.links ?? []) {
      const key = link.cardChargeId ?? link.bankTxId;
      if (!key) continue;
      const file = filesById.get(link.evidenceId);
      if (!file) continue;
      const arr = m.get(key) ?? [];
      arr.push({ file, link });
      m.set(key, arr);
    }
    return m;
  }, [ev, filesById]);
  const linkedFileIds = useMemo(() => new Set((ev?.links ?? []).map((l) => l.evidenceId)), [ev]);
  const unlinkedFiles = (ev?.files ?? []).filter((f) => !linkedFileIds.has(f.id));

  const targetOf = (r: SpendRow): EvidenceTarget => (r.kind === "card" ? { cardChargeId: r.id } : { bankTxId: r.id });

  async function reloadEvidence() {
    setEv(await fetchEvidence(month, { cards: rows.map((r) => r.id), bank: bank.map((r) => r.id) }));
  }

  async function openEvidence(file: EvidenceFile) {
    try {
      window.open(await evidenceUrl(file.storagePath), "_blank", "noopener");
    } catch {
      setError("다운로드 링크 생성 실패");
    }
  }

  /** AI 분류 — 모듈 스코프에서 돌려 탭을 옮겨도 계속된다(useAiJob으로 진행 표시). */
  function classify(all = false) {
    setError(null);
    // 시작 시점 입력을 캡처한다 — 컴포넌트가 사라져도 그대로 쓰인다
    const targetCards = all ? [...allCards] : [...unclassified];
    const targetSplits = all ? [...allSplits] : [...unclassifiedSplits];
    const history = [...confirmedHistory];
    const cardsForLearning = [...spendingCards];
    const linksSnapshot = new Map(linksByRowId);
    startJob("tips-classify", async (h) => {
      h.progress(0, targetCards.length + targetSplits.length);
      // 과거 판정 이력(자동 생성 여부가 확인되지 않은 참고 자료) — AI가 같은 성격을 같게 판정하도록 예시로 전달
      const thisMonth = cardsForLearning
        .filter((c) => c.status && (c.merchant || c.itemName))
        .map((c) => ({ merchant: c.merchant, itemName: c.itemName, classification: c.classification, status: c.status, note: c.remarks }));
      const learned = [...thisMonth, ...history].slice(0, 120);

      const res = await fetch("/api/finance/classify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          learned,
          cards: [
            ...targetCards.map((c) => ({
              id: c.id, merchant: c.merchant, industry: c.industry,
              itemName: c.itemName, amount: c.amount, approvalDate: c.approvalDate,
              // 연결된 증빙 파일명 — 파일명의 용도 설명이 판정의 1차 근거
              evidence: (linksSnapshot.get(c.id) ?? []).map((e) => e.file.fileName),
            })),
            // 분할된 거래의 세부항목 줄 — 항목명·분할 금액으로 개별 판정
            ...targetSplits.map(({ charge, split }) => ({
              id: `split:${split.id}`, merchant: `${charge.merchant} · ${split.label || "세부항목"}`,
              industry: charge.industry, itemName: split.label, amount: split.amount, approvalDate: charge.approvalDate,
              evidence: (linksSnapshot.get(charge.id) ?? []).map((e) => e.file.fileName),
            })),
          ],
        }),
      });
      const json = (await res.json() as any);
      if (!res.ok) throw new Error(json.detail || json.error || `HTTP ${res.status}`);
      const ids = [...targetCards.map((c) => c.id), ...targetSplits.map(({ split }) => `split:${split.id}`)];
      const results = validateClassifications(json, ids, []).cards;
      h.setResult(results.map((c) => ({ ...c, accepted: false,
        title: targetCards.find((r) => r.id === c.id)?.merchant ?? targetSplits.find(({ split }) => `split:${split.id}` === c.id)?.split.label ?? c.id,
      })));
      h.progress(results.length, ids.length);
      return `${results.length}건 제안: 검토 후 선택한 항목만 반영하세요`;

    });
  }

  useEffect(() => {
    if (!job.result) return;
    queueMicrotask(() => {
      setProposals(job.result as (CardProposal & { title: string; accepted: boolean })[]);
      clearJobResult("tips-classify");
    });
  }, [job.result]);

  async function applyProposals() {
    setApplyingProposals(true);
    try {
      for (const c of proposals.filter((r) => r.accepted)) {
        // 미확인 행은 AI 제안 상태(검토가능/확인필요/처리불가/해당없음)를 상태
        // 셀렉트에 바로 지정한다 (2026-10-01 피드백 — 기타란 프리픽스 대신).
        // 접수완료·처리완료·복원 등 이미 처리된 상태는 절대 덮지 않는다.
        const isSplit = c.id.startsWith("split:");
        const current = isSplit
          ? splits.find((sp) => sp.id === c.id.slice(6))?.status ?? ""
          : rows.find((r) => r.id === c.id)?.status ?? "";
        const patch = current
          ? { classification: c.classification, remarks: `[AI 검토: ${c.status}] ${c.note}` }
          : { classification: c.classification, status: c.status, remarks: c.note };
        if (isSplit) await updateChargeSplit(c.id.slice(6), patch);
        else await updateCardCharge(c.id, patch);
      }
      setProposals([]);
      onChanged();
      setSplits(await fetchChargeSplits());
    } catch {
      setError("제안 반영에 실패했습니다. 현재 내역을 확인하고 다시 시도하세요.");
    } finally { setApplyingProposals(false); }
  }

  async function saveSplitField(id: string, patch: Parameters<typeof updateChargeSplit>[1]) {
    try {
      await updateChargeSplit(id, patch);
      setSplits((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
      setSavedTick((v) => v + 1);
    } catch (err) {
      console.error("split save failed:", err);
      setError("세부항목 저장 실패 · 2026-08-05d SQL 실행 여부를 확인하세요.");
    }
  }

  /** Amounts stay editable — FX charges get their KRW figure later and VAT
     splits sometimes need a manual correction. */
  async function saveAmount(r: SpendRow, logical: "vat" | "amount", prev: number | null, text: string) {
    const col = r.kind === "card" ? CARD_COL[logical] : logical === "amount" ? r.amountColumn : null;
    if (!col) return; // ambiguous incoming/outgoing rows require source review
    const next = parseWon(text);
    if (next === undefined) { setError("숫자만 입력해 주세요"); return; }
    if (next === prev) return;
    try {
      if (r.kind === "card") await updateCardCharge(r.id, { [col]: next });
      else await updateBankTx(r.id, { [col]: next });
      setSavedTick((v) => v + 1);
      onChanged();
    } catch (err) {
      console.error("amount save failed:", err);
      setError("Save failed");
    }
  }

  /** 상태 변경에 따른 TIPS 체크 동기화 — 접수완료·처리완료 = 지원금 집행이므로
     tips_funded 체크(지출 집계 제외, 카테고리는 그대로 유지), 복원완료(반납)는
     체크 해제로 실지출 복귀. 그 외 상태는 건드리지 않는다. */
  function tipsFlagSync(status: string): boolean | undefined {
    if (status === "접수완료" || status === "처리완료") return true;
    if (status === "복원완료") return false;
    return undefined;
  }

  async function saveField(r: SpendRow, logical: "classification" | "status" | "remarks", prev: string, value: string) {
    if (value === prev) return;
    const col = r.kind === "card" ? CARD_COL[logical] : BANK_COL[logical];
    if (!col) return;
    try {
      const patch: Record<string, unknown> = { [col]: value };
      if (logical === "status") {
        // 입금 행도 동기화한다 — 지원금 수령 확인(접수/처리완료)이면 TIPS 입금으로 집계.
        const next = tipsFlagSync(value);
        if (next !== undefined) patch.tips_funded = next;
      }
      if (r.kind === "card") await updateCardCharge(r.id, patch);
      else await updateBankTx(r.id, patch);
      setSavedTick((v) => v + 1);
      onChanged();
    } catch (err) {
      console.error("row save failed:", err);
      setError("Save failed");
    }
  }

  function exportXlsx() {
    const data = shown.map((r) => ({
      구분: r.kind === "card" ? "카드" : "은행",
      승인일: r.date?.replace(/-/g, "") ?? "",
      가맹점명: r.merchant,
      업종: r.industry,
      명칭: r.itemName,
      부가세: r.vat ?? "",
      합계: r.amount ?? "",
      "처리된 항목": r.classification,
      상태: r.status,
      기타: r.remarks,
      증빙: (linksByRowId.get(r.id) ?? []).map((e) => e.file.fileName).join("; "),
    }));
    const ws = XLSX.utils.json_to_sheet(data, {
      header: ["구분", "승인일", "가맹점명", "업종", "명칭", "부가세", "합계", "처리된 항목", "상태", "기타", "증빙"],
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "결제예정금액조회");
    const out = XLSX.write(wb, { type: "array", bookType: "xlsx" });
    downloadBlob(`${month}-${flowFilter}-검토내역.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", out);
  }

  if (!rows.length && !bank.filter((b) => (b.withdrawal ?? 0) > 0 || (b.deposit ?? 0) > 0).length) {
    return (
      <EmptyState
        icon={<CreditCard size={24} />}
        title="No spending this month"
        description={"Upload the card settlement (.xlsx) or a KB transfer statement in the Transactions tab."}
      />
    );
  }

  const rowOptions = spendRows.map((r) => ({
    value: r.id,
    label: `${r.kind === "bank" ? "은행" : "카드"} ${r.date?.slice(5) ?? "?"} ${r.merchant} ${r.amount != null ? fmtWon(r.amount) : ""}`.trim(),
  }));

  return (
    <div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        {([
          ["expense", "지출 검토"], ["inflow", "입금·지원금 확인"],
          ["transfer", "내부이체·카드대금"], ["review", "입출금 오류 확인"],
        ] as const).map(([value, label]) => (
          <Button key={value} size="sm" variant={flowFilter === value ? "primary" : "ghost"}
            onClick={() => { setFlowFilter(value); setStatusFilter("all"); }}>
            {label} ({spendRows.filter((r) => r.flow === value).length})
          </Button>
        ))}
      </div>
      <p style={{ color: "var(--text-muted)", fontSize: "var(--text-xs)", margin: "0 0 12px" }}>
        회사 지출과 입금·자금 이동을 구분합니다. 지출 합계는 TIPS 인정금액이 아니며,
        입금의 지원금 여부·접수·정산 완료는 RCMS 원본과 담당자 확인이 필요합니다.
        {totals.unknown > 0 && ` 원화 미확정 ${totals.unknown}건은 합계에서 빠져 있습니다.`}
      </p>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: 10, gap: 10, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <Badge tone="neutral">{shown.length} / {viewRows.length} 건</Badge>
          {ev && ev.files.length > 0 && <Badge tone="info">증빙 {ev.files.length}</Badge>}
          {windowLabel && (
            <span style={{ fontSize: "var(--text-2xs)", color: "var(--text-subtle)", fontFamily: "var(--font-mono)" }} title="TIPS는 카드 이용기간(당월 9일~익월 8일) 기준으로 조회합니다">
              이용기간 {windowLabel}
            </span>
          )}
          <Select
            size="sm"
            value={statusFilter}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setStatusFilter(e.target.value)}
            options={[
              { value: "all", label: `전체 (${viewRows.length})` },
              ...statusChoices.map((st) => ({ value: st, label: `${st || "미확인"} (${countOf(st)})` })),
            ]}
            aria-label="상태 필터"
            style={{ width: 190 }}
          />
          {needsCheck.length > 0 && (
            <Button size="sm" variant={statusFilter === "확인필요" ? "secondary" : "ghost"}
              onClick={() => setStatusFilter((f) => (f === "확인필요" ? "all" : "확인필요"))}>
              확인필요 {needsCheck.length} : 회계법인 문의
            </Button>
          )}
          <SavedFlash tick={savedTick} />
          {error && <Badge tone="danger">{error}</Badge>}
          {job.error && job.message && <Badge tone="danger">AI 작업 실패: {job.message}</Badge>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Button size="sm" variant="soft" leftIcon={<Sparkles size={14} />} loading={classifying} disabled={classifying || !pendingClassify} onClick={() => classify()}>
            {classifying
              ? `분류 중${job.total ? ` ${job.done}/${job.total}` : ""}…`
              : `AI classify${pendingClassify ? ` (${pendingClassify})` : ""}`}
          </Button>
          <Button size="sm" variant="ghost" leftIcon={<RefreshCcw size={13} />} disabled={classifying || !classifyAll}
            title="기존 상태를 보존하고 새 검토 제안을 만듭니다"
            onClick={() => setConfirmReclassify(true)}>
            전체 재분류{classifyAll ? ` (${classifyAll})` : ""}
          </Button>
          <Button size="sm" variant="ghost" leftIcon={<Download size={14} />} onClick={exportXlsx}>
            현재 보기 .xlsx
          </Button>
        </div>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", minWidth: TABLE_MIN, tableLayout: "fixed", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {rth("gubun", "구분")}
              {rth("date", "승인일")}
              {rth("merchant", "가맹점명")}
              {rth("industry", "업종")}
              {rth("item", "명칭")}
              {rth("vat", "부가세", { textAlign: "right" })}
              {rth("amount", "합계", { textAlign: "right" })}
              {rth("detail", "세부항목")}
              {rth("classification", "처리된 항목")}
              {rth("status", "상태")}
              {rth("remarks", "기타")}
              {rth("evidence", "증빙")}
            </tr>
          </thead>
          <tbody key={shown.map((r) => r.id).join() + "|" + splits.map((s) => s.id + s.classification + s.status + s.remarks).join()}>
            {shown.map((r) => {
              const sp = r.kind === "card" ? (splitsByCharge.get(r.id) ?? []) : (splitsByBank.get(r.id) ?? []);
              const span = Math.max(sp.length, 1);
              // 공통(rowSpan) 셀 — 분할이 있으면 첫 세부항목 행에만 붙는다.
              const leadCells = (
                <>
                  <td style={tdc} rowSpan={span}><Badge tone={r.kind === "card" ? "warning" : "info"} size="sm">{r.kind === "card" ? "카드" : "은행"}</Badge></td>
                  <td style={{ ...tdc, fontFamily: "var(--font-mono)", color: "var(--text-muted)", whiteSpace: "nowrap" }} rowSpan={span}>{r.date?.slice(5) ?? "N/A"}</td>
                  <td style={{ ...tdc, fontWeight: 500, color: "var(--text-strong)" }} rowSpan={span}>{r.merchant}</td>
                  <td style={{ ...tdc, color: "var(--text-muted)" }} rowSpan={span}>{r.industry}</td>
                  <td style={{ ...tdc, color: "var(--text-muted)" }} rowSpan={span}>{r.itemName}</td>
                  <td style={{ ...tdcNum, padding: "2px 4px", color: "var(--text-muted)" }} rowSpan={span}>
                    {r.kind === "card" ? (
                      <input
                        style={cellInputNum}
                        defaultValue={fmtWon(r.vat)}
                        placeholder="N/A"
                        inputMode="numeric"
                        onFocus={(e) => (e.currentTarget.style.borderColor = "var(--color-primary)")}
                        onBlur={(e) => {
                          e.currentTarget.style.borderColor = "transparent";
                          saveAmount(r, "vat", r.vat, e.currentTarget.value);
                        }}
                      />
                    ) : (
                      <span style={{ color: "var(--text-subtle)" }}>N/A</span>
                    )}
                  </td>
                  <td style={{ ...tdcNum, padding: "2px 4px", fontWeight: 600 }} rowSpan={span}>
                    <input
                      style={{ ...cellInputNum, fontWeight: 600 }}
                      defaultValue={fmtWon(r.amount)}
                      placeholder={r.fxPlaceholder}
                      inputMode="numeric"
                      onFocus={(e) => (e.currentTarget.style.borderColor = "var(--color-primary)")}
                      onBlur={(e) => {
                        e.currentTarget.style.borderColor = "transparent";
                        saveAmount(r, "amount", r.amount, e.currentTarget.value);
                      }}
                    />
                  </td>
                </>
              );
              const evidenceCell = (
                <td style={{ ...td }} rowSpan={span}>
                  <span style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {(linksByRowId.get(r.id) ?? []).map(({ file, link }) => (
                      <span key={file.id} title={link.note || file.fileName}
                        style={{
                          display: "inline-flex", alignItems: "center", gap: 3, maxWidth: "100%",
                          fontSize: "var(--text-2xs)", background: "var(--surface-sunken)",
                          border: "1px solid var(--border-subtle)", borderRadius: 999, padding: "1px 7px",
                        }}
                      >
                        <Paperclip size={10} style={{ flexShrink: 0 }} />
                        <span role="button" onClick={() => openEvidence(file)}
                          style={{ cursor: "pointer", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--color-primary)" }}>
                          {file.fileName}
                        </span>
                        <X size={10} style={{ cursor: "pointer", flexShrink: 0, color: "var(--text-subtle)" }}
                          onClick={async () => { await unlinkEvidence(file.id, targetOf(r)); reloadEvidence(); }} />
                      </span>
                    ))}
                    {!(linksByRowId.get(r.id) ?? []).length && <span style={{ color: "var(--text-subtle)" }}>–</span>}
                  </span>
                </td>
              );
              // 상태 = 표시와 변경을 겸하는 셀렉트 하나. 배지처럼 색이 들어가고
              // 클릭하면 바로 목록이 열린다(배지 + 셀렉트 이중 표시를 없앰).
              const statusSelect = (value: string, onSave: (v: string) => void) => {
                const tone = value ? (STATUS_TONE[value] ?? "neutral") : "neutral";
                const palette = STATUS_COLORS[tone];
                return (
                  <select
                    value={value}
                    onChange={(e) => onSave(e.target.value)}
                    aria-label="상태"
                    title={value || "미확인"}
                    style={{
                      width: "100%",
                      maxWidth: 190,
                      appearance: "none",
                      WebkitAppearance: "none",
                      cursor: "pointer",
                      fontSize: "var(--text-2xs)",
                      fontWeight: 600,
                      lineHeight: 1.6,
                      padding: "3px 18px 3px 8px",
                      borderRadius: 999,
                      border: `1px solid ${palette.border}`,
                      background: `${palette.bg} url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='${encodeURIComponent(palette.arrow)}' stroke-width='3'><path d='M6 9l6 6 6-6'/></svg>") no-repeat right 5px center`,
                      color: palette.fg,
                      textOverflow: "ellipsis",
                    }}
                  >
                    {/* 담당자가 직접 쓴 자유 상태(소액 미처리, 출장비 예정…)도 그대로 선택지에 남긴다 */}
                    {(value && !STATUS_OPTIONS.includes(value) ? [value] : []).concat(STATUS_OPTIONS).map((s) => (
                      <option key={s || "none"} value={s} style={{ color: "var(--text-strong)", background: "var(--surface-card)" }}>
                        {s || "미확인"}
                      </option>
                    ))}
                  </select>
                );
              };
              const textCell = (value: string, onSave: (v: string) => void) => (
                <input
                  style={cellInput}
                  defaultValue={value}
                  placeholder="N/A"
                  onFocus={(e) => (e.currentTarget.style.borderColor = "var(--color-primary)")}
                  onBlur={(e) => {
                    e.currentTarget.style.borderColor = "transparent";
                    onSave(e.currentTarget.value.trim());
                  }}
                />
              );

              if (!sp.length) {
                return (
                  <tr key={`${r.kind}-${r.id}`}>
                    {leadCells}
                    <td style={{ ...tdc, color: "var(--text-subtle)" }}>
                      {(r.amount ?? 0) > 0 ? (
                        <span role="button" title="세부항목으로 분할"
                          onClick={() => setSplitSubject({ kind: r.kind === "card" ? "card" : "bank", id: r.id, title: r.merchant || r.itemName || "거래", amount: r.amount ?? 0 })}
                          style={{ display: "inline-flex", alignItems: "center", gap: 4, cursor: "pointer", fontSize: "var(--text-2xs)" }}>
                          <Scissors size={11} /> 분할
                        </span>
                      ) : "N/A"}
                    </td>
                    <td style={{ ...tdc, padding: "2px 4px" }}>
                      {textCell(r.classification, (v) => saveField(r, "classification", r.classification, v))}
                    </td>
                    <td style={{ ...tdc, whiteSpace: "nowrap" }}>
                      {statusSelect(r.status, (v) => saveField(r, "status", r.status, v))}
                    </td>
                    <td style={{ ...tdc, padding: "2px 4px" }}>
                      {textCell(r.remarks, (v) => saveField(r, "remarks", r.remarks, v))}
                    </td>
                    {evidenceCell}
                  </tr>
                );
              }
              // 분할된 거래: 세부항목별 행 — 처리된항목/상태/기타를 세부항목 단위로 기재
              return sp.map((s, i) => (
                <tr key={`${r.kind}-${r.id}-${s.id}`}>
                  {i === 0 && leadCells}
                  <td style={{ ...tdc, whiteSpace: "nowrap" }}>
                    <span style={{ fontWeight: 500, color: "var(--text-strong)" }}>{s.label || "세부항목"}</span>
                    <span style={{ marginLeft: 6, fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>{fmtWon(s.amount)}</span>
                  </td>
                  <td style={{ ...tdc, padding: "2px 4px" }}>
                    {textCell(s.classification, (v) => { if (v !== s.classification) saveSplitField(s.id, { classification: v }); })}
                  </td>
                  <td style={{ ...tdc, whiteSpace: "nowrap" }}>
                    {statusSelect(s.status, (v) => {
                      const next = tipsFlagSync(v);
                      saveSplitField(s.id, next !== undefined ? { status: v, tipsFunded: next } : { status: v });
                    })}
                  </td>
                  <td style={{ ...tdc, padding: "2px 4px" }}>
                    {textCell(s.remarks, (v) => { if (v !== s.remarks) saveSplitField(s.id, { remarks: v }); })}
                  </td>
                  {i === 0 && evidenceCell}
                </tr>
              ));
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={5} style={{ ...tdc, textAlign: "right", fontWeight: 600, color: "var(--text-strong)", borderTop: "2px solid var(--border-strong)", padding: "8px" }}>
                {flowFilter === "expense" ? "지출 검토 합계" : "표시 금액 합계"} ({shown.length}건)
              </td>
              <td style={{ ...tdcNum, fontWeight: 600, color: "var(--text-strong)", borderTop: "2px solid var(--border-strong)", padding: "8px" }}>
                {fmtWon(totals.vat)}
              </td>
              <td style={{ ...tdcNum, fontWeight: 700, color: "var(--text-strong)", borderTop: "2px solid var(--border-strong)", padding: "8px" }}>
                {fmtWon(totals.amount)}
              </td>
              <td colSpan={5} style={{ ...tdc, borderTop: "2px solid var(--border-strong)" }} />
            </tr>
          </tfoot>
        </table>
      </div>

      <Modal open={proposals.length > 0} onClose={() => setProposals([])} title="AI 분류 제안 검토" size="lg"
        footer={<Button loading={applyingProposals} disabled={!proposals.some((r) => r.accepted)} onClick={applyProposals}>선택한 분류·메모 반영</Button>}>
        <p>
          미확인 행은 선택 시 AI 제안 상태(검토가능·확인필요·처리불가 등)가 상태 셀렉트에 바로 지정됩니다.
          <br />
          접수완료·처리완료·복원 등 이미 처리된 상태는 보존되고, 제안은 기타란에만 남습니다.
          <br />
          지원금 수령·접수·정산 완료 여부는 AI가 판정하지 않습니다.
        </p>
        <label style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderBottom: "2px solid var(--border-strong)", fontWeight: 600, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={proposals.length > 0 && proposals.every((r) => r.accepted)}
            onChange={(e) => setProposals((prev) => prev.map((r) => ({ ...r, accepted: e.target.checked })))}
          />
          전체 선택 ({proposals.filter((r) => r.accepted).length}/{proposals.length})
        </label>
        {proposals.map((c, i) => <label key={c.id} style={{ display: "flex", gap: 10, padding: 10, borderBottom: "1px solid var(--border-subtle)" }}>
          <input type="checkbox" checked={c.accepted} onChange={(e) => setProposals((prev) => prev.map((r, n) => n === i ? { ...r, accepted: e.target.checked } : r))} />
          <span><b>{c.title}</b> · {c.classification || "분류 미확정"} · {c.status}<br />{c.note}</span>
        </label>)}
      </Modal>

      {/* unlinked evidence — manual link */}
      {unlinkedFiles.length > 0 && (
        <div style={{ marginTop: 14, borderTop: "1px solid var(--border-subtle)", paddingTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: "var(--text-xs)", fontWeight: 600, color: "var(--text-strong)" }}>
            미연결 증빙 {unlinkedFiles.length}건: 거래를 선택해 연결하세요
          </span>
          {unlinkedFiles.map((f) => (
            <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "var(--text-xs)" }}>
              <Paperclip size={12} />
              <span role="button" onClick={() => openEvidence(f)} style={{ cursor: "pointer", color: "var(--color-primary)", maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {f.fileName}
              </span>
              <Select
                size="sm"
                value={manualPick[f.id] ?? ""}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setManualPick((m) => ({ ...m, [f.id]: e.target.value }))}
                options={[{ value: "", label: "거래 선택…" }, ...rowOptions]}
                aria-label="Link to row"
                style={{ minWidth: 260 }}
              />
              <Button size="sm" variant="ghost" disabled={!manualPick[f.id]}
                onClick={async () => {
                  const row = spendRows.find((r) => r.id === manualPick[f.id]);
                  if (!row) return;
                  await linkEvidence(f.id, targetOf(row), "manual");
                  reloadEvidence();
                }}>
                연결
              </Button>
              <Button size="sm" variant="ghost" iconOnly aria-label="Delete evidence"
                onClick={() => setConfirmDeleteEv(f)}>
                <X size={13} />
              </Button>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={confirmDeleteEv !== null}
        onClose={() => setConfirmDeleteEv(null)}
        title="증빙 삭제"
        subtitle={confirmDeleteEv?.fileName}
        size="sm"
        footer={
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Button variant="ghost" onClick={() => setConfirmDeleteEv(null)}>취소</Button>
            <Button
              variant="danger"
              onClick={async () => {
                const f = confirmDeleteEv;
                setConfirmDeleteEv(null);
                if (!f) return;
                try {
                  await deleteEvidence(f);
                  reloadEvidence();
                } catch (err) {
                  console.error("evidence delete failed:", err);
                  setError("증빙 삭제에 실패했습니다.");
                }
              }}
            >
              삭제
            </Button>
          </div>
        }
      >
        저장소에서 영구 삭제되며 되돌릴 수 없습니다.
      </Modal>

      <Modal
        open={confirmReclassify}
        onClose={() => setConfirmReclassify(false)}
        title="전체 검토 제안을 새로 만들까요?"
        subtitle={`대상 ${classifyAll}건: 제안만 만들고 선택한 분류·메모만 반영합니다. 처리 상태는 보존됩니다.`}
        footer={
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button variant="ghost" onClick={() => setConfirmReclassify(false)}>취소</Button>
            <Button variant="primary" onClick={() => { setConfirmReclassify(false); classify(true); }}>전체 재분류</Button>
          </div>
        }
      >
        확정한 판정은 다음 달 분류의 학습 예시로도 쓰입니다. 일부만 다시 하려면 그 행의 상태를 &ldquo;미확인&rdquo;으로 되돌리고 &ldquo;AI classify&rdquo;를 누르세요.
      </Modal>

      {splitSubject && (
        <SplitModal
          subject={splitSubject}
          existing={(splitSubject.kind === "card" ? splitsByCharge.get(splitSubject.id) : splitsByBank.get(splitSubject.id)) ?? []}
          evidence={(linksByRowId.get(splitSubject.id) ?? []).map(({ file }) => ({ id: file.id, fileName: file.fileName }))}
          onClose={() => setSplitSubject(null)}
          onSaved={async () => { setSplitSubject(null); setSplits(await fetchChargeSplits()); onChanged(); }}
          onError={(m) => setError(m)}
        />
      )}
    </div>
  );
}
