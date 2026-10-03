// Simulation for the Command Center ShelfSync tab. Supabase (Modcraft) and the ShelfSync sync function
// are stubbed; nothing real is touched. Run: node tools/sim_cc_shelfsync.mjs
import { createRequire } from 'module';
import { pathToFileURL } from 'url';
import path from 'path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const SUPA_STUB = `
window.__db={tables:{shelfsync_users:[{email:'boss@x.com',name:'Boss',role:'admin',extra_roles:['plant_mgr'],company:'WCLI',plant:'PASIG',perms:{},require_passkey:true,active:true}],
  users:[{email:'boss@x.com',name:'Boss',role:'Admin',company:'World Class Laminate, Inc.',active:true},{email:'pp@x.com',name:'Pia PPIC',role:'Staff',company:'Cebu World Laminate, Inc.',active:true},{email:'zed@x.com',name:'Zed',role:'Staff',company:'World Class Laminate, Inc.',active:true}]},
  rpc:[],writes:[]};
function q(t){var f=[],op='select',payload=null;var rows=function(){return (__db.tables[t]||[])};
  var o={select:function(){return o},order:function(){return o},limit:function(){return o},maybeSingle:function(){return o},
  eq:function(k,v){f.push([k,v]);return o},
  insert:function(r){op='insert';payload=r;return o},update:function(r){op='update';payload=r;return o},delete:function(){op='delete';return o},
  then:function(res){ var match=function(r){return f.every(function(x){return r[x[0]]===x[1]})};
    if(op==='insert'){ __db.writes.push({t:t,op:op,row:payload}); if(rows().some(function(r){return r.email===payload.email})) return Promise.resolve({error:{code:'23505',message:'dup'}}).then(res);
      __db.tables[t]=rows().concat([Object.assign({active:true},payload)]); return Promise.resolve({error:null}).then(res); }
    if(op==='update'){ __db.writes.push({t:t,op:op,row:payload,f:f}); var hit=rows().filter(match); hit.forEach(function(r){Object.assign(r,payload)}); return Promise.resolve({data:hit,error:null}).then(res); }
    if(op==='delete'){ __db.writes.push({t:t,op:op,f:f}); var hit2=rows().filter(match); __db.tables[t]=rows().filter(function(r){return !match(r)}); return Promise.resolve({data:hit2,error:null}).then(res); }
    return Promise.resolve({data:rows().filter(match),error:null}).then(res); }}; return o;}
window.supabase={createClient:function(){return {
  auth:{getSession:function(){return Promise.resolve({data:{session:{access_token:'TOK',user:{email:'boss@x.com'}}}})},onAuthStateChange:function(){},signOut:function(){return Promise.resolve()}},
  rpc:function(n,a){ __db.rpc.push({n:n,a:a}); if(n==='cc_me') return Promise.resolve({data:{allowed:true,email:'boss@x.com',name:'Boss'}});
    return Promise.resolve({data:[],error:null}); },
  from:q}}};`;

let fails=0; const ok=(c,m)=>{ console.log((c?'  PASS ':'  FAIL ')+m); if(!c) fails++; };
const browser=await chromium.launch(); const page=await browser.newPage();
const calls=[]; let staff=[{email:'boss@x.com',full_name:'Boss',role:'admin',extra_roles:['plant_mgr'],company_id:'WCLI',plant_id:'PASIG',depot_code:null,access_expires:null,perms:{},require_passkey:true,status:'active',passkeys:1}];
page.on('dialog',d=>d.accept());
page.on('pageerror',e=>{ console.log('  PAGE ERROR',e.message); fails++; });
await page.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({contentType:'text/javascript',body:SUPA_STUB}));
await page.route('https://accounts.google.com/**',r=>r.fulfill({contentType:'text/javascript',body:''}));
await page.route('**/functions/v1/shelfsync-staff-sync',async r=>{
  const req=r.request(); if(req.method()==='OPTIONS') return r.fulfill({status:200,body:'ok'});
  const b=JSON.parse(req.postData()); calls.push({b,auth:req.headers()['authorization']});
  if(b.action==='status') return r.fulfill({json:{staff,depots:[{code:'WIL-QAV',name:'Wilcon QAV'},{code:'AH-BAL',name:'AllHome Balintawak'}]}});
  if(b.action==='sync') return r.fulfill({json:b.with_password?{email:b.email,status:'login created',password:'Temp123abc'}:{email:b.email,status:'login created'}});
  if(b.action==='remove') return r.fulfill({json:{email:b.email,status:'ShelfSync access removed'}});
  if(b.action==='reset_passkeys') return r.fulfill({json:{email:b.email,status:'Face ID / fingerprint reset'}});
  if(b.action==='sync_all') return r.fulfill({json:{results:[{email:'boss@x.com',status:'updated'}],not_on_list:[]}});
  r.fulfill({status:400,json:{error:'Unknown action'}});
});
await page.goto(pathToFileURL(path.resolve(process.env.CC_FILE||'command-center.html')).href+'?tab=shelfsync');
await page.waitForFunction(()=>typeof viewSs==='function'&&TAB==='ss'&&SS.staff);
await page.waitForTimeout(200);

console.log('Tab and list');
ok(await page.locator('#nav button',{hasText:'ShelfSync'}).count()===1,'ShelfSync main tab present');
ok(await page.locator('#root td',{hasText:'boss@x.com'}).count()===1,'master row listed');
ok(await page.locator('#root .pill',{hasText:'in sync'}).count()===1,'In ShelfSync = in sync for matching row');
ok(calls[0]&&calls[0].b.action==='status'&&calls[0].auth==='Bearer TOK','status call carries the admin\'s own Modcraft token');

console.log('Add an agency promodiser');
await page.evaluate(()=>openEd('ss','add'));
const box=page.locator('#ss-new');
await box.locator('.f-email').fill('  Promo.One@Gmail.com ');
await box.locator('.f-name').fill('Promo One');
await box.locator('.f-agency').fill('Agency X');
await page.evaluate(()=>addSs()); await page.waitForTimeout(200);
let db=await page.evaluate(()=>__db);
ok(!db.writes.some(w=>w.op==='insert'),'refused without a depot (promodiser needs a depot)');
await box.locator('.f-depot').selectOption('WIL-QAV');
await box.locator('input.f-perm[value="request"]').uncheck();
await box.locator('.f-pw').check();
await page.evaluate(()=>addSs()); await page.waitForFunction(()=>!SS.busy);
db=await page.evaluate(()=>__db);
const ins=db.writes.find(w=>w.op==='insert');
ok(ins&&ins.row.email==='promo.one@gmail.com','email trimmed and lower-cased');
ok(ins&&ins.row.depot_code==='WIL-QAV'&&ins.row.role==='promodiser'&&ins.row.agency==='Agency X','role, depot, agency saved');
ok(ins&&ins.row.perms.request===false&&Object.keys(ins.row.perms).length===1,'only the switched-off feature stored');
ok(ins&&Array.isArray(ins.row.companies)&&ins.row.companies.length===0,'promodiser gets no extra companies');
const sync=calls.find(c=>c.b.action==='sync');
ok(sync&&sync.b.email==='promo.one@gmail.com'&&sync.b.with_password===true,'ShelfSync asked to apply it, with a password');
ok(await page.locator('#root',{hasText:'Temp123abc'}).count()===1,'temporary password shown once');
ok(db.rpc.some(x=>x.n==='cc_log_shelfsync'&&x.a.p_email==='promo.one@gmail.com'),'login creation logged');
await page.evaluate(()=>{SS.msg=null;draw()});

console.log('Edit: give Pia (Plant) a second role, then switch off');
await page.evaluate(()=>quickAdd('ss','pp@x.com'));
const nb=page.locator('#ss-new');
ok(await nb.locator('.f-email').inputValue()==='pp@x.com'&&await nb.locator('.f-name').inputValue()==='Pia PPIC','quick add fills email + name from Modcraft');
ok(await nb.locator('.f-co').inputValue()==='CWLI'&&await nb.locator('.f-role').inputValue()==='ppic','company CWLI and Plant role prefilled');
ok(!(await nb.locator('.ss-perms').isVisible()),'promodiser switches hidden for Plant role');
await nb.locator('.f-plant').selectOption('CEBU');
await nb.locator('input.f-xr[value="scm"]').check();
ok(await nb.locator('.ss-cos').isVisible(),'"Companies they see" shown for a Plant role');
ok(await nb.locator('input.f-cos[value="CWLI"]').isChecked(),'own company pre-ticked');
await nb.locator('input.f-cos[value="WCLI"]').check();
await page.evaluate(()=>addSs()); await page.waitForFunction(()=>!SS.busy);
db=await page.evaluate(()=>__db);
const pia=db.tables.shelfsync_users.find(r=>r.email==='pp@x.com');
ok(pia&&pia.extra_roles.join()==='scm'&&pia.plant==='CEBU'&&pia.depot_code===null,'extra role + plant saved, no depot');
ok(pia&&JSON.stringify(pia.companies)==='["WCLI"]','also sees WCLI saved (own company not repeated)');
ok(await page.locator('#root td',{hasText:'also WCLI'}).count()===1,'list shows the extra company');
const i=await page.evaluate(()=>D.ss.findIndex(r=>r.email==='pp@x.com'));
await page.evaluate(i=>openEd('ss',i),i);
await page.locator('#ss-'+i+' .f-act').uncheck();
await page.evaluate(i=>saveSs(i),i); await page.waitForFunction(()=>!SS.busy);
db=await page.evaluate(()=>__db);
ok(db.tables.shelfsync_users.find(r=>r.email==='pp@x.com').active===false,'switched off');
ok(calls.filter(c=>c.b.action==='sync'&&c.b.email==='pp@x.com').length===2,'ShelfSync updated after each save');

console.log('Reset Face ID, remove, people tab, change log');
const j=await page.evaluate(()=>D.ss.findIndex(r=>r.email==='promo.one@gmail.com'));
await page.evaluate(j=>ssResetKeys(j),j); await page.waitForTimeout(150);
ok(calls.some(c=>c.b.action==='reset_passkeys'&&c.b.email==='promo.one@gmail.com'),'reset Face ID sent');
await page.evaluate(j=>removeSs(j),j); await page.waitForTimeout(300);
db=await page.evaluate(()=>__db);
ok(!db.tables.shelfsync_users.some(r=>r.email==='promo.one@gmail.com'),'removed from master list');
ok(calls.some(c=>c.b.action==='remove'&&c.b.email==='promo.one@gmail.com'),'ShelfSync told to switch access off');
await page.evaluate(()=>setMain('people'));
ok(await page.locator('#root th',{hasText:'ShelfSync'}).count()===1,'People has a ShelfSync column');
ok(await page.locator('#root button',{hasText:'+ ShelfSync'}).count()>=1,'+ ShelfSync quick-add button');
await page.evaluate(()=>{setMain('ss');setSub('log')});
ok(await page.locator('#root',{hasText:'Every change to this app'}).count()===1,'ShelfSync change log sub-tab renders');

console.log('Sync unreachable');
await page.unroute('**/functions/v1/shelfsync-staff-sync');
await page.route('**/functions/v1/shelfsync-staff-sync',r=>r.fulfill({status:404,json:{message:'Function not found'}}));
await page.evaluate(()=>{setMain('ss');setSub('users');SS.staff=null;SS.err='';draw()}); await page.waitForTimeout(300);
ok(await page.locator('#root .note.err',{hasText:'Could not read ShelfSync'}).count()===1,'clear message when ShelfSync is not reachable');
ok(await page.locator('#root td',{hasText:'boss@x.com'}).count()===1,'list still usable');

console.log('Before the ShelfSync list exists');
const p2=await browser.newPage(); p2.on('pageerror',e=>{ console.log('  PAGE ERROR',e.message); fails++; });
await p2.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({contentType:'text/javascript',body:SUPA_STUB.replace("function q(t){","function q(t){if(t==='shelfsync_users'){var e={select:function(){return e},order:function(){return e},then:function(res){return Promise.resolve({data:null,error:{message:'relation \"public.shelfsync_users\" does not exist'}}).then(res)}};return e}")}));
await p2.route('https://accounts.google.com/**',r=>r.fulfill({contentType:'text/javascript',body:''}));
await p2.goto(pathToFileURL(path.resolve(process.env.CC_FILE||'command-center.html')).href+'?tab=shelfsync');
await p2.waitForFunction(()=>typeof viewSs==='function'&&document.querySelector('#root h2'));
ok(await p2.locator('#root',{hasText:'ShelfSync is not set up yet'}).count()===1,'clear "not set up yet" note');
ok(await p2.locator('#toast',{hasText:'could not load'}).count()===0||!(await p2.locator('#toast').isVisible()),'no "lists could not load" error');
await browser.close();
console.log(fails?fails+' FAILED':'ALL PASSED'); process.exit(fails?1:0);
