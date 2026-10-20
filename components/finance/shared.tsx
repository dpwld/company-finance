import type React from "react";

/* Shared bits for the Finance tabs — table styles + formatting helpers,
   matching the TimesheetAdmin inline-edit look. */

export const th: React.CSSProperties = {
  textAlign: "left",
  fontSize: "var(--text-2xs)",
  fontWeight: 600,
  letterSpacing: ".05em",
  textTransform: "uppercase",
  color: "var(--text-subtle)",
  padding: "8px 8px",
  borderBottom: "1px solid var(--border-strong)",
  whiteSpace: "nowrap",
};

export const td: React.CSSProperties = {
  padding: "4px 8px",
  borderBottom: "1px solid var(--border-subtle)",
  fontSize: "var(--text-xs)",
  verticalAlign: "middle",
};

export const tdNum: React.CSSProperties = {
  ...td,
  textAlign: "right",
  fontFamily: "var(--font-mono)",
  whiteSpace: "nowrap",
};

export const cellInput: React.CSSProperties = {
  width: "100%",
  border: "1px solid transparent",
  borderRadius: "var(--radius-sm)",
  background: "transparent",
  font: "inherit",
  fontSize: "var(--text-xs)",
  color: "var(--text-default)",
  padding: "3px 6px",
  outline: "none",
};

/** Right-aligned mono variant of cellInput, for editable amount cells. */
export const cellInputNum: React.CSSProperties = {
  ...cellInput,
  textAlign: "right",
  fontFamily: "var(--font-mono)",
};

export function fmtWon(n: number | null | undefined): string {
  if (n == null) return "";
  return n.toLocaleString("ko-KR");
}

/** Parse an edited amount cell ("1,234", "₩1234", "-500", "" → null).
   Returns undefined when the text isn't a number, so callers can reject the
   edit instead of writing garbage into the ledger. */
export function parseWon(text: string): number | null | undefined {
  const s = text.replace(/[,₩\s원]/g, "").trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

export function monthLabel(month: string): string {
  return new Date(month + "-01T00:00:00").toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

export function shiftMonth(month: string, delta: number): string {
  const d = new Date(month + "-01T00:00:00");
  d.setMonth(d.getMonth() + delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Save a text blob as a download (CSV etc.). */
export function downloadBlob(filename: string, mime: string, content: BlobPart): void {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** CSV with BOM so Excel opens Korean text correctly. */
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  const esc = (v: string | number | null | undefined) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + rows.map((r) => r.map(esc).join(",")).join("\n");
}
