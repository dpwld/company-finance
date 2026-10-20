"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";

/** Transient "Saved ✓" confirmation for blur-saved fields. Bump `tick` after
   each successful save; the chip shows for ~1.6s then fades out. */
export function SavedFlash({ tick }: { tick: number }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (tick === 0) return;
    const show = setTimeout(() => setVisible(true), 0);
    const hide = setTimeout(() => setVisible(false), 1600);
    return () => { clearTimeout(show); clearTimeout(hide); };
  }, [tick]);
  if (!visible) return null;
  return (
    <span
      className="sx-anim-pop"
      style={{
        display: "inline-flex", alignItems: "center", gap: 4,
        fontSize: "var(--text-xs)", color: "var(--green-600, #6b6b6b)", fontWeight: 500,
      }}
    >
      <Check size={13} /> Saved
    </span>
  );
}
