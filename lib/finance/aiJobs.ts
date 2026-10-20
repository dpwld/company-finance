/* Finance AI 작업 러너 — 분류·분개처럼 오래 걸리는 작업을 컴포넌트 바깥(모듈 스코프)에서
   돌린다. 탭을 옮기거나 화면을 떠나도 작업은 계속되고, 돌아오면 진행 상태가 그대로 보인다.
   (예전에는 useState 안에서 돌아 언마운트되면 진행 표시가 사라지고, 결과 반영도 끊겼다.)

   주의: 페이지를 새로고침하거나 탭을 닫으면 중단된다 — 브라우저 안에서만 사는 작업이다. */

export type JobKey = "spend-classify";

export interface JobState {
  running: boolean;
  /** 진행률 — 총 건수를 아는 작업만 채운다. */
  done: number;
  total: number;
  /** 마지막 실행 결과 메시지 (성공/실패 모두). */
  message: string | null;
  error: boolean;
  /** 작업이 끝난 시각 — 화면이 결과를 한 번만 반영하도록 비교용. */
  finishedAt: number | null;
  /** 사용자 확인이 필요한 결과물 (증빙 업로드의 검토 목록 등). 소비 후 clearJobResult로 비운다. */
  result: unknown;
}

const EMPTY: JobState = { running: false, done: 0, total: 0, message: null, error: false, finishedAt: null, result: null };

const jobs = new Map<JobKey, JobState>();
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function set(key: JobKey, patch: Partial<JobState>) {
  jobs.set(key, { ...(jobs.get(key) ?? EMPTY), ...patch });
  emit();
}

export function getJob(key: JobKey): JobState {
  return jobs.get(key) ?? EMPTY;
}

/** 결과물을 화면이 받아간 뒤 비운다 — 같은 결과가 두 번 뜨지 않게. */
export function clearJobResult(key: JobKey): void {
  if (jobs.has(key)) set(key, { result: null });
}

export function subscribeJobs(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** 진행 중인 작업이 하나라도 있으면 true — 헤더 표시용. */
export function anyJobRunning(): boolean {
  for (const j of jobs.values()) if (j.running) return true;
  return false;
}

export interface JobHandle {
  /** 진행률 갱신 — 총 건수를 아는 작업이 호출한다. */
  progress: (done: number, total: number) => void;
  /** 사용자 확인이 필요한 결과물을 남긴다(화면이 사라져도 유지). */
  setResult: (value: unknown) => void;
}

/** 작업을 시작한다. 같은 key가 이미 돌고 있으면 무시(중복 실행 방지).
   run 안에서 예외가 나면 메시지를 남기고 종료한다. 결과 반영(DB 쓰기)은
   run 안에서 끝내야 컴포넌트가 사라져도 유실되지 않는다. */
export function startJob(key: JobKey, run: (h: JobHandle) => Promise<string | void>): boolean {
  if (getJob(key).running) return false;
  set(key, { running: true, done: 0, total: 0, message: null, error: false, result: null });
  const handle: JobHandle = {
    progress: (done, total) => set(key, { done, total }),
    setResult: (value) => set(key, { result: value }),
  };
  void (async () => {
    try {
      const msg = await run(handle);
      set(key, { running: false, message: msg || null, error: false, finishedAt: Date.now() });
    } catch (err) {
      console.error(`finance job ${key} failed:`, err);
      set(key, {
        running: false,
        error: true,
        message: err instanceof Error ? err.message : String(err),
        finishedAt: Date.now(),
      });
    }
  })();
  return true;
}
