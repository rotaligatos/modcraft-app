// Runs training scenario 14 headless (Sheets emulated, network blocked). node tools/sim_trn14.mjs ; CANCEL=1 for the Cancel path.
import { createRequire } from 'module'; import { pathToFileURL } from 'url'; import path from 'path';
const require = createRequire(import.meta.url); const { chromium } = require('playwright');
const FILE = pathToFileURL(path.resolve('index.html')).href;
const browser = await chromium.launch(); const page = await browser.newPage({viewport:{width:1440,height:900}});
const errs=[], logs=[]; page.on('pageerror',e=>errs.push(e.message+' @ '+(e.stack||'').split(String.fromCharCode(10)).slice(1,4).join(' | '))); page.on('console',m=>{const t=m.text(); logs.push(m.type()+': '+t.slice(0,300));});
// ── tiny Google Sheets emulator ──
const SH={}; const col=s=>{let n=0;for(const c of s)n=n*26+c.charCodeAt(0)-64;return n;};
function parse(r){ r=decodeURIComponent(r); const m=r.match(/^'?([^'!]+)'?(?:!([A-Z]*)(\d*)(?::([A-Z]*)(\d*))?)?$/); if(!m) return null;
  return {tab:m[1],c1:m[2]?col(m[2]):1,r1:m[3]?+m[3]:1,c2:m[4]?col(m[4]):(m[2]&&!m[4]?col(m[2]):999),r2:m[5]?+m[5]:(m[3]&&!m[4]?+m[3]:999999)}; }
function get(r){ const p=parse(r); const t=SH[p.tab]||[]; const out=[]; for(let i=p.r1;i<=Math.min(p.r2,t.length);i++){ const row=(t[i-1]||[]).slice(p.c1-1,p.c2); out.push(row);} while(out.length&&!out[out.length-1].length) out.pop(); return {range:r,values:out}; }
function put(r,vals){ const p=parse(r); const t=SH[p.tab]=SH[p.tab]||[]; vals.forEach((row,i)=>{ const ri=p.r1-1+i; t[ri]=t[ri]||[]; row.forEach((v,j)=>{ t[ri][p.c1-1+j]=v==null?'':String(v); }); }); return {updatedRange:r}; }
await page.route('**/*', async route=>{ const u=route.request().url(); if(u.startsWith('file:')) return route.continue();
  if(u.includes('sheets.googleapis.com')){ const m=u.match(/spreadsheets\/[^/]+(.*)$/); let rest=m?m[1]:''; const meth=route.request().method(); let body={};
    try{ body=JSON.parse(route.request().postData()||'{}'); }catch(e){}
    let res={};
    if(rest.startsWith('/values:batchGet')){ const q=new URL(u).searchParams.getAll('ranges'); res={valueRanges:q.map(get)}; }
    else if(rest.startsWith('/values:batchUpdate')){ (body.data||[]).forEach(d=>put(d.range,d.values)); res={}; }
    else if(rest.startsWith('/values/')){ let rg=rest.slice(8).split('?')[0];
      if(rg.endsWith(':append')){ rg=decodeURIComponent(rg.slice(0,-7)); const p=parse(rg); const t=SH[p.tab]=SH[p.tab]||[]; (body.values||[]).forEach(r=>t.push(r.map(v=>v==null?'':String(v)))); res={updates:{updatedRange:p.tab+'!A'+t.length}}; }
      else if(rg.endsWith(':clear')){ res={}; }
      else if(meth==='PUT'){ res=put(decodeURIComponent(rg),body.values||[]); }
      else res=get(rg); }
    else if(rest.startsWith(':batchUpdate')){ res={replies:[]}; }
    else { res={sheets:Object.keys(SH).concat(['TRN Quotations','TRN Quotation State','TRN Activity Log','TRN Clients']).map((t,i)=>({properties:{title:t,sheetId:i+1}}))}; }
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(res)}); }
  if(u.includes('googleapis.com')) return route.fulfill({status:200,contentType:'application/json',body:'{"files":[]}'});
  return route.abort(); });
await page.addInitScript(()=>{ localStorage.setItem('mc_training','1'); });
await page.goto(FILE,{waitUntil:'load',timeout:30000}); await page.waitForTimeout(1500);
const W=ms=>page.waitForTimeout(ms);
const st=()=>page.evaluate(()=>{ const c=document.getElementById('trn-card'); return {card:c?[...c.querySelectorAll('.trn-step')].map(x=>x.textContent.trim().slice(0,70)):null, serial:window.qSerial, qLocked:window.qLocked, qApproved:window.qApproved, fqLocked:window.fqLocked, fqDA:!!window.fqDrawingAnalysis}; });
await page.evaluate(()=>{
  window.gToken='tok'; window.gTokenExpiry=Date.now()+36e5; window.gUser={email:'trainee@worldclasslaminate.com.ph',name:'Trainee'};
  window.currentRole='Admin'; window.currentUserCompany='World Class Laminate, Inc.';
  window.currentUserAcc={Dashboard:1,KPI:1,Reports:1,'Profit/Revenue':1,Quotations:1,Analytics:1,Approvals:1,Schedule:1,Projects:1,Clients:1,'Designers Support':1,Settings:1,Users:1};
  window.dbMaterials=[{name:'Real White PB 4x8 2F (18mm, Matte)',unit:'pc',price:1500},{name:'Light Gray PB MR 4x8 2F (18mm, Stipple)',unit:'pc',price:2100},{name:'Edgeband Real White 1mmx22mm',unit:'lm',price:20}];
  try{ document.getElementById('login-overlay').style.display='none'; }catch(e){}
  try{ gShowApp&&0; }catch(e){}
  trnStartScenario('fqmaterials');
});
await W(2500); await page.evaluate(()=>{ try{ trnDemoEnd(); }catch(e){} }); await W(500);
console.log('start',JSON.stringify(await st()));
// step 1: pick boards + load
await page.evaluate(()=>{ const s=MCL.state(); s.panels.forEach(p=>{ if(+p.L>0) p.mat='Real White PB 4x8 2F (18mm, Matte)'; }); MCL.load(); });
await W(2500); console.log('s1',JSON.stringify(await st()));
// step 2: reflect into new quotation, client, lock
const rev=await page.evaluate(()=>{ const s=prodState.summary; const out=[]; ["materials","hardware","services"].forEach(k=>(s[k]||[]).forEach((r,i)=>{ if(r.needsReview) out.push(k+i+": "+(r.name||r.searchTerm)+" | "+(r.reviewNote||"")+" | cands "+(r.matchCandidates||[]).length); })); (prodState.result.components||[]).forEach(c=>{ if(c.needsReview) out.push("comp "+c.name+": "+c.reviewNote); }); return out; }); console.log("summary",rev);
await page.evaluate(()=>{ window.alert=m=>console.log('ALERT: '+m); const s=prodState.summary;
  const m1=s.materials.find(r=>r.needsReview); console.log('M1 '+JSON.stringify({name:m1.name,st:m1.searchTerm,c:(m1.matchCandidates||[]).map(x=>x.name)})); const tape=(m1.matchCandidates||[]).find(x=>/edge/i.test(x.name)); _prodCatalogRowPicked('materials',s.materials.indexOf(m1),'Edgeband Real White 1mmx22mm');
  prodState.summary.services.forEach(r=>{ if(r.needsReview){ r.include=false; } }); // offline only: no real cutting rates loaded
  prodReflectToQuotation(); });
await W(1500);
console.log('after reflect',JSON.stringify(await st()), await page.evaluate(()=>JSON.stringify((qAreas[0]||{}).matItems||[])));
await page.evaluate(()=>{ navigate('quotation'); try{ qGoStep(1);}catch(e){} document.getElementById('cl-name').value='Training Client'; try{ qGoStep(2);}catch(e){} recalc(); });
await W(600);
await page.evaluate(()=>{ document.getElementById('lock-btn').click(); }); await W(500);
const okConfirm=async(tag)=>{ const m=await page.evaluate(()=>{ const o=document.getElementById('ov-confirm'); if(o&&o.classList.contains('show')){ const t=document.getElementById('ov-confirm-msg').textContent; _confirmOk(); return t; } return null; }); console.log(tag+' CONFIRM: '+(m===null?'(none)':m.slice(0,400))); };
await okConfirm('lock'); await W(3500);
console.log('after lock',JSON.stringify(await st()));
await page.evaluate(()=>{ document.getElementById('approve-btn').click(); }); await W(500); await okConfirm('approve'); await W(2500);
await page.evaluate(()=>{ document.querySelectorAll('[id^=ov-].show').forEach(m=>console.log('open modal '+m.id)); });
console.log('after approve',JSON.stringify(await st()));
await page.evaluate(()=>{ goStage(2); }); await W(1500);
const changed=await page.evaluate(()=>{ const ins=[...document.querySelectorAll('#s2-wrap input[type=text]')].filter(i=>i.value==='Real White PB 4x8 2F (18mm, Matte)'); if(!ins.length) return 'no board input on Stage 2'; const i=ins[0]; i.value='Light Gray PB MR 4x8 2F (18mm, Stipple)'; i.dispatchEvent(new Event('input',{bubbles:true})); i.dispatchEvent(new Event('change',{bubbles:true})); return 'changed; pairs='+JSON.stringify(_fqLinePairs()); });
console.log(changed); await W(2000);
console.log('after change',JSON.stringify(await st()));
await page.evaluate(()=>{ document.getElementById('fq-lock-btn').click(); }); await W(800);
await page.evaluate(()=>{ document.querySelectorAll('[id^=ov-].show').forEach(m=>console.log('open modal '+m.id)); });
await okConfirm('fq-lock-pre');
await page.evaluate(()=>{ if(document.getElementById('ov-lock').classList.contains('show')) skipSend(); }); await W(2500);
if(process.env.CANCEL){ const m=await page.evaluate(()=>{ const t=document.getElementById('ov-confirm-msg').textContent; _confirmCancel(); return t; }); console.log('materials CANCELLED'); await W(2500);
  console.log('after cancel',JSON.stringify(await st()));
  await page.evaluate(()=>{ document.getElementById('q-jo-top').click(); }); await W(2500);
  const btn=await page.evaluate(()=>{ const b=[...document.querySelectorAll('#ov-jo-foot button')].map(x=>x.textContent.trim()); return b; }); console.log('JO footer buttons',JSON.stringify(btn));
  await page.evaluate(()=>{ const b=[...document.querySelectorAll('#ov-jo-foot button')].find(x=>/Check Final Quotation materials/.test(x.textContent)); b&&b.click(); }); await W(1500);
  await okConfirm('button'); await W(3500);
} else { await okConfirm('materials'); await W(3500); }
console.log('after fq lock',JSON.stringify(await st()));
await page.evaluate(()=>{ document.getElementById('q-jo-top').click(); }); await W(3000);
const jo=await page.evaluate(()=>{ const o=document.getElementById('ov-jo'); return {show:o&&o.classList.contains('show'), text:o?o.innerText.slice(0,1500):''}; });
console.log('JO window',JSON.stringify(jo).slice(0,1700)); await W(2500);
console.log('final',JSON.stringify(await st()));
const stored=await page.evaluate(()=>{ try{ const a=JSON.parse(localStorage.getItem('mc_trn_job_orders')||'[]'); return a.map(j=>({no:j.jo_number||j.joNumber,status:j.status,stage:j.data&&j.data.stage,boards:(j.data&&j.data.boards||[]).map(b=>b.material||b.name||b.sku)})); }catch(e){ return e.message; } });
console.log('stored JOs',JSON.stringify(stored).slice(0,1200));
const jtxt=await page.evaluate(()=>{ const a=JSON.parse(localStorage.getItem('mc_trn_job_orders')||'[]'); const v=a.find(j=>j.status==='reserved'); return (v.data.parts||[]).map(p=>p.p+' '+p.name+' | '+(p.sku||p.material)+' | tape '+(p.tape||p.edgeTape||'')).join(String.fromCharCode(10)); }); console.log(jtxt);
console.log('errs',JSON.stringify(errs)); console.log(logs.join('\n'));
await page.screenshot({path:process.env.TEMP+'/trn14_a.png'});
await browser.close();
