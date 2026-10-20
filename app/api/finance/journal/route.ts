import { observeAi } from "@/lib/server/observe";
import { NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@/lib/server/client";
import { env } from "cloudflare:workers";
import { ownerId, sameOrigin } from "@/lib/server/auth";
import { logAiCall } from "@/lib/ai/logging";

/* AI 분개 (double-entry journal proposals) for the unified ledger — the base
   for the 5대 재무제표. Uses the transaction facts plus the names/notes of the
   linked evidence files. Proposals only; the user confirms inline. */


const SYSTEM = `You are a Korean startup bookkeeper. For each ledger row, propose a double-entry journal (분개) with standard K-GAAP 계정과목, so the entries roll up into the 재무제표.

General bookkeeping conventions (confirm chart of accounts and evidence with the user):
- 카드 지출 → 차변: 비용 계정 (연구개발비/소모품비/지급수수료/복리후생비/여비교통비/통신비/교육훈련비/임차료/도서인쇄비/세금과공과 등), 대변: 미지급금
- 카드 취소/환불(음수) → 반대 분개 (차변: 미지급금, 대변: 원 비용 계정)
- 은행 출금 중 카드대금 결제 → 차변: 미지급금, 대변: 보통예금
- 그 외 은행 출금 → 차변: 해당 비용/자산 계정 (급여, 지급수수료, 임차료, 세금과공과, 외주비 등), 대변: 보통예금
- 은행 입금 → 차변: 보통예금, 대변: 성격에 따라 (매출/정부보조금(TIPS 등)/선수금/잡이익/가수금)
- 확실치 않으면 가장 그럴듯한 계정 + note에 한 문장으로 근거/의문을 남겨라.

Also return label: 이 거래가 무엇인지 설명하는 3~6단어 한국어 명칭 (예: "Claude 구독", "스터디룸 대관", "세무 기장료", "카드대금 결제").

Evidence file names (receipts/invoices) are strong hints for the expense nature. Answer 계정과목 in Korean. Keep note to ONE short Korean sentence (empty when obvious).`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    entries: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          kind: { type: "string", enum: ["bank", "card"] },
          debit: { type: "string" },
          credit: { type: "string" },
          label: { type: "string" },
          note: { type: "string" },
        },
        required: ["id", "kind", "debit", "credit", "label", "note"],
      },
    },
  },
  required: ["entries"],
} as const;

interface InRow {
  id: string;
  kind: "bank" | "card";
  date: string | null;
  party: string;
  deposit: number | null;
  withdrawal: number | null;
  description: string;
  evidence: string[];
}

async function run(request: Request) {
  try { await ownerId(); sameOrigin(request); } catch { return NextResponse.json({error:"로그인이 필요합니다."},{status:401}); }
  const settings = env as unknown as Record<string, string>;
  const OPENAI_KEY = settings.OPENAI_API_KEY || process.env.OPENAI_API_KEY || "";
  const MODEL = settings.OPENAI_MODEL || process.env.OPENAI_MODEL || "";
  if (!OPENAI_KEY || !MODEL) return NextResponse.json({error:"서버에 사용자 소유 OPENAI_API_KEY와 OPENAI_MODEL을 설정하세요."},{status:503});

  if (!OPENAI_KEY) {
    return NextResponse.json({ error: "OPENAI_API_KEY not set" }, { status: 503 });
  }

  // Finance is admin-or-granted — mirror the has_tool('finance') RLS gate here.
  const supabase = await createClient();

  let body: { month?: string; rows?: InRow[] };
  try {
    body = (await request.json() as any);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const rows = (body.rows ?? []).slice(0, 120);
  if (!rows.length) return NextResponse.json({ entries: [] });

  const lines = rows
    .map((r: any) =>
      `${r.id} | ${r.kind} | ${r.date ?? "?"} | ${r.party} | 입금 ${r.deposit ?? "-"} | 출금 ${r.withdrawal ?? "-"} | ${r.description || "-"} | 증빙: ${r.evidence.join("; ") || "-"}`,
    )
    .join("\n");

  try {
    const openai = new OpenAI({ apiKey: OPENAI_KEY });
    const completion = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: `Month: ${body.month}\nRows (id | kind | date | party | in | out | desc | evidence):\n${lines}` },
      ],
      response_format: { type: "json_schema", json_schema: { name: "journal", strict: true, schema: SCHEMA } },
    });
    const raw = completion.choices[0]?.message?.content;
    if (!raw) throw new Error("Empty completion");
    const out = JSON.parse(raw) as { entries: { id: string; kind: string; debit: string; credit: string; label: string; note: string }[] };
    const known = new Set(rows.map((r: any) => r.id));
    out.entries = out.entries.filter((e) => known.has(e.id));
    const logId = await logAiCall({
      tool: "finance",
      model: MODEL,
      input: { month: body.month, journalRows: rows.length },
      output: out,
    });
    return NextResponse.json({ ...out, _logId: logId });
  } catch (err) {
    console.error("journal proposal failed:", err);
    const raw = err instanceof OpenAI.APIError ? `openai_${err.status}_${err.code ?? ""}` : String((err as Error)?.message ?? "");
    return NextResponse.json({ error: "journal_failed", detail: raw.replace(/sk-[A-Za-z0-9_-]{4,}/g, "sk-***").slice(0, 80) }, { status: 502 });
  }
}

export async function POST(request: Request) { return observeAi("journal", () => run(request)); }
