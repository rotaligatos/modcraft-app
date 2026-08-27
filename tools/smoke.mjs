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
    // async: page.evaluate awaits whatever this returns, and one check below (the
    // _saveServicesToPriceDb Promise chain) needs a real await, not a fire-and-forget.
    logic: async () => {
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
      /* Rommel, 2026-08-24: exported a typed cutting list ("Light Cherry MDF 4x8 2F (18mm,
         Stipple)") into Designers Support and got "Dark Emperado/Light Gray" back instead --
         confirmed against the live catalog that the exact SKU he typed genuinely exists there.
         Root cause: _cutListToAnalysis's typed-label branch (no " -- SKU" separator, unlike a
         website order) dumped the WHOLE material string into the component's `color` field --
         substrate, board size, thickness and texture all duplicated inside it -- which then went
         into the catalogue search as one garbled, self-duplicating query. That query happened to
         score an unrelated colour higher than the exact match, because both shared nothing but
         the generic word "light". Fixed to use the same field parser faces already used (colour
         = only what's left after substrate/faces/texture/thickness are recognised and stripped),
         so the search string stays clean. Proves the fix directly: colour no longer contains the
         substrate/thickness/faces/texture tokens that used to ride along inside it. */
      if (typeof window._cutListToAnalysis === 'function')
        check('_cutListToAnalysis: a typed material label extracts colour, not the whole string duplicated', () => {
          const w = window;
          const cl = { origin: 'typed', grain: 'L', panels: [
            { group: 'Cabinet 1', part: 'Drawer front', mat: 'Light Cherry MDF 4x8 2F (18mm, Stipple)',
              th: 18, L: 595, W: 190, qty: 1, ebt: '2L 1S', emat: '', grain: 'L', svcs: [] }
          ], hpl: [], hardware: [] };
          const payload = w._cutListToAnalysis(cl, null);
          const c = payload.components[0] || {};
          return { material: c.material,
                   colorMentionsSubstrate: /\bmdf\b/i.test(c.color || ''),
                   colorMentionsThickness: /18\s*mm/i.test(c.color || ''),
                   colorMentionsFaces: /\b2f\b/i.test(c.color || ''),
                   colorMentionsLightCherry: /light\s*cherry/i.test(c.color || '') };
        }, { material: 'MDF', colorMentionsSubstrate: false, colorMentionsThickness: false,
             colorMentionsFaces: false, colorMentionsLightCherry: true });
      /* Same report, second half: even with a clean search string, the catalogue matcher treated
         being the ONLY candidate within scoring range as proof of a real match -- which is how
         "Dark Emperado/Light Gray" (sharing just the word "light") could still win over the
         genuine "Light Cherry" SKU if the two ever land close in score. Rommel: "Confidence level
         should be at 100% in regards to the sku." A lone candidate is now only auto-accepted when
         every field the query specifies (substrate/faces/texture/thickness) matches exactly and
         every colour word in the query is present in the candidate -- not just some of them. */
      if (typeof window._prodIsExactFieldMatch === 'function' && typeof window._prodParseMaterialDescriptor === 'function')
        check('_prodIsExactFieldMatch: a coincidental single match ("light") is refused; the real SKU is accepted', () => {
          const w = window;
          const query = w._prodParseMaterialDescriptor('MDF Light Cherry (Stipple) 18mm 2F');
          const wrongCandidate = w._prodParseMaterialDescriptor('Dark Emperado/Light Gray MDF 4x8 2F (18mm, Stipple)');
          const rightCandidate = w._prodParseMaterialDescriptor('Light Cherry MDF 4x8 2F (18mm, Stipple)');
          return {
            wrongCandidateRefused: w._prodIsExactFieldMatch(query, wrongCandidate) === false,
            rightCandidateAccepted: w._prodIsExactFieldMatch(query, rightCandidate) === true
          };
        }, { wrongCandidateRefused: true, rightCandidateAccepted: true });
      /* Same report, the freeze itself. _prodFindCatalogMatches calls _prodParseMaterialDescriptor
         once per catalog item -- with 153k+ material rows, pre-fix that was ~153k x ~33 `new
         RegExp(...)` compilations built from scratch and thrown away every single call, none of
         which ever changes between calls -- exactly what "the browser froze for several minutes"
         looks like. A wall-clock timing check was tried first and rejected: V8's regex compiler is
         fast enough that even the unfixed rebuild-every-call version cleared any threshold generous
         enough not to flake on a slow CI runner, so it silently failed to reproduce the bug at all.
         This counts actual `new RegExp(...)` calls instead, by swapping the global constructor for
         a counting wrapper for the duration of the check -- deterministic regardless of machine
         speed: the fixed version builds PROD_SUBSTRATE_RE/PROD_TEXTURE_RE once at module load
         (before this check ever runs), so calling _prodParseMaterialDescriptor afterward should
         construct exactly zero more. */
      if (typeof window._prodParseMaterialDescriptor === 'function')
        check('_prodParseMaterialDescriptor: builds no new RegExp per call (the several-minute freeze)', () => {
          const w = window;
          const NativeRegExp = w.RegExp;
          let constructed = 0;
          function CountingRegExp(...args) { constructed++; return new NativeRegExp(...args); }
          CountingRegExp.prototype = NativeRegExp.prototype;
          w.RegExp = CountingRegExp;
          try {
            for (let i = 0; i < 50; i++) w._prodParseMaterialDescriptor('Light Cherry MDF 4x8 2F (18mm, Stipple)');
            return { newRegexPerCall: constructed === 0 };
          } finally { w.RegExp = NativeRegExp; }
        }, { newRegexPerCall: true });
      /* Ticket 0e65e1fd (2026-08-19): re-locking a quotation that owed a revision (unlocked, then
         re-locked) minted a WHOLE NEW quotation (QT-W00000132, then W00000133 on a second
         re-lock) instead of overwriting QT-W00000130 in place, per Rommel's own report and
         confirmed in the activity log. Root cause: _applyRevisionBump() reset qSerialCommitted to
         false, which routes the next gSaveQuotation() through the "unclaimed serial" branch —
         asking the counter/claim service for a brand-new number and overwriting qSerial with it,
         discarding the .R1 suffix entirely. A revision must NOT claim anything: its base serial
         already has a row. Simulates a previously-saved, locked quotation with a revision owed
         and drives the real function, asserting the claim flag survives untouched and the base
         serial is unchanged (only the suffix changes). */
      if (typeof window._applyRevisionBump === 'function' && typeof window._serialRoot === 'function')
        check('_applyRevisionBump: revision stays on the SAME row (no new serial claimed)', () => {
          const w = window;
          const saved = { qSerial: w.qSerial, qSerialCommitted: w.qSerialCommitted,
                           qRevisionPending: w.qRevisionPending, qRevisedFrom: w.qRevisedFrom };
          try {
            w.qSerial = 'QT-W00000130';
            w.qSerialCommitted = true;     // already saved+locked once — this is what a real revision starts from
            w.qRevisionPending = true;     // set by confirmUnlock() when the quotation is reopened
            w._applyRevisionBump();
            return { serial: w.qSerial, base: w._serialRoot(w.qSerial),
                      committed: w.qSerialCommitted, revisedFrom: w.qRevisedFrom };
          } finally {
            w.qSerial = saved.qSerial; w.qSerialCommitted = saved.qSerialCommitted;
            w.qRevisionPending = saved.qRevisionPending; w.qRevisedFrom = saved.qRevisedFrom;
          }
        }, { serial: 'QT-W00000130.R1', base: 'QT-W00000130', committed: true, revisedFrom: 'QT-W00000130' });
      /* Ticket 0e65e1fd follow-up (2026-08-19): the _applyRevisionBump fix above closes the ONE
         call site that produced the duplicate, but qSerialCommitted is a hand-managed flag any
         future feature can clear the same wrong way. This is the structural backstop: extends the
         "positive evidence required before writing a row" principle (_quotRowKnown, 2026-08-15)
         one step earlier, to the CLAIM decision itself. Proves both directions against the real
         _gSaveQuotationCore — a base serial the app already knows about must self-heal and skip
         the claim (whatever cleared the flag), and a genuinely new one must still go through the
         claim path untouched, so the legitimate double-claim-race guard right beside this code is
         not broken by it. */
      if (typeof window._gSaveQuotationCore === 'function' && typeof window._quotRowKnown === 'function')
        check('_gSaveQuotationCore: known base serial self-heals instead of claiming a new one', () => {
          const w = window;
          const saved = { gToken: w.gToken, gUser: w.gUser, qSerial: w.qSerial,
                           qSerialCommitted: w.qSerialCommitted, quotRowSeen: Object.assign({}, w._quotRowSeen),
                           proceedSave: w._proceedSaveQuotation, claimAtomic: w._claimSerialAtomic,
                           fallbackCheck: w._fallbackSerialCheck, serialClaimWaiters: w._serialClaimWaiters };
          let proceedCalled = false, claimCalled = false;
          try {
            w.gToken = 'test-token'; w.gUser = { email: 'test@x.com', name: 'Test' };
            w._serialClaimWaiters = null;
            w._proceedSaveQuotation = () => { proceedCalled = true; };
            // Stub BOTH acquisition paths: SERIAL_CLAIM_URL defaults empty in this headless page
            // (reads localStorage, which is blank on a fresh load), so the real run takes the
            // fallback branch, not the atomic-claim one — the test must recognise either as "a
            // new serial was requested", or it would fail for the wrong reason.
            w._claimSerialAtomic = () => { claimCalled = true; };
            w._fallbackSerialCheck = () => { claimCalled = true; };
            // Case 1: base serial already known (row exists) — must self-heal, never claim.
            w.qSerial = 'QT-W00000900.R1';
            w.qSerialCommitted = false;
            w._quotRowSeen = { 'QT-W00000900': true };
            w._gSaveQuotationCore();
            const known = { proceedCalled, claimCalled, committed: w.qSerialCommitted };
            // Case 2: genuinely new — no evidence anywhere — must still go through the claim path
            // (the legitimate case _serialClaimWaiters exists to guard), never self-heal past it.
            proceedCalled = false; claimCalled = false; w._serialClaimWaiters = null;
            w.qSerial = 'QT-W00000901';
            w.qSerialCommitted = false;
            w._quotRowSeen = {};
            w.dirData = [];
            w._gSaveQuotationCore();
            const unknown = { proceedCalledSync: proceedCalled, claimCalled };
            return { known, unknown };
          } finally {
            w.gToken = saved.gToken; w.gUser = saved.gUser; w.qSerial = saved.qSerial;
            w.qSerialCommitted = saved.qSerialCommitted; w._quotRowSeen = saved.quotRowSeen;
            w._proceedSaveQuotation = saved.proceedSave; w._claimSerialAtomic = saved.claimAtomic;
            w._fallbackSerialCheck = saved.fallbackCheck; w._serialClaimWaiters = saved.serialClaimWaiters;
          }
        }, { known: { proceedCalled: true, claimCalled: false, committed: true },
             unknown: { proceedCalledSync: false, claimCalled: true } });
      /* Rommel, 2026-08-19: the printed area/type/lump rows showed RAW fabrication cost while the
         printed Fabrication subtotal already included contingency, buffer, discount buffer and
         outsource markup as one aggregate — a client manually adding the visible rows landed
         short of the printed total. _fabAreaAllocation distributes that markup into each row so
         the visible amounts sum back to the printed total exactly.
         Proves the split is EXACT PER COMPONENT, not a flat blended average: two areas of equal
         raw cost but opposite composition (one pure regular-fab cost, one pure outsource) must
         receive DIFFERENT multipliers (their own rate), not the same ratio. Case 1 uses a pool
         that exactly equals the two areas' own correctly-marked-up weights (fabCont 10% x fabBuf
         5% = 1.155 on the regular area, outMarkup 50% = 1.5 on the outsource area), so the
         expected split is hand-computable and round: 11550 / 7500, not the ~12700/6350 a flat
         blended ratio would have produced. Case 2 uses a pool that does NOT equal the natural
         weight sum (simulating the real case where Assembly's share / discount buffer / cutting-
         list charge add residual on top) — only the exact-sum-to-pool invariant is checked there,
         since those extra components have no single "correct" per-area home by nature. */
      if (typeof window._fabAreaAllocation === 'function' && typeof window.getAreaSubtotal === 'function')
        check('_fabAreaAllocation: exact per-component split, not a flat blend; always sums to pool', () => {
          const w = window;
          const saved = { qAreas: w.qAreas, qFabMode: w.qFabMode, qChargeMatHw: w.qChargeMatHw };
          try {
            w.qFabMode = 'services';
            w.qChargeMatHw = true;   // bypass the DOM-dependent Direct/Subsidiary default
            w.qAreas = [
              { name: 'Area A (all regular)', items: [], svcItems: [],
                matItems: [{ name: 'Board', qty: 10, price: 1000 }], hwItems: [],
                outsourceMaterials: [], outsourceHardware: [] },
              { name: 'Area B (all outsource)', items: [], svcItems: [], matItems: [], hwItems: [],
                outsourceMaterials: [{ name: 'Outsourced panel', qty: 1, price: 5000 }],
                outsourceHardware: [] }
            ];
            const pC = { ni: true, rates: { fabCont: 10, fabBuf: 5, outCont: 0, outBuf: 0, outMarkup: 50 } };
            // Area A raw 10000 x 1.155 (fabCont x fabBuf) = 11550. Area B raw 5000 x 1.5
            // (outMarkup) = 7500. Pool set to exactly that sum so the expected split is exact.
            const exact = w._fabAreaAllocation(19050, pC);
            const messyPool = w._fabAreaAllocation(20000, pC);   // pool != natural weight sum
            const round2 = n => Math.round(n * 100) / 100;
            return {
              exactSplit: exact.map(round2),
              exactSums: round2(exact[0] + exact[1]) === 19050,
              messySums: round2(messyPool[0] + messyPool[1]) === 20000,
              singleAreaTakesWholePool: (() => {
                const savedAreas = w.qAreas;
                w.qAreas = [savedAreas[0]];
                const r = w._fabAreaAllocation(500, pC);
                w.qAreas = savedAreas;
                return r.length === 1 && r[0] === 500;
              })(),
              // Proves the WIRING, not just the allocation math in isolation — buildPrintRows
              // could pass the wrong variable, ignore `pool`, or mismatch mode/lump/area even with
              // a perfectly correct _fabAreaAllocation underneath. Extracts the rendered money
              // strings straight out of the HTML string buildPrintRows actually returns.
              areaModeRowsShowMarkedUpAmounts: (() => {
                const html = w.buildPrintRows('area', 19050, pC);
                return /11,550\.00/.test(html) && /7,500\.00/.test(html) && !/10,000\.00/.test(html);
              })(),
              lumpModeShowsWholePool: /19,050\.00/.test(w.buildPrintRows('lump', 19050, pC))
            };
          } finally {
            w.qAreas = saved.qAreas; w.qFabMode = saved.qFabMode; w.qChargeMatHw = saved.qChargeMatHw;
          }
        }, { exactSplit: [11550, 7500], exactSums: true, messySums: true, singleAreaTakesWholePool: true,
             areaModeRowsShowMarkedUpAmounts: true, lumpModeShowsWholePool: true });
      /* Extended 2026-08-19 for consistency: the itemized "Services, Materials & Hardware" mode
         (raw catalog line items) also now distributes markup, per line, not just per area. Proves
         a service, a REGULAR material and an OUTSOURCED material of comparable raw cost land on
         DIFFERENT amounts — the outsourced one doubled by a 100% outMarkup while fabCont/fabBuf
         are zeroed out, so nothing but the outsource rate could produce that number — and that
         Unit Price is adjusted along with Amount (qty=2 on the outsourced line: 300 raw price ->
         600 shown, not just the extended total), so Qty x Unit Price still visibly equals Amount
         on every row, not just in aggregate. A hardware row placed AFTER a hidden-pricing material
         section proves the allocation index isn't corrupted by hideMatPricing skipping display
         (li must still advance even when a material row shows "-" instead of a number). */
      if (typeof window.buildItemizedPrintRows === 'function' && typeof window._svcUnitPrice === 'function')
        check('buildItemizedPrintRows: markup distributed per line, unit price stays consistent with amount', () => {
          const w = window;
          const saved = { qAreas: w.qAreas, qFabMode: w.qFabMode, qChargeMatHw: w.qChargeMatHw, SERVICES: w.SERVICES };
          try {
            w.qFabMode = 'services';
            w.qChargeMatHw = true;
            w.SERVICES = [{ name: 'Test Service', price: 100, unit: 'pc' }];
            w.qAreas = [{
              name: 'Area X', items: [],
              svcItems: [{ svcIdx: 0, qty: 2 }],
              matItems: [{ name: 'Reg Material', qty: 1, price: 800, unit: 'pc' }],
              hwItems: [{ name: 'Reg Hardware', qty: 1, price: 50, unit: 'pc' }],
              outsourceMaterials: [{ name: 'Outsourced Material', qty: 2, price: 300, unit: 'pc' }],
              outsourceHardware: []
            }];
            // fabCont/fabBuf zeroed -> regular items keep their raw value exactly. outMarkup 100%
            // -> the outsourced line's weight is exactly double its raw cost. Pool set to the exact
            // sum of the four expected weights so every allocated amount is round and hand-checkable:
            // svc 100x2=200, mat 800x1=800, out (300x2)x2=1200, hw 50x1=50 -> pool 2250.
            const pC = { ni: true, rates: { fabCont: 0, fabBuf: 0, outCont: 0, outBuf: 0, outMarkup: 100 } };
            const html = w.buildItemizedPrintRows(false, 2250, pC);
            return {
              svcAmount200: /200\.00/.test(html),
              svcUnitPrice100: /100\.00/.test(html),
              regMaterialUnchanged800: /800\.00/.test(html),
              outsourcedUnitPriceDoubled600: /600\.00/.test(html),   // 300 raw -> 600, not left at 300
              outsourcedAmount1200: /1,200\.00/.test(html),
              rawOutsourcePriceNeverShown: !/(^|[^,.\d])300\.00/.test(html),
              areaSubtotalMatchesPool: /2,250\.00/.test(html),
              hiddenPricingStillShowsHardwareAfterIt: (() => {
                const hh = w.buildItemizedPrintRows(true, 2250, pC);   // hideMatPricing=true
                return /—/.test(hh) && /50\.00/.test(hh) && /2,250\.00/.test(hh);
              })()
            };
          } finally {
            w.qAreas = saved.qAreas; w.qFabMode = saved.qFabMode;
            w.qChargeMatHw = saved.qChargeMatHw; w.SERVICES = saved.SERVICES;
          }
        }, { svcAmount200: true, svcUnitPrice100: true, regMaterialUnchanged800: true,
             outsourcedUnitPriceDoubled600: true, outsourcedAmount1200: true,
             rawOutsourcePriceNeverShown: true, areaSubtotalMatchesPool: true,
             hiddenPricingStillShowsHardwareAfterIt: true });
      /* Rommel, 2026-08-21: a real Subsidiary-account, services-mode printout (QT-W00000141) showed
         every SERVICE line's unit price and amount at ~1/7 of its real value, while the stated Area/
         Fabrication subtotal stayed correct -- individual rows did not sum to the subtotal printed
         directly below them. Root cause: buildItemizedPrintRows() weighted regular materials/
         hardware at their FULL raw price when splitting the pool proportionally, even when
         _chargeMatHw() says this account isn't actually billed for them (the Subsidiary-WCLI rule
         getAreaSubtotal() already applies) -- hideMatPricing only hides the DISPLAY, so the material
         weight silently diluted every service line's share regardless. Real numbers: services
         totalled 2,436.98 (the correct, materials-excluded pool) while material weight of 14,687.78
         was still counted, so each service line received only 2,436.98/17,124.76 = 14.23% of its
         true share -- a ~7.03x understatement, matching the reported ratio exactly. Proves the fix
         both ways: with materials NOT charged, a service line gets its FULL raw share (not diluted)
         and the whole pool still reconciles to itself; an OUTSOURCED material stays weighted
         regardless (getAreaSubtotal()'s own "never waived for Subsidiary" rule), while the regular
         material next to it is correctly zeroed. */
      if (typeof window.buildItemizedPrintRows === 'function' && typeof window._svcUnitPrice === 'function')
        check('buildItemizedPrintRows: materials not billed to this account do not dilute service line amounts', () => {
          const w = window;
          const saved = { qAreas: w.qAreas, qFabMode: w.qFabMode, qChargeMatHw: w.qChargeMatHw, SERVICES: w.SERVICES };
          try {
            w.qFabMode = 'services';
            w.qChargeMatHw = false;   // the Subsidiary-WCLI case: materials/hardware not billed
            w.SERVICES = [{ name: 'Test Service', price: 100, unit: 'pc' }];
            w.qAreas = [{
              name: 'Area X', items: [],
              svcItems: [{ svcIdx: 0, qty: 20 }],   // raw 2000 -- the only thing that should count
              matItems: [{ name: 'Reg Material', qty: 1, price: 12000, unit: 'pc' }],  // must weigh 0
              hwItems: [{ name: 'Reg Hardware', qty: 1, price: 3000, unit: 'pc' }],    // must weigh 0
              outsourceMaterials: [{ name: 'Outsourced Material', qty: 1, price: 500, unit: 'pc' }], // still counts
              outsourceHardware: []
            }];
            const pC = { ni: true, rates: { fabCont: 0, fabBuf: 0, outCont: 0, outBuf: 0, outMarkup: 0 } };
            // Pool = full expected weight sum if the fix works: svc 2000 + out 500 = 2500. Under the
            // OLD (buggy) code the pool would be split against 2000+12000+3000+500=17500 of weight,
            // giving the service line ~228.57 instead of the full 2000 -- the exact bug reproduced.
            const html = w.buildItemizedPrintRows(false, 2500, pC);
            return {
              serviceGetsFullShare: /2,000\.00/.test(html),
              serviceUnitPriceUnchanged: /100\.00/.test(html),
              regMaterialZeroed: /(^|[^,.\d])0\.00/.test(html.replace(/2,000\.00|100\.00|2,500\.00|500\.00/g, '')),
              outsourcedMaterialStillCounted: /500\.00/.test(html),
              poolStillReconciles: /2,500\.00/.test(html),
            };
          } finally {
            w.qAreas = saved.qAreas; w.qFabMode = saved.qFabMode;
            w.qChargeMatHw = saved.qChargeMatHw; w.SERVICES = saved.SERVICES;
          }
        }, { serviceGetsFullShare: true, serviceUnitPriceUnchanged: true, regMaterialZeroed: true,
             outsourcedMaterialStillCounted: true, poolStillReconciles: true });
      /* Rommel, 2026-08-19: the auto-forwarded "Noted by" signature request (raised automatically
         the moment someone approves "Checked by") arrived with amount 0 and no decision data on
         Wynchelle Uy's quotations, so he could not evaluate it and rejected both. Root cause:
         confirmSignature() fires this auto-forward from inside the CHECKED-BY SIGNER's own
         session, "usually not open here" per that call site's own comment — so _pCalc there is
         whatever that browser happens to have loaded, not the quotation actually being signed.
         Fix carries the just-approved Checked-by request's OWN amount/decision forward (captured
         correctly when the preparer raised IT with the quotation genuinely open, and still valid —
         the quotation is locked and its total pinned between the two steps). Proves both branches
         against the real function: a carried snapshot is used verbatim, and — proving this is a
         genuine fix and not a lucky accident — the OLD failure mode (amount 0, decision null)
         still reproduces exactly when nothing is carried, i.e. this isn't disguising the bug, it
         is bypassing the browser context that caused it. */
      if (typeof window._sendSignatureRequest === 'function')
        check('_sendSignatureRequest: auto-forwarded Noted-by carries the Checked-by decision, not an empty local one', () => {
          const w = window;
          const saved = { findSig: w._findSignatory, saveReq: w.gSaveApprovalRequest, sendMsg: w.gSendMessage,
                           pushReq: w._pushApprovalRequest, pCalc: w._pCalc, gUser: w.gUser,
                           notifsLen: w.NOTIFS ? w.NOTIFS.length : 0 };
          try {
            w._findSignatory = () => ({ email: 'approver@test.com', name: 'Test Approver' });
            w.gSaveApprovalRequest = () => {};
            w.gSendMessage = () => {};
            w._pushApprovalRequest = () => {};
            w.gUser = { email: 'signer@test.com', name: 'Test Signer' };
            w._pCalc = null;   // the real-world case: the Checked-by signer's browser has nothing relevant loaded
            const carriedDecision = { ctx: 's1', exVat: 6175378.62, cost: 3007929.38, profit: 3167449.24, marginPct: 51.29 };
            const withCarry = w._sendSignatureRequest('noted', true, 'QT-TEST-0099', 'Test Client', 'checker@test.com',
                                                        { amount: 6175378.62, decision: carriedDecision });
            const withoutCarry = w._sendSignatureRequest('noted', true, 'QT-TEST-0099', 'Test Client', 'checker@test.com');
            return {
              carriedAmountUsed: !!withCarry && withCarry.amount === 6175378.62,
              carriedDecisionUsed: !!withCarry && !!withCarry.decision && withCarry.decision.exVat === 6175378.62,
              noCarryReproducesOldFailure: !!withoutCarry && withoutCarry.amount === 0 && withoutCarry.decision === null
            };
          } finally {
            w._findSignatory = saved.findSig; w.gSaveApprovalRequest = saved.saveReq; w.gSendMessage = saved.sendMsg;
            w._pushApprovalRequest = saved.pushReq; w._pCalc = saved.pCalc; w.gUser = saved.gUser;
            // NOTIFS.unshift PREPENDS, so the two test entries sit at the FRONT — remove exactly
            // those from index 0 rather than truncating by length, which would keep the new
            // entries and drop real ones instead.
            if (w.NOTIFS) w.NOTIFS.splice(0, w.NOTIFS.length - saved.notifsLen);
          }
        }, { carriedAmountUsed: true, carriedDecisionUsed: true, noCarryReproducesOldFailure: true });
      /* Rommel, 2026-08-19: "trying to adjust the override contingency and it seems it's not
         working." Root cause: _readCCFFields() used `parseFloat(x)||CF.fabContingency` for the
         three ...Contingency fields — 0 is falsy in JS, so typing 0 to zero out a rate silently
         reverted to the global default instead, both in the live preview AND in what actually got
         applied (_ccfUpdateProfitNow and confirmCustomCF both read through this same function) —
         which is exactly why it would look like nothing happened at all, not like a glitch. The
         buffer/markup fields happened to be unaffected only because their OWN fallback is also 0.
         Drives the real DOM inputs (present in static markup, not JS-built) and the real function,
         proving 0 now survives on all three previously-broken fields while a genuinely blank field
         still correctly falls back to the global rate — the fix narrows to exactly the broken
         case, it doesn't just remove the fallback altogether. */
      if (typeof window._readCCFFields === 'function' && document.getElementById('ccf-fab'))
        check('_readCCFFields: typing 0 for a contingency rate is respected, not silently reverted to global', () => {
          const w = window;
          // CF.fabContingency defaults to 0 in this bare, unauthenticated boot state (index.html's
          // own CF literal) — 0||0 === 0 either way, which would make a fix and its absence look
          // identical here. Forced to a distinguishable non-zero value so the test can actually
          // tell "kept the typed 0" apart from "silently fell back to global".
          const savedCF = { fabContingency: w.CF.fabContingency, mobContingency: w.CF.mobContingency,
                             instContingency: w.CF.instContingency };
          w.CF.fabContingency = 12; w.CF.mobContingency = 8; w.CF.instContingency = 15;
          const ids = ['ccf-fab', 'ccf-fabBuf', 'ccf-mob', 'ccf-mobBuf', 'ccf-mobMk',
                        'ccf-inst', 'ccf-instBuf', 'ccf-instMk', 'ccf-discBuf', 'ccf-matMargin'];
          const saved = {}; ids.forEach(id => { const e = document.getElementById(id); if (e) saved[id] = e.value; });
          try {
            ids.forEach(id => { const e = document.getElementById(id); if (e) e.value = '0'; });
            const allZero = w._readCCFFields();
            document.getElementById('ccf-fab').value = '';   // blank must still fall back
            const blankFab = w._readCCFFields();
            return {
              fabContingencyZeroRespected: allZero.fabContingency === 0,
              mobContingencyZeroRespected: allZero.mobContingency === 0,
              instContingencyZeroRespected: allZero.instContingency === 0,
              blankStillFallsBackToGlobal: blankFab.fabContingency === 12
            };
          } finally {
            ids.forEach(id => { const e = document.getElementById(id); if (e && saved[id] !== undefined) e.value = saved[id]; });
            w.CF.fabContingency = savedCF.fabContingency; w.CF.mobContingency = savedCF.mobContingency;
            w.CF.instContingency = savedCF.instContingency;
          }
        }, { fabContingencyZeroRespected: true, mobContingencyZeroRespected: true,
             instContingencyZeroRespected: true, blankStillFallsBackToGlobal: true });
      /* Rommel, 2026-08-19, second report on QT-W00000121: the printout correctly showed a 5%
         discount (computed and applied for real -- discOn:true in the saved calc) while the LIVE
         Stage 1 form showed "0" in the discount box with the amber "Request" button, as if nothing
         had ever been approved. Root cause: Stage 1's discount widget is STATIC markup, unlike
         Stage 2's (a JS-templated string rebuilt from fqDiscPct/fqDiscApproved on every render, so
         it cannot go stale) -- and nothing ever pushed qDiscPct/qDiscApproved into that static
         markup when they were set from SAVED data (reopening a quotation, switching options)
         rather than from the user's own click on the Approve button. The underlying value and the
         pricing were never wrong -- only the display. Proves the new shared sync function against
         the REAL static DOM elements, both directions: an approved 5% renders the value and the
         green Approved state, and dropping back to unapproved clears both -- so a future caller
         that forgets to call it is the only way this can regress, not the sync logic itself. */
      if (typeof window._syncDiscInputUI === 'function' && document.getElementById('disc-inp'))
        check('_syncDiscInputUI: Stage 1 discount widget reflects an approved discount from SAVED state, not just a typed one', () => {
          const w = window;
          const saved = { qDiscPct: w.qDiscPct, qDiscApproved: w.qDiscApproved };
          try {
            // Simulates exactly what restoreFullQuotationState/restoreQuotationSnapshot now do:
            // assign the globals from stored data, then sync -- never touching disc-inp directly.
            w.qDiscPct = 5; w.qDiscApproved = true;
            w._syncDiscInputUI();
            const approvedState = {
              inputShowsValue: document.getElementById('disc-inp').value === '5',
              buttonShowsApproved: document.getElementById('disc-req-btn').textContent.indexOf('Approved') >= 0,
              buttonIsSuccessStyled: document.getElementById('disc-req-btn').className.indexOf('btn-success') >= 0,
              okMessageVisible: document.getElementById('disc-ok-msg').style.display === 'flex',
              okTextShowsPercent: document.getElementById('disc-ok-txt').textContent === '5% discount approved'
            };
            w.qDiscPct = 0; w.qDiscApproved = false;
            w._syncDiscInputUI();
            const resetState = {
              inputCleared: document.getElementById('disc-inp').value === '',
              buttonBackToRequest: document.getElementById('disc-req-btn').textContent.indexOf('Request') >= 0,
              okMessageHidden: document.getElementById('disc-ok-msg').style.display === 'none'
            };
            return Object.assign({}, approvedState, resetState);
          } finally {
            w.qDiscPct = saved.qDiscPct; w.qDiscApproved = saved.qDiscApproved;
            w._syncDiscInputUI();   // put the real widget back the way it actually is
          }
        }, { inputShowsValue: true, buttonShowsApproved: true, buttonIsSuccessStyled: true,
             okMessageVisible: true, okTextShowsPercent: true,
             inputCleared: true, buttonBackToRequest: true, okMessageHidden: true });
      /* Rommel, 2026-08-19 (QT-W00000134): unlocking only ever cleared a COMPLETED signature
         (qSignatures.checked/.noted) -- a request still sitting PENDING at that moment was left
         completely untouched, so it stayed signable on a document that had already changed
         underneath it, while a fresh legitimate request for the re-locked version could exist
         at the same time -- two "Checked by" cards for one quotation. His rule: another signature
         request must not be possible while one is still in process, unless the existing one has
         been cancelled. Proves _cancelPendingSignaturesFor is scoped EXACTLY right: it must cancel
         every pending SIGNATURE request on the matching serial (both Checked-by and Noted-by, if
         both happened to be open) and leave everything else alone -- an already-actioned signature
         (history, not to be erased), a pending request on a DIFFERENT serial, and a pending request
         of a DIFFERENT type (e.g. unlock) all must survive untouched. */
      if (typeof window._cancelPendingSignaturesFor === 'function')
        check('_cancelPendingSignaturesFor: cancels pending signatures on this serial only, nothing else', () => {
          const w = window;
          const saved = { NOTIFS: w.NOTIFS, gSaveApprovalRequest: w.gSaveApprovalRequest,
                           gSendMessage: w.gSendMessage, logActivity: w.logActivity,
                           _updateNotifBadge: w._updateNotifBadge };
          const savedCalls = [], sentMessages = [];
          try {
            w.gSaveApprovalRequest = (req) => { savedCalls.push(req); };
            w.gSendMessage = (email) => { sentMessages.push(email); };
            w.logActivity = () => {};
            w._updateNotifBadge = () => {};
            w.NOTIFS = [
              { type: 'signature', status: 'pending',  serial: 'QT-TEST-0001', reqId: 'r1', sigSlot: 'checked', approverEmail: 'a@x.com' },
              { type: 'signature', status: 'pending',  serial: 'QT-TEST-0001', reqId: 'r2', sigSlot: 'noted',   approverEmail: 'b@x.com' },
              { type: 'signature', status: 'approved', serial: 'QT-TEST-0001', reqId: 'r3', sigSlot: 'checked', approverEmail: 'c@x.com' },
              { type: 'signature', status: 'pending',  serial: 'QT-TEST-0002', reqId: 'r4', sigSlot: 'checked', approverEmail: 'd@x.com' },
              { type: 'unlock',    status: 'pending',  serial: 'QT-TEST-0001', reqId: 'r5' }
            ];
            w._cancelPendingSignaturesFor('QT-TEST-0001', 'edgebanding is below minimum');
            return {
              checkedCancelled: w.NOTIFS[0].status === 'cancelled',
              notedCancelled: w.NOTIFS[1].status === 'cancelled',
              alreadyApprovedUntouched: w.NOTIFS[2].status === 'approved',
              differentSerialUntouched: w.NOTIFS[3].status === 'pending',
              differentTypeUntouched: w.NOTIFS[4].status === 'pending',
              exactlyTwoSaved: savedCalls.length === 2,
              exactlyTwoNotified: sentMessages.length === 2
            };
          } finally {
            w.NOTIFS = saved.NOTIFS; w.gSaveApprovalRequest = saved.gSaveApprovalRequest;
            w.gSendMessage = saved.gSendMessage; w.logActivity = saved.logActivity;
            w._updateNotifBadge = saved._updateNotifBadge;
          }
        }, { checkedCancelled: true, notedCancelled: true, alreadyApprovedUntouched: true,
             differentSerialUntouched: true, differentTypeUntouched: true,
             exactlyTwoSaved: true, exactlyTwoNotified: true });
      /* Rommel, 2026-08-27, QT-C00000006: the Option 2 pill at the top of the page kept showing
         the PRE-override total after a cost-factor override was applied and correctly took effect
         everywhere else on the page. qOptionsList[i].grand (what the pill renders) was only ever
         written at switch/approve/lock time -- a direct-apply price change (an override, a self-
         approved discount, toggling VAT) ran recalc() and updated the real total immediately, but
         none of those call sites touched the cached figure. Proves _syncActiveOptionGrand() updates
         the active option's cached grand from whatever _pCalc currently holds, leaves an INACTIVE
         option's cached grand untouched (only the one on screen should move), and no-ops cleanly
         when no option is active. */
      if (typeof window._syncActiveOptionGrand === 'function')
        check('_syncActiveOptionGrand: refreshes the ACTIVE option\'s cached total, not the others', () => {
          const w = window;
          const saved = { qActiveOptionId: w.qActiveOptionId, qOptionsList: w.qOptionsList, _pCalc: w._pCalc };
          try {
            w.qOptionsList = [{ id: 2, grand: 602541.59 }, { id: 3, grand: 1020865.69 }];
            w.qActiveOptionId = 2;
            w._pCalc = { grand: 899999.12 };   // the override just applied moved the real total
            w._syncActiveOptionGrand();
            const activeUpdated = w.qOptionsList[0].grand === 899999.12;
            const inactiveUntouched = w.qOptionsList[1].grand === 1020865.69;
            w.qActiveOptionId = 0;   // no option active -- must not throw or touch anything
            let noopOk = true;
            try { w._syncActiveOptionGrand(); } catch (e) { noopOk = false; }
            return { activeUpdated, inactiveUntouched, noopOk };
          } finally {
            w.qActiveOptionId = saved.qActiveOptionId; w.qOptionsList = saved.qOptionsList; w._pCalc = saved._pCalc;
          }
        }, { activeUpdated: true, inactiveUntouched: true, noopOk: true });
      if (typeof window._recalcCore === 'function' && typeof window._recalcFQCore === 'function')
        check('_recalcCore and _recalcFQCore both call _syncActiveOptionGrand after pricing (not orphaned)', () => {
          const src1 = window._recalcCore.toString(), src2 = window._recalcFQCore.toString();
          return {
            stage1Wired: src1.indexOf('_syncActiveOptionGrand(') > -1,
            stage1AfterPCalc: src1.indexOf('_pCalc={') < src1.indexOf('_syncActiveOptionGrand('),
            stage2Wired: src2.indexOf('_syncActiveOptionGrand(') > -1,
            stage2AfterPCalc: src2.indexOf('_pCalc={') < src2.indexOf('_syncActiveOptionGrand('),
          };
        }, { stage1Wired: true, stage1AfterPCalc: true, stage2Wired: true, stage2AfterPCalc: true });
      /* Rommel, 2026-08-27, same quotation: the bottom running-total bar read "FINAL QUOTATION —
         GRAND TOTAL" while the page visibly showed Stage 1 (the "Approve & proceed to Stage 2"
         button, the Stage 1 admin breakdown) with a correct number. Root cause: restoreFullQuotation
         State() sets qStage=state.stage directly and never syncs the DOM to match it -- goStage() is
         the ONLY function that toggles s1-wrap/s2-wrap and the s1btn/s2btn active classes, and it is
         never called during a restore. recalc() runs unconditionally regardless of qStage (it only
         ever prices Stage 1's own scope), so a quotation saved while qStage was 2 rendered Stage 1's
         real, correct content into the DEFAULT-visible s1-wrap -- while qStage stayed 2, and
         _qTotalBar()'s caption reads qStage directly. Source-checked (not functionally driven --
         constructing a full fake state risks tripping unrelated Drive/Supabase code paths this
         function also runs): the new sync block must exist, must NOT call initFinalQuotation()
         (fqAreas is already restored from state above it -- re-deriving from Stage 1 would clobber
         fqBondIns/fqInstRegion/etc. with Stage 1's CURRENT values), and must run before the function
         returns. */
      if (typeof window.restoreFullQuotationState === 'function')
        check('restoreFullQuotationState: syncs the visible stage to qStage on every restore', () => {
          const src = window.restoreFullQuotationState.toString();
          const stageAssignIdx = src.indexOf('qStage=state.stage');
          // Pre-existing comments in this function already discuss initFinalQuotation() in prose
          // (e.g. "Safe to re-run: initFinalQuotation() never touches fqLocked...") -- a plain
          // substring search would false-positive on those. A real call reads
          // "initFinalQuotation();" back to back; none of the prose does.
          return {
            stageAssignPresent: stageAssignIdx > -1,
            togglesS1Wrap: src.indexOf("el('s1-wrap')") > -1,
            togglesS2Wrap: src.indexOf("el('s2-wrap')") > -1,
            togglesTabClasses: src.indexOf("el('s1btn')") > -1 && src.indexOf("el('s2btn')") > -1,
            neverCallsInitFinalQuotation: src.indexOf('initFinalQuotation();') === -1,
            refreshesBarAtEnd: src.lastIndexOf('_qTotalBar()') > stageAssignIdx,
            realDomHooksExist: !!document.getElementById('s1-wrap') && !!document.getElementById('s1btn'),
          };
        }, { stageAssignPresent: true, togglesS1Wrap: true, togglesS2Wrap: true, togglesTabClasses: true,
             neverCallsInitFinalQuotation: true, refreshesBarAtEnd: true, realDomHooksExist: true });
      /* Rommel, 2026-08-19: "Add capability to search for the agent name." Agent was already
         captured on every quotation (cl-agent) and already searchable on the Orders queue, but
         never made it into the directory's own data at all -- not stored in the Quotations sheet
         row, not in sessionQuotations, so the Project List search had nothing to match against
         even in principle. Given it its own column (like Project Name/Source Order before it) and
         wired into the search filter. Proves the filter end-to-end against the real render
         function and real DOM: typing an agent's name shows only quotations assigned to that
         agent, typing something matching nobody shows none, and clearing the search shows both --
         so this cannot regress into "the field exists but nothing actually filters by it". */
      if (typeof window.renderDirectoryTable === 'function' && document.getElementById('dir-search'))
        check('renderDirectoryTable: search filter matches on agent name', () => {
          const w = window;
          const saved = { dirData: w.dirData, search: document.getElementById('dir-search').value };
          const mkEntry = (id, agent) => ({
            id, baseSerial: id, created: '2026-01-01T00:00:00Z', client: 'Client ' + id, contact: '',
            type: 'Fabrication only', value: 1000, user: 'Test User', segment: '', status: 'Draft',
            locked: false, stage: 'Initial', options: 1, initLockedAt: '', initApprovedAt: '',
            finalLockedAt: '', closedAt: '', sourceOrder: '', leadSource: '', project: '', company: '',
            jobSource: '', jobStartedAt: '', additionalFrom: '', clientApprovedAt: '', clientApproved: false,
            updatedAt: '2026-01-01T00:00:00Z', sentAt: '', agent
          });
          try {
            w.dirData = [mkEntry('QT-TEST-A001', 'Jane Reyes'), mkEntry('QT-TEST-A002', 'Mark Cruz')];
            const search = document.getElementById('dir-search');
            search.value = 'jane';
            w.renderDirectoryTable();
            const janeSearchHtml = document.getElementById('dir-table').innerHTML;
            search.value = 'nobody matches this';
            w.renderDirectoryTable();
            const noMatchHtml = document.getElementById('dir-table').innerHTML;
            search.value = '';
            w.renderDirectoryTable();
            const clearedHtml = document.getElementById('dir-table').innerHTML;
            return {
              agentSearchFindsOwnQuotation: janeSearchHtml.indexOf('QT-TEST-A001') >= 0,
              agentSearchExcludesOtherAgent: janeSearchHtml.indexOf('QT-TEST-A002') < 0,
              nonMatchingSearchShowsNeither: noMatchHtml.indexOf('QT-TEST-A001') < 0 && noMatchHtml.indexOf('QT-TEST-A002') < 0,
              clearedSearchShowsBoth: clearedHtml.indexOf('QT-TEST-A001') >= 0 && clearedHtml.indexOf('QT-TEST-A002') >= 0
            };
          } finally {
            w.dirData = saved.dirData;
            document.getElementById('dir-search').value = saved.search;
            try { w.renderDirectoryTable(); } catch (e) {}
          }
        }, { agentSearchFindsOwnQuotation: true, agentSearchExcludesOtherAgent: true,
             nonMatchingSearchShowsNeither: true, clearedSearchShowsBoth: true });
      /* Ticket 3080d4a0 (diagnosed 2026-08-17, actioned 2026-08-21): the date range applies to
         the KPI tiles above the grid (_dashUpdateKPIs reads dash-from/dash-to into `filtered`)
         but the customizable grid widgets built from _dashMetrics() scope by company only, via
         _dashScopedEntries() -- dash-from/dash-to were never read there at all. Masked because
         renderDashboard() defaults the range to Jan 1 -> today and nothing in real data predates
         that window; it becomes visible, and misleading, the moment anyone narrows the range, and
         the page starts disagreeing with itself. Proves a widget total now excludes an entry
         outside the chosen window, same as a tile would for the same range. */
      if (typeof window._dashMetrics === 'function' && document.getElementById('dash-from'))
        check('_dashMetrics: respects the date range, same as the KPI tiles above it', () => {
          const w = window;
          const fromEl = document.getElementById('dash-from'), toEl = document.getElementById('dash-to');
          const co = document.getElementById('dash-co');
          const saved = { dirData: w.dirData, sessionQuotations: w.sessionQuotations,
                           from: fromEl.value, to: toEl.value, co: co ? co.value : '' };
          try {
            w.dirData = [
              { id: 'QT-TEST-D001', baseSerial: 'QT-TEST-D001', status: 'IQ Locked', value: 1000,
                created: '2026-03-15T00:00:00Z', company: 'World Class Laminate, Inc.', client: 'In range' },
              { id: 'QT-TEST-D002', baseSerial: 'QT-TEST-D002', status: 'IQ Locked', value: 5000,
                created: '2026-01-01T00:00:00Z', company: 'World Class Laminate, Inc.', client: 'Out of range' }
            ];
            w.sessionQuotations = {};
            if (co) co.value = '';
            fromEl.value = '2026-03-01'; toEl.value = '2026-03-31';
            const m = w._dashMetrics();
            return { openCount: m.openCount, openPipeline: m.openPipeline };
          } finally {
            w.dirData = saved.dirData; w.sessionQuotations = saved.sessionQuotations;
            fromEl.value = saved.from; toEl.value = saved.to;
            if (co) co.value = saved.co;
          }
        }, { openCount: 1, openPipeline: 1000 });
      /* Ticket 3080d4a0 continued: additional orders roll up into the job they came from for the
         KPI tiles (_dashUpdateKPIs calls _rollupJobs -- "one job, one number") but were counted as
         their own separate quotation in the grid widgets, since _dashMetrics() iterated raw
         entries with no rollup -- so a tile count and the matching widget count differ by one
         whenever an additional order exists (live today: QT-W00000095 is an additional order from
         QT-W00000058). Proves a root job plus its additional order now count as ONE open
         quotation in the widgets too, not two -- openCount is the field that actually
         discriminates old from new here (summed revenue happens to match either way, since
         summing each entry's own value gives the same total as summing a rolled-up job's). */
      if (typeof window._dashMetrics === 'function' && typeof window._rollupJobs === 'function' && document.getElementById('dash-from'))
        check('_dashMetrics: an additional order rolls up into its root job, same as the KPI tiles', () => {
          const w = window;
          const fromEl = document.getElementById('dash-from'), toEl = document.getElementById('dash-to');
          const co = document.getElementById('dash-co');
          const saved = { dirData: w.dirData, sessionQuotations: w.sessionQuotations,
                           from: fromEl.value, to: toEl.value, co: co ? co.value : '' };
          try {
            w.dirData = [
              { id: 'QT-TEST-R001', baseSerial: 'QT-TEST-R001', status: 'FQ Locked', value: 1000,
                created: '2026-03-15T00:00:00Z', company: 'World Class Laminate, Inc.', client: 'Root job' },
              { id: 'QT-TEST-R002', baseSerial: 'QT-TEST-R002', status: 'FQ Locked', value: 500,
                created: '2026-03-16T00:00:00Z', company: 'World Class Laminate, Inc.', client: 'Additional order',
                additionalFrom: 'QT-TEST-R001' }
            ];
            w.sessionQuotations = {};
            if (co) co.value = '';
            fromEl.value = ''; toEl.value = '';
            const m = w._dashMetrics();
            return { openCount: m.openCount, openPipeline: m.openPipeline, additional: m.additional };
          } finally {
            w.dirData = saved.dirData; w.sessionQuotations = saved.sessionQuotations;
            fromEl.value = saved.from; toEl.value = saved.to;
            if (co) co.value = saved.co;
          }
        }, { openCount: 1, openPipeline: 1500, additional: 1 });
      /* Rommel, 2026-08-21: "check if the time counter of order actually consider holiday...
         today is holiday" -- PH_HOL is a hand-typed, static list of fixed 2026 dates; the
         mechanism that reads it (calcWorkingMinutes, the fabrication/installation holiday-premium
         check, the Schedule legend) was always correct, but two REAL, fixed, annual PH holidays
         were simply never added to the list: Ninoy Aquino Day (Aug 21) and Bonifacio Day (Nov 30).
         Confirmed live: 2026-08-21 -- today -- was silently counted as a normal working day by
         the order-response SLA timer. Checks both the array AND the name lookup stay in sync
         (PH_HOL_NAMES is what the Schedule legend and the holiday-premium alert text read; adding
         only to PH_HOL would fix the SLA timer but leave those two showing a bare "Holiday"). */
      if (typeof window.PH_HOL !== 'undefined' && typeof window.PH_HOL_NAMES !== 'undefined')
        check('PH_HOL includes the fixed annual holidays missing before this fix', () => ({
          aquinoDay: window.PH_HOL.indexOf('2026-08-21') >= 0,
          aquinoDayNamed: !!window.PH_HOL_NAMES['2026-08-21'],
          bonifacioDay: window.PH_HOL.indexOf('2026-11-30') >= 0,
          bonifacioDayNamed: !!window.PH_HOL_NAMES['2026-11-30'],
        }), { aquinoDay: true, aquinoDayNamed: true, bonifacioDay: true, bonifacioDayNamed: true });
      /* Proves the actual consumer, not just the data -- calcWorkingMinutes() must SKIP today
         entirely (0 minutes counted) for a company with excludeHolidays on, now that today is in
         the list. This is what the order-response timer calls; a data-only check could pass while
         the timer still ran through the day if excludeHolidays were somehow not wired to PH_HOL. */
      if (typeof window.calcWorkingMinutes === 'function' && typeof window.ordersSlaSettings !== 'undefined')
        check('calcWorkingMinutes skips a whole holiday, not just labels it one', () => {
          const w = window;
          const saved = w.ordersSlaSettings;
          try {
            w.ordersSlaSettings = { companies: { 'Test Co': { excludeHolidays: true,
              schedule: { 0: null, 1: { start: 8, end: 17 }, 2: { start: 8, end: 17 },
                          3: { start: 8, end: 17 }, 4: { start: 8, end: 17 },
                          5: { start: 8, end: 17 }, 6: null } } } };
            // Fri 2026-08-21 08:00 (the holiday) through Mon 2026-08-24 08:00 -- with the holiday
            // excluded, only Monday's window before 08:00 counts, i.e. zero elapsed minutes.
            return w.calcWorkingMinutes('2026-08-21T08:00:00+08:00', '2026-08-24T08:00:00+08:00', 'Test Co');
          } finally { w.ordersSlaSettings = saved; }
        }, 0);
      /* Rommel, 2026-08-21: "go with A" -- a Supabase Edge Function (sync-ph-holidays), scheduled
         monthly via pg_cron, now overwrites PH_HOL/PH_HOL_NAMES from a live national holiday feed
         at settings login-load time (_applyLoadedSettingsMap -> _applyPhHolidaySync), so the class
         of gap that let Aug 21 go missing cannot recur for a NATIONAL holiday. Proves the fail-safe
         in both directions: a genuine payload overwrites the fallback, and a missing/empty/
         malformed one leaves PH_HOL exactly as it was -- mirroring the Edge Function's own rule
         that a bad sync must never replace a good list with an empty one. */
      if (typeof window._applyPhHolidaySync === 'function')
        check('_applyPhHolidaySync: a real payload overwrites the fallback; a bad one leaves it alone', () => {
          const w = window;
          const saved = { PH_HOL: w.PH_HOL.slice(), PH_HOL_NAMES: Object.assign({}, w.PH_HOL_NAMES), syncedAt: w._phHolSyncedAt };
          try {
            w._applyPhHolidaySync({ synced: [{ date: '2026-08-21', name: 'Ninoy Aquino Day' }, { date: '2027-01-01', name: "New Year's Day" }], syncedAt: '2026-08-21T04:00:00Z' });
            const afterReal = { count: w.PH_HOL.length, has2027: w.PH_HOL.indexOf('2027-01-01') >= 0, syncedAtSet: w._phHolSyncedAt === '2026-08-21T04:00:00Z' };
            const beforeBad = w.PH_HOL.slice();
            w._applyPhHolidaySync({ synced: [] });          // empty -- must not touch anything
            w._applyPhHolidaySync(null);                     // missing -- must not touch anything
            w._applyPhHolidaySync({ synced: 'not an array' }); // malformed -- must not touch anything
            const afterBad = { unchanged: JSON.stringify(w.PH_HOL) === JSON.stringify(beforeBad) };
            return Object.assign({}, afterReal, afterBad);
          } finally {
            w.PH_HOL = saved.PH_HOL; w.PH_HOL_NAMES = saved.PH_HOL_NAMES; w._phHolSyncedAt = saved.syncedAt;
          }
        }, { count: 2, has2027: true, syncedAtSet: true, unchanged: true });
      /* Proves the wiring, not just the function in isolation -- _applyLoadedSettingsMap is the
         real entry point (called from gLoadAppSettings' Supabase-first path), and a map that
         simply HAS no PH_HOLIDAYS key (an older settings row, or a fresh project before the first
         sync) must not throw or clear anything -- the fallback stays in force silently. */
      if (typeof window._applyLoadedSettingsMap === 'function')
        check('_applyLoadedSettingsMap: wires PH_HOLIDAYS through; absent key does not throw', () => {
          const w = window;
          const saved = { PH_HOL: w.PH_HOL.slice(), PH_HOL_NAMES: Object.assign({}, w.PH_HOL_NAMES) };
          try {
            w._applyLoadedSettingsMap({ PH_HOLIDAYS: { synced: [{ date: '2099-05-05', name: 'Test Day' }] } });
            const wired = w.PH_HOL.length === 1 && w.PH_HOL[0] === '2099-05-05';
            let threw = false;
            try { w._applyLoadedSettingsMap({}); } catch (e) { threw = true; }
            return { wired, absentKeyThrew: threw };
          } finally { w.PH_HOL = saved.PH_HOL; w.PH_HOL_NAMES = saved.PH_HOL_NAMES; }
        }, { wired: true, absentKeyThrew: false });
      /* Local (regional/LGU-specific) holidays live PER COMPANY on ordersSlaSettings, deliberately
         separate from the shared national PH_HOL -- Nager.Date (the sync source) has zero
         subdivision data for the Philippines (every entry's counties/global fields confirm
         national-only), so a Cebu-only special day can never come from the auto-sync and must not
         silently apply to a Pasig-based company's timer too. Proves BOTH halves: the company that
         has the local holiday skips it, and a different company on the same day does not. */
      if (typeof window.calcWorkingMinutes === 'function')
        check('calcWorkingMinutes: a local holiday is scoped to its own company, not shared', () => {
          const w = window;
          const saved = w.ordersSlaSettings;
          try {
            const sched = { 0: null, 1: { start: 8, end: 17 }, 2: { start: 8, end: 17 },
                             3: { start: 8, end: 17 }, 4: { start: 8, end: 17 }, 5: { start: 8, end: 17 }, 6: null };
            w.ordersSlaSettings = { companies: {
              'Cebu Co': { excludeHolidays: true, schedule: sched, localHolidays: [{ date: '2026-08-24', name: 'Test Local Holiday' }] },
              'Pasig Co': { excludeHolidays: true, schedule: sched, localHolidays: [] },
            } };
            // Mon 2026-08-24, a full 8-17 shift -- excluded for Cebu Co (its own local holiday),
            // fully counted for Pasig Co (no local holiday of its own that day).
            return {
              cebuSkipsIt: w.calcWorkingMinutes('2026-08-24T08:00:00+08:00', '2026-08-24T17:00:00+08:00', 'Cebu Co'),
              pasigDoesNotShareIt: w.calcWorkingMinutes('2026-08-24T08:00:00+08:00', '2026-08-24T17:00:00+08:00', 'Pasig Co'),
            };
          } finally { w.ordersSlaSettings = saved; }
        }, { cebuSkipsIt: 0, pasigDoesNotShareIt: 540 });
      /* Rommel, 2026-08-22: a discount request sent by an estimator on a quotation that had never
         been saved got filed under a bare '--' placeholder in the approval_requests table --
         confirmed live: req_1787383041132_ylrfle, serial '--', approved an hour later, still stuck
         applied:false. Approving it then tried to write the decision into a quotation that no real
         serial could ever resolve back to, throwing the raw browser alert "No saved state found for
         --." straight at the approver. qDraftKey already exists specifically to identify an unsaved
         quotation (see 2026-08-11, "A draft has no quotation number") -- the request-raising code at
         onDiscRequest/fqOnDiscRequest/openCustomCF/fqOpenCustomCF just never consulted it before
         filing a request. Rommel's decision: require a save first, rather than make the request
         carry the draft key through (self-approval via PIN is untouched -- it never files a routed
         request at all, so there's nothing to lose track of). */
      if (typeof window._requireSavedForRequest === 'function')
        check('_requireSavedForRequest: blocks a discount/override request before the first save', () => {
          const w = window;
          const saved = { qDraftKey: w.qDraftKey, toast: w.showToast };
          let toastCalled = false;
          w.showToast = () => { toastCalled = true; };
          try {
            w.qDraftKey = 'DRAFT-abc123';
            const blockedWhileDraft = w._requireSavedForRequest() === false;
            const toastFiredOnBlock = toastCalled;
            toastCalled = false;
            w.qDraftKey = '';
            const allowedOnceSaved = w._requireSavedForRequest() === true;
            const noToastWhenAllowed = !toastCalled;
            return { blockedWhileDraft, toastFiredOnBlock, allowedOnceSaved, noToastWhenAllowed };
          } finally { w.qDraftKey = saved.qDraftKey; w.showToast = saved.toast; }
        }, { blockedWhileDraft: true, toastFiredOnBlock: true, allowedOnceSaved: true, noToastWhenAllowed: true });
      if (typeof window.onDiscRequest === 'function' && document.getElementById('disc-inp'))
        check('onDiscRequest: does not send a discount request before the quotation has been saved', () => {
          const w = window;
          const discInpEl = document.getElementById('disc-inp');
          const saved = { qDraftKey: w.qDraftKey, currentRole: w.currentRole, openSendRequest: w.openSendRequest,
                           discInp: discInpEl.value };
          let sent = false;
          w.openSendRequest = () => { sent = true; };
          try {
            w.currentRole = 'Staff';           // not an approver -- takes the else branch that requests
            discInpEl.value = '5';
            w.qDraftKey = 'DRAFT-xyz789';       // never saved
            w.onDiscRequest();
            const blockedBeforeSave = sent === false;
            w.qDraftKey = '';                  // now saved
            w.onDiscRequest();
            const allowedAfterSave = sent === true;
            return { blockedBeforeSave, allowedAfterSave };
          } finally {
            w.qDraftKey = saved.qDraftKey; w.currentRole = saved.currentRole; w.openSendRequest = saved.openSendRequest;
            discInpEl.value = saved.discInp;
          }
        }, { blockedBeforeSave: true, allowedAfterSave: true });
      /* Rommel, 2026-08-24 (QT-C00000006): the "By cabinet type" print view for Option 3 showed
         Option 2's exact cabinet breakdown -- same 7 rows, same quantities, even a row ("Base
         Cabinet (Shelves)") that does not exist in Option 3 at all -- while the total price
         correctly differed. Root cause traced by driving the real load/switch/print path against
         the quotation's own saved data (not guessed): the quotation is on Stage 2, and Stage 2
         reads its own scope copy (fqAreas) instead of the live one -- but createNewOption() had
         been copying fqScopeForked=true (and the stale fqAreas that goes with it) straight from
         the option it was duplicated from. _forkFQScope()'s own guard then read that inherited
         flag as "already forked, nothing to do" and never re-derived Stage 2 from the NEW option's
         own later Stage-1 edits. Reproduces the real scenario: an option forked from a Stage-2
         quotation, its Stage-1 scope edited afterward, print reads _withFQAreas -- and confirms it
         now sees the live, edited scope instead of the stale inherited one. */
      if (typeof window.createNewOption === 'function' && typeof window._withFQAreas === 'function')
        check('createNewOption: new option starts un-forked, so Stage 2 keeps mirroring Stage 1 edits', () => {
          const w = window;
          const saved = { qFabMode: w.qFabMode, qAreas: w.qAreas, fqAreas: w.fqAreas,
            fqScopeForked: w.fqScopeForked, qStage: w.qStage, qLocked: w.qLocked,
            qOptionsList: w.qOptionsList, qActiveOptionId: w.qActiveOptionId };
          try {
            w.qFabMode = 'bom';
            w.qAreas = [{ name: 'AREA', bomItems: [
              { type: 'Kitchen Base Cabinet', qty: 5, materials: [], hardware: [], services: [] },
              { type: 'Sink Cabinet', qty: 2, materials: [], hardware: [], services: [] }
            ] }];
            w.fqAreas = JSON.parse(JSON.stringify(w.qAreas));  // the SOURCE option's own genuine fork
            w.fqScopeForked = true;
            w.qStage = 2; w.qLocked = true;
            w.qOptionsList = []; w.qActiveOptionId = 0;
            w.recalc();

            w.createNewOption();  // -> a new option, copied from the one above

            // Edit the NEW option's Stage-1 scope only -- exactly what a real user does, never
            // touching Stage 2 for this option.
            w.qAreas = [{ name: 'AREA', bomItems: [
              { type: 'Kitchen Base Cabinet', qty: 1, materials: [], hardware: [], services: [] }
            ] }];
            w.recalc();

            const newOpt = w.qOptionsList.find(o => o.id === w.qActiveOptionId);
            const printScope = w._withFQAreas(() =>
              w.qAreas.flatMap(a => a.bomItems.map(b => ({ type: b.type, qty: b.qty }))));
            return {
              newOptionStartedUnforked: newOpt.snapshot.fqScopeForked === false && newOpt.snapshot.fqAreas === null,
              printSeesLiveEditedScope: JSON.stringify(printScope) ===
                JSON.stringify([{ type: 'Kitchen Base Cabinet', qty: 1 }])
            };
          } finally {
            w.qFabMode = saved.qFabMode; w.qAreas = saved.qAreas; w.fqAreas = saved.fqAreas;
            w.fqScopeForked = saved.fqScopeForked; w.qStage = saved.qStage; w.qLocked = saved.qLocked;
            w.qOptionsList = saved.qOptionsList; w.qActiveOptionId = saved.qActiveOptionId;
          }
        }, { newOptionStartedUnforked: true, printSeesLiveEditedScope: true });
      /* Rommel, 2026-08-25: the client-supplied-materials uplift can be excluded per service, but
         the exclusion was keyed by service NAME (qClientMatSvcExcl, lowercased). A quotation can
         carry two rows of the SAME service -- e.g. two Edgebanding lines, one for a client-supplied
         board and one for a company-supplied board on top of it -- and only one should carry the
         uplift. Keying by name collapsed both into one shared decision: ticking "Edgebanding" off
         turned it off on BOTH rows. Fixed by keying the exclusion by a per-line id (_svcUplId,
         lazily assigned and stored on the item itself, so it survives save/option-snapshot for
         free via the existing whole-array JSON clone). Reproduces the exact scenario: two svcItems
         rows sharing the name "Edgebanding", one excluded and one not. */
      if (typeof window.clientMatMultFor === 'function' && typeof window._svcUplId === 'function')
        check('clientMatMultFor: two same-named service rows can be independently excluded', () => {
          const w = window;
          const saved = { qClientSupplyMat: w.qClientSupplyMat, qClientMatSvcExcl: w.qClientMatSvcExcl,
                           qClientMatMultOverride: w.qClientMatMultOverride };
          try {
            w.qClientSupplyMat = true;
            w.qClientMatMultOverride = 1.2;   // deterministic multiplier, independent of CF defaults
            w.qClientMatSvcExcl = {};
            const rowA = { name: 'Edgebanding', qty: 10, price: 15 };   // client-supplied EBT
            const rowB = { name: 'Edgebanding', qty: 5, price: 15 };    // company-supplied EBT
            const idA = w._svcUplId(rowA), idB = w._svcUplId(rowB);
            const idsDiffer = idA !== idB && !!idA && !!idB;
            const idStableOnRepeat = w._svcUplId(rowA) === idA;
            const bothUpliftedByDefault = w.clientMatMultFor(rowA) === 1.2 && w.clientMatMultFor(rowB) === 1.2;
            w.qClientMatSvcExcl[idB] = true;   // exclude ONLY row B
            const rowAStillUplifted = w.clientMatMultFor(rowA) === 1.2;
            const rowBNoLongerUplifted = w.clientMatMultFor(rowB) === 1;
            return { idsDiffer, idStableOnRepeat, bothUpliftedByDefault, rowAStillUplifted, rowBNoLongerUplifted };
          } finally {
            w.qClientSupplyMat = saved.qClientSupplyMat; w.qClientMatSvcExcl = saved.qClientMatSvcExcl;
            w.qClientMatMultOverride = saved.qClientMatMultOverride;
          }
        }, { idsDiffer: true, idStableOnRepeat: true, bothUpliftedByDefault: true,
             rowAStillUplifted: true, rowBNoLongerUplifted: true });
      /* Rommel, 2026-08-25 (follow-up): the checkbox alone didn't say which line the uplift was
         on at a glance. "(Client-supplied material)" is now appended to the service NAME on the
         printout -- By area mode's per-line scope text and the itemized Services/Materials/
         Hardware table -- for whichever specific line carries it, auto-derived from
         clientMatMultFor() so it can never disagree with the checkbox. By cabinet type mode groups
         same-named services across areas and is deliberately left untouched (no single line to
         attach a note to for a mixed group) -- Lump sum doesn't itemize services at all. */
      if (typeof window.buildPrintRows === 'function' && typeof window._svcUplId === 'function')
        check('buildPrintRows (by area): the note attaches to the uplifted line only, not its excluded twin', () => {
          const w = window;
          const saved = { qAreas: w.qAreas, qFabMode: w.qFabMode, qClientSupplyMat: w.qClientSupplyMat,
                           qClientMatSvcExcl: w.qClientMatSvcExcl, qClientMatMultOverride: w.qClientMatMultOverride,
                           SERVICES: w.SERVICES };
          try {
            w.SERVICES = [{ name: 'Cutting MDF/PB/Plywood', price: 16.5, unit: 'lm' }];
            const rowA = { svcIdx: 0, qty: 10, price: 16.5 };   // client-supplied board
            const rowB = { svcIdx: 0, qty: 5, price: 16.5 };    // company-supplied board
            w.qAreas = [{ name: 'Area 1', items: [], bomItems: [], svcItems: [rowA, rowB],
                          matItems: [], hwItems: [], outsourceMaterials: [], outsourceHardware: [] }];
            w.qFabMode = 'services';
            w.qClientSupplyMat = true;
            w.qClientMatMultOverride = 1.2;
            w.qClientMatSvcExcl = {};
            const idB = w._svcUplId(rowB);
            w.qClientMatSvcExcl[idB] = true;   // exclude row B only
            const html = w.buildPrintRows('area', null, null);
            const noteCount = (html.match(/\(Client-supplied material\)/g) || []).length;
            return { noteCount, rowAQtyPresent: html.includes('10 lm Cutting') };
          } finally {
            w.qAreas = saved.qAreas; w.qFabMode = saved.qFabMode; w.qClientSupplyMat = saved.qClientSupplyMat;
            w.qClientMatSvcExcl = saved.qClientMatSvcExcl; w.qClientMatMultOverride = saved.qClientMatMultOverride;
            w.SERVICES = saved.SERVICES;
          }
        }, { noteCount: 1, rowAQtyPresent: true });
      if (typeof window.buildItemizedPrintRows === 'function' && typeof window._svcUplId === 'function')
        check('buildItemizedPrintRows: the note attaches to the uplifted line only, not its excluded twin', () => {
          const w = window;
          const saved = { qAreas: w.qAreas, qFabMode: w.qFabMode, qClientSupplyMat: w.qClientSupplyMat,
                           qClientMatSvcExcl: w.qClientMatSvcExcl, qClientMatMultOverride: w.qClientMatMultOverride,
                           SERVICES: w.SERVICES };
          try {
            w.SERVICES = [{ name: 'Cutting MDF/PB/Plywood', price: 16.5, unit: 'lm' }];
            const rowA = { svcIdx: 0, qty: 10, price: 16.5 };
            const rowB = { svcIdx: 0, qty: 5, price: 16.5 };
            w.qAreas = [{ name: 'Area 1', items: [], bomItems: [], svcItems: [rowA, rowB],
                          matItems: [], hwItems: [], outsourceMaterials: [], outsourceHardware: [] }];
            w.qFabMode = 'services';
            w.qClientSupplyMat = true;
            w.qClientMatMultOverride = 1.2;
            w.qClientMatSvcExcl = {};
            const idB = w._svcUplId(rowB);
            w.qClientMatSvcExcl[idB] = true;
            const html = w.buildItemizedPrintRows(false, null, null);
            const noteCount = (html.match(/\(Client-supplied material\)/g) || []).length;
            return { noteCount };
          } finally {
            w.qAreas = saved.qAreas; w.qFabMode = saved.qFabMode; w.qClientSupplyMat = saved.qClientSupplyMat;
            w.qClientMatSvcExcl = saved.qClientMatSvcExcl; w.qClientMatMultOverride = saved.qClientMatMultOverride;
            w.SERVICES = saved.SERVICES;
          }
        }, { noteCount: 1 });
      /* Rommel's team, 2026-08-27: a per-service note (e.g. on a Postformed Filler line) always
         printed once non-empty -- there was no way to type an internal-only note without it
         reaching the client. Rather than hardcoding "print only for postformed services", every
         service line now carries its own notePrint toggle (undefined/true = show, false = hide),
         so it works the same regardless of which service the note belongs to. Default is "show"
         so every note typed before this toggle existed keeps printing exactly as it always has. */
      if (typeof window._svcNoteInline === 'function')
        check('_svcNoteInline: shows an unescaped, parenthesised note unless notePrint is false', () => {
          const w = window;
          const shown = w._svcNoteInline({ note: 'exclusions apply' });
          const hidden = w._svcNoteInline({ note: 'internal only', notePrint: false });
          const empty = w._svcNoteInline({ note: '', notePrint: true });
          return { shown, hidden, empty };
        }, { shown: ' (exclusions apply)', hidden: '', empty: '' });
      /* Rommel's team, 2026-08-27 (follow-up): "the note should be placed inside the line of each
         service, enclosed in parenthesis" -- not in a separate ADDITIONAL NOTES section a scroll
         away from the line it describes. 'area' and 'itemized' print modes now show the note
         inline via _svcNoteInline; _svcNotesPrintHtml() only still carries per-service notes as a
         fallback for 'type'/'lump' modes (no single line to attach one to there), gated by its new
         includeLineNotes argument -- legacy per-AREA notes (predating the per-service note field)
         always show regardless, since they never had a line to attach to either way. */
      if (typeof window.buildPrintRows === 'function')
        check('buildPrintRows (by area): the note prints inline on its own service line', () => {
          const w = window;
          const saved = { qAreas: w.qAreas, qFabMode: w.qFabMode, SERVICES: w.SERVICES };
          try {
            w.SERVICES = [{ name: 'Edgebanding', price: 15, unit: 'lm' }];
            const noted = { svcIdx: 0, qty: 10, price: 15, note: 'runs along the countertop edge' };
            const silenced = { svcIdx: 0, qty: 5, price: 15, note: 'HIDDEN-NOTE-TEXT', notePrint: false };
            w.qAreas = [{ name: 'Area 1', items: [], bomItems: [], svcItems: [noted, silenced],
                          matItems: [], hwItems: [], outsourceMaterials: [], outsourceHardware: [] }];
            w.qFabMode = 'services';
            const html = w.buildPrintRows('area', null, null);
            return { notedInline: html.includes('(runs along the countertop edge)'), hiddenAbsent: !html.includes('HIDDEN-NOTE-TEXT') };
          } finally {
            w.qAreas = saved.qAreas; w.qFabMode = saved.qFabMode; w.SERVICES = saved.SERVICES;
          }
        }, { notedInline: true, hiddenAbsent: true });
      if (typeof window.buildItemizedPrintRows === 'function')
        check('buildItemizedPrintRows: the note prints inline on its own service line', () => {
          const w = window;
          const saved = { qAreas: w.qAreas, qFabMode: w.qFabMode, SERVICES: w.SERVICES };
          try {
            w.SERVICES = [{ name: 'Edgebanding', price: 15, unit: 'lm' }];
            const noted = { svcIdx: 0, qty: 10, price: 15, note: 'runs along the countertop edge' };
            w.qAreas = [{ name: 'Area 1', items: [], bomItems: [], svcItems: [noted],
                          matItems: [], hwItems: [], outsourceMaterials: [], outsourceHardware: [] }];
            w.qFabMode = 'services';
            const html = w.buildItemizedPrintRows(false, null, null);
            return { notedInline: html.includes('(runs along the countertop edge)') };
          } finally {
            w.qAreas = saved.qAreas; w.qFabMode = saved.qFabMode; w.SERVICES = saved.SERVICES;
          }
        }, { notedInline: true });
      if (typeof window._svcNotesPrintHtml === 'function')
        check('_svcNotesPrintHtml: line notes only in the type/lump fallback (includeLineNotes); legacy area note always shows', () => {
          const w = window;
          const saved = { qAreas: w.qAreas, SERVICES: w.SERVICES };
          try {
            w.SERVICES = [{ name: 'Edgebanding', price: 15, unit: 'lm' }];
            const shown = { svcIdx: 0, qty: 10, price: 15, note: 'VISIBLE-NOTE-TEXT' };
            const hidden = { svcIdx: 0, qty: 5, price: 15, note: 'HIDDEN-NOTE-TEXT', notePrint: false };
            w.qAreas = [{ name: 'Area 1', items: [], bomItems: [], svcItems: [shown, hidden], svcNote: 'LEGACY-AREA-NOTE',
                          matItems: [], hwItems: [], outsourceMaterials: [], outsourceHardware: [] }];
            const withLines = w._svcNotesPrintHtml(true);
            const withoutLines = w._svcNotesPrintHtml(false);
            return {
              withLinesShownPresent: withLines.includes('VISIBLE-NOTE-TEXT'),
              withLinesHiddenAbsent: !withLines.includes('HIDDEN-NOTE-TEXT'),
              withoutLinesSvcNotesAbsent: !withoutLines.includes('VISIBLE-NOTE-TEXT') && !withoutLines.includes('HIDDEN-NOTE-TEXT'),
              legacyAlwaysPresent: withLines.includes('LEGACY-AREA-NOTE') && withoutLines.includes('LEGACY-AREA-NOTE'),
            };
          } finally {
            w.qAreas = saved.qAreas; w.SERVICES = saved.SERVICES;
          }
        }, { withLinesShownPresent: true, withLinesHiddenAbsent: true, withoutLinesSvcNotesAbsent: true, legacyAlwaysPresent: true });
      /* Rommel's team, 2026-08-25: "client supplied material is not showing on stage 2 which
         will limit them when a material is needed to be edited." Root cause: the whole card
         (#client-mat-row) was static markup confined inside #s1-wrap, so it simply did not exist
         anywhere in Stage 2's DOM -- Stage 2 could edit its own scope (fqAreas) since 2026-08-05,
         but had no way to turn the client-supplied toggle on, add/edit what the client brings, or
         see which of ITS OWN service lines the uplift reached once it diverged from Stage 1.
         Fixed with a mirrored #fq-client-mat-row card sharing the same qClientSupplyMat /
         qClientMatMultOverride / qClientSupplyMatList state (a fact about the client, not the
         stage) but rendering its picker against fqAreas via _withFQAreas, so the two cards can
         show genuinely different line counts when the two scopes have diverged. */
      if (typeof window.renderClientMatSection === 'function' && document.getElementById('fq-client-mat-toggle'))
        check('renderClientMatSection: Stage 2 gets its own card, counting fqAreas lines, not qAreas', () => {
          const w = window;
          const saved = { qAreas: w.qAreas, fqAreas: w.fqAreas, qFabMode: w.qFabMode,
                           qClientSupplyMat: w.qClientSupplyMat, qClientMatSvcExcl: w.qClientMatSvcExcl,
                           qClientMatMultOverride: w.qClientMatMultOverride, SERVICES: w.SERVICES };
          try {
            w.SERVICES = [{ name: 'Cutting MDF/PB/Plywood', price: 16.5, unit: 'lm' }];
            // Stage 1: ONE service row. Stage 2 (already diverged, e.g. client asked to add a
            // second cutting line for the Final Quotation): TWO. The two cards must disagree.
            w.qAreas = [{ name: 'Area 1', items: [], bomItems: [],
                          svcItems: [{ svcIdx: 0, qty: 10, price: 16.5 }],
                          matItems: [], hwItems: [], outsourceMaterials: [], outsourceHardware: [] }];
            w.fqAreas = [{ name: 'Area 1', items: [], bomItems: [],
                          svcItems: [{ svcIdx: 0, qty: 10, price: 16.5 }, { svcIdx: 0, qty: 6, price: 16.5 }],
                          matItems: [], hwItems: [], outsourceMaterials: [], outsourceHardware: [] }];
            w.qFabMode = 'services';
            w.qClientSupplyMat = true;
            w.qClientMatMultOverride = 1.2;
            w.qClientMatSvcExcl = {};
            w.renderClientMatSection();
            const s1Body = document.getElementById('client-mat-body').innerHTML;
            const s2Toggle = document.getElementById('fq-client-mat-toggle');
            const s2Body = document.getElementById('fq-client-mat-body').innerHTML;
            return {
              s2ToggleReflectsSharedState: s2Toggle.checked === true,
              s2CountsItsOwnTwoLines: s2Body.includes('of 2 lines'),
              s1CountsItsOwnOneLine: s1Body.includes('of 1 lines'),
              s2NotJustACopyOfS1: s2Body !== s1Body,
            };
          } finally {
            w.qAreas = saved.qAreas; w.fqAreas = saved.fqAreas; w.qFabMode = saved.qFabMode;
            w.qClientSupplyMat = saved.qClientSupplyMat; w.qClientMatSvcExcl = saved.qClientMatSvcExcl;
            w.qClientMatMultOverride = saved.qClientMatMultOverride; w.SERVICES = saved.SERVICES;
            w.renderClientMatSection();
          }
        }, { s2ToggleReflectsSharedState: true, s2CountsItsOwnTwoLines: true,
             s1CountsItsOwnOneLine: true, s2NotJustACopyOfS1: true });
      /* Same report, the other half: the Stage 2 row's own uplift checkbox (already shipped
         2026-08-25 earlier this session) must refresh STAGE 2's grid/price when toggled, not
         Stage 1's -- clicking it lives inside #fq-items-wrap, rendered with _rndFq=true, so its
         onchange has to travel through _hEdit/_fqEdit like every other Stage 2 row mutator, or
         the checkbox would silently repaint the wrong stage. Drives the REAL renderer
         (renderFQItems -> the actual #fq-items-wrap markup), not _hEdit in isolation -- _hEdit
         itself already worked before today, so testing it alone would pass whether or not the
         checkbox's own onchange string was ever wrapped with it. */
      if (typeof window.renderFQItems === 'function' && document.getElementById('fq-items-wrap'))
        check('the Stage 2 row itself emits a checkbox wrapped for its own stage, not Stage 1', () => {
          const w = window;
          const saved = { qAreas: w.qAreas, fqAreas: w.fqAreas, qFabMode: w.qFabMode,
                           qClientSupplyMat: w.qClientSupplyMat, qClientMatSvcExcl: w.qClientMatSvcExcl,
                           SERVICES: w.SERVICES };
          try {
            w.SERVICES = [{ name: 'Cutting MDF/PB/Plywood', price: 16.5, unit: 'lm' }];
            w.qAreas = [{ name: 'Area 1', items: [], bomItems: [], svcItems: [],
                          matItems: [], hwItems: [], outsourceMaterials: [], outsourceHardware: [] }];
            w.fqAreas = [{ name: 'Area 1', items: [], bomItems: [],
                          svcItems: [{ svcIdx: 0, qty: 10, price: 16.5 }],
                          matItems: [], hwItems: [], outsourceMaterials: [], outsourceHardware: [] }];
            w.qFabMode = 'services';
            w.qClientSupplyMat = true;
            w.qClientMatSvcExcl = {};
            w.renderFQItems();
            const wrap = document.getElementById('fq-items-wrap').innerHTML;
            const checkboxTag = (wrap.match(/<input type="checkbox"[^>]*onchange="[^"]*"[^>]*title="Apply[^>]*>/) || [''])[0];
            return {
              foundACheckbox: checkboxTag.length > 0,
              routesThroughFqEdit: checkboxTag.includes('_fqEdit('),
            };
          } finally {
            w.qAreas = saved.qAreas; w.fqAreas = saved.fqAreas; w.qFabMode = saved.qFabMode;
            w.qClientSupplyMat = saved.qClientSupplyMat; w.qClientMatSvcExcl = saved.qClientMatSvcExcl;
            w.SERVICES = saved.SERVICES;
            w.renderFQItems();
          }
        }, { foundACheckbox: true, routesThroughFqEdit: true });
      /* Rommel, 2026-08-25: price_services was silently wiped from ~60 real rows down to 6
         generic defaults ("Panel cutting", "Edgebanding", ...), then it happened AGAIN after he
         restored the sheet -- traced to supaMigratePriceDb() reading the Price DB tabs live off
         the Sheets API and calling supaReplaceTable (DELETE-all + INSERT) unconditionally on
         whatever came back, however small. Any edit anywhere in that spreadsheet bumps the whole
         file's modifiedTime, which is what wakes the sync up -- so a read caught while someone is
         actively editing a DIFFERENT tab (Cabinet Templates, per his report) is exactly the moment
         the Sheets API is most likely to hand back an incomplete range, and nothing checked the
         READ's plausibility before it became a permanent DELETE.
         Two things proven here: the pure guard function's own boundaries, AND that it is actually
         WIRED into supaMigratePriceDb (not just defined and orphaned) -- the exact class of bug
         where a fix looks shipped in a diff but the call site was never updated. */
      if (typeof window._syncLooksSafe === 'function')
        check('_syncLooksSafe: refuses a drastic collapse, allows a real edit or a fresh table', () => {
          const w = window;
          return {
            theActualIncident: w._syncLooksSafe(6, 60) === false,
            aRealSmallEdit: w._syncLooksSafe(58, 60) === true,        // removed 2 real duplicate rows
            aRealBigEdit: w._syncLooksSafe(150000, 153000) === true,  // cleaned up ~2% of Materials
            totalWipeout: w._syncLooksSafe(0, 60) === false,
            freshEmptyTable: w._syncLooksSafe(60, 0) === true,        // nothing to compare against yet
            smallTableNoBasis: w._syncLooksSafe(1, 5) === true,       // currentCount<10 -- not enough to judge
            countUnknown: w._syncLooksSafe(6, null) === true,         // count query itself failed -- fail open, not closed
          };
        }, { theActualIncident: true, aRealSmallEdit: true, aRealBigEdit: true, totalWipeout: true,
             freshEmptyTable: true, smallTableNoBasis: true, countUnknown: true });
      if (typeof window.supaMigratePriceDb === 'function')
        check('supaMigratePriceDb source actually calls the guard before replacing a table (not orphaned)', () => {
          const src = window.supaMigratePriceDb.toString();
          return {
            callsGuardBeforeDecidingTasks: src.indexOf('_syncLooksSafe(') > -1,
            // The guard has to run BEFORE supaReplaceTable, not after -- refusing after the delete
            // already happened protects nothing.
            guardPrecedesReplace: src.indexOf('_syncLooksSafe(') < src.indexOf('supaReplaceTable('),
          };
        }, { callsGuardBeforeDecidingTasks: true, guardPrecedesReplace: true });
      /* Same incident, the ACTUAL cause -- found only after Rommel pushed back that he had not
         deleted anything, he had ADDED data, and it kept happening even after he restored the
         sheet. gSaveAppSettings() (the "Save settings" button, clicked for ANY settings change --
         cost factors, PPIC, anything) calls _saveServicesToPriceDb() unconditionally on every
         click, which clear+rewrites BOTH the Sheet and Supabase from whatever SERVICES currently
         holds. SERVICES starts life as a literal 6-row placeholder baked into the code, before the
         real ~60-row catalogue has loaded -- so a Save Settings click before that load finishes
         (or after some other bug quietly shrank SERVICES) pushed the placeholder over the real
         catalogue in both stores at once, independent of the auto-sync path fixed above.
         Async, so this drives the real promise chain with priceDbClear/priceDbUpdate/
         supaReplaceTable stubbed -- proving the destructive calls are never reached when guarded
         off, and DO fire on a genuine, correctly-sized save. */
      if (typeof window._saveServicesToPriceDb === 'function')
        await (async () => {
          const w = window;
          const saved = { gToken: w.gToken, SERVICES: w.SERVICES, dbServices: w.dbServices,
                           priceDbClear: w.priceDbClear, priceDbUpdate: w.priceDbUpdate,
                           supaReplaceTable: w.supaReplaceTable, showToast: w.showToast };
          let destructiveCallCount = 0;
          w.priceDbClear = () => { destructiveCallCount++; return Promise.resolve(); };
          w.priceDbUpdate = () => { destructiveCallCount++; return Promise.resolve(); };
          w.supaReplaceTable = () => { destructiveCallCount++; return Promise.resolve(); };
          w.showToast = () => {};
          w.gToken = 'test-token';
          const placeholder = [
            { name: 'Panel cutting', unit: 'lm', price: 35 }, { name: 'Edgebanding', unit: 'lm', price: 55 },
            { name: 'Boring/drilling', unit: 'hole', price: 12 }, { name: 'Sanding', unit: 'sqm', price: 85 },
            { name: 'Assembly labor', unit: 'carcass', price: 850 }, { name: 'Installation labor', unit: 'carcass', price: 1200 }
          ];
          const realCatalogue = Array.from({ length: 60 }, (_, i) => ({ name: 'Real service ' + i, unit: 'lm', price: 100 + i }));
          try {
            // 1) Catalogue never loaded this session (dbServices empty) -- SERVICES is still the
            //    startup placeholder. Must refuse without touching either store.
            destructiveCallCount = 0;
            w.dbServices = [];
            w.SERVICES = placeholder.slice();
            await w._saveServicesToPriceDb();
            const refusedWhenNeverLoaded = destructiveCallCount === 0;
            // 2) Catalogue DID load (60 real rows known-good), but SERVICES has since collapsed to
            //    the same 6-row placeholder -- the exact live incident. Must refuse.
            destructiveCallCount = 0;
            w.dbServices = realCatalogue.slice();
            w.SERVICES = placeholder.slice();
            await w._saveServicesToPriceDb();
            const refusedWhenCollapsed = destructiveCallCount === 0;
            // 3) A genuine, correctly-sized save (editing a couple of real rows) -- must proceed.
            destructiveCallCount = 0;
            w.dbServices = realCatalogue.slice();
            w.SERVICES = realCatalogue.slice();
            w.SERVICES[0] = { name: 'Real service 0 (repriced)', unit: 'lm', price: 999 };
            await w._saveServicesToPriceDb();
            const proceedsOnRealSave = destructiveCallCount > 0;
            check('_saveServicesToPriceDb: refuses to overwrite the catalogue with an unloaded or collapsed SERVICES array',
              () => ({ refusedWhenNeverLoaded, refusedWhenCollapsed, proceedsOnRealSave }),
              { refusedWhenNeverLoaded: true, refusedWhenCollapsed: true, proceedsOnRealSave: true });
          } finally {
            w.gToken = saved.gToken; w.SERVICES = saved.SERVICES; w.dbServices = saved.dbServices;
            w.priceDbClear = saved.priceDbClear; w.priceDbUpdate = saved.priceDbUpdate;
            w.supaReplaceTable = saved.supaReplaceTable; w.showToast = saved.showToast;
          }
        })();
      /* Rommel, 2026-08-25 (audit follow-up): asked for the FULL list of every place this pattern
         appears, not just the one that bit him. Two more genuinely dangerous ones, both fixed the
         same way as _saveServicesToPriceDb -- a pre-flight Supabase count check before any
         destructive write. Cabinet Templates' own "Save changes to Price DB" button previously
         refused only when dbTemplates was COMPLETELY empty, not when it was merely incomplete (a
         dropped connection mid-load, say) -- the exact same gap Services had, just for a table he
         was actively editing that day. */
      if (typeof window._carcassSaveTplToDb === 'function')
        await (async () => {
          const w = window;
          const saved = { gToken: w.gToken, dbTemplates: w.dbTemplates, supa: w.supa,
                           priceDbClear: w.priceDbClear, priceDbUpdate: w.priceDbUpdate,
                           supaReplaceTable: w.supaReplaceTable, showToast: w.showToast, supaReady: w.supaReady };
          let destructiveCallCount = 0;
          w.priceDbClear = () => { destructiveCallCount++; return Promise.resolve(); };
          w.priceDbUpdate = () => { destructiveCallCount++; return Promise.resolve(); };
          w.supaReplaceTable = () => { destructiveCallCount++; return Promise.resolve(); };
          w.showToast = () => {};
          w.gToken = 'test-token';
          w.supaReady = () => true;
          const mkTemplateRows = (n) => Array.from({ length: n }, (_, i) =>
            ({ cabinet: 'Kitchen Base Cabinet', category: 'materials', name: 'Row ' + i, unit: 'pc', qty: 1, price: 10 }));
          const fakeSupaFrom = (currentCount) => ({
            select: () => Promise.resolve({ count: currentCount })
          });
          try {
            // 1) dbTemplates has only 20 rows loaded; Supabase already holds 230 -- a partial
            //    load, not a real edit. Must refuse.
            destructiveCallCount = 0;
            w.dbTemplates = mkTemplateRows(20);
            w.supa = { from: () => fakeSupaFrom(230) };
            await w._carcassSaveTplToDb('Kitchen Base Cabinet');
            const refusedWhenIncomplete = destructiveCallCount === 0;
            // 2) A genuine save with the full 230 rows loaded -- must proceed.
            destructiveCallCount = 0;
            w.dbTemplates = mkTemplateRows(230);
            w.supa = { from: () => fakeSupaFrom(230) };
            await w._carcassSaveTplToDb('Kitchen Base Cabinet');
            const proceedsOnRealSave = destructiveCallCount > 0;
            check('_carcassSaveTplToDb: refuses to overwrite Cabinet Templates with a partially-loaded dbTemplates',
              () => ({ refusedWhenIncomplete, proceedsOnRealSave }),
              { refusedWhenIncomplete: true, proceedsOnRealSave: true });
          } finally {
            w.gToken = saved.gToken; w.dbTemplates = saved.dbTemplates; w.supa = saved.supa;
            w.priceDbClear = saved.priceDbClear; w.priceDbUpdate = saved.priceDbUpdate;
            w.supaReplaceTable = saved.supaReplaceTable; w.showToast = saved.showToast; w.supaReady = saved.supaReady;
          }
        })();
      /* The Excel import path (Materials/Hardware/Services "Import Excel") is driven by a real
         <input type=file> + FileReader + XLSX parse, which is impractical to simulate headlessly
         end to end. Verified structurally instead, same as supaMigratePriceDb above: the guard is
         actually CALLED, and it runs BEFORE the destructive clear -- proving it is wired into the
         real path, not just defined and orphaned nearby. */
      if (typeof window.importPriceDbExcel === 'function')
        check('importPriceDbExcel source calls the guard before clearing the sheet (not orphaned)', () => {
          const src = window.importPriceDbExcel.toString();
          const guardIdx = src.indexOf('_syncLooksSafe(');
          const clearIdx = src.indexOf('priceDbClear(');
          return { callsGuard: guardIdx > -1, guardPrecedesClear: guardIdx > -1 && guardIdx < clearIdx };
        }, { callsGuard: true, guardPrecedesClear: true });
      /* "Initialize with defaults" is different in kind -- replacing the live catalogue with a
         small starter set is its actual PURPOSE, so a size-collapse guard would refuse its own
         job. What it never had was any confirmation before wiping Services + Cabinet Templates.
         Verified structurally: the public entry point must ask _confirm() before anything
         destructive can run, and the destructive body must live in a SEPARATE function that only
         _confirm's own callback can reach -- not something a stray direct call could bypass. */
      if (typeof window.initPriceDB === 'function' && typeof window._initPriceDBConfirmed === 'function')
        check('initPriceDB requires confirmation before touching anything; the destructive body is separate', () => {
          const entrySrc = window.initPriceDB.toString();
          const bodySrc = window._initPriceDBConfirmed.toString();
          return {
            entryAsksConfirmFirst: entrySrc.indexOf('_confirm(') > -1,
            entryItselfHasNoDestructiveCall: entrySrc.indexOf('priceDbClear(') === -1 && entrySrc.indexOf('supaReplaceTable(') === -1,
            bodyDoesTheRealWork: bodySrc.indexOf('priceDbClear(') > -1 && bodySrc.indexOf('supaReplaceTable(') > -1,
          };
        }, { entryAsksConfirmFirst: true, entryItselfHasNoDestructiveCall: true, bodyDoesTheRealWork: true });
      /* Rommel: "Make sure nothing is left." Re-swept the whole file for every priceDbClear(
         /supaReplaceTable( call site after the first three fixes -- four more shared the exact
         same gap: the one-time Pending Orders and Logistics DB backfills, and the two Logistics
         DB "Save Materials"/"Save Trucks" buttons. Lower real-world risk (Logistics DB has never
         actually been connected; the Orders backfill is a manual one-time console command), but
         the same class of bug, so guarded the same way rather than left as a judgement call. */
      if (typeof window.supaMigrateLogisticsDb === 'function')
        await (async () => {
          const w = window;
          const saved = { gToken: w.gToken, supa: w.supa, logDbGet: w.logDbGet, supaReplaceTable: w.supaReplaceTable,
                           supaReady: w.supaReady, LOGISTICS_DB_ID: w.LOGISTICS_DB_ID, _logisticsDbMigrationInFlight: w._logisticsDbMigrationInFlight };
          let destructiveCallCount = 0;
          w.gToken = 'test-token'; w.supaReady = () => true; w.LOGISTICS_DB_ID = 'test-sheet-id';
          w._logisticsDbMigrationInFlight = false;
          w.supaReplaceTable = () => { destructiveCallCount++; return Promise.resolve(); };
          const mkSheetRows = (n) => [['Name']].concat(Array.from({ length: n }, (_, i) => ['Row ' + i]));
          try {
            // 1) The sheet read comes back with only 3 rows; Supabase already holds 50. Refuse.
            destructiveCallCount = 0;
            w.logDbGet = () => Promise.resolve({ values: mkSheetRows(3) });
            w.supa = { from: () => ({ select: () => Promise.resolve({ count: 50 }) }) };
            await w.supaMigrateLogisticsDb();
            const refusedWhenCollapsed = destructiveCallCount === 0;
            // 2) A genuine full read (50 rows in, 50 already there) -- proceeds.
            destructiveCallCount = 0;
            w.logDbGet = () => Promise.resolve({ values: mkSheetRows(50) });
            w.supa = { from: () => ({ select: () => Promise.resolve({ count: 50 }) }) };
            await w.supaMigrateLogisticsDb();
            const proceedsOnRealSync = destructiveCallCount > 0;
            check('supaMigrateLogisticsDb: refuses a collapsed sheet read, same as the Price DB migration',
              () => ({ refusedWhenCollapsed, proceedsOnRealSync }),
              { refusedWhenCollapsed: true, proceedsOnRealSync: true });
          } finally {
            w.gToken = saved.gToken; w.supa = saved.supa; w.logDbGet = saved.logDbGet;
            w.supaReplaceTable = saved.supaReplaceTable; w.supaReady = saved.supaReady;
            w.LOGISTICS_DB_ID = saved.LOGISTICS_DB_ID; w._logisticsDbMigrationInFlight = saved._logisticsDbMigrationInFlight;
          }
        })();
      if (typeof window._logSaveMats === 'function')
        await (async () => {
          const w = window;
          const saved = { LOGISTICS_DB_ID: w.LOGISTICS_DB_ID, logisticsDb: w.logisticsDb, supa: w.supa,
                           supaReady: w.supaReady, supaReplaceTable: w.supaReplaceTable, logDbClear: w.logDbClear,
                           logDbUpdate: w.logDbUpdate, _logEnsureSheetTabs: w._logEnsureSheetTabs, showToast: w.showToast };
          let destructiveCallCount = 0;
          w.LOGISTICS_DB_ID = 'test-sheet-id'; w.supaReady = () => true; w.showToast = () => {};
          w.logDbClear = () => { destructiveCallCount++; return Promise.resolve(); };
          w.logDbUpdate = () => { destructiveCallCount++; return Promise.resolve({}); };
          w.supaReplaceTable = () => { destructiveCallCount++; return Promise.resolve(); };
          w._logEnsureSheetTabs = (needed, cb) => cb();
          const mkMats = (n) => Array.from({ length: n }, (_, i) => ({ name: 'M' + i, boardSize: '4x8', lengthMm: 1220, widthMm: 2440, thicknessMm: 18, weightKg: 40, cbm: 0.1, notes: '' }));
          try {
            // 1) The working copy has 2 materials; Supabase already holds 40. Refuse.
            destructiveCallCount = 0;
            w.logisticsDb = { materials: mkMats(2), trucks: [] };
            w.supa = { from: () => ({ select: () => Promise.resolve({ count: 40 }) }) };
            await w._logSaveMats();
            await new Promise((r) => setTimeout(r, 0));
            const refusedWhenCollapsed = destructiveCallCount === 0;
            // 2) A genuine save (40 in the working copy, 40 already there) -- proceeds.
            destructiveCallCount = 0;
            w.logisticsDb = { materials: mkMats(40), trucks: [] };
            w.supa = { from: () => ({ select: () => Promise.resolve({ count: 40 }) }) };
            await w._logSaveMats();
            await new Promise((r) => setTimeout(r, 0));
            const proceedsOnRealSave = destructiveCallCount > 0;
            check('_logSaveMats: refuses to overwrite Logistics Materials with a suspiciously short working copy',
              () => ({ refusedWhenCollapsed, proceedsOnRealSave }),
              { refusedWhenCollapsed: true, proceedsOnRealSave: true });
          } finally {
            w.LOGISTICS_DB_ID = saved.LOGISTICS_DB_ID; w.logisticsDb = saved.logisticsDb; w.supa = saved.supa;
            w.supaReady = saved.supaReady; w.supaReplaceTable = saved.supaReplaceTable; w.logDbClear = saved.logDbClear;
            w.logDbUpdate = saved.logDbUpdate; w._logEnsureSheetTabs = saved._logEnsureSheetTabs; w.showToast = saved.showToast;
          }
        })();
      if (typeof window.supaMigrateOrders === 'function')
        await (async () => {
          const w = window;
          const saved = { gToken: w.gToken, supa: w.supa, sheetsGet: w.sheetsGet, supaReplaceTable: w.supaReplaceTable,
                           supaReady: w.supaReady, _ordersMigrationInFlight: w._ordersMigrationInFlight };
          let destructiveCallCount = 0;
          w.gToken = 'test-token'; w.supaReady = () => true; w._ordersMigrationInFlight = false;
          w.supaReplaceTable = () => { destructiveCallCount++; return Promise.resolve(); };
          const mkOrderRows = (n) => [['ID']].concat(Array.from({ length: n }, (_, i) => ['ORD' + i]));
          try {
            destructiveCallCount = 0;
            w.sheetsGet = () => Promise.resolve({ values: mkOrderRows(3) });
            w.supa = { from: () => ({ select: () => Promise.resolve({ count: 60 }) }) };
            await w.supaMigrateOrders();
            const refusedWhenCollapsed = destructiveCallCount === 0;
            destructiveCallCount = 0;
            w.sheetsGet = () => Promise.resolve({ values: mkOrderRows(60) });
            w.supa = { from: () => ({ select: () => Promise.resolve({ count: 60 }) }) };
            await w.supaMigrateOrders();
            const proceedsOnRealSync = destructiveCallCount > 0;
            check('supaMigrateOrders: refuses a collapsed sheet read, same as the other migrations',
              () => ({ refusedWhenCollapsed, proceedsOnRealSync }),
              { refusedWhenCollapsed: true, proceedsOnRealSync: true });
          } finally {
            w.gToken = saved.gToken; w.supa = saved.supa; w.sheetsGet = saved.sheetsGet;
            w.supaReplaceTable = saved.supaReplaceTable; w.supaReady = saved.supaReady;
            w._ordersMigrationInFlight = saved._ordersMigrationInFlight;
          }
        })();
      /* Rommel, 2026-08-27 -- reported on QT-C00000006: "cannot unlock or be edited, says already
         approved by the client, but in reality it's not". Root cause, confirmed against the real
         activity log: _iqApprovedEditBlocked's gate is qClientApproved||qApproved (both flags,
         either one blocks). doApprove()/confirmOptionApprove() set BOTH together when staff pick a
         winning option to move to Stage 2 -- an internal action, not necessarily a client sign-off,
         but the two are deliberately coupled today (see the comment on var qClientApproved).
         Unlocking is supposed to reverse that coupling -- but THREE separate unlock code paths only
         ever cleared qClientApproved, never qApproved, so the gate kept firing on every later
         attempt regardless of how the unlock was approved. Confirmed on the real timeline: Allan
         approved an unlock from his phone (_persistApprovedFieldToQuotation's background path,
         clears neither flag on a SAVED STATE), and Stephanie was refused three more times by
         requestUnlock() until Rommel used the Admin-only "Undo client approval" as a workaround
         (the only one of the four paths that clears both). Fixed by clearing qApproved/approved
         alongside qClientApproved/clientApproved in all three unlock paths that were missing it. */
      if (typeof window.confirmUnlock === 'function') {
        const src = window.confirmUnlock.toString();
        // Isolate the Stage 1 (non-fq) branch -- it's the `else` after the `if(modalCtx==='fq')` block.
        const s1Branch = src.slice(src.indexOf('} else {'));
        check('confirmUnlock: Stage 1 unlock clears qApproved too, not only qClientApproved', () => ({
          clearsClientApproved: /qClientApproved\s*=\s*false/.test(s1Branch),
          clearsApproved: /qApproved\s*=\s*false/.test(s1Branch),
        }), { clearsClientApproved: true, clearsApproved: true });
      }
      if (typeof window._applyApprovedRequest === 'function') {
        const src = window._applyApprovedRequest.toString();
        // Isolate the unlock type's Stage 1 (non-fq) branch -- the `else` following `if(ctx==='fq'){...}`
        // inside the `if(type==='unlock')` block.
        const unlockBlock = src.slice(src.indexOf("type==='unlock'"));
        const s1Branch = unlockBlock.slice(unlockBlock.indexOf('} else {'), unlockBlock.indexOf("if(type==='reactivate'"));
        check('_applyApprovedRequest: an unlock applied to the OPEN quotation clears qApproved too', () => ({
          clearsClientApproved: /qClientApproved\s*=\s*false/.test(s1Branch),
          clearsApproved: /qApproved\s*=\s*false/.test(s1Branch),
        }), { clearsClientApproved: true, clearsApproved: true });
      }
      if (typeof window._persistApprovedFieldToQuotation === 'function') {
        const src = window._persistApprovedFieldToQuotation.toString();
        // Isolate the unlock mutate's Stage 1 (non-fq) branch -- the ternary's `:` alternative.
        const unlockBlock = src.slice(src.indexOf("type==='unlock'"), src.indexOf("if(!mutate)"));
        const s1Branch = unlockBlock.slice(unlockBlock.indexOf(':function(s){'));
        check('_persistApprovedFieldToQuotation: an unlock applied to a quotation NOT open clears both flags on the saved state', () => ({
          clearsClientApproved: /s\.clientApproved\s*=\s*false/.test(s1Branch),
          clearsApproved: /s\.approved\s*=\s*false/.test(s1Branch),
        }), { clearsClientApproved: true, clearsApproved: true });
      }
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
      /* Rommel, 2026-08-19: the "Client history" panel summed EVERY other quotation carrying a
         client's name into one headline peso figure next to the request being reviewed — two
         duplicate ~6.2M quotations became a misleading "12.4M" total right beside a ~6.2M request.
         His direction: never combine more than one quotation's amount into a single figure again.
         loadHistory() is inherently async (a live Supabase query), which the harness's synchronous
         check() cannot drive end-to-end here without larger changes to shared test infrastructure
         -- so this verifies structurally, on the function's own source, which a live DOM test would
         ultimately be confirming anyway: the summing arithmetic is gone (no .reduce assembling a
         combined total), while the per-row rendering that must survive (each quotation's OWN
         individual amount, listed on its own line) is still there. A future reintroduction of any
         combined total is exactly what this is written to catch. */
      if (typeof window.loadHistory === 'function')
        check('loadHistory: no combined total across quotations, only each one\'s own amount',
          () => {
            const src = window.loadHistory.toString();
            return {
              noReduceSum: !/\.reduce\(/.test(src),
              noCombinedValVariable: !/\bvar val\s*=/.test(src),
              perRowAmountStillRenders: /peso\(x\.total\)/.test(src)
            };
          }, { noReduceSum: true, noCombinedValVariable: true, perRowAmountStillRenders: true });
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
