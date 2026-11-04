// Simulation: changing a HATID user's email in the Command Center (2026-11-04).
// Modcraft Supabase and job-staff-sync are stubbed; nothing real is touched. Run: node tools/sim_cc_hatid_email.mjs
import { createRequire } from 'module';
import { pathToFileURL } from 'url';
import path from 'path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const SUPA_STUB = (failUpdate) => `
window.__db={tables:{jobboard_users:[{email:'old@gmail.com',name:'Gil',role:'dispatcher',companies:['MSSI','WCLI'],company:'Module Systems and Services, Inc.',title:'Scheduler',schedule_steps:[],active:true,can_see_costs:false,pickup_role:'logistics',pickup_site:null}],
  users:[{email:'boss@x.com',name:'Boss',role:'Admin',company:'World Class Laminate, Inc.',active:true}]},rpc:[],writes:[]};
function q(t){var f=[],op='select',payload=null;var rows=function(){return (__db.tables[t]||[])};
  var o={select:function(){return o},order:function(){return o},limit:function(){return o},maybeSingle:function(){return o},in:function(){return o},
  eq:function(k,v){f.push([k,v]);return o},
  insert:function(r){op='insert';payload=r;return o},update:function(r){op='update';payload=r;return o},delete:function(){op='delete';return o},
  then:function(res){ var match=function(r){return f.every(function(x){return r[x[0]]===x[1]})};
    if(op==='update'){ __db.writes.push({t:t,op:op,row:payload,f:f}); if(${failUpdate}) return Promise.resolve({data:null,error:{message:'refused'}}).then(res);
      var hit=rows().filter(match); hit.forEach(function(r){Object.assign(r,payload)}); return Promise.resolve({data:hit,error:null}).then(res); }
    return Promise.resolve({data:rows().filter(match),error:null}).then(res); }}; return o;}
window.supabase={createClient:function(){return {
  auth:{getSession:function(){return Promise.resolve({data:{session:{access_token:'TOK',user:{email:'boss@x.com'}}}})},onAuthStateChange:function(){},signOut:function(){return Promise.resolve()}},
  rpc:function(n,a){ __db.rpc.push({n:n,a:a}); if(n==='cc_me') return Promise.resolve({data:{allowed:true,email:'boss@x.com',name:'Boss',level:'owner'}});
    return Promise.resolve({data:[],error:null}); },
  from:q}}};`;

let fails=0; const ok=(c,m)=>{ console.log((c?'  PASS ':'  FAIL ')+m); if(!c) fails++; };
async function run(failUpdate){
  const browser=await chromium.launch(process.env.PW_EXE?{executablePath:process.env.PW_EXE}:{}); const page=await browser.newPage(); const calls=[];
  page.on('dialog',d=>d.accept());
  page.on('pageerror',e=>{ console.log('  PAGE ERROR',e.message); fails++; });
  await page.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({contentType:'text/javascript',body:SUPA_STUB(failUpdate)}));
  await page.route('https://accounts.google.com/**',r=>r.fulfill({contentType:'text/javascript',body:''}));
  await page.route('**/functions/v1/job-staff-sync',async r=>{
    const req=r.request(); if(req.method()==='OPTIONS') return r.fulfill({status:200,body:'ok'});
    const b=JSON.parse(req.postData()); calls.push(b);
    if(b.action==='status') return r.fulfill({json:{staff:[]}});
    if(b.action==='change_email') return r.fulfill({json:{from:b.from,to:b.to,status:'email changed'}});
    if(b.action==='sync') return r.fulfill({json:{email:b.email,status:'updated'}});
    if(b.action==='signer') return r.fulfill({json:{email:b.email,sig_url:null,passcode:{set:false}}});
    r.fulfill({status:400,json:{error:'Unknown action'}});
  });
  await page.goto(pathToFileURL(path.resolve('command-center.html')).href+'?tab=hatid');
  await page.waitForFunction(()=>typeof viewJb==='function'&&TAB==='jb'&&D.jb.length===1);
  await page.evaluate(()=>openEd('jb',0)); await page.waitForTimeout(150);
  const box=page.locator('#jb-0');
  ok(await box.locator('.f-email').inputValue()==='old@gmail.com','edit form shows an editable email');
  await box.locator('.f-email').fill(' Logistics@WorldClassLaminate.com.ph ');
  await page.evaluate(()=>saveJb(0)); await page.waitForTimeout(400);
  const db=await page.evaluate(()=>__db);
  const ce=calls.filter(c=>c.action==='change_email');
  ok(ce[0]&&ce[0].from==='old@gmail.com'&&ce[0].to==='logistics@worldclasslaminate.com.ph','HATID asked to move the login first (normalised)');
  if(!failUpdate){
    ok(db.tables.jobboard_users[0].email==='logistics@worldclasslaminate.com.ph','list row renamed');
    ok(calls.some(c=>c.action==='sync'&&c.email==='logistics@worldclasslaminate.com.ph'),'then synced under the new email');
    ok(db.rpc.some(r=>r.n==='cc_log_jobboard'&&/Email changed from old@gmail.com/.test(r.a.p_action)),'change logged');
  } else {
    ok(ce.length===2&&ce[1].from==='logistics@worldclasslaminate.com.ph'&&ce[1].to==='old@gmail.com','list save failed → HATID moved back');
    ok(!calls.some(c=>c.action==='sync'),'no sync after a failed save');
  }
  await browser.close();
}
console.log('Email change'); await run(false);
console.log('Email change — list save refused'); await run(true);
console.log(fails?`\n${fails} FAILED`:'\nAll passed'); process.exit(fails?1:0);
