"use client";

import { useCallback, useEffect, useState } from "react";
import { getRcmsAgentHealth, getRcmsRegistrationState, launchRcmsAgent, startRcmsRegistration } from "@/lib/data/rcmsRegistration";
import type { RcmsJob, RcmsRegistrationState } from "@/lib/rcms/types";
import "./rcms-registration.css";

type Props = { requestId: string; dirty: boolean; disabled: boolean };
const active = new Set<RcmsJob["status"]>(["queued", "running", "submitting"]);
const labels: Record<RcmsJob["status"], string> = {
  queued: "실행 대기", running: "RCMS 등록 진행 중", submitting: "RCMS 제출 확인 중",
  needs_login: "RCMS 로그인 필요", needs_review: "자료 보완 필요", registered: "사용등록 완료",
  duplicate: "이미 등록된 건", uncertain: "등록 결과 확인 필요", failed: "실행 실패",
};
const won = (amount: number) => `${amount.toLocaleString("ko-KR")}원`;
const resultUrl = (value: string) => {
  try { return new URL(value).protocol === "https:" ? value : undefined; } catch { return undefined; }
};

export function RcmsRegistration({ requestId, dirty, disabled }: Props) {
  const [state, setState] = useState<RcmsRegistrationState | null>(null);
  const [loading, setLoading] = useState(true);
  const [launching, setLaunching] = useState(false);
  const [online, setOnline] = useState<boolean | null>(null);
  const [runnerBusy, setRunnerBusy] = useState(false);
  const [runnerError, setRunnerError] = useState<string | null>(null);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    const next = await getRcmsRegistrationState(requestId);
    setState(next);
    setError("");
  }, [requestId]);

  const checkCompanion = useCallback(async () => {
    try { const health = await getRcmsAgentHealth(); setOnline(health.ok); setRunnerBusy(health.busy); setRunnerError(health.error); }
    catch { setOnline(false); setRunnerBusy(false); setRunnerError(null); }
  }, []);

  useEffect(() => {
    let mounted = true;
    getRcmsRegistrationState(requestId).then(next => { if (mounted) setState(next); })
      .catch(cause => { if (mounted) setError(cause instanceof Error ? cause.message : "등록 상태를 불러오지 못했습니다."); })
      .finally(() => { if (mounted) setLoading(false); });
    getRcmsAgentHealth().then(health => { if (mounted) { setOnline(health.ok); setRunnerBusy(health.busy); setRunnerError(health.error); } })
      .catch(() => { if (mounted) setOnline(false); });
    return () => { mounted = false; };
  }, [requestId]);

  const status = state?.job?.status;
  useEffect(() => {
    if (!status || !active.has(status)) return;
    const timer = window.setInterval(() => {
      void refresh().catch(() => setError("등록 상태를 새로고침하지 못했습니다."));
      void checkCompanion();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [status, refresh, checkCompanion]);

  async function start(verificationOnly = false) {
    if (!(verificationOnly ? canVerify : canLaunch) || dirty || disabled || launching || runnerBusy) return;
    setLaunching(true);
    setError("");
    try {
      const created = await startRcmsRegistration(requestId, verificationOnly);
      setState(current => current ? { ...current, job: created.job } : current);
      await launchRcmsAgent(created.launch);
      setOnline(true);
      void checkCompanion();
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "사용등록을 시작하지 못했습니다.");
      void checkCompanion();
      void refresh().catch(() => {});
    } finally { setLaunching(false); }
  }

  const job = state?.job;
  const reReviewed = Boolean(state?.review.reviewedAt && job && Date.parse(state.review.reviewedAt) > Date.parse(job.updatedAt));
  const canLaunch = Boolean(job?.status === "uncertain" || state?.review.approved && !(job?.verificationOnly && ["queued", "needs_login"].includes(job.status)) && (!job || ["queued", "needs_login", "failed"].includes(job.status) || job.status === "needs_review" && reReviewed));
  const lookupResume = Boolean(job?.verificationOnly && ["queued", "needs_login"].includes(job.status));
  const canVerify = Boolean(state && (!job || ["failed", "needs_review"].includes(job.status) || lookupResume));
  const action = job?.status === "needs_login" ? "로그인 후 재개" : job?.status === "uncertain" ? "등록 결과 조회 재개" : job?.status === "queued" ? "실행기에서 재개" : job?.status === "failed" || job?.status === "needs_review" ? "사용등록 다시 진행" : "사용등록 진행";
  const href = job?.result?.url ? resultUrl(job.result.url) : undefined;

  return <section className="lm-rcms" aria-label="RCMS 사용등록">
    <div className="lm-rcms-heading"><div><h2>RCMS 사용등록</h2><p>Finance bot 검수 후 이 Mac의 에이전트가 증빙을 대조하고 RCMS에서 등록합니다.</p></div><button type="button" className="lm-rcms-refresh" onClick={() => { void refresh().catch(cause => setError(cause instanceof Error ? cause.message : "상태를 불러오지 못했습니다.")); void checkCompanion(); }} disabled={loading || launching}>상태 새로고침</button></div>
    {loading && <p className="lm-rcms-muted" role="status">검수 및 등록 상태를 확인하는 중입니다.</p>}
    {!loading && state && <>
      {job ? <div className="lm-rcms-status" role="status"><strong>{labels[job.status]}</strong><span>{job.message || (job.status === "uncertain" ? "RCMS 목록에서 기존 등록 여부만 확인한 뒤 재개하세요. 다시 등록하지 않습니다." : "상태를 확인해 주세요.")}</span></div>
        : <p className="lm-rcms-muted">{state.review.approved ? "검수가 완료되었습니다. RCMS 등록을 시작할 수 있습니다." : state.review.reason || "Finance bot 검수를 통과하면 사용등록을 진행할 수 있습니다."}</p>}
      {job?.status === "needs_login" && <p className="lm-rcms-hint">이 Mac에서 RCMS에 로그인한 뒤 재개해 주세요. 추가 인증은 직접 완료해야 합니다.</p>}
      {job?.status === "uncertain" && <p className="lm-rcms-hint">결과가 불명확합니다. 재개하면 기존 등록 여부만 조회합니다. 새 등록은 하지 않습니다.</p>}
      {job?.status === "needs_review" && <p className="lm-rcms-hint">표시된 사유와 원본 증빙을 확인하고 보완한 뒤 Finance bot 검수를 다시 요청해 주세요.</p>}
      {(job?.status === "registered" || job?.status === "duplicate") && job.result && <div className="lm-rcms-result"><strong>RCMS 확인 정보</strong><dl><dt>등록 번호</dt><dd>{job.result.reference || "확인 정보 없음"}</dd><dt>확인 결과</dt><dd>{job.result.verification || "확인 정보 없음"}</dd>{job.result.amounts && <><dt>공급가액</dt><dd>{won(job.result.amounts.supplyAmount)}</dd><dt>부가세</dt><dd>{won(job.result.amounts.vatAmount)}</dd><dt>지급 총액</dt><dd>{won(job.result.amounts.totalAmount)}</dd></>}</dl>{href && <a href={href} target="_blank" rel="noreferrer">RCMS 내역 열기</a>}</div>}
      {dirty && <p className="lm-rcms-hint">저장하지 않은 변경이 있습니다. 저장 후 Finance bot 검수를 다시 확인해 주세요.</p>}
      {online === false && <p className="lm-rcms-hint">이 Mac의 RCMS 실행기에 연결할 수 없습니다. 로컬 실행기를 켠 뒤 상태를 새로고침하세요.</p>}
      {runnerBusy && <p className="lm-rcms-hint">이 Mac의 실행기가 다른 작업을 진행 중입니다. 완료 후 상태를 새로고침하세요.</p>}
      {runnerError && <p className="lm-rcms-error" role="alert">실행기 오류: {runnerError} 상태를 새로고침한 뒤 재개해 주세요.</p>}
      <div className="lm-rcms-actions">
        {canLaunch && <button type="button" className="lm-rcms-start" onClick={() => void start()} disabled={dirty || disabled || launching || online === false || runnerBusy}>{launching ? "실행기 연결 중…" : action}</button>}
        {canVerify && <button type="button" className="lm-rcms-verify" onClick={() => void start(true)} disabled={dirty || disabled || launching || online === false || runnerBusy}>{lookupResume ? job?.status === "needs_login" ? "로그인 후 조회 재개" : "조회 실행 재개" : "기존 RCMS 등록 확인"}</button>}
      </div>
      {canVerify && <p className="lm-rcms-verify-note">RCMS에서 기존 등록 여부만 조회합니다. 새 사용등록은 하지 않습니다.</p>}
    </>}
    {error && <p className="lm-rcms-error" role="alert">{error}</p>}
  </section>;
}
