import { env } from "cloudflare:workers";
import { ownerId, apiError, sameOrigin } from "@/lib/server/auth";
import { storageKey } from "@/lib/server/files";
async function handle(request: Request) {
    try {
        const owner = await ownerId();
        sameOrigin(request);
        const url = new URL(request.url), path = url.searchParams.get("path") || "", bucket = url.searchParams.get("bucket") || "";
        const key = storageKey(owner, bucket, path);
        const store = (env as unknown as {
            BUCKET: R2Bucket;
        }).BUCKET;
        if (!store)
            return Response.json({ error: { message: "R2 BUCKET 연결이 필요합니다. 파일 저장소를 설정하세요." } }, { status: 503 });
        if (request.method === "PUT") {
            const body = await request.arrayBuffer();
            if (!body.byteLength || body.byteLength > 20 * 1024 * 1024)
                throw new Error("파일은 1바이트~20MB로 올려주세요.");
            if (await store.head(key))
                throw new Error("같은 경로의 파일이 이미 있습니다.");
            await store.put(key, body, { httpMetadata: { contentType: request.headers.get("content-type") || "application/octet-stream" } });
            return Response.json({ path });
        }
        if (request.method === "DELETE") {
            await store.delete(key);
            return Response.json({ deleted: true });
        }
        const file = await store.get(key);
        if (!file)
            return new Response("파일 없음", { status: 404 });
        return new Response(file.body, { headers: { "Content-Type": file.httpMetadata?.contentType || "application/octet-stream", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Disposition": "attachment" } });
    }
    catch (error) {
        return apiError(error);
    }
}
export const GET = handle;
export const PUT = handle;
export const DELETE = handle;
