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
    }).catch(() => { if (alive) setError("Could not load the category list. You can still change this transaction's category."); });
    return () => { alive = false; };
  }, []);
  const matching = useMemo<CategorySubject[]>(() => [
    ...(history?.cards ?? []).filter((row) => isMoneyUncategorized(row.spendCategory)).map((row) => ({ kind: "card" as const, id: row.id, name: row.merchant || row.itemName || "Card payment", category: row.spendCategory })),
    ...(history?.bank ?? []).filter((row) => isMoneyUncategorized(row.spendCategory)).map((row) => ({ kind: "bank" as const, id: row.id, name: row.counterparty || row.description || "Bank transaction", category: row.spendCategory })),
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
      setError("Some items could not be saved. Saved items are preserved. Please try again.");
      onSaved();
    } finally { setBusy(false); }
  }
  async function create() {
    setBusy(true); setError("");
    try {
      const key = await createMoneyCategory(newName);
      setCustom((keys) => [...new Set([...keys, key])]); setChoice(key); setNewName(""); setSearch("");
    } catch (err) { setError(err instanceof Error ? err.message : "Could not create the category."); }
    finally { setBusy(false); }
  }

  return <Modal open onClose={() => { if (!busy) onClose(); }} title="Change category" subtitle={subject.name} size="md">
    <div className="money-category-picker">
      <input autoFocus aria-label="Search categories" placeholder="Search categories" value={search} onChange={(e) => setSearch(e.target.value)} />
      <div className="money-category-options">
        {options.filter((option) => option.label.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map((option) => <button type="button" key={option.value} disabled={busy} aria-pressed={choice === option.value} onClick={() => setChoice(option.value)}>{option.label}{choice === option.value ? " ✓" : ""}</button>)}
      </div>
      <form onSubmit={(event) => { event.preventDefault(); void create(); }} style={{ display: "flex", gap: 8 }}>
        <input aria-label="New category name" placeholder="New category name" maxLength={40} value={newName} onChange={(e) => setNewName(e.target.value)} />
        <button type="submit" disabled={busy || !newName.trim()}>Create category</button>
      </form>
      <fieldset disabled={busy} style={{ display: "grid", gap: 10, border: 0, padding: 0 }}><legend>Apply to</legend>
        <label><input type="radio" name="category-scope" checked={scope === "single"} onChange={() => setScope("single")} /> This transaction only</label>
        <label><input type="radio" name="category-scope" checked={scope === "uncategorized"} disabled={!history} onChange={() => setScope("uncategorized")} /> Matching uncategorized transactions: {matching.length} records · All time</label>
        <label><input type="radio" name="category-scope" checked={scope === "rule"} disabled={!choice} onChange={() => setScope("rule")} /> Create an automatic rule for the same transaction name</label>
      </fieldset>
      <p className="money-note">Matches the exact name, ignoring case and surrounding spaces. Existing manual categories are preserved.</p>
      {error && <p role="alert" className="money-negative">{error}</p>}
      <button type="button" className="money-primary" disabled={busy || (scope === "rule" && !choice)} onClick={() => void save()}>{busy ? "Saving…" : `${spendCategoryLabel(choice)} apply`}</button>
    </div>
  </Modal>;
}
