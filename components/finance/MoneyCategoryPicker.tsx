"use client";

import { useEffect, useMemo, useState } from "react";
import { createMoneyCategory, fetchMoneyCategories, fetchMoneyHistory, insertSpendRule, updateBankTx, updateCardCharge, type BankTx, type CardCharge } from "@/lib/data/finance";
import { exactMerchantKey, isMoneyUncategorized } from "@/lib/finance/money";
import { SPEND_CATEGORY_OPTIONS, spendCategoryLabel } from "@/lib/finance/spend";
import { Modal } from "@/components/ds/feedback/Modal";

export interface CategorySubject { kind: "card" | "bank"; id: string; name: string; category: string }
export function MoneyCategoryPicker({ subject, onClose, onSaved }: { subject: CategorySubject; onClose: () => void; onSaved: () => void }) {
  const [history, setHistory] = useState<{ cards: CardCharge[]; bank: BankTx[] } | null>(null);
  const [custom, setCustom] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [newName, setNewName] = useState("");
  const [choice, setChoice] = useState(isMoneyUncategorized(subject.category) ? "" : subject.category);
  const [scope, setScope] = useState<"single" | "uncategorized" | "rule">("single");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    Promise.all([fetchMoneyHistory(), fetchMoneyCategories()]).then(([rows, keys]) => {
      if (alive) { setHistory(rows); setCustom(keys); }
    }).catch(() => { if (alive) setError("분류 목록을 불러오지 못했습니다. 이 거래의 기본 분류는 변경할 수 있습니다."); });
    return () => { alive = false; };
  }, []);
  const matching = useMemo<CategorySubject[]>(() => [
    ...(history?.cards ?? []).filter((row) => isMoneyUncategorized(row.spendCategory)).map((row) => ({ kind: "card" as const, id: row.id, name: row.merchant || row.itemName || "카드 결제", category: row.spendCategory })),
    ...(history?.bank ?? []).filter((row) => isMoneyUncategorized(row.spendCategory)).map((row) => ({ kind: "bank" as const, id: row.id, name: row.counterparty || row.description || "계좌 거래", category: row.spendCategory })),
  ].filter((row) => exactMerchantKey(row.name) === exactMerchantKey(subject.name)), [history, subject.name]);
  const options = [...SPEND_CATEGORY_OPTIONS, ...custom.map((value) => ({ value, label: spendCategoryLabel(value) }))];

  async function save() {
    setBusy(true); setError("");
    try {
      if (scope === "rule") await insertSpendRule(subject.name, choice);
      const targets = scope === "uncategorized" ? [...matching.filter((row) => !(row.id === subject.id && row.kind === subject.kind)), subject] : [subject];
      for (const row of targets) {
        if (row.kind === "card") await updateCardCharge(row.id, { spend_category: choice || "uncategorized" });
        else await updateBankTx(row.id, { spend_category: choice || "uncategorized" });
      }
      onSaved(); onClose();
    } catch {
      setError("저장하지 못한 항목이 있습니다. 저장된 항목은 유지됩니다. 다시 시도해 주세요.");
      onSaved();
    } finally { setBusy(false); }
  }
  async function create() {
    setBusy(true); setError("");
    try {
      const key = await createMoneyCategory(newName);
      setCustom((keys) => [...new Set([...keys, key])]); setChoice(key); setNewName(""); setSearch("");
    } catch (err) { setError(err instanceof Error ? err.message : "카테고리를 만들지 못했습니다."); }
    finally { setBusy(false); }
  }

  return <Modal open onClose={() => { if (!busy) onClose(); }} title="카테고리 변경" subtitle={subject.name} size="md">
    <div className="money-category-picker">
      <input autoFocus aria-label="카테고리 검색" placeholder="카테고리 검색" value={search} onChange={(e) => setSearch(e.target.value)} />
      <div className="money-category-options">
        {options.filter((option) => option.label.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map((option) => <button type="button" key={option.value} disabled={busy} aria-pressed={choice === option.value} onClick={() => setChoice(option.value)}>{option.label}{choice === option.value ? " ✓" : ""}</button>)}
      </div>
      <form onSubmit={(event) => { event.preventDefault(); void create(); }} style={{ display: "flex", gap: 8 }}>
        <input aria-label="새 카테고리 이름" placeholder="새 카테고리 이름" maxLength={40} value={newName} onChange={(e) => setNewName(e.target.value)} />
        <button type="submit" disabled={busy || !newName.trim()}>카테고리 만들기</button>
      </form>
      <fieldset disabled={busy} style={{ display: "grid", gap: 10, border: 0, padding: 0 }}><legend>적용 범위</legend>
        <label><input type="radio" name="category-scope" checked={scope === "single"} onChange={() => setScope("single")} /> 이 거래만</label>
        <label><input type="radio" name="category-scope" checked={scope === "uncategorized"} disabled={!history} onChange={() => setScope("uncategorized")} /> 같은 거래명의 미분류 {matching.length}건도 함께 · 전체 기간</label>
        <label><input type="radio" name="category-scope" checked={scope === "rule"} disabled={!choice} onChange={() => setScope("rule")} /> 같은 거래명에 자동 분류 규칙 적용</label>
      </fieldset>
      <p className="money-note">이름 앞뒤 공백·대소문자를 제외한 정확한 거래명만 일치합니다. 직접 저장한 분류는 유지합니다.</p>
      {error && <p role="alert" className="money-negative">{error}</p>}
      <button type="button" className="money-primary" disabled={busy || (scope === "rule" && !choice)} onClick={() => void save()}>{busy ? "저장 중…" : `${spendCategoryLabel(choice)} 적용`}</button>
    </div>
  </Modal>;
}
