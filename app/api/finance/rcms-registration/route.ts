import { env } from "cloudflare:workers";
import { ownerId, apiError, sameOrigin } from "@/lib/server/auth";
import { getRequest } from "@/lib/server/lumos";
async function handle(request: Request) { try {
    const owner = await ownerId();
    sameOrigin(request);
    const config = env as unknown as Record<string, string>, base = config.RCMS_ADAPTER_URL || process.env.RCMS_ADAPTER_URL, token = config.RCMS_ADAPTER_TOKEN || process.env.RCMS_ADAPTER_TOKEN;
    if (!base || !token)
        return Response.json({ error: "사용자 소유 RCMS 실행기의 RCMS_ADAPTER_URL과 RCMS_ADAPTER_TOKEN을 서버에 설정하세요." }, { status: 503 });
    const body = request.method === "GET" ? { requestId: new URL(request.url).searchParams.get("requestId") } : (await request.json() as any);
    await getRequest(owner, body.requestId);
    const response = await fetch(`${base.replace(/\/$/, "")}/registration`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ ...body, operation: request.method === "GET" ? "state" : "start", owner }), signal: AbortSignal.timeout(20000) });
    return Response.json((await response.json() as any), { status: response.status });
}
catch (error) {
    return apiError(error);
} }
export const GET = handle;
export const POST = handle;
