"use client";

import type { ReactNode } from "react";
import "./money.css";

/* Finance 셸 — 시안의 세로 사이드바 + 헤더.
   화면(뷰)은 children으로 받는다. 데이터·업로드 같은 동작은 전부
   FinanceWorkspace가 들고 있고, 여기는 보이는 것만 담당한다. */

export interface MoneyNavItem {
  id: string;
  label: string;
  /** 시안의 글리프(▦ ↻ ◴ …) — 아이콘 폰트 없이 글자로 찍는다. */
  glyph: string;
}

export const MONEY_NAV: MoneyNavItem[] = [
  { id: "home", label: "Dashboard", glyph: "▦" },
  { id: "recurring", label: "Recurring payments", glyph: "↻" },
  { id: "spend", label: "Spending", glyph: "◴" },
  { id: "budget", label: "Budget", glyph: "◉" },
  { id: "accounts", label: "Accounts & cards", glyph: "▤" },
  { id: "tx", label: "Transactions", glyph: "≡" },
];

interface Props {
  nav: string;
  onNav: (id: string) => void;
  title: string;
  subtitle: string;
  /** 월 선택·업로드 같은 헤더 오른쪽 버튼들. */
  actions: ReactNode;
  /** 사이드바 하단 계정 줄. */
  who: string;
  children: ReactNode;
}

export function MoneyShell({ nav, onNav, title, subtitle, actions, who, children }: Props) {
  return (
    <div className="money-root">
      <aside className="money-aside">
        <div className="money-brand">
          <b>₩</b>
          <div>Company Finance<small>BUSINESS BOOKKEEPING</small></div>
        </div>
        <nav className="money-nav" aria-label="Finance navigation">
          {MONEY_NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              className={nav === item.id ? "active" : ""}
              aria-current={nav === item.id ? "page" : undefined}
              onClick={() => onNav(item.id)}
            >
              <span aria-hidden="true">{item.glyph}</span>
              {item.label}
            </button>
          ))}
        </nav>
        <div className="money-profile">
          <span className="money-avatar">₩</span>{who}
          <div style={{ marginTop: 8 }}>Statement-based · KRW</div>
        </div>
      </aside>

      <div className="money-main">
        <header className="money-header">
          <div>
            <h1>{title}</h1>
            <div className="money-sub">{subtitle}</div>
          </div>
          <div className="money-actions">{actions}</div>
        </header>
        {children}
      </div>
    </div>
  );
}
