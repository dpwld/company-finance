"use client";

import { monthLabel } from "./shared";

export function MoneyMonthPicker({ month, months, onChange }: { month: string; months: string[]; onChange: (month: string) => void }) {
  const options = [...new Set([month, ...months])].sort().reverse();
  const index = options.indexOf(month);
  return <div className="money-month">
    <button type="button" aria-label="Previous month" disabled={index === options.length - 1} onClick={() => onChange(options[index + 1])}>‹</button>
    <select aria-label="Month" value={month} onChange={(event) => onChange(event.target.value)} style={{ fontWeight: 600, minWidth: 104, padding: 6, border: 0, background: "transparent" }}>
      {options.map((value) => <option key={value} value={value}>{monthLabel(value)}</option>)}
    </select>
    <button type="button" aria-label="Next month" disabled={index === 0} onClick={() => onChange(options[index - 1])}>›</button>
  </div>;
}
