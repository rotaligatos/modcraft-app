// Simulation: several pick-up jobs per person in Command Center › HATID users (2026-11-28).
// Modcraft Supabase and job-staff-sync are stubbed; nothing real is touched. Run: node tools/sim_cc_hatid_pk_roles.mjs
import { createRequire } from 'module';
import { pathToFileURL } from 'url';
import path from 'path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const SUPA_STUB = `
window.__db={tables:{jobboard_users:[
  {email:'annex@x.com',name:'Annex Checker',role:'pickup',companies:['WCLI'],company:'World Class Laminate, Inc.',title:null,schedule_steps:[],active:true,can_see_costs:false,pickup_role:'warehouse',pickup_roles:['warehouse'],pickup_site:'annex',can_approve_undo:false},
  {email:'rea@x.com',name:'Rea',role:'viewer',companies:['WCLI'],company:'World Class Laminate, Inc.',title:null,schedule_steps:[],active:true,can_see_costs:false,pickup_role:'wh_manager',pickup_site:null,can_approve_undo:false}],
  users:[{email:'boss@x.com',name:'Boss',role:'Admin',company:'World Class Laminate, Inc.',active:true}]},rpc:[],writes:[]};
function q(t){var f=[],op='select',payload=null;var rows=function(){return (__db.tables[t]||[])};
  var o={select:function(){return o},order:function(){return o},limit:function(){return o},maybeSingle:function(){return o},in:function(){return o},
  eq:function(k,v){f.push([k,v]);return o},
  insert:function(r){op='insert';payload=r;return o},update:function(r){op='update';payload=r;return o},delete:function(){op='delete';return o},
  then:function(res){ var match=function(r){return f.every(function(x){return r[x[0]]===x[1]})};
    if(op==='update'){ __db.writes.push({t:t,op:op,row:payload}); var hit=rows().filter(match); hit.forEach(function(r){Object.assign(r,payload)}); return Promise.resolve({data:hit,error:null}).then(res); }
    if(op==='insert'){ __db.writes.push({t:t,op:op,row:payload}); rows().push(payload); return Promise.resolve({data:[payload],error:null}).then(res); }
    return Promise.resolve({data:rows().filter(match),error:null}).then(res); }}; return o;}
window.supabase={createClient:function(){return {
  auth:{getSession:function(){return Promise.resolve({data:{session:{access_token:'TOK',user:{email:'boss@x.com'}}}})},onAuthStateChange:function(){},signOut:function(){return Promise.resolve()}},
  rpc:function(n,a){ __db.rpc.push({n:n,a:a}); if(n==='cc_me') return Promise.resolve({data:{allowed:true,email:'boss@x.com',name:'Boss',level:'owner'}});
    return Promise.resolve({data:[],error:null}); },
  from:q}}};`;

let fails=0; const ok=(c,m)=>{ console.log((c?'  PASS ':'  FAIL ')+m); if(!c) fails++; };
const browser=await chromium.launch(process.env.PW_EXE?{executablePath:process.env.PW_EXE}:{}); const page=await browser.newPage(); const calls=[];
page.on('dialog',d=>d.accept());
page.on('pageerror',e=>{ console.log('  PAGE ERROR',e.message); fails++; });
await page.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({contentType:'text/javascript',body:SUPA_STUB}));
await page.route('https://accounts.google.com/**',r=>r.fulfill({contentType:'text/javascript',body:''}));
await page.route('**/functions/v1/job-staff-sync',async r=>{
  const req=r.request(); if(req.method()==='OPTIONS') return r.fulfill({status:200,body:'ok'});
  const b=JSON.parse(req.postData()); calls.push(b);
  if(b.action==='status') return r.fulfill({json:{staff:[
    {email:'annex@x.com',role:'pickup',companies:['WCLI'],active:true,title:null,schedule_steps:[],can_see_costs:false,pickup_role:'warehouse',pickup_roles:['warehouse','logistics'],pickup_site:'annex',can_approve_undo:false},
    {email:'rea@x.com',role:'viewer',companies:['WCLI'],active:true,title:null,schedule_steps:[],can_see_costs:false,pickup_role:'wh_manager',pickup_site:null,can_approve_undo:true}]}});
  if(b.action==='sync') return r.fulfill({json:{email:b.email,status:'updated'}});
  if(b.action==='signer') return r.fulfill({json:{email:b.email,sig_url:null,passcode:{set:false}}});
  r.fulfill({status:400,json:{error:'Unknown action'}});
});
await page.goto(pathToFileURL(path.resolve('command-center.html')).href+'?tab=hatid');
await page.waitForFunction(()=>typeof viewJb==='function'&&TAB==='jb'&&D.jb.length===2);
await page.waitForTimeout(300);
let rows=await page.locator('tbody tr').allInnerTexts();
ok(/out of sync/.test(rows.find(t=>/annex@x/.test(t))),'HATID has Warehouse + Logistics, list only Warehouse → "out of sync"');
const ai=await page.evaluate(()=>D.jb.findIndex(u=>u.email==='annex@x.com'));
await page.evaluate(i=>openEd('jb',i),ai); await page.waitForTimeout(150);
const box=page.locator('#jb-'+ai);
ok(await box.locator('.f-pkr[value=warehouse]').isChecked() && !(await box.locator('.f-pkr[value=logistics]').isChecked()),'form ticks only Warehouse');
await box.locator('.f-pkr[value=logistics]').check();
await page.evaluate(i=>saveJb(i),ai); await page.waitForTimeout(400);
let db=await page.evaluate(()=>__db), w=db.writes.filter(x=>x.op==='update').pop().row;
ok(JSON.stringify(w.pickup_roles)==='["warehouse","logistics"]' && w.pickup_role==='warehouse','save writes both jobs, Warehouse as the main job');
ok(calls.some(c=>c.action==='sync'&&c.email==='annex@x.com'),'then asks HATID to sync');
await page.waitForTimeout(300);
rows=await page.locator('tbody tr').allInnerTexts();
const ar=rows.find(t=>/annex@x/.test(t));
ok(/Warehouse \(outbound\) \+ Logistics/.test(ar),'list shows "Warehouse (outbound) + Logistics"');
ok(/in sync/.test(ar),'now matches HATID → "in sync"');
// Pick-up only with nothing ticked is refused
await page.evaluate(i=>openEd('jb',i),ai); await page.waitForTimeout(150);
await page.evaluate(i=>document.querySelectorAll('#jb-'+i+' .f-pkr').forEach(c=>c.checked=false),ai);
const n0=db.writes.length; await page.evaluate(i=>saveJb(i),ai); await page.waitForTimeout(300);
db=await page.evaluate(()=>__db); ok(db.writes.length===n0,'Pick-up only with no job ticked is not saved');
// Untouched single-job person keeps a one-job list
const ri=await page.evaluate(()=>D.jb.findIndex(u=>u.email==='rea@x.com'));
await page.evaluate(i=>openEd('jb',i),ri); await page.waitForTimeout(150);
await page.evaluate(i=>saveJb(i),ri); await page.waitForTimeout(400);
db=await page.evaluate(()=>__db); w=db.writes.filter(x=>x.op==='update').pop().row;
ok(JSON.stringify(w.pickup_roles)==='["wh_manager"]'&&w.pickup_role==='wh_manager','single-job person (no list yet) saves as a one-job list');
// Add with two jobs
await page.evaluate(()=>openEd('jb','add')); await page.waitForTimeout(150);
await page.fill('#jbNewEmail','new@x.com'); await page.fill('#jbNewName','New');
await page.evaluate(()=>{ var c=document.querySelector('#jb-new .f-cos'); if(c) c.checked=true; document.querySelectorAll('#jbNewPk .f-pkr').forEach(c=>{ c.checked=['sales_support','logistics'].includes(c.value); }); });
await page.evaluate(()=>addJb()); await page.waitForTimeout(400);
db=await page.evaluate(()=>__db); w=db.writes.filter(x=>x.op==='insert').pop()?.row||{};
ok(JSON.stringify(w.pickup_roles)==='["sales_support","logistics"]'&&w.pickup_role==='sales_support','add form saves two jobs');
await browser.close();
console.log(fails?`\n${fails} FAILED`:'\nAll passed'); process.exit(fails?1:0);
