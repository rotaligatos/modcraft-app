// Modcraft smoke test — loads index.html in a headless browser and fails (exit 1)
// if the app crashes on load, a critical function went missing, or a logic check
// regresses. Network-independent: external CDNs are blocked, so it needs no internet.
// Run:  node tools/smoke.mjs        (needs once:  npm i -D playwright)
import { createRequire } from 'module';
import { pathToFileURL } from 'url';
import path from 'path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const FILE = pathToFileURL(path.resolve(process.argv[2] || 'index.html')).href;

// Functions the app must always define. If a fix accidentally deletes or renames
// one, this list catches it. Extend as you rely on more.
const CRITICAL = ['recalc','recalcFQ','gSaveQuotation','gCheckRole','initQuotation',
  'saveQuotationJson','loadQuotationJson','navigate','initSupabase','gApiFetch',
  'renderApprovals','gLoadDirData','updateLockUI','_computeQuotationStatus'];

const browser = await chromium.launch();
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(e.message));
// Block anything not the local file — makes the run deterministic + offline.
await page.route('**/*', r => {
  const u = r.request().url();
  return u.startsWith('file:') ? r.continue() : r.abort();
});

try { await page.goto(FILE, { waitUntil: 'load', timeout: 30000 }); }
catch (e) { pageErrors.push('goto failed: ' + e.message); }
await page.waitForTimeout(1200);

const globals = await page.evaluate(n => Object.fromEntries(n.map(x => [x, typeof window[x]])), CRITICAL);
const hasBtn = await page.evaluate(() => !!document.getElementById('orpt-btn'));

// --- Logic checks: this is where a bug ticket becomes a failing test. Each is
//     guarded so an absent/renamed function is reported, not a crash. ---
const logic = await page.evaluate(() => {
  const out = [];
  const check = (label, fn, want) => {
    try { const got = fn(); out.push({ label, got, want, ok: JSON.stringify(got) === JSON.stringify(want) }); }
    catch (e) { out.push({ label, err: String(e).slice(0,120), ok: false }); }
  };
  if (typeof window._serialRoot === 'function')
    check('_serialRoot strips option + revision suffix',
          () => window._serialRoot('QT-M00000012-3.R1'), 'QT-M00000012');
  if (typeof window.fmtMoney === 'function')
    check('fmtMoney keeps 2 decimals',
          () => /234\.50/.test(String(window.fmtMoney(1234.5))), true);
  return out;
});

await browser.close();

const missing = CRITICAL.filter(n => globals[n] !== 'function');
const logicFails = logic.filter(l => !l.ok);
let fail = false;

console.log('MODCRAFT SMOKE TEST');
console.log('  load errors (uncaught JS):', pageErrors.length ? 'FAIL' : 'ok');
pageErrors.slice(0,12).forEach(e => console.log('      x', e.slice(0,180)));
console.log('  critical functions:', missing.length ? 'FAIL — missing: ' + missing.join(', ') : 'ok (' + CRITICAL.length + ' present)');
console.log('  report button:', hasBtn ? 'ok' : 'FAIL — #orpt-btn not found');
console.log('  logic checks:', logic.length ? (logicFails.length ? 'FAIL' : 'ok (' + logic.length + ' passed)') : 'none run');
logic.forEach(l => console.log('      ' + (l.ok ? 'ok ' : 'x  ') + l.label + (l.err ? ' — ' + l.err : (l.ok ? '' : ' — got ' + JSON.stringify(l.got) + ', want ' + JSON.stringify(l.want)))));

if (pageErrors.length || missing.length || !hasBtn || logicFails.length) fail = true;
console.log('\n' + (fail ? 'RESULT: FAIL' : 'RESULT: PASS'));
process.exit(fail ? 1 : 0);
