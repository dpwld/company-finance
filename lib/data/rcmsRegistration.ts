import type { RcmsJob, RcmsLaunch, RcmsRegistrationState } from "@/lib/rcms/types";

const endpoint = "/api/finance/rcms-registration";
async function companionUrl() { const { fetchAppSetting } = await import("@/lib/data/settings"); const value = await fetchAppSetting("rcms_companion_url"); if(!value) throw new Error("설정에서 사용자 RCMS 실행기 주소를 입력하세요."); const url = new URL(value); if(!["http:","https:"].includes(url.protocol)) throw new Error("실행기 주소를 확인하세요."); return value.replace(/\/$/, ""); }

async function dashboardResponse<T>(response: Response): Promise<T> {
  const value = (await response.json().catch(() => ({})) as any);
  if (!response.ok) throw new Error(value.error?.message || value.error || value.detail || "RCMS 등록 상태를 확인하지 못했습니다.");
  return value as T;
}

export async function getRcmsRegistrationState(requestId: string): Promise<RcmsRegistrationState> {
  const response = await fetch(`${endpoint}?requestId=${encodeURIComponent(requestId)}`, { cache: "no-store" });
  return dashboardResponse<RcmsRegistrationState>(response);
}

export async function startRcmsRegistration(requestId: string, verificationOnly = false): Promise<{ job: RcmsJob; launch: RcmsLaunch }> {
  const response = await fetch(endpoint, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestId, ...(verificationOnly ? { verificationOnly: true } : {}) }),
  });
  return dashboardResponse<{ job: RcmsJob; launch: RcmsLaunch }>(response);
}

export async function getRcmsAgentHealth(): Promise<{ ok: boolean; busy: boolean; error: string | null }> {
  const response = await fetch(`${await companionUrl()}/health`, { cache: "no-store", signal: AbortSignal.timeout(3000) });
  if (!response.ok) throw new Error("이 Mac의 RCMS 실행기에 연결할 수 없습니다.");
  return response.json();
}

export async function launchRcmsAgent(launch: RcmsLaunch): Promise<void> {
  const response = await fetch(`${await companionUrl()}/run`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(launch),
  });
  if (!response.ok) throw new Error("이 Mac의 RCMS 실행기가 작업을 시작하지 못했습니다. 실행기를 확인한 뒤 다시 시도해 주세요.");
}
