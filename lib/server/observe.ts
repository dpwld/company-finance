import { env } from "cloudflare:workers";
import { ownerId } from "./auth";
import { putStatement } from "./records";
/** Request activity survives reloads; provider failures are never reported as completed jobs. */
export async function observeAi(operation: string, run: () => Promise<Response>): Promise<Response> {
    let owner: string;
    try {
        owner = await ownerId();
    }
    catch {
        return Response.json({ error: "로그인이 필요합니다." }, { status: 401 });
    }
    const row = { id: crypto.randomUUID(), operation, status: "running", created_at: new Date().toISOString() };
    await putStatement(env.DB!, owner, "ai_jobs", row).run();
    try {
        const response = await run();
        await putStatement(env.DB!, owner, "ai_jobs", { ...row, status: response.ok ? "completed" : "failed", error: response.ok ? "" : `HTTP ${response.status}`, updated_at: new Date().toISOString() }).run();
        return response;
    }
    catch {
        await putStatement(env.DB!, owner, "ai_jobs", { ...row, status: "failed", error: "서버 또는 제공자 요청 실패", updated_at: new Date().toISOString() }).run();
        return Response.json({ error: "AI 요청을 처리하지 못했습니다. 서버 설정과 제공자 연결을 확인하세요." }, { status: 502 });
    }
}
