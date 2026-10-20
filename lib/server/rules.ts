import { readRows } from "./records";
import { matchingRule, ruleFromRow, recordRuleTexts } from "@/lib/finance/rules";
/** Preview and apply operate on the same owner's persisted, currently unclassified records. */
export async function applyUserRules(db: D1Database, owner: string, apply: boolean) {
 const rules = (await readRows(db, owner, "spend_rules")).map(ruleFromRow);
 const matches: { kind: "card" | "bank"; id: string; name: string; category: string; ruleId: string }[] = [];
 for (const [table, kind] of [["card_charges", "card"], ["bank_transactions", "bank"]] as const) {
  for (const row of await readRows(db, owner, table)) {
   if (row.spend_category && row.spend_category !== "uncategorized") continue;
   const texts = recordRuleTexts(table, row), rule = matchingRule(rules, texts);
   if (rule) matches.push({ kind, id: row.id, name: texts[0], category: rule.category, ruleId: rule.id });
  }
 }
 let applied = 0;
 if (apply && matches.length) {
  const results = await db.batch(matches.map(row => db.prepare("UPDATE finance_records SET payload=json_set(payload, '$.spend_category', ?) WHERE owner=? AND kind=? AND id=? AND (json_extract(payload, '$.spend_category') IS NULL OR json_extract(payload, '$.spend_category') IN ('', 'uncategorized'))").bind(row.category, owner, row.kind === "card" ? "card_charges" : "bank_transactions", row.id)));
  applied = results.reduce((sum,result) => sum + (result.meta.changes || 0),0);
 }
 return { matches, applied };
}
