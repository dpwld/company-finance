/** Only saved user rules participate. Lower priority numbers win; id breaks ties deterministically. */
export interface Rule { id: string; pattern: string; category: string; matchMode?: "exact" | "contains"; priority?: number }
export function matchingRule(rules: Rule[], texts: (string | null | undefined)[]): Rule | undefined {
 const names = texts.filter((v): v is string => Boolean(v)).map(v => v.trim().toLocaleLowerCase());
 return [...rules].sort((a,b) => (a.priority ?? 100) - (b.priority ?? 100) || a.id.localeCompare(b.id)).find(rule => {
  const pattern = rule.pattern.trim().toLocaleLowerCase();
  return Boolean(pattern && names.some(name => rule.matchMode === "contains" ? name.includes(pattern) : name === pattern));
 });
}
export const matchSpendRule = (rules: Rule[], texts: (string | null | undefined)[]) => matchingRule(rules, texts)?.category ?? null;
export const ruleFromRow = (r: any): Rule => ({ id: r.id, pattern: r.pattern, category: r.category, matchMode: r.match_mode || "exact", priority: r.priority ?? 100 });
export const recordRuleTexts = (table: string, row: any): string[] => table === "card_charges" ? [row.merchant || row.item_name || ""] : [row.counterparty || row.description || ""];
/** Provider output cannot invent a transaction id or a category outside the user's catalog. */
export function validateCategoryProposals(value: unknown, cardIds: string[], bankIds: string[], categories: string[]) {
 const input=value as {cards?:{id:string;category:string}[];bank?:{id:string;category:string}[]};
 const validate=(rows:unknown,ids:string[])=>{
  if(!Array.isArray(rows)) throw new Error("The AI response has an invalid format.");
  const seen=new Set<string>();
  return rows.map(row=>{
   if(!row || typeof row.id!=="string" || !ids.includes(row.id) || seen.has(row.id) || typeof row.category!=="string" || row.category!==""&&!categories.includes(row.category)) throw new Error("The AI response includes transactions or categories outside your account.");
   seen.add(row.id);return {id:row.id,category:row.category};
  });
 };
 return {cards:validate(input?.cards,cardIds),bank:validate(input?.bank,bankIds)};
}
