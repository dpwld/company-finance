import type { LumosRequest } from "./types";
import { getBranches, getMissingEvidence, matchesBranch } from "./catalog";

export type LumosRequestFields = Pick<LumosRequest,
  "type" | "title" | "projectId" | "status" | "category" | "item" | "group" |
  "receiptType" | "cashAmount" | "inKindAmount" | "requestedAt" | "assignee" | "year" | "notes">;

export function validateLumosRequest(input: unknown, previous?: LumosRequest): LumosRequestFields {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("요청 내용을 확인하세요.");
  const value = input as Record<string, unknown>;
  const preserved = (key: keyof LumosRequest) => Boolean(previous && previous.source !== "pulse" && value[key] === previous[key]);
  const text = (key: string, max = 300, required = false) => {
    const raw = value[key] ?? "";
    if (typeof raw !== "string" || raw.length > max || (required && !raw.trim())) throw new Error(`${key} 입력값을 확인하세요.`);
    return raw.trim();
  };
  const amount = (key: "cashAmount" | "inKindAmount") => {
    const raw = value[key];
    if (typeof raw !== "number" || !Number.isFinite(raw) || (raw < 0 && !(previous && previous.source !== "pulse" && raw === previous[key])) || Math.abs(raw) > Number.MAX_SAFE_INTEGER) throw new Error("금액은 0 이상의 유효한 숫자여야 합니다.");
    return raw;
  };
  const requestedAt = text("requestedAt", 40, !preserved("requestedAt"));
  const date = requestedAt.slice(0, 10);
  if (!preserved("requestedAt") && (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(requestedAt) ||
    !Number.isFinite(Date.parse(requestedAt)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date))
    throw new Error("유효한 요청일을 입력하세요.");
  const type = value.type;
  if (type !== "fund-request" && type !== "agreement-change" && type !== "general") throw new Error("요청 유형을 확인하세요.");
  const year = value.year;
  if (typeof year !== "number" || !Number.isInteger(year) || (!preserved("year") && (year < 1 || year > 3))) throw new Error("연도를 확인하세요.");
  return {
    type, title: text("title", 500, true), projectId: text("projectId", 200, true),
    status: text("status", 100, !preserved("status")), category: text("category"), item: text("item"),
    group: text("group"), receiptType: text("receiptType"), cashAmount: amount("cashAmount"),
    inKindAmount: amount("inKindAmount"), requestedAt, assignee: text("assignee"), year,
    notes: text("notes", 20000),
  };
}

export function validateLumosMessage(input: unknown): string {
  if (typeof input !== "string" || !input.trim() || input.length > 10000) throw new Error("메시지는 1~10,000자로 입력하세요.");
  return input.trim();
}

export function validateLumosUpload(file: { name: string; size: number }): void {
  if (typeof file.name !== "string" || !file.name.trim() || file.name.length > 255 || /[\x00-\x1f\x7f/\\]/.test(file.name))
    throw new Error("파일 이름에 경로 또는 제어 문자를 사용할 수 없습니다.");
  if (!/\.(pdf|png|jpe?g|gif|webp|heic|hwp|hwpx|docx?|xlsx?|pptx?|csv|txt|zip)$/i.test(file.name))
    throw new Error("PDF, 이미지, 한글, Office 문서, CSV, TXT, ZIP 파일을 첨부하세요.");
  if (!Number.isFinite(file.size) || file.size <= 0 || file.size >= 20 * 1024 * 1024)
    throw new Error("첨부 파일은 0바이트 초과, 20MB 미만이어야 합니다.");
}

type Row = Record<string, unknown>;
const str = (value: unknown) => typeof value === "string" ? value : "";
const num = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;

/** Read-through of finance history: a split replaces its parent, never adds to it. */
export function financeToLumosRequests(cards: Row[], banks: Row[], splits: Row[]): LumosRequest[] {
  const result: LumosRequest[] = [];
  for (const [kind, rows] of [["card", cards], ["bank", banks]] as const) {
    for (const row of rows) {
      const children = splits.filter(split => split[kind === "card" ? "card_charge_id" : "bank_tx_id"] === row.id);
      for (const child of children.length ? children : [null]) {
        const sourceId = child ? `split:${child.id}` : `${kind}:${row.id}`;
        const requestedAt = str(kind === "card" ? row.approval_date || row.purchase_date : row.tx_date) || str(row.created_at);
        const status = child ? str(child.status) : str(row.status);
        const item = str(child?.label) || str(kind === "card" ? row.item_name : row.memo);
        const counterparty = str(kind === "card" ? row.merchant : row.counterparty);
        result.push({
          id: `finance:${sourceId}`, source: "finance", sourceId, type: "fund-request",
          title: [item, counterparty].filter(Boolean).join(" · ") || "Finance 거래",
          projectId: "", status, originalStatus: status,
          category: str(child?.classification) || str(kind === "card" ? row.classification : row.category),
          item, group: str(child?.spend_category) || str(row.spend_category),
          receiptType: kind === "card" ? "카드" : "계좌이체",
          cashAmount: num(child ? child.amount : kind === "card" ? row.amount : (num(row.withdrawal) !== 0 ? row.withdrawal : row.deposit)),
          inKindAmount: 0, requestedAt, updatedAt: str(row.updated_at) || requestedAt,
          assignee: "", author: "", createdBy: null,
          year: requestedAt ? 1 : 0,
          notes: str(child?.remarks) || str(kind === "card" ? row.remarks : row.tips_note) || str(row.description),
          documents: [], messages: [], sourceUrl: "/finance", details: { financeParent: { kind, id: String(row.id) } },
        });
      }
    }
  }
  return result;
}

/** Source identity survives an override even when its persisted row has another ID. */
export function mergeLumosRequests(history: LumosRequest[], saved: LumosRequest[], financeAvailable = true): LumosRequest[] {
  const currentFinance = new Map(history.filter(request => request.source === "finance").map(request => [request.sourceId, request]));
  const records = new Map<string, LumosRequest>();
  for (const request of history) {
    const key = request.sourceId ? `${request.source}:${request.sourceId}` : request.id;
    records.set(key, { ...request, documents: [...request.documents], messages: [...request.messages] });
  }
  for (const request of saved) {
    const key = request.sourceId ? `${request.source}:${request.sourceId}` : request.id;
    const current = request.source === "finance" ? currentFinance.get(request.sourceId) : undefined;
    const lineage = current?.details?.financeParent ?? request.details?.financeParent;
    // Source archive URLs may be replaced after a request was first saved in Pulse.
    const source = request.source === "lumos" ? records.get(key) : undefined;
    records.set(key, { ...request,
      documents: [...new Map([...request.documents, ...(source?.documents ?? [])].map(document => [document.id, document])).values()],
      messages: [...new Map([...request.messages, ...(source?.messages ?? [])].map(message => [message.id, message])).values()],
      ...(request.source === "finance" && financeAvailable ? { superseded: !current } : {}),
      ...(lineage ? { details: { ...request.details, financeParent: lineage } } : {}),
    });
  }
  return [...records.values()].sort((a, b) => b.requestedAt.localeCompare(a.requestedAt) || a.id.localeCompare(b.id));
}

/** Always read through the API's page boundary; a failed page must not become partial success. */
export async function readLumosPages<T>(read: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += 500) {
    const page = await read(from, from + 499);
    if (page.error) throw page.error;
    rows.push(...(page.data ?? []));
    if (!page.data || page.data.length < 500) return rows;
  }
}

/** Only stored evidence can satisfy a review request; client document claims are ignored. */
export function validateLumosTransition(fields: LumosRequestFields, previous?: LumosRequest): void {
  if (previous && previous.source !== "pulse" && fields.status === previous.status) {
    const materialFields: (keyof LumosRequestFields)[] = ["type", "title", "projectId", "category", "item", "group", "receiptType", "cashAmount", "inKindAmount", "requestedAt", "year"];
    // Notes/assignee changes preserve imported review history; changed request facts require fresh validation.
    if (fields.status !== "검수 요청" || !materialFields.some(key => fields[key] !== previous[key])) return;
  }
  if (fields.status !== "작성중" && fields.status !== "검수 요청")
    throw new Error("요청 상태는 작성중 또는 검수 요청으로만 변경할 수 있습니다.");
  if (fields.status !== "검수 요청" || fields.type === "general") return;
  const known = getBranches(fields.type).some(branch => matchesBranch(branch, fields));
  if (!known) throw new Error("비목·세목·항목을 선택한 뒤 검수를 요청하세요.");
  if (fields.type === "fund-request" && !fields.receiptType) throw new Error("증빙 유형을 선택한 뒤 검수를 요청하세요.");
  const missing = getMissingEvidence({ ...fields, documents: previous?.documents ?? [] });
  if (missing.length) throw new Error(`필수 서류를 첨부한 뒤 검수를 요청하세요: ${missing.map(requirement => requirement.name).join(", ")}`);
}
