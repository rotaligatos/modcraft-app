// Start-up timing: opens the app as a signed-in person (saved Google pass), with made-up data the
// size of the live data and realistic reply times. Nothing reaches Google or Supabase.
//   node tools/perf_startup.mjs [htmlFile=index.html] [cpuSlowdown=4]
import { createRequire } from 'module'; import fs from 'fs'; import path from 'path';
const require = createRequire(import.meta.url); const { chromium } = require('playwright');
const HTML = process.argv[2] || 'index.html', SLOW = +process.argv[3] || 4;
const BASE = 'https://rotaligatos.github.io/modcraft-app/';
const LAT = { sheets: 900, google: 350, supa: 300, drive: 500 };          // ms per reply
const ME = 'perf.user@example.com';
const now = new Date().toISOString();
// ── made-up data ──
const cols = ['White','Gray','Walnut','Oak','Black','Cherry','Maple','Ash','Teak','Beige'];
const MAT = Array.from({ length: 153427 }, (_, i) => ({ name: cols[i % 10] + ' ' + cols[(i * 7) % 10] + ' Sample ' + i + ' PB 4x8 2F (18mm, Matte)', unit: 'pc', price: 1000 + i % 900 }));
const T = {
  price_materials: MAT,
  price_services: Array.from({ length: 66 }, (_, i) => ({ id: i + 1, name: 'Service ' + i, unit: 'lm', price: 20 + i, cost_data: {} })),
  price_hardware: Array.from({ length: 170 }, (_, i) => ({ id: i + 1, name: 'Hardware ' + i, unit: 'pc', price: 50 })),
  cabinet_templates: Array.from({ length: 260 }, (_, i) => ({ cabinet: 'Kitchen Base Cabinet', category: 'materials', name: 'Item ' + i, unit: 'pc', qty: 1, price: 10 })),
  approval_requests: Array.from({ length: 1617 }, (_, i) => ({ id: 'req_' + i, req_type: 'discount', serial: 'QT-W' + String(i % 600).padStart(8, '0'), from_email: 'a@example.com', to_email: 'b@example.com', status: i < 5 ? 'pending' : 'approved', created_at: now, updated_at: now, payload: { msg: 'x'.repeat(420), from: 'A' } })),
  messages: Array.from({ length: 900 }, (_, i) => ({ id: 'm' + i, from_email: 'a@example.com', to_email: ME, message: 'x'.repeat(140), status: 'read', created_at: now, updated_at: now })),
  pending_orders: Array.from({ length: 274 }, (_, i) => ({ id: String(8700 + i), received_at: now, client_name: 'Client ' + i, company_name: 'Co ' + i, status: i % 6 ? 'Done' : 'Pending', source_company: 'World Class Laminate, Inc.', notes: 'x'.repeat(1200), updated_at: now })),
  clients: Array.from({ length: 192 }, (_, i) => ({ id: String(i + 1), name: 'Client ' + i, biz_name: 'Co ' + i, client_type: 'Direct' })),
  quotations: Array.from({ length: 632 }, (_, i) => ({ serial: 'QT-W' + String(i).padStart(8, '0'), created_at: now, client_name: 'Client ' + (i % 190), total: 10000 + i, status: 'IQ Locked', service_type: 'Fabrication only' })),
  settings: [{ key: 'CONFIG', value: { mtoMaterials: Array.from({ length: 37 }, (_, i) => 'Made To Order Board ' + i) } }, { key: 'PRICEDB_MATERIALS_COUNT', value: { count: MAT.length } }].concat(Array.from({ length: 14 }, (_, i) => ({ key: 'SIG_u' + i + '@example.com', value: 'data:image/png;base64,' + 'A'.repeat(22000) }))),
};
const USERS = [['Name','Email','Role','Active','Company'], ['Perf User', ME, 'Admin', 'yes', 'World Class Laminate, Inc.']]
  .concat(Array.from({ length: 18 }, (_, i) => ['U' + i, 'u' + i + '@example.com', 'Staff', 'yes', 'World Class Laminate, Inc.']));
const QROWS = [['Serial','Created','Client']].concat(Array.from({ length: 520 }, (_, i) => ['QT-W' + String(i).padStart(8, '0'), now, 'Client ' + (i % 190), '', 'C', 'IQ Locked', String(10000 + i), 'Perf User', '', 'Yes', 'Initial', '1', 'Fabrication only', now, '', '', '', '', '', '', 'World Class Laminate, Inc.', '', '', '', '', now]));
const wait = ms => new Promise(r => setTimeout(r, ms));
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' };
const reqLog = [];
async function handle(route) {
  const q = route.request(), u = q.url(), m = q.method();
  if (u.startsWith(BASE)) {
    const f = decodeURIComponent(u.slice(BASE.length).split(/[?#]/)[0]) || 'index.html';
    const file = f === 'index.html' ? HTML : f;
    if (!fs.existsSync(path.resolve(file))) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ path: path.resolve(file), headers: { 'cache-control': 'max-age=600' } });
  }
  if (u.includes('cdn') || u.includes('gstatic')) return route.continue();
  if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
  const J = (o, h) => route.fulfill({ status: 200, contentType: 'application/json', headers: { ...CORS, ...h }, body: JSON.stringify(o) });
  if (!u.includes('accounts.google')) reqLog.push([Date.now() - t0, m, u.replace(/^https:\/\//, '').replace(/spreadsheets\/[^/]+/, 'ss').slice(0, 95)]);
  if (u.includes('oauth2/v3/userinfo')) { await wait(LAT.google); return J({ email: ME, name: 'Perf User' }); }
  if (u.includes('sheets.googleapis.com')) { await wait(LAT.sheets); const d = decodeURIComponent(u); let v = [];
    if (/User Roles/.test(d)) v = USERS; else if (/\/Quotations!/.test(d)) v = QROWS;
    return J({ values: v, sheets: [{ properties: { title: 'Messages', sheetId: 1 } }] }); }
  if (u.includes('googleapis.com')) { await wait(LAT.drive); return J({ modifiedTime: '2020-01-01T00:00:00Z', files: [] }); }
  if (u.includes('supabase.co')) { await wait(LAT.supa); const url = new URL(u); const tb = (u.match(/rest\/v1\/([a-z_]+)/) || [])[1];
    if (m !== 'GET' && m !== 'HEAD') return J([]);
    const all = T[tb] || []; let rows = all; const sel = url.searchParams.get('select') || '*';
    const ord = url.searchParams.get('order') || '', lim = url.searchParams.get('limit');
    url.searchParams.forEach((v, k) => { const e = /^(eq|ilike)\.(.*)$/.exec(v); if (e && all[0] && k in all[0]) rows = rows.filter(r => String(r[k]) === e[2]); });
    if (tb === 'price_materials' && lim === '1') rows = [{ id: all.length, updated_at: now }];
    const off = +(url.searchParams.get('offset') || 0), n = lim ? +lim : 10000; const page = rows.slice(off, off + n);
    return J(m === 'HEAD' ? [] : page, { 'content-range': off + '-' + (off + page.length - 1) + '/' + all.length }); }
  return route.abort();
}
let t0 = Date.now();
const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
await ctx.route('**/*', handle);
await ctx.addInitScript(me => {
  try {
    localStorage.setItem('mc_gpass', JSON.stringify({ t: 'tok', x: Date.now() + 36e5 })); localStorage.setItem('mc_last_google_email', me);
    const b64 = o => btoa(JSON.stringify(o)).replace(/=+$/, ''); const exp = Math.floor(Date.now() / 1000) + 7200;
    localStorage.setItem('sb-nkpekroogqsmfilypowd-auth-token', JSON.stringify({ access_token: b64({ alg: 'x' }) + '.' + b64({ email: me, sub: 'u1', exp }) + '.x', refresh_token: 'r', expires_at: exp, expires_in: 7200, token_type: 'bearer', user: { id: 'u1', email: me, aud: 'authenticated', user_metadata: { email: me }, identities: [] } }));
  } catch (e) {}
  window.__lt = []; try { new PerformanceObserver(l => l.getEntries().forEach(e => __lt.push([Math.round(e.startTime), Math.round(e.duration)]))).observe({ type: 'longtask', buffered: true }); } catch (e) {}
  window.__m = {}; const iv = setInterval(() => { const mk = k => { if (!__m[k]) __m[k] = Math.round(performance.now()); };
    try { const o = document.getElementById('login-overlay'); if (o && o.style.display === 'none') mk('appShown'); } catch (e) {}
    try { if (dirData && dirData.length) mk('quotations'); } catch (e) {} try { if (dbLoaded) mk('priceList'); } catch (e) {}
    try { if (pendingOrders && pendingOrders.length) mk('orders'); } catch (e) {} }, 30);
}, ME);
for (const run of ['first visit (fills this browser\'s copy)', 'returning']) {
  const p = await ctx.newPage(); const errs = []; p.on('crash', () => console.log('PAGE CRASHED')); p.on('console', x => { if (process.env.V) console.log('   >', x.text().slice(0, 160)); }); p.on('pageerror', e => errs.push(e.message.slice(0, 120)));
  const c = await ctx.newCDPSession(p); await c.send('Emulation.setCPUThrottlingRate', { rate: SLOW });
  await c.send('Profiler.enable'); await c.send('Profiler.setSamplingInterval', { interval: 2000 }); await c.send('Profiler.start');
  reqLog.length = 0; t0 = Date.now(); await p.goto(BASE, { waitUntil: 'commit' }); await p.waitForTimeout(run === 'returning' ? 30000 : 45000);
  const { profile } = await c.send('Profiler.stop');
  const r = await p.evaluate(() => ({ m: __m, fp: performance.getEntriesByType('paint').map(x => Math.round(x.startTime))[0], lt: __lt }));
  const after = r.m.appShown || 0, held = r.lt.filter(x => x[0] >= after).reduce((a, x) => a + x[1], 0), before = r.lt.filter(x => x[0] < after).reduce((a, x) => a + x[1], 0);
  console.log('\n== ' + run + ' · cpu/' + SLOW + ' · ' + HTML); console.log('first paint', r.fp, 'ms |', JSON.stringify(r.m), '| screen held before app', before, 'ms, after', held, 'ms, longest after', Math.max(0, ...r.lt.filter(x => x[0] >= after).map(x => x[1])));
  console.log('long holds', JSON.stringify(r.lt.filter(x => x[1] > 250)));
  // time spent inside each named app function (inclusive, counted once per stack)
  const id = {}; profile.nodes.forEach(n => id[n.id] = n); profile.nodes.forEach(n => (n.children || []).forEach(k => id[k].parent = n.id));
  const inc = {}, self = {}; profile.samples.forEach((s, i) => { const seen = {}; const dt = profile.timeDeltas[i]; const f0 = id[s].callFrame; const k0 = (f0.functionName || '(anon)') + ':' + f0.lineNumber; self[k0] = (self[k0] || 0) + dt;
    for (let n = id[s]; n; n = id[n.parent]) { const f = n.callFrame; if (!f.functionName || f.url.indexOf('modcraft') < 0) continue; const k = f.functionName + ':' + f.lineNumber; if (!seen[k]) { seen[k] = 1; inc[k] = (inc[k] || 0) + dt; } } });
  console.log('inside:', Object.entries(inc).sort((a, b) => b[1] - a[1]).slice(0, 22).map(x => x[0] + ' ' + Math.round(x[1] / 1000)).join(', '));
  console.log('self:', Object.entries(self).sort((a, b) => b[1] - a[1]).slice(0, 10).map(x => x[0] + ' ' + Math.round(x[1] / 1000)).join(', '));
  if (run === 'returning') reqLog.slice(0, 60).forEach(x => console.log('  ', x.join(' ')));
  if (process.env.FUNC && run === 'returning') { await c.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    const F = {}; const ev = f => p.evaluate(f);
    F.libs = await ev(() => [typeof XLSX, typeof html2pdf, typeof html2canvas, typeof PptxGenJS].join());
    F.sheetUsers = await ev(() => sheetUsers.length + ' ' + currentRole);
    await ev(() => { navigate('directory'); }); await p.waitForTimeout(2500); F.projectRows = await ev(() => document.querySelectorAll('#dir-table tr').length);
    await ev(() => { navigate('approvals'); }); await p.waitForTimeout(1500); F.approvals = await ev(() => document.getElementById('page-approvals').innerText.length);
    await ev(() => { navigate('settings'); setStTab('database'); }); await p.waitForTimeout(2500);
    F.dbTab = await ev(() => document.getElementById('db-status-row').innerText.slice(0, 90) + ' | ' + ['services', 'materials', 'hardware', 'templates'].map(k => document.getElementById('pdb-cnt-' + k).innerText).join());
    await ev(() => { setPdbTab('materials'); const t = document.getElementById('mat-bulk-text'); t.value = dbMaterials[500].name.replace('18mm', '18 mm') + String.fromCharCode(10) + 'Totally New Board XYZ | 1200'; window.__tp = performance.now(); __lt.length = 0; t.dispatchEvent(new Event('input', { bubbles: true })); });
    F.bulkNow = await ev(() => document.getElementById('mat-bulk-preview').innerText.slice(0, 60)); for (let i = 0; i < 60; i++) { await p.waitForTimeout(500); if (await ev(() => /Will add/.test(document.getElementById('mat-bulk-preview').innerText))) break; }
    F.bulk = await ev(() => Math.round(performance.now() - __tp) + 'ms, longest hold ' + Math.max(0, ...__lt.map(x => x[1])) + ' | ' + document.getElementById('mat-bulk-preview').innerText.slice(0, 260));
    await ev(() => { setStTab('ppic'); setPpicSubTab('services'); }); await p.waitForTimeout(600); F.svcRows = await ev(() => document.getElementById('services-rows').innerHTML.length);
    F.lookup = await ev(() => { const f = lookupInSource(getMatSource(), ' ' + dbMaterials[150000].name.toUpperCase() + ' '); return f && f.price === dbMaterials[150000].price && typeof f.price; });
    console.log('FUNC', JSON.stringify(F, null, 1)); }
  if (errs.length) console.log('errors', errs);
  await p.close();
}
await b.close();
