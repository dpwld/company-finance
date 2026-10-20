import { createClient } from "@/lib/transport";
import { collectPages, identicalEvidence } from "@/lib/finance/evidenceIntegrity";

/* Private receipt files and owner-scoped transaction links. */

export interface EvidenceFile {
  id: string;
  month: string;
  storagePath: string;
  fileName: string;
  mimeType: string;
  fileSize: number | null;
  summary: string;
  uploadedBy: string;
  createdAt: string;
}

export interface EvidenceLink {
  evidenceId: string;
  /** exactly one of the two targets is set */
  cardChargeId: string | null;
  bankTxId: string | null;
  matchedBy: "name" | "ai" | "manual";
  note: string;
}

export type EvidenceTarget = { cardChargeId: string } | { bankTxId: string };

function mapFile(r: Record<string, unknown>): EvidenceFile {
  return {
    id: r.id as string,
    month: r.month as string,
    storagePath: r.storage_path as string,
    fileName: r.file_name as string,
    mimeType: (r.mime_type as string) ?? "",
    fileSize: (r.file_size as number) ?? null,
    summary: (r.summary as string) ?? "",
    uploadedBy: (r.uploaded_by as string) ?? "",
    createdAt: r.created_at as string,
  };
}

export async function fetchEvidence(month: string, scope: { cards: string[]; bank: string[]; evidence?: string[] } = { cards: [], bank: [] }): Promise<{ files: EvidenceFile[]; links: EvidenceLink[] }> {
  const sb = createClient();
  const monthFiles = await collectPages<Record<string, any>>((from, to) => sb.from("finance_evidence").select("*").eq("month", month).order("id").range(from, to));
  const fileMap = new Map(monthFiles.map((r) => [r.id as string, mapFile(r)]));
  const linkedIds = new Set<string>((scope.evidence ?? []).filter((id) => !fileMap.has(id)));
  for (const [column, ids] of [["card_charge_id", scope.cards], ["bank_tx_id", scope.bank]] as const) {
    for (let i = 0; i < ids.length; i += 100) {
      const rows = await collectPages<Record<string, any>>((from, to) => sb.from("evidence_links").select("evidence_id").in(column, ids.slice(i, i + 100)).order("evidence_id").range(from, to));
      for (const row of rows) if (!fileMap.has(row.evidence_id)) linkedIds.add(row.evidence_id);
    }
  }
  const extraIds = [...linkedIds];
  for (let i = 0; i < extraIds.length; i += 100) {
    const { data, error } = await sb.from("finance_evidence").select("*").in("id", extraIds.slice(i, i + 100));
    if (error) throw error;
    for (const r of data ?? []) fileMap.set(r.id, mapFile(r));
  }
  const files = [...fileMap.values()].sort((a, b) => a.fileName.localeCompare(b.fileName));
  if (!files.length) return { files, links: [] };
  const linkRows: Record<string, unknown>[] = [];
  for (let i = 0; i < files.length; i += 100) {
    linkRows.push(...await collectPages<Record<string, any>>((from, to) => sb.from("evidence_links").select("*").in("evidence_id", files.slice(i, i + 100).map((f) => f.id))
      .order("evidence_id").order("card_charge_id").order("bank_tx_id").range(from, to)));
  }
  const links = linkRows.map((r) => ({
    evidenceId: r.evidence_id as string,
    cardChargeId: (r.card_charge_id as string) ?? null,
    bankTxId: (r.bank_tx_id as string) ?? null,
    matchedBy: r.matched_by as EvidenceLink["matchedBy"],
    note: (r.note as string) ?? "",
  }));
  return { files, links };
}

/** Reuse byte-identical files across months, including renamed copies. */
export async function uploadEvidence(file: File, month: string, uploadedBy: string): Promise<EvidenceFile> {
  const sb = createClient();
  // macOS에서 온 파일명은 NFD(자모 분리)라 한글 비교가 전부 어긋난다 — 저장 전에 NFC로 맞춘다.
  const fileName = file.name.normalize("NFC");
  const candidates = await collectPages<Record<string, any>>((from, to) => sb.from("finance_evidence").select("*").eq("file_size", file.size).order("id").range(from, to));
  const existing = await identicalEvidence(file, candidates.map(mapFile), async (path) => {
    const { data, error } = await sb.storage.from("evidence").download(path);
    if (error || !data) throw error ?? new Error("Evidence download failed");
    return data;
  });
  if (existing) return existing;

  // Supabase Storage keys must be ASCII-safe — tildes, commas and Hangul are
  // rejected ("Invalid key"). Sanitise the KEY only; the original file.name is
  // kept in the row below for display and filename matching.
  const safe = fileName.replace(/[^\w.-]+/g, "_");
  const path = `${month}/${crypto.randomUUID().slice(0, 8)}_${safe}`;
  const up = await sb.storage.from("evidence").upload(path, file, { contentType: file.type || undefined });
  if (up.error) throw up.error;

  const ins = await sb.from("finance_evidence").insert({
    month,
    storage_path: path,
    file_name: fileName,
    mime_type: file.type,
    file_size: file.size,
    uploaded_by: uploadedBy,
  }).select("*").single();
  if (ins.error) {
    await sb.storage.from("evidence").remove([path]);
    throw ins.error;
  }
  return mapFile(ins.data as Record<string, unknown>);
}

export async function linkEvidence(evidenceId: string, target: EvidenceTarget, matchedBy: EvidenceLink["matchedBy"], note = ""): Promise<void> {
  const row: Record<string, unknown> = { evidence_id: evidenceId, matched_by: matchedBy, note };
  if ("cardChargeId" in target) row.card_charge_id = target.cardChargeId;
  else row.bank_tx_id = target.bankTxId;
  const { error } = await createClient().from("evidence_links").insert(row);
  if (error && error.code !== "23505") throw error; // duplicate link = already there
}

export async function unlinkEvidence(evidenceId: string, target: EvidenceTarget): Promise<void> {
  let q = createClient().from("evidence_links").delete().eq("evidence_id", evidenceId);
  q = "cardChargeId" in target ? q.eq("card_charge_id", target.cardChargeId) : q.eq("bank_tx_id", target.bankTxId);
  const { error } = await q;
  if (error) throw error;
}

/** 다른 달로 잘못 들어간 증빙을 옮긴다. 스토리지 경로의 월 접두사는 그냥 키라
    파일을 다시 올리지 않고 month 컬럼만 고친다 — 조회는 이 컬럼만 본다. */
export async function moveEvidenceMonth(evidenceId: string, month: string): Promise<void> {
  const { error } = await createClient().from("finance_evidence").update({ month }).eq("id", evidenceId);
  if (error) throw error;
}

export async function deleteEvidence(file: EvidenceFile): Promise<void> {
  const sb = createClient();
  const { error } = await sb.from("finance_evidence").delete().eq("id", file.id);
  if (error) throw error;
  await sb.storage.from("evidence").remove([file.storagePath]); // best-effort
}

export async function evidenceUrl(storagePath: string): Promise<string> {
  const { data, error } = await createClient().storage.from("evidence").createSignedUrl(storagePath, 3600);
  if (error) throw error;
  return data.signedUrl;
}
