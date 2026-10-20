import { env } from "cloudflare:workers";
import { z } from "zod";
import { ownerId, apiError, sameOrigin } from "@/lib/server/auth";
import { readRows, validateRecord, putStatement } from "@/lib/server/records";
export async function POST(request: Request) {
    try {
        const owner = await ownerId();
        sameOrigin(request);
        const input = z.object({ target: z.union([z.object({ cardChargeId: z.string().min(1) }).strict(), z.object({ bankTxId: z.string().min(1) }).strict()]), lines: z.array(z.object({ label: z.string().max(1000), amount: z.number().finite().safe(), spendCategory: z.string().max(100), status: z.string().optional(), remarks: z.string().optional() }).strict()).max(100) }).strict().parse((await request.json() as any));
        const isCard = "cardChargeId" in input.target, key = isCard ? "card_charge_id" : "bank_tx_id", target = "cardChargeId" in input.target ? input.target.cardChargeId : input.target.bankTxId;
        const parent = (await readRows(env.DB!, owner, isCard ? "card_charges" : "bank_transactions")).find(row => row.id === target);
        if (!parent)
            throw new Error("분할 대상에 접근할 수 없습니다.");
        const total = isCard ? parent.amount : parent.withdrawal || parent.deposit;
        if (input.lines.length && (!Number.isFinite(total) || Math.abs(input.lines.reduce((sum, row) => sum + row.amount, 0) - total) > 0.01))
            throw new Error("분할 합계와 거래 금액이 일치해야 합니다.");
        const categories = await readRows(env.DB!, owner, "finance_categories");
        if (input.lines.some(line => line.spendCategory && !categories.some(c => c.key === line.spendCategory))) throw new Error("본인 카테고리를 선택하세요.");
        const rows = input.lines.map(line => validateRecord("charge_splits", { id: crypto.randomUUID(), [key]: target, label: line.label, amount: line.amount, spend_category: line.spendCategory, status: line.status || "", remarks: line.remarks || "" }));
        await env.DB!.batch([env.DB!.prepare(`DELETE FROM finance_records WHERE owner=? AND kind='charge_splits' AND json_extract(payload, '$.${key}')=?`).bind(owner, target), ...rows.map(row => putStatement(env.DB!, owner, "charge_splits", row))]);
        return Response.json({ saved: true });
    }
    catch (error) {
        return apiError(error);
    }
}
