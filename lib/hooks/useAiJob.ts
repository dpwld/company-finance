"use client";

import { useSyncExternalStore } from "react";
import { anyJobRunning, getJob, subscribeJobs, type JobKey, type JobState } from "@/lib/finance/aiJobs";

/** 모듈 스코프 AI 작업 상태를 구독한다 — 컴포넌트가 다시 마운트돼도 진행 중이면 그대로 보인다. */
export function useAiJob(key: JobKey): JobState {
  return useSyncExternalStore(
    subscribeJobs,
    () => getJob(key),
    () => getJob(key),
  );
}

/** 진행 중인 Finance AI 작업이 하나라도 있는지 (헤더 표시용). */
export function useAnyAiJob(): boolean {
  return useSyncExternalStore(subscribeJobs, anyJobRunning, () => false);
}
