"use client";

import { useEffect, useState } from "react";
import { fetchChargeSplits, updateBankTx, updateCardCharge, type ChargeSplit } from "@/lib/data/finance";
import { evidenceUrl, fetchEvidence, type EvidenceFile, type EvidenceLink } from "@/lib/data/evidence";
import { spendCategoryLabel, wonFmt } from "@/lib/finance/spend";
import type { MoneyTransactionRow } from "@/lib/finance/transactions";
import { Modal } from "@/components/ds/feedback/Modal";
import { MoneyCategoryPicker, type CategorySubject } from "./MoneyCategoryPicker";
import { SplitModal, type SplitSubject } from "./SplitModal";

export function MoneyTransactionDetail({ detail, evVersion, onClose, onChanged }: {
  detail: MoneyTransactionRow; evVersion: number; onClose: () => void; onChanged: () => void;
}) {
  const [memoDraft, setMemoDraft] = useState(detail.note);
  const [splits, setSplits] = useState<ChargeSplit[]>([]);
  const [ev, setEv] = useState<{ files: EvidenceFile[]; links: EvidenceLink[] } | null>(null);
  const [categorySubject, setCategorySubject] = useState<CategorySubject | null>(null);
  const [splitSubject, setSplitSubject] = useState<SplitSubject | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    fetchChargeSplits().then((rows) => { if (alive) setSplits(rows); }).catch(() => { if (alive) setError("세부항목을 불러오지 못했습니다."); });
    fetchEvidence(detail.date.slice(0, 7), { cards: detail.kind === "card" ? [detail.id] : [], bank: detail.kind === "bank" ? [detail.id] : [] })
      .then((rows) => { if (alive) setEv(rows); }).catch(() => { if (alive) setError("증빙을 불러오지 못했습니다."); });
    return () => { alive = false; };
  }, [detail.id, detail.kind, detail.date, evVersion]);

  async function saveMemo() {
    setBusy(detail.key); setError("");
    try {
      if (detail.kind === "card") await updateCardCharge(detail.id, { remarks: memoDraft });
      else await updateBankTx(detail.id, { memo: memoDraft });
      onChanged();
    } catch { setError("메모를 저장하지 못했습니다."); }
    finally { setBusy(null); }
  }
  async function setAccountOf(r: MoneyTransactionRow, field: "debit_account" | "credit_account", value: string) {
    if (value === (field === "debit_account" ? r.debit : r.credit)) return;
    setError("");
    try {
      if (r.kind === "card") await updateCardCharge(r.id, { [field]: value });
      else await updateBankTx(r.id, { [field]: value });
      onChanged();
    } catch { setError("분개를 저장하지 못했습니다. 다시 시도해 주세요."); }
  }
  const evidenceOf = (r: MoneyTransactionRow) =>
    (ev?.links ?? [])
      .filter((l) => (r.kind === "card" ? l.cardChargeId === r.id : l.bankTxId === r.id))
      .map((l) => ev!.files.find((f) => f.id === l.evidenceId))
      .filter((f): f is EvidenceFile => Boolean(f));

  const splitsOf = (r: MoneyTransactionRow) =>
    splits.filter((s) => (r.kind === "card" ? s.cardChargeId === r.id : s.bankTxId === r.id));

  return <>
    <Modal open title={detail.name} aria-label="거래 상세" size="lg" onClose={onClose}>
      <div className="money-root" style={{ display: "block", minHeight: 0, padding: 16 }}>
              <p className="money-sub">{detail.date} · {detail.account} · {detail.type}</p>
              <div className="money-amount" style={{ fontSize: 30 }}>
                {detail.amount == null ? "원화 미확정" : `${detail.amount > 0 ? "+" : "−"}${wonFmt(Math.abs(detail.amount))}`}
              </div>

              {detail.balance != null && <div className="money-summary-row"><span className="money-muted">거래 후 잔액</span><span>{wonFmt(detail.balance)}</span></div>}
              {detail.approvalDate && <div className="money-summary-row"><span className="money-muted">승인일</span><span>{detail.approvalDate}</span></div>}
              {detail.sourceFile && <p className="money-note">출처: {detail.sourceFile}</p>}
              <div className="money-summary-row"><span className="money-muted">분류</span><span>{spendCategoryLabel(detail.category)}</span></div>
              {detail.memo && <div className="money-summary-row"><span className="money-muted">적요</span><span>{detail.memo}</span></div>}

              <button type="button" onClick={() => { setCategorySubject(detail); }}>카테고리 검색 · 같은 거래명 함께 분류</button>
              <p className="money-label" style={{ marginTop: 20 }}>메모</p>
              <textarea aria-label="거래 메모" value={memoDraft} onChange={(e) => setMemoDraft(e.target.value)} rows={3} style={{ width: "100%", padding: 10 }} />
              <button type="button" disabled={busy === detail.key} onClick={() => void saveMemo()}>메모 저장</button>
              {error && <p role="alert" className="money-negative">{error}</p>}

              <p className="money-label" style={{ marginTop: 20 }}>분개</p>
              <div className="money-summary-row">
                <span className="money-muted">차변</span>
                <input defaultValue={detail.debit} placeholder="계정과목"
                  onBlur={(e) => setAccountOf(detail, "debit_account", e.target.value.trim())}
                  style={{ border: "1px solid var(--line)", borderRadius: 7, padding: "6px 8px", width: 180 }} />
              </div>
              <div className="money-summary-row">
                <span className="money-muted">대변</span>
                <input defaultValue={detail.credit} placeholder="계정과목"
                  onBlur={(e) => setAccountOf(detail, "credit_account", e.target.value.trim())}
                  style={{ border: "1px solid var(--line)", borderRadius: 7, padding: "6px 8px", width: 180 }} />
              </div>

              <p className="money-label" style={{ marginTop: 20 }}>세부항목</p>
              {splitsOf(detail).length === 0 ? (
                <p className="money-sub">나뉘지 않은 거래입니다.</p>
              ) : splitsOf(detail).map((s) => (
                <div key={s.id} className="money-summary-row">
                  <span>{s.label || "세부항목"}</span><span>{wonFmt(s.amount)}</span>
                </div>
              ))}
              <button type="button" style={{ marginTop: 8 }}
                onClick={() => setSplitSubject({
                  kind: detail.kind, id: detail.id,
                  title: detail.name, amount: Math.abs(detail.amount ?? 0),
                })}>
                세부항목으로 나누기
              </button>

              <p className="money-label" style={{ marginTop: 20 }}>증빙</p>
              {evidenceOf(detail).length === 0 ? <p className="money-sub">연결된 증빙이 없습니다. 영수증·세금계산서를 증빙 업로드로 올리면 여기에 붙습니다.</p> : evidenceOf(detail).map((f) => (
                <div key={f.id} className="money-summary-row">
                  <span>{f.fileName}</span>
                  <button type="button" className="money-text-button"
                    onClick={async () => { const url = await evidenceUrl(f.storagePath); window.open(url, "_blank", "noopener"); }}>
                    열기 →
                  </button>
                </div>
              ))}

      </div>
    </Modal>
    {categorySubject && <MoneyCategoryPicker subject={categorySubject} onClose={() => { setCategorySubject(null); onClose(); }} onSaved={onChanged} />}
    {splitSubject && <SplitModal subject={splitSubject} existing={splitsOf(detail)} evidence={[]} onClose={() => setSplitSubject(null)}
      onSaved={() => { setSplitSubject(null); fetchChargeSplits().then(setSplits).catch(() => {}); onChanged(); }} onError={setError} />}
  </>;
}
