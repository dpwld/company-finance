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
 async function run(task: () => Promise<void>) { setBusy(true);setNotice(""); try { await task();await reload();setPreview(null);onChanged(); } catch(e) { setNotice(e instanceof Error ? e.message : "저장하지 못했습니다."); } finally {setBusy(false);} }
 const inputStyle = { border:"1px solid var(--border-subtle)",borderRadius:6,padding:8,background:"var(--surface-default)",color:"var(--text-default)" };
 return <Modal open={open} onClose={() => { if(!busy) onClose(); }} title="카테고리·분류 규칙" subtitle="내가 만든 분류만 사용합니다. 규칙이 없거나 일치하지 않으면 미분류로 남습니다." size="lg">
  <div style={{display:"grid",gap:18}}>
   <section><h3>내 카테고리</h3><form onSubmit={e => {e.preventDefault();void run(async () => {await createMoneyCategory(name);setName("");});}} style={{display:"flex",gap:8}}><input style={inputStyle} aria-label="새 카테고리 이름" maxLength={40} value={name} onChange={e=>setName(e.target.value)} placeholder="직접 정한 카테고리 이름"/><button disabled={busy||!name.trim()} type="submit">카테고리 추가</button></form>
    {categories.length===0 && <p>아직 카테고리가 없습니다. 먼저 이름을 추가하세요.</p>}
    {categories.map(key => <div key={key} style={{display:"flex",gap:8,alignItems:"center",marginTop:8}}><span style={{flex:1}}>{spendCategoryLabel(key)}</span><button disabled={busy} onClick={() => {const label=window.prompt("새 카테고리 이름",spendCategoryLabel(key));if(label?.trim() && label.trim()!==spendCategoryLabel(key)) void run(()=>renameMoneyCategory(key,label));}}>이름 변경</button><button disabled={busy} onClick={()=>void run(()=>deleteMoneyCategory(key))}>삭제</button></div>)}
    <p className="money-note">이름을 바꾸면 연결된 거래·규칙·예산도 함께 바뀝니다. 사용 중인 카테고리는 연결을 해제한 뒤 삭제할 수 있습니다.</p>
   </section>
   <section><h3>{editing ? "규칙 수정" : "규칙 추가"}</h3>
    <form onSubmit={e => {e.preventDefault();void run(async()=>{if(editing) await updateSpendRule(editing,{pattern:pattern.trim(),category,match_mode:mode,priority});else await insertSpendRule(pattern,category,"",mode,priority);setEditing("");setPattern("");});}} style={{display:"flex",gap:8,flexWrap:"wrap"}}>
     <input style={inputStyle} aria-label="일치시킬 거래명" maxLength={200} placeholder="거래명" value={pattern} onChange={e=>setPattern(e.target.value)}/>
     <select style={inputStyle} aria-label="규칙 일치 방식" value={mode} onChange={e=>setMode(e.target.value as "exact"|"contains")}><option value="exact">정확히 일치</option><option value="contains">문구 포함</option></select>
     <select style={inputStyle} aria-label="규칙 카테고리" value={category} onChange={e=>setCategory(e.target.value)}><option value="">카테고리 선택</option>{categories.map(key=><option key={key} value={key}>{spendCategoryLabel(key)}</option>)}</select>
     <label>우선순위 <input style={{...inputStyle,width:85}} aria-label="규칙 우선순위" type="number" min={0} max={1000000} step={1} value={priority} onChange={e=>setPriority(Number(e.target.value))}/></label>
     <button type="submit" disabled={busy||!pattern.trim()||!category||!Number.isInteger(priority)}>{editing?"수정 저장":"규칙 저장"}</button>{editing&&<button type="button" onClick={()=>{setEditing("");setPattern("");}}>수정 취소</button>}
    </form>
    <p className="money-note">거래명은 카드의 가맹점명(없으면 품목명), 은행의 상대처명(없으면 적요)입니다. 앞뒤 공백·대소문자는 무시합니다. 우선순위 숫자가 작을수록 먼저 적용하고, 같으면 규칙 ID 순서입니다. 기존 분류는 덮어쓰지 않습니다.</p>
    {rules.map(rule=><div key={rule.id} style={{display:"flex",gap:8,alignItems:"center",padding:"10px 0",borderBottom:"1px solid var(--border-subtle)"}}><span style={{flex:1}}>{rule.priority} · {rule.pattern} · {rule.matchMode==="exact"?"정확히 일치":"문구 포함"} → {spendCategoryLabel(rule.category)}</span><button disabled={busy} onClick={()=>{setEditing(rule.id);setPattern(rule.pattern);setCategory(rule.category);setMode(rule.matchMode);setPriority(rule.priority);}}>수정</button><button disabled={busy} onClick={()=>void run(()=>deleteSpendRule(rule.id))}>삭제</button></div>)}
    {rules.length===0 && <p>저장된 규칙이 없습니다.</p>}
   </section>
   <section><button disabled={busy||rules.length===0} onClick={async()=>{setBusy(true);setNotice("");try{setPreview((await previewSpendRules()).matches);}catch(e){setNotice(e instanceof Error?e.message:"미리보기 실패");}finally{setBusy(false);}}}>전체 기간 미분류 거래 미리보기</button>
    {preview!==null&&<><p>일치하는 미분류 거래 {preview.length}건</p><div style={{maxHeight:220,overflow:"auto"}}>{preview.map(row=><p key={`${row.kind}-${row.id}`}>{row.name} → {spendCategoryLabel(row.category)}</p>)}</div><button disabled={busy||preview.length===0} onClick={()=>void run(async()=>{const result=await previewSpendRules(true);setNotice(`${result.applied}건에 저장했습니다.`);})}>미분류에 규칙 적용</button></>}
    <p className="money-note">새로 가져오는 거래에는 저장된 규칙을 자동 적용합니다. 저장·수정·삭제만으로 기존 거래의 분류를 바꾸지 않습니다. 위 미리보기 후 적용하세요.</p>
   </section>
   {notice&&<p role="status">{notice}</p>}
  </div>
 </Modal>;
}
