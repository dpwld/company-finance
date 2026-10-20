/** Explicit LOCAL screenshot fixture. Never imported by application/runtime code. */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const mode = process.argv[2], target = new URL(process.argv[3] || "http://127.0.0.1:5182");
if (!["seed", "cleanup", "status"].includes(mode)) throw new Error("Usage: node scripts/seed-fictional-finance.mjs seed|cleanup|status http://127.0.0.1:5182");
if (target.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) || target.port !== "5182" || target.username || target.password || target.pathname !== "/" || target.search || target.hash) throw new Error("Fixture is restricted to an HTTP loopback preview on port 5182.");
const base = target.origin, prefix = "fictional-finance-2026-", manifestPath = fileURLToPath(new URL("../.sites-runtime/fictional-finance-manifest.json", import.meta.url));
const tables = ["finance_categories", "spend_rules", "finance_budgets", "card_charges", "bank_transactions"];
async function query(table, action = "select", extra = {}) {
 const response = await fetch(base + "/api/data", { method: "POST", redirect: "error", headers: { "Content-Type": "application/json", Cookie: "__sites_local_auth=1" }, body: JSON.stringify({ table, action, filters: [], orders: [], select: "*", ...extra }) });
 const value = await response.json();
 if (!response.ok) throw new Error(`${table}: ${JSON.stringify(value)}`);
 return value.data;
}
const id = name => prefix + name;
const categoryNames = ["구독 서비스", "사무 운영", "회의·식비", "이동·배송", "제작·장비", "수입"];
const categories = categoryNames.map((name, i) => ({ id: id(`category-${i + 1}`), key: `custom:${name}` }));
const key = i => categories[i].key;
const definitions = [
 ["노을상자 클라우드 (가상)", 0, "exact", 10], ["별가루 보드 (가상)", 0, "exact", 10], ["달송 문서 (가상)", 0, "exact", 10],
 ["종이섬", 1, "contains", 40], ["모래정원", 1, "contains", 40], ["구름접시", 2, "contains", 40], ["모서리", 3, "contains", 40], ["빛결", 4, "contains", 40], ["민트달", 5, "contains", 40],
];
const rules = definitions.map(([pattern, c, match_mode, priority], i) => ({ id: id(`rule-${i + 1}`), pattern, category: key(c), match_mode, priority }));
const budgets = [450000, 350000, 500000, 200000, 1100000].map((amount, i) => ({ id: id(`budget-${i + 1}`), category: key(i), amount }));
// Three August subscriptions supply the original recurring detector's three-month history.
const cardRows = [
 ["08-02", "노을상자 클라우드 (가상)", 129000], ["08-04", "별가루 보드 (가상)", 39000], ["08-08", "달송 문서 (가상)", 24000],
 ["09-02", "노을상자 클라우드 (가상)", 129000], ["09-04", "별가루 보드 (가상)", 39000], ["09-08", "달송 문서 (가상)", 24000],
 ["09-03", "종이섬 가상문구", 84000], ["09-07", "구름접시 가상식당", 58000], ["09-10", "모서리 가상이동", 23000], ["09-12", "빛결 가상공방", 360000],
 ["09-16", "구름접시 가상식당", 76000], ["09-20", "종이섬 가상문구", 42000], ["09-24", "파도상점 (가상)", 68000], ["09-26", "모서리 가상배송", 17000], ["09-28", "구름접시 가상식당", 64000],
 ["10-02", "노을상자 클라우드 (가상)", 129000], ["10-04", "별가루 보드 (가상)", 39000], ["10-08", "달송 문서 (가상)", 24000],
 ["10-01", "빛결 가상공방", 829000], ["10-03", "구름접시 가상식당", 78000], ["10-05", "종이섬 가상문구", 146000], ["10-07", "모서리 가상이동", 32000],
 ["10-09", "구름접시 가상식당", 96000], ["10-10", "빛결 가상공방", 215000], ["10-12", "종이섬 가상문구", 62000], ["10-14", "구름접시 가상식당", 84000],
 ["10-15", "파도상점 (가상)", 47000], ["10-16", "모서리 가상배송", 19000], ["10-18", "구름접시 가상식당", 112000], ["10-19", "초승조각 (가상)", 55000],
];
const cards = cardRows.map(([day, merchant, amount], i) => ({ id: id(`card-${String(i + 1).padStart(2, "0")}`), dedupe_key: id(`card-${i + 1}`), approval_date: `2026-${day}`, purchase_date: `2026-${day}`, month: `2026-${day.slice(0, 2)}`, merchant, amount, status: "", source_file: "FICTIONAL_가상카드.xlsx", remarks: "FICTIONAL — 공개 예시용 가상 거래", card_meta: { "승인구분": "국내" } }));
const bankRows = [
 ["09-01", "가상 운영계좌.xlsx", "초기 운영자금 (가상)", 8000000, null, 8000000],
 ["09-05", "가상 운영계좌.xlsx", "모래정원 가상공간", null, 800000, 7200000],
 ["09-25", "가상 운영계좌.xlsx", "민트달 가상고객", 2400000, null, 9600000],
 ["10-01", "가상 운영계좌.xlsx", "민트달 가상고객", 1800000, null, 11400000],
 ["10-05", "가상 운영계좌.xlsx", "모래정원 가상공간", null, 800000, 10600000],
 ["10-10", "가상 운영계좌.xlsx", "빛결 가상공방", null, 250000, 10350000],
 ["10-18", "가상 운영계좌.xlsx", "민트달 가상고객", 2200000, null, 12550000],
 ["09-03", "가상 적립계좌.xlsx", "초기 적립금 (가상)", 2000000, null, 2000000],
 ["10-13", "가상 적립계좌.xlsx", "적립 이자 (가상)", 8000, null, 2008000],
];
const bank = bankRows.map(([day, source_file, counterparty, deposit, withdrawal, balance], i) => ({ id: id(`bank-${i + 1}`), dedupe_key: id(`bank-${i + 1}`), tx_date: `2026-${day}`, tx_time: "10:00:00", source_file, counterparty, deposit, withdrawal, balance, memo: "FICTIONAL — 공개 예시용 가상 거래" }));
const dataset = { finance_categories: categories, spend_rules: rules, finance_budgets: budgets, card_charges: cards, bank_transactions: bank };
let manifest;
try { manifest = JSON.parse(await readFile(manifestPath, "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; }
if (manifest && (manifest.base !== base || manifest.prefix !== prefix)) throw new Error("Manifest belongs to a different target; do not reuse it.");
async function save() { await mkdir(new URL("../.sites-runtime/", import.meta.url), { recursive: true }); await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n"); }
if (mode === "cleanup") {
 if (!manifest) throw new Error("No manifest exists; refusing to guess which records may be removed.");
 for (const table of [...tables].reverse()) {
  for (const entry of (manifest.additionalCleanup || []).filter(entry => entry.table === table)) {
   const current = await query(table, "select", { filters: [["id", "eq", entry.id]] });
   if (current.length) {
    assert(Object.entries(entry.expected).every(([field, value]) => current[0][field] === value), "Browser-created demo record changed; refusing cleanup.");
    await query(table, "delete", { filters: [["id", "eq", entry.id]] });
   }
  }
  for (const recordId of manifest.ids[table] || []) {
   if (!recordId.startsWith(prefix)) throw new Error("Unexpected non-demo id in manifest.");
   await query(table, "delete", { filters: [["id", "eq", recordId]] });
  }
 }
 await writeFile(manifestPath.replace("manifest.json", "cleanup.json"), JSON.stringify({ ...manifest, cleanedAt: new Date().toISOString() }, null, 2) + "\n");
 await unlink(manifestPath);
 console.log("Removed only manifest-listed fictional records. Pre-existing data was preserved.");
} else {
 const existing = Object.fromEntries(await Promise.all(tables.map(async table => [table, await query(table)])));
 if (mode === "seed") {
  if (manifest) throw new Error(`Fixture already has a manifest. Use status or cleanup first: ${manifestPath}`);
  for (const table of tables) {
   assert(!existing[table].some(r => String(r.id).startsWith(prefix)), `Unmanaged demo IDs already exist in ${table}; refusing to overwrite.`);
   for (const row of dataset[table]) {
    const field = table === "finance_categories" ? "key" : table === "finance_budgets" ? "category" : table === "spend_rules" ? "pattern" : "dedupe_key";
    assert(!existing[table].some(r => r[field] === row[field]), `Existing user ${field} collision in ${table}; refusing to overwrite.`);
   }
  }
  manifest = { base, prefix, fictional: true, createdAt: new Date().toISOString(), existingCounts: Object.fromEntries(tables.map(t => [t, existing[t].length])), ids: Object.fromEntries(tables.map(t => [t, []])) };
  await save();
  for (const table of tables) {
   // Record bounded intended IDs before requesting insertion, so cleanup also works after an interrupted response.
   manifest.ids[table] = dataset[table].map(r => r.id); await save();
   const saved = await query(table, "insert", { rows: dataset[table] });
   assert.equal(saved.length, dataset[table].length);
  }
 }
 const stored = Object.fromEntries(await Promise.all(tables.map(async table => [table, (await query(table)).filter(r => String(r.id).startsWith(prefix))])));
 const october = stored.card_charges.filter(r => r.purchase_date.startsWith("2026-10"));
 const recurring = new Map(); for (const r of stored.card_charges) { const months = recurring.get(r.merchant) || new Set(); months.add(r.month); recurring.set(r.merchant, months); }
 console.log(JSON.stringify({ target: base, fictional: true, counts: Object.fromEntries(tables.map(t => [t, stored[t].length])), octoberCardSpend: october.reduce((a,r)=>a+r.amount,0), octoberUnclassifiedCards: october.filter(r=>!r.spend_category).length, recurringMerchants: [...recurring].filter(([,months])=>months.size>=3).map(([name])=>name), knownBalances: Object.fromEntries([...new Set(stored.bank_transactions.map(r=>r.source_file))].map(source=>[source,stored.bank_transactions.filter(r=>r.source_file===source).sort((a,b)=>a.tx_date.localeCompare(b.tx_date)).at(-1).balance])), manifest: manifestPath }, null, 2));
 if (mode === "seed") { assert.equal(stored.card_charges.length, 30); assert.equal(october.length, 15); assert.equal(october.filter(r=>!r.spend_category).length, 2); }
}
