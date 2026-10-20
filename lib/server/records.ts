import { matchSpendRule, ruleFromRow, recordRuleTexts } from "@/lib/finance/rules";
import { z } from "zod";
import type { Query, Row } from "../transport";
const s = z.string().max(10000), id = z.string().min(1).max(200), amount = z.number().finite().safe();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v, "A valid date is required.");
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const nullableAmount = amount.nullable().optional();
const common = { id: id.optional(), created_at: s.optional(), updated_at: s.optional() };
const schemas = {
    bank_transactions: z.object({ ...common, tx_date: date, tx_time: s.optional(), counterparty: s.optional(), deposit: nullableAmount, withdrawal: nullableAmount, balance: nullableAmount, description: s.optional(), status: s.optional(), memo: s.optional(), category: s.optional(), spend_category: s.optional(), account_label: s.optional(), source_file: s.optional(), matched_invoice: id.nullable().optional(), debit_account: s.optional(), credit_account: s.optional(), dedupe_key: id }),
    card_charges: z.object({ ...common, approval_date: date.nullable().optional(), merchant: s.optional(), industry: s.optional(), pay_method: s.optional(), status: s.optional(), vat: nullableAmount, item_name: s.optional(), spend_category: s.optional(), remarks: s.optional(), transferred: s.optional(), amount: nullableAmount, purchase_date: date.nullable().optional(), card_meta: z.record(s).optional(), month, debit_account: s.optional(), credit_account: s.optional(), source_file: s.optional(), dedupe_key: id }),
    tax_invoices: z.object({ ...common, direction: z.enum(["sale", "purchase"]), issue_date: date, counterparty_name: s.optional(), counterparty_bizno: s.optional(), item: s.optional(), supply_amount: amount, tax_amount: amount, total_amount: amount, matched_tx: id.nullable().optional(), evidence_id: id.nullable().optional(), source_file: s.optional(), dedupe_key: id, approval_no: s.optional(), approval_number: s.optional() }),
    charge_splits: z.object({ ...common, card_charge_id: id.nullable().optional(), bank_tx_id: id.nullable().optional(), label: s, amount, spend_category: s, debit_account: s.optional(), credit_account: s.optional(), status: s.optional(), remarks: s.optional() }),
    spend_rules: z.object({ ...common, pattern: z.string().trim().min(1).max(200), category: z.string().min(1).max(100), match_mode: z.enum(["exact", "contains"]).default("exact"), priority: z.number().int().min(0).max(1000000).default(100), created_by_key: s.optional() }),
    finance_budgets: z.object({ ...common, category: z.string().min(1).max(100), amount: amount.nonnegative() }),
    finance_categories: z.object({ ...common, key: z.string().regex(/^custom:.{1,40}$/u) }),
    finance_evidence: z.object({ ...common, month, storage_path: id, file_name: z.string().min(1).max(300), mime_type: s.optional(), file_size: amount.nonnegative().optional(), summary: s.optional(), doc_type: s.optional(), uploaded_by: s.optional() }),
    evidence_links: z.object({ ...common, evidence_id: id, card_charge_id: id.nullable().optional(), bank_tx_id: id.nullable().optional(), matched_by: z.enum(["name", "ai", "manual"]), note: s.optional() }),
    ai_jobs: z.object({ ...common, operation: s, status: z.enum(["running", "completed", "failed"]), error: s.optional() }),
};
export const tableNames = Object.keys(schemas);
export function validateRecord(table: string, row: Row): Row {
    const schema = schemas[table as keyof typeof schemas];
    if (!schema)
        throw new Error("This table is not supported.");
    const value: Row = schema.strict().parse(row);
    if (table === "tax_invoices" && Math.abs(value.supply_amount + value.tax_amount - value.total_amount) > 1)
        throw new Error("The subtotal and tax must add up to the total.");
    if (["charge_splits", "evidence_links"].includes(table) && Number(Boolean(value.card_charge_id)) + Number(Boolean(value.bank_tx_id)) !== 1)
        throw new Error("Select one card or bank transaction.");
    return value;
}
export function uniqueKey(table: string, row: Row): string {
    if (row.dedupe_key)
        return row.dedupe_key;
    if (table === "spend_rules" && row.match_mode === "exact")
        return "exact:" + row.pattern.trim().toLowerCase();
    if (table === "finance_budgets")
        return row.category;
    if (table === "finance_categories")
        return row.key;
    if (table === "evidence_links")
        return [row.evidence_id, row.card_charge_id || row.bank_tx_id].join(":");
    return row.id;
}
function splitParts(text: string): string[] { let depth = 0, start = 0; const result: string[] = []; for (let i = 0; i < text.length; i++) {
    if (text[i] === "(")
        depth++;
    if (text[i] === ")")
        depth--;
    if (text[i] === "," && depth === 0) {
        result.push(text.slice(start, i));
        start = i + 1;
    }
} result.push(text.slice(start)); return result; }
function expression(row: Row, text: string): boolean {
    if (text.startsWith("and(") && text.endsWith(")"))
        return splitParts(text.slice(4, -1)).every(part => expression(row, part));
    const match = text.match(/^(\w+)\.(gte|lt|eq|is|in)\.(.*)$/);
    if (!match)
        throw new Error("Invalid query filters.");
    const [, key, op, raw] = match;
    return compare(row[key], op, op === "in" ? raw.replace(/^\(|\)$/g, "").split(",") : raw === "null" ? null : raw);
}
function compare(value: any, op: string, expected: any): boolean {
    switch (op) {
        case "eq": return value === expected;
        case "neq": return value !== expected;
        case "is": return expected === null ? value == null : value === expected;
        case "gte": return value != null && value >= expected;
        case "lt": return value != null && value < expected;
        case "in": return Array.isArray(expected) && expected.includes(value);
        default: throw new Error("These query filters are not supported.");
    }
}
export function matches(row: Row, filters: Query["filters"]): boolean { return filters.every(([key, op, value]) => op === "or" ? splitParts(String(value)).some(part => expression(row, part)) : compare(row[key], op, value)); }
export type Stored = {
    id: string;
    owner: string;
    kind: string;
    dedupe: string;
    payload: string;
};
export async function readRows(db: D1Database, owner: string, table: string): Promise<Row[]> { const { results } = await db.prepare("SELECT payload FROM finance_records WHERE owner = ? AND kind = ?").bind(owner, table).all<{
    payload: string;
}>(); return results.map(row => JSON.parse(row.payload)); }
export function putStatement(db: D1Database, owner: string, table: string, row: Row) { return db.prepare("INSERT INTO finance_records (id, owner, kind, dedupe, payload) VALUES (?, ?, ?, ?, ?) ON CONFLICT(owner, kind, id) DO UPDATE SET dedupe=excluded.dedupe,payload=excluded.payload").bind(row.id, owner, table, uniqueKey(table, row), JSON.stringify(row)); }
/** Apply only supplied fields to the row that exists when SQLite executes the update. */
export function patchStatement(db: D1Database, owner: string, table: string, recordId: string, patch: Row) {
    const entries = Object.entries(patch).filter(([key]) => key !== "id" && key !== "created_at");
    const set = entries.length ? `json_set(payload, ${entries.map(() => "?, json(?)").join(", ")})` : "payload";
    let dedupe = "json_extract(next_payload, '$.id')";
    if (["bank_transactions", "card_charges", "tax_invoices"].includes(table)) dedupe = "json_extract(next_payload, '$.dedupe_key')";
    if (table === "spend_rules") dedupe = "CASE WHEN json_extract(next_payload, '$.match_mode') = 'exact' THEN 'exact:' || lower(trim(json_extract(next_payload, '$.pattern'))) ELSE json_extract(next_payload, '$.id') END";
    if (table === "finance_budgets") dedupe = "json_extract(next_payload, '$.category')";
    if (table === "finance_categories") dedupe = "json_extract(next_payload, '$.key')";
    if (table === "evidence_links") dedupe = "json_extract(next_payload, '$.evidence_id') || ':' || coalesce(json_extract(next_payload, '$.card_charge_id'), json_extract(next_payload, '$.bank_tx_id'))";
    return db.prepare(`UPDATE finance_records SET (payload, dedupe) = (SELECT next_payload, ${dedupe} FROM (SELECT ${set} AS next_payload)) WHERE owner = ? AND kind = ? AND id = ?`)
        .bind(...entries.flatMap(([key, value]) => [`$.${key}`, JSON.stringify(value)]), owner, table, recordId);
}

function clearReciprocal(db: D1Database, owner: string, table: string, field: string, targetId: string, exceptId?: string) {
    return db.prepare(`UPDATE finance_records SET payload = json_set(payload, ?, NULL) WHERE owner = ? AND kind = ? AND json_extract(payload, ?) = ?${exceptId ? " AND id != ?" : ""}`)
        .bind(`$.${field}`, owner, table, `$.${field}`, targetId, ...(exceptId ? [exceptId] : []));
}

async function validateRelations(db: D1Database, owner: string, table: string, row: Row, patch: Row) {
    const category = ["spend_rules", "finance_budgets"].includes(table) ? row.category : row.spend_category;
    if (category && category !== "uncategorized" && (Object.hasOwn(patch, "category") || Object.hasOwn(patch, "spend_category"))) {
        if (!(await readRows(db, owner, "finance_categories")).some(c => c.key === category)) throw new Error("Create your categories first.");
    }
    const amountChanged = table === "card_charges" ? Object.hasOwn(patch, "amount") : table === "bank_transactions" && (Object.hasOwn(patch, "withdrawal") || Object.hasOwn(patch, "deposit"));
    if (amountChanged) {
        const key = table === "card_charges" ? "card_charge_id" : "bank_tx_id";
        const splits = (await readRows(db, owner, "charge_splits")).filter(split => split[key] === row.id);
        const total = table === "card_charges" ? row.amount : row.withdrawal || row.deposit;
        if (splits.length && (!Number.isFinite(total) || Math.abs(splits.reduce((sum, split) => sum + split.amount, 0) - total) > 0.01))
            throw new Error("The amount would no longer match existing splits. Remove the splits before changing the amount, then create new splits.");
    }
    for (const [key, target] of [["card_charge_id", "card_charges"], ["bank_tx_id", "bank_transactions"], ["evidence_id", "finance_evidence"], ["matched_tx", "bank_transactions"], ["matched_invoice", "tax_invoices"]]) {
        if (!row[key])
            continue;
        const exists = await db.prepare("SELECT payload FROM finance_records WHERE owner = ? AND kind = ? AND id = ?").bind(owner, target, row[key]).first<{
            payload: string;
        }>();
        if (!exists)
            throw new Error("The linked record is unavailable or not accessible.");
    }
}
export async function executeQuery(db: D1Database, owner: string, input: unknown): Promise<unknown> {
    const q = z.object({ table: z.enum(tableNames as [
            string,
            ...string[]
        ]), action: z.enum(["select", "insert", "update", "upsert", "delete"]), rows: z.union([z.record(z.unknown()), z.array(z.record(z.unknown())).max(2000)]).optional(), filters: z.array(z.tuple([z.string(), z.string(), z.unknown()])).max(30), orders: z.array(z.tuple([z.string(), z.boolean()])).max(10), select: z.string().max(500), single: z.boolean().optional(), maybeSingle: z.boolean().optional(), from: z.number().int().nonnegative().optional(), to: z.number().int().nonnegative().optional(), limit: z.number().int().positive().max(10000).optional(), options: z.record(z.unknown()).optional() }).strict().parse(input) as Query;
    if (q.table === "ai_jobs")
        throw new Error("Use the dedicated API to access this data.");
    if (q.table === "charge_splits" && !["select", "update"].includes(q.action)) throw new Error("Use the dedicated split API to save transaction splits.");
    if (q.table === "charge_splits" && q.action === "update" && Object.keys(q.rows || {}).some(key => !["spend_category", "debit_account", "credit_account", "status", "remarks"].includes(key))) throw new Error("Use the dedicated split API to change amounts and targets.");
    let rows = await readRows(db, owner, q.table);
    let selected = rows.filter(row => matches(row, q.filters));
    if (q.action !== "select") {
        if (q.action === "update" && !selected.length)
            throw new Error("The record is unavailable or not accessible.");
        const statements: D1PreparedStatement[] = [], changed: Row[] = [];
        if (["update", "delete"].includes(q.action) && !q.filters.length)
            throw new Error("Specify the record to update or delete.");
        if (q.action === "delete") {
            for (const row of selected) {
                if (q.table === "finance_categories") {
                    for (const [kind, field] of [["card_charges","spend_category"], ["bank_transactions","spend_category"], ["charge_splits","spend_category"], ["spend_rules","category"], ["finance_budgets","category"]]) {
                        if ((await readRows(db, owner, kind)).some(r => r[field] === row.key)) throw new Error("This category is in use. Remove its transaction, rule, and budget links first.");
                    }
                }
                if (q.table === "bank_transactions") statements.push(clearReciprocal(db, owner, "tax_invoices", "matched_tx", row.id));
                if (q.table === "tax_invoices") statements.push(clearReciprocal(db, owner, "bank_transactions", "matched_invoice", row.id));
                statements.push(db.prepare("DELETE FROM finance_records WHERE owner=? AND kind=? AND id=?").bind(owner, q.table, row.id));
                if (["card_charges", "bank_transactions", "finance_evidence"].includes(q.table)) {
                    const field = q.table === "card_charges" ? "card_charge_id" : q.table === "bank_transactions" ? "bank_tx_id" : "evidence_id";
                    statements.push(db.prepare(`DELETE FROM finance_records WHERE owner=? AND kind IN ('evidence_links','charge_splits') AND json_extract(payload, '$.${field}')=?`).bind(owner, row.id));
                }
            }
        }
        else {
            const incoming: Row[] = q.action === "update" ? selected.map(row => ({ ...q.rows, id: row.id })) : Array.isArray(q.rows) ? q.rows : [q.rows ?? {}];
            for (const input of incoming) {
                const before = q.action === "update" ? selected.find(row => row.id === input.id) : q.action === "upsert" && input.id ? rows.find(row => row.id === input.id) : undefined;
                let row = validateRecord(q.table, { ...before, ...input, id: before?.id || input.id || crypto.randomUUID(), created_at: before?.created_at || input.created_at || new Date().toISOString() });
                let existing = before;
                const same = rows.find(old => uniqueKey(q.table, old) === uniqueKey(q.table, row));
                if (before && same && before.id !== same.id) throw new Error("This identifier already exists.");
                if (same && q.action !== "update") {
                    if (q.action === "insert") {
                        if (q.table === "evidence_links") continue;
                        throw new Error("This record already exists.");
                    }
                    if (q.options?.ignoreDuplicates) continue;
                    existing = same;
                    row = validateRecord(q.table, { ...same, ...input, id: same.id, created_at: same.created_at });
                }
                if (!existing && ["card_charges", "bank_transactions"].includes(q.table) && !row.spend_category) {
                    const category = matchSpendRule((await readRows(db, owner, "spend_rules")).map(ruleFromRow), recordRuleTexts(q.table, row));
                    if (category) { row.spend_category = category; input.spend_category = category; }
                }
                if (existing && q.table === "finance_categories" && existing.key !== row.key) {
                    for (const [kind, field] of [["card_charges","spend_category"], ["bank_transactions","spend_category"], ["charge_splits","spend_category"], ["spend_rules","category"], ["finance_budgets","category"]]) {
                        statements.push(db.prepare(`UPDATE finance_records SET payload = json_set(payload, ?, ?), dedupe = CASE WHEN kind='finance_budgets' THEN ? ELSE dedupe END WHERE owner=? AND kind=? AND json_extract(payload, ?)=?`).bind(`$.${field}`, row.key, row.key, owner, kind, `$.${field}`, existing.key));
                    }
                }
                const patch = Object.fromEntries(Object.keys(input).filter(key => key !== "id" && key !== "created_at").map(key => [key, row[key]]));
                await validateRelations(db, owner, q.table, row, patch);
                if (q.table === "tax_invoices" && Object.hasOwn(patch, "matched_tx")) {
                    statements.push(clearReciprocal(db, owner, "bank_transactions", "matched_invoice", row.id, row.matched_tx || undefined));
                    if (row.matched_tx) {
                        statements.push(clearReciprocal(db, owner, "tax_invoices", "matched_tx", row.matched_tx, row.id));
                        statements.push(patchStatement(db, owner, "bank_transactions", row.matched_tx, { matched_invoice: row.id }));
                    }
                }
                changed.push(row);
                rows = [...rows.filter(old => old.id !== row.id), row];
                statements.push(existing ? patchStatement(db, owner, q.table, row.id, patch) : db.prepare("INSERT INTO finance_records (id, owner, kind, dedupe, payload) VALUES (?, ?, ?, ?, ?)").bind(row.id, owner, q.table, uniqueKey(q.table, row), JSON.stringify(row)));
            }
        }
        if (statements.length)
            await db.batch(statements);
        const persisted = changed.length ? await readRows(db, owner, q.table) : [];
        selected = changed.map(row => persisted.find(current => current.id === row.id)).filter(Boolean) as Row[];
    }
    else {
        for (const [key, ascending] of [...q.orders].reverse())
            selected.sort((a, b) => String(a[key] ?? "").localeCompare(String(b[key] ?? "")) * (ascending ? 1 : -1));
        selected = selected.slice(q.from ?? 0, q.to == null ? q.limit == null ? undefined : (q.from ?? 0) + q.limit : q.to + 1);
    }
    if (q.single && selected.length !== 1)
        throw new Error("Record not found.");
    return q.single || q.maybeSingle ? selected[0] ?? null : selected;
}
