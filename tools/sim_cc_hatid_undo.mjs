// Simulation: "Approves undo requests" switch in Command Center › HATID users (2026-11-22).
// Modcraft Supabase and job-staff-sync are stubbed; nothing real is touched. Run: node tools/sim_cc_hatid_undo.mjs
import { createRequire } from 'module';
import { pathToFileURL } from 'url';
import path from 'path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const SUPA_STUB = `
window.__db={tables:{jobboard_users:[
  {email:'micko@x.com',name:'Micko',role:'dispatcher',companies:['WCLI'],company:'World Class Laminate, Inc.',title:null,schedule_steps:[],active:true,can_see_costs:false,pickup_role:'wh_manager',pickup_site:null,can_approve_undo:true},
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
    {email:'micko@x.com',role:'dispatcher',companies:['WCLI'],active:true,title:null,schedule_steps:[],can_see_costs:false,pickup_role:'wh_manager',pickup_site:null,can_approve_undo:true},
    {email:'rea@x.com',role:'viewer',companies:['WCLI'],active:true,title:null,schedule_steps:[],can_see_costs:false,pickup_role:'wh_manager',pickup_site:null,can_approve_undo:true}]}});
  if(b.action==='sync') return r.fulfill({json:{email:b.email,status:'updated'}});
  if(b.action==='signer') return r.fulfill({json:{email:b.email,sig_url:null,passcode:{set:false}}});
  r.fulfill({status:400,json:{error:'Unknown action'}});
});
await page.goto(pathToFileURL(path.resolve('command-center.html')).href+'?tab=hatid');
await page.waitForFunction(()=>typeof viewJb==='function'&&TAB==='jb'&&D.jb.length===2);
await page.waitForTimeout(300);
const rows=await page.locator('tbody tr').allInnerTexts();
const mk=rows.find(t=>/micko@x/.test(t)), ra=rows.find(t=>/rea@x/.test(t));
ok(/undo approver/.test(mk)&&!/undo approver/.test(ra),'list tags Micko as undo approver, not Rea');
ok(/in sync/.test(mk)&&/out of sync/.test(ra),'HATID disagreeing on the switch shows "out of sync"');
// Edit Rea: switch on, save
await page.evaluate(()=>openEd('jb',D.jb.findIndex(u=>u.email==='rea@x.com'))); await page.waitForTimeout(150);
const ri=await page.evaluate(()=>D.jb.findIndex(u=>u.email==='rea@x.com'));
const box=page.locator('#jb-'+ri);
ok(!(await box.locator('.f-undo').isChecked()),'edit form shows the switch off for Rea');
await box.locator('.f-undo').check();
await page.evaluate(i=>saveJb(i),ri); await page.waitForTimeout(400);
let db=await page.evaluate(()=>__db);
ok(db.writes.some(w=>w.op==='update'&&w.row.can_approve_undo===true),'save writes can_approve_undo=true');
ok(calls.some(c=>c.action==='sync'&&c.email==='rea@x.com'),'then asks HATID to sync her');
// Edit Micko unchanged: stays true
const mi=await page.evaluate(()=>D.jb.findIndex(u=>u.email==='micko@x.com'));
await page.evaluate(i=>openEd('jb',i),mi); await page.waitForTimeout(150);
ok(await page.locator('#jb-'+mi+' .f-undo').isChecked(),'Micko\'s form shows it on');
await page.evaluate(i=>saveJb(i),mi); await page.waitForTimeout(400);
db=await page.evaluate(()=>__db);
ok(db.writes.filter(w=>w.op==='update').pop().row.can_approve_undo===true,'saving Micko without touching it keeps it on');
// Add a user with it ticked
await page.evaluate(()=>openEd('jb','add')); await page.waitForTimeout(150);
await page.fill('#jbNewEmail','new@x.com'); await page.fill('#jbNewName','New');
await page.check('#jbNewUndo');
await page.evaluate(()=>{ var c=document.querySelector('#jb-new .f-cos'); if(c) c.checked=true; });
await page.evaluate(()=>addJb()); await page.waitForTimeout(400);
db=await page.evaluate(()=>__db);
ok(db.writes.some(w=>w.op==='insert'&&w.row.email==='new@x.com'&&w.row.can_approve_undo===true),'add form saves the switch');
await browser.close();
console.log(fails?`\n${fails} FAILED`:'\nAll passed'); process.exit(fails?1:0);
