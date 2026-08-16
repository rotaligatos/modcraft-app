// Modcraft smoke test — loads a page in a headless browser and fails (exit 1) if it
// crashes on load, a critical function went missing, or a logic check regresses.
// Network-independent: external CDNs are blocked, so it needs no internet.
// Run:  node tools/smoke.mjs [file]      (needs once:  npm i -D playwright)
//         index.html   (default) — the app
//         approve.html           — the mobile approvals app
//
// WHY PROFILES AND NOT A SECOND SCRIPT: a copied runner drifts. This file has one
// runner and a table of what each page must satisfy, so a fix to the harness lands
// for both pages at once.
import { createRequire } from 'module';
import { pathToFileURL } from 'url';
import path from 'path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

/* approve.html does `supabase.createClient(...)` at TOP LEVEL, so with the CDN blocked the
   whole script dies before defining anything and every check below would report a false
   failure. This stub is the smallest thing that lets the real script run: every query is a
   chainable no-op, and getSession resolves to NO session — a real, reachable state that sends
   boot() down renderSignIn(). It deliberately does not fake a signed-in user; this gate proves
   the page loads and its pure logic holds, not that its data paths work. */
const SUPA_STUB = `window.supabase = { createClient: function () {
  var q = {};
  ['select','eq','neq','ilike','like','in','is','gte','lte','match','order','limit','range',
   'upsert','update','insert','delete','maybeSingle','single']
    .forEach(function (m) { q[m] = function () { return q; }; });
  var settled = function () { return Promise.resolve({ data: [], error: null }); };
  q.then  = function (a, b) { return settled().then(a, b); };
  q.catch = function (f)    { return settled().catch(f); };
  return {
    auth: {
      getSession:        function () { return Promise.resolve({ data: { session: null }, error: null }); },
      getUser:           function () { return Promise.resolve({ data: { user: null }, error: null }); },
      setSession:        function () { return Promise.resolve({ data: { session: null }, error: null }); },
      signInWithOAuth:   function () { return Promise.resolve({ data: null, error: null }); },
      onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } }; }
    },
    from: function () { return q; },
    functions: { invoke: function () { return Promise.resolve({ data: null, error: null }); } },
    storage: { from: function () { return { createSignedUrl: function () {
      return Promise.resolve({ data: null, error: null }); } }; } }
  };
} };`;

const PROFILES = {
  'index.html': {
    // Functions the app must always define. If a fix accidentally deletes or renames
    // one, this list catches it. Extend as you rely on more.
    critical: ['recalc','recalcFQ','gSaveQuotation','gCheckRole','initQuotation',
      'saveQuotationJson','loadQuotationJson','navigate','initSupabase','gApiFetch',
      'renderApprovals','gLoadDirData','updateLockUI','_computeQuotationStatus'],
    requireEl: { id: 'orpt-btn', label: 'report button' },
    stubs: [],
    logic: () => {
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
    }
  },

  'approve.html': {
    critical: ['boot','render','act','loadList','loadRequest','authoriseAction','onOverride',
      'onCounter','ovrEval','ovrRead','reasonBoxHtml','recordDeviceCapability','enablePush',
      'lamiMount','lamiAsk','lamiSay'],
    /* Not #root — that is in the static markup and would pass even if the script never ran.
       #si only exists once boot() has run to completion and painted the signed-out view, so
       it proves the page is alive, not merely served. */
    requireEl: { id: 'si', label: 'boot() reached the signed-out view' },
    stubs: [{ match: 'supabase-js', body: SUPA_STUB }],
    logic: () => {
      const out = [];
      const check = (label, fn, want) => {
        try { const got = fn(); out.push({ label, got, want, ok: JSON.stringify(got) === JSON.stringify(want) }); }
        catch (e) { out.push({ label, err: String(e).slice(0,120), ok: false }); }
      };
      const r2 = n => Math.round(n * 100) / 100;

      if (typeof window.ovrEval === 'function') {
        const base = { regularBase:1000, ni:false, mobBase:0, instBase:0, otherFixed:0,
                       mssiRate:0, desRate:0, discPct:0, premRate:0, vatRate:0.12, cost:0 };
        const zero = { fabContingency:0, fabBuffer:0, mobContingency:0, mobBuffer:0, mobMarkup:0,
                       instContingency:0, instBuffer:0, instMarkup:0, discountBuffer:0 };
        check('ovrEval: 1000 base at 12% VAT -> 1120 grand / 1000 ex-VAT',
          () => { const r = window.ovrEval(base, zero); return [r2(r.grand), r2(r.exVat)]; },
          [1120, 1000]);
        /* The ni gate in BOTH directions. Fabrication buffer and discount buffer apply only when
           installation is included — the phone must price it exactly as the engine does, and the
           failure is silent money if it ever stops matching. */
        check('ovrEval: fab + discount buffer apply only when installation is included',
          () => {
            const r = Object.assign({}, zero, { fabBuffer:10, discountBuffer:5 });
            return [r2(window.ovrEval(Object.assign({}, base, { ni:false }), r).grand),
                    r2(window.ovrEval(Object.assign({}, base, { ni:true  }), r).grand)];
          },
          [1120, 1293.6]);
      }
      /* Shipped broken once: OVR was `var OVR` inside render() but read by onOverride() and
         act(), a ReferenceError that only fired on override requests — so every other type
         short-circuited past it and nobody saw it. */
      check('OVR is module-scoped, not trapped inside render()',
        () => typeof window.OVR !== 'undefined', true);
      /* reasonBoxHtml() writes the box and act() reads el('rsn'). Rename one and the reason is
         dropped in silence — the decision still lands, just with no record of why. */
      if (typeof window.reasonBoxHtml === 'function')
        check('reasonBoxHtml emits the id act() reads (rsn)',
          () => /id="rsn"/.test(window.reasonBoxHtml()), true);
      return out;
    }
  }
};

const TARGET = process.argv[2] || 'index.html';
const NAME = path.basename(TARGET).toLowerCase();
const PROFILE = PROFILES[NAME];
if (!PROFILE) {
  // Loud, not silently green: an unknown target must never look like a pass.
  console.error('SMOKE: no profile for "' + NAME + '". Known: ' + Object.keys(PROFILES).join(', '));
  console.error('Add one to PROFILES in tools/smoke.mjs rather than pointing it at a fallback.');
  process.exit(1);
}
const FILE = pathToFileURL(path.resolve(TARGET)).href;

const browser = await chromium.launch();
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(e.message));
// Block anything not the local file — makes the run deterministic + offline. A profile may
// stub a specific external script (see SUPA_STUB); everything else is still aborted.
await page.route('**/*', r => {
  const u = r.request().url();
  if (u.startsWith('file:')) return r.continue();
  const stub = PROFILE.stubs.find(s => u.includes(s.match));
  if (stub) return r.fulfill({ status: 200, contentType: 'application/javascript', body: stub.body });
  return r.abort();
});

try { await page.goto(FILE, { waitUntil: 'load', timeout: 30000 }); }
catch (e) { pageErrors.push('goto failed: ' + e.message); }
await page.waitForTimeout(1200);

const globals = await page.evaluate(n => Object.fromEntries(n.map(x => [x, typeof window[x]])), PROFILE.critical);
const hasEl = await page.evaluate(id => !!document.getElementById(id), PROFILE.requireEl.id);
const logic = await page.evaluate(PROFILE.logic);

await browser.close();

const missing = PROFILE.critical.filter(n => globals[n] !== 'function');
const logicFails = logic.filter(l => !l.ok);

console.log('MODCRAFT SMOKE TEST — ' + NAME);
console.log('  load errors (uncaught JS):', pageErrors.length ? 'FAIL' : 'ok');
pageErrors.slice(0,12).forEach(e => console.log('      x', e.slice(0,180)));
console.log('  critical functions:', missing.length ? 'FAIL — missing: ' + missing.join(', ') : 'ok (' + PROFILE.critical.length + ' present)');
console.log('  ' + PROFILE.requireEl.label + ':', hasEl ? 'ok' : 'FAIL — #' + PROFILE.requireEl.id + ' not found');
console.log('  logic checks:', logic.length ? (logicFails.length ? 'FAIL' : 'ok (' + logic.length + ' passed)') : 'none run');
logic.forEach(l => console.log('      ' + (l.ok ? 'ok ' : 'x  ') + l.label + (l.err ? ' — ' + l.err : (l.ok ? '' : ' — got ' + JSON.stringify(l.got) + ', want ' + JSON.stringify(l.want)))));

const fail = !!(pageErrors.length || missing.length || !hasEl || logicFails.length);
console.log('\n' + (fail ? 'RESULT: FAIL' : 'RESULT: PASS'));
process.exit(fail ? 1 : 0);
