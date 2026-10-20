"use client";

import { useMemo, useState } from "react";
import { Camera, RotateCw, Search } from "lucide-react";
import { getPostPurchaseEvidence } from "@/lib/lumos/catalog";
import type { LumosRequest } from "@/lib/lumos/types";
import "./lumos-pages.css";
import "./lumos-follow-up.css";

const STATUS_LABELS = { pending: "미제출", partial: "일부 첨부", attached: "첨부 완료" };
type Filter = "outstanding" | "pending" | "partial" | "attached";

export function LumosFollowUp({ requests, onOpen, onRefresh, loading = false }: {
  requests: LumosRequest[];
  onOpen: (request: LumosRequest) => void;
  onRefresh: () => void;
  loading?: boolean;
}) {
  const [filter, setFilter] = useState<Filter>("outstanding");
  const [query, setQuery] = useState("");
  const rows = useMemo(() => requests.flatMap(request => getPostPurchaseEvidence(request).map(evidence => ({ request, ...evidence })))
    .sort((a, b) => b.request.requestedAt.localeCompare(a.request.requestedAt) || a.request.id.localeCompare(b.request.id)), [requests]);
  const counts = {
    outstanding: rows.filter(row => row.status !== "attached").length,
    pending: rows.filter(row => row.status === "pending").length,
    partial: rows.filter(row => row.status === "partial").length,
    attached: rows.filter(row => row.status === "attached").length,
  };
  const search = query.trim().toLocaleLowerCase("ko-KR");
  const visible = rows.filter(row => (filter === "outstanding" ? row.status !== "attached" : row.status === filter)
    && (!search || [row.request.title, row.request.category, row.request.author, row.request.assignee].join(" ").toLocaleLowerCase("ko-KR").includes(search)));

  return <section className="lm-page lm-follow-up" aria-labelledby="lm-follow-up-heading" aria-busy={loading}>
    <header className="lm-follow-up-header"><div><h1 id="lm-follow-up-heading" className="lm-page-title">사후 증빙</h1><p>구매 후 제품·활용 사진을 첨부하세요. 검수·이체가 끝난 건도 사진이 갖춰질 때까지 이곳에 남습니다.</p></div>
      <button className="lm-outline-button" type="button" onClick={onRefresh} disabled={loading}><RotateCw size={14} />새로고침</button></header>
    <div className="lm-follow-up-counts" aria-label="사진 제출 현황">{([
      ["outstanding", "제출 필요"], ["pending", "미제출"], ["partial", "일부 첨부"], ["attached", "첨부 완료"],
    ] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}><span>{label}</span><strong>{loading ? "—" : counts[value]}<small>건</small></strong></button>)}</div>
    <div className="lm-history-toolbar"><p className="lm-follow-up-note">사진 파일 2개 이상 · 첨부 완료는 파일 수 기준이며, 사진 내용과 RCMS 반영 여부는 별도 확인이 필요합니다.</p>
      <label className="lm-history-search"><Search size={15} /><input type="search" aria-label="사후 증빙 검색" placeholder="품목명, 담당자 검색" value={query} onChange={event => setQuery(event.target.value)} /></label></div>
    <div className="lm-history-table-scroll"><table className="lm-history-table lm-follow-up-table"><thead><tr><th>사진 제출</th><th>구매 내역</th><th>담당자 / 작성자</th><th>업무 상태</th><th>사진 파일</th><th>요청일</th><th>관리</th></tr></thead><tbody>
      {visible.map(({ request, requirement, attachedCount, minimumCount, status }) => <tr key={`${request.id}:${requirement.key}`}>
        <td><span className={`lm-follow-up-status lm-follow-up-${status}`}>{STATUS_LABELS[status]}</span></td>
        <td><button className="lm-history-open" type="button" onClick={() => onOpen(request)}>{request.title}</button><small>{request.category} · {request.cashAmount.toLocaleString("ko-KR")}원</small></td>
        <td>{request.assignee || request.author || "미지정"}</td><td>{request.status || "미기재"}</td>
        <td><span className="lm-follow-up-progress">{attachedCount} / {minimumCount}</span>{status !== "attached" && <small>{minimumCount - attachedCount}개 더 필요</small>}</td>
        <td>{request.requestedAt.slice(0, 10).replaceAll("-", ".") || "—"}</td>
        <td><button className="lm-outline-button" type="button" aria-label={`${request.title} 사진 ${status === "attached" ? "확인" : "첨부"}`} onClick={() => onOpen(request)}><Camera size={14} />{status === "attached" ? "사진 확인" : "사진 첨부"}</button></td>
      </tr>)}
      {!visible.length && <tr><td colSpan={7} className="lm-history-empty"><Camera size={28} /><strong>{loading ? "사후 증빙을 불러오는 중입니다." : search ? "검색 조건에 맞는 내역이 없습니다." : filter === "attached" ? "아직 첨부 완료된 내역이 없습니다." : "해당 상태의 미제출 사진이 없습니다."}</strong></td></tr>}
    </tbody></table></div>
    <p className="lm-history-count">{visible.length}건 표시 · 전체 사후 증빙 {rows.length}건</p>
  </section>;
}
