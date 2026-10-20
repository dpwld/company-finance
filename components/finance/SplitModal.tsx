"use client";
import { useEffect, useState } from "react";
import { Modal } from "@/components/ds/feedback/Modal";
import { fetchMoneyCategories, saveChargeSplits, type ChargeSplit, type SplitTarget } from "@/lib/data/finance";
import { spendCategoryLabel, wonFmt } from "@/lib/finance/spend";
export interface SplitSubject { kind: "card"|"bank"; id: string; title: string; amount: number }
export interface EvidenceRef { id: string; fileName: string }
export function SplitModal({subject,existing,onClose,onSaved,onError}: { subject:SplitSubject; existing:ChargeSplit[]; evidence:EvidenceRef[]; onClose:()=>void; onSaved:()=>void; onError:(message:string)=>void }) {
 const [categories,setCategories]=useState<string[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const [lines,setLines]=useState(existing.length?existing.map(s=>({label:s.label,amount:String(s.amount),spendCategory:s.spendCategory})):[{label:"",amount:String(subject.amount),spendCategory:""}]);
 useEffect(()=>{fetchMoneyCategories().then(setCategories).catch(()=>setError("카테고리를 불러오지 못했습니다."));},[]);
 const target:SplitTarget=subject.kind==="card"?{cardChargeId:subject.id}:{bankTxId:subject.id};
 async function save(clear=false){setBusy(true);setError("");try {const values=lines.map(l=>({...l,amount:Number(l.amount)}));if(!clear && (values.some(l=>!Number.isFinite(l.amount)||l.amount<=0)||Math.abs(values.reduce((a,l)=>a+l.amount,0)-subject.amount)>.01))throw new Error("분할 합계가 거래 금액과 같아야 합니다. 각 금액을 양수로 입력하세요.");await saveChargeSplits(target,clear?[]:values);onSaved();}catch(e){const message=e instanceof Error?e.message:"분할 저장 실패";setError(message);onError(message);}finally{setBusy(false);}}
 return <Modal open onClose={onClose} title={`분할 · ${subject.title} (${wonFmt(subject.amount)})`} size="lg"><div style={{display:"grid",gap:10}}>{lines.map((line,i)=><div key={i} style={{display:"flex",gap:8}}><input aria-label={`항목 ${i+1}`} placeholder="항목명" value={line.label} onChange={e=>setLines(ls=>ls.map((l,j)=>j===i?{...l,label:e.target.value}:l))}/><input aria-label={`금액 ${i+1}`} type="number" value={line.amount} onChange={e=>setLines(ls=>ls.map((l,j)=>j===i?{...l,amount:e.target.value}:l))}/><select aria-label={`분류 ${i+1}`} value={line.spendCategory} onChange={e=>setLines(ls=>ls.map((l,j)=>j===i?{...l,spendCategory:e.target.value}:l))}><option value="">미분류</option>{categories.map(c=><option key={c} value={c}>{spendCategoryLabel(c)}</option>)}</select><button disabled={busy} onClick={()=>setLines(ls=>ls.filter((_,j)=>j!==i))}>삭제</button></div>)}<p>합계 {wonFmt(lines.reduce((a,l)=>a+(Number(l.amount)||0),0))} / {wonFmt(subject.amount)}</p><button disabled={busy} onClick={()=>setLines(ls=>[...ls,{label:"",amount:"",spendCategory:""}])}>항목 추가</button><button disabled={busy||!lines.length} onClick={()=>void save()}>분할 저장</button>{existing.length>0&&<button disabled={busy} onClick={()=>void save(true)}>분할 해제</button>}{error&&<p role="alert">{error}</p>}</div></Modal>;
}
