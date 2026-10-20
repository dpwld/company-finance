"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { Alert } from "@/components/ds/feedback/Alert";
import { Button } from "@/components/ds/core/Button";
import { Input } from "@/components/ds/forms/Input";
import { Modal } from "@/components/ds/feedback/Modal";
import { Select } from "@/components/ds/forms/Select";
import { Spinner } from "@/components/ds/core/Spinner";
import { saveChargeSplits, type ChargeSplit, type SplitTarget } from "@/lib/data/finance";
import { SPEND_CATEGORY_OPTIONS, wonFmt } from "@/lib/finance/spend";

/* 거래 분할 — 한 결제/이체에 성격이 다른 항목이 섞였을 때 세부항목으로 나눈다.
   Spending·Transactions·TIPS 세 탭이 공유한다. 카드 결제와 은행 이체 모두 지원.
   AI 영수증 분할은 지출 카테고리와 함께 TIPS 판정(처리된 항목·상태)도 제안한다. */

export interface SplitSubject {
  kind: "card" | "bank";
  id: string;
  /** 모달 제목에 쓰는 거래명. */
  title: string;
  /** 분할 총액 (카드 승인액 / 이체 출금액). */
  amount: number;
}

export interface EvidenceRef { id: string; fileName: string }

interface Line {
  label: string;
  amount: string;
  category: string;
  /** AI가 함께 제안한 TIPS 판정 — 저장 시 분할 줄에 기록된다. */
  classification?: string;
  status?: string;
  remarks?: string;
}

const CATEGORY_OPTIONS = SPEND_CATEGORY_OPTIONS.filter(
  (o) => !["income", "internal", "card_payment"].includes(o.value),
);

export function SplitModal({ subject, existing, evidence, onClose, onSaved, onError }: {
  subject: SplitSubject;
  existing: ChargeSplit[];
  evidence: EvidenceRef[];
  onClose: () => void;
  onSaved: () => void;
  onError: (msg: string) => void;
}) {
  const total = subject.amount;
  const [lines, setLines] = useState<Line[]>(
    existing.length > 0
      ? existing.map((sp) => ({
          label: sp.label, amount: String(sp.amount), category: sp.spendCategory,
          classification: sp.classification, status: sp.status, remarks: sp.remarks,
        }))
      : [{ label: "", amount: "", category: "" }],
  );
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const sum = lines.reduce((a, l) => a + (Number(l.amount) || 0), 0);
  const remainder = total - sum;
  const target: SplitTarget = subject.kind === "card" ? { cardChargeId: subject.id } : { bankTxId: subject.id };

  const patchLine = (i: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  /** 영수증(vision)으로 라인아이템 추출 → 줄 채움 (수정 후 저장). */
  async function aiSplit() {
    setAiBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/finance/receipt-split", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ merchant: subject.title, amount: total, evidence }),
      });
      const json = (await res.json() as any);
      if (!res.ok) throw new Error(json.detail || json.error || `HTTP ${res.status}`);
      const items = (json.items ?? []) as { label: string; amount: number; category: string; classification?: string; status?: string; note?: string }[];
      if (items.length === 0) throw new Error("영수증에서 항목을 찾지 못했습니다");
      setLines(items.map((it) => ({
        label: it.label, amount: String(it.amount), category: it.category,
        classification: it.classification ?? "", status: it.status ?? "", remarks: it.note ?? "",
      })));
      setNote(`영수증에서 ${items.length}개 항목을 읽었습니다. 금액·분류를 확인하고 저장하세요. TIPS 판정도 함께 채워집니다.`);
    } catch (err) {
      setNote(`AI 분할 실패: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setAiBusy(false);
    }
  }

  async function save(clear = false) {
    setBusy(true);
    try {
      if (clear) {
        await saveChargeSplits(target, []);
      } else {
        const valid = lines
          .map((l) => ({
            label: l.label.trim(), amount: Number(l.amount) || 0, spendCategory: l.category,
            classification: l.classification ?? "", status: l.status ?? "", remarks: l.remarks ?? "",
          }))
          .filter((l) => l.amount > 0);
        if (valid.length === 0) { onError("금액이 있는 항목이 최소 1줄 필요합니다."); setBusy(false); return; }
        const validSum = valid.reduce((a, l) => a + l.amount, 0);
        if (validSum > total) { setNote(`항목 합계가 결제액을 ${wonFmt(validSum - total)} 초과합니다: 금액을 조정하세요.`); setBusy(false); return; }
        // 잔여 금액은 자동으로 '기타' 줄
        if (validSum < total) valid.push({ label: "잔여 (자동)", amount: total - validSum, spendCategory: "etc", classification: "", status: "", remarks: "" });
        await saveChargeSplits(target, valid);
      }
      onSaved();
    } catch (err) {
      console.error("split save failed:", err);
      onError("분할 저장에 실패했습니다 · charge_splits 테이블(2026-08-05 / 2026-08-28 SQL) 실행 여부를 확인하세요.");
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`분할 · ${subject.title || "거래"} (${wonFmt(total)})`}
      size="lg"
      footer={
        <>
          {existing.length > 0 && (
            <Button variant="ghost" disabled={busy} onClick={() => void save(true)}>분할 해제</Button>
          )}
          <span style={{ flex: 1 }} />
          <Button variant="ghost" onClick={onClose}>취소</Button>
          <Button variant="primary" disabled={busy} onClick={() => void save()}>{busy ? "저장 중…" : "분할 저장"}</Button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <Button
            variant="secondary"
            size="sm"
            leftIcon={aiBusy ? <Spinner size="sm" /> : <Sparkles size={14} />}
            disabled={aiBusy || evidence.length === 0}
            onClick={() => void aiSplit()}
          >
            {aiBusy ? "영수증 읽는 중…" : "AI 영수증 분할"}
          </Button>
          <span style={{ fontSize: "var(--text-2xs)", color: "var(--text-subtle)" }}>
            {evidence.length > 0
              ? `연결된 증빙 ${evidence.length}건: ${evidence.map((e) => e.fileName).join(", ")}`
              : "증빙(영수증)을 먼저 이 거래에 연결하면 AI 분할을 쓸 수 있습니다."}
          </span>
        </div>
        {note && <Alert tone="info" title="AI 분할">{note}</Alert>}

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 130px 170px 30px", gap: 6, fontSize: "var(--text-2xs)", fontWeight: 600, color: "var(--text-subtle)", textTransform: "uppercase", letterSpacing: ".05em" }}>
          <span>항목</span><span>금액 (₩)</span><span>분류</span><span />
        </div>
        {lines.map((l, i) => (
          <div key={i} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 130px 170px 30px", gap: 6, alignItems: "center" }}>
              <Input size="sm" value={l.label} placeholder="상품/항목명" onChange={(e: React.ChangeEvent<HTMLInputElement>) => patchLine(i, { label: e.target.value })} />
              <Input size="sm" type="number" value={l.amount} placeholder="0" onChange={(e: React.ChangeEvent<HTMLInputElement>) => patchLine(i, { amount: e.target.value })} />
              <Select size="sm" value={l.category} options={CATEGORY_OPTIONS} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => patchLine(i, { category: e.target.value })} />
              <button type="button" aria-label="줄 삭제" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} style={{ border: "none", background: "none", cursor: "pointer", color: "var(--text-subtle)", padding: 2 }}>✕</button>
            </div>
            {(l.status || l.classification) && (
              <span style={{ fontSize: "var(--text-2xs)", color: "var(--text-subtle)", paddingLeft: 2 }}>
                TIPS: {l.status || "N/A"}{l.classification ? ` · ${l.classification}` : ""}
              </span>
            )}
          </div>
        ))}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Button variant="soft" size="sm" onClick={() => setLines((ls) => [...ls, { label: "", amount: "", category: "" }])}>+ 항목 추가</Button>
          <span style={{ fontSize: "var(--text-xs)", color: remainder === 0 ? "var(--green-600, #7f7f7f)" : remainder > 0 ? "var(--text-muted)" : "var(--red-600, #4d4d4d)", fontVariantNumeric: "tabular-nums" }}>
            {remainder === 0 ? "합계 일치 ✓" : remainder > 0 ? `잔여 ${wonFmt(remainder)} → 저장 시 '기타'로 자동 추가` : `초과 ${wonFmt(-remainder)}: 금액 조정 필요`}
          </span>
        </div>
      </div>
    </Modal>
  );
}
