"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/* Drag-resizable column widths with per-user persistence: the widths live in
   localStorage under "sx-colw:{storageKey}", so every table remembers the
   last size YOU gave each column (per browser). Used by DataTable, the
   timesheet grid and the CRM spec sheet. */

const MIN_W = 60;
const MAX_W = 640;

type Widths = Record<string, number>;

function load(storageKey: string): Widths {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(`sx-colw:${storageKey}`) ?? "{}") as Widths;
  } catch {
    return {};
  }
}

export function useColWidths(storageKey: string | undefined) {
  const [widths, setWidths] = useState<Widths>({});
  const widthsRef = useRef<Widths>({});

  // localStorage is browser-only — hydrate after mount to avoid SSR mismatch.
  useEffect(() => {
    if (!storageKey) return;
    const saved = load(storageKey);
    widthsRef.current = saved;
    setWidths(saved);
  }, [storageKey]);

  /** mousedown handler for a column's drag handle. Pass the current rendered
     width so the drag starts from what the user sees. */
  const startResize = useCallback(
    (colKey: string, startWidth: number) => (e: React.MouseEvent) => {
      if (!storageKey) return;
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const move = (ev: MouseEvent) => {
        const next = Math.min(MAX_W, Math.max(MIN_W, startWidth + (ev.clientX - startX)));
        widthsRef.current = { ...widthsRef.current, [colKey]: next };
        setWidths(widthsRef.current);
      };
      const up = () => {
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
        try {
          window.localStorage.setItem(`sx-colw:${storageKey}`, JSON.stringify(widthsRef.current));
        } catch { /* storage full/blocked — resize still works for the session */ }
      };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
      document.body.style.userSelect = "none";
      document.body.style.cursor = "col-resize";
    },
    [storageKey],
  );

  return { widths, startResize };
}

/** Shared style for the invisible drag handle at a th's right edge. */
export const resizeHandleStyle: React.CSSProperties = {
  position: "absolute",
  top: 0,
  right: -3,
  width: 7,
  height: "100%",
  cursor: "col-resize",
  userSelect: "none",
  zIndex: 2,
};
