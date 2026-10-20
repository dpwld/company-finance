"use client";

import { useRef, useState } from "react";
import { FileUp } from "lucide-react";
import { Button } from "@/components/ds/core/Button";
import { Spinner } from "@/components/ds/core/Spinner";
import { updateBankTx, type BankTx } from "@/lib/data/finance";
import { findSubset, parseRcmsTransfers, rcmsNote, type RcmsTransfer } from "@/lib/finance/rcmsParse";

/* TIPS 이체결과 업로드 — RCMS "연구비 이체결과내역"(.xlsx)을 올려 통장 거래에
   "이게 TIPS 연구비였고, 무슨 목적이었는지"를 적어 넣는다.

   통장에는 "사업체 입금"으로만 찍혀 목적을 알 수 없다. RCMS 파일에는 비목과
   지급용도가 들어 있어, 이체일·금액이 같은 거래를 찾아 기타란에 채운다.
   회사 계좌를 거치지 않고 직원·거래처에 바로 나간 건은 통장에 없으므로 따로 알린다. */

export interface RcmsNotice {
  tone: "success" | "warning" | "danger";
  title: string;
  lines: string[];
}

interface Props {
  bank: BankTx[];
  disabled?: boolean;
  onApplied: () => void;
  /** 결과 알림은 헤더 밖(페이지 본문)에서 그린다 — 헤더에 두면 제목·설명이 밀린다. */
  onNotice: (n: RcmsNotice | null) => void;
}

interface Outcome {
  matched: number;
  offBook: RcmsTransfer[];
  unmatched: RcmsTransfer[];
  projectNo: string;
  warnings: string[];
}

/** RCMS 이체일과 통장 거래일이 하루 이틀 어긋나는 경우가 있어 ±2일까지 본다. */
const DAY_SLACK = 2;
const daysApart = (a: string, b: string) =>
  Math.abs(new Date(`${a}T00:00:00`).getTime() - new Date(`${b}T00:00:00`).getTime()) / 86400000;

function buildNotice(o: Outcome): RcmsNotice {
  const lines = [`과제번호 ${o.projectNo || "N/A"}`];
  if (o.offBook.length) {
    lines.push(
      `직원·거래처로 바로 지급된 ${o.offBook.length}건은 통장에 찍히지 않아 대조 대상이 아닙니다` +
        ` (${o.offBook.slice(0, 3).map((t) => t.purpose).join(", ")}${o.offBook.length > 3 ? " 외" : ""}).`,
    );
  }
  if (o.unmatched.length) {
    lines.push(
      `통장에서 못 찾은 ${o.unmatched.length}건 · ` +
        o.unmatched.slice(0, 3).map((t) => `${t.transferDate} ${t.amount.toLocaleString()}원`).join(", ") +
        `. 해당 월 거래내역을 먼저 올렸는지 확인하세요.`,
    );
  }
  return {
    tone: o.matched ? "success" : "warning",
    title: `TIPS 이체결과: 통장 거래 ${o.matched}건에 사용 목적을 기록했습니다`,
    lines,
  };
}

export function RcmsUploader({ bank, disabled, onApplied, onNotice }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    onNotice(null);
    try {
      const parsed = parseRcmsTransfers(await file.arrayBuffer());
      if (!parsed.rows.length) {
        onNotice({ tone: "danger", title: "TIPS 이체결과 업로드 실패", lines: [parsed.warnings[0] ?? "이체 내역을 찾지 못했습니다."] });
        return;
      }
      // 입금(회사 계좌로 들어온 연구비)만 통장에 남는다.
      const used = new Set<string>();
      let matched = 0;
      const offBook: RcmsTransfer[] = [];
      const leftover: RcmsTransfer[] = [];

      // ① 1:1 — 금액이 정확히 같고 날짜가 가까운 입금
      for (const t of parsed.rows) {
        const hit = bank
          .filter((b) => !used.has(b.id) && (b.deposit ?? 0) === t.amount && daysApart(b.txDate, t.transferDate) <= DAY_SLACK)
          .sort((a, b) => daysApart(a.txDate, t.transferDate) - daysApart(b.txDate, t.transferDate))[0];
        if (hit) {
          used.add(hit.id);
          await updateBankTx(hit.id, { tips_note: rcmsNote(t), status: "해당없음(RCMS입금)" });
          matched++;
        } else {
          leftover.push(t);
        }
      }

      // ② 합산 — 카드대금 지원처럼 여러 건이 통장에 한 번에 들어오는 경우.
      //    남은 입금마다 날짜가 가까운 잔여 건들 중 합계가 정확히 맞는 조합을 찾는다.
      const stillLeft = new Set(leftover);
      for (const b of bank) {
        if (used.has(b.id) || !(b.deposit ?? 0)) continue;
        const near = [...stillLeft].filter((t) => daysApart(b.txDate, t.transferDate) <= DAY_SLACK);
        if (near.length < 2) continue;
        const combo = findSubset(b.deposit ?? 0, near);
        if (!combo || combo.length < 2) continue;
        used.add(b.id);
        for (const t of combo) stillLeft.delete(t);
        await updateBankTx(b.id, { tips_note: rcmsNote(combo), status: "해당없음(RCMS입금)" });
        matched++;
      }

      const unmatched: RcmsTransfer[] = [];
      for (const t of stillLeft) {
        // 회사 주거래계좌가 아닌 곳(직원·거래처)으로 바로 나간 건 — 통장에 안 찍힌다
        if (!/사용자 계좌/.test(t.account)) offBook.push(t);
        else unmatched.push(t);
      }
      onNotice(buildNotice({ matched, offBook, unmatched, projectNo: parsed.projectNo, warnings: parsed.warnings }));
      if (matched) onApplied();
    } catch (err) {
      console.error("rcms upload failed:", err);
      onNotice({ tone: "danger", title: "TIPS 이체결과 업로드 실패", lines: [String((err as Error).message ?? err)] });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        leftIcon={busy ? <Spinner size="sm" /> : <FileUp size={14} />}
        disabled={busy || disabled}
        onClick={() => fileRef.current?.click()}
        title="RCMS 연구비 이체결과내역(.xlsx)을 올려 통장 거래에 TIPS 사용 목적을 기록합니다"
      >
        {busy ? "대조 중…" : "TIPS 이체결과 업로드"}
      </Button>
      <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: "none" }}
        onChange={(e) => void onFile(e.target.files?.[0])} />

    </>
  );
}
