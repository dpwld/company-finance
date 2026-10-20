import type { LumosRequest } from "@/lib/lumos/types";

/* Finance bot — 루모스(외부 업체)를 거치지 않고 우리가 직접 RCMS에 올리게 되면서,
   업무요청 초안 작성과 제출 전 판정을 이 봇이 맡는다. */

export interface BotRequirement {
  key: string;
  name: string;
  mode: string;
  description: string;
  required: boolean;
}

export interface BotDraft {
  /** 그대로 저장하면 되는 요청서 — 거래 원본 매핑까지 서버에서 끝낸 결과. */
  request: LumosRequest;
  requirements: BotRequirement[];
  reason: string;
  eligible: boolean;
  /** 해외 결제 등으로 원화 금액이 아직 확정되지 않은 거래. */
  amountUnknown: boolean;
  /** 원화 미확정일 때의 외화 승인금액 표기 (예: "$20.00"). */
  fxAmount: string | null;
}

export interface BotReview {
  ok: boolean;
  verdict: "가능" | "보완필요" | "불가";
  /** 분기·증빙유형·필수서류 같은 형식 문제. */
  blockers: string[];
  missing: string[];
  reasons: string[];
  fix: string[];
  /** 댓글로 그대로 남기는 본문. */
  comment: string;
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = (await response.json().catch(() => ({})) as any);
  if (!response.ok) throw new Error(result.detail || result.error?.message || result.error || "Finance bot이 응답하지 않았습니다.");
  return result as T;
}

/** TIPS 거래 한 건 → 업무요청 초안. 저장하지는 않는다. */
export function draftLumosRequest(target: { kind: "card" | "bank"; id: string; splitId?: string }): Promise<BotDraft> {
  return post<BotDraft>("/api/finance/lumos-draft", target);
}

/** RCMS에 제출해도 되는지 판정. */
export function reviewLumosRequest(request: LumosRequest): Promise<BotReview> {
  return post<BotReview>("/api/finance/lumos-review", { request });
}
