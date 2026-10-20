import { tipsGuide } from "@/lib/server/client";
import { observeAi } from "@/lib/server/observe";
import { NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@/lib/server/client";
import { env } from "cloudflare:workers";
import { ownerId, sameOrigin } from "@/lib/server/auth";
import { logAiCall } from "@/lib/ai/logging";

/* 영수증 분할 (vision) — 거래에 연결된 증빙(영수증 이미지/PDF)에서 상품
   라인아이템을 추출하고 항목별 지출 카테고리를 제안한다. 쿠팡·다이소처럼
   한 결제에 여러 성격의 물품이 섞인 경우용. 결과는 화면에서 수정 후 확정. */


const CATEGORY_KEYS = [
  "payroll", "equipment", "software", "office", "supplies", "dining", "travel",
  "marketing", "legal", "fees", "taxes", "welfare", "etc",
];

const SYSTEM = `You read a Korean receipt (image or PDF) for a the user corporate-card purchase and split it into line items.

For each product line on the receipt output: label (상품명, 한국어 그대로 요약), amount (KRW 정수, 그 항목의 결제 금액: 수량 반영), category, 그리고 TIPS 연구비 판정 2개(status, note).
Categories (KEY exactly): equipment(장비·자재·공구), software(SW·IT기기·케이블·주변기기), office(임차·관리비·인테리어), supplies(사무용품·문구·용지·비품·청소용품·생활용품), dining(식품·간식·음료), travel(교통·주유), marketing(홍보물), legal(도서·전문서비스), fees(수수료), taxes(공과금), welfare(복리후생·의약품), payroll(급여성), etc(그 외).

Rules:
- 배송비·할인·포인트 사용은 별도 항목으로 넣지 말고 인접 항목에 비례 배분하지도 말 것: 대신 마지막에 잔여 차액이 생기면 UI가 처리하므로 무시.
- 금액이 안 보이면 그 항목은 제외. 항목이 하나뿐이면 그 하나만.
- total_check에 영수증의 결제 총액(보이면)을 넣어라. 안 보이면 null.

TIPS 판정 (the user는 TIPS 과제 사용자 과제 수행 기관: 항목별로 연구비 처리 가능 여부를 함께 판정):
- status: "접수완료"(연구비 처리 가능) / "처리불가(연구관련X)"(불인정) / "확인필요"(용도 확인 필요) 중 하나.
- classification: 접수완료인 항목만 비목 라벨 (예: "연구활동비/사무용품비", "연구활동비/연구실운영비", "연구재료비"). 그 외는 빈 문자열.
- note: 한 줄 근거.
판정 기준: 사무용품·문구·용지는 연구활동비/사무용품비로 접수완료. 사무용 기기(모니터·프린터·PC)는 연구실운영비 활용계획에 있어야 하므로 확인필요.
식품·간식·음료·생수는 처리불가(연구관련X). 청소·주방·생활용품은 소모성 비용이라 처리불가.
가구(책상·의자)는 확인필요. 연구용 부품·재료는 연구재료비로 접수완료.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          label: { type: "string" },
          amount: { type: "number" },
          category: { type: "string", enum: CATEGORY_KEYS },
          status: { type: "string", enum: ["접수완료", "처리불가(연구관련X)", "확인필요"] },
          classification: { type: "string" },
          note: { type: "string" },
        },
        required: ["label", "amount", "category", "status", "classification", "note"],
      },
    },
    total_check: { type: ["number", "null"] },
  },
  required: ["items", "total_check"],
};

async function run(request: Request) {
  try { await ownerId(); sameOrigin(request); } catch { return NextResponse.json({error:"로그인이 필요합니다."},{status:401}); }
  const settings = env as unknown as Record<string, string>;
  const OPENAI_KEY = settings.OPENAI_API_KEY || process.env.OPENAI_API_KEY || "";
  const MODEL = settings.OPENAI_MODEL || process.env.OPENAI_MODEL || "";
  if (!OPENAI_KEY || !MODEL) return NextResponse.json({error:"서버에 사용자 소유 OPENAI_API_KEY와 OPENAI_MODEL을 설정하세요."},{status:503});

  const supabase = await createClient();
  if (!OPENAI_KEY) return NextResponse.json({ error: "no_api_key" }, { status: 502 });

  let body: { merchant?: string; amount?: number; evidence?: { fileName: string; storagePath: string; mimeType?: string }[] };
  try {
    body = (await request.json() as any);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const evidence = (body.evidence ?? []).slice(0, 3);
  if (!evidence.length) return NextResponse.json({ error: "no_evidence" }, { status: 400 });

  // 증빙 파일을 서버에서 내려받아 vision 입력으로 (RLS: finance 권한 세션)
  const content: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
    { type: "text", text: `가맹점: ${body.merchant ?? "N/A"} · 결제 총액: ${body.amount ?? "N/A"}원. 아래 영수증을 항목별로 분할해줘.` },
  ];
  for (const ev of evidence) {
    const { data, error } = await supabase.storage.from("evidence").download(ev.storagePath);
    if (error || !data) return NextResponse.json({ error: "evidence_download_failed", detail: ev.fileName }, { status: 502 });
    const buf = Buffer.from(await data.arrayBuffer());
    const mime = ev.mimeType || data.type || "application/octet-stream";
    if (mime.startsWith("image/")) {
      content.push({ type: "image_url", image_url: { url: `data:${mime};base64,${buf.toString("base64")}` } });
    } else if (mime === "application/pdf" || ev.fileName.toLowerCase().endsWith(".pdf")) {
      content.push({
        type: "file",
        file: { filename: ev.fileName, file_data: `data:application/pdf;base64,${buf.toString("base64")}` },
      } as OpenAI.Chat.Completions.ChatCompletionContentPart);
    } else {
      return NextResponse.json({ error: "unsupported_file", detail: ev.fileName }, { status: 415 });
    }
  }

  try {
    const openai = new OpenAI({ apiKey: OPENAI_KEY });
    const completion = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM + "\n사용자의 과제별 규정(우선 적용):\n" + await tipsGuide() },
        { role: "user", content },
      ],
      response_format: { type: "json_schema", json_schema: { name: "receipt_split", strict: true, schema: SCHEMA as unknown as Record<string, unknown> } },
    });
    const raw = completion.choices[0]?.message?.content;
    if (!raw) throw new Error("Empty completion");
    const parsed = JSON.parse(raw);
    const logId = await logAiCall({
      tool: "finance",
      model: MODEL,
      input: { kind: "receipt_split", merchant: body.merchant, amount: body.amount, files: evidence.map((e) => e.fileName) },
      output: parsed,
    });
    return NextResponse.json({ ...parsed, _logId: logId });
  } catch (err) {
    console.error("receipt split failed:", err);
    const rawMsg = err instanceof OpenAI.APIError ? `openai_${err.status}_${err.code ?? ""}` : String((err as Error)?.message ?? "");
    const detail = rawMsg.replace(/sk-[A-Za-z0-9_-]{4,}/g, "sk-***").slice(0, 80);
    return NextResponse.json({ error: "split_failed", detail }, { status: 502 });
  }
}

export async function POST(request: Request) { return observeAi("receipt-split", () => run(request)); }
