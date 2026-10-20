"use client";
import { useEffect, useState } from "react";
import { Modal } from "@/components/ds/feedback/Modal";
import { createMoneyCategory, deleteMoneyCategory, renameMoneyCategory, fetchMoneyCategories, fetchSpendRules, insertSpendRule, updateSpendRule, deleteSpendRule, previewSpendRules, type SpendRule, type RulePreview } from "@/lib/data/finance";
import { spendCategoryLabel } from "@/lib/finance/spend";

export function SpendRulesModal({ open, onClose, onChanged }: { open: boolean; onClose: () => void; onChanged: () => void }) {
 const [categories,setCategories] = useState<string[]>([]), [rules,setRules] = useState<SpendRule[]>([]);
 const [name,setName] = useState(""), [editing,setEditing] = useState("");
 const [pattern,setPattern] = useState(""), [category,setCategory] = useState(""), [mode,setMode] = useState<"exact"|"contains">("exact"), [priority,setPriority] = useState(100);
 const [preview,setPreview] = useState<RulePreview[] | null>(null), [busy,setBusy] = useState(false), [notice,setNotice] = useState("");
 async function reload() { const [c,r] = await Promise.all([fetchMoneyCategories(),fetchSpendRules()]); setCategories(c);setRules(r); }
 useEffect(() => { if(open) { reload().catch(e => setNotice(e.message)); setPreview(null); } },[open]);
 async function run(task: () => Promise<void>) { setBusy(true);setNotice(""); try { await task();await reload();setPreview(null);onChanged(); } catch(e) { setNotice(e instanceof Error ? e.message : "Could not save changes."); } finally {setBusy(false);} }
 const inputStyle = { border:"1px solid var(--border-subtle)",borderRadius:6,padding:8,background:"var(--surface-default)",color:"var(--text-default)" };
 return <Modal open={open} onClose={() => { if(!busy) onClose(); }} title="Categories & rules" subtitle="Only your categories are used. Unmatched transactions stay uncategorized." size="lg">
  <div style={{display:"grid",gap:18}}>
   <section><h3>Your categories</h3><form onSubmit={e => {e.preventDefault();void run(async () => {await createMoneyCategory(name);setName("");});}} style={{display:"flex",gap:8}}><input style={inputStyle} aria-label="New category name" maxLength={40} value={name} onChange={e=>setName(e.target.value)} placeholder="Choose a category name"/><button disabled={busy||!name.trim()} type="submit">Add category</button></form>
    {categories.length===0 && <p>No categories yet. Add your first category above.</p>}
    {categories.map(key => <div key={key} style={{display:"flex",gap:8,alignItems:"center",marginTop:8}}><span style={{flex:1}}>{spendCategoryLabel(key)}</span><button disabled={busy} onClick={() => {const label=window.prompt("New category name",spendCategoryLabel(key));if(label?.trim() && label.trim()!==spendCategoryLabel(key)) void run(()=>renameMoneyCategory(key,label));}}>Rename</button><button disabled={busy} onClick={()=>void run(()=>deleteMoneyCategory(key))}>Delete</button></div>)}
    <p className="money-note">Renaming updates linked transactions, rules, and budgets. Remove existing links before deleting a category.</p>
   </section>
   <section><h3>{editing ? "Edit rule" : "Add rule"}</h3>
    <form onSubmit={e => {e.preventDefault();void run(async()=>{if(editing) await updateSpendRule(editing,{pattern:pattern.trim(),category,match_mode:mode,priority});else await insertSpendRule(pattern,category,"",mode,priority);setEditing("");setPattern("");});}} style={{display:"flex",gap:8,flexWrap:"wrap"}}>
     <input style={inputStyle} aria-label="Transaction name to match" maxLength={200} placeholder="Transaction name" value={pattern} onChange={e=>setPattern(e.target.value)}/>
     <select style={inputStyle} aria-label="Match type" value={mode} onChange={e=>setMode(e.target.value as "exact"|"contains")}><option value="exact">Exact match</option><option value="contains">Contains</option></select>
     <select style={inputStyle} aria-label="Rule category" value={category} onChange={e=>setCategory(e.target.value)}><option value="">Select category</option>{categories.map(key=><option key={key} value={key}>{spendCategoryLabel(key)}</option>)}</select>
     <label>Priority <input style={{...inputStyle,width:85}} aria-label="Rule priority" type="number" min={0} max={1000000} step={1} value={priority} onChange={e=>setPriority(Number(e.target.value))}/></label>
     <button type="submit" disabled={busy||!pattern.trim()||!category||!Number.isInteger(priority)}>{editing?"Save changes":"Save rule"}</button>{editing&&<button type="button" onClick={()=>{setEditing("");setPattern("");}}>Cancel editing</button>}
    </form>
    <p className="money-note">Rules match the merchant or counterparty name, falling back to the item or description. Case and surrounding spaces are ignored. Lower priority numbers run first; ties use rule ID order. Existing categories are preserved.</p>
    {rules.map(rule=><div key={rule.id} style={{display:"flex",gap:8,alignItems:"center",padding:"10px 0",borderBottom:"1px solid var(--border-subtle)"}}><span style={{flex:1}}>{rule.priority} · {rule.pattern} · {rule.matchMode==="exact"?"Exact match":"Contains"} → {spendCategoryLabel(rule.category)}</span><button disabled={busy} onClick={()=>{setEditing(rule.id);setPattern(rule.pattern);setCategory(rule.category);setMode(rule.matchMode);setPriority(rule.priority);}}>Edit</button><button disabled={busy} onClick={()=>void run(()=>deleteSpendRule(rule.id))}>Delete</button></div>)}
    {rules.length===0 && <p>No saved rules yet.</p>}
   </section>
   <section><button disabled={busy||rules.length===0} onClick={async()=>{setBusy(true);setNotice("");try{setPreview((await previewSpendRules()).matches);}catch(e){setNotice(e instanceof Error?e.message:"Could not preview rules");}finally{setBusy(false);}}}>Preview uncategorized transactions · All time</button>
    {preview!==null&&<><p>Matching uncategorized transactions: {preview.length} records</p><div style={{maxHeight:220,overflow:"auto"}}>{preview.map(row=><p key={`${row.kind}-${row.id}`}>{row.name} → {spendCategoryLabel(row.category)}</p>)}</div><button disabled={busy||preview.length===0} onClick={()=>void run(async()=>{const result=await previewSpendRules(true);setNotice(`${result.applied} transactions updated.`);})}>Apply rules to uncategorized transactions</button></>}
    <p className="money-note">Saved rules apply automatically to new imports. Editing rules does not change existing transactions. Preview and apply above to update them.</p>
   </section>
   {notice&&<p role="status">{notice}</p>}
  </div>
 </Modal>;
}
