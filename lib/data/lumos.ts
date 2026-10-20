import { createClient } from "@/lib/transport";
import type { LumosRequest, LumosResponse, LumosUploadPlan } from "@/lib/lumos/types";

async function lumosFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store" });
  const result = (await response.json() as any);
  if (!response.ok) throw new Error(result.error?.message || result.error || "Lumos 요청을 처리하지 못했습니다.");
  return result as T;
}

export function fetchLumosRequests(): Promise<LumosResponse> {
  return lumosFetch<LumosResponse>("/api/lumos");
}

export async function saveLumosRequest(request: LumosRequest): Promise<LumosRequest> {
  const result = await lumosFetch<{ request: LumosRequest }>("/api/lumos", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ request }),
  });
  return result.request;
}

export async function addLumosMessage(requestId: string, text: string, bot = false): Promise<LumosRequest> {
  const result = await lumosFetch<{ request: LumosRequest }>("/api/lumos", {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "message", requestId, text, bot }),
  });
  return result.request;
}

export async function uploadLumosDocument(requestId: string, requirementKey: string, file: File): Promise<LumosRequest> {
  const data = new FormData(); data.set("requestId", requestId); data.set("requirementKey", requirementKey); data.set("file", file);
  return (await lumosFetch<{ request: LumosRequest }>("/api/lumos/documents", { method: "POST", body: data })).request;
}

export async function deleteLumosDocument(requestId: string, documentId: string): Promise<LumosRequest> {
  return (await lumosFetch<{ request: LumosRequest }>("/api/lumos/documents", {
    method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestId, documentId }),
  })).request;
}
