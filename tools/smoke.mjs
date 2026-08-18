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
      /* Ticket 1c41c397: the KPI briefing labelled the figure "Conversion rate" while every
         screen calls it "Win rate". Drives the real builder instead of grepping source, so it
         stays honest if the string moves; `emitted` is asserted too, so the check cannot pass
         vacuously if the role/data gate ever stops producing the block at all. */
      if (typeof window._chipBuildSystemPrompt === 'function')
        check('KPI briefing calls the figure "Win rate", matching the UI', () => {
          const w = window, role = w.currentRole, sess = w.sessionQuotations;
          try {
            w.currentRole = 'Admin';   // canViewCostReport() gate
            w.sessionQuotations = { 'QT-TEST-0001': { id: 'QT-TEST-0001', status: 'Draft', value: 0 } };
            const sys = String(w._chipBuildSystemPrompt() || '');
            return { emitted: sys.includes('Confidential KPI'),
                     winRate: /Win rate:/.test(sys),
                     conversionRate: /Conversion rate/.test(sys) };
          } finally { w.currentRole = role; w.sessionQuotations = sess; }
        }, { emitted: true, winRate: true, conversionRate: false });
      /* Ticket 7376f5d0: when the override being actioned belongs to a quotation that is NOT the
         one open, the panel now evaluates the request's stored model instead of blanking — so
         _ccfEval is what the approver's cost, profit and margin are computed from. Asserted in
         BOTH ni directions: the fabrication and discount buffers apply only when installation is
         included, and a drift there is silent money on a live approval. */
      if (typeof window._ccfEval === 'function')
        check('_ccfEval: ni gates fab + discount buffer; profit and margin follow cost', () => {
          const r2 = n => Math.round(n * 100) / 100;
          const base = { regularBase:1000, mobBase:0, instBase:0, otherFixed:0, ni:false,
                         mssiRate:0, desRate:0, discPct:0, premRate:0, vatRate:0.12, cost:600 };
          const rates = { fabContingency:0, fabBuffer:10, mobContingency:0, mobBuffer:0, mobMarkup:0,
                          instContingency:0, instBuffer:0, instMarkup:0, discountBuffer:5 };
          const off = window._ccfEval(base, rates);
          const on  = window._ccfEval(Object.assign({}, base, { ni:true }), rates);
          return [r2(off.grand), r2(on.grand), r2(off.exVat), r2(off.profit), off.marginPct];
        }, [1120, 1293.6, 1000, 400, 40]);
      /* Ticket 7376f5d0 follow-up: the Admin undo for an Initial-Quotation approval is the only
         way back from a misclick — requestUnlock refuses while the approval stands, and unlock is
         the only thing that clears it. An approved quotation is LOCKED, and updateLockUI disables
         everything inside #s1-wrap without data-lock-exempt, so losing that attribute renders the
         escape hatch disabled exactly when it is needed. Silent, so it is pinned here. */
      check('undo-approval button exists and is exempt from the lock sweep', () => {
        const b = document.getElementById('undo-iqappr-btn');
        return { exists: !!b, exempt: b ? b.getAttribute('data-lock-exempt') : null,
                 handler: typeof window.adminUndoIqApproval };
      }, { exists: true, exempt: '1', handler: 'function' });
      /* Custom Report Export rebuild: KPI_DEFS used to be DEMO_PROJS.length+308 and
         DEMO_USERS-summed money — fixed values regardless of what dirData held. Drives the
         real KPI_DEFS.calc() against injected dirData so a future edit that reverts to a
         hardcoded/demo source fails loudly instead of silently exporting fake numbers again. */
      if (typeof window.KPI_DEFS === 'object' && typeof window._dashAllEntries === 'function')
        check('KPI_DEFS.totalQuotes counts real dirData, not a fixed demo formula', () => {
          const w = window, savedDir = w.dirData, savedSess = w.sessionQuotations;
          try {
            w.dirData = [
              { id:'QT-W00000001', baseSerial:'QT-W00000001', status:'Draft', value:1000, created:'2026-01-01', user:'A' },
              { id:'QT-W00000002', baseSerial:'QT-W00000002', status:'IQ Locked', value:2000, created:'2026-01-02', user:'B' }
            ];
            w.sessionQuotations = {};
            return w.KPI_DEFS.totalQuotes.calc();
          } finally { w.dirData = savedDir; w.sessionQuotations = savedSess; }
        }, 2);
      /* Revenue Trend used to be a hardcoded actual[]/target[] array with no data source at
         all. _reportRevenueTrend() must respect the reportTargets setting (0 = no target set,
         so the sheet/slide shows "No target set" rather than a fabricated comparison). */
      if (typeof window._reportRevenueTrend === 'function')
        check('_reportRevenueTrend: no target set -> target is null, not a hardcoded number', () => {
          const w = window, saved = w.reportTargets;
          try {
            w.reportTargets = { monthlyRevenue: 0 };
            const trend = w._reportRevenueTrend();
            return { months: trend.length, target: trend[0] && trend[0].target };
          } finally { w.reportTargets = saved; }
        }, { months: 12, target: null });
      /* Cutting List tab rebuild (2026-08-18): the grid used to start at zero rows,
         which read as an empty form rather than a ready sheet. Rommel: "there must be
         10 rows showing already than starting from zero." Checked on a FRESH module
         load, no MCL calls first — this is what a user actually sees on first open. */
      if (typeof window.MCL === 'object' && typeof window.MCL.state === 'function')
        check('MCL starts with 10 blank panel rows, not zero', () => window.MCL.state().panels.length, 10);
      /* Clear() must return to that same 10-row starting state, not to an empty table —
         otherwise "Clear" and "start fresh" would look different from each other.
         window.confirm blocks headless Playwright indefinitely if not stubbed first
         (bit this suite once before, see the method note on 2026-08-16). */
      if (typeof window.MCL === 'object' && typeof window.MCL.clear === 'function')
        check('MCL.clear() resets to 10 rows, not to zero', () => {
          const w = window, savedConfirm = w.confirm;
          try {
            w.confirm = () => true;
            w.MCL.addPanel(3);                        // prove clear() ignores extra rows too
            w.MCL.set(0, 'mat', 'Real White PB 4x8 2F (18mm, Matte)');
            w.MCL.clear();
            return w.MCL.state().panels.length;
          } finally { w.confirm = savedConfirm; }
        }, 10);
      /* Excel upload/download rebuild (2026-08-18): panels gained an Edge Material
         (emat) and Remarks field so an uploaded/typed value has somewhere to land
         instead of being silently dropped on the way into toCl(). Proven end-to-end
         against the real converter, not just that the field exists on the object. */
      if (typeof window.MCL === 'object' && typeof window._cutListToAnalysis === 'function')
        check('MCL panel emat/remark survive toCl() -> _cutListToAnalysis() as notes', () => {
          const w = window, savedConfirm = w.confirm;
          try {
            w.confirm = () => true;
            w.MCL.clear();
            w.MCL.set(0, 'group', 'Kitchen — Base Cabinet 1');
            w.MCL.set(0, 'mat', 'Real White PB 4x8 2F (18mm, Matte)');
            w.MCL.set(0, 'L', 720); w.MCL.set(0, 'W', 560); w.MCL.set(0, 'qty', 2);
            w.MCL.set(0, 'emat', 'Bamboo .5mm PVC Edgeband');
            w.MCL.set(0, 'remark', 'hinge side is the left edge');
            const cl = w.MCL.toCl();
            const payload = w._cutListToAnalysis(cl, null);
            const notes = payload.components[0] ? payload.components[0].notes : '';
            return { rows: payload.components.length,
                     emat: notes.indexOf('edge tape: Bamboo .5mm PVC Edgeband') >= 0,
                     remark: notes.indexOf('remarks: hinge side is the left edge') >= 0 };
          } finally { w.confirm = savedConfirm; }
        }, { rows: 1, emat: true, remark: true });
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
