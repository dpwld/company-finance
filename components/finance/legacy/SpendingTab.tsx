"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Paperclip, Sparkles, TrendingDown, TrendingUp } from "lucide-react";
import { Card, CardBody } from "@/components/ds/data/Card";
import { Button } from "@/components/ds/core/Button";
import { Select } from "@/components/ds/forms/Select";
import { Alert } from "@/components/ds/feedback/Alert";
import { Modal } from "@/components/ds/feedback/Modal";
import { Spinner } from "@/components/ds/core/Spinner";
import { EmptyState } from "@/components/ds/feedback/EmptyState";
import { deleteSpendRule, fetchChargeSplits, fetchFinanceMonth, fetchSpendRules, fetchSpendSeries, insertSpendRule, matchSpendRule, updateBankTx, updateCardCharge, updateChargeSplit, type BankTx, type CardCharge, type ChargeSplit, type SpendRule } from "@/lib/data/finance";
import { SpendRulesModal } from "../SpendRulesModal";
import { SplitModal } from "../SplitModal";
import { startJob } from "@/lib/finance/aiJobs";
import { useAiJob } from "@/lib/hooks/useAiJob";
import { evidenceUrl, fetchEvidence } from "@/lib/data/evidence";
import {
  ALL_CATEGORY_KEYS, SPEND_CATEGORIES, SPEND_CATEGORY_OPTIONS, catColor, catSoft,
  computeTotals, prevMonth, recentMonths, spendCategory, spendCategoryLabel, wonFmt,
} from "@/lib/finance/spend";
import { Download, Scissors } from "lucide-react";

/* Spending 탭 — Rocket Money 벤치마크: 카테고리 도넛 + 월 요약(수입/지출/
   운영잉여) + 카테고리 테이블(전월 대비, 펼치면 거래 목록). 분류는 AI가
   증빙 파일명까지 보고 배정하고, 각 거래에서 셀렉트로 바로 수정한다. */

const CATEGORY_OPTIONS = SPEND_CATEGORY_OPTIONS;
const spendLabel = spendCategoryLabel;

/** 지출 한 건 (카드/은행/분할 줄 통합 뷰). */
interface SpendRow {
  kind: "card" | "bank" | "split";
  id: string;
  /** split이면 원거래 카드 id. */
  parentId?: string;
  date: string;
  name: string;
  /** 이게 정확히 무슨 지출인지 — 처리된 항목·비고·증빙 파일명에서 뽑은 한 줄 설명. */
  desc: string;
  amount: number;
  category: string;
  hasEvidence: boolean;
  /** TIPS 지원금 집행/수령 체크 — 카테고리와 별개. */
  tipsFunded: boolean;
}

/** 증빙 파일명에서 사람이 읽을 부분만 — "0806쿠팡(사무품,가구)_영수증.pdf" → "사무품,가구". */
function descFromEvidence(files: EvidenceRef[] | undefined): string {
  if (!files?.length) return "";
  const parts: string[] = [];
  for (const f of files) {
    const base = f.fileName.normalize("NFC").replace(/\.[a-z0-9]+$/i, "");
    const paren = base.match(/[(（]([^)）]+)[)）]/)?.[1];
    // 괄호 설명이 없으면 뒤쪽 _서류종류 토큰을 떼고 날짜·상호만 남은 셈이라 버린다
    const seg = paren ?? base.split("_").slice(1).join(" ");
    const clean = seg.trim();
    if (clean && !parts.includes(clean)) parts.push(clean);
  }
  return parts.join(" · ");
}

interface EvidenceRef { id: string; fileName: string; storagePath: string; mimeType: string }

function DonutChart({ slices, total, deltaPct }: {
  slices: { key: string; label: string; value: number; hue: number | null }[];
  total: number;
  deltaPct: number | null;
}) {
  const R = 80, SW = 30, C = 2 * Math.PI * R;
  let acc = 0;
  return (
    <div style={{ position: "relative", width: 240, height: 240, margin: "0 auto" }}>
      <svg viewBox="0 0 220 220" width={240} height={240} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={110} cy={110} r={R} fill="none" stroke="var(--surface-sunken)" strokeWidth={SW} />
        {total > 0 && slices.map((s) => {
          const frac = s.value / total;
          const dash = frac * C;
          const el = (
            <circle
              key={s.key}
              cx={110} cy={110} r={R} fill="none"
              stroke={s.hue == null ? "var(--gray-300, #d5d5d5)" : catColor(s.hue)}
              strokeWidth={SW}
              strokeDasharray={`${Math.max(dash - 1.5, 0)} ${C - dash + 1.5}`}
              strokeDashoffset={-acc * C}
            >
              <title>{`${s.label} ${wonFmt(s.value)}`}</title>
            </circle>
          );
          acc += frac;
          return el;
        })}
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "var(--text-2xs)", fontWeight: 600, letterSpacing: ".08em", color: "var(--text-subtle)" }}>총 지출</div>
          <div style={{ fontSize: 24, fontWeight: 800, color: "var(--text-strong)", fontVariantNumeric: "tabular-nums" }}>{wonFmt(total)}</div>
          {deltaPct != null && (
            <div style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: "var(--text-xs)", fontWeight: 600, color: deltaPct <= 0 ? "var(--green-600, #7f7f7f)" : "var(--red-600, #4d4d4d)" }}>
              {deltaPct <= 0 ? <TrendingDown size={13} /> : <TrendingUp size={13} />}
              전월 대비 {Math.abs(Math.round(deltaPct))}%
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function SpendingTab({ month, evVersion, bank, cards, onChanged }: {
  month: string;
  evVersion: number;
  bank: BankTx[];
  cards: CardCharge[];
  onChanged: () => void;
  /** (미사용) 과거엔 추이 바 클릭이 화면 월을 통째로 바꿨다 — 이제 탭 안에서만 본다. */
  onMonth?: (m: string) => void;
}) {
  /* 추이 바 클릭 = 화면 월 전환이 아니라 "그 달 지출만 이 탭에서 보기".
     상단 월 선택(다른 탭 포함)은 그대로 두고 여기서만 바꿔 보여준다.
     picked=null이면 화면 월을 따른다 (파생 상태 — effect 리셋 없이 린트 통과). */
  const [picked, setPicked] = useState<string | null>(null);
  const viewMonth = picked ?? month;
  const [viewData, setViewData] = useState<{ month: string; bank: BankTx[]; cards: CardCharge[] } | null>(null);
  const [viewVersion, setViewVersion] = useState(0);
  useEffect(() => {
    if (viewMonth === month) return; // 화면 월은 부모 데이터(cards/bank)를 그대로 쓴다
    let alive = true;
    const target = viewMonth;
    fetchFinanceMonth(target)
      .then((d) => { if (alive) setViewData({ month: target, bank: d.bank, cards: d.cards }); })
      .catch(() => { if (alive) setViewData({ month: target, bank: [], cards: [] }); });
    return () => { alive = false; };
  }, [viewMonth, month, viewVersion]);
  const viewReady = viewMonth === month || viewData?.month === viewMonth;
  const vCards = useMemo(
    () => (viewMonth === month ? cards : viewData?.month === viewMonth ? viewData.cards : []),
    [viewMonth, month, cards, viewData],
  );
  const vBank = useMemo(
    () => (viewMonth === month ? bank : viewData?.month === viewMonth ? viewData.bank : []),
    [viewMonth, month, bank, viewData],
  );
  const viewLoading = !viewReady;
  /** 과거 월을 보는 중 분류를 고치면 그 월 데이터만 다시 읽는다. */
  const reloadView = () => { if (viewMonth === month) onChanged(); else setViewVersion((v) => v + 1); };

  const [prev, setPrev] = useState<{ bank: BankTx[]; cards: CardCharge[] } | null>(null);
  const [series, setSeries] = useState<{ month: string; spending: number }[] | null>(null);
  // 6개월 추이 창을 과거로 옮긴 개월 수 — 기준 월이 바뀌면 0으로 돌아간다 (파생 상태)
  const [trend, setTrend] = useState({ month, offset: 0 });
  const trendOffset = trend.month === month ? trend.offset : 0;
  const [evidenceFiles, setEvidenceFiles] = useState<Record<string, EvidenceRef[]>>({}); // "card:<id>" → 증빙 파일들
  const [splits, setSplits] = useState<ChargeSplit[]>([]);
  const [splitTarget, setSplitTarget] = useState<CardCharge | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Non-spending 카드에서 펼쳐 보는 그룹 (잘못 제외된 거래 검수용)
  const [nsOpen, setNsOpen] = useState<Set<string>>(new Set());
  // 거래 상세 팝업 — 증빙·분개·TIPS 이력을 한눈에 (2026-10-01 피드백)
  const [detail, setDetail] = useState<SpendRow | null>(null);
  // 펼친 카테고리에서 "거래 내역 보기"를 눌렀는지 (기본은 6개월 추이만)
  const [txOpen, setTxOpen] = useState<Set<string>>(new Set());
  const toggleSet = (set: (f: (prev: Set<string>) => Set<string>) => void, key: string) =>
    set((prev) => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  const [seriesRaw, setSeriesRaw] = useState<{
    months: string[];
    cards: { month: string; amount: number | null; status: string; spendCategory: string }[];
    bank: { month: string; deposit: number | null; withdrawal: number | null; spendCategory: string }[];
  } | null>(null);
  const job = useAiJob("spend-classify");
  const aiBusy = job.running;
  const [error, setError] = useState<string | null>(null);
  // 백그라운드 분류가 끝나면(다른 탭에 있었어도) 화면을 새로 읽는다
  const lastJobRef = useRef<number | null>(null);
  useEffect(() => {
    if (!job.finishedAt || lastJobRef.current === job.finishedAt) return;
    lastJobRef.current = job.finishedAt;
    if (job.error) return; // 오류는 아래 배지에서 job.message로 바로 보여준다
    queueMicrotask(reloadView);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.finishedAt, job.error]);


  // 최근 6개월 지출 추이 (경량 조회 → 월별 합계)
  useEffect(() => {
    let alive = true;
    const months = recentMonths(recentMonths(month, trendOffset + 1)[0], 6);
    fetchSpendSeries(months)
      .then(({ cards: sc, bank: sb }) => {
        if (!alive) return;
        setSeries(months.map((m) => ({
          month: m,
          spending: computeTotals(sc.filter((r) => r.month === m), sb.filter((r) => r.month === m)).spending,
        })));
        // 카테고리별 추이(카테고리 펼침 시)용 원본 보관
        setSeriesRaw({ months, cards: sc, bank: sb });
      })
      .catch(() => alive && setSeries([]));
    return () => { alive = false; };
    // 이 달 데이터가 바뀌면(분류/업로드) 추이도 갱신
  }, [month, cards, bank, viewVersion, trendOffset]);

  const reloadSplits = () => { fetchChargeSplits().then(setSplits).catch(() => {}); };
  useEffect(reloadSplits, []);

  // 분류 규칙 ("가맹점 이름 → 사무실·임차료") — AI보다 우선하는 결정적 매칭
  const [rules, setRules] = useState<SpendRule[]>([]);
  const [rulesOpen, setRulesOpen] = useState(false);
  useEffect(() => { fetchSpendRules().then(setRules).catch(() => {}); }, []);

  /** 규칙 추가: 저장 + 이번 달 매칭 거래(이미 분류된 것 포함)에 즉시 적용. */
  async function addRule(pattern: string, category: string) {
    const rule = await insertSpendRule(pattern, category);
    setRules((prev) => [...prev, rule]);
    const one = [rule];
    let applied = 0;
    const isTipsRule = category === "tips_funded";
    for (const c of vCards) {
      if (!(c.status || "").includes("취소") && matchSpendRule(one, [c.merchant, c.industry, c.itemName])) {
        if (isTipsRule) { if (!c.tipsFunded) { await updateCardCharge(c.id, { tips_funded: true }); applied++; } }
        else if (c.spendCategory !== category) { await updateCardCharge(c.id, { spend_category: category }); applied++; }
      }
    }
    for (const b of vBank) {
      if (matchSpendRule(one, [b.counterparty, b.description])) {
        if (isTipsRule) { if (!b.tipsFunded) { await updateBankTx(b.id, { tips_funded: true }); applied++; } }
        else if (b.spendCategory !== category) { await updateBankTx(b.id, { spend_category: category }); applied++; }
      }
    }
    if (applied > 0) reloadView();
    return applied;
  }

  async function removeRule(id: string) {
    await deleteSpendRule(id);
    setRules((prev) => prev.filter((r) => r.id !== id));
  }


  useEffect(() => {
    let alive = true;
    fetchFinanceMonth(prevMonth(viewMonth))
      .then((d) => alive && setPrev({ bank: d.bank, cards: d.cards }))
      .catch(() => alive && setPrev({ bank: [], cards: [] }));
    return () => { alive = false; };
  }, [viewMonth]);

  // 증빙 파일명 (AI 분류 근거 + 행의 📎 표시)
  useEffect(() => {
    let alive = true;
    fetchEvidence(viewMonth, { cards: vCards.map((r) => r.id), bank: vBank.map((r) => r.id) })
      .then(({ files, links }) => {
        if (!alive) return;
        const byId = new Map(files.map((f) => [f.id, f]));
        const map: Record<string, EvidenceRef[]> = {};
        for (const l of links) {
          const key = l.cardChargeId ? `card:${l.cardChargeId}` : l.bankTxId ? `bank:${l.bankTxId}` : null;
          const f = byId.get(l.evidenceId);
          if (key && f) (map[key] ??= []).push({ id: f.id, fileName: f.fileName, storagePath: f.storagePath, mimeType: f.mimeType });
        }
        setEvidenceFiles(map);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [viewMonth, evVersion, vCards, vBank]);

  const splitsByTarget = useMemo(() => {
    const m = new Map<string, ChargeSplit[]>();
    for (const sp of splits) {
      const key = sp.cardChargeId ? `card:${sp.cardChargeId}` : sp.bankTxId ? `bank:${sp.bankTxId}` : null;
      if (!key) continue;
      const list = m.get(key) ?? [];
      list.push(sp);
      m.set(key, list);
    }
    return m;
  }, [splits]);

  const totals = useMemo(() => computeTotals(vCards, vBank, splits), [vCards, vBank, splits]);
  const prevTotals = useMemo(() => (prev ? computeTotals(prev.cards, prev.bank) : null), [prev]);

  const rows: SpendRow[] = useMemo(() => {
    const out: SpendRow[] = [];
    const splitsByCharge = new Map<string, ChargeSplit[]>();
    for (const sp of splits) {
      const list = splitsByCharge.get(sp.cardChargeId) ?? [];
      list.push(sp);
      splitsByCharge.set(sp.cardChargeId, list);
    }
    for (const c of vCards) {
      if ((c.status || "").includes("취소") || !c.amount) continue;
      const hasEv = !!evidenceFiles[`card:${c.id}`]?.length;
      const mySplits = splitsByCharge.get(c.id);
      if (mySplits && mySplits.length > 0) {
        // 분할된 거래는 분할 줄로 표시 (원거래 대신)
        for (const sp of mySplits) {
          out.push({
            kind: "split", id: sp.id, parentId: c.id, date: c.approvalDate ?? "",
            name: `${c.merchant || c.itemName || "N/A"} · ${sp.label || "항목"}`,
            desc: sp.remarks || sp.classification || c.industry,
            amount: sp.amount, category: sp.spendCategory, hasEvidence: hasEv,
            tipsFunded: sp.tipsFunded || sp.spendCategory === "tips_funded",
          });
        }
      } else {
        out.push({
          kind: "card", id: c.id, date: c.approvalDate ?? "", name: c.merchant || c.itemName || "N/A",
          desc: c.itemName || c.remarks || descFromEvidence(evidenceFiles[`card:${c.id}`]) || c.industry,
          amount: c.amount, category: c.spendCategory, hasEvidence: hasEv,
          tipsFunded: c.tipsFunded || c.spendCategory === "tips_funded",
        });
      }
    }
    for (const b of vBank) {
      if (!b.withdrawal) continue;
      out.push({
        kind: "bank", id: b.id, date: b.txDate, name: b.counterparty || b.description || "N/A",
        desc: (b.counterparty ? b.description : "") || b.memo || b.tipsNote || descFromEvidence(evidenceFiles[`bank:${b.id}`]),
        amount: b.withdrawal, category: b.spendCategory, hasEvidence: !!evidenceFiles[`bank:${b.id}`]?.length,
        tipsFunded: b.tipsFunded || b.spendCategory === "tips_funded",
      });
    }
    return out.sort((a, b) => b.date.localeCompare(a.date));
  }, [vCards, vBank, evidenceFiles, splits]);

  const uncategorizedCount = useMemo(
    () => rows.filter((r) => !r.category && !r.tipsFunded).length + vBank.filter((b) => b.deposit && !b.spendCategory && !b.tipsFunded).length,
    [rows, vBank],
  );

  /** 도넛/테이블 슬라이스 — 큰 순서, 미분류는 회색으로 마지막. */
  const slices = useMemo(() => {
    const list = SPEND_CATEGORIES
      .map((c) => ({ key: c.key, label: c.label, value: totals.byCategory[c.key] ?? 0, hue: c.hue as number | null, emoji: c.emoji }))
      .filter((s) => s.value > 0)
      .sort((a, b) => b.value - a.value);
    if (totals.uncategorized > 0) list.push({ key: "__none__", label: "미분류", value: totals.uncategorized, hue: null, emoji: "❔" });
    return list;
  }, [totals]);

  const deltaPct = prevTotals && prevTotals.spending > 0
    ? ((totals.spending - prevTotals.spending) / prevTotals.spending) * 100
    : null;

  /** TIPS 지원금 체크 토글 — 카테고리는 그대로, 집계만 지원금 폴더로 이동. */
  async function setTipsFlag(row: SpendRow, checked: boolean) {
    try {
      if (row.kind === "card") await updateCardCharge(row.id, { tips_funded: checked });
      else if (row.kind === "split") { await updateChargeSplit(row.id, { tipsFunded: checked }); reloadSplits(); return; }
      else await updateBankTx(row.id, { tips_funded: checked });
      reloadView();
    } catch (err) {
      console.error("tips flag save failed:", err);
      setError("TIPS 체크 저장 실패 · tips_funded 컬럼(2026-10-01 SQL) 실행 여부를 확인하세요.");
    }
  }

  async function setCategory(row: SpendRow, category: string) {
    try {
      if (row.kind === "card") await updateCardCharge(row.id, { spend_category: category });
      else if (row.kind === "split") { await updateChargeSplit(row.id, { spendCategory: category }); reloadSplits(); return; }
      else await updateBankTx(row.id, { spend_category: category });
      reloadView();
    } catch (err) {
      console.error("spend category save failed:", err);
      setError("분류 저장에 실패했습니다 · spend_category 컬럼(2026-08-04 SQL) 실행 여부를 확인하세요.");
    }
  }

  /** 미분류 거래 일괄 AI 분류 — 규칙 매칭이 먼저(결정적, 토큰 0), 나머지만 AI. */
  /** AI 자동 분류 — 모듈 스코프에서 돌려 탭을 옮겨도 계속된다. */
  function aiCategorize() {
    setError(null);
    const cardsSnap = [...vCards];
    const bankSnap = [...vBank];
    const rulesSnap = [...rules];
    const evSnap = { ...evidenceFiles };
    startJob("spend-classify", async (h) => {
      let targetCards = cardsSnap.filter((c) => !c.spendCategory && c.amount && !(c.status || "").includes("취소"));
      let targetBank = bankSnap.filter((b) => !b.spendCategory && (b.withdrawal || b.deposit));
      const totalTargets = targetCards.length + targetBank.length;
      let applied = 0;
      h.progress(0, totalTargets);
      // 1) 규칙 우선 적용
      if (rulesSnap.length > 0) {
        const ruledCards = targetCards.filter((c) => matchSpendRule(rulesSnap, [c.merchant, c.industry, c.itemName]));
        const ruledBank = targetBank.filter((b) => matchSpendRule(rulesSnap, [b.counterparty, b.description]));
        // tips_funded 규칙(TIPARCMS·RCMS)은 카테고리가 아니라 체크 플래그로 반영
        for (const c of ruledCards) {
          const cat = matchSpendRule(rulesSnap, [c.merchant, c.industry, c.itemName]);
          await updateCardCharge(c.id, cat === "tips_funded" ? { tips_funded: true } : { spend_category: cat });
        }
        for (const b of ruledBank) {
          const cat = matchSpendRule(rulesSnap, [b.counterparty, b.description]);
          await updateBankTx(b.id, cat === "tips_funded" ? { tips_funded: true } : { spend_category: cat });
        }
        targetCards = targetCards.filter((c) => !ruledCards.includes(c));
        targetBank = targetBank.filter((b) => !ruledBank.includes(b));
      }
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
              itemName: c.itemName, amount: c.amount, evidence: (evSnap[`card:${c.id}`] ?? []).map((f) => f.fileName),
            })),
            bank: bankChunk.map((b) => ({
              id: b.id, txDate: b.txDate, counterparty: b.counterparty, description: b.description,
              deposit: b.deposit, withdrawal: b.withdrawal,
              evidence: (evSnap[`bank:${b.id}`] ?? []).map((f) => f.fileName),
            })),
            rules: rulesSnap.map((r) => `${r.pattern} → ${r.category}`),
          }),
        });
        const json = (await res.json() as any);
        if (!res.ok) throw new Error(json.detail || json.error || `HTTP ${res.status}`);
        for (const c of json.cards ?? []) {
          if (ALL_CATEGORY_KEYS.includes(c.category)) await updateCardCharge(c.id, { spend_category: c.category });
          h.progress(++applied, totalTargets);
        }
        for (const b of json.bank ?? []) {
          if (ALL_CATEGORY_KEYS.includes(b.category)) await updateBankTx(b.id, { spend_category: b.category });
          h.progress(++applied, totalTargets);
        }
      }
      return `${applied}건 분류 완료`;
    });
  }

  /** 상세 팝업에 보여줄 원거래 정보 — 증빙 파일, 분개, TIPS 처리 이력. */
  const detailInfo = useMemo(() => {
    if (!detail) return null;
    if (detail.kind === "split") {
      const sp = splits.find((x) => x.id === detail.id);
      const parent = vCards.find((c) => c.id === detail.parentId);
      return {
        files: evidenceFiles[`card:${detail.parentId}`] ?? [],
        debit: sp?.debitAccount ?? "", credit: sp?.creditAccount ?? "",
        tipsClass: sp?.classification ?? "", tipsStatus: sp?.status ?? "", tipsNote: sp?.remarks ?? "",
        extra: parent ? `원거래 ${parent.merchant || parent.itemName || ""} ${wonFmt(parent.amount ?? 0)} 중 분할` : "",
      };
    }
    if (detail.kind === "card") {
      const c = vCards.find((x) => x.id === detail.id);
      return {
        files: evidenceFiles[`card:${detail.id}`] ?? [],
        debit: c?.debitAccount ?? "", credit: c?.creditAccount ?? "",
        tipsClass: c?.classification ?? "", tipsStatus: c?.status ?? "", tipsNote: c?.remarks ?? "",
        extra: [c?.industry, c?.itemName].filter(Boolean).join(" · "),
      };
    }
    const b = vBank.find((x) => x.id === detail.id);
    return {
      files: evidenceFiles[`bank:${detail.id}`] ?? [],
      debit: b?.debitAccount ?? "", credit: b?.creditAccount ?? "",
      tipsClass: b?.category ?? "", tipsStatus: b?.status ?? "", tipsNote: b?.tipsNote ?? "",
      extra: [b?.description, b?.memo].filter(Boolean).join(" · "),
    };
  }, [detail, splits, vCards, vBank, evidenceFiles]);

  async function openEvidenceFile(storagePath: string) {
    try {
      window.open(await evidenceUrl(storagePath), "_blank", "noopener");
    } catch {
      setError("증빙 다운로드 링크 생성에 실패했습니다.");
    }
  }

  /** 행 우측 TIPS 체크박스 — 체크 = 지원금 집행(지출 제외, 카테고리는 유지). */
  const tipsCheck = (r: SpendRow) => (
    <label
      title="TIPS 지원금으로 집행/수령된 건 — 체크하면 지출 집계에서 빠지고 지원금 폴더로 이동합니다"
      style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: "var(--text-2xs)", fontWeight: 600, color: r.tipsFunded ? "var(--color-primary)" : "var(--text-subtle)", cursor: "pointer", flexShrink: 0 }}
    >
      <input type="checkbox" checked={r.tipsFunded} onChange={(e) => void setTipsFlag(r, e.target.checked)} style={{ accentColor: "var(--color-primary)" }} />
      TIPS
    </label>
  );

  /** 거래명 앞 클립 버튼 — 누르면 증빙·분개·TIPS 이력 팝업. */
  const detailBtn = (r: SpendRow) => (
    <button
      type="button"
      title="증빙·상세 보기"
      aria-label="거래 상세 보기"
      onClick={() => setDetail(r)}
      style={{ border: "none", background: "none", cursor: "pointer", padding: 2, display: "inline-flex", flexShrink: 0, color: r.hasEvidence ? "var(--color-primary)" : "var(--text-subtle)" }}
    >
      <Paperclip size={13} />
    </button>
  );

  /** 분류 포함 CSV 다운로드 (엑셀 호환 BOM). */
  function exportCsv() {
    const header = "date,source,name,desc,category,amount";
    const q = (v: string) => '"' + v.replace(/"/g, '""') + '"';
    const lines = rows.map((r) =>
      [r.date, r.kind === "card" ? "card" : "bank", q(r.name), q(r.desc), spendLabel(r.category), r.amount].join(","),
    );
    const blob = new Blob(["\ufeff" + [header, ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `finance-spending-${viewMonth}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  if (viewLoading) {
    return (
      <div style={{ display: "grid", placeItems: "center", padding: 48, color: "var(--text-muted)", gap: 8 }}>
        <Spinner /> {viewMonth} 지출을 불러오는 중…
      </div>
    );
  }

  if (rows.length === 0 && totals.income === 0 && totals.unknownAmountCount === 0) {
    return (
      <EmptyState
        icon={<Sparkles size={24} />}
        title="이 달의 거래가 없습니다"
        description="상단에서 카드/은행 내역 파일을 업로드하면 지출 대시보드가 채워집니다."
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {error && <Alert tone="warning" title="Spending" onClose={() => setError(null)}>{error}</Alert>}

      {/* 추이 바에서 다른 달을 고른 상태 — 화면 월은 그대로, 이 탭만 그 달을 본다 */}
      {viewMonth !== month && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: "var(--radius-md)", background: "var(--blue-50, #f5f5f5)", border: "1px solid var(--blue-200, #d8d8d8)", fontSize: "var(--text-xs)", color: "var(--blue-700, #4e4e4e)" }}>
          <span style={{ fontWeight: 600 }}>{Number(viewMonth.slice(5))}월 지출을 보는 중입니다</span>
          <span style={{ color: "var(--text-muted)" }}>화면 월({Number(month.slice(5))}월)과 다른 탭은 그대로예요</span>
          <span style={{ flex: 1 }} />
          <Button size="sm" variant="ghost" onClick={() => setPicked(null)}>{Number(month.slice(5))}월로 돌아가기</Button>
        </div>
      )}

      {/* 상단: AI 분류 */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>
          {uncategorizedCount > 0 ? `미분류 ${uncategorizedCount}건` : "모든 거래가 분류되어 있습니다 ✓"}
        </span>
        <span style={{ flex: 1 }} />
        <Button variant="secondary" size="sm" onClick={() => setRulesOpen(true)}>
          분류 규칙{rules.length ? ` (${rules.length})` : ""}
        </Button>
        <Button variant="secondary" size="sm" leftIcon={<Download size={13} />} disabled={rows.length === 0} onClick={exportCsv}>
          CSV
        </Button>
        <Button variant="primary" size="sm" leftIcon={aiBusy ? <Spinner size="sm" /> : <Sparkles size={14} />} disabled={aiBusy || uncategorizedCount === 0} onClick={aiCategorize}>
          {aiBusy ? `분류 중${job.total ? ` ${job.done}/${job.total}` : ""}…` : "AI 자동 분류 (증빙 참고)"}
        </Button>
      </div>

      {/* 월별 지출 추이 (RM 스타일 바) — 바 클릭 = 그 달로 이동. 모바일에선 폭이
          모자라 라벨이 2개만 남으므로 숨긴다 (2026-09-29 모바일 P1). */}
      {series && series.length > 0 && (
        <Card className="sx-desktop-only">
          <CardBody>
            <div style={{ display: "flex", alignItems: "center", gap: 6, paddingBottom: 10 }}>
              <span style={{ fontSize: "var(--text-2xs)", fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--text-subtle)" }}>
                {trendOffset === 0 ? "최근 6개월 지출 추이" : "6개월 지출 추이"}
              </span>
              <span style={{ flex: 1 }} />
              {/* 창을 한 달씩 과거/최근으로 — 보이는 6개월에 지출이 하나도 없으면 더 과거로는 못 간다 */}
              <Button variant="ghost" size="sm" iconOnly aria-label="이전 달 보기" title="이전 달 보기"
                disabled={trendOffset > 0 && series.every((s2) => s2.spending === 0)}
                onClick={() => setTrend({ month, offset: trendOffset + 1 })}>
                <ChevronLeft size={15} />
              </Button>
              <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>
                {series[0].month.replace("-", ".")} – {series[series.length - 1].month.replace("-", ".")}
              </span>
              <Button variant="ghost" size="sm" iconOnly aria-label="다음 달 보기" title="다음 달 보기"
                disabled={trendOffset === 0}
                onClick={() => setTrend({ month, offset: trendOffset - 1 })}>
                <ChevronRight size={15} />
              </Button>
            </div>
            {(() => {
              const max = Math.max(...series.map((s2) => s2.spending), 1);
              return (
                <div style={{ display: "flex", alignItems: "flex-end", gap: 14, height: 130, padding: "0 4px" }}>
                  {series.map((s2) => {
                    const active = s2.month === viewMonth;
                    const h = Math.max(4, Math.round((s2.spending / max) * 100));
                    return (
                      <button
                        key={s2.month}
                        type="button"
                        onClick={() => setPicked(s2.month === month ? null : s2.month)}
                        title={`${s2.month} 지출만 보기 · ${wonFmt(s2.spending)}`}
                        style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6, border: "none", background: "none", cursor: "pointer", padding: 0, fontFamily: "var(--font-sans)" }}
                      >
                        <span style={{ fontSize: "var(--text-2xs)", color: active ? "var(--text-strong)" : "var(--text-subtle)", fontVariantNumeric: "tabular-nums" }}>
                          {s2.spending > 0 ? `₩${Math.round(s2.spending / 10000).toLocaleString()}만` : ""}
                        </span>
                        <span style={{ width: "100%", maxWidth: 46, height: h, borderRadius: 6, background: active ? "var(--color-primary)" : "var(--surface-sunken)", border: active ? "none" : "1px solid var(--border-subtle)", transition: "height 240ms var(--ease-out, ease-out)" }} />
                        <span style={{ fontSize: "var(--text-2xs)", fontWeight: active ? 700 : 400, color: active ? "var(--text-strong)" : "var(--text-subtle)" }}>{Number(s2.month.slice(5))}월</span>
                      </button>
                    );
                  })}
                </div>
              );
            })()}
          </CardBody>
        </Card>
      )}

      {/* 도넛 + 요약 */}
      <div className="sx-grid-m1" style={{ display: "grid", gridTemplateColumns: "minmax(0,1.2fr) minmax(260px,1fr)", gap: 16, alignItems: "stretch" }}>
        <Card>
          <CardBody>
            <DonutChart slices={slices} total={totals.spending} deltaPct={deltaPct} />
            {(totals.unknownAmountCount > 0 || totals.invalidSplitCount > 0) && <p style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
              {totals.unknownAmountCount > 0 && `원화 미확정 ${totals.unknownAmountCount}건은 합계에서 제외되어 있습니다. `}
              {totals.invalidSplitCount > 0 && `분할 합계가 맞지 않는 ${totals.invalidSplitCount}건은 원거래 금액으로 집계합니다.`}
            </p>}
            {/* 범례 */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center", marginTop: 8 }}>
              {slices.slice(0, 8).map((s) => (
                <span key={s.key} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: "var(--text-2xs)", color: "var(--text-muted)" }}>
                  <span style={{ width: 9, height: 9, borderRadius: 999, background: s.hue == null ? "var(--gray-300, #d5d5d5)" : catColor(s.hue) }} />
                  {s.label}
                </span>
              ))}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <div style={{ fontSize: "var(--text-2xs)", fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--text-subtle)", paddingBottom: 10 }}>
              {viewMonth} 요약
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
              {[
                { label: "입금", sub: "회사에 실제로 들어온 돈 (해외지사 송금 등) · TIPS 지원금·내부이체 제외", value: totals.income, tone: "var(--green-600, #7f7f7f)", sign: "▲ " },
                { label: "지출", sub: "회사 실부담 · TIPS 집행/내부이체/카드대금 제외", value: totals.spending, tone: "var(--red-600, #4d4d4d)", sign: "▼ " },
              ].map((r) => (
                <div key={r.label} style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, padding: "12px 2px", borderBottom: "1px solid var(--border-subtle)" }}>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: "var(--text-sm)", color: "var(--text-default)", fontWeight: 600 }}>{r.label}</span>
                    <span style={{ display: "block", fontSize: "var(--text-2xs)", color: "var(--text-subtle)" }}>{r.sub}</span>
                  </span>
                  <span style={{ fontSize: "var(--text-lg)", fontWeight: 700, color: r.tone, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{r.sign}{wonFmt(Math.abs(r.value))}</span>
                </div>
              ))}
              {prevTotals && (
                <div style={{ paddingTop: 12, fontSize: "var(--text-xs)", color: "var(--text-subtle)" }}>
                  전월 지출 {wonFmt(prevTotals.spending)} · 전월 입금 {wonFmt(prevTotals.income)}
                </div>
              )}
            </div>
          </CardBody>
        </Card>
      </div>

      <SpendRulesModal
        open={rulesOpen}
        rules={rules}
        onClose={() => setRulesOpen(false)}
        onAdd={addRule}
        onDelete={removeRule}
        onError={(msg) => setError(msg)}
      />

      <Modal
        open={detail !== null}
        onClose={() => setDetail(null)}
        title={detail?.name ?? ""}
        subtitle={detail ? `${detail.date || "날짜 미상"} · ${wonFmt(detail.amount)} · ${spendLabel(detail.category)}` : undefined}
        size="sm"
        footer={
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <Button variant="ghost" onClick={() => setDetail(null)}>닫기 (Esc)</Button>
          </div>
        }
      >
        {detail && detailInfo && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14, fontSize: "var(--text-sm)" }}>
            {detailInfo.extra && <p style={{ margin: 0, color: "var(--text-muted)" }}>{detailInfo.extra}</p>}

            <div>
              <div style={{ fontSize: "var(--text-2xs)", fontWeight: 600, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--text-subtle)", marginBottom: 5 }}>증빙</div>
              {detailInfo.files.length === 0 ? (
                <span style={{ color: "var(--text-subtle)" }}>연결된 증빙 없음 · 상단 증빙 업로드에서 연결할 수 있습니다</span>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {detailInfo.files.map((f) => (
                    <span key={f.id} role="button" onClick={() => void openEvidenceFile(f.storagePath)}
                      style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer", color: "var(--color-primary)", fontSize: "var(--text-xs)" }}>
                      <Paperclip size={11} style={{ flexShrink: 0 }} />
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.fileName}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div>
              <div style={{ fontSize: "var(--text-2xs)", fontWeight: 600, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--text-subtle)", marginBottom: 5 }}>분개 (Transactions)</div>
              {detailInfo.debit || detailInfo.credit ? (
                <span>차변 <b>{detailInfo.debit || "N/A"}</b> · 대변 <b>{detailInfo.credit || "N/A"}</b></span>
              ) : (
                <span style={{ color: "var(--text-subtle)" }}>분개 미지정 · Transactions 탭에서 확정합니다</span>
              )}
            </div>

            <div>
              <div style={{ fontSize: "var(--text-2xs)", fontWeight: 600, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--text-subtle)", marginBottom: 5 }}>TIPS 처리 이력</div>
              {detailInfo.tipsClass || detailInfo.tipsStatus || detailInfo.tipsNote ? (
                <div style={{ display: "grid", gridTemplateColumns: "76px 1fr", gap: "4px 10px" }}>
                  <span style={{ color: "var(--text-muted)" }}>처리 항목</span><span>{detailInfo.tipsClass || "N/A"}</span>
                  <span style={{ color: "var(--text-muted)" }}>상태</span><span>{detailInfo.tipsStatus || "미확인"}</span>
                  {detailInfo.tipsNote && (<><span style={{ color: "var(--text-muted)" }}>기타</span><span>{detailInfo.tipsNote}</span></>)}
                </div>
              ) : (
                <span style={{ color: "var(--text-subtle)" }}>TIPS 처리 이력 없음</span>
              )}
            </div>
          </div>
        )}
      </Modal>

      {splitTarget && (
        <SplitModal
          subject={{ kind: "card", id: splitTarget.id, title: splitTarget.merchant || splitTarget.itemName || "거래", amount: splitTarget.amount ?? 0 }}
          existing={splitsByTarget.get(`card:${splitTarget.id}`) ?? []}
          evidence={evidenceFiles[`card:${splitTarget.id}`] ?? []}
          onClose={() => setSplitTarget(null)}
          onSaved={() => { setSplitTarget(null); reloadView(); }}
          onError={(m) => setError(m)}
        />
      )}

      {/* 카테고리 테이블 (펼치면 거래 목록) */}
      <Card>
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 70px 110px 120px", gap: 8, padding: "10px 16px", borderBottom: "1px solid var(--border-subtle)", fontSize: "var(--text-2xs)", fontWeight: 600, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--text-subtle)" }}>
            <span>카테고리</span><span style={{ textAlign: "right" }}>비중</span><span style={{ textAlign: "right" }}>전월 대비</span><span style={{ textAlign: "right" }}>금액</span>
          </div>
          {slices.map((s) => {
            const prevVal = s.key === "__none__" ? (prevTotals?.uncategorized ?? 0) : (prevTotals?.byCategory[s.key] ?? 0);
            const diff = s.value - prevVal;
            const catRows = rows.filter((r) => !r.tipsFunded && (s.key === "__none__" ? !r.category : r.category === s.key));
            const isOpen = expanded.has(s.key);
            return (
              <div key={s.key} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                <button
                  type="button"
                  onClick={() => toggleSet(setExpanded, s.key)}
                  style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 70px 110px 120px", gap: 8, alignItems: "center", width: "100%", padding: "11px 16px", border: "none", background: "none", cursor: "pointer", textAlign: "left", fontFamily: "var(--font-sans)" }}
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                    {isOpen ? <ChevronDown size={14} style={{ color: "var(--text-subtle)", flexShrink: 0 }} /> : <ChevronRight size={14} style={{ color: "var(--text-subtle)", flexShrink: 0 }} />}
                    <span style={{ width: 30, height: 30, borderRadius: 999, background: s.hue == null ? "var(--surface-sunken)" : catSoft(s.hue), display: "inline-grid", placeItems: "center", fontSize: 15, flexShrink: 0 }}>{s.emoji}</span>
                    <span style={{ fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--text-strong)" }}>{s.label}</span>
                    <span style={{ fontSize: "var(--text-2xs)", color: "var(--text-subtle)" }}>{catRows.length}건</span>
                  </span>
                  <span style={{ textAlign: "right", fontSize: "var(--text-sm)", color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>
                    {totals.spending > 0 ? `${Math.round((s.value / totals.spending) * 100)}%` : "N/A"}
                  </span>
                  <span style={{ textAlign: "right", fontSize: "var(--text-xs)", fontVariantNumeric: "tabular-nums", color: diff <= 0 ? "var(--green-600, #7f7f7f)" : "var(--red-600, #4d4d4d)" }}>
                    {prevTotals ? `${diff <= 0 ? "▼" : "▲"} ${wonFmt(Math.abs(diff))}` : "N/A"}
                  </span>
                  <span style={{ textAlign: "right", fontSize: "var(--text-sm)", fontWeight: 700, color: "var(--text-strong)", fontVariantNumeric: "tabular-nums" }}>{wonFmt(s.value)}</span>
                </button>
                {isOpen && (
                  <div style={{ padding: "0 16px 12px 56px" }}>
                    {/* 이 카테고리의 최근 6개월 추이 — 상단 전체 추이와 같은 스타일 */}
                    {seriesRaw && (() => {
                      const catSeries = seriesRaw.months.map((m) => {
                        const t = computeTotals(
                          seriesRaw.cards.filter((r) => r.month === m),
                          seriesRaw.bank.filter((r) => r.month === m),
                        );
                        return { month: m, value: s.key === "__none__" ? t.uncategorized : (t.byCategory[s.key] ?? 0) };
                      });
                      const catMax = Math.max(...catSeries.map((c) => c.value), 1);
                      return (
                        <div style={{ padding: "6px 0 10px" }}>
                          <div style={{ fontSize: "var(--text-2xs)", fontWeight: 600, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--text-subtle)", paddingBottom: 8 }}>
                            {s.label} : {trendOffset === 0 ? "최근 6개월 추이" : `${seriesRaw.months[0].replace("-", ".")} – ${seriesRaw.months[seriesRaw.months.length - 1].replace("-", ".")} 추이`}
                          </div>
                          <div style={{ display: "flex", alignItems: "flex-end", gap: 12, height: 92, padding: "0 4px", maxWidth: 560 }}>
                            {catSeries.map((c) => {
                              const active = c.month === viewMonth;
                              const h = Math.max(3, Math.round((c.value / catMax) * 62));
                              return (
                                <button key={c.month} type="button" onClick={() => setPicked(c.month === month ? null : c.month)} title={`${c.month} 지출만 보기 · ${wonFmt(c.value)}`}
                                  style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, border: "none", background: "none", cursor: "pointer", padding: 0, fontFamily: "var(--font-sans)" }}>
                                  <span style={{ fontSize: "var(--text-2xs)", color: active ? "var(--text-strong)" : "var(--text-subtle)", fontVariantNumeric: "tabular-nums" }}>
                                    {c.value > 0 ? `₩${Math.round(c.value / 10000).toLocaleString()}만` : ""}
                                  </span>
                                  <span style={{ width: "100%", maxWidth: 38, height: h, borderRadius: 5, background: active ? "var(--color-primary)" : "var(--surface-sunken)", border: active ? "none" : "1px solid var(--border-subtle)" }} />
                                  <span style={{ fontSize: "var(--text-2xs)", fontWeight: active ? 700 : 400, color: active ? "var(--text-strong)" : "var(--text-subtle)" }}>{Number(c.month.slice(5))}월</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })()}
                    <button
                      type="button"
                      onClick={() => toggleSet(setTxOpen, s.key)}
                      style={{ display: "inline-flex", alignItems: "center", gap: 6, border: "1px solid var(--border-subtle)", background: "var(--surface-sunken)", borderRadius: 8, padding: "5px 12px", cursor: "pointer", fontSize: "var(--text-xs)", fontWeight: 600, color: "var(--text-default)", fontFamily: "var(--font-sans)", marginBottom: txOpen.has(s.key) ? 6 : 0 }}
                    >
                      {txOpen.has(s.key) ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                      거래 내역 {txOpen.has(s.key) ? "접기" : `보기 (${catRows.length}건)`}
                    </button>
                    {txOpen.has(s.key) && catRows.map((r) => (
                      <div key={`${r.kind}-${r.id}`} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderTop: "1px dashed var(--border-subtle)" }}>
                        <span style={{ fontSize: "var(--text-2xs)", color: "var(--text-subtle)", width: 78, flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{r.date || "N/A"}</span>
                        {detailBtn(r)}
                        <span style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "baseline", gap: 7, overflow: "hidden" }} title={r.desc ? `${r.name} · ${r.desc}` : r.name}>
                          <span style={{ fontSize: "var(--text-sm)", color: "var(--text-default)", whiteSpace: "nowrap", flexShrink: 0 }}>
                            {r.name}
                          </span>
                          {r.desc && (
                            <span style={{ fontSize: "var(--text-xs)", color: "var(--text-subtle)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
                              {r.desc}
                            </span>
                          )}
                        </span>
                        {(r.kind === "card" || r.kind === "split") && (
                          <button
                            type="button"
                            title={r.kind === "split" ? "분할 수정" : "여러 카테고리로 분할"}
                            onClick={() => {
                              const chargeId = r.kind === "split" ? r.parentId! : r.id;
                              const charge = vCards.find((c) => c.id === chargeId);
                              if (charge) setSplitTarget(charge);
                            }}
                            style={{ border: "none", background: "none", cursor: "pointer", padding: 2, color: r.kind === "split" ? "var(--color-primary)" : "var(--text-subtle)", display: "inline-flex", flexShrink: 0 }}
                          >
                            <Scissors size={13} />
                          </button>
                        )}
                        <Select
                          size="sm"
                          className="sx-ghost"
                          value={r.category}
                          options={CATEGORY_OPTIONS}
                          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => void setCategory(r, e.target.value)}
                          style={{ width: 150 }}
                        />
                        {tipsCheck(r)}
                        <span style={{ width: 110, textAlign: "right", fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--text-strong)", fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{wonFmt(r.amount)}</span>
                      </div>
                    ))}
                    {txOpen.has(s.key) && catRows.length === 0 && <div style={{ fontSize: "var(--text-xs)", color: "var(--text-subtle)", padding: "6px 0" }}>거래 없음</div>}
                  </div>
                )}
              </div>
            );
          })}
          {/* 합계 — 위 카테고리 금액의 총합 (= 요약의 지출) */}
          {slices.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 70px 110px 120px", gap: 8, alignItems: "center", padding: "12px 16px", background: "var(--surface-sunken)" }}>
              <span style={{ paddingLeft: 24, fontSize: "var(--text-sm)", fontWeight: 700, color: "var(--text-strong)" }}>합계</span>
              <span style={{ textAlign: "right", fontSize: "var(--text-sm)", color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>100%</span>
              <span style={{ textAlign: "right", fontSize: "var(--text-xs)", fontVariantNumeric: "tabular-nums", color: totals.spending - (prevTotals?.spending ?? 0) <= 0 ? "var(--green-600, #7f7f7f)" : "var(--red-600, #4d4d4d)" }}>
                {prevTotals ? `${totals.spending - prevTotals.spending <= 0 ? "▼" : "▲"} ${wonFmt(Math.abs(totals.spending - prevTotals.spending))}` : "N/A"}
              </span>
              <span style={{ textAlign: "right", fontSize: "var(--text-sm)", fontWeight: 700, color: "var(--text-strong)", fontVariantNumeric: "tabular-nums" }}>{wonFmt(totals.spending)}</span>
            </div>
          )}
        </div>
      </Card>

      {/* Non-spending (RM 벤치마크): 지출 집계에서 제외된 흐름의 투명한 표시.
          각 줄을 펼치면 거래 내역이 나오고, 분류 셀렉트로 잘못 제외된 건을
          바로 되돌릴 수 있다 (2026-10-01 피드백). */}
      {(totals.internalTotal > 0 || totals.cardPaymentTotal > 0 || totals.tipsFundedTotal > 0 || totals.tipsIncomeTotal > 0 || totals.income > 0) && (
        <Card>
          <CardBody>
            <div style={{ fontSize: "var(--text-2xs)", fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--text-subtle)", paddingBottom: 2 }}>
              Non-spending (지출 집계 제외)
            </div>
            <div style={{ fontSize: "var(--text-2xs)", color: "var(--text-subtle)", paddingBottom: 8 }}>
              지출 합계에 들어가지 않는 돈의 흐름입니다 · 줄을 누르면 내역이 보이고, 분류를 바꾸면 바로 집계에 반영됩니다
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              {([
                {
                  key: "income", emoji: "💵", label: "입금 (해외지사 송금 등 실수입)", value: totals.income,
                  txs: vBank.filter((b) => (b.deposit ?? 0) > 0 && !b.tipsFunded && b.spendCategory !== "internal" && b.spendCategory !== "tips_funded").map((b) => ({
                    kind: "bank" as const, id: b.id, date: b.txDate, name: b.counterparty || b.description || "N/A",
                    desc: b.description || b.memo || "", amount: b.deposit ?? 0, category: b.spendCategory, dir: "입금",
                    hasEvidence: !!evidenceFiles[`bank:${b.id}`]?.length, tipsFunded: b.tipsFunded || b.spendCategory === "tips_funded",
                  })),
                },
                {
                  key: "tips_income", emoji: "🏦", label: "TIPS 지원금 입금", value: totals.tipsIncomeTotal,
                  txs: vBank.filter((b) => (b.deposit ?? 0) > 0 && (b.tipsFunded || b.spendCategory === "tips_funded")).map((b) => ({
                    kind: "bank" as const, id: b.id, date: b.txDate, name: b.counterparty || b.description || "N/A",
                    desc: b.description || b.memo || "", amount: b.deposit ?? 0, category: b.spendCategory, dir: "입금",
                    hasEvidence: !!evidenceFiles[`bank:${b.id}`]?.length, tipsFunded: b.tipsFunded || b.spendCategory === "tips_funded",
                  })),
                },
                {
                  key: "tips_funded", emoji: "🎁", label: "TIPS 지원금 집행 (실지출 제외)", value: totals.tipsFundedTotal,
                  txs: rows.filter((r) => r.tipsFunded).map((r) => ({ ...r, dir: "출금" })),
                },
                {
                  key: "internal", emoji: "🔁", label: "내부이체", value: totals.internalTotal,
                  txs: vBank.filter((b) => b.spendCategory === "internal" && ((b.deposit ?? 0) > 0 || (b.withdrawal ?? 0) > 0)).map((b) => ({
                    kind: "bank" as const, id: b.id, date: b.txDate, name: b.counterparty || b.description || "N/A",
                    desc: b.description || b.memo || "", amount: (b.withdrawal ?? 0) || (b.deposit ?? 0), category: b.spendCategory,
                    dir: (b.withdrawal ?? 0) > 0 ? "출금" : "입금",
                    hasEvidence: !!evidenceFiles[`bank:${b.id}`]?.length, tipsFunded: b.tipsFunded,
                  })),
                },
                {
                  key: "card_payment", emoji: "💳", label: "카드대금 결제", value: totals.cardPaymentTotal,
                  txs: vBank.filter((b) => b.spendCategory === "card_payment" && (b.withdrawal ?? 0) > 0).map((b) => ({
                    kind: "bank" as const, id: b.id, date: b.txDate, name: b.counterparty || b.description || "N/A",
                    desc: b.description || b.memo || "", amount: b.withdrawal ?? 0, category: b.spendCategory, dir: "출금",
                    hasEvidence: !!evidenceFiles[`bank:${b.id}`]?.length, tipsFunded: b.tipsFunded,
                  })),
                },
              ]).filter((g) => g.value > 0).map((g, i) => {
                const isOpen = nsOpen.has(g.key);
                return (
                  <div key={g.key} style={{ borderTop: i === 0 ? "none" : "1px solid var(--border-subtle)" }}>
                    <button
                      type="button"
                      onClick={() => toggleSet(setNsOpen, g.key)}
                      style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "9px 2px", border: "none", background: "none", cursor: "pointer", textAlign: "left", fontFamily: "var(--font-sans)" }}
                    >
                      {isOpen ? <ChevronDown size={14} style={{ color: "var(--text-subtle)", flexShrink: 0 }} /> : <ChevronRight size={14} style={{ color: "var(--text-subtle)", flexShrink: 0 }} />}
                      <span style={{ width: 28, height: 28, borderRadius: 999, background: "var(--surface-sunken)", display: "inline-grid", placeItems: "center", fontSize: 14, flexShrink: 0 }}>{g.emoji}</span>
                      <span style={{ flex: 1, fontSize: "var(--text-sm)", color: "var(--text-default)" }}>
                        {g.label}
                        <span style={{ marginLeft: 7, fontSize: "var(--text-2xs)", color: "var(--text-subtle)" }}>{g.txs.length}건</span>
                      </span>
                      <span style={{ fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--text-strong)", fontVariantNumeric: "tabular-nums" }}>{wonFmt(g.value)}</span>
                    </button>
                    {isOpen && (() => {
                      // TIPS 집행 폴더는 원래 카테고리별 섹션으로 묶는다 —
                      // "지원금으로 급여 얼마, 장비 얼마"가 한눈에 보이게.
                      type NsTx = SpendRow & { dir: string };
                      const all = g.txs as NsTx[];
                      const sections: { cat: string | null; txs: NsTx[] }[] = [];
                      if (g.key === "tips_funded") {
                        const byCat = new Map<string, NsTx[]>();
                        for (const t of all) {
                          const list = byCat.get(t.category) ?? [];
                          list.push(t);
                          byCat.set(t.category, list);
                        }
                        for (const [cat, txs] of [...byCat.entries()].sort((a, b) => (totals.tipsByCategory[b[0]] ?? 0) - (totals.tipsByCategory[a[0]] ?? 0))) {
                          sections.push({ cat, txs });
                        }
                      } else {
                        sections.push({ cat: null, txs: all });
                      }
                      const toRow = (t: NsTx): SpendRow => ({
                        kind: t.kind, id: t.id, parentId: t.parentId, date: t.date, name: t.name,
                        desc: t.desc, amount: t.amount, category: t.category,
                        hasEvidence: t.hasEvidence, tipsFunded: t.tipsFunded,
                      });
                      return (
                        <div style={{ padding: "0 2px 10px 52px" }}>
                          {sections.map((sec) => (
                            <div key={sec.cat ?? "all"}>
                              {sec.cat !== null && (
                                <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "8px 0 2px", fontSize: "var(--text-xs)", fontWeight: 700, color: "var(--text-strong)" }}>
                                  <span>{spendCategory(sec.cat)?.emoji ?? "❔"}</span>
                                  <span>{spendCategoryLabel(sec.cat)}</span>
                                  <span style={{ fontWeight: 400, color: "var(--text-subtle)" }}>{sec.txs.length}건</span>
                                  <span style={{ flex: 1 }} />
                                  <span style={{ fontVariantNumeric: "tabular-nums" }}>{wonFmt(totals.tipsByCategory[sec.cat] ?? sec.txs.reduce((a, t) => a + t.amount, 0))}</span>
                                </div>
                              )}
                              {sec.txs.map((t) => (
                                <div key={`${t.kind}-${t.id}`} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderTop: "1px dashed var(--border-subtle)" }}>
                                  <span style={{ fontSize: "var(--text-2xs)", color: "var(--text-subtle)", width: 78, flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{t.date || "N/A"}</span>
                                  <span style={{ fontSize: "var(--text-2xs)", color: t.dir === "입금" ? "var(--green-600, #7f7f7f)" : "var(--text-subtle)", width: 30, flexShrink: 0 }}>{t.dir}</span>
                                  {detailBtn(toRow(t))}
                                  <span style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "baseline", gap: 7, overflow: "hidden" }} title={t.desc ? `${t.name} · ${t.desc}` : t.name}>
                                    <span style={{ fontSize: "var(--text-sm)", color: "var(--text-default)", whiteSpace: "nowrap", flexShrink: 0 }}>{t.name}</span>
                                    {t.desc && (
                                      <span style={{ fontSize: "var(--text-xs)", color: "var(--text-subtle)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{t.desc}</span>
                                    )}
                                  </span>
                                  <Select
                                    size="sm"
                                    className="sx-ghost"
                                    value={t.category}
                                    options={CATEGORY_OPTIONS}
                                    onChange={(e: React.ChangeEvent<HTMLSelectElement>) => void setCategory(toRow(t), e.target.value)}
                                    style={{ width: 150 }}
                                  />
                                  {tipsCheck(toRow(t))}
                                  <span style={{ width: 110, textAlign: "right", fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--text-strong)", fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{wonFmt(t.amount)}</span>
                                </div>
                              ))}
                            </div>
                          ))}
                          {g.txs.length === 0 && <div style={{ fontSize: "var(--text-xs)", color: "var(--text-subtle)", padding: "6px 0" }}>개별 거래 없음 (분할 금액 등)</div>}
                        </div>
                      );
                    })()}
                  </div>
                );
              })}
            </div>
            {(totals.tipsIncomeTotal > 0 || totals.tipsFundedTotal > 0) && (
              <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--border-subtle)", fontSize: "var(--text-xs)", color: "var(--text-muted)", display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <span>🏦 TIPS 입금 − 🎁 집행 차액 (이 달 기준)</span>
                <span style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums", color: Math.abs(totals.tipsIncomeTotal - totals.tipsFundedTotal) < 1 ? "var(--green-600, #7f7f7f)" : "var(--amber-700, #626262)" }}>
                  {wonFmt(totals.tipsIncomeTotal - totals.tipsFundedTotal)}
                </span>
                <span style={{ flexBasis: "100%", color: "var(--text-subtle)" }}>
                  입금과 집행이 월을 넘어 들어오면(지난달 집행분의 지원금이 이달 입금 등) 0이 아닐 수 있습니다 · 각 줄을 펼쳐 건별로 대조하세요
                </span>
              </div>
            )}
          </CardBody>
        </Card>
      )}
    </div>
  );
}

/* ── 분할 모달 — 항목·금액·카테고리 줄 편집 + AI 영수증 분할 ─────────────── */

