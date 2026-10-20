"use client";

import { Fragment, useMemo, useState } from "react";
import { ArrowLeft, ArrowUp, Check, ChevronRight, Download, FileCheck2, FileText, Info, LoaderCircle, MessageCircle, Paperclip, Trash2, Upload, WandSparkles } from "lucide-react";
import { addLumosMessage, deleteLumosDocument, uploadLumosDocument } from "@/lib/data/lumos";
import { reviewLumosRequest } from "@/lib/data/financeBot";
import { getBranches, getMissingEvidence, getPostPurchaseEvidence, getRequirements, getSupportedFormName, isPostPurchaseRequirement, matchesBranch, PROJECT, type LumosRequirement } from "@/lib/lumos/catalog";
import { validateLumosUpload } from "@/lib/lumos/validation";
import type { LumosDocument, LumosRequest } from "@/lib/lumos/types";
import { RcmsRegistration } from "./RcmsRegistration";
import "./lumos-editor.css";

type Props = {
  request: LumosRequest;
  onChange: (request: LumosRequest) => void;
  onPersisted: (request: LumosRequest) => void;
  onBack: () => void;
  onSave: (request: LumosRequest) => Promise<LumosRequest>;
  storageUnavailable?: boolean;
  dirty: boolean;
  persisted: boolean;
};
type FieldErrors = Record<string, string>;
const ACCEPT = ".pdf,.png,.jpg,.jpeg,.gif,.webp,.heic,.hwp,.hwpx,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,.zip";
const RECEIPTS = ["세금계산서", "카드매출전표", "계좌이체", "현물", "기타"];
const TYPE_NAMES = { "fund-request": "사업비 사용", "agreement-change": "협약 변경", general: "문의" };
const messageError = (error: unknown) => error instanceof Error ? error.message : "처리하지 못했습니다. 다시 시도해 주세요.";
const dateText = (value: string) => value ? value.slice(0, 10).replaceAll("-", ".") : "날짜 미확인";
const timeText = (value: string) => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }) : "";
const safeUrl = (value?: string) => value && (/^https?:\/\//i.test(value) || /^\/(?!\/)/.test(value)) ? value : undefined;

export function LumosEditor({ request, onChange, onPersisted, onBack, onSave, storageUnavailable = false, dirty, persisted }: Props) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState("");
  const [dragKey, setDragKey] = useState("");
  const [registrationRefresh, setRegistrationRefresh] = useState(0);
  const blocked = Boolean(busy) || storageUnavailable || Boolean(request.superseded);
  const branches = getBranches(request.type);
  const categories = [...new Set(branches.map(branch => branch.category))];
  const categoryBranches = branches.filter(branch => branch.category === request.category);
  const items = [...new Set(categoryBranches.map(branch => branch.item))];
  const selectedItem = request.item || (items.length === 1 && items[0] === "-" ? "-" : "");
  const groups = categoryBranches.filter(branch => branch.item === selectedItem).map(branch => branch.group);
  const requirements = getRequirements(request);
  const automatic = requirements.filter(requirement => requirement.mode !== "upload");
  const uploads = requirements.filter(requirement => requirement.mode === "upload");
  const requirementKeys = new Set(requirements.map(requirement => requirement.key));
  const otherDocuments = request.documents.filter(file => !file.requirementKey || !requirementKeys.has(file.requirementKey));
  const knownBranch = branches.some(branch => matchesBranch(branch, request));
  const messages = useMemo(() => [...request.messages].sort((a, b) => a.createdAt.localeCompare(b.createdAt)), [request.messages]);

  function change(patch: Partial<LumosRequest>) {
    onChange({ ...request, ...patch });
    setNotice("");
    setErrors(current => Object.fromEntries(Object.entries(current).filter(([key]) => !(key in patch))));
  }
  function selectCategory(category: string) {
    const available = branches.filter(branch => branch.category === category);
    const nextItems = [...new Set(available.map(branch => branch.item))];
    const item = nextItems.length === 1 ? nextItems[0] : "";
    const nextGroups = available.filter(branch => branch.item === item);
    change({ category, item, group: nextGroups.length === 1 ? nextGroups[0].group : "" });
  }
  function selectItem(item: string) {
    const available = categoryBranches.filter(branch => branch.item === item);
    change({ item, group: available.length === 1 ? available[0].group : "" });
  }
  function validate(review = false) {
    const next: FieldErrors = {};
    if (!request.title.trim()) next.title = "요청 제목을 입력해 주세요.";
    if (!request.projectId.trim()) next.projectId = "과제를 선택해 주세요.";
    if (!Number.isFinite(request.cashAmount) || request.source === "pulse" && request.cashAmount < 0) next.cashAmount = "0 이상의 금액을 입력해 주세요.";
    if (!Number.isFinite(request.inKindAmount) || request.source === "pulse" && request.inKindAmount < 0) next.inKindAmount = "0 이상의 금액을 입력해 주세요.";
    if (review && request.type !== "general") {
      if (!knownBranch) next.category = "비목·세목·항목을 선택해 필요한 서류를 확인해 주세요.";
      if (request.type === "fund-request" && !request.receiptType) next.receiptType = "증빙 유형을 선택해 주세요.";
      for (const requirement of getMissingEvidence(request)) next[requirement.key] = "검수 요청에 필요한 서류를 첨부해 주세요.";
    }
    setErrors(next);
    if (Object.keys(next).length) {
      setError(review ? "표시된 입력값과 필요 서류를 확인해 주세요." : "표시된 입력값을 확인해 주세요.");
      return false;
    }
    return true;
  }
  async function perform(key: string, action: () => Promise<void>) {
    if (blocked) return;
    setBusy(key); setError(""); setNotice("");
    try { await action(); } catch (cause) { setError(messageError(cause)); } finally { setBusy(""); }
  }
  async function save(review: boolean, returnToDraft = false) {
    if (!validate(review)) return;
    await perform(review ? "review" : returnToDraft ? "draft" : "save", async () => {
      if (!review) {
        const saved = await onSave({ ...request, ...(returnToDraft ? { status: "작성중" } : {}) });
        onChange(saved);
        setNotice(returnToDraft ? "작성중으로 돌아왔습니다. 내용을 수정한 뒤 다시 검수를 요청하세요." : "저장했습니다.");
        return;
      }
      /* 루모스를 거치지 않고 직접 RCMS에 올리므로 이 판정이 마지막 관문이다.
         막히면 상태를 올리지 않고 사유만 댓글로 남긴다. */
      let saved = await onSave(request);
      onChange(saved);
      const verdict = await reviewLumosRequest(saved);
      onPersisted(await addLumosMessage(saved.id, verdict.comment, true));
      if (!verdict.ok) {
        setNotice(verdict.verdict === "불가"
          ? "Finance bot이 집행 불가로 봤습니다. 사유를 메시지에서 확인하세요."
          : "보완할 내용이 있습니다. 메시지를 확인한 뒤 다시 검수를 요청하세요.");
        return;
      }
      saved = await onSave({ ...saved, status: "검수 요청" });
      onChange(saved);
      setNotice("Finance bot 검수를 통과했습니다. RCMS에 제출하세요.");
      setRegistrationRefresh(value => value + 1);
    });
  }
  async function attach(requirementKey: string, files: File[]) {
    if (!files.length || !validate()) return;
    await perform(requirementKey, async () => {
      for (const file of files) validateLumosUpload(file);
      let saved = await onSave(request);
      onChange(saved);
      for (const file of files) {
        saved = await uploadLumosDocument(saved.id, requirementKey, file);
        onPersisted(saved);
      }
      setErrors(current => { const next = { ...current }; delete next[requirementKey]; return next; });
      setNotice(`${files.length}개 파일을 첨부했습니다.`);
    });
  }
  async function remove(file: LumosDocument) {
    await perform(`delete:${file.id}`, async () => {
      const saved = await onSave(request);
      const updated = await deleteLumosDocument(saved.id, file.id);
      onPersisted(updated);
      setNotice(saved.status === "검수 요청" && updated.status === "작성중" ? "첨부파일을 삭제하고 작성중으로 돌아왔습니다. 서류를 보완한 뒤 다시 검수를 요청하세요." : "첨부파일을 삭제했습니다.");
    });
  }
  async function download(requirement: LumosRequirement) {
    if (!validate()) return;
    await perform(`form:${requirement.key}`, async () => {
      const saved = await onSave(request);
      onChange(saved);
      const response = await fetch(`/api/lumos/forms?requestId=${encodeURIComponent(saved.id)}&formName=${encodeURIComponent(requirement.name)}`, { cache: "no-store" });
      if (!response.ok) {
        const result = (await response.json() as any);
        throw new Error(result.error || "서식을 내려받지 못했습니다.");
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url; link.download = `${requirement.name}_${saved.id}.xlsx`;
      document.body.appendChild(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice("편집용 초안을 내려받았습니다. 내용을 확인한 뒤 완성한 파일을 첨부해 주세요.");
    });
  }
  async function sendMessage() {
    if (!message.trim() || !validate()) return;
    await perform("message", async () => {
      const saved = await onSave(request);
      onPersisted(await addLumosMessage(saved.id, message));
      setMessage("");
    });
  }
  function fileList(files: LumosDocument[]) {
    return <ul className="lm-editor-files">{files.map(file => {
      const href = safeUrl(file.url);
      return <li key={file.id}><FileText size={16} /><span className="lm-editor-file-name">{href ? <a href={href} target="_blank" rel="noreferrer">{file.name}</a> : <span title="원본 파일 링크가 수집되지 않았습니다.">{file.name}</span>}{!href && <small>원본 링크 미확보</small>}</span>{href && <a className="lm-editor-icon-button" href={href} target="_blank" rel="noreferrer" aria-label={`${file.name} 다운로드`}><Download size={15} /></a>}{file.origin === "upload" && <button type="button" className="lm-editor-icon-button" disabled={blocked} aria-label={`${file.name} 삭제`} onClick={() => void remove(file)}>{busy === `delete:${file.id}` ? <LoaderCircle size={15} className="lm-editor-spin" /> : <Trash2 size={15} />}</button>}</li>;
    })}</ul>;
  }
  function uploadBox(key: string, compact = false) {
    return <label className={`lm-editor-dropzone${compact ? " lm-editor-dropzone-compact" : ""}${dragKey === key ? " lm-editor-dropzone-active" : ""}${blocked ? " lm-editor-disabled" : ""}`} onDragOver={event => { event.preventDefault(); if (!blocked) setDragKey(key); }} onDragLeave={() => setDragKey("")} onDrop={event => { event.preventDefault(); setDragKey(""); if (!blocked) void attach(key, Array.from(event.dataTransfer.files)); }}>
      <input type="file" multiple accept={ACCEPT} disabled={blocked} aria-label={`${key.split(":").slice(1).join(":") || "기타"} 파일 첨부`} onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ""; void attach(key, files); }} />
      {busy === key ? <LoaderCircle size={18} className="lm-editor-spin" /> : compact ? <Paperclip size={15} /> : <Upload size={19} />}<span>{busy === key ? "첨부하는 중" : compact ? "완성한 파일 첨부" : "클릭하거나 파일을 여기에 끌어다 놓으세요"}</span>{!compact && <small>파일당 20MB 미만</small>}
    </label>;
  }
  function requirementRow(requirement: LumosRequirement) {
    const files = request.documents.filter(file => file.requirementKey === requirement.key);
    const supported = getSupportedFormName(requirement.name);
    const afterPurchase = isPostPurchaseRequirement(requirement);
    const progress = afterPurchase ? getPostPurchaseEvidence(request).find(item => item.requirement.key === requirement.key) : undefined;
    return <div key={requirement.key} className={`lm-editor-evidence${errors[requirement.key] ? " lm-editor-evidence-error" : ""}`}>
      <div className="lm-editor-evidence-heading"><span className={`lm-editor-document-icon ${requirement.mode !== "upload" ? "lm-editor-document-icon-blue" : ""}`}>{requirement.mode === "auto" ? <FileCheck2 size={20} /> : <FileText size={20} />}</span><div><h3>{requirement.name}{requirement.requiredBadge && <span className={afterPurchase ? "lm-editor-after-purchase" : "lm-editor-required"}>{afterPurchase ? "구매 후 제출" : "필수"}</span>}</h3>{requirement.description && <p>{requirement.description}</p>}{afterPurchase && <p>사전 검수는 사진 없이 진행할 수 있습니다. 사후 증빙에서 계속 관리합니다.{progress && ` (사진 파일 ${progress.attachedCount}/${progress.minimumCount}개)`}</p>}</div></div>
      {requirement.mode === "auto" && <div className="lm-editor-form-actions">{supported ? <button type="button" className="lm-editor-form-button" onClick={() => void download(requirement)} disabled={blocked}>{busy === `form:${requirement.key}` ? <LoaderCircle size={15} className="lm-editor-spin" /> : <Download size={15} />}편집용 서식 다운로드</button> : <span className="lm-editor-unavailable">원본 서식 미확보</span>}{supported === "검수확인서" && <span className="lm-editor-form-note">유사 명칭 서식: 검수확인서</span>}</div>}
      {requirement.mode === "issuance" && <p className="lm-editor-issuance-note">증빙 발급 후 첨부해 주세요.</p>}
      {files.length > 0 && fileList(files)}
      {uploadBox(requirement.key, requirement.mode !== "upload" || files.length > 0)}
      {errors[requirement.key] && <p className="lm-editor-field-error">{errors[requirement.key]}</p>}
    </div>;
  }
  function messageFiles(files?: { name: string; url: string }[]) {
    if (!files?.length) return null;
    return <ul className="lm-editor-chat-attachments">{files.map((file, index) => <li key={`${file.url}:${index}`}><Paperclip size={12} />{safeUrl(file.url) ? <a href={safeUrl(file.url)} target="_blank" rel="noreferrer">{file.name || "첨부파일"}</a> : <span>{file.name || "첨부파일"}</span>}</li>)}</ul>;
  }
  function options(values: string[], current: string, placeholder: string) {
    return <><option value="">{placeholder}</option>{current && !values.includes(current) && <option value={current}>{current} (원본)</option>}{values.map(value => <option key={value} value={value}>{value}</option>)}</>;
  }

  return <section className="lm-editor" aria-label="요청 상세" aria-busy={Boolean(busy)}>
    <header className="lm-editor-header">
      <div className="lm-editor-breadcrumb"><button type="button" onClick={onBack} disabled={Boolean(busy)}><ArrowLeft size={16} />내역</button><ChevronRight size={13} /><span>{TYPE_NAMES[request.type]}</span></div>
      <div className="lm-editor-title-row"><span className={`lm-editor-status${!request.superseded && request.status.includes("완료") ? " lm-editor-status-complete" : ""}`} title={request.superseded ? `원본 상태: ${request.originalStatus || request.status || "미기재"}` : undefined}><i />{request.superseded ? "보관됨 (거래 분할 변경)" : request.status || "작성중"}</span><div className="lm-editor-top-actions">{request.status === "검수 요청" && <button type="button" className="lm-editor-save" disabled={blocked} onClick={() => void save(false, true)}>{busy === "draft" && <LoaderCircle size={15} className="lm-editor-spin" />}작성중으로 돌아가기</button>}<button type="button" className="lm-editor-save" disabled={blocked} onClick={() => void save(false)}>{busy === "save" && <LoaderCircle size={15} className="lm-editor-spin" />}저장</button><button type="button" className="lm-editor-review" disabled={blocked} onClick={() => void save(true)}>{busy === "review" && <LoaderCircle size={15} className="lm-editor-spin" />}Finance bot 검수</button></div></div>
      <input className="lm-editor-title" aria-label="요청 제목" aria-invalid={Boolean(errors.title)} value={request.title} placeholder="요청 제목을 입력해 주세요" maxLength={500} disabled={blocked} onChange={event => change({ title: event.target.value })} />
      {errors.title && <p className="lm-editor-field-error">{errors.title}</p>}
      <div className="lm-editor-meta"><span>작성자 <strong>{request.author || "—"}</strong></span><span>요청일 <strong>{dateText(request.requestedAt)}</strong></span><label>담당자 <input aria-label="담당자" value={request.assignee} maxLength={300} placeholder="미지정" disabled={blocked} onChange={event => change({ assignee: event.target.value })} /></label>{request.source !== "pulse" && <span className="lm-editor-source">{request.source === "lumos" ? "Lumos" : "Finance"} 원본{request.sourceId ? ` · ${request.sourceId}` : ""}</span>}</div>
      {request.superseded && <p className="lm-editor-alert" role="status"><Info size={16} />거래 분할 변경으로 보관된 요청입니다. 원본 금액·대화·첨부파일은 유지되며 조회와 첨부파일 다운로드만 가능합니다.</p>}
      {storageUnavailable && <p className="lm-editor-alert" role="status"><Info size={16} />저장소를 연결하지 못해 현재 내역을 조회만 할 수 있습니다.</p>}
      {error && <p className="lm-editor-alert lm-editor-alert-error" role="alert">{error}</p>}
      {notice && <p className="lm-editor-success" role="status"><Check size={15} />{notice}</p>}
    </header>
    {request.type === "fund-request" && !request.superseded && persisted && <RcmsRegistration key={`${request.id}:${request.updatedAt}:${registrationRefresh}`} requestId={request.id} dirty={dirty} disabled={blocked} />}
    <div className="lm-editor-columns">
      <div className="lm-editor-form">
        <section className="lm-editor-section">
          <h2>요청서</h2>
          <div className="lm-editor-request-cards"><div className="lm-editor-info-card"><h3>품목 분류</h3><div className="lm-editor-classification">
            <label className="lm-editor-project"><span>과제</span><select aria-label="과제" value={request.projectId} disabled={blocked} onChange={event => change({ projectId: event.target.value })}><option value="">과제 선택</option>{request.projectId && request.projectId !== PROJECT.id && <option value={request.projectId}>{request.projectId === "tips" ? PROJECT.name : request.projectId} (원본)</option>}<option value={PROJECT.id}>{PROJECT.name}</option></select><small>{request.projectId === PROJECT.id || request.projectId === "tips" ? PROJECT.name : request.projectId}</small></label>
            {request.type !== "general" && <><label><span>비목</span><select aria-label="비목" aria-invalid={Boolean(errors.category)} value={request.category} disabled={blocked} onChange={event => selectCategory(event.target.value)}>{options(categories, request.category, "비목 선택")}</select></label><label><span>세목</span><select aria-label="세목" value={selectedItem} disabled={blocked || !request.category} onChange={event => selectItem(event.target.value)}>{options(items, selectedItem, "세목 선택")}</select></label><label><span>항목</span><select aria-label="항목" value={request.group} disabled={blocked || !selectedItem} onChange={event => change({ group: event.target.value })}>{options(groups, request.group, "항목 선택")}</select></label></>}
          </div>
          {errors.projectId && <p className="lm-editor-field-error">{errors.projectId}</p>}{errors.category && <p className="lm-editor-field-error">{errors.category}</p>}
          {request.type !== "general" && request.category && !knownBranch && <p className="lm-editor-classification-note">원본의 분류를 유지하고 있습니다. 비목·세목·항목을 선택하면 해당 서류 목록을 확인할 수 있습니다.</p>}</div>
          {request.type === "fund-request" && <div className="lm-editor-info-card"><h3>금액</h3><div className="lm-editor-amounts"><label><span>증빙 유형</span><select aria-label="증빙 유형" aria-invalid={Boolean(errors.receiptType)} value={request.receiptType} disabled={blocked} onChange={event => change({ receiptType: event.target.value })}>{options(RECEIPTS, request.receiptType, "증빙 선택")}</select>{errors.receiptType && <small className="lm-editor-field-error">{errors.receiptType}</small>}</label>{(["cashAmount", "inKindAmount"] as const).map((key, index) => <label key={key}><span>{index === 0 ? "현금 금액" : "현물 금액"}</span><div className="lm-editor-money-input"><input type="number" inputMode="decimal" min={request.source === "pulse" ? 0 : undefined} step="1" aria-label={index === 0 ? "현금 금액" : "현물 금액"} aria-invalid={Boolean(errors[key])} value={Number.isFinite(request[key]) ? request[key] : ""} disabled={blocked} onChange={event => change({ [key]: event.target.value === "" ? 0 : Number(event.target.value) })} /><span>원</span></div>{errors[key] && <small className="lm-editor-field-error">{errors[key]}</small>}</label>)}</div><p className="lm-editor-amount-note">현금 금액은 연구비 신청액입니다. RCMS 지급 총액은 원본 증빙의 공급가액과 부가세를 확인해 등록하고, 부가세는 추후 복원합니다. 일률적으로 10%를 더하지 마세요.</p></div>}</div>
          {request.details?.payroll && request.details.payroll.length > 0 && <div className="lm-editor-payroll"><h3>내부 인건비 <span>원본 세부값</span></h3><table><thead><tr><th scope="col">구분</th><th scope="col">현금</th><th scope="col">현물</th></tr></thead><tbody>{request.details.payroll.map((row, index) => <tr key={`${row.kind}:${index}`}><th scope="row">{row.kind}</th><td>{row.cashAmount.toLocaleString("ko-KR")}원</td><td>{row.inKindAmount.toLocaleString("ko-KR")}원</td></tr>)}</tbody></table></div>}
          <label className="lm-editor-notes"><span>요청 내용</span><textarea value={request.notes} maxLength={20000} rows={3} placeholder="요청 내용과 확인이 필요한 사항을 작성해 주세요." disabled={blocked} onChange={event => change({ notes: event.target.value })} /></label>
        </section>
        {automatic.length > 0 && <section className="lm-editor-section lm-editor-document-section"><h2><WandSparkles size={19} />서식 자동 완성</h2><p className="lm-editor-section-description">서식을 내려받아 내용을 확인하고 완성한 문서를 첨부해 주세요.</p><div className="lm-editor-evidence-list">{automatic.map(requirementRow)}</div></section>}
        <section className="lm-editor-section lm-editor-document-section"><h2><Upload size={18} />{request.type === "general" ? "첨부파일" : "직접 업로드"}</h2>{uploads.length > 0 ? <div className="lm-editor-evidence-list">{uploads.map(requirementRow)}</div> : <>{request.type !== "general" && <p className="lm-editor-section-description">분류를 선택하면 필요한 서류가 표시됩니다.</p>}{uploadBox("upload:기타")}</>}</section>
        {otherDocuments.length > 0 && <section className="lm-editor-section lm-editor-document-section"><h2><Paperclip size={18} />기존 첨부파일 <span className="lm-editor-count">{otherDocuments.length}</span></h2><p className="lm-editor-section-description">원본에서 가져온 파일과 아직 서류 항목에 연결되지 않은 파일입니다.</p>{fileList(otherDocuments)}</section>}
        <p className="lm-editor-internal-note"><Info size={14} />Finance bot이 RCMS 제출 가능 여부를 판정합니다. 통과해야 검수 요청 상태로 넘어갑니다.</p>
      </div>
      <aside className="lm-editor-chat" aria-label="요청 대화">
        <div className="lm-editor-chat-heading"><h2><MessageCircle size={18} />메시지</h2><span>{messages.length}</span></div>
        <div className="lm-editor-messages" aria-live="polite">{messages.length === 0 ? <div className="lm-editor-chat-empty"><MessageCircle size={30} strokeWidth={1.4} /><strong>아직 메시지가 없습니다.</strong><p>요청에 관한 내용을 남겨 주세요.</p></div> : messages.map((entry, index) => <Fragment key={entry.id}>{(index === 0 || messages[index - 1].createdAt.slice(0, 10) !== entry.createdAt.slice(0, 10)) && <div className="lm-editor-message-date"><span>{dateText(entry.createdAt)}</span></div>}{entry.kind === "status" ? <div><p className="lm-editor-status-message">{entry.text}</p>{messageFiles(entry.attachments)}</div> : <article className="lm-editor-message"><span className="lm-editor-avatar" aria-hidden="true">{entry.author.slice(0, 1) || "·"}</span><div><header><strong>{entry.author || "작성자 미상"}</strong><time dateTime={entry.createdAt}>{timeText(entry.createdAt)}</time></header><p>{entry.text}</p>{messageFiles(entry.attachments)}</div></article>}</Fragment>)}</div>
        <div className="lm-editor-composer"><label htmlFor="lm-editor-message-input">메시지 작성</label><textarea id="lm-editor-message-input" aria-label="메시지 작성" value={message} maxLength={10000} rows={3} placeholder="메시지를 입력해 주세요." disabled={blocked} onChange={event => setMessage(event.target.value)} onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); void sendMessage(); } }} /><div><span>내부 메시지 · ⌘ / Ctrl + Enter</span><button type="button" onClick={() => void sendMessage()} disabled={blocked || !message.trim()} aria-label="메시지 전송">{busy === "message" ? <LoaderCircle size={18} className="lm-editor-spin" /> : <ArrowUp size={19} />}</button></div></div>
      </aside>
    </div>
  </section>;
}
