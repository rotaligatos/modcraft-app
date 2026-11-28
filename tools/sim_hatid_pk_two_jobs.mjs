// Simulation: one person with two pick-up jobs (Warehouse + Logistics, Annex) — HATID 2026-11-28.
// Supabase is stubbed (empty tables, one signed-in staff row); nothing real is touched.
// Run: node tools/sim_hatid_pk_two_jobs.mjs   (PW_EXE=<chrome> if Playwright's own browser isn't installed)
import { createRequire } from 'module';
import { pathToFileURL } from 'url';
import path from 'path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const ME = { id: 'u-annex', email: 'annex@x.com', name: 'Annex Checker', role: 'pickup', company: 'WCLI', companies: ['WCLI'], active: true, schedule_steps: [],
  can_see_costs: false, pickup_role: 'warehouse', pickup_roles: ['warehouse', 'logistics'], pickup_site: 'annex', pk_home: null, guide_lang: 'en', can_approve_undo: false, whats_new_seen: [] };
const STUB = `
window.__me = ${JSON.stringify(ME)};
function chain(t){ let single = false; const res = () => ({ data: t === 'job_staff' ? (single ? window.__me : [window.__me]) : (single ? null : []), error: null, count: 0 });
  const p = new Proxy(function(){}, { get(_, k){
    if (k === 'then') return (a, b) => Promise.resolve(res()).then(a, b);
    if (k === 'maybeSingle' || k === 'single') return () => { single = true; return p; };
    return () => p; } });
  return p; }
const session = { access_token: 'T', user: { id: 'u-annex', email: 'annex@x.com' } };
window.supabase = { createClient(){ return {
  auth: { getSession: () => Promise.resolve({ data: { session } }), getUser: () => Promise.resolve({ data: { user: session.user } }),
    onAuthStateChange(cb){ setTimeout(() => cb('SIGNED_IN', session), 50); return { data: { subscription: { unsubscribe(){} } } }; }, signOut: () => Promise.resolve({}) },
  from: chain, rpc: () => Promise.resolve({ data: null, error: null }),
  channel(){ const c = { on: () => c, subscribe: () => c, unsubscribe(){} }; return c; }, removeChannel(){},
  storage: { from: () => ({ upload: () => Promise.resolve({ data: {}, error: null }), createSignedUrl: () => Promise.resolve({ data: { signedUrl: '' } }) }) },
  functions: { invoke: () => Promise.resolve({ data: null, error: null }) } }; } };`;

let fails = 0; const ok = (c, m) => { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fails++; };
const browser = await chromium.launch(process.env.PW_EXE ? { executablePath: process.env.PW_EXE } : {});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errs = []; page.on('pageerror', e => errs.push(e.message));
page.on('dialog', d => d.accept());
await page.route('https://cdn.jsdelivr.net/**', r => r.fulfill({ contentType: 'text/javascript', body: STUB }));
await page.route(/^https:\/\/(?!cdn\.jsdelivr).*/, r => r.fulfill({ status: 204, body: '' }));
await page.goto(pathToFileURL(path.resolve('hatid.html')).href);
page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
await page.waitForFunction(() => typeof state !== 'undefined' && state.me?.id === 'u-annex', null, { timeout: 15000 });
await page.waitForTimeout(800);

const r = await page.evaluate(() => ({ can: { lg: pkCan('logistics'), wh: pkCan('warehouse'), ss: pkCan('sales_support'), wm: pkCan('wh_manager') },
  tabs: ['pk-ss', 'pk-wh', 'pk-lg', 'pk-tickets', 'pk-queue'].filter(pkTabOk), home: pkHome(), lbl: pkRoleLbl(state.me),
  keys: [...prRoleKeys()] }));
ok(r.can.lg && r.can.wh && !r.can.ss && !r.can.wm, 'can do Warehouse and Logistics, not Sales Support or Warehouse Manager');
ok(r.tabs.includes('pk-wh') && r.tabs.includes('pk-lg') && !r.tabs.includes('pk-ss'), 'sees the Warehouse and Logistics tabs (not Sales Support): ' + r.tabs.join(', '));
ok(r.home === 'pk-wh', 'opens on Warehouse (main job)');
ok(r.lbl === 'Warehouse + Logistics', 'label reads "Warehouse + Logistics"');
ok(r.keys.includes('pwh') && r.keys.includes('plg') && r.keys.includes('pwl'), 'practice marks Warehouse, Logistics and the Annex scenario "For you"');

// a one-job person is unchanged
const one = await page.evaluate(() => { const keep = state.me; state.me = { ...keep, pickup_role: 'logistics', pickup_roles: null };
  const o = { tabs: ['pk-ss', 'pk-wh', 'pk-lg'].filter(pkTabOk), wh: pkCan('warehouse'), lg: pkCan('logistics') }; state.me = keep; return o; });
ok(one.tabs.join() === 'pk-lg' && one.lg && !one.wh, 'older single-job row (no list) still works: Logistics only');

// practice scenario: Annex, one person does both
await page.evaluate(() => prStart.length >= 0);
await page.evaluate(() => { window.prCtx = () => ({ co: 'WCLI', today: localDate(), agent: null }); prStart('p-annex'); });
await page.waitForTimeout(900);
const p0 = await page.evaluate(() => ({ persona: PR.persona, roles: state.me.pickup_roles, site: pkSite(), view: state.view }));
ok(p0.persona === 'pwl' && JSON.stringify(p0.roles) === '["warehouse","logistics"]' && p0.site === 'annex', 'practice persona: Warehouse + Logistics at the Annex');
const clickStep = async (sel, what) => { const el = page.locator(sel).first(); try { await el.waitFor({ state: 'visible', timeout: 5000 }); await el.click(); return true; } catch { ok(false, 'could not find ' + what); return false; } };
await clickStep('#pkm-body [data-pkm=acceptready]', 'Accept & ready');
await page.waitForFunction(() => prPkV('S80031')?.status === 'ready', null, { timeout: 5000 }).catch(() => {});
ok(await page.evaluate(() => prPkV('S80031')?.status === 'ready'), 'accepted & ready as Warehouse');
await page.waitForTimeout(900);
await clickStep('.pk-tab[data-view="pk-lg"]', 'Logistics tab');
await page.waitForTimeout(900);
ok(await page.evaluate(() => state.view === 'pk-lg' && PR.persona === 'pwl'), 'switched to the Logistics tab as the same person');
await clickStep('#pkm-body [data-pkm=load]', 'Load & photos');
await page.waitForTimeout(600);
const sample = page.locator('#overlay button', { hasText: /sample photos/i }).first();
if (await sample.count()) await sample.click(); else ok(false, 'no "Use 3 sample photos" button');
await page.waitForTimeout(400);
await clickStep('#pkl-go', 'Released — stop the clock');
await page.waitForFunction(() => prPkV('S80031')?.status === 'done', null, { timeout: 5000 }).catch(() => {});
ok(await page.evaluate(() => prPkV('S80031')?.status === 'done'), 'released as Logistics — same person, both steps');
ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
await browser.close();
console.log(fails ? `\n${fails} FAILED` : '\nAll passed'); process.exit(fails ? 1 : 0);
