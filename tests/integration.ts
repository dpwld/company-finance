import assert from "node:assert/strict";
import { readFile, readdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Miniflare } from "miniflare";
import { executeQuery, readRows, matches, validateRecord, putStatement } from "../lib/server/records";
import { moneyTotals, recurringMerchants, moneyCardDate, accountBalances } from "../lib/finance/money";
import { accountOf } from "../lib/finance/accounts";
import { parseFinanceFile } from "../lib/finance/parse";
import { configureMerchantAliases, normalizeMerchant, matchByName } from "../lib/finance/evidenceMatch";
import { validInvoiceAmounts } from "../lib/finance/invoiceIntegrity";
import { matchSpendRule, matchingRule, validateCategoryProposals } from "../lib/finance/rules";
import { applyUserRules } from "../lib/server/rules";
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
    for (const owner of ["owner-a","owner-b"]) await executeQuery(db as any, owner, query("finance_categories", "insert", { rows: [{key:"custom:Equipment"},{key:"custom:Supplies"}] }));
    const bank = { id: "bank-a", dedupe_key: "bank-key", tx_date: "2026-10-10", source_file: "일반.xlsx", deposit: null, withdrawal: 150, balance: 1000, counterparty: "test-only", spend_category: "custom:Equipment" };
    await executeQuery(db as any, "owner-a", query("bank_transactions", "upsert", { rows: bank, options: { ignoreDuplicates: true } }));
    assert.equal((await readRows(db as any, "owner-a", "bank_transactions")).length, 1);
    assert.deepEqual(await readRows(db as any, "owner-b", "bank_transactions"), []);
    await assert.rejects(executeQuery(db as any, "owner-b", query("bank_transactions", "update", { rows: { withdrawal: 1 }, filters: [["id", "eq", "bank-a"]] })), /not accessible/);
    assert.deepEqual(await executeQuery(db as any, "owner-a", query("bank_transactions", "upsert", { rows: { ...bank, id: "duplicate" }, options: { ignoreDuplicates: true } })), []);
    await assert.rejects(executeQuery(db as any, "owner-a", query("bank_transactions", "update", { rows: { withdrawal: "bad" }, filters: [["id", "eq", "bank-a"]] })));
    assert.equal((await readRows(db as any, "owner-a", "bank_transactions"))[0].withdrawal, 150);
    await assert.rejects(executeQuery(db as any, "owner-a", query("bank_transactions", "insert", { rows: { ...bank, id: "invalid-date", dedupe_key: "date", tx_date: "2026-02-30" } })));
    await assert.rejects(executeQuery(db as any, "owner-a", query("finance_budgets", "insert", { rows: [{ category: "valid", amount: 20 }, { category: "invalid", amount: -10 }] })));
    assert.deepEqual(await readRows(db as any, "owner-a", "finance_budgets"), []);
    await executeQuery(db as any, "owner-a", query("finance_budgets", "upsert", { rows: { category: "custom:Equipment", amount: 1000 } }));
    await executeQuery(db as any, "owner-a", query("finance_budgets", "upsert", { rows: { category: "custom:Equipment", amount: 2000 } }));
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
    await executeQuery(db as any, "owner-a", query("bank_transactions", "update", { rows: { memo: "before", balance: 500 }, filters: [["id", "eq", "bank-a"]] }));
    await Promise.all([
        executeQuery(concurrentDb as any, "owner-a", query("bank_transactions", "update", { rows: { memo: "edited" }, filters: [["id", "eq", "bank-a"]] })),
        executeQuery(concurrentDb as any, "owner-a", query("bank_transactions", "update", { rows: { balance: null }, filters: [["id", "eq", "bank-a"]] })),
    ]);
    const merged = (await readRows(db as any, "owner-a", "bank_transactions")).find(row => row.id === "bank-a")!;
    assert.equal(merged.memo, "edited", "Concurrent nullable-field edits must not overwrite the memo");
    assert.equal(merged.balance, null, "Explicit null must be stored without removing or reverting the field");
    assert(Object.hasOwn(merged, "balance"));
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

    const existingSplit = validateRecord("charge_splits", { id: "bank-split", bank_tx_id: "bank-a", label: "Existing split", amount: 150, spend_category: "custom:Equipment" });
    await putStatement(db as any, "owner-a", "charge_splits", existingSplit).run();
    await assert.rejects(executeQuery(db as any, "owner-a", query("bank_transactions", "update", { rows: { withdrawal: 151 }, filters: [["id", "eq", "bank-a"]] })), /splits/);
    await assert.rejects(executeQuery(db as any, "owner-a", query("bank_transactions", "upsert", { rows: { ...bank, withdrawal: 151 } })), /splits/);
    assert.equal((await readRows(db as any, "owner-a", "bank_transactions")).find(row => row.id === "bank-a")!.withdrawal, 150);
    await executeQuery(db as any, "owner-a", query("bank_transactions", "update", { rows: { memo: "Independent metadata edit" }, filters: [["id", "eq", "bank-a"]] }));
    const splitCard = { id: "split-card", dedupe_key: "split-card", amount: 100, month: "2026-10", merchant: "Test-only split card" };
    await executeQuery(db as any, "owner-a", query("card_charges", "insert", { rows: splitCard }));
    await putStatement(db as any, "owner-a", "charge_splits", validateRecord("charge_splits", { id: "card-split", card_charge_id: "split-card", label: "Existing card split", amount: 100, spend_category: "custom:Equipment" })).run();
    await assert.rejects(executeQuery(db as any, "owner-a", query("card_charges", "update", { rows: { amount: null }, filters: [["id", "eq", "split-card"]] })), /splits/);
    await assert.rejects(executeQuery(db as any, "owner-a", query("card_charges", "upsert", { rows: { ...splitCard, amount: 90 } })), /splits/);
    assert.equal((await readRows(db as any, "owner-a", "card_charges")).find(row => row.id === "split-card")!.amount, 100);
    await db.prepare("DELETE FROM finance_records WHERE owner = ? AND kind = 'charge_splits' AND id = ?").bind("owner-a", "card-split").run();
    await executeQuery(db as any, "owner-a", query("card_charges", "update", { rows: { amount: 90 }, filters: [["id", "eq", "split-card"]] }));
    assert.equal((await readRows(db as any, "owner-a", "card_charges")).find(row => row.id === "split-card")!.amount, 90);
    await assert.rejects(executeQuery(db as any, "owner-b", query("charge_splits", "insert", { rows: { bank_tx_id: "bank-a", label: "split", amount: 150, spend_category: "custom:Equipment" } })));
    assert.throws(() => validateRecord("tax_invoices", { id: "invoice", dedupe_key: "invoice", direction: "purchase", issue_date: "2026-10-10", supply_amount: 100, tax_amount: 10, total_amount: 999 }), /add up/);
    assert(matches({ purchase_date: null, approval_date: "2026-10-10" }, [["", "or", "and(purchase_date.gte.2026-10-01,purchase_date.lt.2026-11-01),and(purchase_date.is.null,approval_date.gte.2026-10-01,approval_date.lt.2026-11-01)"]]));
    const ruleOwner = "rule-owner";
    await executeQuery(db as any, ruleOwner, query("finance_categories", "insert", { rows: [{id:"cat-alpha",key:"custom:Alpha"},{id:"cat-beta",key:"custom:Beta"}] }));
    assert.equal(matchSpendRule([], ["Cloud service"]), null);
    const rules = [{id:"b",pattern:"Cloud",category:"custom:Beta",matchMode:"contains" as const,priority:20},{id:"a",pattern:"Cloud service",category:"custom:Alpha",matchMode:"exact" as const,priority:10}];
    assert.equal(matchSpendRule(rules,["  CLOUD SERVICE  "]),"custom:Alpha");
    assert.equal(matchSpendRule(rules,["other Cloud service"]),"custom:Beta");
    assert.equal(matchingRule([{...rules[1],id:"z",priority:20},rules[0]],["Cloud service"])?.id,"b");
    assert.equal(matchSpendRule(rules,["Unmatched merchant"]),null);
    const beforeRules={id:"before-rules",dedupe_key:"before-rules",month:"2026-10",amount:25,merchant:"Cloud service"};
    await executeQuery(db as any,ruleOwner,query("card_charges","insert",{rows:beforeRules}));
    await executeQuery(db as any,ruleOwner,query("spend_rules","insert",{rows:rules.map(r=>({id:r.id,pattern:r.pattern,category:r.category,match_mode:r.matchMode,priority:r.priority}))}));
    await assert.rejects(executeQuery(db as any,"owner-b",query("spend_rules","insert",{rows:{pattern:"Cloud",category:"custom:Alpha"}})),/categories/);
    await assert.rejects(executeQuery(db as any,ruleOwner,query("spend_rules","insert",{rows:{pattern:" CLOUD SERVICE ",category:"custom:Beta",match_mode:"exact"}})),/already exists/);
    await executeQuery(db as any,ruleOwner,query("card_charges","insert",{rows:[{...beforeRules,id:"imported",dedupe_key:"imported"},{...beforeRules,id:"manual",dedupe_key:"manual",spend_category:"custom:Beta"},{...beforeRules,id:"no-match",dedupe_key:"no-match",merchant:"Unmatched merchant"}]}));
    assert.equal((await readRows(db as any,ruleOwner,"card_charges")).find(r=>r.id==="imported")!.spend_category,"custom:Alpha");
    assert.equal((await readRows(db as any,ruleOwner,"card_charges")).find(r=>r.id==="no-match")!.spend_category,undefined);
    await executeQuery(db as any,"owner-b",query("card_charges","insert",{rows:{...beforeRules,id:"other-owner",dedupe_key:"other-owner"}}));
    assert.equal((await readRows(db as any,"owner-b","card_charges")).find(r=>r.id==="other-owner")!.spend_category,undefined);
    await executeQuery(db as any,ruleOwner,query("bank_transactions","insert",{rows:{id:"ruled-bank",dedupe_key:"ruled-bank",tx_date:"2026-10-11",source_file:"User account.xlsx",counterparty:"Other Cloud service",withdrawal:5}}));
    assert.equal((await readRows(db as any,ruleOwner,"bank_transactions"))[0].spend_category,"custom:Beta");
    assert.equal((await applyUserRules(db as any,ruleOwner,false)).matches.length,1);
    assert.equal((await readRows(db as any,ruleOwner,"card_charges")).find(r=>r.id==="before-rules")!.spend_category,undefined);
    assert.equal((await applyUserRules(db as any,ruleOwner,true)).applied,1);
    assert.equal((await applyUserRules(db as any,ruleOwner,true)).applied,0);
    assert.equal((await readRows(db as any,ruleOwner,"card_charges")).find(r=>r.id==="manual")!.spend_category,"custom:Beta");
    await executeQuery(db as any,ruleOwner,query("spend_rules","update",{rows:{priority:5,pattern:"Cloud",match_mode:"contains"},filters:[["id","eq","b"]]}));
    assert.equal((await readRows(db as any,ruleOwner,"spend_rules")).find(r=>r.id==="b")!.priority,5);
    await executeQuery(db as any,ruleOwner,query("finance_budgets","insert",{rows:{category:"custom:Alpha",amount:200}}));
    await executeQuery(db as any,ruleOwner,query("finance_categories","update",{rows:{key:"custom:Renamed"},filters:[["id","eq","cat-alpha"]]}));
    assert.equal((await readRows(db as any,ruleOwner,"card_charges")).find(r=>r.id==="imported")!.spend_category,"custom:Renamed");
    assert.equal((await readRows(db as any,ruleOwner,"spend_rules")).find(r=>r.id==="a")!.category,"custom:Renamed");
    assert.equal((await readRows(db as any,ruleOwner,"finance_budgets"))[0].category,"custom:Renamed");
    await assert.rejects(executeQuery(db as any,ruleOwner,query("finance_categories","delete",{filters:[["id","eq","cat-alpha"]]})),/in use/);
    await executeQuery(db as any,ruleOwner,query("finance_categories","insert",{rows:{id:"unused",key:"custom:Unused"}}));
    await executeQuery(db as any,ruleOwner,query("finance_categories","update",{rows:{key:"custom:Unused renamed"},filters:[["id","eq","unused"]]}));
    await executeQuery(db as any,ruleOwner,query("finance_categories","delete",{filters:[["id","eq","unused"]]}));
    await executeQuery(db as any,ruleOwner,query("spend_rules","delete",{filters:[["id","eq","b"]]}));
    assert.equal((await readRows(db as any,ruleOwner,"spend_rules")).length,1);
    assert.throws(()=>validateCategoryProposals({cards:[{id:"made-up",category:"custom:Renamed"}],bank:[]},["real"],[],["custom:Renamed"]));
    assert.throws(()=>validateCategoryProposals({cards:[{id:"real",category:"invented"}],bank:[]},["real"],[],["custom:Renamed"]));
    assert.deepEqual(validateCategoryProposals({cards:[{id:"real",category:""}],bank:[]},["real"],[],["custom:Renamed"]).cards,[{id:"real",category:""}]);
    for(const path of ["components/finance/TipsTab.tsx","components/finance/RcmsUploader.tsx","components/lumos","app/api/lumos","app/api/finance/classify","app/api/finance/rcms-registration","lib/lumos","lib/rcms"]) {
        await assert.rejects(readFile(path));
    }
    const nav=await readFile("components/finance/MoneyShell.tsx","utf8");
    assert(!/TIPS|연구비|사후 증빙|요청 내역|nonspend|RCMS/.test(nav));
    await assert.rejects(executeQuery(db as any,ruleOwner,query("app_settings","insert",{rows:{key:"project",value:{}}})));
    await mf.dispose();
    mf = new Miniflare(options);
    db = await mf.getD1Database("DB");
    assert.equal((await readRows(db as any, ruleOwner, "spend_rules"))[0].category, "custom:Renamed");
    assert.equal((await readRows(db as any, ruleOwner, "finance_categories")).length, 2);
    assert.equal((await readRows(db as any, "owner-a", "bank_transactions"))[0].withdrawal, 150);
    configureMerchantAliases([["fixture-a", "fixture-b"]]);
    assert.equal(normalizeMerchant("fixture-a"), normalizeMerchant("fixture-b"));
    assert.deepEqual(matchByName("1010_fixture-a_receipt.pdf", "2026-10", [{ id: "candidate", kind: "card", date: "2026-10-10", name: "fixture-b" }]).auto, [{ id: "candidate", kind: "card" }]);
    configureMerchantAliases([]);
    assert.equal(accountOf("일반.csv"), "일반.csv");
    assert.equal(accountOf("unknown.csv"), "unknown.csv");
    const statementRow = (id: string, txDate: string, txTime: string, balance: number | null, withdrawal = 0, deposit = 0) => ({ id, txDate, txTime, sourceFile: "일반.xlsx", balance, withdrawal, deposit } as any);
    const statements = [statementRow("later", "2026-10-03", "10:00", 50, 10), statementRow("first", "2026-10-01", "09:00", 100), statementRow("tail", "2026-10-04", "09:00", null, 0, 5)];
    assert.equal(accountBalances(statements.slice(0, 2), "2026-10")[0].balance, 50, "The newest statement balance overrides incomplete earlier history");
    assert.equal(accountBalances([...statements].reverse(), "2026-10")[0].balance, 55, "Only transactions after the last known balance are accumulated regardless of input order");
    assert.equal(accountBalances([...statements, statementRow("future", "2026-11-01", "09:00", 999)], "2026-10")[0].balance, 55);
    assert.equal(accountBalances([statementRow("am", "2026-10-03", "09:00", 50), statementRow("pm", "2026-10-03", "15:00", 40)], "2026-10")[0].balance, 40);

    const card = (id: string, amount: number | null, date = "2026-10-10", status = "") => ({ id, amount, purchaseDate: date, approvalDate: "2026-09-30", status, merchant: "test fixture", itemName: "", spendCategory: "custom:Equipment", cardMeta: {} } as any);
    assert.equal(moneyCardDate(card("a", 100)), "2026-10-10");
    assert.equal(moneyTotals([card("a", 100), card("b", -20), card("cancel", 50, "2026-10-10", "취소"), card("fx", null)], []).spending, 80);
    assert.equal(moneyTotals([card("a", 100)], [], [{ cardChargeId: "a", amount: 50, spendCategory: "custom:Supplies" }]).invalidSplitCount, 1);
    assert.equal(recurringMerchants([card("a", 100, "2026-08-10"), card("b", 100, "2026-09-10"), card("c", 100)]).length, 1);
    assert(!validInvoiceAmounts({ supplyAmount: 100, taxAmount: 10, totalAmount: 999 }));
    const sheet = XLSX.utils.aoa_to_sheet([["작성일자", "공급자상호", "공급가액", "세액", "합계금액", "승인번호"], ["2026-10-10", "fixture", 100, 10, 110, "TEST-ONLY-001"]]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "매입");
    const file = new File([XLSX.write(workbook, { type: "array", bookType: "xlsx" })], "purchase-test.xlsx");
    const parsed = await parseFinanceFile(file);
    assert.equal(parsed.invoices.length, 1);
    assert.equal(parsed.invoices[0].total_amount, 110);
    console.log("PASS: user categories/rules CRUD, precedence, preview/apply, import/manual preservation, removed surfaces, empty D1, CRUD, cross-owner isolation, duplicate import, invalid preservation, atomic batch validation, restart persistence, record dates/invoices, split relation checks, date filters, core money/recurring logic and original XLSX parser.");
}
finally {
    await mf.dispose();
    await rm(directory, { recursive: true, force: true });
}
