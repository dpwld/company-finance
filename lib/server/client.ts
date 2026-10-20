import { env } from "cloudflare:workers";
import { Builder } from "@/lib/transport";
import { executeQuery, readRows } from "./records";
import { ownerId } from "./auth";
import { storageKey } from "./files";
export async function createClient() {
    const owner = await ownerId();
    return {
        from: (table: string) => new Builder(table, async (query) => { try {
            return { data: await executeQuery(env.DB!, owner, query), error: null };
        }
        catch (error) {
            return { data: null, error: { message: error instanceof Error ? error.message : "저장 실패" } };
        } }),
        storage: { from: (bucket: string) => ({ async download(path: string) { const store = (env as unknown as {
                    BUCKET: R2Bucket;
                }).BUCKET; if (!store)
                    return { data: null, error: new Error("R2 BUCKET 연결이 필요합니다.") }; const file = await store.get(storageKey(owner, bucket, path)); return file ? { data: new Blob([await file.arrayBuffer()], { type: file.httpMetadata?.contentType }), error: null } : { data: null, error: new Error("파일 없음") }; } }) },
    };
}
export async function tipsGuide() { const owner = await ownerId(); const settings = await readRows(env.DB!, owner, "app_settings"); const guide = settings.find(row => row.key === "tips_guide")?.value?.v; if (!guide)
    throw new Error("설정에서 사용자 과제의 TIPS 판정 가이드를 입력하세요."); return String(guide); }
