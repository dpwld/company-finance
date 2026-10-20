import { projectSettings } from "@/lib/server/lumos";
import { observeAi } from "@/lib/server/observe";
import { NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@/lib/server/client";
import { env } from "cloudflare:workers";
import { ownerId, sameOrigin } from "@/lib/server/auth";
import { logAiCall } from "@/lib/ai/logging";
import { tipsGuide } from "@/lib/server/client";
import { getBranches, getRequirements, isRequirementRequired } from "@/lib/lumos/catalog";
import { assignRequirement } from "@/lib/lumos/evidenceAssign";
import { financeToLumosRequests } from "@/lib/lumos/validation";

/* Finance bot ① — TIPS 거래 한 건으로 업무요청 초안을 만든다.
   비목·세목·항목은 자유 입력을 허용하면 검수 단계에서 "비목·세목·항목을 선택한 뒤
   검수를 요청하세요"로 막히므로, 카탈로그 분기 중 하나를 번호로만 고르게 한다.
   필요 서류 목록은 AI가 아니라 카탈로그가 정한다. 제안일 뿐이고 확정은 사람이 한다. */

const RECEIPTS = ["세금계산서", "카드매출전표", "계좌이체", "현물", "기타"];

/** 거래 → 요청서 매핑이 화면과 서버로 갈라지지 않도록, 원본 행을 여기서 읽어
    financeToLumosRequests로 기본 요청서를 만든 뒤 AI 제안만 덮어쓴다. */
interface DraftBody {
  kind?: "card" | "bank";
  id?: string;
  /** 분할 줄이면 그 분할의 id. */
  splitId?: string;
}

async function run(request: Request) {
  try { await ownerId(); sameOrigin(request); } catch { return NextResponse.json({error:"로그인이 필요합니다."},{status:401}); }
  const settings = env as unknown as Record<string, string>;
  const OPENAI_KEY = settings.OPENAI_API_KEY || process.env.OPENAI_API_KEY || "";
  const MODEL = settings.OPENAI_MODEL || process.env.OPENAI_MODEL || "";
  if (!OPENAI_KEY || !MODEL) return NextResponse.json({error:"서버에 사용자 소유 OPENAI_API_KEY와 OPENAI_MODEL을 설정하세요."},{status:503});
  let TIPS_GUIDE: string; try { TIPS_GUIDE = await tipsGuide(); } catch (e) { return NextResponse.json({error: String((e as Error).message)},{status:503}); }

  if (!OPENAI_KEY) return NextResponse.json({ error: "OPENAI_API_KEY not set" }, { status: 503 });

  const supabase = await createClient();

  let body: DraftBody;
  try {
    body = (await request.json() as any);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const kind = body.kind === "bank" ? "bank" : "card";
  if (!body.id) return NextResponse.json({ error: "no_id" }, { status: 400 });

  const table = kind === "card" ? "card_charges" : "bank_transactions";
  const { data: row, error: rowError } = await supabase.from(table).select("*").eq("id", body.id).single();
  if (rowError || !row) return NextResponse.json({ error: "row_not_found" }, { status: 404 });
  const { data: splitRows } = await supabase.from("charge_splits").select("*")
    .eq(kind === "card" ? "card_charge_id" : "bank_tx_id", body.id);
  const splits = (splitRows ?? []).filter((s: any) => !body.splitId || s.id === body.splitId);

  const base = financeToLumosRequests(kind === "card" ? [row] : [], kind === "bank" ? [row] : [], splits)[0];
  if (!base) return NextResponse.json({ error: "map_failed" }, { status: 500 });

  // 이 거래에 붙어 있는 증빙 파일명 — 비목 판단의 가장 강한 단서다.
  const { data: linkRows } = await supabase.from("evidence_links").select("evidence_id")
    .eq(kind === "card" ? "card_charge_id" : "bank_tx_id", body.id);
  const evidenceIds = (linkRows ?? []).map((l: any) => l.evidence_id as string);
  const { data: fileRows } = evidenceIds.length
    ? await supabase.from("finance_evidence").select("id,file_name,storage_path,mime_type,file_size").in("id", evidenceIds)
    : { data: [] as Record<string, unknown>[] };
  const files = (fileRows ?? []).slice(0, 20);
  const evidence = files.map((f: any) => String(f.file_name));
  /* 해외 결제는 원화 승인금액이 나중에 확정된다(결제예정금액조회 업로드 시점).
     그 전에는 amount가 비어 0원으로 보이므로, 외화 표기를 함께 돌려줘
     화면에서 "원화 미확정"으로 알리고 직접 입력받게 한다. */
  const cardMeta = (kind === "card" ? (row.card_meta as Record<string, string> | null) : null) ?? {};
  const amountUnknown = kind === "card" && row.amount == null;
  const fxAmount = amountUnknown ? (cardMeta["해외승인금액"] || null) : null;

  const project = await projectSettings(await ownerId());
  base.projectId = project.id || "";
  base.year = project.startDate ? Math.max(1,Number(base.requestedAt.slice(0,4))-Number(project.startDate.slice(0,4))+1) : 1;
  const source = base;
  const type = source.type === "agreement-change" ? "agreement-change" : "fund-request";
  const branches = getBranches(type);
  if (!branches.length) return NextResponse.json({ error: "no_branches" }, { status: 500 });
  const menu = branches.map((b, i) => `${i}. ${b.category} / ${b.item || "-"} / ${b.group}`).join("\n");

  const SCHEMA = {
    type: "object",
    additionalProperties: false,
    properties: {
      branchIndex: { type: "integer" },
      receiptType: { type: "string", enum: RECEIPTS },
      title: { type: "string" },
      notes: { type: "string" },
      reason: { type: "string" },
      eligible: { type: "boolean" },
    },
    required: ["branchIndex", "receiptType", "title", "notes", "reason", "eligible"],
  } as const;

  const SYSTEM = `당신은 사용자 사업체(the user)의 TIPS 연구비 담당자입니다. 거래 한 건을 RCMS 업무요청서 초안으로 바꾸세요.

branchIndex — 아래 목록에서 이 거래에 맞는 번호 하나를 고릅니다. 목록 밖의 값은 쓸 수 없습니다.
${menu}

receiptType — 증빙 유형. 세금계산서를 받은 거래면 "세금계산서", 법인카드 결제면 "카드매출전표", 계좌이체면 "계좌이체".
title — 무엇을 왜 샀는지 드러나는 15자 내외 한국어 제목.
notes — 요청 내용. 과제와 어떻게 관련되는지 1~2문장으로. 점검기관이 읽는다고 생각하고 쓰세요.
reason — 그 비목을 고른 근거 한 문장.
eligible — TIPS 연구비로 집행 가능해 보이면 true, 불인정 항목으로 보이면 false.

판정 기준:
__USER_TIPS_GUIDE__`;

  const facts = [
    `거래명: ${source.title || "-"}`,
    `품목: ${source.item || "-"}`,
    `금액: ${(source.cashAmount ?? 0).toLocaleString("ko-KR")}원`,
    `거래일: ${(source.requestedAt || "").slice(0, 10) || "-"}`,
    `기존 분류: ${source.category || "-"} / ${source.group || "-"}`,
    `비고: ${source.notes || "-"}`,
    `첨부 증빙: ${evidence.join("; ") || "없음"}`,
  ].join("\n");

  try {
    const openai = new OpenAI({ apiKey: OPENAI_KEY });
    const completion = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM.replace("__USER_TIPS_GUIDE__", TIPS_GUIDE) },
        { role: "user", content: facts },
      ],
      response_format: { type: "json_schema", json_schema: { name: "lumos_draft", strict: true, schema: SCHEMA } },
    });
    const raw = completion.choices[0]?.message?.content;
    if (!raw) throw new Error("Empty completion");
    const out = JSON.parse(raw) as { branchIndex: number; receiptType: string; title: string; notes: string; reason: string; eligible: boolean };

    const branch = branches[out.branchIndex] ?? branches[0];
    const draft = {
      category: branch.category,
      item: branch.item === "-" ? "" : branch.item,
      group: branch.group,
      receiptType: RECEIPTS.includes(out.receiptType) ? out.receiptType : "기타",
      title: out.title.slice(0, 120),
      notes: out.notes.slice(0, 2000),
    };
    // 필요 서류는 AI가 아니라 카탈로그가 정한다 — 검수 단계와 같은 기준이어야 한다.
    /* 이미 Finance에 붙어 있는 증빙을 필요 서류 칸에 배정해 화면에 보여준다.
       저장 자체는 서버 읽기 경로가 같은 규칙으로 다시 붙이므로, 여기 값은 표시용. */
    const catalogRequirements = getRequirements({ type, ...draft });
    const documents = files.map((f: any) => ({
      id: `finance:${String(f.id)}`,
      name: String(f.file_name),
      requirementKey: assignRequirement(String(f.file_name), catalogRequirements) ?? "",
      storagePath: String(f.storage_path ?? ""),
      mimeType: String(f.mime_type ?? "application/octet-stream"),
      size: Number(f.file_size ?? 0),
      origin: "legacy" as const,
    }));
    const requirements = catalogRequirements.map((r: any) => ({
      key: r.key, name: r.name, mode: r.mode, description: r.description,
      required: isRequirementRequired(r, draft.receiptType),
    }));

    const logId = await logAiCall({
      tool: "finance",
      model: MODEL,
      input: { lumosDraft: source.title, evidence: evidence.length },
      output: out,
    });
    return NextResponse.json({
      request: { ...base, ...draft, type, status: "작성중", documents },
      requirements, reason: out.reason, eligible: out.eligible,
      amountUnknown, fxAmount, _logId: logId,
    });
  } catch (err) {
    console.error("lumos draft failed:", err);
    const raw = err instanceof OpenAI.APIError ? `openai_${err.status}_${err.code ?? ""}` : String((err as Error)?.message ?? "");
    return NextResponse.json({ error: "draft_failed", detail: raw.replace(/sk-[A-Za-z0-9_-]{4,}/g, "sk-***").slice(0, 80) }, { status: 502 });
  }
}

export async function POST(request: Request) { return observeAi("lumos-draft", () => run(request)); }
