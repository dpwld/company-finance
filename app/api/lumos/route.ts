import { ownerId, apiError, sameOrigin } from "@/lib/server/auth";
import { loadRequests, saveRequest, getRequest, persistRequest } from "@/lib/server/lumos";
import { validateLumosMessage } from "@/lib/lumos/validation";
export async function GET() { try {
    return Response.json({ requests: await loadRequests(await ownerId()), budgetSnapshots: [], warnings: [] });
}
catch (error) {
    return apiError(error);
} }
export async function POST(request: Request) { try {
    const owner = await ownerId();
    sameOrigin(request);
    return Response.json({ request: await saveRequest(owner, ((await request.json() as any)).request) });
}
catch (error) {
    return apiError(error);
} }
export async function PATCH(request: Request) { try {
    const owner = await ownerId();
    sameOrigin(request);
    const body = (await request.json() as any);
    if (body.action !== "message")
        throw new Error("지원하지 않는 작업입니다.");
    const target = await getRequest(owner, body.requestId);
    const text = validateLumosMessage(body.text);
    target.messages.push({ id: crypto.randomUUID(), author: owner, text, createdAt: new Date().toISOString(), kind: "message" });
    return Response.json({ request: await persistRequest(owner, target) });
}
catch (error) {
    return apiError(error);
} }
