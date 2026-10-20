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
            return Response.json({ error: { message: "Configure an R2 BUCKET binding to store files." } }, { status: 503 });
        if (request.method === "PUT") {
            const body = await request.arrayBuffer();
            if (!body.byteLength || body.byteLength > 20 * 1024 * 1024)
                throw new Error("Upload a file between 1 byte and 20 MB.");
            if (await store.head(key))
                throw new Error("A file already exists at this path.");
            await store.put(key, body, { httpMetadata: { contentType: request.headers.get("content-type") || "application/octet-stream" } });
            return Response.json({ path });
        }
        if (request.method === "DELETE") {
            await store.delete(key);
            return Response.json({ deleted: true });
        }
        const file = await store.get(key);
        if (!file)
            return new Response("File not found", { status: 404 });
        return new Response(file.body, { headers: { "Content-Type": file.httpMetadata?.contentType || "application/octet-stream", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Disposition": "attachment" } });
    }
    catch (error) {
        return apiError(error);
    }
}
export const GET = handle;
export const PUT = handle;
export const DELETE = handle;
