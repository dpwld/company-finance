"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ClipboardList, Info, LoaderCircle, RotateCw, Search, X } from "lucide-react";
import { useCurrentUser } from "@/lib/auth/CurrentUserContext";
import { fetchLumosRequests, saveLumosRequest } from "@/lib/data/lumos";
import { PROJECT } from "@/lib/lumos/catalog";
import type { LumosRequest } from "@/lib/lumos/types";
import { LumosEditor } from "./LumosEditor";
import { LumosHistory } from "./LumosHistory";
import { LumosFollowUp } from "./LumosFollowUp";
import { LumosRequestLanding } from "./LumosRequestLanding";
import "./lumos.css";

/* Finance 탭 안에 들어가는 패널. 탭 전환은 Finance가 쥐고 있고, 여기서는
   어떤 요청서를 열었는지만 관리한다 (예전에는 /lumos?tab=…&id=… URL이었다). */
type Tab = "request" | "history" | "evidence";
const errorMessage = (cause: unknown) => cause instanceof Error ? cause.message : "내역을 불러오지 못했습니다. 다시 시도해 주세요.";
const fingerprint = (request: LumosRequest) => JSON.stringify([request.type, request.title, request.projectId, request.status, request.category, request.item, request.group, request.receiptType, request.cashAmount, request.inKindAmount, request.requestedAt, request.assignee, request.year, request.notes]);
const sameSource = (a: LumosRequest, b: LumosRequest) => a.id === b.id || Boolean(a.sourceId && a.source === b.source && a.sourceId === b.sourceId);

export function LumosWorkspace({ tab = "request" }: { tab?: Tab } = {}) {
  const user = useCurrentUser();
  // 연 요청서는 연 탭에 매달아 둔다 — 탭이 바뀌면 자동으로 닫힌 것으로 읽힌다.
  const [opened, setOpened] = useState<{ tab: Tab; id: string } | null>(null);
  const requestId = opened && opened.tab === tab ? opened.id : null;
  const [requests, setRequests] = useState<LumosRequest[]>([]);
  const [drafts, setDrafts] = useState<Record<string, LumosRequest>>({});
  const [baselines, setBaselines] = useState<Record<string, string>>({});
  const [editorKeys, setEditorKeys] = useState<Record<string, string>>({});
  const [warnings, setWarnings] = useState<string[]>([]);
  const [storageUnavailable, setStorageUnavailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [reload, setReload] = useState(0);
  const [importOpen, setImportOpen] = useState(false);
  const leaveApproved = useRef(false);
  const selected = requestId ? drafts[requestId] ?? requests.find(request => request.id === requestId) : undefined;
  const baseline = selected ? baselines[selected.id] ?? (requests.find(request => request.id === selected.id) ? fingerprint(requests.find(request => request.id === selected.id)!) : fingerprint(selected)) : "";
  const dirty = Boolean(selected && fingerprint(selected) !== baseline);
  const anyDirty = Object.values(drafts).some(request => fingerprint(request) !== (baselines[request.id] ?? fingerprint(requests.find(item => item.id === request.id) ?? request)));

  useEffect(() => {
    let alive = true;
    fetchLumosRequests().then(result => {
      if (!alive) return;
      setRequests(result.requests);
      setWarnings(result.warnings);
      setStorageUnavailable(Boolean(result.storageUnavailable));
      setLoadError("");
    }).catch(cause => { if (alive) setLoadError(errorMessage(cause)); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [reload]);

  useEffect(() => {
    leaveApproved.current = false;
    if (!anyDirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (leaveApproved.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [anyDirty]);

  /** 저장 안 한 편집이 있으면 한 번 물어본다. */
  function guard() {
    return !dirty || window.confirm("저장하지 않은 변경이 있습니다. 다른 화면으로 이동하시겠습니까? 작성 내용은 이 화면에 유지됩니다.");
  }

  function openRequest(id: string, onTab: Tab = tab) {
    if (requestId === id) return true;
    if (!guard()) return false;
    setOpened({ tab: onTab, id });
    return true;
  }

  function create(type: LumosRequest["type"]) {
    if (storageUnavailable) return;
    const now = new Date().toISOString();
    const request: LumosRequest = {
      id: crypto.randomUUID(), source: "pulse", sourceId: null, type, title: "", projectId: PROJECT.id,
      status: "작성중", category: "", item: "", group: "", receiptType: "기타", cashAmount: 0, inKindAmount: 0,
      requestedAt: now, updatedAt: now, assignee: "", author: user.fullName, createdBy: null, year: 1,
      notes: "", documents: [], messages: [],
    };
    if (!openRequest(request.id, "request")) return;
    setDrafts(current => ({ ...current, [request.id]: request }));
    setBaselines(current => ({ ...current, [request.id]: fingerprint(request) }));
  }

  function open(request: LumosRequest) {
    if (openRequest(request.id)) setImportOpen(false);
  }

  function acceptPersisted(saved: LumosRequest, previousId = saved.id) {
    setRequests(current => [saved, ...current.filter(item => !sameSource(item, saved) && item.id !== previousId)]);
    setDrafts(current => { const next = { ...current, [saved.id]: saved }; if (previousId !== saved.id) delete next[previousId]; return next; });
    setBaselines(current => { const next = { ...current, [saved.id]: fingerprint(saved) }; if (previousId !== saved.id) delete next[previousId]; return next; });
    setEditorKeys(current => ({ ...current, [saved.id]: current[previousId] ?? previousId }));
    if (previousId !== saved.id) setOpened(current => current?.id === previousId ? { ...current, id: saved.id } : current);
  }

  async function save(request: LumosRequest) {
    if (storageUnavailable) throw new Error("저장소를 사용할 수 없습니다. 설정을 확인한 뒤 다시 시도해 주세요.");
    const saved = await saveLumosRequest(request);
    acceptPersisted(saved, request.id);
    return saved;
  }

  function retry() { setLoading(true); setLoadError(""); setReload(value => value + 1); }

  return (
    <div className="lm-workspace lm-embedded">
      <div className="lm-workspace-body">
        {(warnings.length > 0 || storageUnavailable) && <details className={`lm-data-notice${storageUnavailable ? " lm-data-notice-storage" : ""}`}><summary><Info size={14} /><span>{storageUnavailable ? "저장 기능을 사용할 수 없습니다. 내역 조회는 가능합니다." : "자료 출처 및 확인 사항"}</span><ChevronDown size={13} /></summary><ul>{warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>{storageUnavailable && <button type="button" onClick={retry} disabled={loading}><RotateCw size={13} /> 다시 확인</button>}</details>}
        {loadError && <div className="lm-load-error" role="alert"><Info size={16} /><span>{loadError}</span><button type="button" onClick={retry} disabled={loading}><RotateCw size={14} /> 다시 시도</button></div>}
        {requestId ? selected ? <LumosEditor key={editorKeys[selected.id] ?? selected.id} request={selected} dirty={dirty} persisted={requests.some(request => request.id === selected.id)} onChange={request => setDrafts(current => ({ ...current, [request.id]: request }))} onPersisted={acceptPersisted} onBack={() => setOpened(null)} onSave={save} storageUnavailable={storageUnavailable} /> : loading ? <div className="lm-workspace-loading" role="status"><LoaderCircle size={20} />요청서를 불러오는 중입니다.</div> : !loadError ? <div className="lm-workspace-empty"><ClipboardList size={30} /><h1>요청서를 찾을 수 없습니다.</h1><p>저장되지 않은 요청이거나 접근할 수 없는 내역입니다.</p><button type="button" onClick={() => setOpened(null)}>목록으로 돌아가기</button></div> : null
          : tab === "evidence" ? <LumosFollowUp requests={requests} onOpen={open} onRefresh={retry} loading={loading} /> : tab === "history" ? <LumosHistory requests={requests} onOpen={open} loading={loading} /> : <fieldset className="lm-request-fieldset" disabled={storageUnavailable || loading}><LumosRequestLanding onCreate={create} onImport={() => setImportOpen(true)} /></fieldset>}
      </div>
      {importOpen && <TransactionPicker requests={requests.filter(request => request.source === "finance" && !request.superseded)} onOpen={open} onClose={() => setImportOpen(false)} />}
    </div>
  );
}

function TransactionPicker({ requests, onOpen, onClose }: { requests: LumosRequest[]; onOpen: (request: LumosRequest) => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [receipt, setReceipt] = useState("");
  const [source, setSource] = useState("");
  const sourceLabel = (id: string | null) => id?.startsWith("card:") ? "카드 거래" : id?.startsWith("bank:") ? "계좌 거래" : id?.startsWith("split:") ? "분할 거래" : "Finance";
  const visible = useMemo(() => requests.filter(request => {
    const date = request.requestedAt.slice(0, 10);
    return (!from || date >= from) && (!to || date <= to) && (!receipt || request.receiptType === receipt) && (!source || sourceLabel(request.sourceId) === source) && (!query.trim() || [request.title, request.item, request.category, request.sourceId].join(" ").toLocaleLowerCase("ko-KR").includes(query.trim().toLocaleLowerCase("ko-KR")));
  }), [requests, from, to, receipt, source, query]);
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => element?.close(); }, []);
  return <dialog ref={dialog} className="lm-import-modal" aria-labelledby="lm-import-title" onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="lm-import-inner">
      <header><div><h2 id="lm-import-title">거래 내역 불러오기</h2><p>Finance 거래를 선택해 요청서를 작성하세요. 작성한 거래는 기존 요청서가 열립니다.</p></div><button type="button" className="lm-modal-close" aria-label="거래 내역 닫기" onClick={onClose}><X size={21} /></button></header>
      <div className="lm-import-filters"><label className="lm-import-search"><Search size={15} /><input autoFocus placeholder="거래명, 품목명 검색" aria-label="거래 검색" value={query} onChange={event => setQuery(event.target.value)} /></label><select aria-label="거래 출처" value={source} onChange={event => setSource(event.target.value)}><option value="">전체 거래 출처</option>{[...new Set(requests.map(request => sourceLabel(request.sourceId)))].map(value => <option key={value}>{value}</option>)}</select><select aria-label="거래 증빙" value={receipt} onChange={event => setReceipt(event.target.value)}><option value="">전체 증빙</option>{[...new Set(requests.map(request => request.receiptType).filter(Boolean))].map(value => <option key={value}>{value}</option>)}</select><input type="date" aria-label="거래 시작일" value={from} onChange={event => setFrom(event.target.value)} /><span>~</span><input type="date" aria-label="거래 종료일" min={from || undefined} value={to} onChange={event => setTo(event.target.value)} /></div>
      <div className="lm-import-list"><table><thead><tr><th>거래일</th><th>거래명</th><th>출처</th><th>증빙</th><th>금액</th><th><span className="lm-visually-hidden">선택</span></th></tr></thead><tbody>{visible.map(request => <tr key={request.id}><td>{request.requestedAt.slice(0, 10).replaceAll("-", ".")}</td><td title={request.title}>{request.title || request.item || "거래명 없음"}</td><td>{sourceLabel(request.sourceId)}</td><td>{request.receiptType || "—"}</td><td className={request.cashAmount < 0 ? "lm-import-negative" : ""}>{request.cashAmount < 0 ? `(${Math.abs(request.cashAmount).toLocaleString("ko-KR")})` : request.cashAmount.toLocaleString("ko-KR")}원</td><td><button type="button" onClick={() => onOpen(request)}>{request.createdBy ? "이어 작성" : "선택"}</button></td></tr>)}</tbody></table>{visible.length === 0 && <p className="lm-import-empty">조건에 맞는 거래 내역이 없습니다.</p>}</div>
      <footer><span>총 {visible.length.toLocaleString("ko-KR")}건</span><button type="button" onClick={onClose}>닫기</button></footer>
    </div>
  </dialog>;
}
