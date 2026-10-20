import { observeAi } from "@/lib/server/observe";
import { NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@/lib/server/client";
import { env } from "cloudflare:workers";
import { ownerId, sameOrigin } from "@/lib/server/auth";
import { logAiCall } from "@/lib/ai/logging";

/* Spending 카테고리 AI 분류 (Rocket Money식) — 카드/은행 거래를 지출
   카테고리로 배정한다. 증빙 파일명이 있으면 판단 근거로 함께 제공.
   결과는 제안이 아니라 바로 적용(화면에서 언제든 셀렉트로 수정 가능). */


const CATEGORY_KEYS = [
  "payroll", "equipment", "software", "office", "supplies", "dining", "travel",
  "marketing", "legal", "fees", "taxes", "welfare", "etc",
  "income", "internal", "card_payment",
];

const SYSTEM = `You classify Korean business corporate transactions into spending categories.

Categories (use the KEY exactly):
- payroll: 급여·상여·4대보험 회사부담분 급여성 이체
- equipment: 실험장비·부품·자재·공구·3D프린팅 재료 구매
- software: SW 구독(Notion·Slack·OpenAI·클라우드·Google 등)·IT기기
- office: 임차료·보증금·관리비·인테리어·청소·주차권 등 사무 공간 유지비 (사무용품 제외)
- supplies: 사무용품·소모품·비품 (문구·용지·토너·건전지·멀티탭·다이소/오피스 구매·청소용품·생활용품)
- dining: 식대·회식·간식·커피
- travel: 출장 교통·항공·숙박·주유·주차·택시
- marketing: 광고·전시회·홍보물·콘텐츠 제작
- legal: 법무·특허·회계·세무·컨설팅 수수료
- fees: 은행/카드 수수료·이자·결제대행 수수료
- taxes: 세금·공과금(전기·수도·통신 포함)
- welfare: 보험료·건강검진·복리후생
- etc: 위 어디에도 맞지 않는 지출
Special (excluded from spending):
- income: 입금 중 매출·지원금·이자수입 등 실제 수입
- internal: 자사 계좌 간 이체·환불 원복 등 내부 이동 (입출금 모두)
- card_payment: 법인카드 대금 결제 출금 (카드 지출과 이중계산 방지)

Rules:
- 은행 출금의 "KB국민카드/카드대금/신한카드" 류는 card_payment.
- 급여 추정: 매월 유사 금액의 개인명 이체, 적요에 급여/월급.
- 증빙 파일명(영수증·세금계산서 이름)이 있으면 가맹점명보다 우선하는 근거로 사용.
  파일명에 품목이 적혀 있으면(예: "0728다이소몰(사무용품)_거래명세서") 그 품목으로 분류한다.
- 가맹점명이 결제대행사(PG)면 그 이름으로 판단하지 말 것: 이니시스/KCP/KICC/NICE/갤럭시아/
  토스페이먼츠/한국정보통신/세외수입/전자상거래PG/인터넷상거래 등이 해당. 이 경우 증빙 파일명과
  명칭(itemName)으로 판단하고, 단서가 전혀 없을 때만 etc.
- 확신이 없으면 지출은 etc, 입금은 income.
Return one entry per input id.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    cards: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: { id: { type: "string" }, category: { type: "string", enum: CATEGORY_KEYS } },
        required: ["id", "category"],
      },
    },
    bank: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: { id: { type: "string" }, category: { type: "string", enum: CATEGORY_KEYS } },
        required: ["id", "category"],
      },
    },
  },
  required: ["cards", "bank"],
};

async function run(request: Request) {
  try { await ownerId(); sameOrigin(request); } catch { return NextResponse.json({error:"로그인이 필요합니다."},{status:401}); }
  const settings = env as unknown as Record<string, string>;
  const OPENAI_KEY = settings.OPENAI_API_KEY || process.env.OPENAI_API_KEY || "";
  const MODEL = settings.OPENAI_MODEL || process.env.OPENAI_MODEL || "";
  if (!OPENAI_KEY || !MODEL) return NextResponse.json({error:"서버에 사용자 소유 OPENAI_API_KEY와 OPENAI_MODEL을 설정하세요."},{status:503});

  // Finance is admin-or-granted — mirror the has_tool('finance') RLS gate here.
  const supabase = await createClient();
  if (!OPENAI_KEY) return NextResponse.json({ error: "no_api_key" }, { status: 502 });

  let body: {
    cards?: { id: string; approvalDate?: string | null; merchant?: string; industry?: string; itemName?: string; amount?: number | null; evidence?: string[] }[];
    bank?: { id: string; txDate?: string; counterparty?: string; description?: string; deposit?: number | null; withdrawal?: number | null; evidence?: string[] }[];
    /** 사용자 정의 분류 규칙 ("가맹점 이름 → office") — 프롬프트에 최우선 지침으로 포함. */
    rules?: string[];
  };
  try {
    body = (await request.json() as any);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const cards = (body.cards ?? []).slice(0, 120);
  const bank = (body.bank ?? []).slice(0, 120);
  if (!cards.length && !bank.length) {
    return NextResponse.json({ error: "cards or bank required" }, { status: 400 });
  }

  const lines: string[] = [];
  const rules = (body.rules ?? []).slice(0, 50);
  if (rules.length) {
    lines.push("USER RULES (authoritative · if a transaction matches, use that category):");
    for (const r of rules) lines.push(`- ${r}`);
    lines.push("");
  }
  if (cards.length) {
    lines.push("CARD CHARGES (id | 승인일 | 가맹점 | 업종 | 명칭 | 금액 | 증빙파일명):");
    for (const c of cards) lines.push(`${c.id} | ${c.approvalDate ?? "N/A"} | ${c.merchant ?? ""} | ${c.industry || "N/A"} | ${c.itemName || "N/A"} | ${c.amount ?? "N/A"} | ${c.evidence?.length ? c.evidence.join("; ") : "N/A"}`);
  }
  if (bank.length) {
    lines.push("", "BANK TRANSACTIONS (id | 일자 | 상대 | 적요 | 입금 | 출금 | 증빙파일명):");
    for (const b of bank) lines.push(`${b.id} | ${b.txDate ?? ""} | ${b.counterparty || "N/A"} | ${b.description || "N/A"} | ${b.deposit ?? ""} | ${b.withdrawal ?? ""} | ${b.evidence?.length ? b.evidence.join("; ") : "N/A"}`);
  }

  try {
    const openai = new OpenAI({ apiKey: OPENAI_KEY });
    const completion = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: lines.join("\n") },
      ],
      response_format: { type: "json_schema", json_schema: { name: "spend_classify", strict: true, schema: SCHEMA as unknown as Record<string, unknown> } },
    });
    const raw = completion.choices[0]?.message?.content;
    if (!raw) throw new Error("Empty completion");
    const parsed = JSON.parse(raw);
    const logId = await logAiCall({
      tool: "finance",
      model: MODEL,
      input: { kind: "spend_classify", cards: cards.length, bank: bank.length },
      output: parsed,
    });
    return NextResponse.json({ ...parsed, _logId: logId });
  } catch (err) {
    console.error("spend classify failed:", err);
    const rawMsg = err instanceof OpenAI.APIError ? `openai_${err.status}_${err.code ?? ""}` : String((err as Error)?.message ?? "");
    const detail = rawMsg.replace(/sk-[A-Za-z0-9_-]{4,}/g, "sk-***").slice(0, 80);
    return NextResponse.json({ error: "classify_failed", detail }, { status: 502 });
  }
}

export async function POST(request: Request) { return observeAi("spend-classify", () => run(request)); }
