import { env } from "cloudflare:workers";
import { ownerId, apiError, sameOrigin } from "@/lib/server/auth";
import { getRequest, persistRequest } from "@/lib/server/lumos";
import { storageKey } from "@/lib/server/files";
import { validateLumosUpload } from "@/lib/lumos/validation";
import { getRequirements } from "@/lib/lumos/catalog";
export async function POST(request: Request) {
    try {
        const owner = await ownerId();
        sameOrigin(request);
        const form = await request.formData(), requestId = String(form.get("requestId") || ""), requirementKey = String(form.get("requirementKey") || "");
        const file = form.get("file");
        if (!(file instanceof File))
            throw new Error("파일이 필요합니다.");
        validateLumosUpload(file);
        const target = await getRequest(owner, requestId);
        if (!getRequirements(target).some(row => row.key === requirementKey))
            throw new Error("유효한 증빙 항목을 선택하세요.");
        const store = (env as unknown as {
            BUCKET: R2Bucket;
        }).BUCKET;
        if (!store)
            throw new Error("R2 BUCKET 연결이 필요합니다.");
        const id = crypto.randomUUID(), path = `${target.id}/${id}`;
        const key = storageKey(owner, "lumos-documents", path);
        await store.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type || "application/octet-stream" } });
        target.documents.push({ id, name: file.name, requirementKey, storagePath: path, url: `/api/files?bucket=lumos-documents&path=${encodeURIComponent(path)}`, mimeType: file.type, size: file.size, origin: "upload" });
        try {
            await persistRequest(owner, target);
        }
        catch (error) {
            await store.delete(key);
            throw error;
        }
        return Response.json({ request: target });
    }
    catch (error) {
        return apiError(error);
    }
}
export async function DELETE(request: Request) { try {
    const owner = await ownerId();
    sameOrigin(request);
    const body = (await request.json() as any), target = await getRequest(owner, body.requestId), document = target.documents.find(row => row.id === body.documentId && row.origin === "upload");
    if (!document)
        throw new Error("직접 올린 파일만 삭제할 수 있습니다.");
    target.documents = target.documents.filter(row => row.id !== document.id);
    await persistRequest(owner, target);
    if (document.storagePath)
        await (env as unknown as {
            BUCKET: R2Bucket;
        }).BUCKET.delete(storageKey(owner, "lumos-documents", document.storagePath));
    return Response.json({ request: target });
}
catch (error) {
    return apiError(error);
} }
