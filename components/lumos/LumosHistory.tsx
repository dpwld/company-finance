"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Search, X } from "lucide-react";
import { PROJECT } from "@/lib/lumos/catalog";
import type { LumosRequest } from "@/lib/lumos/types";
import "./lumos-pages.css";

const SOURCE_LABELS: Record<LumosRequest["source"], string> = { pulse: "Pulse", lumos: "Lumos", finance: "Finance" };
const STATUS_ORDER = ["작성중", "보완필요", "검수중", "승인대기", "이체필요", "이체완료", "완료", "복원완료", "집행불가", "진행취소"];
const STATUS_COLORS: Record<string, string> = {
  작성중: "gray", 보완필요: "red", 검수중: "purple", 승인대기: "gold", 이체필요: "gold",
  이체완료: "blue", 완료: "green", 복원완료: "green", 집행불가: "red", 진행취소: "gray",
};
type SortKey = "status" | "updatedAt" | "cashAmount" | "inKindAmount";
const money = (amount: number) => amount < 0 ? `(${Math.abs(amount).toLocaleString("ko-KR")})` : amount.toLocaleString("ko-KR");
const projectLabel = (projectId: string) => projectId === PROJECT.id || projectId === "tips" ? PROJECT.name : projectId || "과제 미지정";
const normalizedProject = (projectId: string) => projectId === "tips" ? PROJECT.id : projectId;
const dateLabel = (date: string) => date ? date.slice(0, 10).replaceAll("-", ".") : "—";

export function LumosHistory({ requests, onOpen, loading = false }: {
  requests: LumosRequest[];
  onOpen: (request: LumosRequest) => void;
  loading?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [project, setProject] = useState("");
  const [receipt, setReceipt] = useState("");
  const [source, setSource] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; direction: "asc" | "desc" }>({ key: "updatedAt", direction: "desc" });
  const statuses = [...new Set(requests.map(request => request.status).filter(Boolean))].sort((a, b) => {
    const left = STATUS_ORDER.indexOf(a), right = STATUS_ORDER.indexOf(b);
    return (left < 0 ? STATUS_ORDER.length : left) - (right < 0 ? STATUS_ORDER.length : right) || a.localeCompare(b, "ko");
  });
  const projects = [...new Set(requests.map(request => normalizedProject(request.projectId)))];
  const receipts = [...new Set(requests.map(request => request.receiptType).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ko"));
  const filtered = useMemo(() => {
    const search = query.trim().toLocaleLowerCase("ko-KR");
    return requests.filter(request => (!status || request.status === status)
      && (!project || normalizedProject(request.projectId) === project)
      && (!receipt || request.receiptType === receipt)
      && (!source || request.source === source)
      && (!search || [request.title, request.item, request.group, request.category, request.author, request.assignee, request.sourceId, request.projectId].join(" ").toLocaleLowerCase("ko-KR").includes(search)))
      .sort((a, b) => {
        let result: number;
        if (sort.key === "status") {
          const left = STATUS_ORDER.indexOf(a.status), right = STATUS_ORDER.indexOf(b.status);
          result = (left < 0 ? STATUS_ORDER.length : left) - (right < 0 ? STATUS_ORDER.length : right) || a.status.localeCompare(b.status, "ko");
        } else if (sort.key === "updatedAt") {
          result = (a.updatedAt || a.requestedAt).localeCompare(b.updatedAt || b.requestedAt);
        } else result = a[sort.key] - b[sort.key];
        return (sort.direction === "asc" ? result : -result) || a.id.localeCompare(b.id);
      });
  }, [requests, query, status, project, receipt, source, sort]);
  const toggleSort = (key: SortKey) => setSort(current => ({ key, direction: current.key === key && current.direction === "desc" ? "asc" : "desc" }));
  const sortIcon = (key: SortKey) => sort.key !== key ? <ArrowUpDown size={12} /> : sort.direction === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />;
  const sortAttribute = (key: SortKey) => sort.key === key ? sort.direction === "asc" ? "ascending" as const : "descending" as const : "none" as const;
  const hasFilters = Boolean(query || status || project || receipt || source);
  const reset = () => { setQuery(""); setStatus(""); setProject(""); setReceipt(""); setSource(""); };

  return (
    <section className="lm-page lm-history-page" aria-labelledby="lm-history-heading">
      <h1 id="lm-history-heading" className="lm-page-title">내역</h1>
      <div className="lm-history-toolbar">
        <div className="lm-history-filters">
          <select aria-label="상태 필터" className="lm-filter lm-status-filter" value={status} onChange={event => setStatus(event.target.value)}><option value="">상태</option>{statuses.map(value => <option key={value} value={value}>{value}</option>)}</select>
          <select aria-label="과제 필터" className="lm-filter lm-project-filter" value={project} onChange={event => setProject(event.target.value)}><option value="">세부지원사업명</option>{projects.map(value => <option key={value} value={value}>{projectLabel(value)}</option>)}</select>
          <select aria-label="증빙 필터" className="lm-filter lm-receipt-filter" value={receipt} onChange={event => setReceipt(event.target.value)}><option value="">증빙</option>{receipts.map(value => <option key={value} value={value}>{value}</option>)}</select>
          <select aria-label="출처 필터" className="lm-filter lm-source-filter" value={source} onChange={event => setSource(event.target.value)}><option value="">전체 출처</option>{Object.entries(SOURCE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          {hasFilters && <button type="button" className="lm-filter-reset" onClick={reset}>초기화</button>}
        </div>
        <label className="lm-history-search"><Search size={15} /><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="검색" aria-label="내역 검색" />{query && <button type="button" aria-label="검색어 지우기" onClick={() => setQuery("")}><X size={14} /></button>}</label>
      </div>
      <div className="lm-history-table-scroll" aria-busy={loading}>
        <table className="lm-history-table">
          <colgroup><col className="lm-col-author" /><col className="lm-col-status" /><col className="lm-col-date" /><col className="lm-col-project" /><col className="lm-col-item" /><col className="lm-col-category" /><col className="lm-col-receipt" /><col className="lm-col-money" /><col className="lm-col-money" /></colgroup>
          <thead><tr>
            <th scope="col">작성자</th>
            <th scope="col" aria-sort={sortAttribute("status")}><button type="button" onClick={() => toggleSort("status")}>상태 {sortIcon("status")}</button></th>
            <th scope="col" aria-sort={sortAttribute("updatedAt")}><button type="button" onClick={() => toggleSort("updatedAt")}>최근 변경일 {sortIcon("updatedAt")}</button></th>
            <th scope="col">세부지원사업명</th><th scope="col">품목명</th><th scope="col">비목명</th><th scope="col">증빙</th>
            <th scope="col" className="lm-money-cell lm-sticky-cash" aria-sort={sortAttribute("cashAmount")}><button type="button" onClick={() => toggleSort("cashAmount")}>현금 금액 {sortIcon("cashAmount")}</button></th>
            <th scope="col" className="lm-money-cell lm-sticky-kind" aria-sort={sortAttribute("inKindAmount")}><button type="button" onClick={() => toggleSort("inKindAmount")}>현물 금액 {sortIcon("inKindAmount")}</button></th>
          </tr></thead>
          <tbody>{loading && requests.length === 0 ? <tr><td colSpan={9} className="lm-history-empty">내역을 불러오는 중입니다.</td></tr> : filtered.length === 0 ? <tr><td colSpan={9} className="lm-history-empty"><Search size={24} /><strong>{hasFilters ? "검색 결과가 없습니다." : "아직 요청 내역이 없습니다."}</strong><span>{hasFilters ? "검색어나 필터를 변경해 보세요." : "요청 화면에서 새 요청서를 작성할 수 있습니다."}</span>{hasFilters && <button type="button" className="lm-outline-button" onClick={reset}>필터 초기화</button>}</td></tr> : filtered.map(request => <tr key={request.id} onClick={() => onOpen(request)}>
            <td><div className="lm-author" title={`${SOURCE_LABELS[request.source]} 원본${request.sourceId ? ` · ${request.sourceId}` : ""}`}><span className="lm-avatar" aria-hidden="true">{request.author ? request.author.slice(0, 1) : "·"}</span><span className="lm-author-name">{request.author || "—"}</span></div></td>
            <td><span className={`lm-status-badge lm-status-${request.superseded ? "gray" : STATUS_COLORS[request.status] ?? "gray"}`} title={request.superseded ? `원본 상태: ${request.originalStatus || request.status || "미기재"}` : request.originalStatus && request.originalStatus !== request.status ? `원본 상태: ${request.originalStatus}` : undefined}><i />{request.superseded ? "보관됨 (거래 분할 변경)" : request.status || "—"}</span></td>
            <td className="lm-date-cell">{dateLabel(request.updatedAt || request.requestedAt)}</td>
            <td><span className="lm-project-badge" title={projectLabel(request.projectId)}>{projectLabel(request.projectId)}</span></td>
            <td><button type="button" className="lm-history-open" title={request.title || request.item} aria-label={`${request.title || request.item || "제목 없음"} 열기 · ${SOURCE_LABELS[request.source]}`} onClick={event => { event.stopPropagation(); onOpen(request); }}>{request.title || request.item || "제목 없음"}</button></td>
            <td>{request.category ? <span className="lm-category-badge" title={request.category}>{request.category}</span> : "—"}</td>
            <td className="lm-receipt-cell" title={request.receiptType}>{request.receiptType || "—"}</td>
            <td className={`lm-money-cell lm-sticky-cash${request.cashAmount < 0 ? " lm-negative" : ""}`}>{money(request.cashAmount)}</td>
            <td className={`lm-money-cell lm-sticky-kind${request.inKindAmount < 0 ? " lm-negative" : ""}`}>{money(request.inKindAmount)}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <p className="lm-history-count" aria-live="polite">총 {filtered.length.toLocaleString("ko-KR")}건{hasFilters && <span> / 전체 {requests.length.toLocaleString("ko-KR")}건</span>}{loading && <span> · 업데이트 중</span>}</p>
    </section>
  );
}
