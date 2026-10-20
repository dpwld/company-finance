"use client";

import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ds/core/Button";
import { Modal } from "@/components/ds/feedback/Modal";
import { Input } from "@/components/ds/forms/Input";
import { Select } from "@/components/ds/forms/Select";
import { SPEND_CATEGORY_OPTIONS, spendCategoryLabel } from "@/lib/finance/spend";
import { fetchMoneyCategories, type SpendRule } from "@/lib/data/finance";

/* 분류 규칙 관리 (Rocket Money 벤치마크): "가맹점 이름 → 사무실·임차료"처럼
   패턴이 상대처·가맹점·적요에 포함되면 항상 그 카테고리로 분류.
   추가 시 이번 달 매칭 거래에 즉시 적용되고, 이후 AI 분류에서도 규칙이 우선. */

export function SpendRulesModal({ open, rules, onClose, onAdd, onDelete, onError }: {
  open: boolean;
  rules: SpendRule[];
  onClose: () => void;
  /** 저장 + 즉시 적용 — 적용된 건수를 돌려준다. */
  onAdd: (pattern: string, category: string) => Promise<number>;
  onDelete: (id: string) => Promise<void>;
  onError: (msg: string) => void;
}) {
  const [custom, setCustom] = useState<string[]>([]);
  useEffect(() => { if (open) fetchMoneyCategories().then(setCustom).catch(() => {}); }, [open]);
  const options = [...SPEND_CATEGORY_OPTIONS, ...custom.map((value) => ({ value, label: spendCategoryLabel(value) }))];
  const [pattern, setPattern] = useState("");
  const [category, setCategory] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit() {
    const p = pattern.trim();
    if (!p || !category) return;
    setBusy(true);
    setNotice(null);
    try {
      const applied = await onAdd(p, category);
      setPattern("");
      setNotice(`규칙 저장 완료: 이번 달 ${applied}건에 바로 적용했습니다.`);
    } catch (err) {
      console.error("rule add failed:", err);
      onError("규칙을 저장하지 못했습니다. 연결과 Finance 권한을 확인해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="분류 규칙" subtitle="새 규칙은 정확한 거래명의 미분류 내역에 적용됩니다. 직접 저장한 분류는 유지합니다." size="md">
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Input
            size="sm"
            value={pattern}
            placeholder="예: 가맹점 이름"
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPattern(e.target.value)}
            onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) void submit(); }}
            style={{ flex: 1 }}
          />
          <span style={{ color: "var(--text-subtle)" }}>→</span>
          <Select
            size="sm"
            value={category}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setCategory(e.target.value)}
            options={[{ value: "", label: "카테고리 선택…" }, ...options.filter((o) => o.value)]}
            aria-label="규칙 카테고리"
            style={{ width: 180 }}
          />
          <Button size="sm" variant="primary" loading={busy} disabled={!pattern.trim() || !category} onClick={() => void submit()}>
            추가
          </Button>
        </div>
        {notice && <span style={{ fontSize: "var(--text-xs)", color: "var(--green-600, #7f7f7f)" }}>{notice}</span>}

        {rules.length === 0 ? (
          <span style={{ fontSize: "var(--text-sm)", color: "var(--text-subtle)", padding: "8px 0" }}>
            아직 규칙이 없습니다. 예: “가맹점 이름”을 사무실·임차료로 추가하면, 가맹점 이름 출금은 매달 자동으로 임차료로 분류됩니다.
          </span>
        ) : (
          <div style={{ border: "1px solid var(--border-subtle)", borderRadius: 10, overflow: "hidden" }}>
            {rules.map((r) => (
              <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderBottom: "1px solid var(--border-subtle)" }}>
                <span style={{ flex: 1, fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--text-strong)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  “{r.pattern}” · {r.matchMode === "exact" ? "정확한 거래명" : "부분 일치"}
                </span>
                <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>→ {spendCategoryLabel(r.category)}</span>
                <Button size="sm" variant="ghost" iconOnly aria-label="Delete rule"
                  onClick={async () => {
                    try { await onDelete(r.id); } catch { onError("규칙 삭제에 실패했습니다."); }
                  }}>
                  <Trash2 size={13} />
                </Button>
              </div>
            ))}
          </div>
        )}

        <span style={{ fontSize: "var(--text-2xs)", color: "var(--text-subtle)" }}>
          새 규칙은 전체 기간의 미분류 내역에 바로 적용됩니다. 해제하면 규칙으로 표시한 분류가 해제되며, 직접 저장한 분류는 유지됩니다. 기존 부분 일치 규칙은 기존 AI 분류 동작을 유지합니다.
        </span>
      </div>
    </Modal>
  );
}
