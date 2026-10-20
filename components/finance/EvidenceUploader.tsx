"use client";

import { useEffect, useRef, useState } from "react";
import { FolderUp, Paperclip, RefreshCcw } from "lucide-react";
import { Badge } from "@/components/ds/core/Badge";
import { Button } from "@/components/ds/core/Button";
import { Spinner } from "@/components/ds/core/Spinner";
import { Input } from "@/components/ds/forms/Input";
import { Modal } from "@/components/ds/feedback/Modal";
import { fetchMatchWindow, updateBankTx, updateCardCharge, type BankTx, type CardCharge } from "@/lib/data/finance";
import { fetchEvidence, linkEvidence, moveEvidenceMonth, uploadEvidence, type EvidenceFile } from "@/lib/data/evidence";
import { clearJobResult, startJob, type JobHandle } from "@/lib/finance/aiJobs";
import { useAiJob } from "@/lib/hooks/useAiJob";
import { datesFromFilename, matchByName, monthFromFileName, type SpendCandidate } from "@/lib/finance/evidenceMatch";
import { useCurrentUser } from "@/lib/auth/CurrentUserContext";
import { fmtWon, shiftMonth } from "./shared";

/* ONE evidence flow for the whole Finance tool (header button next to
   "Upload file"): upload the month's receipt folder → filename rule links
   receipts to card charges → AI reads the leftovers' content → then, for
   every affected row, a single confirmation modal settles BOTH ledgers at
   once: 내용 (what it is) + 분개 (차변/대변) for Transactions, and the TIPS
   budget status for the worksheet. */

const EVIDENCE_TYPES = /\.(pdf|png|jpe?g|gif|webp|heic)$/i;
const AI_MAX_FILES = 12;

const ELIGIBILITY_TO_STATUS: Record<string, string> = { 적합: "확인필요", 확인필요: "확인필요", 해당없음: "해당없음" };

interface ReviewRow {
  rowId: string;
  kind: "bank" | "card";
  title: string;
  fileNames: string[];
  /** evidence ids to link on apply (AI matches — name matches are already linked) */
  pendingLinks: { evidenceId: string; note: string }[];
  label: string;
  debit: string;
  credit: string;
  /** TIPS status (card + bank) */
  status: string;
  note: string;
  accepted: boolean;
}

interface Props {
  month: string;
  bank: BankTx[];
  cards: CardCharge[];
  disabled?: boolean;
  onApplied: () => void;
}


export function EvidenceUploader({ month, bank, disabled, onApplied }: Props) {
  const me = useCurrentUser();
  const job = useAiJob("evidence-upload");
  const busy = job.running;
  const progress = job.running && job.total ? { done: job.done, total: job.total } : null;
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<ReviewRow[] | null>(null);
  const [applying, setApplying] = useState(false);
  const [unmatchedNames, setUnmatchedNames] = useState<string[]>([]);
  // 백그라운드 업로드·매칭이 끝나면 검토 목록을 받아 띄운다 — 다른 메뉴에 다녀와도 그대로 남아 있다.
  useEffect(() => {
    const out = job.result as { rows: ReviewRow[]; unmatched: string[] } | null;
    if (!out) return;
    // 렌더 중 동기 setState를 피해 다음 마이크로태스크에서 반영한다
    queueMicrotask(() => {
      clearJobResult("evidence-upload");
      setUnmatchedNames(out.unmatched);
      if (out.rows.length || out.unmatched.length) setReview(out.rows);
      else setError("처리할 항목이 없습니다.");
    });
  }, [job.result]);
  const folderRef = useRef<HTMLInputElement>(null);

  const isSpendCard = (c: CardCharge) =>
    c.amount != null ? c.amount > 0 : !(c.cardMeta["해외승인금액"] ?? "").trim().startsWith("-");

  async function onFolder(list: FileList | null) {
    if (!list?.length) return;
    // Only receipts (image/PDF) are evidence — Excel sheets, hidden files and
    // anything else in the folder are skipped automatically, not an error.
    const all = [...list];
    const files = all.filter((f) => EVIDENCE_TYPES.test(f.name) && !f.name.startsWith("."));
    const skipped = all.length - files.length;
    if (!files.length) { setError("이미지·PDF 증빙이 없습니다 (엑셀 등 다른 파일은 자동 제외됩니다)."); return; }
    setError(null);
    if (folderRef.current) folderRef.current.value = "";
    // 업로드·매칭은 모듈 스코프에서 — 다른 메뉴로 이동해도 끝까지 돈다.
    startJob("evidence-upload", async (h) => {
      const uploaded: EvidenceFile[] = [];
      /* 조회 중인 달이 아니라 파일명이 가리키는 달에 넣는다 — 8월을 보면서 올린
         "0907…"은 9월 증빙이다. 이 달 것만 매칭 대상이고, 나머지는 그 달에서
         재매칭하면 된다(후보 거래가 그 달에 있으므로). */
      const elsewhere = new Map<string, number>();
      const everything: EvidenceFile[] = [];
      h.progress(0, files.length);
      for (const f of files) {
        const target = monthFromFileName(f.name, month) ?? month;
        const row = await uploadEvidence(f, target, me.fullName);
        everything.push(row);
        if (target === month) uploaded.push(row);
        else elsewhere.set(target, (elsewhere.get(target) ?? 0) + 1);
        h.progress(everything.length, files.length);
      }
      /* 세금계산서를 따로 등록하던 자동 AI 추출은 2026-10 개편 때 멈췄다 —
         세금계산서도 다른 증빙과 똑같이 거래에 붙이기만 하면 되고, 파일마다
         vision 호출이 나가 비용만 들었다. 수동 추출은 /finance2에 남아 있다. */
      const moved = [...elsewhere.entries()].sort().map(([m, n]) => `${m.slice(5)}월 ${n}건`).join(", ");
      const outcome = await runPipeline([...new Map(uploaded.map((f) => [f.id, f])).values()], skipped, h);
      // 검토 목록은 잡에 남긴다 — 화면이 사라졌다 돌아와도 그대로 뜬다
      h.setResult(outcome);
      return `증빙 ${uploaded.length}건 업로드·매칭 완료${moved ? ` · 다른 달로 보관: ${moved}` : ""}`;
    });
  }

  /** Re-run auto-matching (filename rule + AI) over evidence ALREADY uploaded
     this month but still unlinked — no re-upload needed. */
  function retryUnmatched() {
    setError(null);
    startJob("evidence-upload", async (h) => {
      // 장부 달이 아닌 곳에 보관된 증빙도 함께 읽는다. 예전 규칙으로는 "1007…"이
      // 10월에 들어갔지만, 그 거래는 9월 이용기간(09-09~10-08)에 있어 제 장부에서
      // 보이지 않았다. 앞뒤 달까지 읽어 제자리로 돌려보낸다.
      const near = await Promise.all([shiftMonth(month, -1), month, shiftMonth(month, 1)].map((m) => fetchEvidence(m)));
      const seen = new Set<string>();
      const allFiles = near.flatMap((r) => r.files).filter((f) => !seen.has(f.id) && seen.add(f.id));
      const linked = new Set(near.flatMap((r) => r.links).map((l) => l.evidenceId));
      const unlinkedAll = allFiles.filter((f) => !linked.has(f.id));

      // 보관된 달과 파일명이 가리키는 장부 달이 다르면 옮긴다.
      const ledgerOf = (f: EvidenceFile) => monthFromFileName(f.fileName, f.month) ?? f.month;
      const strays = unlinkedAll.filter((f) => ledgerOf(f) !== f.month);
      for (const f of strays) await moveEvidenceMonth(f.id, ledgerOf(f));
      // 옮기고 나서 이 달 장부에 속하는 것만 매칭한다.
      const pending = unlinkedAll.filter((f) => ledgerOf(f) === month);
      const movedNote = strays.length ? ` · 제 장부로 옮김 ${strays.length}건` : "";
      if (strays.length) onApplied();
      if (!pending.length) return `미연결 증빙이 없습니다.${movedNote}`;
      h.progress(0, pending.length);
      const outcome = await runPipeline(pending, 0, h);
      h.setResult(outcome);
      return `증빙 ${pending.length}건 재매칭 완료${movedNote}`;
    });
  }

  /** Shared pipeline: filename matching → AI pass → journal proposals →
     the combined review modal. `rows` are stored evidence files (no raw File
     needed — the AI route reads content from the bucket by path). */
  async function runPipeline(rows0: EvidenceFile[], skipped: number, h: JobHandle): Promise<{ rows: ReviewRow[]; unmatched: string[] }> {
    {
      // Candidates come from a WIDE window (prev month 1st → this month end),
      // fetched fresh — receipts dated after the 8th belong to NEXT month's
      // card bill, and matching only the on-screen month left them stranded.
      const win = await fetchMatchWindow(month);
      const spendCards = win.cards.filter(isSpendCard);
      const spendBank = win.bank.filter((b) => (b.withdrawal ?? 0) > 0);
      const candidates: SpendCandidate[] = [
        ...spendCards.map((c) => ({ id: c.id, kind: "card" as const, date: c.approvalDate, name: c.merchant })),
        ...spendBank.map((b) => ({ id: b.id, kind: "bank" as const, date: b.txDate, name: b.counterparty })),
      ];
      // Latest dates we HAVE data for — used to explain unmatched files.
      const lastCard = spendCards.reduce((a, c) => (c.approvalDate && c.approvalDate > a ? c.approvalDate : a), "");
      const lastBank = spendBank.reduce((a, b) => (b.txDate > a ? b.txDate : a), "");
      const coverageEnd = [lastCard, lastBank].filter(Boolean).sort().pop() ?? "";

      // 1) filename rule → immediate links; leftovers go to the AI pass
      const linkedFiles = new Map<string, string[]>(); // rowId → fileNames
      const needAi: { row: EvidenceFile; suggested: string[] }[] = [];
      for (const row of rows0) {
        // 화면 달이 아니라 이 증빙이 보관된 달로 날짜를 읽는다. 9월 장부를 보는
        // 중에 올린 "1007…"은 10월 증빙으로 보관되므로, 화면 달로 읽으면 날짜가
        // 하나도 안 잡혀 전부 미매칭으로 떨어졌다.
        const m = matchByName(row.fileName, row.month || month, candidates);
        if (m.auto.length) {
          for (const a of m.auto) {
            await linkEvidence(row.id, a.kind === "bank" ? { bankTxId: a.id } : { cardChargeId: a.id }, "name");
            linkedFiles.set(a.id, [...(linkedFiles.get(a.id) ?? []), row.fileName]);
          }
        } else {
          needAi.push({ row, suggested: m.suggested.map((s) => s.id) });
        }
      }

      // 2) AI reads leftover content → match + eligibility
      const aiByRow = new Map<string, { files: { evidenceId: string; fileName: string }[]; eligibility: string; note: string }>();
      const unmatched: string[] = [];
      if (skipped > 0) unmatched.push(`증빙이 아닌 파일 ${skipped}개는 자동 제외했습니다 (엑셀 등).`);
      // 남은 파일은 AI가 내용을 읽어 매칭한다. 한 번에 다 보내면 요청이 너무 커져
      // AI_MAX_FILES씩 나눠 보내되, 예전처럼 초과분을 버리지 않고 끝까지 돈다.
      for (let bi = 0; bi < needAi.length; bi += AI_MAX_FILES) {
        const batch = needAi.slice(bi, bi + AI_MAX_FILES);
        h.progress(Math.min(bi + batch.length, needAi.length), needAi.length);
        // Send only the storage PATH — the server reads the file from the
        // "evidence" bucket. Sending base64 here overran Vercel's request-body
        // limit (413 "Request Entity Too Large").
        const payloadFiles = batch.map((u) => ({
          id: u.row.id,
          name: u.row.fileName,
          mime: u.row.mimeType || (u.row.fileName.toLowerCase().endsWith(".pdf") ? "application/pdf" : "image/jpeg"),
          path: u.row.storagePath,
        }));
        const res = await fetch("/api/finance/evidence-match", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            month,
            files: payloadFiles,
            charges: [
              // 금액 대조가 1순위 근거라 부가세·매입일까지 함께 넘긴다
              ...spendCards.map((c) => ({
                id: c.id, kind: "card", date: c.approvalDate, merchant: c.merchant,
                amount: c.amount, vat: c.vat, purchaseDate: c.purchaseDate, status: c.status,
              })),
              ...spendBank.map((b) => ({
                id: b.id, kind: "bank", date: b.txDate, merchant: b.counterparty,
                amount: b.withdrawal, memo: b.accountLabel || b.category, status: b.status,
              })),
            ],
          }),
        });
        const json = (await res.json() as any);
        if (!res.ok) throw new Error(json.detail || json.error || `HTTP ${res.status}`);
        const byFile = new Map<string, { chargeIds: string[]; eligibility: string; note: string }>(
          (json.matches ?? []).map((m: { fileId: string; chargeIds: string[]; eligibility: string; note: string }) => [m.fileId, m]),
        );
        for (const u of batch) {
          const ai = byFile.get(u.row.id);
          const chargeIds = [...new Set(ai?.chargeIds ?? [])].filter((id) => candidates.some((c) => c.id === id));
          // Ambiguous suggestions are never silently promoted to links.
          if (chargeIds.length > 1) {
            unmatched.push(`${u.row.fileName}: 여러 거래가 후보입니다. 원본 확인 후 직접 연결하세요.`);
            continue;
          }
          if (!chargeIds.length) {
            // Say WHY when the file is dated past the uploaded statements —
            // that's a data gap, not a matching failure.
            const ds = datesFromFilename(u.row.fileName, u.row.month || month);
            const beyond = coverageEnd && ds.length > 0 && ds.every((d) => d > coverageEnd);
            unmatched.push(beyond ? `${u.row.fileName} · ${coverageEnd} 이후 거래내역이 아직 업로드되지 않았습니다` : u.row.fileName);
            continue;
          }
          for (const cid of chargeIds) {
            const cur = aiByRow.get(cid) ?? { files: [], eligibility: "", note: "" };
            cur.files.push({ evidenceId: u.row.id, fileName: u.row.fileName });
            cur.eligibility = ai?.eligibility ?? cur.eligibility;
            cur.note = ai?.note ?? cur.note;
            aiByRow.set(cid, cur);
          }
        }
      }

      // 3) affected rows → journal + label proposals (one call)
      const affectedIds = new Set([...linkedFiles.keys(), ...aiByRow.keys()]);
      const affectedCards = spendCards.filter((c) => affectedIds.has(c.id));
      const affectedBank = spendBank.filter((b) => affectedIds.has(b.id));
      // include the ON-SCREEN month's other bank rows without 분개 so
      // 카드대금/기장료 etc. get done in the same pass
      const bankPending = bank.filter((b) => !affectedIds.has(b.id) && !b.debitAccount && !b.creditAccount);
      const evidenceNames = (id: string) => [
        ...(linkedFiles.get(id) ?? []),
        ...(aiByRow.get(id)?.files.map((f) => f.fileName) ?? []),
      ];

      const journalRows = [
        ...affectedCards.map((c) => ({
          id: c.id, kind: "card" as const, date: c.approvalDate,
          party: c.merchant, deposit: null, withdrawal: c.amount,
          description: c.itemName || c.industry,
          evidence: evidenceNames(c.id),
        })),
        ...affectedBank.map((b) => ({
          id: b.id, kind: "bank" as const, date: b.txDate,
          party: b.counterparty, deposit: b.deposit, withdrawal: b.withdrawal,
          description: b.description, evidence: evidenceNames(b.id),
        })),
        ...bankPending.map((b) => ({
          id: b.id, kind: "bank" as const, date: b.txDate,
          party: b.counterparty, deposit: b.deposit, withdrawal: b.withdrawal,
          description: b.description, evidence: [],
        })),
      ];

      const journalById = new Map<string, { debit: string; credit: string; label: string; note: string }>();
      if (journalRows.length) {
        const res = await fetch("/api/finance/journal", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ month, rows: journalRows }),
        });
        const json = (await res.json() as any);
        if (!res.ok) throw new Error(json.detail || json.error || `HTTP ${res.status}`);
        for (const e of json.entries ?? []) journalById.set(e.id, e);
      }

      // 4) build the combined review
      const rows: ReviewRow[] = [];
      for (const c of affectedCards) {
        const j = journalById.get(c.id);
        const ai = aiByRow.get(c.id);
        rows.push({
          rowId: c.id, kind: "card",
          title: `${c.approvalDate?.slice(5) ?? "?"} ${c.merchant} ${c.amount != null ? fmtWon(c.amount) + "원" : (c.cardMeta["해외승인금액"] ?? "")}`,
          fileNames: evidenceNames(c.id),
          pendingLinks: (ai?.files ?? []).map((f) => ({ evidenceId: f.evidenceId, note: [ai?.eligibility, ai?.note].filter(Boolean).join(" · ") })),
          label: j?.label || c.itemName,
          debit: j?.debit ?? c.debitAccount,
          credit: j?.credit ?? c.creditAccount,
          status: c.status || ELIGIBILITY_TO_STATUS[ai?.eligibility ?? ""] || "",
          note: [ai?.note, j?.note].filter(Boolean).join(" · "),
          accepted: false,
        });
      }
      for (const b of affectedBank) {
        const j = journalById.get(b.id);
        const ai = aiByRow.get(b.id);
        rows.push({
          rowId: b.id, kind: "bank",
          title: `${b.txDate.slice(5)} ${b.counterparty} ${fmtWon(b.withdrawal ?? b.deposit)}원`,
          fileNames: evidenceNames(b.id),
          pendingLinks: (ai?.files ?? []).map((f) => ({ evidenceId: f.evidenceId, note: [ai?.eligibility, ai?.note].filter(Boolean).join(" · ") })),
          label: j?.label || b.category,
          debit: j?.debit ?? b.debitAccount,
          credit: j?.credit ?? b.creditAccount,
          status: b.status || ELIGIBILITY_TO_STATUS[ai?.eligibility ?? ""] || "",
          note: [ai?.note, j?.note].filter(Boolean).join(" · "),
          accepted: false,
        });
      }
      for (const b of bankPending) {
        const j = journalById.get(b.id);
        if (!j) continue;
        rows.push({
          rowId: b.id, kind: "bank",
          title: `${b.txDate.slice(5)} ${b.counterparty} ${fmtWon(b.withdrawal ?? b.deposit)}원`,
          fileNames: [], pendingLinks: [],
          label: j.label || b.category,
          debit: j.debit, credit: j.credit,
          status: "", note: j.note, accepted: false,
        });
      }
      return { rows, unmatched };
    }
  }

  async function apply() {
    if (!review) return;
    setApplying(true);
    try {
      for (const r of review) {
        if (!r.accepted) continue;
        for (const l of r.pendingLinks) {
          await linkEvidence(l.evidenceId, r.kind === "bank" ? { bankTxId: r.rowId } : { cardChargeId: r.rowId }, "ai", l.note);
        }
        if (r.kind === "card") {
          await updateCardCharge(r.rowId, {
            item_name: r.label, debit_account: r.debit, credit_account: r.credit,
            // Evidence matching does not change the existing TIPS workflow state.
          });
        } else {
          await updateBankTx(r.rowId, {
            category: r.label, debit_account: r.debit, credit_account: r.credit,
            // Evidence matching does not change the existing TIPS workflow state.
          });
        }
      }
      setReview(null);
      onApplied();
    } catch (err) {
      setError(String((err as Error).message ?? err));
    } finally {
      setApplying(false);
    }
  }

  const patch = (i: number, p: Partial<ReviewRow>) =>
    setReview((r) => r!.map((q, j) => (j === i ? { ...q, ...p } : q)));

  return (
    <>
      <Button size="sm" variant="secondary" leftIcon={busy ? <Spinner size="sm" /> : <FolderUp size={14} />}
        disabled={busy || disabled} onClick={() => folderRef.current?.click()}>
        {progress ? `업로드 중… ${progress.done}/${progress.total}` : busy ? "매칭 중…" : "증빙 업로드"}
      </Button>
      <Button size="sm" variant="ghost" leftIcon={<RefreshCcw size={13} />}
        disabled={busy || disabled} onClick={retryUnmatched}
        title="이미 업로드된 미연결 증빙에 자동매칭(파일명+AI)을 다시 실행">
        재매칭
      </Button>
      <input
        ref={folderRef}
        type="file"
        multiple
        hidden
        {...({ webkitdirectory: "" } as Record<string, string>)}
        onChange={(e) => onFolder(e.target.files)}
      />
      {error && <Badge tone="danger">{error}</Badge>}
      {job.error && job.message && <Badge tone="danger">증빙 업로드 실패: {job.message}</Badge>}

      {review && (
        <Modal
          open
          onClose={() => setReview(null)}
          size="xl"
          title="증빙 처리 확인"
          subtitle="한 번에 확정: 내용 + 분개(Transactions) + TIPS 예산처리 상태"
          footer={
            <>
              <Button variant="ghost" onClick={() => setReview(null)} disabled={applying}>나중에</Button>
              <Button variant="primary" loading={applying} onClick={apply}>
                선택 {review.filter((r) => r.accepted).length}건 적용
              </Button>
            </>
          }
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 10, maxHeight: "60vh", overflow: "auto" }}>
            {/* 전체 선택 — 건별 체크의 번거로움 해소 (부분 선택 상태도 한 번에 정리) */}
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", padding: "2px 10px", fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--text-strong)" }}>
              <input type="checkbox" checked={review.length > 0 && review.every((r) => r.accepted)}
                onChange={(e) => setReview(review.map((r) => ({ ...r, accepted: e.target.checked })))} />
              전체 선택
              <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>
                ({review.filter((r) => r.accepted).length}/{review.length}건)
              </span>
            </label>
            {review.map((r, i) => (
              <div key={r.rowId} style={{ border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-sm)", padding: "8px 10px", display: "flex", flexDirection: "column", gap: 6 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", flexWrap: "wrap" }}>
                  <input type="checkbox" checked={r.accepted} onChange={(e) => patch(i, { accepted: e.target.checked })} />
                  <Badge tone={r.kind === "card" ? "warning" : "info"} size="sm">{r.kind === "card" ? "카드" : "은행"}</Badge>
                  <span style={{ fontWeight: 600, fontSize: "var(--text-sm)", color: "var(--text-strong)" }}>{r.title}</span>
                  {r.fileNames.map((n) => (
                    <span key={n} style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: "var(--text-2xs)", color: "var(--text-muted)" }}>
                      <Paperclip size={10} />{n}
                    </span>
                  ))}
                </label>
                <div style={{ display: "grid", gridTemplateColumns: r.kind === "card" ? "1.4fr 1fr 1fr 150px" : "1.4fr 1fr 1fr", gap: 8, paddingLeft: 24 }}>
                  <Input size="sm" value={r.label} placeholder="내용"
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => patch(i, { label: e.target.value })} />
                  <Input size="sm" value={r.debit} placeholder="차변"
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => patch(i, { debit: e.target.value })} />
                  <Input size="sm" value={r.credit} placeholder="대변"
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => patch(i, { credit: e.target.value })} />
                  {r.kind === "card" && (
                    <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>기존 TIPS 처리 상태 유지</span>
                  )}
                </div>
                {r.note && <div style={{ fontSize: "var(--text-xs)", color: "var(--text-subtle)", paddingLeft: 24 }}>{r.note}</div>}
              </div>
            ))}
            {unmatchedNames.length > 0 && (
              <div style={{ fontSize: "var(--text-xs)", color: "var(--text-subtle)" }}>
                매칭 못 한 증빙 {unmatchedNames.length}건 · Transactions 하단 &ldquo;미연결 증빙&rdquo;에서 수동 연결하세요. {unmatchedNames.join(", ")}
              </div>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
