import { env } from "cloudflare:workers";
import { readRows, putStatement } from "./records";
import { financeToLumosRequests, mergeLumosRequests, validateLumosRequest, validateLumosTransition } from "@/lib/lumos/validation";
import type { LumosRequest } from "@/lib/lumos/types";
import { getRequirements } from "@/lib/lumos/catalog";
import { assignRequirement } from "@/lib/lumos/evidenceAssign";
export async function projectSettings(owner: string) { const rows = await readRows(env.DB!, owner, "app_settings"); return rows.find(row => row.key === "project")?.value ?? {}; }
export async function loadRequests(owner: string): Promise<LumosRequest[]> {
    const [cards, bank, splits, saved, links, files, project] = await Promise.all([readRows(env.DB!, owner, "card_charges"), readRows(env.DB!, owner, "bank_transactions"), readRows(env.DB!, owner, "charge_splits"), readRows(env.DB!, owner, "lumos_requests"), readRows(env.DB!, owner, "evidence_links"), readRows(env.DB!, owner, "finance_evidence"), projectSettings(owner)]);
    const history = financeToLumosRequests(cards, bank, splits).map(request => {
        const parent = request.details?.financeParent;
        request.projectId = project.id || "";
        request.year = project.startDate ? Math.max(1, new Date(request.requestedAt).getFullYear() - Number(project.startDate.slice(0, 4)) + 1) : 1;
        const requirements = getRequirements(request);
        request.documents = links.filter(link => parent && link[parent.kind === "card" ? "card_charge_id" : "bank_tx_id"] === parent.id).flatMap(link => { const file = files.find(file => file.id === link.evidence_id); return file ? [{ id: `finance:${file.id}`, name: file.file_name, requirementKey: assignRequirement(file.file_name, requirements) || "", storagePath: file.storage_path, url: `/api/files?bucket=evidence&path=${encodeURIComponent(file.storage_path)}`, mimeType: file.mime_type, size: file.file_size, origin: "legacy" as const }] : []; });
        return request;
    });
    return mergeLumosRequests(history, saved.map(row => row.request as LumosRequest));
}
export async function getRequest(owner: string, id: string) { const request = (await loadRequests(owner)).find(row => row.id === id); if (!request)
    throw new Error("요청을 찾을 수 없거나 접근 권한이 없습니다."); return request; }
export async function persistRequest(owner: string, request: LumosRequest) { await putStatement(env.DB!, owner, "lumos_requests", { id: request.id, request }).run(); return request; }
export async function saveRequest(owner: string, input: unknown): Promise<LumosRequest> {
    const value = input as LumosRequest;
    if (!value || typeof value.id !== "string" || !value.id || value.id.length > 200)
        throw new Error("요청 ID를 확인하세요.");
    const previous = (await loadRequests(owner)).find(row => row.id === value.id);
    const fields = validateLumosRequest(value, previous);
    validateLumosTransition(fields, previous);
    const now = new Date().toISOString();
    return persistRequest(owner, { ...(previous || {}), ...fields, id: value.id, source: previous?.source || "pulse", sourceId: previous?.sourceId || null, author: previous?.author || owner, createdBy: previous?.createdBy || owner, updatedAt: now, documents: previous?.documents || [], messages: previous?.messages || [] });
}
