// Simulation for the Command Center Tickets tab. Supabase is stubbed; nothing real is touched.
// The rule (only Command Center managers may change a ticket) is enforced in the database by
// cc_ticket_set and was tested there by impersonation (2026-10-20). Run: node tools/sim_cc_tickets.mjs
import { createRequire } from 'module';
import { pathToFileURL } from 'url';
import path from 'path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const stub = `
window.__db={rpc:[],tickets:[
  {id:'t1',app:'modcraft',created_at:'2026-10-01T02:00:00Z',updated_at:'2026-10-02T02:00:00Z',reporter_name:'Joanna',title:'Approvals',body:'Cannot sign to quotations',screenshots:['modcraft/a.jpg'],status:'new',diagnosis:'Timing fault',resolution:'Tier C, fixed',triage_notes:null},
  {id:'t2',app:'modcraft',created_at:'2026-09-01T02:00:00Z',updated_at:'2026-09-02T02:00:00Z',reporter_name:'Rommel',title:'Old one',body:'done',screenshots:[],status:'closed'},
  {id:'t3',app:'modcraft',created_at:'2026-09-10T02:00:00Z',updated_at:'2026-09-11T02:00:00Z',reporter_name:'Joanna',title:'Log In',body:'Keep signing out',screenshots:[],status:'needs_human',triage_notes:'How long after signing in?'}]};
function q(t){var o={select:function(){return o},order:function(){return o},limit:function(){return o},eq:function(){return o},
  then:function(res){ return Promise.resolve({data:t==='tickets'?__db.tickets:[],error:null}).then(res); }}; return o;}
window.supabase={createClient:function(){return {
  auth:{getSession:function(){return Promise.resolve({data:{session:{access_token:'TOK',user:{email:'boss@x.com'}}}})},onAuthStateChange:function(){},signOut:function(){return Promise.resolve()}},
  storage:{from:function(){return {createSignedUrl:function(p){return Promise.resolve({data:{signedUrl:'data:image/gif;base64,R0lGODlhAQABAAAAACw='}})}}}},
  rpc:function(n,a){ __db.rpc.push({n:n,a:a});
    if(n==='cc_me') return Promise.resolve({data:{email:'boss@x.com',name:'Boss',level:'owner',allowed:true}});
    if(n==='cc_ticket_set'){ var t=__db.tickets.find(function(x){return x.id===a.p_id}); return Promise.resolve({data:Object.assign({},t,{status:a.p_status}),error:null}); }
    return Promise.resolve({data:[],error:null}); },
  from:q}}};`;

let fails = 0; const ok = (c, m) => { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fails++; };
const browser = await chromium.launch();
const page = await browser.newPage(); page.on('dialog', (d) => d.accept('fixed and checked'));
page.on('pageerror', (e) => { console.log('  PAGE ERROR', e.message); fails++; });
await page.route('https://cdn.jsdelivr.net/**', (r) => r.fulfill({ contentType: 'text/javascript', body: stub }));
await page.route('https://accounts.google.com/**', (r) => r.fulfill({ contentType: 'text/javascript', body: '' }));
await page.route('**/functions/v1/**', (r) => r.fulfill({ json: { staff: [] } }));
await page.goto(pathToFileURL(path.resolve('command-center.html')).href + '?tab=tickets');
await page.waitForTimeout(600);

ok(await page.locator('#nav button', { hasText: 'Tickets' }).count() === 1, 'Tickets main tab present');
ok((await page.locator('#nav button', { hasText: 'Tickets' }).innerText()).includes('2'), 'tab shows 2 open tickets');
ok(await page.locator('#root td', { hasText: 'Approvals' }).count() === 1, 'open ticket listed');
ok(await page.locator('#root td', { hasText: 'Old one' }).count() === 0, 'closed ticket hidden in the Open view');
ok(await page.locator('#root .pill', { hasText: 'Needs you' }).count() === 1, 'needs_human shown as "Needs you"');
await page.locator('#root tr', { hasText: 'Approvals' }).first().click(); await page.waitForTimeout(300);
ok(await page.locator('#root', { hasText: 'Timing fault' }).count() === 1, 'opening a ticket shows its diagnosis');
ok(await page.locator('#root img[alt="Screenshot"]').count() === 1, 'screenshot shown');
await page.locator('#root button', { hasText: 'Close — done' }).click(); await page.waitForTimeout(300);
const rpc = await page.evaluate(() => __db.rpc.find((x) => x.n === 'cc_ticket_set'));
ok(rpc && rpc.a.p_id === 't1' && rpc.a.p_status === 'closed' && rpc.a.p_note === 'fixed and checked', 'Close calls cc_ticket_set with the note');
ok(await page.locator('#root td', { hasText: 'Approvals' }).count() === 0, 'closed ticket leaves the Open view');
await page.selectOption('#root select', 'all'); await page.waitForTimeout(200);
ok(await page.locator('#root td', { hasText: 'Old one' }).count() === 1, 'All view shows closed tickets');
await page.setViewportSize({ width: 390, height: 800 });
ok(await page.evaluate(() => document.documentElement.scrollWidth <= 392), 'no sideways scroll on a phone');
await page.screenshot({ path: process.env.SHOT || 'sim_cc_tickets.png' });
await browser.close();
console.log(fails ? fails + ' FAILED' : 'ALL PASS'); process.exit(fails ? 1 : 0);
