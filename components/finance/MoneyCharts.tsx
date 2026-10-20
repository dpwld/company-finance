"use client";

import { useState } from "react";
import { wonFmt } from "@/lib/finance/spend";

/* Finance 화면 공용 차트. 시안은 SVG를 직접 그린다 — 차트 라이브러리를 들이면
   번들만 커지고 모양은 오히려 안 맞아서 같은 방식으로 간다. */

const shortWon = (v: number) =>
  new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(v);

/** 선택한 달 vs 전월 누적 지출. 전월은 비교 기준선이라 회색 점선으로 깔린다. */
export function MoneyTrendChart({ current, previous, month }: { current: number[]; previous: number[]; month: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 700, H = 235, PAD = { t: 14, r: 52, b: 26, l: 4 };
  const max = Math.max(1, ...current, ...previous), min = Math.min(0, ...current, ...previous);
  const lastDay = current.length - 1;
  const previousAligned = current.map((_, index) => previous[Math.min(index, previous.length - 1)] ?? 0);
  const x = (i: number) => PAD.l + (i / Math.max(1, lastDay)) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - (v - min) / (max - min)) * (H - PAD.t - PAD.b);
  const path = (xs: number[]) => xs.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const label = new Date(month + "-01T00:00:00").toLocaleDateString("en-US", { month: "short" });

  return (
    <div style={{ position: "relative" }}>
      <svg className="money-chart" viewBox={`0 0 ${W} ${H}`} role="img"
        aria-label={`${label} cumulative spending compared with last month`}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          const rel = ((e.clientX - box.left) / box.width) * W;
          const i = Math.round(((rel - PAD.l) / (W - PAD.l - PAD.r)) * lastDay);
          setHover(i >= 0 && i <= lastDay ? i : null);
        }}
      >
        {[max, (max + min) / 2, min].map((t, i) => (
          <g key={i}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="#eeeeee" strokeWidth="1" />
            <text x={W - PAD.r + 8} y={y(t) + 4} fontSize="11" fill="#797979">{shortWon(t)}</text>
          </g>
        ))}
        <path d={path(previousAligned)} fill="none" stroke="#c7c7c7" strokeWidth="2" strokeDasharray="4 4" strokeLinejoin="round" />
        <path d={path(current)} fill="none" stroke="#0284c7" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {hover != null && (
          <>
            <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={H - PAD.b} stroke="#d9d9d9" strokeWidth="1" />
            <circle cx={x(hover)} cy={y(current[hover])} r="4.5" fill="#0284c7" stroke="#ffffff" strokeWidth="2" />
          </>
        )}
        {[0, 7, 14, 21, lastDay].map((i) => (
          <text key={i} x={x(i)} y={H - 7} fontSize="11" fill="#797979" textAnchor="middle">{i + 1}</text>
        ))}
      </svg>
      {hover != null && (
        <div style={{
          position: "absolute", top: 0, left: `${(x(hover) / W) * 100}%`, transform: "translateX(-50%)",
          pointerEvents: "none", background: "#ffffff", border: "1px solid #eeeeee", borderRadius: 10,
          padding: "8px 11px", fontSize: 12, whiteSpace: "nowrap", boxShadow: "0 6px 18px #20232914",
        }}>
          <b>{label} {hover + 1}</b>
          <div style={{ color: "#0284c7" }}>{label} {wonFmt(current[hover])}</div>
          <div style={{ color: "#797979" }}>Last month {wonFmt(previousAligned[hover])}</div>
        </div>
      )}
    </div>
  );
}

/** 카테고리 비중 도넛 — conic-gradient로 그리고 가운데에 총액을 둔다(시안과 동일). */
export function MoneyDonut({ slices, total }: { slices: { key: string; label: string; value: number; color: string }[]; total: number }) {
  const positive = slices.filter((slice) => slice.value > 0);
  const span = Math.max(positive.reduce((sum, slice) => sum + slice.value, 0), 1);
  const stops: string[] = [];
  for (let i = 0, at = 0; i < positive.length; i++) {
    const from = (at / span) * 360;
    at += positive[i].value;
    stops.push(`${positive[i].color} ${from.toFixed(2)}deg ${((at / span) * 360).toFixed(2)}deg`);
  }
  return (
    <div className="money-donut-layout">
      <div className="money-donut" role="img" aria-label={`Spending by category, total ${wonFmt(total)}`}
        style={{ background: stops.length ? `conic-gradient(${stops.join(",")})` : "#eeeeee" }}>
        <div className="money-donut-center">
          <span className="money-sub">Total spending</span>
          <strong>{wonFmt(total)}</strong>
        </div>
      </div>
    </div>
  );
}

/** 최근 N개월 막대 — 선택하면 헤더와 모든 화면의 조회 월을 함께 바꾼다. */
export function MoneyMonthBars({ data, month, onPick }: {
  data: { month: string; amount: number }[];
  /** 지금 들여다보는 달 — 이 막대만 진하게. */
  month: string;
  /** 워크스페이스의 공통 조회 월을 변경한다. */
  onPick: (month: string) => void;
}) {
  const max = Math.max(1, ...data.map((d) => d.amount));
  return (
    <div className="money-month-bars">
      {data.map((d) => (
        <button key={d.month} type="button" className={d.month === month ? "selected" : ""}
          title={`${d.month} ${wonFmt(d.amount)} — view spending for this month`}
          aria-pressed={d.month === month}
          onClick={() => onPick(d.month)}
          style={{ textAlign: "center" }}>
          <span className="money-sub" style={{ fontSize: 11 }}>{shortWon(d.amount)}</span>
          <div className="money-column" style={{ height: `${Math.max(4, (d.amount / max) * 110)}px` }} />
          <span className="money-sub" style={{ fontSize: 12 }}>{new Date(d.month + "-01T00:00:00").toLocaleDateString("en-US", { month: "short" })}</span>
        </button>
      ))}
    </div>
  );
}
