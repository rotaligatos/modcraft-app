// Simulation for the Command Center Access tab (who may use the page, Owner/Manager).
// Supabase is stubbed; nothing real is touched. The real rules are enforced by the database and were
// tested there by impersonation (2026-10-03); this checks the screen. Run: node tools/sim_cc_access.mjs
import { createRequire } from 'module';
import { pathToFileURL } from 'url';
import path from 'path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const stub = (me) => `
window.__db={tables:{cc_access:[
  {email:'boss@x.com',name:'Boss',level:'owner',active:true},
  {email:'mgr@x.com',name:'Mona Manager',level:'manager',active:true}],
  users:[{email:'boss@x.com',name:'Boss',role:'Admin',active:true}]},rpc:[],writes:[]};
var ME_STUB=${JSON.stringify(me)};
function q(t){var f=[],op='select',payload=null;var rows=function(){return (__db.tables[t]||[])};
  var o={select:function(){return o},order:function(){return o},limit:function(){return o},eq:function(k,v){f.push([k,v]);return o},
  insert:function(r){op='insert';payload=r;return o},update:function(r){op='update';payload=r;return o},delete:function(){op='delete';return o},
  then:function(res){ var match=function(r){return f.every(function(x){return r[x[0]]===x[1]})};
    if(t==='cc_access'&&op!=='select'&&ME_STUB.level!=='owner'){ __db.writes.push({t:t,op:op,refused:true});
      return Promise.resolve(op==='insert'?{error:{message:'new row violates row-level security policy'}}:{data:[],error:null}).then(res); }
    if(op==='insert'){ __db.writes.push({t:t,op:op,row:payload}); __db.tables[t]=rows().concat([payload]); return Promise.resolve({data:[payload],error:null}).then(res); }
    if(op==='update'){ var hit=rows().filter(match);
      var after=rows().map(function(r){return match(r)?Object.assign({},r,payload):r});
      if(t==='cc_access'&&!after.some(function(r){return r.active&&r.level==='owner'})) return Promise.resolve({error:{message:'At least one active owner must remain on the Command Center access list.'}}).then(res);
      __db.writes.push({t:t,op:op,row:payload,f:f}); hit.forEach(function(r){Object.assign(r,payload)}); return Promise.resolve({data:hit,error:null}).then(res); }
    if(op==='delete'){ var hit2=rows().filter(match); __db.writes.push({t:t,op:op,f:f}); __db.tables[t]=rows().filter(function(r){return !match(r)}); return Promise.resolve({data:hit2,error:null}).then(res); }
    return Promise.resolve({data:rows().filter(match),error:null}).then(res); }}; return o;}
window.supabase={createClient:function(){return {
  auth:{getSession:function(){return Promise.resolve({data:{session:{access_token:'TOK',user:{email:ME_STUB.email}}}})},onAuthStateChange:function(){},signOut:function(){return Promise.resolve()}},
  rpc:function(n,a){ __db.rpc.push({n:n,a:a}); if(n==='cc_me') return Promise.resolve({data:ME_STUB}); return Promise.resolve({data:[],error:null}); },
  from:q}}};`;

let fails=0; const ok=(c,m)=>{ console.log((c?'  PASS ':'  FAIL ')+m); if(!c) fails++; };
const browser=await chromium.launch();
async function open(me){
  const page=await browser.newPage(); page.on('dialog',d=>d.accept());
  page.on('pageerror',e=>{ console.log('  PAGE ERROR',e.message); fails++; });
  await page.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({contentType:'text/javascript',body:stub(me)}));
  await page.route('https://accounts.google.com/**',r=>r.fulfill({contentType:'text/javascript',body:''}));
  await page.route('**/functions/v1/**',r=>r.fulfill({json:{staff:[]}}));
  await page.goto(pathToFileURL(path.resolve('command-center.html')).href+'?tab=access');
  await page.waitForTimeout(400); return page;
}

console.log('Owner');
let p=await open({email:'boss@x.com',name:'Boss',level:'owner',allowed:true});
ok(await p.locator('#nav button',{hasText:'Access'}).count()===1,'Access main tab present');
ok(await p.locator('#who .pill',{hasText:'Owner'}).count()===1,'header shows your level');
ok(await p.locator('#root td',{hasText:'mgr@x.com'}).count()===1,'list shows the managers');
ok(await p.locator('#root button',{hasText:'+ Give access'}).count()===1,'owner can add');
await p.evaluate(()=>openEd('cc','add'));
await p.locator('#cc-new .f-email').fill('  New.Person@X.com ');
await p.locator('#cc-new .f-name').fill('New Person');
await p.evaluate(()=>addCc()); await p.waitForTimeout(200);
let db=await p.evaluate(()=>__db);
const ins=db.writes.find(w=>w.op==='insert');
ok(ins&&ins.row.email==='new.person@x.com'&&ins.row.level==='manager'&&ins.row.active===true,'added as manager, email cleaned');
const bossIdx=await p.evaluate(()=>D.cc.findIndex(u=>u.email==='boss@x.com'));
await p.evaluate(i=>openEd('cc',i),bossIdx);
await p.locator('#cc-'+bossIdx+' .f-level').selectOption('manager');
await p.evaluate(i=>saveCc(i),bossIdx); await p.waitForTimeout(200);
ok(await p.locator('#toast',{hasText:'at least one active Owner'}).count()===1,'last owner cannot be lowered — refusal explained');
ok(await p.evaluate(()=>__db.tables.cc_access.find(u=>u.email==='boss@x.com').level)==='owner','owner kept');
await p.close();

console.log('Manager');
p=await open({email:'mgr@x.com',name:'Mona Manager',level:'manager',allowed:true});
ok(await p.locator('#who .pill',{hasText:'Manager'}).count()===1,'header shows Manager');
ok(await p.locator('#root',{hasText:'only an Owner can change this list'}).count()===1,'told the list is read-only');
ok(await p.locator('#root button',{hasText:'+ Give access'}).count()===0,'no add button');
ok(await p.locator('#root button',{hasText:'Edit'}).count()===0,'no edit buttons');
await p.evaluate(()=>setMain('ss')); await p.waitForTimeout(150);
ok(await p.locator('#root',{hasText:'ShelfSync'}).count()>=1,'can still open the app user tabs');
await p.close();

console.log('Not on the list');
p=await open({email:'x@x.com',name:'X',level:null,allowed:false});
ok(await p.locator('#root',{hasText:'has not been given Command Center access'}).count()===1,'closed, with who to ask');
await p.close();

await browser.close();
console.log(fails?fails+' FAILED':'ALL PASSED'); process.exit(fails?1:0);
