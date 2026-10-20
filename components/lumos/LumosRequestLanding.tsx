"use client";

import { ChevronRight, ClipboardPenLine, FilePenLine, MessageCircle, Plus, ReceiptText, WalletCards } from "lucide-react";
import "./lumos-pages.css";

export function LumosRequestLanding({ onCreate, onImport }: {
  onCreate: (type: "fund-request" | "agreement-change" | "general") => void;
  onImport: () => void;
}) {
  return (
    <section className="lm-page lm-request-page" aria-labelledby="lm-request-heading">
      <h1 id="lm-request-heading" className="lm-page-title">요청</h1>
      <div className="lm-request-options">
        <section className="lm-request-block" aria-labelledby="lm-fund-heading">
          <div className="lm-request-block-heading">
            <span className="lm-request-icon"><WalletCards size={28} strokeWidth={1.7} /></span>
            <div>
              <h2 id="lm-fund-heading">사업비 사용</h2>
              <p>사업비 사용에 필요한 서류를 준비하고 검수를 요청하세요.</p>
            </div>
          </div>
          <div className="lm-request-cards">
            <button type="button" className="lm-request-card" onClick={onImport}>
              <span className="lm-request-card-icon"><ReceiptText size={26} strokeWidth={1.7} /></span>
              <span className="lm-request-card-title">거래 내역 불러오기 <ChevronRight size={18} /></span>
              <span className="lm-request-card-description">카드·계좌 거래 내역을 불러와<br />간편하게 요청서를 작성해요.</span>
            </button>
            <button type="button" className="lm-request-card" onClick={() => onCreate("fund-request")}>
              <span className="lm-request-card-icon lm-request-card-icon-dashed"><Plus size={24} strokeWidth={1.7} /></span>
              <span className="lm-request-card-title">직접 입력하기 <ChevronRight size={18} /></span>
              <span className="lm-request-card-description">거래 내역이 없어도<br />직접 내용을 입력할 수 있어요.</span>
            </button>
          </div>
        </section>

        <section className="lm-request-block lm-agreement-block" aria-labelledby="lm-agreement-heading">
          <div className="lm-request-block-heading">
            <span className="lm-request-icon"><ClipboardPenLine size={28} strokeWidth={1.7} /></span>
            <div>
              <h2 id="lm-agreement-heading">협약 변경</h2>
              <p>과제 수행 중 변경이 필요한 내용을 요청하세요.</p>
            </div>
          </div>
          <button type="button" className="lm-outline-button" onClick={() => onCreate("agreement-change")}>
            <FilePenLine size={16} /> 요청하기 <ChevronRight size={16} />
          </button>
        </section>
        <div className="lm-request-footer">
          <span>그 외에 도움이 필요하신가요?</span>
          <button type="button" onClick={() => onCreate("general")}><MessageCircle size={15} /> 문의하기 <ChevronRight size={14} /></button>
        </div>
      </div>
    </section>
  );
}
