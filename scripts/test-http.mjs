import assert from "node:assert/strict";
const base=process.env.FINANCE_TEST_URL||"http://127.0.0.1:5182";
const cookie="__sites_local_auth=1", token=crypto.randomUUID(),category=`custom:test-${token.slice(0,30)}`,path=`test/${token}.txt`,created=[];
async function api(body,auth=true){return fetch(base+"/api/data",{method:"POST",headers:{"Content-Type":"application/json",...(auth?{Cookie:cookie}:{})},body:JSON.stringify({filters:[],orders:[],select:"*",...body})});}
async function data(body){const response=await api(body);const value=await response.json();assert(response.ok,JSON.stringify(value));return value.data;}
try{
 assert.equal((await api({table:"finance_budgets",action:"select"},false)).status,401);
 const html=await fetch(base+"/",{headers:{Cookie:cookie}});assert.equal(html.status,200);assert((await html.text()).includes("사업비 메뉴"));
 for(const route of ["/api/finance/classify","/api/finance/rcms-registration","/api/lumos"]){assert.equal((await fetch(base+route,{method:"POST",headers:{Cookie:cookie,"Content-Type":"application/json"},body:"{}"})).status,404);}
 const cat=(await data({table:"finance_categories",action:"insert",rows:{key:category}}))[0];created.push(["finance_categories",cat.id]);
 const budget=(await data({table:"finance_budgets",action:"upsert",rows:{category,amount:1234}}))[0];created.push(["finance_budgets",budget.id]);
 assert.equal((await data({table:"finance_budgets",action:"select",filters:[["category","eq",category]]}))[0].amount,1234);
 assert.equal((await api({table:"finance_budgets",action:"update",rows:{amount:-1},filters:[["id","eq",budget.id]]})).status,400);
 assert.equal((await data({table:"finance_budgets",action:"select",filters:[["id","eq",budget.id]]}))[0].amount,1234);
 assert.equal((await fetch(base+"/api/data",{method:"POST",headers:{"Content-Type":"application/json",Cookie:cookie,Origin:"https://other.invalid"},body:JSON.stringify({table:"finance_budgets",action:"select",filters:[],orders:[],select:"*"})})).status,403);
 const bank=(await data({table:"bank_transactions",action:"insert",rows:{dedupe_key:token,tx_date:"2026-10-10",source_file:"일반-test.xlsx",withdrawal:100,deposit:null}}))[0];created.push(["bank_transactions",bank.id]);
 const split=async amount=>fetch(base+"/api/splits",{method:"POST",headers:{"Content-Type":"application/json",Cookie:cookie},body:JSON.stringify({target:{bankTxId:bank.id},lines:[{label:"test",amount,spendCategory:category}]})});
 assert.equal((await split(100)).status,200);assert.equal((await split(99)).status,400);
 assert.equal((await data({table:"charge_splits",action:"select",filters:[["bank_tx_id","eq",bank.id]]}))[0].amount,100);
 const files=base+`/api/files?bucket=evidence&path=${encodeURIComponent(path)}`;
 assert.equal((await fetch(files,{method:"PUT",headers:{Cookie:cookie,"Content-Type":"text/plain"},body:"test-only"})).status,200);
 assert.equal(await(await fetch(files,{headers:{Cookie:cookie}})).text(),"test-only");
 assert.equal((await fetch(files)).status,401);
 const response=await fetch(base+"/api/finance/spend-classify",{method:"POST",headers:{Cookie:cookie,"Content-Type":"application/json"},body:JSON.stringify({cards:[],bank:[]})});assert.equal(response.status,503);assert((await response.text()).includes("OPENAI_API_KEY"));
 const jobs=await(await fetch(base+"/api/jobs",{headers:{Cookie:cookie}})).json();assert(jobs.jobs.some(job=>job.operation==="spend-classify"&&job.status==="failed"));
 console.log("PASS HTTP: auth, SSR original workspace, D1 budget save/read, invalid edit preservation, origin rejection, atomic splits, authenticated R2 bytes, missing AI configuration and observable failure.");
}finally{
 for(const [table,id] of created.reverse())await api({table,action:"delete",filters:[["id","eq",id]]});
 await fetch(base+`/api/files?bucket=evidence&path=${encodeURIComponent(path)}`,{method:"DELETE",headers:{Cookie:cookie}});
}
