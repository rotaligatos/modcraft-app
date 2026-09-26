// Simulation for Command Center phase 2 (Modcraft users mirrored to the Sheet + database).
// No real Sheet or database is touched: Supabase and Google are stubbed, and the Sheets API is
// answered from an in-memory copy of the User Roles tab. Run: node tools/sim_cc_phase2.mjs
import { createRequire } from 'module';
import { pathToFileURL } from 'url';
import path from 'path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const SUPA_STUB = `
window.__db={users:[{email:'ana@x.com',name:'Ana',role:'Staff',company:'World Class Laminate, Inc.',active:true}],rpc:[],upserts:[]};
function q(t){var o={_t:t,select:function(){return o},order:function(){return o},limit:function(){return o},eq:function(){return o},
  upsert:function(row){ __db.upserts.push({t:t,row:row}); return Promise.resolve({error:null}); },
  then:function(res){ return Promise.resolve({data:t==='users'?__db.users:[],error:null}).then(res); }}; return o;}
window.supabase={createClient:function(){return {
  auth:{getSession:function(){return Promise.resolve({data:{session:{user:{email:'boss@x.com'}}}})},onAuthStateChange:function(){}},
  rpc:function(n,a){ __db.rpc.push({n:n,a:a}); if(n==='cc_me') return Promise.resolve({data:{allowed:true,email:'boss@x.com',name:'Boss'}});
    if(n==='cc_pin_status') return Promise.resolve({data:[]}); return Promise.resolve({data:1,error:null}); },
  from:q}}};`;
const GOOGLE_STUB = `window.google={accounts:{oauth2:{hasGrantedAllScopes:function(){return true},
  initTokenClient:function(o){return {requestAccessToken:function(){ o.callback({access_token:'tok',expires_in:3600}); }}}}}};`;

const HDR=['Name','Email','Position','Active','Company','Device','Dashboard','KPI','Reports','Profit/Revenue','Quotations','Analytics','Approvals','Schedule','Delegate','DelegateOn','ReceiveAll','Projects','Clients','DS','Settings','Users','PinHash','PinSalt','Access','KPIinc','ReqPin'];
function anaRow(){ return ['Ana','ana@x.com','Staff','yes','World Class Laminate, Inc.','','TRUE','FALSE','FALSE','FALSE','TRUE','FALSE','FALSE','TRUE','','FALSE','FALSE','TRUE','TRUE','FALSE','FALSE','FALSE','HASH','SALT','','FALSE','FALSE']; }

let fails=0; const ok=(c,m)=>{ console.log((c?'  PASS ':'  FAIL ')+m); if(!c) fails++; };
const browser=await chromium.launch(); const page=await browser.newPage();
let sheet, writes;
function reset(){ sheet=[HDR.slice(), anaRow()]; writes=[]; }
reset();
page.on('dialog',d=>d.accept());
page.on('pageerror',e=>{ console.log('  PAGE ERROR',e.message); fails++; });
await page.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({contentType:'text/javascript',body:SUPA_STUB}));
await page.route('https://accounts.google.com/**',r=>r.fulfill({contentType:'text/javascript',body:GOOGLE_STUB}));
await page.route('https://sheets.googleapis.com/**',async r=>{
  const req=r.request(), u=new URL(req.url()), range=decodeURIComponent(u.pathname.split('/values/')[1]);
  const m=range.match(/!A(\d+):AA(\d+)$/);
  if(req.method()==='GET'){
    if(m) return r.fulfill({json:{values:[sheet[+m[1]-1]||[]]}});
    return r.fulfill({json:{values:sheet}});
  }
  const body=JSON.parse(req.postData()); writes.push({method:req.method(),range,values:body.values});
  if(req.method()==='PUT') sheet[+m[1]-1]=body.values[0]; else sheet.push(body.values[0]);
  r.fulfill({json:{}});
});
await page.goto(pathToFileURL(path.resolve(process.env.CC_FILE||'command-center.html')).href+'?tab=mc');
await page.waitForFunction(()=>typeof connectSheet==='function'&&window.google);
await page.evaluate(()=>connectSheet());
await page.waitForFunction(()=>MC.sheet&&!MC.loading);

console.log('Edit Ana: role Supervisor, company MSSI, KPI on');
await page.evaluate(()=>mcOpenEdit('ana@x.com'));
await page.selectOption('#me-role','Supervisor'); await page.selectOption('#me-co','Module Systems and Services, Inc.');
await page.check('#me-kpi');
await page.evaluate(()=>mcSaveEditor()); await page.waitForFunction(()=>!MC.busy&&MC.sheet&&!MC.loading);
ok(writes.length===1&&writes[0].method==='PUT'&&writes[0].range==='User Roles!A2:AA2','one PUT to row 2 A:AA');
const w=writes[0]&&writes[0].values[0]||[];
ok(w.length===27,'row is 27 columns (A..AA)');
ok(w[2]==='Supervisor'&&w[4]==='Module Systems and Services, Inc.'&&w[25]==='TRUE','role, company, KPI written');
ok(w[22]==='HASH'&&w[23]==='SALT','PIN hash/salt left exactly as in the Sheet');
let db=await page.evaluate(()=>__db);
ok(db.upserts.some(x=>x.t==='users'&&x.row.role==='Supervisor'&&x.row.company==='Module Systems and Services, Inc.'),'database copy upserted');
const log=db.rpc.find(x=>x.n==='cc_log_sheet_change');
ok(log&&log.a.p_after.role==='Supervisor'&&log.a.p_before.role==='Staff','change logged before/after');
ok(log&&JSON.stringify(log.a).indexOf('HASH')<0,'log never carries the PIN hash');

console.log('Refuse when the row changed in the Sheet meanwhile');
writes=[]; await page.evaluate(()=>mcOpenEdit('ana@x.com'));
sheet[1][0]='Ana (edited in Modcraft)';
await page.fill('#me-name','Ana B'); await page.evaluate(()=>mcSaveEditor());
await page.waitForFunction(()=>!MC.busy&&!MC.loading);
ok(writes.length===0,'no write when the row differs from what was loaded');
ok(sheet[1][0]==='Ana (edited in Modcraft)','other editor\'s change kept');

console.log('Refuse when the row moved');
await page.evaluate(()=>readSheet()); await page.waitForFunction(()=>!MC.loading);
writes=[]; await page.evaluate(()=>mcOpenEdit('ana@x.com'));
sheet.splice(1,0,['Zed','zed@x.com','Staff','yes']);
await page.fill('#me-name','Ana C'); await page.evaluate(()=>mcSaveEditor());
await page.waitForFunction(()=>!MC.busy&&!MC.loading);
ok(writes.length===0,'no write when another person now sits in that row');

console.log('Deactivate / Reset PIN / Add');
sheet.splice(1,1); await page.evaluate(()=>readSheet()); await page.waitForFunction(()=>!MC.loading);
writes=[]; await page.evaluate(()=>mcToggleActive('ana@x.com')); await page.waitForFunction(()=>!MC.busy&&!MC.loading);
ok(writes.length===1&&writes[0].values[0][3]==='no','deactivate writes Active = no (row kept)');
ok(sheet.length===2,'nothing deleted from the Sheet');
writes=[]; await page.evaluate(()=>mcResetPin('ana@x.com')); await page.waitForFunction(()=>!MC.busy&&!MC.loading);
ok(writes.length===1&&writes[0].values[0][22]===''&&writes[0].values[0][23]==='','reset PIN clears W:X in the Sheet');
db=await page.evaluate(()=>__db);
ok(db.rpc.some(x=>x.n==='cc_sync_user_pins'&&x.a.p_rows[0].email==='ana@x.com'&&x.a.p_rows[0].pin_hash===''),'reset PIN clears the database PIN copy');
writes=[]; await page.evaluate(()=>mcOpenAdd());
await page.fill('#me-name','New Person'); await page.fill('#me-email','New@X.com '); await page.selectOption('#me-co','Cebu World Laminate, Inc.');
await page.evaluate(()=>mcSaveEditor()); await page.waitForFunction(()=>!MC.busy&&!MC.loading);
ok(writes.length===1&&writes[0].method==='POST'&&writes[0].values[0][1]==='new@x.com'&&writes[0].values[0].length===27,'add appends one 27-column row, email trimmed + lower-case');
ok(writes[0]&&writes[0].values[0][22]===''&&writes[0].values[0][3]==='yes','new person: active, no PIN');
writes=[]; await page.evaluate(()=>mcOpenAdd());
await page.fill('#me-name','Dup'); await page.fill('#me-email','ana@x.com');
await page.evaluate(()=>mcSaveEditor()); await page.waitForTimeout(200);
ok(writes.length===0,'adding an email already on the Sheet is refused');

await browser.close();
console.log(fails?fails+' FAILED':'All passed'); process.exit(fails?1:0);
