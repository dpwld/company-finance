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
    fetchChargeSplits().then((rows) => { if (alive) setSplits(rows); }).catch(() => { if (alive) setError("Could not load split items."); });
    fetchEvidence(detail.date.slice(0, 7), { cards: detail.kind === "card" ? [detail.id] : [], bank: detail.kind === "bank" ? [detail.id] : [] })
      .then((rows) => { if (alive) setEv(rows); }).catch(() => { if (alive) setError("Could not load receipts."); });
    return () => { alive = false; };
  }, [detail.id, detail.kind, detail.date, evVersion]);

  async function saveMemo() {
    setBusy(detail.key); setError("");
    try {
      if (detail.kind === "card") await updateCardCharge(detail.id, { remarks: memoDraft });
      else await updateBankTx(detail.id, { memo: memoDraft });
      onChanged();
    } catch { setError("Could not save the note."); }
    finally { setBusy(null); }
  }
  async function setAccountOf(r: MoneyTransactionRow, field: "debit_account" | "credit_account", value: string) {
    if (value === (field === "debit_account" ? r.debit : r.credit)) return;
    setError("");
    try {
      if (r.kind === "card") await updateCardCharge(r.id, { [field]: value });
      else await updateBankTx(r.id, { [field]: value });
      onChanged();
    } catch { setError("Could not save the journal entry. Please try again."); }
  }
  const evidenceOf = (r: MoneyTransactionRow) =>
    (ev?.links ?? [])
      .filter((l) => (r.kind === "card" ? l.cardChargeId === r.id : l.bankTxId === r.id))
      .map((l) => ev!.files.find((f) => f.id === l.evidenceId))
      .filter((f): f is EvidenceFile => Boolean(f));

  const splitsOf = (r: MoneyTransactionRow) =>
    splits.filter((s) => (r.kind === "card" ? s.cardChargeId === r.id : s.bankTxId === r.id));

  return <>
    <Modal open title={detail.name} aria-label="Transaction details" size="lg" onClose={onClose}>
      <div className="money-root" style={{ display: "block", minHeight: 0, padding: 16 }}>
              <p className="money-sub">{detail.date} · {detail.account} · {detail.type}</p>
              <div className="money-amount" style={{ fontSize: 30 }}>
                {detail.amount == null ? "KRW amount pending" : `${detail.amount > 0 ? "+" : "−"}${wonFmt(Math.abs(detail.amount))}`}
              </div>

              {detail.balance != null && <div className="money-summary-row"><span className="money-muted">Balance after transaction</span><span>{wonFmt(detail.balance)}</span></div>}
              {detail.approvalDate && <div className="money-summary-row"><span className="money-muted">Approval date</span><span>{detail.approvalDate}</span></div>}
              {detail.sourceFile && <p className="money-note">Source: {detail.sourceFile}</p>}
              <div className="money-summary-row"><span className="money-muted">Category</span><span>{spendCategoryLabel(detail.category)}</span></div>
              {detail.memo && <div className="money-summary-row"><span className="money-muted">Description</span><span>{detail.memo}</span></div>}

              <button type="button" onClick={() => { setCategorySubject(detail); }}>Search categories · Categorize matching transactions</button>
              <p className="money-label" style={{ marginTop: 20 }}>Note</p>
              <textarea aria-label="Transaction note" value={memoDraft} onChange={(e) => setMemoDraft(e.target.value)} rows={3} style={{ width: "100%", padding: 10 }} />
              <button type="button" disabled={busy === detail.key} onClick={() => void saveMemo()}>Save note</button>
              {error && <p role="alert" className="money-negative">{error}</p>}

              <p className="money-label" style={{ marginTop: 20 }}>Journal entry</p>
              <div className="money-summary-row">
                <span className="money-muted">Debit</span>
                <input defaultValue={detail.debit} placeholder="Account name"
                  onBlur={(e) => setAccountOf(detail, "debit_account", e.target.value.trim())}
                  style={{ border: "1px solid var(--line)", borderRadius: 7, padding: "6px 8px", width: 180 }} />
              </div>
              <div className="money-summary-row">
                <span className="money-muted">Credit</span>
                <input defaultValue={detail.credit} placeholder="Account name"
                  onBlur={(e) => setAccountOf(detail, "credit_account", e.target.value.trim())}
                  style={{ border: "1px solid var(--line)", borderRadius: 7, padding: "6px 8px", width: 180 }} />
              </div>

              <p className="money-label" style={{ marginTop: 20 }}>Split items</p>
              {splitsOf(detail).length === 0 ? (
                <p className="money-sub">This transaction has no splits.</p>
              ) : splitsOf(detail).map((s) => (
                <div key={s.id} className="money-summary-row">
                  <span>{s.label || "Split items"}</span><span>{wonFmt(s.amount)}</span>
                </div>
              ))}
              <button type="button" style={{ marginTop: 8 }}
                onClick={() => setSplitSubject({
                  kind: detail.kind, id: detail.id,
                  title: detail.name, amount: Math.abs(detail.amount ?? 0),
                })}>
                Split transaction
              </button>

              <p className="money-label" style={{ marginTop: 20 }}>Receipts</p>
              {evidenceOf(detail).length === 0 ? <p className="money-sub">No linked receipts. Upload and link receipts or tax invoices to see them here.</p> : evidenceOf(detail).map((f) => (
                <div key={f.id} className="money-summary-row">
                  <span>{f.fileName}</span>
                  <button type="button" className="money-text-button"
                    onClick={async () => { const url = await evidenceUrl(f.storagePath); window.open(url, "_blank", "noopener"); }}>
                    Open →
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
