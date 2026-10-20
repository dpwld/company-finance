import assert from "node:assert/strict";
import { readFile, readdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Miniflare } from "miniflare";
import { executeQuery, readRows, matches, validateRecord, putStatement } from "../lib/server/records";
import { moneyTotals, recurringMerchants, moneyCardDate, accountBalances } from "../lib/finance/money";
import { accountOf } from "../lib/finance/accounts";
import { parseFinanceFile } from "../lib/finance/parse";
import { tipsBounds } from "../lib/data/finance";
import { configureMerchantAliases, normalizeMerchant, matchByName } from "../lib/finance/evidenceMatch";
import { findSubset } from "../lib/finance/rcmsParse";
import { validateClassifications } from "../lib/finance/classificationPolicy";
import { validInvoiceAmounts } from "../lib/finance/invoiceIntegrity";
import * as XLSX from "xlsx";
const directory = await mkdtemp(join(tmpdir(), "finance-d1-test-"));
const options = { modules: true, script: 'export default {fetch(){return new Response("ok")}}', compatibilityDate: "2026-05-15", d1Databases: ["DB"], d1Persist: directory };
let mf = new Miniflare(options);
try {
    let db = await mf.getD1Database("DB");
    for (const file of (await readdir("drizzle")).filter(name => name.endsWith(".sql")).sort()) {
        const sql = await readFile("drizzle/" + file, "utf8");
        for (const statement of sql.split(";").map(row => row.replace(/--> statement-breakpoint/g, "").trim()).filter(Boolean))
            await db.prepare(statement).run();
    }
    const query = (table: string, action = "select", extra: Record<string, unknown> = {}) => ({ table, action, filters: [], orders: [], select: "*", ...extra });
    assert.deepEqual(await executeQuery(db as any, "owner-a", query("bank_transactions")), []);
    const bank = { id: "bank-a", dedupe_key: "bank-key", tx_date: "2026-10-10", source_file: "일반.xlsx", deposit: null, withdrawal: 150, balance: 1000, counterparty: "test-only", spend_category: "equipment" };
    await executeQuery(db as any, "owner-a", query("bank_transactions", "upsert", { rows: bank, options: { ignoreDuplicates: true } }));
    assert.equal((await readRows(db as any, "owner-a", "bank_transactions")).length, 1);
    assert.deepEqual(await readRows(db as any, "owner-b", "bank_transactions"), []);
    await assert.rejects(executeQuery(db as any, "owner-b", query("bank_transactions", "update", { rows: { withdrawal: 1 }, filters: [["id", "eq", "bank-a"]] })), /접근 권한/);
    assert.deepEqual(await executeQuery(db as any, "owner-a", query("bank_transactions", "upsert", { rows: { ...bank, id: "duplicate" }, options: { ignoreDuplicates: true } })), []);
    await assert.rejects(executeQuery(db as any, "owner-a", query("bank_transactions", "update", { rows: { withdrawal: "bad" }, filters: [["id", "eq", "bank-a"]] })));
    assert.equal((await readRows(db as any, "owner-a", "bank_transactions"))[0].withdrawal, 150);
    await assert.rejects(executeQuery(db as any, "owner-a", query("bank_transactions", "insert", { rows: { ...bank, id: "invalid-date", dedupe_key: "date", tx_date: "2026-02-30" } })));
    await assert.rejects(executeQuery(db as any, "owner-a", query("finance_budgets", "insert", { rows: [{ category: "valid", amount: 20 }, { category: "invalid", amount: -10 }] })));
    assert.deepEqual(await readRows(db as any, "owner-a", "finance_budgets"), []);
    await executeQuery(db as any, "owner-a", query("finance_budgets", "upsert", { rows: { category: "equipment", amount: 1000 } }));
    await executeQuery(db as any, "owner-a", query("finance_budgets", "upsert", { rows: { category: "equipment", amount: 2000 } }));
    assert.equal((await readRows(db as any, "owner-a", "finance_budgets"))[0].amount, 2000);
    const invoice = { id: "invoice-a", dedupe_key: "invoice-key", direction: "purchase", issue_date: "2026-10-10", supply_amount: 100, tax_amount: 10, total_amount: 110 };
    await executeQuery(db as any, "owner-a", query("tax_invoices", "insert", { rows: invoice }));
    await executeQuery(db as any, "owner-a", query("tax_invoices", "update", { rows: { matched_tx: "bank-a" }, filters: [["id", "eq", "invoice-a"]] }));
    assert.equal((await readRows(db as any, "owner-a", "bank_transactions")).find(row => row.id === "bank-a")?.matched_invoice, "invoice-a");
    await executeQuery(db as any, "owner-a", query("tax_invoices", "update", { rows: { matched_tx: null }, filters: [["id", "eq", "invoice-a"]] }));
    assert.equal((await readRows(db as any, "owner-a", "bank_transactions")).find(row => row.id === "bank-a")?.matched_invoice, null);
    // Both handlers receive the same initial D1 snapshot before either may write.
    let reads = 0, release!: () => void;
    const bothRead = new Promise<void>(resolve => { release = resolve; });
    const concurrentDb = {
        prepare(sql: string) {
            const statement = db.prepare(sql);
            if (sql !== "SELECT payload FROM finance_records WHERE owner = ? AND kind = ?") return statement;
            return { bind(...values: any[]) { const bound = statement.bind(...values); return {
                async all() { const result = await bound.all(); if (reads < 2) { reads++; if (reads === 2) release(); await bothRead; } return result; },
            }; } };
        },
        batch: (statements: any[]) => db.batch(statements),
    };
    await executeQuery(db as any, "owner-a", query("bank_transactions", "update", { rows: { memo: "before", tips_eligible: true }, filters: [["id", "eq", "bank-a"]] }));
    await Promise.all([
        executeQuery(concurrentDb as any, "owner-a", query("bank_transactions", "update", { rows: { memo: "edited" }, filters: [["id", "eq", "bank-a"]] })),
        executeQuery(concurrentDb as any, "owner-a", query("bank_transactions", "update", { rows: { tips_eligible: null }, filters: [["id", "eq", "bank-a"]] })),
    ]);
    const merged = (await readRows(db as any, "owner-a", "bank_transactions")).find(row => row.id === "bank-a")!;
    assert.equal(merged.memo, "edited", "Concurrent nullable-field edits must not overwrite the memo");
    assert.equal(merged.tips_eligible, null, "Explicit null must be stored without removing or reverting the field");
    assert(Object.hasOwn(merged, "tips_eligible"));
    assert.equal(merged.withdrawal, 150);

    const ownerB = { ...bank, id: "bank-a", dedupe_key: "owner-b-bank", matched_invoice: null };
    await executeQuery(db as any, "owner-b", query("bank_transactions", "insert", { rows: ownerB }));
    await executeQuery(db as any, "owner-b", query("tax_invoices", "insert", { rows: { ...invoice, matched_tx: "bank-a" } }));
    await executeQuery(db as any, "owner-a", query("tax_invoices", "update", { rows: { matched_tx: "bank-a" }, filters: [["id", "eq", "invoice-a"]] }));
    await executeQuery(db as any, "owner-a", query("tax_invoices", "delete", { filters: [["id", "eq", "invoice-a"]] }));
    assert.equal((await readRows(db as any, "owner-a", "bank_transactions")).find(row => row.id === "bank-a")!.matched_invoice, null);
    assert.equal((await readRows(db as any, "owner-b", "bank_transactions"))[0].matched_invoice, "invoice-a");
    await executeQuery(db as any, "owner-a", query("tax_invoices", "insert", { rows: { ...invoice, matched_tx: "bank-a" } }));
    await executeQuery(db as any, "owner-a", query("bank_transactions", "insert", { rows: { ...bank, id: "bank-delete", dedupe_key: "delete-key" } }));
    await executeQuery(db as any, "owner-a", query("tax_invoices", "update", { rows: { matched_tx: "bank-delete" }, filters: [["id", "eq", "invoice-a"]] }));
    await executeQuery(db as any, "owner-a", query("bank_transactions", "delete", { filters: [["id", "eq", "bank-delete"]] }));
    assert.equal((await readRows(db as any, "owner-a", "tax_invoices"))[0].matched_tx, null);

    const source = { id: "tips-source", dedupe_key: "tips-source", tx_date: "2026-10-10", source_file: "TIPS.xlsx", withdrawal: 30, deposit: null };
    const refundRow = { id: "refund-row", dedupe_key: "refund-row", tx_date: "2026-10-10", source_file: "일반.xlsx", withdrawal: null, deposit: 30, tips_refund_source_id: "tips-source" };
    await executeQuery(db as any, "owner-a", query("bank_transactions", "insert", { rows: source }));
    await executeQuery(db as any, "owner-a", query("bank_transactions", "insert", { rows: refundRow }));
    await assert.rejects(executeQuery(db as any, "owner-a", query("bank_transactions", "insert", { rows: { ...refundRow, id: "duplicate-refund", dedupe_key: "duplicate-refund" } })));
    await assert.rejects(executeQuery(db as any, "owner-a", query("bank_transactions", "update", { rows: { withdrawal: 31 }, filters: [["id", "eq", "tips-source"]] })), /환급을 해제/);
    await assert.rejects(executeQuery(db as any, "owner-a", query("bank_transactions", "delete", { filters: [["id", "eq", "tips-source"]] })), /환급을 해제/);
    const existingSplit = validateRecord("charge_splits", { id: "bank-split", bank_tx_id: "bank-a", label: "Existing split", amount: 150, spend_category: "equipment" });
    await putStatement(db as any, "owner-a", "charge_splits", existingSplit).run();
    await assert.rejects(executeQuery(db as any, "owner-a", query("bank_transactions", "update", { rows: { withdrawal: 151 }, filters: [["id", "eq", "bank-a"]] })), /분할/);
    await assert.rejects(executeQuery(db as any, "owner-a", query("bank_transactions", "upsert", { rows: { ...bank, withdrawal: 151 } })), /분할/);
    assert.equal((await readRows(db as any, "owner-a", "bank_transactions")).find(row => row.id === "bank-a")!.withdrawal, 150);
    await executeQuery(db as any, "owner-a", query("bank_transactions", "update", { rows: { memo: "Independent metadata edit" }, filters: [["id", "eq", "bank-a"]] }));
    const splitCard = { id: "split-card", dedupe_key: "split-card", amount: 100, month: "2026-10", merchant: "Test-only split card" };
    await executeQuery(db as any, "owner-a", query("card_charges", "insert", { rows: splitCard }));
    await putStatement(db as any, "owner-a", "charge_splits", validateRecord("charge_splits", { id: "card-split", card_charge_id: "split-card", label: "Existing card split", amount: 100, spend_category: "equipment" })).run();
    await assert.rejects(executeQuery(db as any, "owner-a", query("card_charges", "update", { rows: { amount: null }, filters: [["id", "eq", "split-card"]] })), /분할/);
    await assert.rejects(executeQuery(db as any, "owner-a", query("card_charges", "upsert", { rows: { ...splitCard, amount: 90 } })), /분할/);
    assert.equal((await readRows(db as any, "owner-a", "card_charges")).find(row => row.id === "split-card")!.amount, 100);
    await db.prepare("DELETE FROM finance_records WHERE owner = ? AND kind = 'charge_splits' AND id = ?").bind("owner-a", "card-split").run();
    await executeQuery(db as any, "owner-a", query("card_charges", "update", { rows: { amount: 90 }, filters: [["id", "eq", "split-card"]] }));
    assert.equal((await readRows(db as any, "owner-a", "card_charges")).find(row => row.id === "split-card")!.amount, 90);
    await assert.rejects(executeQuery(db as any, "owner-b", query("charge_splits", "insert", { rows: { bank_tx_id: "bank-a", label: "split", amount: 150, spend_category: "equipment" } })));
    assert.throws(() => validateRecord("tax_invoices", { id: "invoice", dedupe_key: "invoice", direction: "purchase", issue_date: "2026-10-10", supply_amount: 100, tax_amount: 10, total_amount: 999 }), /합계/);
    assert(matches({ purchase_date: null, approval_date: "2026-10-10" }, [["", "or", "and(purchase_date.gte.2026-10-01,purchase_date.lt.2026-11-01),and(purchase_date.is.null,approval_date.gte.2026-10-01,approval_date.lt.2026-11-01)"]]));
    await mf.dispose();
    mf = new Miniflare(options);
    db = await mf.getD1Database("DB");
    assert.equal((await readRows(db as any, "owner-a", "bank_transactions"))[0].withdrawal, 150);
    assert.equal(findSubset(30, [{ amount: 10 }, { amount: 20 }])?.length, 2);
    assert.equal(findSubset(31, [{ amount: 10 }, { amount: 20 }]), null);
    configureMerchantAliases([["fixture-a", "fixture-b"]]);
    assert.equal(normalizeMerchant("fixture-a"), normalizeMerchant("fixture-b"));
    assert.deepEqual(matchByName("1010_fixture-a_receipt.pdf", "2026-10", [{ id: "candidate", kind: "card", date: "2026-10-10", name: "fixture-b" }]).auto, [{ id: "candidate", kind: "card" }]);
    configureMerchantAliases([]);
    assert.deepEqual(tipsBounds("2026-12"), { from: "2026-12-09", to: "2027-01-09" });
    assert.equal(accountOf("TIPS.xlsx"), "tips");
    assert.equal(accountOf("일반.csv"), "general");
    assert.equal(accountOf("unknown.csv"), "unknown");
    const statementRow = (id: string, txDate: string, txTime: string, balance: number | null, withdrawal = 0, deposit = 0) => ({ id, txDate, txTime, sourceFile: "일반.xlsx", balance, withdrawal, deposit } as any);
    const statements = [statementRow("later", "2026-10-03", "10:00", 50, 10), statementRow("first", "2026-10-01", "09:00", 100), statementRow("tail", "2026-10-04", "09:00", null, 0, 5)];
    assert.equal(accountBalances(statements.slice(0, 2), "2026-10")[0].balance, 50, "The newest statement balance overrides incomplete earlier history");
    assert.equal(accountBalances([...statements].reverse(), "2026-10")[0].balance, 55, "Only transactions after the last known balance are accumulated regardless of input order");
    assert.equal(accountBalances([...statements, statementRow("future", "2026-11-01", "09:00", 999)], "2026-10")[0].balance, 55);
    assert.equal(accountBalances([statementRow("am", "2026-10-03", "09:00", 50), statementRow("pm", "2026-10-03", "15:00", 40)], "2026-10")[0].balance, 40);

    const card = (id: string, amount: number | null, date = "2026-10-10", status = "") => ({ id, amount, purchaseDate: date, approvalDate: "2026-09-30", status, merchant: "test fixture", itemName: "", spendCategory: "equipment", tipsFunded: false, cardMeta: {} } as any);
    assert.equal(moneyCardDate(card("a", 100)), "2026-10-10");
    assert.equal(moneyTotals([card("a", 100), card("b", -20), card("cancel", 50, "2026-10-10", "취소"), card("fx", null)], [], false).spending, 80);
    assert.equal(moneyTotals([card("a", 100)], [], false, [{ cardChargeId: "a", amount: 50, spendCategory: "supplies" }]).invalidSplitCount, 1);
    assert.equal(recurringMerchants([card("a", 100, "2026-08-10"), card("b", 100, "2026-09-10"), card("c", 100)]).length, 1);
    const refundSource = { id: "source", sourceFile: "TIPS.xlsx", withdrawal: 30, deposit: null };
    const refund = { id: "refund", sourceFile: "일반.xlsx", deposit: 30, withdrawal: null, tipsRefundSourceId: "source", tipsRefundSource: refundSource };
    assert.equal(moneyTotals([card("a", 100)], [refund as any], true).spending, 70);
    assert.equal(moneyTotals([card("a", 100)], [{ ...refund, tipsRefundSourceId: null } as any], true).spending, 100);
    assert(!validInvoiceAmounts({ supplyAmount: 100, taxAmount: 10, totalAmount: 999 }));
    assert.throws(() => validateClassifications({ cards: [{ id: "invented", classification: "", status: "검토가능", note: "" }], bank: [] }, ["real"], []));
    const sheet = XLSX.utils.aoa_to_sheet([["작성일자", "공급자상호", "공급가액", "세액", "합계금액", "승인번호"], ["2026-10-10", "fixture", 100, 10, 110, "TEST-ONLY-001"]]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "매입");
    const file = new File([XLSX.write(workbook, { type: "array", bookType: "xlsx" })], "purchase-test.xlsx");
    const parsed = await parseFinanceFile(file);
    assert.equal(parsed.invoices.length, 1);
    assert.equal(parsed.invoices[0].total_amount, 110);
    console.log("PASS: empty D1, CRUD, cross-owner isolation, duplicate import, invalid preservation, atomic batch validation, restart persistence, record dates/invoices, split relation checks, date filters, original money/refund/recurring logic and original XLSX parser.");
}
finally {
    await mf.dispose();
    await rm(directory, { recursive: true, force: true });
}
