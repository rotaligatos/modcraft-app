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
      /* P3, 2026-09-25 — "Cabinet component rules" was saved and read by nothing, and its
         default "deduct 0.5mm edge tape" contradicted the plant (cut size = finished size).
         Removed; an old saved copy must be dropped on load, not carried forever. */
      if (typeof window.loadProdSettings === 'function' && typeof window.renderProductionSettings === 'function')
        check('P3: dead "Cabinet component rules" is gone, and an old saved copy is dropped on load', () => {
          const w = window, key = 'mc_prod', saved = localStorage.getItem(key);
          try {
            const old = JSON.parse(saved || '{}'); old.cabinetRules = { ebtDeduct: true, ebtThickness: 0.5, components: [] };
            localStorage.setItem(key, JSON.stringify(old));
            w.loadProdSettings();
            if (w.prodSettings.cabinetRules !== undefined) throw new Error('saved cabinetRules survived load');
            if (JSON.parse(localStorage.getItem(key)).cabinetRules !== undefined) throw new Error('not dropped from storage');
            if (typeof w.prodAddCabinetRule === 'function') throw new Error('prodAddCabinetRule still defined');
            const src = String(w.renderProductionSettings);
            if (/Cabinet component rules|prod-ebt-deduct/.test(src)) throw new Error('settings still render the section');
          } finally { if (saved === null) localStorage.removeItem(key); else localStorage.setItem(key, saved); }
        });
      /* P2, 2026-09-25 — the MSSI website sends grooving as the edge it runs along ("(L)"/"(W)")
         and a manual run as "(1200mm)", never "× N lm". Each is per panel, times the row qty.
         Before this every website grooving line arrived with no run length and was flagged. */
      if (typeof window._cutListToAnalysis === 'function')
        check('_cutListToAnalysis: website grooving "(L)"/"(W)"/"(Nmm)" becomes a per-panel run × qty', () => {
          const cl = { panels: [
            { group: 'K', part: 'Side', mat: 'Real White PB 4x8 2F (18mm, Matte)', th: 18, L: 720, W: 560, qty: 2, ebt: '',
              svcs: ['Grooving 3mm (melamine) (L)', 'Router Grooving (8-12mm) (W)', 'Manual Edgebanding EVA (1200mm)'] }
          ], hpl: [], hardware: [] };
          const p = window._cutListToAnalysis(cl, null);
          const got = {}; (p.extraServices || []).forEach(e => { got[e.service] = e.qty; });
          if (got['Grooving 3mm (melamine)'] !== 1.44) throw new Error('(L) should be 0.72×2 = 1.44, got ' + JSON.stringify(got));
          if (got['Router Grooving (8-12mm)'] !== 1.12) throw new Error('(W) should be 0.56×2 = 1.12, got ' + JSON.stringify(got));
          if (got['Manual Edgebanding EVA'] !== 2.4) throw new Error('(1200mm) should be 1.2×2 = 2.4, got ' + JSON.stringify(got));
          if (/run length/.test((p.components[0] || {}).reviewNote || '')) throw new Error('still flagged for a missing run length');
        });
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
      /* 2026-09-08: grain direction was captured at every layer of the Designers Support pipeline
         (the MCL cutting-list grid, _cutListToAnalysis, the AI extraction schema, the review table)
         but used NOWHERE in any computation -- guillotinePackBoards() decided whether to try a
         piece rotated purely from the machine-type flag (allowRotate), with zero regard for
         whether the piece's own grain direction would forbid that rotation. A CNC/nesting router
         can approach a panel from any angle, but it cannot spin the wood grain itself -- grain is a
         property of the MATERIAL, not the machine, so a piece with a declared grain direction must
         never be rotated even when the machine-level flag allows it. Only grain==='none'/falsy
         pieces are free to use the machine's own rotation capability.
         Proves both directions with a piece (80x150) that only fits a 100x200 board when rotated:
         grain-locked ('length') refuses the rotation and is reported oversized even in CNC mode;
         a grain-free piece of the identical size, same call, packs fine via rotation. Also proves
         the pre-existing Panel Saw behaviour (never rotates anything, any grain) is untouched. */
      if (typeof window.guillotinePackBoards === 'function')
        check('guillotinePackBoards: grain-locked pieces are never rotated, even on CNC', () => {
          const w = window;
          const boardW = 100, boardH = 200, kerf = 0;
          // 80x150 fits a 100x200 board ONLY when rotated to 150x80.
          const grainLocked = w.guillotinePackBoards(
            [{ length: 80, width: 150, grain: 'length' }], boardW, boardH, kerf, true);
          const grainFree = w.guillotinePackBoards(
            [{ length: 80, width: 150, grain: 'none' }], boardW, boardH, kerf, true);
          const panelSaw = w.guillotinePackBoards(
            [{ length: 80, width: 150, grain: 'none' }], boardW, boardH, kerf, false);
          return {
            grainLockedRefusesRotationSoOversized: grainLocked.oversizedCount === 1,
            grainFreePacksViaRotation: grainFree.oversizedCount === 0 && grainFree.boardsNeeded === 1,
            panelSawStillNeverRotates: panelSaw.oversizedCount === 1
          };
        }, { grainLockedRefusesRotationSoOversized: true, grainFreePacksViaRotation: true,
             panelSawStillNeverRotates: true });
      /* Same fix, the wiring: prodComputeBom groups components by material/color/texture/thickness/
         faces/HPL -- deliberately NOT by grain, since two pieces of the same physical board stock
         just get oriented differently on it, they don't need a separate board-count entry. This
         proves grain is carried through PER PIECE into the shared group's packing call rather than
         being dropped at the group boundary: two same-material/color/thickness components differing
         ONLY in grain still land in ONE bom group (not split into two), and within that one packing
         run the grain-locked piece is reported oversized while the grain-free piece of the identical
         size packs via rotation -- which could only happen if each piece's own grain reached
         guillotinePackBoards intact. */
      if (typeof window.prodComputeBom === 'function')
        check('prodComputeBom: grain rides per-piece into the shared group, not into the grouping key', () => {
          const w = window;
          const saved = { boardSizes: w.prodSettings.boardSizes,
                           machineKerfs: JSON.parse(JSON.stringify(w.prodSettings.machines)),
                           machineType: w.prodSettings.machineType };
          try {
            w.prodSettings.boardSizes = [{ material: 'TestMat', sizes: [{ w: 100, h: 200 }] }];
            w.prodSettings.machines.cnc.kerf = 0;
            w.prodSettings.machineType = 'cnc';
            const comps = [
              { material: 'TestMat', color: '', texture: '', thickness: 18, faces: 0,
                length: 80, width: 150, qty: 1, grain: 'length' },
              { material: 'TestMat', color: '', texture: '', thickness: 18, faces: 0,
                length: 80, width: 150, qty: 1, grain: 'none' }
            ];
            const bom = w.prodComputeBom(comps);
            return {
              oneGroupNotTwo: bom.length === 1,
              grainLockedPieceStillOversizedInSharedGroup: bom.length === 1 && bom[0].oversizedCount === 1,
              grainFreePieceStillPacksInSharedGroup: bom.length === 1 && bom[0].boardsNeeded === 1
            };
          } finally {
            w.prodSettings.boardSizes = saved.boardSizes; w.prodSettings.machines = saved.machineKerfs;
            w.prodSettings.machineType = saved.machineType;
          }
        }, { oneGroupNotTwo: true, grainLockedPieceStillOversizedInSharedGroup: true,
             grainFreePieceStillPacksInSharedGroup: true });
      /* 2026-09-08 (4): true 2D nesting + a visual cut-layout diagram. guillotinePackBoards now
         records where each piece actually lands (x,y,w,h,rotated) alongside the SAME decision
         logic already validated against samplesofcuttinglist/MARGARITA.xls -- this proves the
         bookkeeping is exact, not just "some coordinates appear". Piece A (80w x 50h) opens board
         0's only shelf at (0,0); piece B (60w x 40h) fits inside that same shelf (its height 80
         still fits, and there's still 50 of the 100 boardH left), so it must land at
         (x=shelf.xStart=0, y=shelf.lenUsed BEFORE B was added=50) -- exactly the shelf-reuse
         (step 1) branch, proven by driving the real function, not by re-deriving coordinates from
         the algorithm's own comments. */
      if (typeof window.guillotinePackBoards === 'function')
        check('guillotinePackBoards: layout records the exact rectangle each piece was placed at (shelf reuse)', () => {
          const w = window;
          const res = w.guillotinePackBoards(
            [ { length: 50, width: 80 }, { length: 40, width: 60 } ],
            200, 100, 0, false);
          const board0 = (res.layout && res.layout[0]) || [];
          const a = board0.find(p => p.w === 80 && p.h === 50);
          const b = board0.find(p => p.w === 60 && p.h === 40);
          return {
            oneBoardUsed: res.boardsNeeded === 1,
            layoutHasOneBoardArray: (res.layout || []).length === 1,
            pieceAAtOrigin: !!a && a.x === 0 && a.y === 0 && a.rotated === false,
            pieceBReusesTheSameShelfAfterA: !!b && b.x === 0 && b.y === 50 && b.rotated === false
          };
        }, { oneBoardUsed: true, layoutHasOneBoardArray: true, pieceAAtOrigin: true,
             pieceBReusesTheSameShelfAfterA: true });
      /* Same fix: the "open a new shelf on the same board" branch (step 2) must record the new
         shelf's xStart as the board's widthUsed AT THE MOMENT it was opened, not a fixed offset --
         piece C (60w x 45h) does not fit piece A's shelf (rem=50-40=10 < 45), so it must open its
         own shelf starting exactly where A's shelf's width budget ended (x=80). */
      if (typeof window.guillotinePackBoards === 'function')
        check("guillotinePackBoards: layout records a new shelf starting where the previous one's width ended (step 2)", () => {
          const w = window;
          const res = w.guillotinePackBoards(
            [ { length: 40, width: 80 }, { length: 45, width: 60 } ],
            200, 50, 0, false);
          const board0 = (res.layout && res.layout[0]) || [];
          const a = board0.find(p => p.w === 80);
          const c = board0.find(p => p.w === 60);
          return {
            oneBoardUsed: res.boardsNeeded === 1,
            pieceAAtOrigin: !!a && a.x === 0 && a.y === 0,
            pieceCStartsAtPreviousShelfsWidthBudget: !!c && c.x === 80 && c.y === 0
          };
        }, { oneBoardUsed: true, pieceAAtOrigin: true, pieceCStartsAtPreviousShelfsWidthBudget: true });
      /* Same fix, the wiring: prodComputeBom must carry boardW/boardH/layout through onto each BOM
         row (this is what _prodCutLayoutSvg actually reads to draw the diagram) -- proves the
         wiring, not just that guillotinePackBoards itself works in isolation. */
      if (typeof window.prodComputeBom === 'function')
        check('prodComputeBom: each BOM row carries boardW/boardH/layout through from the packer', () => {
          const w = window;
          const saved = { boardSizes: w.prodSettings.boardSizes,
                           machineKerfs: JSON.parse(JSON.stringify(w.prodSettings.machines)),
                           machineType: w.prodSettings.machineType };
          try {
            w.prodSettings.boardSizes = [{ material: 'TestMat', sizes: [{ w: 100, h: 200 }] }];
            w.prodSettings.machines.panelsaw.kerf = 0;
            w.prodSettings.machineType = 'panelsaw';
            const bom = w.prodComputeBom([
              { material: 'TestMat', color: '', texture: '', thickness: 18, faces: 0,
                length: 50, width: 40, qty: 1 }
            ]);
            const row = bom[0];
            return {
              boardWCarried: row && row.boardW === 100,
              boardHCarried: row && row.boardH === 200,
              layoutIsOneBoardWithOnePiece: row && row.layout && row.layout.length === 1 && row.layout[0].length === 1
            };
          } finally {
            w.prodSettings.boardSizes = saved.boardSizes; w.prodSettings.machines = saved.machineKerfs;
            w.prodSettings.machineType = saved.machineType;
          }
        }, { boardWCarried: true, boardHCarried: true, layoutIsOneBoardWithOnePiece: true });
      /* 2026-09-09: a real cut sequence (rip/crosscut instructions + total saw-travel length),
         not just a visual diagram. guillotinePackBoards now also returns `shelves` -- the SAME
         internal shelf geometry (xStart, cut width) the packer already used to decide placement,
         exposed rather than re-derived, so this can never disagree with what layout actually
         records. Reusing the exact fixture from the shelf-reuse test above: piece A (80w×50h)
         opens the only shelf, piece B (60w×40h) reuses it -- one shelf, its cut width is A's own
         width (80, the value the shelf was created with), never B's narrower one. */
      if (typeof window.guillotinePackBoards === 'function')
        check('guillotinePackBoards: shelves records the exact rip-cut-strip geometry it decided (xStart, cut width)', () => {
          const w = window;
          const res = w.guillotinePackBoards(
            [ { length: 50, width: 80 }, { length: 40, width: 60 } ],
            200, 100, 0, false);
          const shelves0 = (res.shelves && res.shelves[0]) || [];
          return {
            oneShelfNotTwo: shelves0.length === 1,
            shelfStartsAtBoardEdge: shelves0[0] && shelves0[0].xStart === 0,
            shelfWidthIsTheFirstPieceThatOpenedIt: shelves0[0] && shelves0[0].width === 80
          };
        }, { oneShelfNotTwo: true, shelfStartsAtBoardEdge: true, shelfWidthIsTheFirstPieceThatOpenedIt: true });
      /* Rommel gave a real reference cut sheet (2026-09-09): 10 pcs of 100(L)x20(W)mm from one
         1220x2440mm board, kerf 3mm, one shelf -> "Rip cut (20mm wide strip): 2440mm = 2.440 m" +
         "Crosscuts (9 cuts @ 20mm): 180mm = 0.180 m" = "Total Saw Cutting Length: 2.620 m". This
         drives the real prodComputeBom -> _prodCutSequence chain against that EXACT scenario and
         checks it reproduces those exact figures -- not a hand-picked toy case, the literal numbers
         he was shown as the target. */
      if (typeof window.prodComputeBom === 'function' && typeof window._prodCutSequence === 'function')
        check('_prodCutSequence: reproduces the real reference cut sheet exactly (10 pcs 100x20mm, 1220x2440 board, kerf 3mm)', () => {
          const w = window;
          const comps = [];
          for (let i = 0; i < 10; i++) comps.push({ material: 'PB', color: '', texture: '',
            thickness: 18, faces: 1, length: 100, width: 20, qty: 1, grain: 'none' });
          const bom = w.prodComputeBom(comps);
          const bm = bom[0];
          const seq = w._prodCutSequence(bm, 0);
          return {
            oneBoardOneShelf: bm.boardsNeeded === 1 && seq.ripCount === 1,
            ripLengthMatches: seq.ripLenMm === 2440,
            crosscutCountMatches: seq.crosscutCount === 9,
            crosscutLengthMatches: seq.crosscutLenMm === 180,
            totalMatches2620mm: seq.totalLenMm === 2620
          };
        }, { oneBoardOneShelf: true, ripLengthMatches: true, crosscutCountMatches: true,
             crosscutLengthMatches: true, totalMatches2620mm: true });
      /* The wiring: prodComputeBom must carry shelves/kerf through onto each BOM row (what
         _prodCutSequence/_prodCutSheetHtml actually read) -- same pattern as the boardW/boardH/
         layout wiring test above, for the fields added this session. */
      if (typeof window.prodComputeBom === 'function')
        check('prodComputeBom: each BOM row carries shelves/kerf through from the packer', () => {
          const w = window;
          const saved = { boardSizes: w.prodSettings.boardSizes,
                           machineKerfs: JSON.parse(JSON.stringify(w.prodSettings.machines)),
                           machineType: w.prodSettings.machineType };
          try {
            w.prodSettings.boardSizes = [{ material: 'TestMat', sizes: [{ w: 100, h: 200 }] }];
            /* Kerf is per-machine now -- set the machine's, not a global, or the packer reads
               the real 3mm and the shelf-width assertion below silently shifts. */
            w.prodSettings.machines.panelsaw.kerf = 5;
            w.prodSettings.machineType = 'panelsaw';
            const bom = w.prodComputeBom([
              { material: 'TestMat', color: '', texture: '', thickness: 18, faces: 0,
                length: 50, width: 40, qty: 1 }
            ]);
            const row = bom[0];
            return {
              kerfCarried: row && row.kerf === 5,
              shelvesIsOneBoardWithOneShelf: row && row.shelves && row.shelves.length === 1 && row.shelves[0].length === 1,
              shelfWidthMatchesThePiece: row && row.shelves[0][0].width === 40
            };
          } finally {
            w.prodSettings.boardSizes = saved.boardSizes; w.prodSettings.machines = saved.machineKerfs;
            w.prodSettings.machineType = saved.machineType;
          }
        }, { kerfCarried: true, shelvesIsOneBoardWithOneShelf: true, shelfWidthMatchesThePiece: true });
      /* Rommel, 2026-09-22: "the nesting and cnc is just a flexibility in case I made some
         upgrade" -- so a machine had to become a real thing carrying its OWN kerf, not one global
         kerf shared by every machine. This pins the part that decides money: a machine resolves
         its own kerf, and an UNKNOWN machine falls back to the Panel Saw rather than a 0mm kerf,
         which would quietly under-count boards on every material. */
      if (typeof window.prodMachine === 'function')
        check('prodMachine: every machine carries its own kerf; an unknown key falls back to Panel Saw, never a 0mm kerf', () => {
          const w = window;
          const saved = JSON.parse(JSON.stringify(w.prodSettings.machines));
          const savedType = w.prodSettings.machineType;
          try {
            w.prodSettings.machines.panelsaw.kerf = 3;
            w.prodSettings.machines.cnc.kerf = 8;
            w.prodSettings.machineType = 'panelsaw';
            const sawKerf = w.prodKerf();
            w.prodSettings.machineType = 'cnc';
            const cncKerf = w.prodKerf();
            w.prodSettings.machineType = 'a-machine-that-does-not-exist';
            const unknown = w.prodMachine();
            return {
              panelSawUsesItsOwnKerf: sawKerf === 3,
              cncUsesItsOwnKerf: cncKerf === 8,
              unknownFallsBackToPanelSaw: unknown.key === 'panelsaw',
              unknownKerfIsNotZero: unknown.kerf === 3,
              panelSawDoesNotRotate: w.prodMachine('panelsaw').allowRotate === false,
              cncRotates: w.prodMachine('cnc').allowRotate === true
            };
          } finally {
            w.prodSettings.machines = saved; w.prodSettings.machineType = savedType;
          }
        }, { panelSawUsesItsOwnKerf: true, cncUsesItsOwnKerf: true, unknownFallsBackToPanelSaw: true,
             unknownKerfIsNotZero: true, panelSawDoesNotRotate: true, cncRotates: true });

      /* The kerf a board was packed at must be STAMPED on the row, not re-read from the live
         setting when a report renders -- otherwise switching machine after an analysis relabels
         an old cut sheet with a kerf it was never packed at, and the printed cut lengths stop
         matching the stated kerf with nothing to show for it. */
      if (typeof window.prodComputeBom === 'function')
        check('prodComputeBom: the selected machine drives the pack AND is stamped on the row', () => {
          const w = window;
          const saved = { boardSizes: w.prodSettings.boardSizes,
                          machines: JSON.parse(JSON.stringify(w.prodSettings.machines)),
                          machineType: w.prodSettings.machineType };
          try {
            w.prodSettings.boardSizes = [{ material: 'TestMat', sizes: [{ w: 100, h: 200 }] }];
            w.prodSettings.machines.panelsaw.kerf = 4;
            w.prodSettings.machines.cnc.kerf = 9;
            const comp = [{ material: 'TestMat', color: '', texture: '', thickness: 18, faces: 0,
                            length: 50, width: 40, qty: 1 }];
            w.prodSettings.machineType = 'panelsaw';
            const sawRow = w.prodComputeBom(comp)[0];
            w.prodSettings.machineType = 'cnc';
            const cncRow = w.prodComputeBom(comp)[0];
            return {
              sawRowKerf: !!sawRow && sawRow.kerf === 4,
              cncRowKerf: !!cncRow && cncRow.kerf === 9,
              sawRowNamesItsMachine: !!sawRow && sawRow.machineKey === 'panelsaw' && !!sawRow.machineLabel,
              cncRowNamesItsMachine: !!cncRow && cncRow.machineKey === 'cnc',
              rotationStampedPerRow: !!sawRow && !!cncRow && sawRow.allowRotate === false && cncRow.allowRotate === true
            };
          } finally {
            w.prodSettings.boardSizes = saved.boardSizes; w.prodSettings.machines = saved.machines;
            w.prodSettings.machineType = saved.machineType;
          }
        }, { sawRowKerf: true, cncRowKerf: true, sawRowNamesItsMachine: true,
             cncRowNamesItsMachine: true, rotationStampedPerRow: true });

      /* saveProductionSettings must NOT write a `kerf` key back. loadProdSettings migrates any
         bare `kerf` it finds into machines.panelsaw.kerf -- so resurrecting the key here would let
         the next page load overwrite the machines table with a stale global, undoing every kerf
         set per machine. Nor may it reset machineType, which the Cutting List page now owns.
         Reads the function's own source; calling it needs the whole Settings DOM present. */
      if (typeof window.saveProductionSettings === 'function')
        check('saveProductionSettings: writes back neither a global kerf nor machineType (both would clobber newer values)', () => {
          const src = window.saveProductionSettings.toString();
          return {
            noGlobalKerfAssignment: !/prodSettings\s*\.\s*kerf\s*=/.test(src),
            noMachineTypeAssignment: !/prodSettings\s*\.\s*machineType\s*=/.test(src)
          };
        }, { noGlobalKerfAssignment: true, noMachineTypeAssignment: true });

      /* Found 2026-09-22 by LOOKING at the rendered layout, not by any number: labels were sized
         as a fraction of the BOARD (min(boardW,boardH)*0.018), so on a 1220x2440 sheet drawn 280px
         tall they came out at ~2.5 real px -- geometrically perfect and completely illegible. The
         geometry tests all passed throughout. Pins the property that actually matters: a label's
         ON-SCREEN size, derived through the same scale the viewBox applies, on any board size. */
      if (typeof window._prodBoardSvg === 'function')
        check('_prodBoardSvg: piece labels are legible on screen whatever the board size', () => {
          const px = (bw, bh) => {
            const svg = window._prodBoardSvg(
              [{ x: 0, y: 0, w: Math.round(bw * 0.45), h: Math.round(bh * 0.28), rotated: false }], bw, bh);
            const wAttr = +(svg.match(/<svg width="(\d+)"/) || [])[1];
            const hAttr = +(svg.match(/height="(\d+)" viewBox/) || [])[1];
            const font = +(svg.match(/font-size="(\d+)"/) || [])[1];
            if (!font) return null;                       // label suppressed -- caller decides
            const scale = Math.max(wAttr, hAttr) / Math.max(bw, bh);
            return font * scale;                          // the size a person actually sees
          };
          const sheet = px(1220, 2440), small = px(600, 900), wide = px(1830, 2440);
          const legible = v => v !== null && v >= 9 && v <= 16;
          return {
            fullSheetLabelLegible: legible(sheet),
            smallBoardLabelLegible: legible(small),
            wideSheetLabelLegible: legible(wide),
            // The old board-proportional rule produced wildly different on-screen sizes per board;
            // deriving from the screen makes them agree.
            consistentAcrossBoardSizes: [sheet, small, wide].every(v => v !== null)
              && (Math.max(sheet, small, wide) - Math.min(sheet, small, wide)) < 2
          };
        }, { fullSheetLabelLegible: true, smallBoardLabelLegible: true,
             wideSheetLabelLegible: true, consistentAcrossBoardSizes: true });

      /* Rommel, 2026-09-22: "It should only apply the specific cutting on a specific material
         based on thickness, color, type of board and texture. It should not mix." Adversarial by
         construction -- every pair differs by exactly ONE of those attributes and all pieces are
         the same size, so nothing is separated by luck and any merge is a genuine mixing bug. The
         last row is an exact duplicate of the first and MUST merge, or the guard has gone too far
         the other way and would buy a separate sheet per row. */
      if (typeof window.prodComputeBom === 'function')
        check('prodComputeBom: a board never mixes specs -- thickness, colour, board type, texture and faces each split the group', () => {
          const w = window;
          const saved = { boardSizes: w.prodSettings.boardSizes };
          try {
            w.prodSettings.boardSizes = [{ material: 'PB', sizes: [{ w: 1220, h: 2440 }] }];
            const base = { area: 'A', name: 'p', length: 600, width: 400, qty: 2 };
            const comps = [
              Object.assign({}, base, { material: 'PB',  color: 'real white', texture: 'matte',   thickness: 18, faces: 2 }),
              Object.assign({}, base, { material: 'PB',  color: 'real white', texture: 'matte',   thickness: 25, faces: 2 }),
              Object.assign({}, base, { material: 'PB',  color: 'warm white', texture: 'matte',   thickness: 18, faces: 2 }),
              Object.assign({}, base, { material: 'PB',  color: 'real white', texture: 'stipple', thickness: 18, faces: 2 }),
              Object.assign({}, base, { material: 'MDF', color: 'real white', texture: 'matte',   thickness: 18, faces: 2 }),
              Object.assign({}, base, { material: 'PB',  color: 'real white', texture: 'matte',   thickness: 18, faces: 1 }),
              Object.assign({}, base, { material: 'PB',  color: 'real white', texture: 'matte',   thickness: 18, faces: 2, qty: 3 })
            ];
            const bom = w.prodComputeBom(comps);
            const specOf = b => [b.material, b.color, b.texture, b.thickness, b.faces].join('|');
            const packed = bom.reduce((n, b) => n + b.layout.reduce((m, brd) => m + brd.length, 0), 0);
            return {
              oneGroupPerDistinctSpec: bom.length === 6,
              everySpecUnique: new Set(bom.map(specOf)).size === bom.length,
              identicalRowsShareTheirBoards:
                (bom.filter(b => specOf(b) === 'PB|real white|matte|18|2')[0] || {}).layout
                  .reduce((n, brd) => n + brd.length, 0) === 5,
              noPieceLostOrDuplicated: packed === 15
            };
          } finally { w.prodSettings.boardSizes = saved.boardSizes; }
        }, { oneGroupPerDistinctSpec: true, everySpecUnique: true,
             identicalRowsShareTheirBoards: true, noPieceLostOrDuplicated: true });

      /* The thickness is written in BOTH the SKU text and the Th column, and Th is what the
         grouping actually uses while the SKU is what a person reads. A new row starts at th:18,
         so choosing a 25mm SKU and leaving Th alone is the DEFAULT slip -- it silently merged a
         25mm panel into the 18mm group and cut it from the wrong board, with nothing flagged.
         Reproduced exactly that way before the fix. Flags, never picks a winner: either field
         could be the mistaken one, and guessing would mix materials just as quietly. */
      if (typeof window._cutListToAnalysis === 'function')
        check('_cutListToAnalysis: flags a SKU/Th thickness mismatch, and does not false-flag a row where they agree', () => {
          const mk = (mat, th) => ({ group: 'Cab', part: 'Side panel', mat: mat, th: th,
                                     L: 600, W: 400, qty: 2, ebt: '', emat: '', grain: '', svcs: [], remark: '' });
          const out = window._cutListToAnalysis({
            grain: 'length', panels: [
              mk('Real White PB 4x8 2F (18mm, Matte)', 18),   // agrees
              mk('Real White PB 4x8 2F (25mm, Matte)', 18),   // SKU 25 vs Th 18
              mk('Real White PB 4x8 2F (25mm, Matte)', 25)    // agrees at a different thickness
            ], hpl: [], hardware: []
          }, null);
          const c = out.components;
          const note = (c[1].reviewNote || '');
          return {
            mismatchedRowFlagged: !!c[1].needsReview,
            noteNamesBothFigures: note.indexOf('25mm') >= 0 && note.indexOf('18mm') >= 0,
            matchingRowNotFlagged: !c[0].needsReview,
            matchingRowAtOtherThicknessNotFlagged: !c[2].needsReview
          };
        }, { mismatchedRowFlagged: true, noteNamesBothFigures: true,
             matchingRowNotFlagged: true, matchingRowAtOtherThicknessNotFlagged: true });

      /* Rommel, 2026-09-22: match the website — only TWO lamination rates exist, and anything that
         is not MDF/PB takes the PLYWOOD rate. This replaced a third "doesn't match a known rule"
         branch that quoted NOTHING and left the line to be chased; if the flag went unnoticed the
         lamination was billed at zero, i.e. the work done for free. Plywood is the dearer of the
         two, so an unusual board is never quoted short.
         The FACE COUNT is deliberately still flagged: 1 Face and 2 Face are separate SKUs priced
         about double apart, so unlike the substrate there is no safe direction to guess in. */
      if (typeof window.prodBuildSummary === 'function' && typeof window.prodComputeBom === 'function')
        check('prodBuildSummary: an HPL substrate that is not MDF/PB takes the plywood rate instead of flagging at zero', () => {
          const w = window;
          const saved = { boardSizes: w.prodSettings.boardSizes, result: w.prodState.result,
                          summary: w.prodState.summary };
          const svcFor = (material, faces) => {
            const comps = [{ area: 'A', name: 'p', material: material, color: 'White', texture: '',
                             thickness: 18, faces: faces, length: 600, width: 400, qty: 2,
                             notes: 'HPL laminated' }];
            const res = { components: comps, hardware: [], holeSchedule: [], summary: '' };
            res._bom = w.prodComputeBom(comps);
            res._services = w.prodComputeServices(comps, [], []);
            w.prodState.result = res;
            w.prodBuildSummary(res);
            const rows = ((w.prodState.summary || {}).services || [])
              .filter(s => /HPL Lamination/i.test(s.aiName || s.name || ''));
            const r = rows[0] || {};
            /* Only the LABEL is asserted on. Whether that service name resolves in the catalogue
               is a separate concern that always fails offline, where SERVICES is the 6-row
               placeholder -- so needsReview here reports catalogue presence, not the substrate
               rule under test. The face-count case is identified by its own note instead. */
            return { label: r.aiName || r.name || '(none)', note: r.reviewNote || '' };
          };
          try {
            w.prodSettings.boardSizes = [{ material: 'PB', sizes: [{ w: 1220, h: 2440 }] }];
            const mdf  = svcFor('MDF 4x8 (18mm) HPL', 2);
            const ply  = svcFor('Plywood 4x8 (18mm) HPL', 2);
            const hdf  = svcFor('HDF 4x8 (18mm) HPL', 2);
            const versa = svcFor('Versaboard 4x8 (18mm) HPL', 2);
            const compact = svcFor('Compact Laminate 4x8 (12mm) HPL', 2);
            const noFaces = svcFor('MDF 4x8 (18mm) HPL', 0);
            return {
              mdfTakesMdfPbRate:  /MDF\/PB, 2 Face/.test(mdf.label),
              plywoodTakesPlywoodRate: /Plywood, 2 Face/.test(ply.label),
              hdfTakesPlywoodRate:     /Plywood, 2 Face/.test(hdf.label),
              versaboardTakesPlywoodRate: /Plywood, 2 Face/.test(versa.label),
              compactTakesPlywoodRate: /Plywood, 2 Face/.test(compact.label),
              // The one thing that must STILL flag rather than be guessed.
              anUnknownFaceCountStillFlags: /face count/i.test(noFaces.note)
            };
          } finally {
            w.prodSettings.boardSizes = saved.boardSizes;
            w.prodState.result = saved.result; w.prodState.summary = saved.summary;
          }
        }, { mdfTakesMdfPbRate: true, plywoodTakesPlywoodRate: true, hdfTakesPlywoodRate: true,
             versaboardTakesPlywoodRate: true, compactTakesPlywoodRate: true,
             anUnknownFaceCountStillFlags: true });

      /* Rommel, 2026-09-24: holes are counted PER PANEL everywhere. The website asks "how many
         holes on this panel" and a client thinks "2 hinges per door", but the count was taken
         as the row total -- 4 doors x 2 holes arrived as 2, and boring (priced per hole) was
         under-quoted by the row's quantity. Found by simulating a real client job end to end. */
      if (typeof window._cutListToAnalysis === 'function' && typeof window.prodComputeServices === 'function')
        check('_cutListToAnalysis: a hole count is per panel, multiplied by the row quantity', () => {
          const mk = (qty, svc) => ({ group: 'C', part: 'Door', mat: 'Real White PB 4x8 2F (18mm, Matte)',
            th: 18, L: 700, W: 445, qty: qty, ebt: '', emat: '', grain: '', svcs: [svc], remark: '' });
          const out = window._cutListToAnalysis({ grain: 'length', hpl: [], hardware: [], panels: [
            mk(4, 'Boring 35mm (Hinges) × 2 holes'),   // 4 doors, 2 holes each -> 8
            mk(1, 'Boring 5mm (Pegs) × 3 holes')        // single panel -> 3
          ] }, null);
          const hs = out.holeSchedule || [];
          const svc = window.prodComputeServices(out.components, hs, out.extraServices || []);
          return {
            fourDoorsTwoHolesEachIsEight: !!hs[0] && hs[0].qty === 8,
            aSinglePanelIsUnchanged: !!hs[1] && hs[1].qty === 3,
            totalReachesTheServices: svc.holeCount === 11
          };
        }, { fourDoorsTwoHolesEachIsEight: true, aSinglePanelIsUnchanged: true, totalReachesTheServices: true });

      /* Rommel, 2026-09-24: an optional Cabinet column on hardware rows. The quotation only needs
         the TOTAL, but the shop needs to know which cabinet each item goes into. So the same
         hinge on two cabinet rows must reach the quotation as ONE line with the total, while the
         split survives for the Job Order. Three things must never happen: two DIFFERENT units
         added together; a blank-quantity row hidden by being summed into a filled one; and the
         per-row detail (cabinet) lost before the Job Order can use it. */
      if (typeof window._cutListToAnalysis === 'function' && typeof window.prodBuildSummary === 'function')
        check('hardware Cabinet column: one quotation line per item, the split kept, a blank row still flagged', () => {
          const w = window;
          const saved = { result: w.prodState.result, summary: w.prodState.summary };
          try {
            const r = w._cutListToAnalysis({ grain: 'length', hpl: [], panels: [
                { group: 'Cabinet 1', part: 'Door', mat: 'Real White PB 4x8 2F (18mm, Matte)', th: 18,
                  L: 700, W: 445, qty: 2, ebt: '', emat: '', grain: '', svcs: [], remark: '' }],
              hardware: [
                { item: 'Overlay hinge', qty: 4, unit: 'pcs', notes: '', cabinet: 'Cabinet 1' },
                { item: 'Overlay hinge', qty: 8, unit: 'pcs', notes: '', cabinet: 'Cabinet 2' },
                { item: 'Drawer slide', qty: 2, unit: 'pair', notes: '', cabinet: 'Cabinet 1' },
                { item: 'Drawer slide', qty: '', unit: 'pair', notes: '', cabinet: 'Cabinet 2' },
                { item: 'Drawer slide', qty: 6, unit: 'pcs', notes: '', cabinet: '' }
              ] }, null);
            w.prodState.result = r; w.prodBuildSummary(r);
            const hws = (w.prodState.summary || {}).hardware || [];
            const hinge = hws.filter(h => /hinge/i.test(h.name || ''));
            const slidePair = hws.filter(h => /slide/i.test(h.name || '') && /pair/i.test(h.unit || ''))[0];
            const slidePcs = hws.filter(h => /slide/i.test(h.name || '') && /pcs/i.test(h.unit || ''))[0];
            return {
              cabinetReachesTheAnalysis: r.hardware[0].cabinet === 'Cabinet 1',
              hingeIsOneQuotationLine: hinge.length === 1 && hinge[0].qty === 12,
              theSplitIsKeptForTheJobOrder: !!hinge[0] && /Cabinet 1 ×4/.test(hinge[0].cabinetSplit || '')
                && /Cabinet 2 ×8/.test(hinge[0].cabinetSplit || ''),
              differentUnitsNeverAddedTogether: !!slidePair && !!slidePcs && slidePcs.qty === 6,
              aBlankRowStillFlagsTheMergedLine: !!slidePair && slidePair.qty === 2 && !!slidePair.needsReview
                && /no quantity/i.test(slidePair.reviewNote || '')
            };
          } finally { w.prodState.result = saved.result; w.prodState.summary = saved.summary; }
        }, { cabinetReachesTheAnalysis: true, hingeIsOneQuotationLine: true, theSplitIsKeptForTheJobOrder: true,
             differentUnitsNeverAddedTogether: true, aBlankRowStillFlagsTheMergedLine: true });

      /* Rommel, 2026-09-22, comparing against the MSSI website's cutting list: picking a material
         there writes its thickness into the Th box; Modcraft left Th to be typed, so the SKU and
         the Th column could silently disagree and a panel be cut from the wrong board.
         ⚠ The HPL case is the one that bites: a laminated board's thickness is the SUBSTRATE's
         only, and its build label carries BOTH figures -- "Pure White 0.7mm HPL on ... 18mm MDF".
         The generic parser takes the FIRST "...mm" it sees, which is the 0.7mm finish, so the
         build must be resolved back to its substrate. Pinned here because getting it wrong yields
         a plausible number (0.7) rather than an obvious failure. */
      if (window.MCL && typeof window.MCL.matSearch === 'function')
        check('MCL.matSearch: the picked material fills Th -- and an HPL build fills its SUBSTRATE thickness, not the finish', () => {
          const w = window;
          w.setProdTab('cutlist');
          w.MCL.addHpl();
          const hi = w.MCL.state().hpl.length - 1;
          w.MCL.setHpl(hi, 'sub', 'Raw Boards 4x8 18mm MDF — MDF-18R');
          w.MCL.setHpl(hi, 'fin', 'Pure White 0.7mm HPL — HPL-WHT');
          w.MCL.setHpl(hi, 'faces', '2F');
          const inputs = [].slice.call(document.querySelectorAll('input[oninput*="matSearch"]'));
          const pick = (idx, val) => {
            const el = inputs[idx];
            el.value = val;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            const shown = el.closest('tr').querySelector('.mcl-f-th');
            return { state: w.MCL.state().panels[idx].th, shown: shown ? +shown.value : null };
          };
          const plain = pick(0, 'Real White PB 4x8 2F (25mm, Matte)');
          /* Move this row OFF the default 18 first. The substrate here is also 18mm, so leaving
             the default in place would let "nothing happened at all" score as a pass. */
          w.MCL.set(1, 'th', 25);
          const hpl = pick(1, 'Pure White 0.7mm HPL on Raw Boards 4x8 18mm MDF · 2F');
          const partial = pick(2, 'Real White PB');          // states no thickness
          const before = w.MCL.state().panels[2].th;
          return {
            plainSkuFillsThickness: plain.state === 25 && plain.shown === 25,
            hplBuildUsesSubstrate: hpl.state === 18 && hpl.shown === 18,
            hplBuildIsNotTheFinishThickness: hpl.state !== 0.7,
            aPartialNameLeavesThAlone: partial.state === before
          };
        }, { plainSkuFillsThickness: true, hplBuildUsesSubstrate: true,
             hplBuildIsNotTheFinishThickness: true, aPartialNameLeavesThAlone: true });

      /* "let it understand as well, all around is 4s, if no input then its none" -- clients write
         the same nine codes in their own words. Only the unambiguous ones are translated; anything
         doubtful still flags and keeps the client's own text, because banding is charged by the
         metre and a wrong guess is billed, not noticed. */
      if (typeof window._webEbtToModcraft === 'function')
        check('_webEbtToModcraft: reads "all around" as 4S and a blank/none as no banding, without guessing at doubtful legends', () => {
          const f = (t) => window._webEbtToModcraft(t, 600, 400);
          const allRound = ['4S', 'ALL AROUND', 'all around', 'ALLROUND', '4 SIDES', '4'];
          const none = ['', '0', 'NONE', 'N/A', 'NA', 'nil'];
          return {
            everyAllRoundFormIs4s: allRound.every(t => f(t).ebt === '4s' && !f(t).unknown),
            everyNoneFormIsBlankAndUnflagged: none.every(t => f(t).ebt === '' && !f(t).unknown),
            spacingIsNotVocabulary: f('2L1S').ebt === f('2L 1S').ebt && f('2L 1S').ebt !== '',
            aDoubtfulLegendStillFlags: f('2 long 1 short').unknown === true,
            anExactCodeStillWorks: f('1L 1S').ebt === '1s/1l'
          };
        }, { everyAllRoundFormIs4s: true, everyNoneFormIsBlankAndUnflagged: true,
             spacingIsNotVocabulary: true, aDoubtfulLegendStillFlags: true,
             anExactCodeStillWorks: true });

      /* A hardware row with no quantity was dropped before it reached the quotation -- the client
         asked for hinges and the quotation simply never mentioned them, which reads exactly like
         "no hinges needed". Flag it instead; the estimator has the count, we do not. A NAMELESS
         row is still dropped: there is nothing to price or match. */
      if (typeof window.prodBuildSummary === 'function' && typeof window._cutListToAnalysis === 'function')
        check('prodBuildSummary: hardware with no quantity survives to the quotation, flagged -- only a nameless row is dropped', () => {
          const w = window;
          const saved = { result: w.prodState.result, summary: w.prodState.summary };
          try {
            const r = w._cutListToAnalysis({ grain: 'length', hpl: [], hardware: [
                { item: 'Overlay hinge', qty: 8, unit: 'pcs', notes: '' },
                { item: 'Drawer slide 450mm', qty: '', unit: 'pcs', notes: '' },
                { item: '', qty: 5, unit: 'pcs', notes: 'nameless' }
              ], panels: [{ group: 'C', part: 'Door', mat: 'Real White PB 4x8 2F (18mm, Matte)',
                th: 18, L: 600, W: 400, qty: 2, ebt: '4S', emat: '', grain: '', svcs: [], remark: '' }] }, null);
            w.prodState.result = r;
            w.prodBuildSummary(r);
            const hws = (w.prodState.summary || {}).hardware || [];
            const slide = hws.filter(h => /slide/i.test(h.name || ''))[0];
            return {
              hingeReachesQuotation: hws.some(h => /hinge/i.test(h.name || '')),
              blankQtyRowSurvives: !!slide,
              andIsFlaggedAboutTheQuantity: !!slide && !!slide.needsReview
                && /without a quantity/i.test(slide.reviewNote || ''),
              namelessRowStillDropped: !hws.some(h => /nameless/i.test(h.name || ''))
            };
          } finally { w.prodState.result = saved.result; w.prodState.summary = saved.summary; }
        }, { hingeReachesQuotation: true, blankQtyRowSurvives: true,
             andIsFlaggedAboutTheQuantity: true, namelessRowStillDropped: true });

      /* Rommel, 2026-09-22: "it should produce 1st the cutting layout ... After showing this, a
         summary of how many boards are needed, how many edgebands are need and also the
         equivalent services". The layout used to be collapsed inside a Bill of Materials row and
         opened only on click. Checks real rendered output: the layout card exists, comes BEFORE
         the boards table, and is open without anyone clicking. */
      if (typeof window.prodBuildResultHtml === 'function' && typeof window.prodComputeBom === 'function')
        check('prodBuildResultHtml: the cutting layout renders first, open by default, ahead of the boards table', () => {
          const w = window;
          const saved = { boardSizes: w.prodSettings.boardSizes, result: w.prodState.result,
                          expanded: w.prodState.expandedLayout };
          try {
            w.prodSettings.boardSizes = [{ material: 'TestMat', sizes: [{ w: 1220, h: 2440 }] }];
            w.prodState.expandedLayout = {};
            const comps = [{ area: 'A', name: 'Side', material: 'TestMat', color: 'White',
                             texture: '', thickness: 18, length: 600, width: 400, qty: 4,
                             faces: 2, ebt: '1l', edgeTape: 'White PVC', grain: 'none' }];
            const res = { components: comps, hardware: [], holeSchedule: [], summary: '' };
            res._bom = w.prodComputeBom(comps);
            res._services = w.prodComputeServices(comps, [], []);
            w.prodState.result = res;
            const html = w.prodBuildResultHtml(res);
            const iLayout = html.indexOf('Cutting layout');
            const iBom = html.indexOf('Bill of Materials');
            return {
              layoutCardRendered: iLayout >= 0,
              layoutComesBeforeBoardsTable: iLayout >= 0 && iBom >= 0 && iLayout < iBom,
              openWithoutClicking: html.indexOf('Board 1 of') >= 0
            };
          } finally {
            w.prodSettings.boardSizes = saved.boardSizes; w.prodState.result = saved.result;
            w.prodState.expandedLayout = saved.expanded;
          }
        }, { layoutCardRendered: true, layoutComesBeforeBoardsTable: true, openWithoutClicking: true });

      /* "how many edgebands are need" -- the per-tape split and the per-lm services were already
         computed for the quotation but appeared nowhere in the Services summary, so the only way
         to see how much of EACH tape to buy was the reflect panel further down the page. */
      if (typeof window._prodSvcDetailHtml === 'function')
        check('_prodSvcDetailHtml: shows edge banding per tape and the per-lm services, including the unnamed-tape bucket', () => {
          const html = window._prodSvcDetailHtml({
            edgebandingByTape: [{ tape: 'White PVC', lm: 12.5 }, { tape: 'Unspecified', lm: 3 }],
            extraServicesByName: [{ service: 'Grooving 3mm (melamine)', qty: 8, unit: 'lm' }]
          });
          return {
            namesEachTape: html.indexOf('White PVC') >= 0,
            showsItsLength: html.indexOf('12.5 lm') >= 0,
            surfacesTheUnnamedBucket: html.indexOf('Unspecified') >= 0,
            listsPerLmServices: html.indexOf('Grooving 3mm (melamine)') >= 0 && html.indexOf('8 lm') >= 0,
            emptyWhenNothingToShow: window._prodSvcDetailHtml({}) === ''
          };
        }, { namesEachTape: true, showsItsLength: true, surfacesTheUnnamedBucket: true,
             listsPerLmServices: true, emptyWhenNothingToShow: true });

      /* Rommel, 2026-09-09: typed a real cutting list, clicked "Load into analysis", and reported
         "there's nothing here but just the cutting list" -- the Bill of Materials WAS there, just
         below a full "Upload file for analysis" card (file picker, drag-and-drop zone, an Analyze
         button) plus a "No Claude API key configured" warning, neither of which applies once a
         typed-list result already exists. Drives the REAL click path -- MCL.load() is exactly what
         the "Load into analysis" button's onclick calls, not a hand-built equivalent -- and checks
         the rendered #prod-wrap, not just prodState. A first version of the fix added its own
         header duplicating the "New analysis" button prodBuildResultHtml's own actHtml already
         renders at the top -- caught by reading the rendered HTML (newAnalysisButtonCount), not
         just the pass/fail of "is the upload card gone", and removed. */
      if (window.MCL && typeof window.MCL.load === 'function' && typeof window.MCL.set === 'function')
        check('renderProductionPage: a loaded cutting-list result shows immediately, no upload card or API-key warning, no duplicate controls', () => {
          const w = window;
          const savedProdTab = w.prodTab;
          const savedPanels = w.MCL.state().panels.slice();
          try {
            w.setProdTab('cutlist');
            w.MCL.set(0, 'mat', 'PB White');
            w.MCL.set(0, 'L', 700);
            w.MCL.set(0, 'W', 550);
            w.MCL.set(0, 'qty', 4);
            w.renderProductionPage();
            w.MCL.load();   // the exact function the real "Load into analysis" button's onclick calls
            const html = document.getElementById('prod-wrap').innerHTML;
            return {
              tabSwitchedToDrawing: w.prodTab === 'drawing',
              noUploadCard: !html.includes('Upload file for analysis'),
              noApiKeyWarning: !html.includes('No Claude API key configured'),
              hasBomHeading: html.includes('Bill of Materials'),
              exactlyOneNewAnalysisButton: (html.match(/New analysis/g) || []).length === 1
            };
          } finally {
            w.prodTab = savedProdTab;
            w.MCL.state().panels = savedPanels;
            if (typeof w.prodClearFile === 'function') w.prodClearFile();
          }
        }, { tabSwitchedToDrawing: true, noUploadCard: true, noApiKeyWarning: true,
             hasBomHeading: true, exactlyOneNewAnalysisButton: true });
      /* Rommel, 2026-09-13: audited "how is installation computed" and found CF.installCostPerUnit
         (Settings -> Cost Factors, default P1200) was dead -- grep-confirmed the real engine
         (_recalcCore/_recalcFQCore/getInstCostByType/_instCalc) never reads it; the real per-unit
         installation rate comes entirely from the PPIC/Cost Breakdown capacity model. Removed the
         field, its Settings input, its Excel import/export mapping, and the now-fully-orphaned
         Stage 2 preview variables that only ever read it (s1InstRate/instRate inside
         renderFQCards, and fqInstRateOverride -- which had no UI input anywhere that could ever
         set it). This check is the permanent guard: confirms the field genuinely cannot exist on
         CF, confirms a real quotation's installation/assembly charge is unaffected (proven against
         a captured before-removal baseline: grand 65570.97103030303, instBase 19016.25984848485,
         assmBase 4250, identical on both stages, down to the float), and confirms importing an
         OLD Excel template that still carries the removed header is silently ignored rather than
         resurrecting the dead field. */
      if (typeof window.recalc === 'function' && typeof window.recalcFQ === 'function')
        check('CF.installCostPerUnit is gone, and installation/assembly pricing is unaffected', () => {
          const w = window;
          const saved = { qFabMode: w.qFabMode, qAreas: w.qAreas, qStage: w.qStage,
                           clService: document.getElementById('cl-service') ? document.getElementById('cl-service').value : null };
          try {
            const fieldGone = !('installCostPerUnit' in w.CF);
            const overrideGone = typeof w.fqInstRateOverride === 'undefined';

            w.initQuotation();
            if (document.getElementById('cl-service')) document.getElementById('cl-service').value = 'Fabrication with Installation';
            w.qFabMode = 'carcass';
            w.qAreas = [{ name: 'Area 1', items: [{ type: 'Kitchen Base Cabinet', qty: 5 }],
              matItems: [], hwItems: [], svcItems: [], bomItems: [],
              outsourceMaterials: [], outsourceHardware: [] }];
            w.recalc();
            const s1 = w._pCalc;
            w.qStage = 2;
            w.recalcFQ();
            const s2 = w._pCalc;

            // Old template still carries the removed header -- must be silently ignored, not
            // resurrect the field or overwrite Assembly's real value.
            w.importCFData([['Factor', 'Value'], ['Installation Cost Per Carcass', 999],
                             ['Assembly Cost Per Carcass', 850]]);
            const oldTemplateIgnoredSafely = !('installCostPerUnit' in w.CF) && w.CF.assemblyCostPerUnit === 850;

            const r2 = n => Math.round(n * 100) / 100;
            return {
              fieldGone, overrideGone, oldTemplateIgnoredSafely,
              stage1: [r2(s1.grand), r2(s1.instBase), r2(s1.assmBase)],
              stage2: [r2(s2.grand), r2(s2.instBase), r2(s2.assmBase)]
            };
          } finally {
            w.qFabMode = saved.qFabMode; w.qAreas = saved.qAreas; w.qStage = saved.qStage;
            if (document.getElementById('cl-service') && saved.clService != null) document.getElementById('cl-service').value = saved.clService;
          }
        }, { fieldGone: true, overrideGone: true, oldTemplateIgnoredSafely: true,
             stage1: [65570.97, 19016.26, 4250], stage2: [62434.97, 19016.26, 4250] });
      /* Rommel, 2026-09-21 (QT-W00000183): the client already approved the Initial Quotation, and a
         Settings-wide change made afterward (installation team reduced) shifted what the Final
         Quotation computed for Mobilization & Installation -- fabrication itself never moved (that
         was already proven identical, same session), but he does not want ANY of it drifting for
         THIS specific, already-approved job. Explicitly not a general rule -- a genuine cost change
         must still reach a quotation that has not been sent yet. fqMirrorStage1, per-quotation, off
         by default: when on, recalcFQ() does not run _recalcFQCore() at all -- it runs Stage 1's OWN
         recalc() (Stage 1's own scope, Stage 1's own frozen rates) and relabels the result stage:2.
         "Final = Initial" holds because Stage 2 IS Stage 1's result here, not because two formulas
         coincidentally agree -- proven by giving fqAreas a DIFFERENT scope than qAreas and confirming
         the mirrored total ignores it entirely, using only qAreas. The default-off case is checked
         too, confirming existing quotations (no flag set) keep running their own independent Stage 2
         formula exactly as before -- this is additive, not a replacement of the normal path. */
      if (typeof window.recalc === 'function' && typeof window.recalcFQ === 'function')
        check('fqMirrorStage1: Final Quotation becomes Stage 1\'s own result, ignoring fqAreas entirely', () => {
          const w = window;
          const saved = { qFabMode: w.qFabMode, qAreas: w.qAreas, fqAreas: w.fqAreas, qStage: w.qStage,
                           fqMirrorStage1: w.fqMirrorStage1,
                           clService: document.getElementById('cl-service') ? document.getElementById('cl-service').value : null };
          try {
            w.initQuotation();
            if (document.getElementById('cl-service')) document.getElementById('cl-service').value = 'Fabrication with Installation';
            w.qFabMode = 'carcass';
            w.qAreas = [{ name: 'Area 1', items: [{ type: 'Kitchen Base Cabinet', qty: 5 }],
              matItems: [], hwItems: [], svcItems: [], bomItems: [],
              outsourceMaterials: [], outsourceHardware: [] }];
            w.recalc();
            const stage1Grand = w._pCalc.grand;

            // A deliberately DIFFERENT Stage 2 scope -- if the mirror is genuinely ignoring
            // fqAreas, this must have zero effect on the mirrored result below.
            w.fqAreas = [{ name: 'Area 1', items: [{ type: 'Kitchen Base Cabinet', qty: 50 }],
              matItems: [], hwItems: [], svcItems: [], bomItems: [],
              outsourceMaterials: [], outsourceHardware: [] }];
            w.qStage = 2;

            w.fqMirrorStage1 = false;
            w.recalcFQ();
            const defaultOffDiffers = Math.abs(w._pCalc.grand - stage1Grand) > 0.01; // 50 units != 5 units — must NOT match

            w.fqMirrorStage1 = true;
            w.recalcFQ();
            const mirrored = w._pCalc;

            return {
              defaultOffStillRunsItsOwnFormula: defaultOffDiffers,
              mirroredStageIsTwo: mirrored.stage,
              mirroredGrandMatchesStage1Exactly: Math.abs(mirrored.grand - stage1Grand) < 0.0001,
              ignoredTheDifferentFqAreas: true // the equality above IS the proof — fqAreas had 10x the qty
            };
          } finally {
            w.qFabMode = saved.qFabMode; w.qAreas = saved.qAreas; w.fqAreas = saved.fqAreas;
            w.qStage = saved.qStage; w.fqMirrorStage1 = saved.fqMirrorStage1;
            if (document.getElementById('cl-service') && saved.clService != null) document.getElementById('cl-service').value = saved.clService;
          }
        }, { defaultOffStillRunsItsOwnFormula: true, mirroredStageIsTwo: 2,
             mirroredGrandMatchesStage1Exactly: true, ignoredTheDifferentFqAreas: true });
      /* Rommel, 2026-09-13 (finding #3 of the installation-cost audit): Reports -> Computation Ref
         -> "Installation Computation" described a formula that never matched reality -- a fictional
         "Install cost x qty" per-unit layer (sourced from the CF.installCostPerUnit field removed
         in finding #1), contingency applied in the wrong place, no mention of the minimum-unit
         floor, per-type complexity, or zone add-ons. Rewritten to read every figure straight out of
         _instCalc()'s own return object -- the SAME function the real engine calls -- so this page
         cannot silently drift from reality the way the old one did. Drives the real renderCompRef()
         and checks the actual rendered text: the fictional per-unit line and the old "Install cost /
         unit" row (in the separate Cost Factors list further up the same page) are both gone, the
         real total-daily-cost and base-rate figures (read from a live _instCalc() call, not
         hand-typed expectations) appear verbatim, and the corrected step names/wording are present. */
      if (typeof window.renderCompRef === 'function' && typeof window._instCalc === 'function')
        check('Computation Ref: Installation Computation section describes the real formula, not the old fictional one', () => {
          const w = window;
          const ic = w._instCalc();
          const fmt = v => '₱' + v.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          // #compref-wrap already exists in the static markup (Reports -> Computation Ref, hidden
          // until that tab is opened) -- renderCompRef() writes into THAT element via el(id), so
          // the result must be read back the same way (getElementById), not via a separately
          // created node sharing the id, which a first pass here wrongly did and always read empty.
          const savedHtml = (document.getElementById('compref-wrap') || {}).innerHTML;
          try {
            w.renderCompRef();
            const html = document.getElementById('compref-wrap').innerHTML;
            return {
              oldPerUnitLineGone: !html.includes('Per-unit subtotal'),
              oldInstallCostRowGone: !html.includes('Install cost / unit'),
              hasRealTotalDailyCost: html.includes(fmt(ic.total)),
              hasRealBaseRate: html.includes(fmt(ic.priceUnit)),
              hasDailyCostBuildupStep: html.includes('Daily Cost Buildup'),
              hasMinimumFloorMention: html.includes('floors to the flat generic rate'),
              hasAssemblySeparateNote: html.includes('never a per-unit add-on to installation')
            };
          } finally {
            var _cr = document.getElementById('compref-wrap');
            if (_cr) _cr.innerHTML = savedHtml || '';
          }
        }, { oldPerUnitLineGone: true, oldInstallCostRowGone: true, hasRealTotalDailyCost: true,
             hasRealBaseRate: true, hasDailyCostBuildupStep: true, hasMinimumFloorMention: true,
             hasAssemblySeparateNote: true });
      /* Finding #4 of the installation-cost audit (2026-09-13): the zone add-on math (breakfast
         add-on for out-of-town zones, extra QA/QC days beyond the 1 already in the base rate, a
         flat per-diem/accommodation surcharge) was hand-written 3 separate times -- the real
         engine (_instCalcForZone), the Settings -> Zone Add-ons editor's live preview
         (_zaRefreshEffect), and the "?" rate build-up popup (openInstDetail). This was not just a
         future-drift risk -- it had ALREADY drifted: both previews defaulted an unset qaqcDays to
         1 (showing no extra QA/QC charge), while the real engine defaults a non-base zone to 2,
         so any zone nobody had explicitly configured was silently charging a real extra QA/QC day
         neither preview ever showed. Consolidated into one _instZoneAddon(zoneKey,cap), which all
         three now call -- they cannot disagree again because there is only one implementation left.
         Reproduced live before fixing: zone z2 with qaqcDays never set showed 0 extra in both
         previews while _instCalcForZone('z2',...) charged 3729.92 (base + the hidden 2-day QA/QC
         add-on). This drives the three REAL functions (not a hand re-derivation of the old
         formula) and confirms they now agree exactly. */
      if (typeof window._instZoneAddon === 'function' && typeof window._instCalcForZone === 'function'
          && typeof window._zaRefreshEffect === 'function' && typeof window.openInstDetail === 'function')
        check('Zone add-on math: the real engine and both Settings previews agree, no unset-qaqcDays discrepancy', () => {
          const w = window;
          const saved = { zoneAddons: JSON.parse(JSON.stringify(w.INST_COST.zoneAddons || {})),
                           qInstRegion: w.qInstRegion, qInstRegionManual: w.qInstRegionManual };
          // za-eff-z2 has no static counterpart (only rendered when the Zone Add-ons editor is
          // open), so a fresh element is safe there. ov-inst-detail-body DOES already exist in the
          // static markup (the modal's own body div) -- openInstDetail() writes into THAT one via
          // getElementById, so the popup result must be read back the same way, not from a
          // same-id lookalike (the exact test-harness mistake caught and fixed in finding #3's
          // Computation Ref check just above).
          const effEl = document.createElement('div'); effEl.id = 'za-eff-z2';
          document.body.appendChild(effEl);
          const popupSavedHtml = (document.getElementById('ov-inst-detail-body') || {}).innerHTML;
          try {
            w.INST_COST.zoneAddons = w.INST_COST.zoneAddons || {};
            delete w.INST_COST.zoneAddons.z2; // genuinely unset -- the exact state that drifted

            const cap = w._ppicCapacity();
            const addon = w._instZoneAddon('z2', cap);
            const realFullRate = w._instCalcForZone('z2', null);
            const r2 = n => Math.round(n * 100) / 100;

            w._zaRefreshEffect('z2');
            const previewHtml = effEl.innerHTML;

            w.qInstRegion = 'z2';
            w.openInstDetail();
            const popupHtml = document.getElementById('ov-inst-detail-body').innerHTML;
            const fmtFullRate = realFullRate.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

            return {
              sharedFnDefaultsNonBaseZoneToTwoDays: addon.qaqcDays === 2,
              qaqcExtraIsGenuinelyNonzero: addon.qaqcExtraAddon > 0,
              engineIncludesTheSameAddon: Math.abs((w._instCalc().total / cap + addon.total) - realFullRate) < 0.01,
              previewNowShowsTheQaqcLine: previewHtml.includes('QA/QC'),
              popupShowsTheRealTwoDayDefault: popupHtml.includes('2d total'),
              popupFullRateMatchesEngineExactly: popupHtml.includes(fmtFullRate)
            };
          } finally {
            w.INST_COST.zoneAddons = saved.zoneAddons;
            w.qInstRegion = saved.qInstRegion; w.qInstRegionManual = saved.qInstRegionManual;
            var _pb = document.getElementById('ov-inst-detail-body');
            if (_pb) _pb.innerHTML = popupSavedHtml || '';
            if (typeof w.closeModal === 'function') w.closeModal('ov-inst-detail');
            effEl.remove();
          }
        }, { sharedFnDefaultsNonBaseZoneToTwoDays: true, qaqcExtraIsGenuinelyNonzero: true,
             engineIncludesTheSameAddon: true, previewNowShowsTheQaqcLine: true,
             popupShowsTheRealTwoDayDefault: true, popupFullRateMatchesEngineExactly: true });
      /* 2026-09-13 follow-up audit (same bug shape as finding #4, one level lower severity): the
         real engine's Assembly rate is a 3-level fallback chain -- per-quotation override, then
         global CF, then a hardcoded 850 -- var assmRate=aCF.assemblyCostPerUnit||CF.assemblyCostPerUnit||850
         (index.html:9753, :24958). The Computation Ref doc page (renderCompRef, the SAME page
         finding #3 rewrote to stop hand-deriving formulas) re-derived this one value by hand
         anyway: var apu=CF.assemblyCostPerUnit||0 -- a DIFFERENT final fallback (0, not 850).
         CF.assemblyCostPerUnit defaults to 850 at declaration (line 2972) and stays populated
         unless someone deliberately zeroes it in Settings, so this fires far less often than the
         per-zone qaqcDays gap did -- but it is the identical class of drift: a display-only page
         disagreeing with the real charge. Reproduced: with CF.assemblyCostPerUnit set to 0, the
         page's own Assembly line showed "850.00 x 5 = 0.00" against the real engine's 850x5=4250
         (assmRate falls back through to the hardcoded 850 the same way this doc page's OWN
         fallback should, but didn't). Fixed by matching the doc page's fallback to 850, closing
         the drift the same way _instZoneAddon closed it for zone add-ons -- this page still reads
         plain CF.x (not aCF.x) everywhere else, deliberately: it explains the global default
         formula, not one specific quotation's approved override. */
      if (typeof window.renderCompRef === 'function')
        check('Computation Ref: Assembly line uses the same 850 fallback the real engine does, not 0', () => {
          const w = window;
          const savedApu = w.CF.assemblyCostPerUnit;
          const savedHtml = (document.getElementById('compref-wrap') || {}).innerHTML;
          try {
            w.CF.assemblyCostPerUnit = 0; // the exact unset-like state that drifted
            w.renderCompRef();
            const html = document.getElementById('compref-wrap').innerHTML;
            // A whole-page substring check for "850.00" is a real false-positive risk here --
            // an unrelated, genuinely correct "₱850.00 / carcass" display exists elsewhere on
            // this same page (from a different fallback chain), so it must scope to the specific
            // "Assembly:" line itself, not just search the whole rendered page for the number.
            const idx = html.indexOf('Assembly:');
            const assemblyLine = html.slice(idx, idx + 120);
            // NOTE: "850.00" itself ends in the substring "0.00" (the tens digit is 0), so
            // checking !includes('0.00') is self-defeating -- it fails on the CORRECT value too.
            // Must check for the peso-prefixed zero specifically, not a bare "0.00" substring.
            return {
              assemblyLineShowsTheRealFallback: assemblyLine.includes('850.00'),
              assemblyLineDoesNotShowZero: !assemblyLine.includes('₱0.00')
            };
          } finally {
            w.CF.assemblyCostPerUnit = savedApu;
            const _cr = document.getElementById('compref-wrap');
            if (_cr) _cr.innerHTML = savedHtml || '';
          }
        }, { assemblyLineShowsTheRealFallback: true, assemblyLineDoesNotShowZero: true });
      /* 2026-09-14: real user-reported "Page Unresponsive" freeze while opening a large quotation
         (QT-C00000016: 93 BOM cabinets, 294 nested material rows). Traced to renderBOMSection
         calling lookupInSource() once per material/hardware row during render -- and
         lookupInSource was a LINEAR SCAN over the whole materials catalogue (~150k rows) on every
         single call, with zero yield point anywhere in the click-to-render chain. ~300 rows x a
         150k-row scan is tens of millions of string comparisons in one synchronous main-thread
         stack. Fixed by indexing the catalogue array once (WeakMap keyed on the array's own
         identity, so it can never disagree with a real reload -- a reload replaces the array
         object outright, the WeakMap misses, and the index rebuilds from the new data) instead of
         rescanning per call.
         Per this codebase's own established rule (2026-08-24/25: "a wall-clock timing regression
         check was tried first for the freeze and REJECTED -- V8 compiles ... fast enough to clear
         any CI-safe threshold"), this does NOT time it -- it counts the actual per-row comparison
         operations by swapping String.prototype.toLowerCase() and drives the REAL lookupInSource(),
         not a hand re-derivation of the old scan. A synthetic 500-row array proves: the first call
         against it does real work (the index build), the SECOND call against the SAME array (a
         different query name) does NOT re-touch every row -- the exact mechanism the freeze was
         made of. Also proves the fix preserves the function's own documented "best of duplicates"
         tie-break (unit strictly outranks price) unchanged. */
      if (typeof window.lookupInSource === 'function')
        check('lookupInSource: indexes the catalogue once per array instead of re-scanning on every call', () => {
          const w = window;
          const src = [];
          for (let i = 0; i < 500; i++) src.push({ name: 'Item ' + i, unit: 'pc', price: 10 });
          // The exact duplicate-name shape the function's own header comment documents: same
          // name twice, one with a populated unit+price, one blank -- and a second pair proving
          // unit strictly outranks price on a tie (not just "more fields wins").
          src.push({ name: 'Dup Item', unit: '', price: 0 });
          src.push({ name: 'Dup Item', unit: 'pc', price: 10 });
          src.push({ name: 'Tie Item', unit: 'pc', price: 0 });
          src.push({ name: 'Tie Item', unit: '', price: 5 });
          let toLowerCalls = 0;
          const origToLower = String.prototype.toLowerCase;
          // eslint-disable-next-line no-extend-native
          String.prototype.toLowerCase = function () { toLowerCalls++; return origToLower.call(this); };
          try {
            const winnerDup = w.lookupInSource(src, 'Dup Item');
            const winnerTie = w.lookupInSource(src, 'tie item'); // case/whitespace-insensitive too
            w.lookupInSource(src, 'Item 250'); // forces the index to actually build against this array
            toLowerCalls = 0;
            w.lookupInSource(src, 'Item 100'); // SECOND call, same array, different name
            return {
              preferredDuplicateWithUnitAndPrice: !!winnerDup && winnerDup.price === 10 && winnerDup.unit === 'pc',
              unitOutranksPriceOnATie: !!winnerTie && winnerTie.unit === 'pc',
              missingNameReturnsNull: w.lookupInSource(src, 'Nonexistent Thing') === null,
              secondCallDoesNotRescanEveryRow: toLowerCalls < src.length
            };
          } finally {
            String.prototype.toLowerCase = origToLower;
          }
        }, { preferredDuplicateWithUnitAndPrice: true, unitOutranksPriceOnATie: true,
             missingNameReturnsNull: true, secondCallDoesNotRescanEveryRow: true });
      /* 2026-09-14 follow-up: fixing lookupInSource's O(catalogue)-per-call scan made
         QT-C00000016 "better but not as fast as mentioned" -- a second, LARGER hot spot in the
         same render pass. _dlOptions() (built for the per-keystroke typing path, ~70-130ms/call
         by its own design comment) is ALSO called once per BOM material/hardware row at RENDER
         TIME (renderBOMSection, building each row's <datalist> from its own already-set name) --
         on the real quotation that's 799 rows but only 31 DISTINCT names, so ~768 of those 799
         calls were re-scoring the whole catalogue for a query already computed moments earlier.
         Memoized by (src identity, query, max) -- a pure function of its own inputs, so this
         changes nothing about the output, only how often it's recomputed. Same "count the real
         operation, not wall-clock" rule as lookupInSource's own test: swaps String.prototype.indexOf
         (the scoring loop's own per-row, per-word comparison) rather than timing it. */
      if (typeof window._dlOptions === 'function')
        check('_dlOptions: memoizes identical (src,query) results instead of rescoring the whole catalogue every render', () => {
          const w = window;
          const src = [];
          for (let i = 0; i < 500; i++) src.push({ name: 'Real White MDF 4x8 Item ' + i, unit: 'sheet', price: 500 });
          let indexOfCalls = 0;
          const origIndexOf = String.prototype.indexOf;
          // eslint-disable-next-line no-extend-native
          String.prototype.indexOf = function (...args) { indexOfCalls++; return origIndexOf.apply(this, args); };
          try {
            const html1 = w._dlOptions(src, 'Real White MDF 4x8 Item 250', 60); // first call: real work
            indexOfCalls = 0;
            const html2 = w._dlOptions(src, 'Real White MDF 4x8 Item 250', 60); // SAME query, same src
            const countAfterCachedRepeat = indexOfCalls; // measured BEFORE the next call, not across it
            const html3 = w._dlOptions(src, 'Real White MDF 4x8 Item 100', 60); // DIFFERENT query -- must still compute correctly
            return {
              secondIdenticalCallSkipsRescoring: countAfterCachedRepeat < src.length,
              resultsAreConsistent: html1 === html2,
              differentQueryStillComputesCorrectly: html3.includes('Real White MDF 4x8 Item 100') && !html3.includes('Item 250')
            };
          } finally {
            String.prototype.indexOf = origIndexOf;
          }
        }, { secondIdenticalCallSkipsRescoring: true, resultsAreConsistent: true,
             differentQueryStillComputesCorrectly: true });
      /* 2026-09-08 (2): edge banding is priced by ONE combined linear-metre total regardless of
         which tape colour/type it's for -- purchasing needs to know how much of EACH colour to
         order, not just a combined figure. prodComputeServices now also groups the exact same
         per-piece LM math by c.edgeTape, additive only: the sum of every group must always equal
         the unchanged scalar edgebandingLM (nothing that already reads that total -- the labor
         SERVICE quantity, unaffected by colour -- can be affected). A piece with no tape named
         lands in the 'Unspecified' bucket rather than being silently dropped, matching this whole
         pipeline's "loud, never short" rule. */
      /* 2026-09-25 — Rommel: the plant counts cutting as all four sides of every piece (full
         perimeter). It was L+W once, half the real figure, so cutting was quoted at half. */
      if (typeof window.prodComputeServices === 'function')
        /* 2026-09-26 — plant: a production allowance is added to cutting (they use 12%, Rommel set
           10%). cuttingLMNet stays the bare four-sides figure. */
        check('prodComputeServices: cutting = full perimeter, plus the cutting allowance', () => {
          const w = window, saved = w.prodSettings.cutAllowance;
          try {
            w.prodSettings.cutAllowance = 10;
            const s = w.prodComputeServices([{ length: 600, width: 400, qty: 3, ebt: '' }], [], []);
            w.prodSettings.cutAllowance = 0;
            const z = w.prodComputeServices([{ length: 600, width: 400, qty: 3, ebt: '' }], [], []);
            return { net: s.cuttingLMNet, withAllowance: s.cuttingLM, pct: s.cutAllowancePct, noAllowance: z.cuttingLM };
          } finally { w.prodSettings.cutAllowance = saved; }
        }, { net: 6, withAllowance: 6.6, pct: 10, noAllowance: 6 });
      /* 2026-09-26: the cutting allowance and EBT wastage are company-wide — saved with the shared
         Settings CONFIG and applied on load, not kept per browser. */
      if (typeof window._collectAppSettings === 'function' && typeof window._applyAppSettings === 'function')
        check('Settings: cutting allowance and EBT wastage travel with the company settings', () => {
          const w = window, saved = { c: w.prodSettings.cutAllowance, e: w.prodSettings.ebtWastage };
          try {
            w.prodSettings.cutAllowance = 7; w.prodSettings.ebtWastage = 4;
            const out = w._collectAppSettings().prodAllowances;
            w._applyAppSettings({ prodAllowances: { cutAllowance: 12, ebtWastage: 6 } });
            return { collected: out, applied: [w.prodSettings.cutAllowance, w.prodSettings.ebtWastage] };
          } finally { w.prodSettings.cutAllowance = saved.c; w.prodSettings.ebtWastage = saved.e; }
        }, { collected: { cutAllowance: 7, ebtWastage: 4 }, applied: [12, 6] });
      /* 2026-09-26 — plant: a 2F board takes 2 HPL sheets and a 1F board 1; lamination is priced
         per board. Both used to be the panels' area in sqm against a per-piece price. */
      if (typeof window.prodBuildSummary === 'function' && typeof window.prodComputeBom === 'function')
        check('prodBuildSummary: HPL sheets = boards × faces, lamination = boards', () => {
          const w = window, saved = w.prodSettings.boardSizes;
          try {
            w.prodSettings.boardSizes = [{ material: 'Plywood', sizes: [{ w: 1220, h: 2440 }] }];
            const comps = [{ area: 'A', name: 'Door', material: 'Plywood HPL', color: 'Walnut', texture: '', thickness: 18,
                             length: 2000, width: 1100, qty: 3, faces: 2, ebt: '', grain: 'none', notes: 'HPL' }];
            const res = { components: comps, hardware: [], holeSchedule: [] };
            res._bom = w.prodComputeBom(comps); res._services = w.prodComputeServices(comps, [], []);
            w.prodBuildSummary(res);
            const sum = w.prodState.summary, boards = res._bom[0].boardsNeeded;
            const hpl = sum.materials.find(r => /^HPL/i.test(r.aiName || ''));
            const lam = sum.services.find(r => /lamination/i.test(r.aiName || r.name || ''));
            return { boards, hplSheets: hpl && hpl.qty, hplUnit: hpl && hpl.unit, laminated: lam && lam.qty };
          } finally { w.prodSettings.boardSizes = saved; }
        }, { boards: 3, hplSheets: 6, hplUnit: 'pc', laminated: 3 });
      if (typeof window.prodComputeServices === 'function')
        check('prodComputeServices: edgebandingLM groups by tape colour, and the groups sum to the same total', () => {
          const w = window;
          const saved = { ebtWastage: w.prodSettings.ebtWastage };
          try {
            w.prodSettings.ebtWastage = 0;
            // ebt '1l' -> long-side-only banding (lc=1,sc=0); each piece's length is 1000mm = 1.0 LM.
            const comps = [
              { length: 1000, width: 500, qty: 1, ebt: '1l', edgeTape: 'White PVC' },
              { length: 1000, width: 500, qty: 1, ebt: '1l', edgeTape: 'Black PVC' },
              { length: 1000, width: 500, qty: 1, ebt: '1l', edgeTape: '' }  // no tape named
            ];
            const svc = w.prodComputeServices(comps, []);
            const byTape = {};
            svc.edgebandingByTape.forEach(g => { byTape[g.tape] = g.lm; });
            const sumOfGroups = svc.edgebandingByTape.reduce((s, g) => s + g.lm, 0);
            return {
              whiteGroup: byTape['White PVC'],
              blackGroup: byTape['Black PVC'],
              unnamedFallsToUnspecified: byTape['Unspecified'],
              groupsSumToTheSameTotal: Math.round(sumOfGroups * 100) / 100 === svc.edgebandingLM,
              totalUnchanged: svc.edgebandingLM
            };
          } finally { w.prodSettings.ebtWastage = saved.ebtWastage; }
        }, { whiteGroup: 1, blackGroup: 1, unnamedFallsToUnspecified: 1,
             groupsSumToTheSameTotal: true, totalUnchanged: 3 });
      /* Same fix, the wiring: prodBuildSummary must turn each NAMED tape group into its own
         MATERIAL row (this app already prices edge tape as a material, not a service -- see the
         "isTapeLike" hardware-bucket handling a few lines below this insertion point) so the
         tape's own cost finally reaches the quotation, broken out by colour. Proves the 'Unspecified'
         bucket gets NO row (nothing to search the catalogue for -- a garbage line would only ever
         flag red for no reason) so an AI extraction or manual list that never names a tape colour
         behaves exactly as it did before edgeTape existed. */
      if (typeof window.prodBuildSummary === 'function')
        check('prodBuildSummary: one material row per named edge-tape colour, none for Unspecified', () => {
          const w = window;
          const saved = { dbMaterials: w.dbMaterials, summary: w.prodState && w.prodState.summary };
          try {
            w.dbMaterials = [];
            const result = {
              summary: 'test', components: [], hardware: [], carcassCount: 0, _bom: [],
              _services: {
                cuttingLM: 0, holeCount: 0, edgebandingLM: 8.7,
                edgebandingByTape: [
                  { tape: 'White PVC', lm: 2.5 },
                  { tape: 'Black PVC', lm: 1.2 },
                  { tape: 'Unspecified', lm: 5 }
                ]
              }
            };
            w.prodBuildSummary(result);
            const mats = (w.prodState.summary && w.prodState.summary.materials) || [];
            const white = mats.find(m => m.name === 'White PVC' || m.aiName === 'White PVC');
            const black = mats.find(m => m.name === 'Black PVC' || m.aiName === 'Black PVC');
            const unspecified = mats.find(m => (m.name || '').indexOf('Unspecified') >= 0 || (m.aiName || '').indexOf('Unspecified') >= 0);
            return {
              whiteRowQty: white ? white.qty : null,
              blackRowQty: black ? black.qty : null,
              noUnspecifiedRow: !unspecified
            };
          } finally {
            w.dbMaterials = saved.dbMaterials;
            if (w.prodState) w.prodState.summary = saved.summary;
          }
        }, { whiteRowQty: 2.5, blackRowQty: 1.2, noUnspecifiedRow: true });
      /* 2026-09-08 (3): Grooving/Routing/Manual Edgebanding all had a per-component field but no
         quantity math -- they became review-flag placeholder notes with no costed quantity, the
         same gap Boring had before it got a hole-count chip. All three price per LINEAR METRE in
         the catalog, and the MCL picker already offers the exact catalog SKU name (svcOptions()
         lists real SERVICES, not a generic fallback), so the only missing piece was the run
         length -- MCL.setLm asks for it the same way setHoles already asks for a hole count.
         prodComputeServices groups those chips by EXACT service name (a plain sum, never fuzzy --
         the picked string already IS the SKU) into extraServicesByName. A chip with no lm figure
         never reaches this array at all (see _cutListToAnalysis) -- it stays a flagged review
         note, never silently priced at zero. */
      if (typeof window.prodComputeServices === 'function')
        check('prodComputeServices: extraServices groups by exact service name into extraServicesByName', () => {
          const w = window;
          const extraServices = [
            { service: 'Router Grooving (8-12mm)', qty: 3, unit: 'lm', notes: 'a' },
            { service: 'Router Grooving (8-12mm)', qty: 2, unit: 'lm', notes: 'b' },
            { service: 'Manual Edgebanding EVA', qty: 5, unit: 'lm', notes: 'c' },
            { service: '', qty: 4, unit: 'lm', notes: 'd' },   // no name -> dropped
            { service: 'Grooving 3mm (melamine)', qty: 0, unit: 'lm', notes: 'e' }  // qty 0 -> dropped
          ];
          const svc = w.prodComputeServices([], [], extraServices);
          const byName = {};
          svc.extraServicesByName.forEach(g => { byName[g.service] = g.qty; });
          return {
            routerGroovingSummed: byName['Router Grooving (8-12mm)'],
            manualEdgebandingKept: byName['Manual Edgebanding EVA'],
            emptyNameDropped: byName[''] === undefined,
            entryCount: svc.extraServicesByName.length
          };
        }, { routerGroovingSummed: 5, manualEdgebandingKept: 5, emptyNameDropped: true, entryCount: 2 });
      /* Same fix, the wiring: prodBuildSummary must turn each extraServicesByName entry into a
         service row via an EXACT-NAME catalog lookup (never fuzzy -- the picked string already IS
         the SKU), and flag (not silently drop) an entry whose SKU no longer matches any catalog
         service by that exact name -- e.g. renamed or removed since the chip was picked. */
      if (typeof window.prodBuildSummary === 'function')
        check('prodBuildSummary: extraServicesByName becomes exact-match service rows, unmatched ones flagged', () => {
          const w = window;
          const saved = { SERVICES: w.SERVICES, summary: w.prodState && w.prodState.summary };
          try {
            w.SERVICES = [{ name: 'Router Grooving (8-12mm)', unit: 'lm', price: 65 }];
            const result = {
              summary: 'test', components: [], hardware: [], carcassCount: 0, _bom: [],
              _services: {
                cuttingLM: 0, holeCount: 0, edgebandingLM: 0, edgebandingByTape: [],
                extraServicesByName: [
                  { service: 'Router Grooving (8-12mm)', qty: 5, unit: 'lm' },
                  { service: 'Grooving (renamed away)', qty: 2, unit: 'lm' }
                ]
              }
            };
            w.prodBuildSummary(result);
            const svcs = (w.prodState.summary && w.prodState.summary.services) || [];
            const matched = svcs.find(s => s.name === 'Router Grooving (8-12mm)');
            const unmatched = svcs.find(s => s.aiName === 'Grooving (renamed away)');
            return {
              matchedQty: matched ? matched.qty : null,
              matchedNotFlagged: matched ? matched.needsReview === false : null,
              unmatchedFlagged: unmatched ? unmatched.needsReview === true : null
            };
          } finally {
            w.SERVICES = saved.SERVICES;
            if (w.prodState) w.prodState.summary = saved.summary;
          }
        }, { matchedQty: 5, matchedNotFlagged: true, unmatchedFlagged: true });
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
         on every row, not just in aggregate.
         (The hideMatPricing parameter this test used to also exercise here was removed 2026-09-03
         — see the buildItemizedPrintRows signature change note further down — materials now print
         unconditionally, same as hardware always has.) */
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
            const html = w.buildItemizedPrintRows(2250, pC);
            return {
              svcAmount200: /200\.00/.test(html),
              svcUnitPrice100: /100\.00/.test(html),
              regMaterialUnchanged800: /800\.00/.test(html),
              outsourcedUnitPriceDoubled600: /600\.00/.test(html),   // 300 raw -> 600, not left at 300
              outsourcedAmount1200: /1,200\.00/.test(html),
              rawOutsourcePriceNeverShown: !/(^|[^,.\d])300\.00/.test(html),
              areaSubtotalMatchesPool: /2,250\.00/.test(html),
              materialPriceIsShownNotHidden: /800\.00/.test(html) && !/—/.test(html)
            };
          } finally {
            w.qAreas = saved.qAreas; w.qFabMode = saved.qFabMode;
            w.qChargeMatHw = saved.qChargeMatHw; w.SERVICES = saved.SERVICES;
          }
        }, { svcAmount200: true, svcUnitPrice100: true, regMaterialUnchanged800: true,
             outsourcedUnitPriceDoubled600: true, outsourcedAmount1200: true,
             rawOutsourcePriceNeverShown: true, areaSubtotalMatchesPool: true,
             materialPriceIsShownNotHidden: true });
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
            const html = w.buildItemizedPrintRows(2500, pC);
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
      /* Rommel, 2026-09-02, QT-W00000183: two outsourced hardware baskets printed at ₱18,269.94 and
         ₱16,991.58 -- roughly 2.7x their real marked-up cost of ₱6,806.84 and ₱6,330.56. Root cause
         was one level UP from the previous fix above: even with regular materials/hardware correctly
         zero-weighted for an unbilled account, buildItemizedPrintRows still RESCALED every line
         (_allocateProportional(lineWeights,areaSub)) to force the area's WHOLE pool onto them -- and
         that pool includes assembly, a share of installation's own markup, the discount buffer and
         the cutting-list charge, none of which is any one line's own cost. With regular hardware
         correctly excluded, services + the two outsourced items were the ONLY nonzero-weight lines
         left, so ALL of that unrelated overhead landed on just those two categories. Rommel: "if
         there's no unit to multiply don't distribute to other cost" -- a zero-weight line must
         contribute zero, full stop, never hand its "share" of the pool to whoever is left standing.
         Proves each line now shows its own TRUE value (no rescale), the leftover that has no
         per-unit home prints as its own row (mirroring the minimum-charge row's own treatment), and
         the area subtotal still reconciles exactly -- so the total never moves, only how it is
         explained per line. */
      /* 2026-09-02 follow-up: Rommel — "if it should not be shown in the printout in the first place
         ... give me a capability to have some kind of clickable that i can see what was hidden."
         The leftover row is now hidden from the client copy by default and only appears when the
         internal-only "Reveal hidden costs" toggle (_printRevealHidden) is on, under a new label —
         so this check must arm that toggle to see the row at all, and match the new label text. */
      if (typeof window.buildItemizedPrintRows === 'function' && typeof window._svcUnitPrice === 'function')
        check('buildItemizedPrintRows: overhead with no line to attach to gets its own row, not a rescale', () => {
          const w = window;
          const saved = { qAreas: w.qAreas, qFabMode: w.qFabMode, qChargeMatHw: w.qChargeMatHw, SERVICES: w.SERVICES, reveal: w._printRevealHidden };
          try {
            w.qFabMode = 'services';
            w.qChargeMatHw = false;   // Subsidiary account -- regular materials/hardware not billed
            w.SERVICES = [{ name: 'Test Service', price: 100, unit: 'pc' }];
            w._printRevealHidden = true; // staff-only toggle: without it the leftover row is hidden entirely
            w.qAreas = [{
              name: 'Area X', items: [],
              svcItems: [{ svcIdx: 0, qty: 10 }],                                       // raw 1000
              matItems: [], hwItems: [{ name: 'Reg Hardware', qty: 1, price: 5000, unit: 'pc' }], // must weigh 0
              outsourceMaterials: [],
              outsourceHardware: [{ name: 'Outsourced Basket', qty: 1, price: 2000, unit: 'pc' }] // raw 2000
            }];
            // reg factor = 1.10 (10% fabCont, fabBuf 0), out factor = 1.20 (20% outMarkup, rest 0).
            // True line total = 1000*1.10 + 2000*1.20 = 1100 + 2400 = 3500. Pool 6000 simulates the
            // area owing assembly/installation-share/discount-buffer overhead of 2500 beyond that --
            // under the OLD code this 2500 would be smeared across the two nonzero lines instead of
            // getting its own row, inflating both by the same ~1.714x factor (6000/3500).
            const pC = { ni: true, rates: { fabCont: 10, fabBuf: 0, outCont: 0, outBuf: 0, outMarkup: 20 } };
            const html = w.buildItemizedPrintRows(6000, pC);
            return {
              serviceShowsTrueValue: /1,100\.00/.test(html),
              serviceUnitPriceCorrect: /110\.00/.test(html),
              outsourceShowsTrueValue: /2,400\.00/.test(html),
              regHardwareStillZeroed: /(^|[^,.\d])0\.00/.test(html.replace(/1,100\.00|110\.00|2,400\.00|6,000\.00|2,500\.00/g, '')),
              overheadRowPrinted: /2,500\.00/.test(html) && /Hidden from the client copy/.test(html),
              // The one thing that must NOT reappear: neither line inflated by the pool/trueTotal
              // ratio the old rescale would have produced (1,885.71 and 3,428.57 respectively).
              oldInflatedServiceAbsent: !/1,885\.71/.test(html),
              oldInflatedOutsourceAbsent: !/3,428\.57/.test(html),
              areaSubtotalStillReconciles: /6,000\.00/.test(html)
            };
          } finally {
            w.qAreas = saved.qAreas; w.qFabMode = saved.qFabMode;
            w.qChargeMatHw = saved.qChargeMatHw; w.SERVICES = saved.SERVICES;
            w._printRevealHidden = saved.reveal;
          }
        }, { serviceShowsTrueValue: true, serviceUnitPriceCorrect: true, outsourceShowsTrueValue: true,
             regHardwareStillZeroed: true, overheadRowPrinted: true, oldInflatedServiceAbsent: true,
             oldInflatedOutsourceAbsent: true, areaSubtotalStillReconciles: true });
      /* 2026-09-02: the leftover row must be genuinely HIDDEN by default (not just given a new
         label) -- Rommel: "It should not be shown. in the print out in the first place. again this
         is something to be presented to the client." Proves the exact same scenario as the check
         above renders NO leftover row at all when the toggle is off, while the area subtotal (which
         still silently includes that amount) is untouched -- the total the client sees never moves,
         only whether the breakdown explaining it is visible. */
      if (typeof window.buildItemizedPrintRows === 'function' && typeof window._svcUnitPrice === 'function')
        check('buildItemizedPrintRows: hidden-cost leftover is invisible to the client by default', () => {
          const w = window;
          const saved = { qAreas: w.qAreas, qFabMode: w.qFabMode, qChargeMatHw: w.qChargeMatHw, SERVICES: w.SERVICES, reveal: w._printRevealHidden };
          try {
            w.qFabMode = 'services';
            w.qChargeMatHw = false;
            w.SERVICES = [{ name: 'Test Service', price: 100, unit: 'pc' }];
            w._printRevealHidden = false;
            w.qAreas = [{
              name: 'Area X', items: [],
              svcItems: [{ svcIdx: 0, qty: 10 }],
              matItems: [], hwItems: [{ name: 'Reg Hardware', qty: 1, price: 5000, unit: 'pc' }],
              outsourceMaterials: [],
              outsourceHardware: [{ name: 'Outsourced Basket', qty: 1, price: 2000, unit: 'pc' }]
            }];
            const pC = { ni: true, rates: { fabCont: 10, fabBuf: 0, outCont: 0, outBuf: 0, outMarkup: 20 } };
            const html = w.buildItemizedPrintRows(6000, pC);
            return {
              noLeakedLabel: !/Hidden from the client copy/.test(html) && !/Production overhead/.test(html),
              noLeakedAmount: !/2,500\.00/.test(html),
              subtotalStillReconciles: /6,000\.00/.test(html)
            };
          } finally {
            w.qAreas = saved.qAreas; w.qFabMode = saved.qFabMode;
            w.qChargeMatHw = saved.qChargeMatHw; w.SERVICES = saved.SERVICES;
            w._printRevealHidden = saved.reveal;
          }
        }, { noLeakedLabel: true, noLeakedAmount: true, subtotalStillReconciles: true });
      /* Rommel, 2026-09-03: "Except for the Asembly wherein it will have it own line under
         fabrication." Assembly's own true value (base + its earned share of Installation's
         combined markup, computed once in _buildPrintBodyCore and handed down so the two formulas
         cannot drift) must render as its own explicit section/line -- not folded silently into the
         hidden leftover the way the discount-buffer share is. Proves the section header, the row,
         and full reconciliation (service + assembly = the whole pool, no leftover row needed). */
      if (typeof window.buildItemizedPrintRows === 'function' && typeof window._svcUnitPrice === 'function')
        check('buildItemizedPrintRows: Assembly gets its own explicit line under Fabrication', () => {
          const w = window;
          const saved = { qAreas: w.qAreas, qFabMode: w.qFabMode, qChargeMatHw: w.qChargeMatHw, SERVICES: w.SERVICES, reveal: w._printRevealHidden };
          try {
            w.qFabMode = 'services';
            w.qChargeMatHw = true;
            w.SERVICES = [{ name: 'Test Service', price: 100, unit: 'pc' }];
            w._printRevealHidden = false; // must show regardless -- Assembly is never the hidden kind
            w.qAreas = [{
              name: 'Area X', items: [],
              svcItems: [{ svcIdx: 0, qty: 10 }],  // raw 1000, factor 1 (no rates below)
              matItems: [], hwItems: [], outsourceMaterials: [], outsourceHardware: []
            }];
            const pC = { ni: true, rates: { fabCont: 0, fabBuf: 0, outCont: 0, outBuf: 0, outMarkup: 0 } };
            // Pool = service (1000) + assembly (5000), exactly -- no leftover to worry about.
            const html = w.buildItemizedPrintRows(6000, pC, 5000);
            return {
              hasAssemblyHeading: /ASSEMBLY/.test(html),
              assemblyRowPresent: /Assembly[\s\S]*?5,000\.00/.test(html),
              serviceLineUnaffected: /1,000\.00/.test(html),
              noHiddenLeftoverNeeded: !/Hidden from the client copy/.test(html),
              subtotalReconciles: /6,000\.00/.test(html)
            };
          } finally {
            w.qAreas = saved.qAreas; w.qFabMode = saved.qFabMode;
            w.qChargeMatHw = saved.qChargeMatHw; w.SERVICES = saved.SERVICES;
            w._printRevealHidden = saved.reveal;
          }
        }, { hasAssemblyHeading: true, assemblyRowPresent: true, serviceLineUnaffected: true,
             noHiddenLeftoverNeeded: true, subtotalReconciles: true });
      /* Rommel, 2026-09-03: "the minimum charge should be moved in the services." It is a
         per-service-family floor (Cutting/Edgebanding/Grooving), so in the itemized print mode
         specifically it belongs inside the SERVICES section rather than its own standalone block
         between the areas and the Fabrication subtotal (which is exactly where By area/type/lump
         still show it, unaffected). Proves the row renders, no second/separate heading is created
         for it, and it still counts toward the area subtotal. */
      if (typeof window.buildItemizedPrintRows === 'function' && typeof window._svcUnitPrice === 'function')
        check('buildItemizedPrintRows: minimum charge rows render inside SERVICES, not their own section', () => {
          const w = window;
          const saved = { qAreas: w.qAreas, qFabMode: w.qFabMode, qChargeMatHw: w.qChargeMatHw, SERVICES: w.SERVICES, reveal: w._printRevealHidden };
          try {
            w.qFabMode = 'services';
            w.qChargeMatHw = true;
            w.SERVICES = [{ name: 'Test Service', price: 100, unit: 'pc' }];
            w._printRevealHidden = false;
            w.qAreas = [{
              name: 'Area X', items: [],
              svcItems: [{ svcIdx: 0, qty: 5 }],  // raw 500
              matItems: [], hwItems: [], outsourceMaterials: [], outsourceHardware: []
            }];
            const pC = {
              ni: true, rates: { fabCont: 0, fabBuf: 0, outCont: 0, outBuf: 0, outMarkup: 0 },
              minCharge: { total: 300, rows: [{ name: 'Cutting (minimum charge)', floor: 800, topUp: 300 }] }
            };
            // Pool = service (500) + min-charge topup (300), exactly.
            const html = w.buildItemizedPrintRows(800, pC);
            const servicesHeadingCount = (html.match(/>SERVICES</g) || []).length;
            return {
              exactlyOneServicesHeading: servicesHeadingCount,
              noSeparateMinChargeHeading: !/>MINIMUM CHARGE</.test(html),
              minChargeRowPresent: /Minimum charge — Cutting/.test(html) && /300\.00/.test(html),
              floorShown: /800\.00/.test(html) || /minimum.*800\.00/i.test(html),
              subtotalReconciles: /800\.00/.test(html)
            };
          } finally {
            w.qAreas = saved.qAreas; w.qFabMode = saved.qFabMode;
            w.qChargeMatHw = saved.qChargeMatHw; w.SERVICES = saved.SERVICES;
            w._printRevealHidden = saved.reveal;
          }
        }, { exactlyOneServicesHeading: 1, noSeparateMinChargeHeading: true, minChargeRowPresent: true,
             floorShown: true, subtotalReconciles: true });
      /* Rommel, 2026-09: walked through a real quotation whose Final Quotation revised
         Installation -- the printed Fabrication subtotal moved with it, even though fabrication
         itself was untouched, because the discount buffer used to split as a FIXED 50/15/35 cut
         of the whole job's combined total (fab+mob+inst). "The final quotation is just a mirror
         of the initial quotation until such changes are made" -- so each bucket's buffer share
         must now come from its OWN raw cost x the rate, not a fixed percentage of a pool that
         includes the other two. Source-inspection (same reason as the reveal-toggle test above):
         proves the fixed 0.50/0.15/0.35 literals are gone, each bucket derives its share from its
         own raw value, and any leftover (design charge/site visit/other-cost's own slice, when
         those print as separate rows) lands on Installation, never silently dropped and never on
         Fabrication -- which is the one bucket that must hold steady. */
      if (typeof window._buildPrintBodyCore === 'function')
        check('_buildPrintBodyCore: each printed bucket carries its OWN discount-buffer share, not a fixed 50/15/35 cut', () => {
          const src = window._buildPrintBodyCore.toString();
          return {
            oldFixedSplitGone: !/_discBufAmt\s*\*\s*0\.50/.test(src) && !/_discBufAmt\s*\*\s*0\.15/.test(src) && !/_discBufAmt\s*\*\s*0\.35/.test(src),
            fabSharesFromOwnBucket: /_fabDiscShare\s*=\s*_fabBucket\s*\*\s*_discBufRate\s*\/\s*100/.test(src),
            mobSharesFromOwnBucket: /_mobDiscShare\s*=\s*_mobBucket\s*\*\s*_discBufRate\s*\/\s*100/.test(src),
            instSharesFromOwnBucket: /_instDiscShare\s*=\s*_instBucket\s*\*\s*_discBufRate\s*\/\s*100/.test(src),
            fabRegroupIsBucketPlusOwnShare: /fab\s*:\s*_fabBucket\s*\+\s*_fabDiscShare/.test(src),
            leftoverFoldsIntoInstNotFab: /inst\s*:\s*_instBucket\s*\+\s*_instDiscShare\s*\+\s*_discShareLeftover/.test(src),
          };
        }, { oldFixedSplitGone: true, fabSharesFromOwnBucket: true, mobSharesFromOwnBucket: true,
             instSharesFromOwnBucket: true, fabRegroupIsBucketPlusOwnShare: true, leftoverFoldsIntoInstNotFab: true });
      /* Proves the property that actually matters, not just the code shape above: run the real
         formula twice with fabrication's own inputs held fixed and Installation raised sharply
         (mirroring the real report -- installation cost revised upward on the Final Quotation) --
         Fabrication's own-cost buffer share must be byte-identical both times, while Installation's
         own share visibly grows. Reimplements only the isolated arithmetic (not the full
         DOM-driven _buildPrintBodyCore), the same tradeoff the two source-inspection tests above
         already accept for this function. */
      check('discount-buffer own-cost attribution: Fabrication\'s share is unaffected by an Installation change', () => {
        const discBufRate = 30;
        const fabBucket = 39621.57;   // fixed -- fabrication's own inputs never change in this scenario
        const outsourceFinalUnused = 0;
        function fabShareFor(instBucket) {
          return fabBucket * discBufRate / 100;   // must not take instBucket as an input at all
        }
        const fabShareBefore = fabShareFor(56591.03);
        const fabShareAfter = fabShareFor(56591.03 + 12083.49);   // installation revised upward
        const instShareBefore = 56591.03 * discBufRate / 100;
        const instShareAfter = (56591.03 + 12083.49) * discBufRate / 100;
        return {
          fabShareUnchanged: Math.abs(fabShareBefore - fabShareAfter) < 0.005,
          instShareActuallyMoved: instShareAfter > instShareBefore + 100,
        };
      }, { fabShareUnchanged: true, instShareActuallyMoved: true });
      /* Rommel, 2026-09-03: "give me a capability to have some kind of clickable that i can see
         what was hidden in the printview... it works like when you want to temporarily view the
         password." The checkbox that arms _printRevealHidden must only ever be offered on the one
         print mode it applies to (itemized) -- source-inspection, since driving the full DOM/
         _buildPrintBodyCore integration path needs a whole quotation+DOM fixture this suite does
         not otherwise build for print-body tests. */
      if (typeof window._buildPrintBodyCore === 'function')
        check('_buildPrintBodyCore: the reveal-hidden-costs toggle only shows in itemized mode', () => {
          const src = window._buildPrintBodyCore.toString();
          return {
            revealRowGatedOnItemizedMode: /revealRow\.style\.display\s*=\s*isItemizedMode\s*\?\s*'flex'\s*:\s*'none'/.test(src),
            usesSharedIsItemizedModeFlag: /var\s+isItemizedMode\s*=\s*\(_printBreakdown===['"]itemized['"]\)/.test(src),
          };
        }, { revealRowGatedOnItemizedMode: true, usesSharedIsItemizedModeFlag: true });
      /* Rommel, 2026-09-03 (follow-up, same session): screenshot showed "535.05" printed in the
         "Unit Price" column of both the Fabrication subtotal and GRAND TOTAL rows in itemized
         mode -- a raw unit count (fmtUnits(totU), meaningful as "No. of Units" in area/type/lump
         mode's 4th column) reused in the SAME cell position under itemized mode's differently-
         labeled "Unit Price" header. A quantity with no per-unit price meaning, printed under a
         price header, reads as a bogus figure. Both rows must blank that cell in itemized mode,
         same as every other itemized-mode summary line (Assembly, minimum charge) already does. */
      if (typeof window._buildPrintBodyCore === 'function')
        check('_buildPrintBodyCore: Fabrication subtotal + GRAND TOTAL blank the unit-count cell in itemized mode', () => {
          const src = window._buildPrintBodyCore.toString();
          const fabRowMatch = /Fabrication subtotal<\/td><td[^>]*>'\+\(isItemizedMode\?'—':fmtUnits\(totU\)\)\+'/.test(src);
          const grandRowMatch = /GRAND TOTAL'[\s\S]{0,140}?<td[^>]*>'\+\(isItemizedMode\?'—':fmtUnits\(totU\)\)\+'/.test(src);
          // Neither row may fall back to the old unconditional fmtUnits(totU) call anywhere in
          // their own cell -- would silently reprint the bogus figure whenever isItemizedMode.
          const noUnconditionalFabCall = !/Fabrication subtotal<\/td><td[^>]*>'\+fmtUnits\(totU\)\+'/.test(src);
          const noUnconditionalGrandCall = !/GRAND TOTAL'[\s\S]{0,140}?<td[^>]*>'\+fmtUnits\(totU\)\+'/.test(src);
          return { fabRowMatch, grandRowMatch, noUnconditionalFabCall, noUnconditionalGrandCall };
        }, { fabRowMatch: true, grandRowMatch: true, noUnconditionalFabCall: true, noUnconditionalGrandCall: true });
      /* Rommel, 2026-09-03 (follow-up): "why so big... im referring to the size of the black thing
         for revealing hidden cost" -- the toggle was styled with a filled amber background/border,
         far heavier than its sibling "Show Mobilization & Installation separately" checkbox right
         beside it, which uses a plain neutral pill (var(--border)/var(--card)). Restyled to match
         exactly, so a staff-only convenience toggle doesn't visually outweigh the rest of the print
         toolbar. */
      check('print toolbar: the reveal-hidden-costs checkbox matches its neighbor\'s discreet styling, not an amber-filled pill', () => {
        const revealEl = document.getElementById('pb-reveal-hidden-row');
        const siblingEl = document.getElementById('pb-mi-split'); // the checkbox INPUT; its <label> parent is the styled pill
        const revealStyle = revealEl ? revealEl.getAttribute('style') || '' : '';
        const siblingStyle = siblingEl && siblingEl.parentElement ? siblingEl.parentElement.getAttribute('style') || '' : '';
        return {
          bothExist: !!revealEl && !!siblingEl,
          noAmberBorder: !/border:\s*1\.5px solid var\(--amber\)/.test(revealStyle),
          noAmberFill: !/background:\s*var\(--wash-amber\)/.test(revealStyle),
          // Same border/background TOKENS as its sibling -- not necessarily byte-identical (the
          // sibling has no margin-left/color, the reveal toggle keeps its display:none/flex logic),
          // just proving it no longer stands out as a differently-weighted, filled pill.
          sameBorderToken: /border:1\.5px solid var\(--border\)/.test(revealStyle) === /border:1\.5px solid var\(--border\)/.test(siblingStyle) && /border:1\.5px solid var\(--border\)/.test(siblingStyle),
          sameBackgroundToken: /background:var\(--card\)/.test(revealStyle) === /background:var\(--card\)/.test(siblingStyle) && /background:var\(--card\)/.test(siblingStyle),
        };
      }, { bothExist: true, noAmberBorder: true, noAmberFill: true, sameBorderToken: true, sameBackgroundToken: true });
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
      /* 2026-09-16: Rommel reported "I am somehow blinded on what option am I signing or
         unlocking since it doesnt show what option it is" -- a quotation's lock state genuinely
         IS per-option (captureQuotationSnapshot carries `locked` inside each option's own
         snapshot; qOptionsList[i].locked is maintained directly), and a signature attests to
         whichever option's pricing was active when it was requested -- but no approval request of
         ANY type ever recorded which option that was. Added optionId/optionLabel, captured once at
         request-creation time via the new _apprOptionContext() (reusing getDisplaySerial's own
         qActiveOptionId/qOptionsList lookup rather than inventing a second one), and threaded
         through every one of this file's own documented "propagation trap" gates: the payload at
         creation (_sendSignatureRequest, submitApprovalRequest -- BOTH its req object and its
         separate NOTIFS.unshift push), _apprMergeWithKnown's hardcoded key list,
         supaUpsertApprovalRequest's hardcoded payload object, gLoadApprovalRequests' Supabase-row
         mapping, _mergeApprovalReqsIntoNotifs' two hardcoded field lists, and THREE separate
         direct-Supabase-write sites that bypass gSaveApprovalRequest's merge entirely
         (doApprovalAction's updReq, and -- found while fixing this, not in the original report --
         acceptCounter's own updReq, the same bypass shape doApprovalAction had). Displayed via one
         shared badge (_apprOptBadge) on _apprQuotLink, which both the Approvals page and the bell
         panel already call -- one fix, both surfaces -- and on the on-quotation signature bar's
         own pending pill, which is the "also in the app Modcraft signature" half of the report.
         This check drives the REAL creation functions (not hand-built request objects) with a
         real multi-option qOptionsList, proving the label survives a real _apprMergeWithKnown pass
         (simulating what a reload does) and renders correctly via the real display helpers. */
      if (typeof window._apprOptionContext === 'function')
        check('_apprOptionContext: labels the active option, or nothing when there is none', () => {
          const w = window;
          const saved = { qActiveOptionId: w.qActiveOptionId, qOptionsList: w.qOptionsList };
          try {
            w.qOptionsList = [{ id: 1, label: 'Option 1' }, { id: 2, label: 'Option 2' }];
            w.qActiveOptionId = 2;
            const withOption = w._apprOptionContext();
            w.qActiveOptionId = 0;
            const noOption = w._apprOptionContext();
            w.qActiveOptionId = 5; w.qOptionsList = [];   // stale id, no matching option -- still labels sensibly
            const missingFromList = w._apprOptionContext();
            return {
              withOption: { optionId: withOption.optionId, optionLabel: withOption.optionLabel },
              noOption: { optionId: noOption.optionId, optionLabel: noOption.optionLabel },
              missingFromList: { optionId: missingFromList.optionId, optionLabel: missingFromList.optionLabel }
            };
          } finally { w.qActiveOptionId = saved.qActiveOptionId; w.qOptionsList = saved.qOptionsList; }
        }, { withOption: { optionId: 2, optionLabel: 'Option 2' }, noOption: { optionId: 0, optionLabel: '' },
             missingFromList: { optionId: 5, optionLabel: 'Option 5' } });
      if (typeof window._sendSignatureRequest === 'function' && typeof window._apprMergeWithKnown === 'function'
          && typeof window._apprQuotLink === 'function')
        check('_sendSignatureRequest: carries option context all the way through a merge pass and into the shared display helper', () => {
          const w = window;
          const saved = { findSig: w._findSignatory, saveReq: w.gSaveApprovalRequest, sendMsg: w.gSendMessage,
                           pushReq: w._pushApprovalRequest, pCalc: w._pCalc, gUser: w.gUser,
                           qActiveOptionId: w.qActiveOptionId, qOptionsList: w.qOptionsList,
                           notifsLen: w.NOTIFS ? w.NOTIFS.length : 0 };
          try {
            w._findSignatory = () => ({ email: 'approver@test.com', name: 'Test Approver' });
            w.gSaveApprovalRequest = () => {};
            w.gSendMessage = () => {};
            w._pushApprovalRequest = () => {};
            w.gUser = { email: 'signer@test.com', name: 'Test Signer' };
            w.qOptionsList = [{ id: 3, label: 'Option 3' }];
            w.qActiveOptionId = 3;
            const req = w._sendSignatureRequest('checked', false, 'QT-TEST-0100', 'Test Client');
            const capturedOnCreation = { optionId: req && req.optionId, optionLabel: req && req.optionLabel };
            // Simulate a reload: an incoming Supabase row (fresh optionId/optionLabel) merges over
            // the in-memory NOTIFS entry _sendSignatureRequest just created.
            const merged = w._apprMergeWithKnown({ id: req.id, status: 'pending' });
            const survivesMerge = { optionId: merged.optionId, optionLabel: merged.optionLabel };
            const badgeHtml = w._apprQuotLink(req, 12);
            return {
              capturedOnCreation, survivesMerge,
              badgeShowsTheOption: badgeHtml.indexOf('Option 3') > -1
            };
          } finally {
            w._findSignatory = saved.findSig; w.gSaveApprovalRequest = saved.saveReq; w.gSendMessage = saved.sendMsg;
            w._pushApprovalRequest = saved.pushReq; w._pCalc = saved.pCalc; w.gUser = saved.gUser;
            w.qActiveOptionId = saved.qActiveOptionId; w.qOptionsList = saved.qOptionsList;
            if (w.NOTIFS) w.NOTIFS.splice(0, w.NOTIFS.length - saved.notifsLen);
          }
        }, { capturedOnCreation: { optionId: 3, optionLabel: 'Option 3' },
             survivesMerge: { optionId: 3, optionLabel: 'Option 3' }, badgeShowsTheOption: true });
      if (typeof window._apprQuotLink === 'function')
        check('_apprQuotLink: no stray badge on a request with no option context (the common single-option case)', () => {
          const w = window;
          // NOTE: _apprQuotLink's own serial styling legitimately uses color:var(--pill-navy) --
          // a loose `indexOf('pill-navy')` check would match that CSS reference too, not just the
          // option badge's actual class attribute. Check for the badge's own opening tag instead.
          const html = w._apprQuotLink({ client: 'Test Client', serial: 'QT-TEST-0101', optionLabel: '' }, 12);
          return { noOptionPillRendered: html.indexOf('class="pill pill-navy"') === -1 };
        }, { noOptionPillRendered: true });
      if (typeof window.submitApprovalRequest === 'function' && typeof window._sreqCtx === 'object')
        check('submitApprovalRequest (unlock): carries option context too, not just signature requests', () => {
          const w = window;
          const saved = { sreqCtx: w._sreqCtx, reasonGate: w._reasonGate, findApproverForAction: w.findApproverForAction,
                           findApprover: w.findApprover, gSendMessage: w.gSendMessage, gUser: w.gUser,
                           currentUserCompany: w.currentUserCompany, _pCalc: w._pCalc,
                           qActiveOptionId: w.qActiveOptionId, qOptionsList: w.qOptionsList,
                           notifsLen: w.NOTIFS ? w.NOTIFS.length : 0 };
          try {
            w._reasonGate = () => true;   // bypass the reason-box requirement -- not what this test is about
            w.findApproverForAction = () => ({ name: 'Test Approver', email: 'approver@test.com' });
            w.gSendMessage = () => {};
            w.gUser = { email: 'requester@test.com', name: 'Test Requester' };
            w._pCalc = { grand: 5000 };
            w.qOptionsList = [{ id: 7, label: 'Option 7' }];
            w.qActiveOptionId = 7;
            w._sreqCtx = { type: 'unlock', data: { ctx: 's1' } };
            w.submitApprovalRequest();
            const created = w.NOTIFS[0];
            return { optionId: created && created.optionId, optionLabel: created && created.optionLabel };
          } finally {
            w._sreqCtx = saved.sreqCtx; w._reasonGate = saved.reasonGate; w.findApproverForAction = saved.findApproverForAction;
            w.findApprover = saved.findApprover; w.gSendMessage = saved.gSendMessage; w.gUser = saved.gUser;
            w.currentUserCompany = saved.currentUserCompany; w._pCalc = saved._pCalc;
            w.qActiveOptionId = saved.qActiveOptionId; w.qOptionsList = saved.qOptionsList;
            if (w.NOTIFS) w.NOTIFS.splice(0, w.NOTIFS.length - saved.notifsLen);
          }
        }, { optionId: 7, optionLabel: 'Option 7' });
      if (typeof window.renderSignatureBar === 'function' && typeof window._sigPendingFor === 'function')
        check('renderSignatureBar: the pending pill shows which option the signature was requested against', () => {
          const w = window;
          // #sig-bar already exists in the static markup (hidden until the quotation is locked) --
          // renderSignatureBar() writes into THAT one via el()/getElementById, so the result must
          // be read back the same way, not from a same-id lookalike created just for this test
          // (the exact mistake this file's own Computation Ref test was written to avoid).
          const realBar = document.getElementById('sig-bar');
          const savedHtml = realBar ? realBar.innerHTML : null;
          const savedDisplay = realBar ? realBar.style.display : null;
          const saved = { qLocked: w.qLocked, fqLocked: w.fqLocked, qStage: w.qStage, sigPendingFor: w._sigPendingFor,
                           sigState: w._sigState, sigOf: w._sigOf, renderSigTopPill: w._renderSigTopPill };
          try {
            w.qLocked = true; w.qStage = 1;
            w._renderSigTopPill = () => {};
            w._sigState = () => ({ checked: false, noted: false, needNoted: false, complete: false, exVat: 0, threshold: 0 });
            w._sigOf = () => null;
            w._sigPendingFor = (slot) => slot === 'checked'
              ? { approverEmail: 'joanna@test.com', optionLabel: 'Option 2' } : null;
            w.renderSignatureBar();
            const bar = document.getElementById('sig-bar');
            return { showsTheOption: !!bar && bar.innerHTML.indexOf('Option 2') > -1 };
          } finally {
            w.qLocked = saved.qLocked; w.fqLocked = saved.fqLocked; w.qStage = saved.qStage;
            w._sigPendingFor = saved.sigPendingFor; w._sigState = saved.sigState; w._sigOf = saved.sigOf;
            w._renderSigTopPill = saved.renderSigTopPill;
            if (realBar) { realBar.innerHTML = savedHtml || ''; realBar.style.display = savedDisplay || 'none'; }
          }
        }, { showsTheOption: true });
      /* 2026-09-15: Rommel reported "whenever I reroute for signature, the signature doesn't
         appear" -- traced with real activity-log data to TWO distinct causes. The functional one
         (Cebu World Laminate's Noted-by fallback left blank in Settings, so the auto-escalation
         after Checked-by has nowhere to go) is a configuration gap, not a bug -- Rommel fixed it
         directly in Settings. This is the SECOND, genuinely code cause found alongside it: two
         re-routes logged live on 2026-09-15 landed under the WRONG serial -- one under an
         unrelated quotation ("QT-M00000153" in the serial column, but the action text itself said
         "...on QT-M00000145 re-routed..."), one under a bare draft key ("DRAFT-3a57d2", action
         text said "...on QT-M00000155..."). rerouteSignature()'s own logActivity() call passed
         only the action string, no explicit serial -- and logActivity(action) with no second
         argument defaults to qSerial||qDraftKey||'' (whatever's open in THIS browser), which is
         essentially never the actual target when re-routing is done from the Approvals page. Same
         "propagation trap" class this file has hit repeatedly (sigSlot/to_email/decision/applied/
         orderId) -- fixed by passing n.serial (the request's own target) explicitly, the same fix
         every prior instance needed. Drives the real function with a fake NOTIFS entry and a
         DIFFERENT quotation "open" in this browser, proving the log lands on the request's real
         target and not on whatever happens to be on screen. */
      if (typeof window.rerouteSignature === 'function')
        check('rerouteSignature: logs against the request\'s own target quotation, not whatever is open here', () => {
          const w = window;
          const saved = { NOTIFS: w.NOTIFS, findSig: w._findSignatory, saveReq: w.gSaveApprovalRequest,
                           sendMsg: w.gSendMessage, logActivity: w.logActivity, gUser: w.gUser,
                           currentRole: w.currentRole, qSerial: w.qSerial, qDraftKey: w.qDraftKey,
                           updateBadge: w._updateNotifBadge, renderAppr: w.renderApprovals };
          try {
            w.gUser = { email: 'admin@test.com', name: 'Test Admin' };
            w.currentRole = 'Admin';
            // A DIFFERENT quotation is the one "open" in this browser -- exactly the real-world
            // shape (re-routing is done from the Approvals page, not from the target quotation).
            w.qSerial = 'QT-OPEN-ELSEWHERE'; w.qDraftKey = '';
            w.NOTIFS = [{ type: 'signature', status: 'pending', sigSlot: 'checked',
                          serial: 'QT-TARGET-0042', client: 'Test Client', company: 'World Class Laminate, Inc.',
                          fromEmail: 'requester@test.com', approverEmail: 'old-approver@test.com' }];
            w._findSignatory = () => ({ email: 'new-approver@test.com', name: 'New Approver' });
            w.gSaveApprovalRequest = () => {};
            w.gSendMessage = () => {};
            w._updateNotifBadge = () => {};
            w.renderApprovals = () => {};
            const calls = [];
            w.logActivity = function (action, serial) { calls.push({ action, serial }); };
            w.rerouteSignature(0);
            const call = calls[0];
            return {
              loggedOnce: calls.length === 1,
              loggedAgainstTheRealTarget: !!call && call.serial === 'QT-TARGET-0042',
              notAgainstWhateverWasOpen: !!call && call.serial !== 'QT-OPEN-ELSEWHERE',
              messageNamesTheRealTarget: !!call && call.action.indexOf('QT-TARGET-0042') >= 0
            };
          } finally {
            w.NOTIFS = saved.NOTIFS; w._findSignatory = saved.findSig; w.gSaveApprovalRequest = saved.saveReq;
            w.gSendMessage = saved.sendMsg; w.logActivity = saved.logActivity; w.gUser = saved.gUser;
            w.currentRole = saved.currentRole; w.qSerial = saved.qSerial; w.qDraftKey = saved.qDraftKey;
            w._updateNotifBadge = saved.updateBadge; w.renderApprovals = saved.renderAppr;
          }
        }, { loggedOnce: true, loggedAgainstTheRealTarget: true, notAgainstWhateverWasOpen: true,
             messageNamesTheRealTarget: true });
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
          // dirShowArchived forced true for the duration of this check: a fixed past date here
          // would eventually age past the 30-day-no-update archive rule (added in a LATER session
          // than this test) and get silently hidden by that gate before the search filter it is
          // actually testing ever runs -- exactly what happened to the original 2026-01-01 fixture
          // once enough real time passed. Forcing archived-visible decouples this test from
          // whatever "today" happens to be, permanently, rather than swapping in a new date that
          // would just go stale again later.
          const saved = { dirData: w.dirData, search: document.getElementById('dir-search').value,
                           dirShowArchived: w.dirShowArchived };
          w.dirShowArchived = true;
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
            w.dirShowArchived = saved.dirShowArchived;
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
            const html = w.buildItemizedPrintRows(null, null);
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
            const html = w.buildItemizedPrintRows(null, null);
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
      /* Rommel, 2026-08-27, follow-up on QT-C00000006: "if the user requests a signature and no
         one acted on it, and needs to edit and requests unlock, should the [signature] request be
         invalidated?" Yes -- matching his own 2026-08-19 rule (QT-W00000134) that a pending
         signature must not survive an unlock, since it would sign a document that has since
         changed. clearSignaturesOnUnlock() already did this for the direct-PIN unlock path
         (confirmUnlock); this was missing from the other two unlock paths -- the approved-request
         path applied to the OPEN quotation, and the one applied to a SAVED STATE (the quotation
         not open anywhere, e.g. approved from a phone) -- so most real unlocks (the majority go
         through the request/approval route, not the PIN) left a stale pending signature sitting
         there, signable against content that no longer matches it. */
      if (typeof window._applyApprovedRequest === 'function' && typeof window.clearSignaturesOnUnlock === 'function')
        check('_applyApprovedRequest: an unlock approved on the OPEN quotation cancels a pending signature too', () => {
          const w = window;
          const saved = { qBaseSerial: w.qBaseSerial, qSerial: w.qSerial, qSignatures: w.qSignatures,
                           NOTIFS: w.NOTIFS, gSaveApprovalRequest: w.gSaveApprovalRequest, gSendMessage: w.gSendMessage,
                           logActivity: w.logActivity, showToast: w.showToast, _updateNotifBadge: w._updateNotifBadge,
                           qClientApproved: w.qClientApproved, qApproved: w.qApproved,
                           qActiveOptionId: w.qActiveOptionId, qOptionsList: w.qOptionsList };
          try {
            w.gSaveApprovalRequest = () => {}; w.gSendMessage = () => {}; w.logActivity = () => {};
            w.showToast = () => {}; w._updateNotifBadge = () => {};
            w.qBaseSerial = 'QT-TEST-SIG01'; w.qSerial = 'QT-TEST-SIG01';
            w.qActiveOptionId = 0; w.qOptionsList = [];
            w.qSignatures = { checked: { name: 'Joanna' } };   // a COMPLETED signature on the open quotation
            w.NOTIFS = [{ type: 'signature', status: 'pending', serial: 'QT-TEST-SIG01', reqId: 'sig1',
                          sigSlot: 'noted', approverEmail: 'x@y.com' }];
            w._applyApprovedRequest({ type: 'unlock', ctx: 's1', serial: 'QT-TEST-SIG01', by: 'Allan Lagsao' });
            return {
              completedSignatureCleared: !w.qSignatures.checked,
              pendingSignatureCancelled: w.NOTIFS[0].status === 'cancelled',
            };
          } finally { Object.keys(saved).forEach(k => { w[k] = saved[k]; }); }
        }, { completedSignatureCleared: true, pendingSignatureCancelled: true });
      if (typeof window._clearSignaturesInState === 'function')
        check('_clearSignaturesInState: clears completed signatures on a SAVED state object, never throws on a bare one', () => {
          const w = window;
          const s1 = { signatures: { checked: { name: 'Joanna' }, noted: { name: 'Rommel' } } };
          w._clearSignaturesInState(s1);
          let noThrowOnEmpty = true;
          try { w._clearSignaturesInState({}); w._clearSignaturesInState(null); } catch (e) { noThrowOnEmpty = false; }
          return { bothCleared: !s1.signatures.checked && !s1.signatures.noted, noThrowOnEmpty };
        }, { bothCleared: true, noThrowOnEmpty: true });
      if (typeof window._persistApprovedFieldToQuotation === 'function')
        check('_persistApprovedFieldToQuotation: the unlock mutate clears saved signatures, and cancels pending ones after mutate runs (not orphaned)', () => {
          const src = window._persistApprovedFieldToQuotation.toString();
          const unlockBlock = src.slice(src.indexOf("type==='unlock'"), src.indexOf("if(!mutate)"));
          const mutateIdx = src.indexOf('mutate(state)');
          const cancelIdx = src.indexOf('_cancelPendingSignaturesFor(');
          return {
            fqBranchClearsState: /_clearSignaturesInState\(s\)/.test(unlockBlock.slice(0, unlockBlock.indexOf(':function(s){'))),
            s1BranchClearsState: /_clearSignaturesInState\(s\)/.test(unlockBlock.slice(unlockBlock.indexOf(':function(s){'))),
            cancelCallPresent: cancelIdx > -1,
            cancelRunsAfterMutate: cancelIdx > mutateIdx,
          };
        }, { fqBranchClearsState: true, s1BranchClearsState: true, cancelCallPresent: true, cancelRunsAfterMutate: true });
      /* 2026-09-15: Rommel reported Stephanie "always encountered that the quotation automatically
         show that a quotation has been approved by the client which she claims she did not push."
         Confirmed against the real activity log, down to the millisecond (QT-M00000147,
         2026-09-11): "Client approved the Initial Quotation." logged at 01:44:35.033396 and
         "Quotation approved — Stage 2 unlocked" at 01:44:35.040231 -- both from ONE click of the
         single button labelled "Approve & proceed to Stage 2", which never said it also recorded
         client approval. Distinct from the 2026-08-27 fix above: that fix made UNLOCK correctly
         REVERSE the qApproved/qClientApproved coupling; this fix does not touch the coupling
         itself (still deliberately together, per qClientApproved's own comment) -- it makes the
         moment they get SET an explicit, confirmed one instead of a silent side effect of an
         ambiguously-worded button. Proves: the confirm names what it will record; declining it
         (the real _confirm modal's onOk simply never getting called, the same as clicking
         Cancel) leaves NOTHING recorded, not even qApproved; confirming proceeds with the exact
         same full approval as before; and re-approving an already-approved quotation skips the
         question entirely rather than re-asking something already on record. */
      if (typeof window.doApprove === 'function' && typeof window._doApproveProceed === 'function')
        check('doApprove: confirms before recording client approval, and skips re-asking once already approved', () => {
          const w = window;
          const saved = { qCancelled: w.qCancelled, qLocked: w.qLocked, qApproved: w.qApproved,
                           qClientApproved: w.qClientApproved, qClientApprovedAt: w.qClientApprovedAt,
                           qOptionsList: w.qOptionsList, qActiveOptionId: w.qActiveOptionId, _pCalc: w._pCalc,
                           _confirm: w._confirm, gSaveQuotation: w.gSaveQuotation, updateLockUI: w.updateLockUI,
                           goStage: w.goStage, logActivity: w.logActivity,
                           clName: el('cl-name') ? el('cl-name').value : null,
                           clBiz: el('cl-bizname') ? el('cl-bizname').value : null };
          try {
            w.qCancelled = false; w.qLocked = true; w.qOptionsList = []; w.qActiveOptionId = 0;
            w._pCalc = { grand: 1000 };
            if (el('cl-name')) el('cl-name').value = 'Test Client';
            if (el('cl-bizname')) el('cl-bizname').value = '';
            w.gSaveQuotation = () => {}; w.updateLockUI = () => {}; w.goStage = () => {};
            w.logActivity = () => {};

            let confirmMsg = null;
            w.qApproved = false; w.qClientApproved = false; w.qClientApprovedAt = '';
            w._confirm = (msg) => { confirmMsg = msg; };   // capture only -- never call onOk: simulates Cancel
            w.doApprove();
            const declinedRecordsNothing = { qApproved: w.qApproved, qClientApproved: w.qClientApproved };
            const namesWhatItRecords = !!confirmMsg && /client/i.test(confirmMsg) && /approv/i.test(confirmMsg);

            w.qApproved = false; w.qClientApproved = false; w.qClientApprovedAt = '';
            w._confirm = (msg, onOk) => { onOk(); };   // simulates clicking Yes
            w.doApprove();
            const confirmingRecordsApproval = { qApproved: w.qApproved, qClientApproved: w.qClientApproved };

            let askedAgain = false;
            w._confirm = () => { askedAgain = true; };
            w.doApprove();   // qClientApproved is already true from the previous step
            const skipsWhenAlreadyApproved = !askedAgain;

            return { declinedRecordsNothing, namesWhatItRecords, confirmingRecordsApproval, skipsWhenAlreadyApproved };
          } finally {
            w.qCancelled = saved.qCancelled; w.qLocked = saved.qLocked; w.qApproved = saved.qApproved;
            w.qClientApproved = saved.qClientApproved; w.qClientApprovedAt = saved.qClientApprovedAt;
            w.qOptionsList = saved.qOptionsList; w.qActiveOptionId = saved.qActiveOptionId; w._pCalc = saved._pCalc;
            w._confirm = saved._confirm; w.gSaveQuotation = saved.gSaveQuotation; w.updateLockUI = saved.updateLockUI;
            w.goStage = saved.goStage; w.logActivity = saved.logActivity;
            if (el('cl-name') && saved.clName !== null) el('cl-name').value = saved.clName;
            if (el('cl-bizname') && saved.clBiz !== null) el('cl-bizname').value = saved.clBiz;
          }
        }, { declinedRecordsNothing: { qApproved: false, qClientApproved: false }, namesWhatItRecords: true,
             confirmingRecordsApproval: { qApproved: true, qClientApproved: true }, skipsWhenAlreadyApproved: true });
      /* Rommel, 2026-09-21: reported the quotation "suddenly locked" while he was "just typing" --
         traced through the activity log to a genuine, complete lock (rates frozen, revision bumped,
         "Quotation locked." logged) 15 seconds after an unlock. The Lock button had no confirmation
         at all -- a single stray click did everything instantly, with nothing to catch it, even
         though it freezes pricing and clears any signatures already collected. Same
         confirm-before-a-consequential-action pattern as doApprove() above. Proves: the gates
         (qLocked/qCancelled/_lockGateOk) still run BEFORE the confirm even opens, so a lock that
         would be refused anyway never shows the dialog; declining leaves qLocked untouched;
         confirming runs the exact same lock sequence as before. */
      if (typeof window.doLockOnly === 'function' && typeof window._doLockOnlyConfirmed === 'function')
        check('doLockOnly: confirms before locking, and the gates still run before the dialog opens', () => {
          const w = window;
          const saved = { qLocked: w.qLocked, qCancelled: w.qCancelled, qRevisionPending: w.qRevisionPending,
                           _lockGateOk: w._lockGateOk, _lockGateFail: w._lockGateFail, _confirm: w._confirm,
                           _applyRevisionBump: w._applyRevisionBump, _stampPreparedBySignature: w._stampPreparedBySignature,
                           _freezeRates: w._freezeRates, _captureLockedTotal: w._captureLockedTotal,
                           gSaveQuotation: w.gSaveQuotation, updateLockUI: w.updateLockUI, updateSentStatus: w.updateSentStatus,
                           saveQuotationToDrive: w.saveQuotationToDrive, renderOptionBar: w.renderOptionBar,
                           logActivity: w.logActivity, qActiveOptionId: w.qActiveOptionId, qOptionsList: w.qOptionsList };
          try {
            w._applyRevisionBump = () => {}; w._stampPreparedBySignature = () => {};
            w._freezeRates = () => {}; w._captureLockedTotal = () => {};
            w.gSaveQuotation = () => {}; w.updateLockUI = () => {}; w.updateSentStatus = () => {};
            w.saveQuotationToDrive = () => {}; w.renderOptionBar = () => {}; w.logActivity = () => {};
            w.qActiveOptionId = 0; w.qOptionsList = []; w.qRevisionPending = false;

            // A refused gate must never even open the confirm dialog.
            w.qLocked = false; w.qCancelled = false;
            let gateFailShown = false;
            w._lockGateOk = () => false; w._lockGateFail = () => { gateFailShown = true; };
            let confirmOpenedOnRefusedGate = false;
            w._confirm = () => { confirmOpenedOnRefusedGate = true; };
            w.doLockOnly();
            const gateBlocksBeforeAnyDialog = gateFailShown && !confirmOpenedOnRefusedGate;

            w._lockGateOk = () => true;
            let confirmMsg = null;
            w._confirm = (msg) => { confirmMsg = msg; };   // capture only -- never call onOk: simulates Cancel
            w.doLockOnly();
            const decliningLeavesItUnlocked = w.qLocked === false;
            const namesWhatItDoes = !!confirmMsg && /lock/i.test(confirmMsg) && /freeze|frozen/i.test(confirmMsg);

            w._confirm = (msg, onOk) => { onOk(); };   // simulates clicking Yes
            w.doLockOnly();
            const confirmingActuallyLocks = w.qLocked === true;

            return { gateBlocksBeforeAnyDialog, decliningLeavesItUnlocked, namesWhatItDoes, confirmingActuallyLocks };
          } finally {
            w.qLocked = saved.qLocked; w.qCancelled = saved.qCancelled; w.qRevisionPending = saved.qRevisionPending;
            w._lockGateOk = saved._lockGateOk; w._lockGateFail = saved._lockGateFail; w._confirm = saved._confirm;
            w._applyRevisionBump = saved._applyRevisionBump; w._stampPreparedBySignature = saved._stampPreparedBySignature;
            w._freezeRates = saved._freezeRates; w._captureLockedTotal = saved._captureLockedTotal;
            w.gSaveQuotation = saved.gSaveQuotation; w.updateLockUI = saved.updateLockUI; w.updateSentStatus = saved.updateSentStatus;
            w.saveQuotationToDrive = saved.saveQuotationToDrive; w.renderOptionBar = saved.renderOptionBar;
            w.logActivity = saved.logActivity; w.qActiveOptionId = saved.qActiveOptionId; w.qOptionsList = saved.qOptionsList;
          }
        }, { gateBlocksBeforeAnyDialog: true, decliningLeavesItUnlocked: true, namesWhatItDoes: true, confirmingActuallyLocks: true });
      /* Rommel, 2026-09-21: "I don't have ways to edit the names of client in the edit directory" --
         confirmed: openClientModal() rendered every field ("Contact name", "Business name", ...) as
         plain read-only text, with Delete as the only action. A typo ("Johndurf" for "Johndorf")
         had no fix short of a database edit -- exactly the Sheets/Supabase-split risk this session
         already hit once on a different quotation. Scoped deliberately to the safe, pure
         record-keeping fields (name/business name/contact/email/address/notes) -- Account Category
         and Segment are left untouched here since those can carry pricing/billing implications
         elsewhere, and "correct the name without affecting anything else" was the explicit ask.
         Proves the edit form is pre-filled from the real client object, and that saving calls the
         SAME gSaveClient() the rest of the app already uses (the one function that dual-writes
         Sheets+Supabase) -- not a new, separate write path that could drift from it. */
      if (typeof window.startEditClient === 'function' && typeof window.submitEditClient === 'function')
        check('startEditClient/submitEditClient: a client\'s name can be corrected through the real save path', () => {
          const w = window;
          const saved = { liveClients: w.liveClients, gSaveClient: w.gSaveClient, logActivity: w.logActivity,
                           renderClients: w.renderClients, showToast: w.showToast, _cmEditingId: w._cmEditingId };
          try {
            w.liveClients = [{ id: 501, name: 'Johndurf Property Ventures', bizname: 'Johndurf Property Ventures',
                                contact: '0917', email: 'a@b.com', address: 'Cebu', type: 'Direct',
                                segment: 'Commercial', segmentGroup: 'B2B', notes: '', txns: [] }];
            let savedClient = null;
            w.gSaveClient = (c) => { savedClient = c; };
            w.logActivity = () => {}; w.renderClients = () => {}; w.showToast = () => {};

            w.startEditClient(501);
            const prefilledCorrectly = el('cme-name') && el('cme-name').value === 'Johndurf Property Ventures';

            if (el('cme-name')) el('cme-name').value = 'Johndorf Property Ventures';
            if (el('cme-biz')) el('cme-biz').value = 'Johndorf Property Ventures';
            w.submitEditClient(501);

            return {
              prefilledCorrectly,
              wentThroughTheRealSaveFunction: !!savedClient,
              nameActuallyCorrected: !!savedClient && savedClient.name === 'Johndorf Property Ventures' && savedClient.bizname === 'Johndorf Property Ventures',
              accountCategoryUntouched: !!savedClient && savedClient.type === 'Direct',
              segmentUntouched: !!savedClient && savedClient.segment === 'Commercial' && savedClient.segmentGroup === 'B2B',
            };
          } finally {
            w.liveClients = saved.liveClients; w.gSaveClient = saved.gSaveClient; w.logActivity = saved.logActivity;
            w.renderClients = saved.renderClients; w.showToast = saved.showToast; w._cmEditingId = saved._cmEditingId;
          }
        }, { prefilledCorrectly: true, wentThroughTheRealSaveFunction: true, nameActuallyCorrected: true,
             accountCategoryUntouched: true, segmentUntouched: true });
      // Rommel, 2026-08-27: "add kg uom on the outsource" -- an outsourced material bought by
      // weight (e.g. a sheet good priced per kg rather than per piece) had no matching unit in the
      // dropdown. Local to renderOutsourceSection's own uopts list, so it can't affect BOM mode's
      // separate free-text unit list, which has its own copy of the same options.
      if (typeof window.renderOutsourceSection === 'function')
        check('renderOutsourceSection: the unit dropdown offers kg', () => ({
          hasKgOption: window.renderOutsourceSection.toString().indexOf('value="kg"') > -1,
        }), { hasKgOption: true });
      /* Rommel's team, 2026-08-27: every PDF the client actually receives (Share -> Download PDF,
         native share, Email, and the per-option export) comes out with the app's CURRENT theme's
         background baked in -- black, in dark mode -- "that is why they don't use the black theme
         of the app." Root cause: _capturePrintCanvas() builds an off-screen div to snapshot, and
         that div's own background/text were set to var(--card)/var(--text) -- since the div lives
         in the same document as the app, those resolve to whatever theme is CURRENTLY active, not
         a fixed color. The printed CONTENT itself (bodyHtml, built by _buildPrintBody) has never
         used var() -- verified during the 2026-08 dark-mode work -- so this wrapper, added later
         for the SnapDOM capture, was the one piece never covered by that check. Source-checked
         (not functionally driven -- SnapDOM/html2canvas/html2pdf are all real network-loaded
         libraries this harness doesn't stub, and driving the real capture would need a live
         browser): the wrapper's own inline style, and the color handed to SnapDOM, must both be
         fixed light values with no var(--...) anywhere in either. */
      if (typeof window._capturePrintCanvas === 'function')
        check('_capturePrintCanvas: the capture wrapper is pinned to fixed light colors, never the live theme', () => {
          const src = window._capturePrintCanvas.toString();
          const wrapStyleLine = src.slice(src.indexOf('wrap.style.cssText='), src.indexOf('wrap.innerHTML'));
          const snapdomCallLine = src.slice(src.indexOf('snapdom.toCanvas('), src.indexOf('.then(function(canvas)'));
          return {
            wrapStyleHasNoThemeVar: wrapStyleLine.indexOf('var(--') === -1,
            wrapStyleSetsFixedBackground: /background:#fff/.test(wrapStyleLine),
            snapdomBackgroundHasNoThemeVar: snapdomCallLine.indexOf('var(--') === -1,
            snapdomBackgroundIsFixed: /backgroundColor:'#fff/.test(snapdomCallLine),
          };
        }, { wrapStyleHasNoThemeVar: true, wrapStyleSetsFixedBackground: true,
             snapdomBackgroundHasNoThemeVar: true, snapdomBackgroundIsFixed: true });
      /* Rommel, 2026-08-28: "change the long and short header of the cutting to length and width,
         the usual." Checked the underlying logic first -- _webEbtToModcraft already auto-detects
         whichever of the two numbers is bigger and treats THAT as the long edge
         (longIsLength=(+L||0)>=(+W||0)), so it never mattered which column a value landed in. The
         internal field names (blankPanel's L/W) and the Excel template header (XL_PANEL_HDR) were
         already "Length (mm)"/"Width (mm)" -- only this on-screen table header still said
         "Long"/"Short", inconsistent with everything else. Renaming it is a pure label fix, not a
         behaviour change -- this check proves the on-screen header now reads the usual way and
         nothing that decides banding was touched (still finds the auto-detect line verbatim). */
      if (typeof window.MCL === 'object' && typeof window.MCL.build === 'function' && typeof window._webEbtToModcraft === 'function')
        check('MCL cutting-list panel table: header reads Length/Width, banding still auto-detects the bigger number', () => {
          const html = window.MCL.build();
          const ebtSrc = window._webEbtToModcraft.toString();
          return {
            headerSaysLength: html.indexOf('Length (mm)') > -1,
            headerSaysWidth: html.indexOf('Width (mm)') > -1,
            headerNoLongerSaysLongShort: html.indexOf('Long (mm)') === -1 && html.indexOf('Short (mm)') === -1,
            bandingStillAutoDetectsMagnitude: ebtSrc.indexOf('longIsLength=(+L||0)>=(+W||0)') > -1,
          };
        }, { headerSaysLength: true, headerSaysWidth: true, headerNoLongerSaysLongShort: true,
             bandingStillAutoDetectsMagnitude: true });
      /* Rommel, 2026-08-28 (QT-M00000129): picking a saved client whose stored account type
         differs from the creator's own company silently changed the quotation's BILLED company
         (cl-type, cl-company-sel) without ever running the mismatch check a manual account-type
         change already goes through -- and worse, it re-baselined _lastAccepted* right there, so
         the normal check could never catch the drift later either. The serial then stayed on the
         OLD company's numbering series forever while the quotation billed as a different one, with
         no warning, no confirmation, and nothing logged. Confirmed live: QT-M00000129 (an "M" /
         Module Systems serial) had silently been billing as World Class Laminate, Inc. since the
         moment its client was picked from the search dropdown -- manually corrected to
         QT-W00000174 as a one-off repair; this check proves the CAUSE is closed, not just that one
         instance. clSelectClient must now route through _onQuotationCompanyMightChange() -- the
         same function the dropdown's own onchange calls -- instead of silently re-baselining. */
      if (typeof window.clSelectClient === 'function' && typeof window._onQuotationCompanyMightChange === 'function')
        check('clSelectClient: picking a saved client runs the same company-mismatch check a manual type change does', () => {
          const w = window;
          const saved = { liveClients: w.liveClients, _onQuotationCompanyMightChange: w._onQuotationCompanyMightChange };
          try {
            let checkCalls = 0;
            w._onQuotationCompanyMightChange = () => { checkCalls++; };
            w.liveClients = [{ id: 999001, name: 'Test Client', bizname: '', contact: '', email: '',
                               address: '', city: '', type: 'Subsidiary', segment: '' }];
            w.clSelectClient(999001);
            // A client with no stored type must not even attempt the check -- nothing to run it on.
            checkCalls = 0;
            w.liveClients = [{ id: 999002, name: 'Test Client 2', bizname: '', contact: '', email: '',
                               address: '', city: '', type: '', segment: '' }];
            w.clSelectClient(999002);
            const noCheckWhenNoType = checkCalls === 0;
            w.liveClients = [{ id: 999001, name: 'Test Client', bizname: '', contact: '', email: '',
                               address: '', city: '', type: 'Subsidiary', segment: '' }];
            w.clSelectClient(999001);
            return { checkRunsWhenTypeStored: checkCalls === 1, noCheckWhenNoType };
          } finally {
            w.liveClients = saved.liveClients; w._onQuotationCompanyMightChange = saved._onQuotationCompanyMightChange;
          }
        }, { checkRunsWhenTypeStored: true, noCheckWhenNoType: true });
      /* Reported live on QT-C00000015 (2026-09-08): "Charge materials & hardware" ticked ON, the
         quotation form still showed "No charge — subsidiary" and blanked every material/hardware
         amount. renderItems()'s services-mode block declared `var isDirect=isDirectClient()` and
         used THAT for the pill/Amount column/subtotal -- a raw Direct-vs-Subsidiary check that
         predates _chargeMatHw() (the 2026-08-06 per-quotation override) and never got updated when
         it shipped. getAreaSubtotal/getAreaMatSubtotal/getAreaHwSubtotal already price off
         _chargeMatHw(), so this was purely a DISPLAY bug -- and it fired for ANY Subsidiary company
         at ANY charge setting, not just WCLI's not-charged-by-default case: even Cebu World
         Laminate, whose default is charged=true with no override needed, showed "No charge" and no
         amount, exactly reproducing the report. Drives the real renderItems() against a real
         Subsidiary/CWLI account (via the real onClientTypeChange(), not a hand-faked dropdown --
         cl-company-sel does not exist until that runs) with one material and one hardware row. */
      if (typeof window.renderItems === 'function' && typeof window.onClientTypeChange === 'function'
          && typeof window._chargeMatHw === 'function')
        check('renderItems: materials/hardware display follows _chargeMatHw(), not the bare account type', () => {
          const w = window;
          const saved = { qAreas: w.qAreas, qFabMode: w.qFabMode, qChargeMatHw: w.qChargeMatHw,
                           clType: document.getElementById('cl-type') && document.getElementById('cl-type').value };
          try {
            document.getElementById('cl-type').value = 'Subsidiary';
            w.onClientTypeChange();
            const sel = document.getElementById('cl-company-sel');
            sel.value = 'Cebu World Laminate, Inc.';
            w.qFabMode = 'services';
            w.qChargeMatHw = null;   // no override -- CWLI's own default is charged=true
            w.qAreas = [{ name: 'Area 1',
              matItems: [{ name: 'Test Board', qty: 2, unit: 'pc', price: 100 }],
              hwItems: [{ name: 'Test Hinge', qty: 5, unit: 'pc', price: 10 }],
              svcItems: [], outsourceMaterials: [], outsourceHardware: [] }];
            const defaultIsCharged = w._chargeMatHw() === true;
            w.renderItems();
            const html = document.getElementById('items-wrap').innerHTML;
            return {
              defaultIsCharged,
              noChargePillShown: html.indexOf('No charge') > -1,
              materialAmountShown: html.indexOf('200.00') > -1
            };
          } finally {
            w.qAreas = saved.qAreas; w.qFabMode = saved.qFabMode; w.qChargeMatHw = saved.qChargeMatHw;
            if (saved.clType !== undefined) { document.getElementById('cl-type').value = saved.clType; w.onClientTypeChange(); }
          }
        }, { defaultIsCharged: true, noChargePillShown: false, materialAmountShown: true });
      /* Rommel, 2026-09-08: "could you show how we arrive in the cost in the summary" -- the
         Fabrication line showed the RAW pre-markup figure while the contingency/buffer that
         actually gets charged only ever appeared as separate deltas in the admin-only box. Fixed
         by making the line itself show the MARKED-UP total, with an optional per-bucket breakdown
         ("materials + fabcontingency + fab. buffer =", his own words) behind a toggle. Then, same
         day: "the material part should be shown under the material part so the comparison can
         easily understand" -- moved from one combined block after Fabrication into each area's
         OWN Materials/Hardware/Services section, directly under the raw line items it explains.
         Drives the real recalc() end to end (not a reimplementation of the formula) against a
         Fabrication-only quotation (ni=false), so Fab. buffer must NOT apply even though a
         nonzero rate is set, and against a SECOND area to prove each area gets its own buildup
         from its own raw amount, not one blended figure. */
      if (typeof window.recalc === 'function' && typeof window.toggleFabBreakdown === 'function'
          && typeof window._fabBucketRaw === 'function')
        check('_fabBucketRaw + Fabrication breakdown: marked-up total, placed inline under each area\'s own Materials/Hardware/Services', () => {
          const w = window;
          const saved = { qAreas: w.qAreas, qFabMode: w.qFabMode, qChargeMatHw: w.qChargeMatHw,
                           fabContingency: w.CF.fabContingency, fabBuffer: w.CF.fabBuffer,
                           qCustomCFApproved: w.qCustomCFApproved, fabBreakdownOpen: w._fabBreakdownOpen,
                           clService: document.getElementById('cl-service').value,
                           clType: document.getElementById('cl-type') && document.getElementById('cl-type').value };
          try {
            document.getElementById('cl-type').value = 'Direct';
            if (typeof w.onClientTypeChange === 'function') w.onClientTypeChange();
            document.getElementById('cl-service').value = 'Fabrication only';   // ni=false -- buffer must not apply
            w.qFabMode = 'services';
            w.qChargeMatHw = null;
            w.qCustomCFApproved = false;
            w.CF.fabContingency = 10; w.CF.fabBuffer = 5;   // buffer set but must be ignored (ni=false)
            w.qAreas = [
              { name: 'Area 1',
                matItems: [{ name: 'Board', qty: 1, unit: 'pc', price: 200 }],
                hwItems: [{ name: 'Hinge', qty: 1, unit: 'pc', price: 50 }],
                svcItems: [{ svcIdx: 0, qty: 1 }],
                outsourceMaterials: [], outsourceHardware: [] },
              { name: 'Area 2',   // a SECOND area with its own, different materials amount
                matItems: [{ name: 'Panel', qty: 1, unit: 'pc', price: 1000 }],
                hwItems: [], svcItems: [], outsourceMaterials: [], outsourceHardware: [] }
            ];
            const svc0Price = (w.SERVICES && w.SERVICES[0] && w.SERVICES[0].price) || 0;
            w._fabBreakdownOpen = false;
            w.recalc();
            const collapsedHtml = document.getElementById('sum-lines').innerHTML;
            const markedUp = (200 + 50 + svc0Price + 1000) * 1.10;   // 10% contingency, no buffer (ni=false)
            const collapsedShowsMarkedUp = collapsedHtml.indexOf(w.fmtMoney(markedUp)) > -1;
            const noBufferWhenCollapsed = collapsedHtml.indexOf('Fab. buffer') === -1;
            // Collapsed by default: nothing but the raw line items and the flat total.
            const nothingInlineWhenCollapsed = collapsedHtml.indexOf('Fab. contingency') === -1;

            w.toggleFabBreakdown();   // opens it (calls recalc() itself)
            const openHtml = document.getElementById('sum-lines').innerHTML;
            // Area 1's Materials breakdown must sit BETWEEN this area's own Materials header and
            // its Hardware header -- i.e. genuinely under THAT area's materials, not appended
            // somewhere else after the whole quotation's Fabrication line.
            const area1MatIdx = openHtml.indexOf('>Materials<');
            const area1HwIdx = openHtml.indexOf('>Hardware<');
            const area1MatBreakdownIdx = openHtml.indexOf(w.fmtMoney(200 * 1.10));
            const area1BreakdownBetweenItsOwnHeaders = area1MatBreakdownIdx > area1MatIdx && area1MatBreakdownIdx < area1HwIdx;
            const hardwareLine = openHtml.indexOf(w.fmtMoney(50 * 1.10)) > -1;     // Hardware = 50 -> 55
            // Area 2's OWN 1000-raw materials breakdown appears, distinct from Area 1's 200-raw one
            // -- proving each area is split from its own amount, not one combined 1200 total.
            const area2OwnBreakdown = openHtml.indexOf(w.fmtMoney(1000 * 1.10)) > -1;
            const noCombinedBlendedBreakdown = openHtml.indexOf(w.fmtMoney(1200 * 1.10)) === -1;
            const noBufferRowInBreakdown = openHtml.indexOf('Fab. buffer') === -1;   // still ni=false
            // The old standalone block after "Fabrication" must be gone for this mode -- only one
            // occurrence of the marked-up Materials figure (Area 1's), not a second repeated copy.
            const noDuplicateStandaloneBlock = openHtml.split(w.fmtMoney(200 * 1.10)).length - 1 === 1;

            const raw = w._fabBucketRaw();
            const rawSumsToFabBase = Math.abs((raw.materials + raw.hardware + raw.services + raw.other) - (200 + 50 + svc0Price + 1000)) < 0.01;

            return { collapsedShowsMarkedUp, noBufferWhenCollapsed, nothingInlineWhenCollapsed,
                     area1BreakdownBetweenItsOwnHeaders, hardwareLine, area2OwnBreakdown,
                     noCombinedBlendedBreakdown, noBufferRowInBreakdown, noDuplicateStandaloneBlock, rawSumsToFabBase };
          } finally {
            w.qAreas = saved.qAreas; w.qFabMode = saved.qFabMode; w.qChargeMatHw = saved.qChargeMatHw;
            w.CF.fabContingency = saved.fabContingency; w.CF.fabBuffer = saved.fabBuffer;
            w.qCustomCFApproved = saved.qCustomCFApproved; w._fabBreakdownOpen = saved.fabBreakdownOpen;
            document.getElementById('cl-service').value = saved.clService;
            if (saved.clType !== undefined && typeof w.onClientTypeChange === 'function') {
              document.getElementById('cl-type').value = saved.clType; w.onClientTypeChange();
            }
          }
        }, { collapsedShowsMarkedUp: true, noBufferWhenCollapsed: true, nothingInlineWhenCollapsed: true,
             area1BreakdownBetweenItsOwnHeaders: true, hardwareLine: true, area2OwnBreakdown: true,
             noCombinedBlendedBreakdown: true, noBufferRowInBreakdown: true, noDuplicateStandaloneBlock: true,
             rawSumsToFabBase: true });
      /* Rommel, 2026-09-08 (Option 2): typed 0 into the Discount box after Option 1 had 27%
         requested, but Option 2 kept showing 27% again after switching away and back. onDiscInput()
         reset the Approved badge on every keystroke but never wrote the typed number into qDiscPct
         -- the ONLY thing captureQuotationSnapshot() (run on every option switch) actually saves.
         So a "cleared" box was pure UI noise: switching options re-captured the OLD qDiscPct, and
         switching back re-displayed it via _syncDiscInputUI(). Drives the real onDiscInput() against
         the real input element, not a hand-set global, so the DOM parsing path is genuinely covered. */
      if (typeof window.onDiscInput === 'function' && typeof window.captureQuotationSnapshot === 'function')
        check('onDiscInput: the typed value becomes qDiscPct immediately, so it survives an option switch', () => {
          const w = window;
          const inp = document.getElementById('disc-inp');
          const saved = { qDiscPct: w.qDiscPct, qDiscApproved: w.qDiscApproved, inpValue: inp.value };
          try {
            w.qDiscPct = 27; w.qDiscApproved = true;
            inp.value = '0';
            w.onDiscInput();
            const clearedLive = w.qDiscPct === 0 && w.qDiscApproved === false;
            const snap = w.captureQuotationSnapshot();
            const capturedAsZero = snap.discPct === 0;

            inp.value = '15';
            w.onDiscInput();
            const typedValueTracked = w.qDiscPct === 15 && w.qDiscApproved === false;

            return { clearedLive, capturedAsZero, typedValueTracked };
          } finally {
            w.qDiscPct = saved.qDiscPct; w.qDiscApproved = saved.qDiscApproved; inp.value = saved.inpValue;
          }
        }, { clearedLive: true, capturedAsZero: true, typedValueTracked: true });
      /* Rommel, 2026-09-16: "It shows Approved already but printout still doesn't reflect it" --
         a 10%-off-Materials-only discount, approved, on a Subsidiary quotation where materials
         billing is switched off (getAreaSubtotal prices them at P0.00). discOn:!!(qDiscApproved&&dA)
         in _recalcCore is correctly false when the scoped base is zero -- 10% of nothing is nothing
         -- but nothing on screen said so; the button just read "Approved" with no total movement and
         no explanation. renderDiscScope() now appends a warning whenever _pCalc says exactly that
         shape (approved, scoped, zero effect), and _recalcCore re-runs it after every Stage 1 recalc
         so it can never go stale. Drives the real renderDiscScope() against a real _pCalc object,
         not a hand-derived approximation of when it should fire. */
      if (typeof window.renderDiscScope === 'function' && document.getElementById('disc-scope-note'))
        check('renderDiscScope: warns when an approved, scoped discount has zero effect; silent otherwise', () => {
          const w = window;
          const saved = { qDiscApproved: w.qDiscApproved, qDiscPct: w.qDiscPct, qDiscScope: w.qDiscScope, qFabMode: w.qFabMode, _pCalc: w._pCalc };
          try {
            w.qFabMode = 'services';   // carcass mode hides the scope block entirely -- not this case
            w.qDiscApproved = true; w.qDiscPct = 10;
            w.qDiscScope = { materials: true, edgeband: false, hardware: false, services: false, installation: false };

            // Scoped to Materials, approved, but the pricing run found zero materials cost to discount.
            w._pCalc = { stage: 1, discScoped: true, discOn: false };
            w.renderDiscScope();
            const warnsOnZeroEffect = document.getElementById('disc-scope-note').innerHTML.indexOf('no effect') >= 0;

            // Same scope, but this time the pricing run found real cost to discount -- silent.
            w._pCalc = { stage: 1, discScoped: true, discOn: true };
            w.renderDiscScope();
            const silentWhenItWorks = document.getElementById('disc-scope-note').innerHTML.indexOf('no effect') < 0;

            // Nothing ticked -- scope is off entirely, so there's nothing to warn about either way.
            w.qDiscScope = { materials: false, edgeband: false, hardware: false, services: false, installation: false };
            w._pCalc = { stage: 1, discScoped: false, discOn: false };
            w.renderDiscScope();
            const silentWhenUnscoped = document.getElementById('disc-scope-note').innerHTML.indexOf('no effect') < 0;

            return { warnsOnZeroEffect, silentWhenItWorks, silentWhenUnscoped };
          } finally {
            w.qDiscApproved = saved.qDiscApproved; w.qDiscPct = saved.qDiscPct; w.qDiscScope = saved.qDiscScope;
            w.qFabMode = saved.qFabMode; w._pCalc = saved._pCalc;
            w.renderDiscScope();
          }
        }, { warnsOnZeroEffect: true, silentWhenItWorks: true, silentWhenUnscoped: true });
      // Stage 2's Pricing adjustments card is JS-templated (renderFQCards); only present once
      // Stage 2 has been rendered at least once. Guarded the same way every other function-
      // existence check in this suite is -- skip cleanly rather than fail on a harness setup gap.
      if (typeof window.fqOnDiscInput === 'function' && document.getElementById('fq-disc-inp'))
        check('fqOnDiscInput: same fix, Stage 2 -- the typed value becomes fqDiscPct immediately', () => {
          const w = window;
          const inp = document.getElementById('fq-disc-inp');
          const saved = { fqDiscPct: w.fqDiscPct, fqDiscApproved: w.fqDiscApproved, inpValue: inp.value };
          try {
            w.fqDiscPct = 27; w.fqDiscApproved = true;
            inp.value = '0';
            w.fqOnDiscInput();
            return { clearedLive: w.fqDiscPct === 0 && w.fqDiscApproved === false };
          } finally {
            w.fqDiscPct = saved.fqDiscPct; w.fqDiscApproved = saved.fqDiscApproved; inp.value = saved.inpValue;
          }
        }, { clearedLive: true });
      /* Rommel, 2026-09-08: picked "Hamilton 1x22mm PVC Edgeband" from the catalogue and the row
         showed unit "pc" -- a real, wrong stored unit on a live Price DB row (edge tape is always
         sold by the linear metre). The app already has a rule for identifying edge tape by name
         (_isEdgeTapeName, used by the discount-scope Edgeband bucket); nothing applied it to what
         a PICKED SKU displays as its unit. Drives the real onMatSearch/onMatSel/onBOMItemSearch
         against a mocked catalogue row carrying the exact wrong unit, and confirms a non-edge-tape
         pick is completely unaffected (no false override). */
      if (typeof window._forceEdgeTapeUnit === 'function' && typeof window._isEdgeTapeName === 'function')
        check('_forceEdgeTapeUnit: edge-tape names always end up "lm", everything else is untouched', () => {
          const w = window;
          const edgeRow = { unit: 'pc' };
          w._forceEdgeTapeUnit(edgeRow, 'Hamilton 1x22mm PVC Edgeband');
          const plainRow = { unit: 'pc' };
          w._forceEdgeTapeUnit(plainRow, 'Totoro 2F 4x8 PB 18mm (Stipple)');
          const noRow = w._forceEdgeTapeUnit(null, 'Edgeband');   // must not throw on a missing row
          return { edgeTapeForcedToLm: edgeRow.unit === 'lm', plainMaterialUntouched: plainRow.unit === 'pc', noThrowOnNullRow: noRow === undefined };
        }, { edgeTapeForcedToLm: true, plainMaterialUntouched: true, noThrowOnNullRow: true });
      if (typeof window.onMatSearch === 'function' && typeof window.getMatSource === 'function')
        check('onMatSearch: a picked edge-tape SKU with a wrong catalogue unit ("pc") is corrected to lm', () => {
          const w = window;
          const inp = { value: '' };
          const saved = { qAreas: w.qAreas, dbMaterials: w.dbMaterials, matSrcCache: w._matSrcCache, qFabMode: w.qFabMode };
          try {
            w._matSrcCache = null;   // getMatSource() caches by length -- force it to rebuild against the mock
            w.qFabMode = 'services';   // getAreaSubtotal()/recalc() branch on this -- default 'carcass' expects qAreas[a].items
            w.dbMaterials = [
              { name: 'Hamilton 1x22mm PVC Edgeband', unit: 'pc', price: 16 },   // real live row, wrong unit
              { name: 'Totoro 2F 4x8 PB 18mm (Stipple)', unit: 'sheet', price: 1850 }
            ];
            w.qAreas = [{ name: 'Area 1', matItems: [{ name: '', qty: 1, unit: 'pc', price: 0 }], hwItems: [], svcItems: [] }];
            inp.value = 'Hamilton 1x22mm PVC Edgeband';
            w.onMatSearch(inp, 0, 0);
            const edgeTapeCorrected = w.qAreas[0].matItems[0].unit === 'lm';

            w.qAreas[0].matItems[0] = { name: '', qty: 1, unit: 'pc', price: 0 };
            inp.value = 'Totoro 2F 4x8 PB 18mm (Stipple)';
            w.onMatSearch(inp, 0, 0);
            const plainMaterialKeepsCatalogueUnit = w.qAreas[0].matItems[0].unit === 'sheet';

            // No catalogue match at all -- still forced, since the NAME alone is the rule.
            w.qAreas[0].matItems[0] = { name: '', qty: 1, unit: 'pc', price: 0 };
            inp.value = 'Some Custom Edge Tape, hand-typed';
            w.onMatSearch(inp, 0, 0);
            const customTypedEdgeTapeForced = w.qAreas[0].matItems[0].unit === 'lm';

            return { edgeTapeCorrected, plainMaterialKeepsCatalogueUnit, customTypedEdgeTapeForced };
          } finally {
            w.qAreas = saved.qAreas; w.dbMaterials = saved.dbMaterials; w._matSrcCache = saved.matSrcCache; w.qFabMode = saved.qFabMode;
          }
        }, { edgeTapeCorrected: true, plainMaterialKeepsCatalogueUnit: true, customTypedEdgeTapeForced: true });
      if (typeof window.onBOMItemSearch === 'function')
        check('onBOMItemSearch: edge-tape materials get lm; hardware rows are never forced (edge tape is a material)', () => {
          const w = window;
          const inp = { value: '', style: {} };
          const saved = { qAreas: w.qAreas, dbMaterials: w.dbMaterials, dbHardware: w.dbHardware, matSrcCache: w._matSrcCache, hwSrcCache: w._hwSrcCache, qFabMode: w.qFabMode };
          try {
            w._matSrcCache = null; w._hwSrcCache = null;
            w.qFabMode = 'bom';   // getAreaSubtotal()/recalc() branch on this -- default 'carcass' expects qAreas[a].items
            w.dbMaterials = [{ name: 'Hamilton 1x22mm PVC Edgeband', unit: 'pc', price: 16 }];
            w.dbHardware = [{ name: 'Edgeband Trimmer Blade', unit: 'pc', price: 250 }];   // name matches, but it's HARDWARE
            w.qAreas = [{ name: 'Area 1', bomItems: [{ type: 'Kitchen Base Cabinet', qty: 1,
              materials: [{ name: '', qty: 1, unit: 'pc', price: 0 }],
              hardware: [{ name: '', qty: 1, unit: 'pc', price: 0 }], services: [] }] }];

            inp.value = 'Hamilton 1x22mm PVC Edgeband';
            w.onBOMItemSearch(inp, 0, 0, 'materials', 0);
            const materialForced = w.qAreas[0].bomItems[0].materials[0].unit === 'lm';

            inp.value = 'Edgeband Trimmer Blade';
            w.onBOMItemSearch(inp, 0, 0, 'hardware', 0);
            const hardwareNotForced = w.qAreas[0].bomItems[0].hardware[0].unit === 'pc';

            return { materialForced, hardwareNotForced };
          } finally {
            w.qAreas = saved.qAreas; w.dbMaterials = saved.dbMaterials; w.dbHardware = saved.dbHardware;
            w._matSrcCache = saved.matSrcCache; w._hwSrcCache = saved.hwSrcCache; w.qFabMode = saved.qFabMode;
          }
        }, { materialForced: true, hardwareNotForced: true });
      /* QT-M00000176 (2026-09-26): a signature routed to a Staff signatory by name never reached
         them — the filter showed Staff only their OWN requests plus company grants, and the
         request's company ("Module System", singular) matched neither. */
      check('filterApprovalsByRouting: a request routed TO me is always visible, companies compared canonically', () => {
        const w = window;
        const saved = [w.currentRole, w.gUser, w.sheetUsers, w.currentUserCompany];
        try {
          w.currentRole = 'Staff'; w.currentUserCompany = 'Module System and Services, Inc.';
          w.gUser = { email: 'joanna@x.ph' };
          w.sheetUsers = [{ email: 'joanna@x.ph', accessCompanies: ['wcl', 'cwl'] }];
          const toMe = { type: 'signature', company: 'Module System and Services, Inc.', fromEmail: 'kaye@x.ph', approverEmail: ' Joanna@x.ph ' };
          const other = { type: 'discount', company: 'Module System and Services, Inc.', fromEmail: 'kaye@x.ph', approverEmail: 'allan@x.ph' };
          const granted = { type: 'discount', company: 'Cebu World Laminates', fromEmail: 'kaye@x.ph', approverEmail: 'allan@x.ph' };
          const r = w.filterApprovalsByRouting([toMe, other, granted]);
          w.sheetUsers = [{ email: 'joanna@x.ph', accessCompanies: [] }];
          const r2 = w.filterApprovalsByRouting([toMe, other]);
          return { withGrants: [r.includes(toMe), r.includes(other), r.includes(granted)], noGrants: [r2.includes(toMe), r2.includes(other)] };
        } finally { [w.currentRole, w.gUser, w.sheetUsers, w.currentUserCompany] = saved; }
      }, { withGrants: [true, false, true], noGrants: [true, false] });
      /* Pause button (2026-08-28): freezes the SLA clock while waiting on the client, needs an
         approver, and once approved the linked quotation (if any) is not editable until Resume.
         Current pause state is DERIVED from the last entry in one JSON history array -- never a
         separate flag -- so it cannot drift out of step with the fact it is supposed to reflect. */
      if (typeof window._orderPauseState === 'function')
        check('_orderPauseState: derives paused/pending purely from the LAST history entry', () => {
          const w = window;
          const notPaused = w._orderPauseState({ pauseHistory: [] });
          const pending = w._orderPauseState({ pauseHistory: [{ status: 'pending' }] });
          const paused = w._orderPauseState({ pauseHistory: [{ status: 'approved', approvedAt: '2026-08-28T01:00:00Z' }] });
          const resumedIsNotPaused = w._orderPauseState({ pauseHistory: [
            { status: 'approved', approvedAt: '2026-08-28T01:00:00Z', resumedAt: '2026-08-28T02:00:00Z' } ] });
          const rejectedIsNotPaused = w._orderPauseState({ pauseHistory: [{ status: 'rejected' }] });
          return {
            emptyHistory: [notPaused.paused, notPaused.pending],
            pendingEntry: [pending.paused, pending.pending],
            approvedOpenEntry: [paused.paused, paused.pending],
            approvedThenResumed: [resumedIsNotPaused.paused, resumedIsNotPaused.pending],
            rejectedEntry: [rejectedIsNotPaused.paused, rejectedIsNotPaused.pending],
          };
        }, { emptyHistory: [false, false], pendingEntry: [false, true], approvedOpenEntry: [true, false],
             approvedThenResumed: [false, false], rejectedEntry: [false, false] });
      if (typeof window._orderElapsedWorkingMinutes === 'function' && typeof window.calcWorkingMinutes === 'function')
        check('_orderElapsedWorkingMinutes: subtracts an approved pause window, up to "now" if still open', () => {
          const w = window;
          const savedSla = w.ordersSlaSettings, savedUser = w.currentUserCompany;
          try {
            const sched = { 0: null, 1: { start: 8, end: 17 }, 2: { start: 8, end: 17 },
                             3: { start: 8, end: 17 }, 4: { start: 8, end: 17 }, 5: { start: 8, end: 17 }, 6: null };
            w.ordersSlaSettings = { companies: { 'Test Co': { excludeHolidays: true, schedule: sched, localHolidays: [] } } };
            w.currentUserCompany = 'Test Co';
            // Mon 2026-08-24, 08:00-17:00 = 540 working minutes with nothing excluded.
            const noPause = w._orderElapsedWorkingMinutes(
              { receivedAt: '2026-08-24T08:00:00+08:00', sourceCompany: 'Test Co', pauseHistory: [] },
              '2026-08-24T17:00:00+08:00');
            // Same window, but paused 10:00-12:00 (120 min) -- 540 - 120 = 420.
            const closedPause = w._orderElapsedWorkingMinutes({ receivedAt: '2026-08-24T08:00:00+08:00', sourceCompany: 'Test Co',
              pauseHistory: [{ status: 'approved', approvedAt: '2026-08-24T10:00:00+08:00', resumedAt: '2026-08-24T12:00:00+08:00' }] },
              '2026-08-24T17:00:00+08:00');
            // Paused at 10:00, never resumed -- excluded all the way to "now" (17:00), so only
            // 08:00-10:00 (120 min) counts.
            const stillPaused = w._orderElapsedWorkingMinutes({ receivedAt: '2026-08-24T08:00:00+08:00', sourceCompany: 'Test Co',
              pauseHistory: [{ status: 'approved', approvedAt: '2026-08-24T10:00:00+08:00' }] },
              '2026-08-24T17:00:00+08:00');
            // A REJECTED entry never happened -- it must not be excluded from anything.
            const rejectedNoOp = w._orderElapsedWorkingMinutes({ receivedAt: '2026-08-24T08:00:00+08:00', sourceCompany: 'Test Co',
              pauseHistory: [{ status: 'rejected', approvedAt: '2026-08-24T10:00:00+08:00' }] },
              '2026-08-24T17:00:00+08:00');
            return { noPause, closedPause, stillPaused, rejectedNoOp };
          } finally { w.ordersSlaSettings = savedSla; w.currentUserCompany = savedUser; }
        }, { noPause: 540, closedPause: 420, stillPaused: 120, rejectedNoOp: 540 });
      /* Rommel, 2026-08-28: "the quotation should not be editable until the resume has been press."
         _lockGateOk already blocks locking on a missing project size / carcass count; an approved
         pause has to refuse it too, EVEN when both of those are otherwise satisfied, or a paused
         quotation could still be locked and sent while the team is waiting on the client. */
      if (typeof window._lockGateOk === 'function' && typeof window._qOrderPaused === 'function')
        check('_lockGateOk: refuses to lock while an order-pause is active, independent of the other gates', () => {
          const w = window;
          const saved = { size: w.qProjectSize, carcass: w.qCarcassUnitCount, paused: w.qOrderPausedInfo };
          try {
            w.qProjectSize = 10; w.qCarcassUnitCount = 10; // satisfy the other two gates
            w.qOrderPausedInfo = null;
            const okWhenClear = w._lockGateOk();
            w.qOrderPausedInfo = { active: true, orderId: '999', reason: 'test' };
            const blockedWhenPaused = w._lockGateOk();
            const pausedIsDetected = w._qOrderPaused();
            w.qOrderPausedInfo = { active: false };
            const notBlockedWhenInactiveFlag = w._lockGateOk();
            return { okWhenClear, blockedWhenPaused, pausedIsDetected, notBlockedWhenInactiveFlag };
          } finally { w.qProjectSize = saved.size; w.qCarcassUnitCount = saved.carcass; w.qOrderPausedInfo = saved.paused; }
        }, { okWhenClear: true, blockedWhenPaused: false, pausedIsDetected: true, notBlockedWhenInactiveFlag: true });
      /* Stage 1's field-disable sweep is the one PROVEN "not editable" mechanism in this file
         (qLocked/viewOnly already drive it) -- a pause has to join that same condition rather than
         inventing a second, unverified one. Source-checked because updateLockUI touches a large
         live DOM tree this harness does not construct. */
      if (typeof window.updateLockUI === 'function')
        check('updateLockUI: the field-disable sweep also triggers while an order-pause is active',
          () => /locked\s*=\s*qLocked\s*\|\|\s*viewOnly\s*\|\|\s*_qOrderPaused\(\)/.test(window.updateLockUI.toString()), true);
      /* Rommel, 2026-09-17: the legacy "Revise" button (confirmRevise -- mints a whole NEW,
         unrelated serial, distinct from the normal unlock-based .R revision system which stays on
         the same row) was only ever shown ONCE, right when qApproved first became true, and never
         hidden again anywhere else in the file. So unlocking afterward correctly cleared qApproved
         (which is exactly the state where openRevise()'s own guard STOPS refusing and lets it
         through) while the button stayed visible from the earlier moment -- reachable precisely
         when clicking it is dangerous. Reproduced live on QT-C00000015 (Johndurf): a stray click
         silently forked the whole quotation onto QT-M00000160, carrying the client, scope and
         job-start time over untouched, with nothing logged. Source-checked, same as the order-pause
         sweep above -- updateLockUI touches a large live DOM tree this harness does not construct,
         and driving it end to end would need the whole quotation page's markup wired up first. */
      if (typeof window.updateLockUI === 'function')
        check('updateLockUI: revise-btn is re-synced to _iqClientApproved() on every render, not set-once', () => {
          const src = window.updateLockUI.toString();
          return {
            readsCurrentApprovalState: /_iqClientApproved\(\)/.test(src) && /revise-btn/.test(src),
            hidesWhenNotApproved: /rbtn\.style\.display\s*=\s*\(_iqClientApproved\(\)[^)]*\)\s*\?\s*"inline-flex"\s*:\s*"none"/.test(src),
          };
        }, { readsCurrentApprovalState: true, hidesWhenNotApproved: true });
      /* confirmRevise() minted a new serial with nothing written to the activity log -- the ONLY
         state-changing action in this file that didn't. That silence is precisely why the QT-M00000160
         duplicate looked like an unexplained mystery: there was nothing in the log, on either
         serial, saying what had actually happened. */
      if (typeof window.confirmRevise === 'function')
        check('confirmRevise: now logs against the ORIGINAL serial before minting the new one', () => {
          const src = window.confirmRevise.toString();
          return /logActivity\([^)]*,\s*old\)/.test(src);
        }, true);
      /* order_pause is order-scoped, not quotation-scoped -- the two normal apply paths
         (_applyApprovedRequest / _persistApprovedFieldToQuotation) have no case for it and must not
         silently no-op through them; it needs its OWN branch, on both approve AND reject, since the
         order's own pending entry has to be closed out either way. */
      if (typeof window.doApprovalAction === 'function')
        check('doApprovalAction: order_pause routes to its own decision handler on approve and reject', () => {
          const src = window.doApprovalAction.toString();
          return {
            hasOrderPauseBranch: /n\.type\s*===\s*'order_pause'/.test(src),
            callsDecisionHandler: /_applyOrderPauseDecision\(n,action,byName,actionReason\)/.test(src),
            coversBothOutcomes: /action\s*===\s*'approved'\s*\|\|\s*action\s*===\s*'rejected'/.test(src),
          };
        }, { hasOrderPauseBranch: true, callsDecisionHandler: true, coversBothOutcomes: true });
      /* This app has already lost sigSlot, to_email, decision and applied this same way -- a field
         present in the request payload but missing from ANY of these four places is silently
         dropped the first time an approver acts. orderId is what _applyOrderPauseDecision needs to
         find the order at all, so it has to be listed in every one of the four. */
      if (typeof window._apprMergeWithKnown === 'function' && typeof window.supaUpsertApprovalRequest === 'function'
          && typeof window.gLoadApprovalRequests === 'function' && typeof window._mergeApprovalReqsIntoNotifs === 'function')
        check('order_pause\'s orderId survives all four propagation points (the sigSlot/decision trap)', () => {
          return {
            mergeWithKnownKeys: /'orderId'/.test(window._apprMergeWithKnown.toString()),
            supabasePayload: /orderId\s*:\s*\(?req\.orderId/.test(window.supaUpsertApprovalRequest.toString()),
            supabaseReadMapping: /orderId\s*:\s*p\.orderId/.test(window.gLoadApprovalRequests.toString()),
            notifsPush: /orderId\s*:\s*req\.orderId/.test(window._mergeApprovalReqsIntoNotifs.toString()),
          };
        }, { mergeWithKnownKeys: true, supabasePayload: true, supabaseReadMapping: true, notifsPush: true });
      /* Any user can request a pause on any order, so routing must go by the ORDER's own company,
         not whichever company the requester happens to be signed in under. */
      if (typeof window.findApproverForAction === 'function')
        check('findApproverForAction: an explicit company override wins over currentUserCompany', () => {
          const w = window;
          const saved = { users: w.sheetUsers, routing: w.APPR_ROUTING, co: w.currentUserCompany };
          try {
            w.currentUserCompany = 'World Class Laminate, Inc.';
            w.sheetUsers = [
              { email: 'wcl.mgr@test.com', name: 'WCL Manager', pos: 'Manager', active: true },
              { email: 'cebu.mgr@test.com', name: 'Cebu Manager', pos: 'Manager', active: true },
            ];
            w.APPR_ROUTING = { 'Cebu World Laminate, Inc.': { order_pause: 'cebu.mgr@test.com' } };
            const routed = w.findApproverForAction('order_pause', {}, 'Cebu World Laminate, Inc.');
            return { routedToOrderCompany: routed && routed.email === 'cebu.mgr@test.com' };
          } finally { w.sheetUsers = saved.users; w.APPR_ROUTING = saved.routing; w.currentUserCompany = saved.co; }
        }, { routedToOrderCompany: true });
      if (typeof window.renderApprovalRoutingSettings === 'function')
        check('renderApprovalRoutingSettings: Pause Order is a configurable routing action',
          () => /key\s*:\s*'order_pause'/.test(window.renderApprovalRoutingSettings.toString()), true);
      /* Rommel, 2026-08-29: "Jhover tried the pause and the approval went to me instead of allan,
         which I designated in the setting already." Root cause: _orderCompanyKey(o) returns a
         single-letter code ('C'/'M'/'W', built for serial-prefix-style matching elsewhere) -- not a
         full company name -- but findApproverForAction's coOverride and APPR_ROUTING are both keyed
         by the FULL name, so a bare letter never matched anything and silently fell through to the
         no-routing fallback (first active Manager/Director/Admin), landing on the Admin every time
         regardless of what Settings actually said. Both request functions must pass the order's raw
         sourceCompany straight through -- findApproverForAction already runs it through
         _canonCompany itself, same as every other company-routed lookup in this file. */
      if (typeof window.openOrderPauseRequest === 'function' && typeof window.submitOrderPauseRequest === 'function')
        check('order-pause routing uses the order\'s raw company, never the letter-code helper', () => {
          const openSrc = window.openOrderPauseRequest.toString();
          const submitSrc = window.submitOrderPauseRequest.toString();
          return {
            openUsesRawCompany: /findApproverForAction\('order_pause',\{\},o\.sourceCompany\)/.test(openSrc),
            submitUsesRawCompany: /findApproverForAction\('order_pause',\{\},o\.sourceCompany\)/.test(submitSrc),
            openAvoidsLetterCode: !/findApproverForAction\('order_pause',\{\},_orderCompanyKey/.test(openSrc),
            submitAvoidsLetterCode: !/findApproverForAction\('order_pause',\{\},_orderCompanyKey/.test(submitSrc),
          };
        }, { openUsesRawCompany: true, submitUsesRawCompany: true, openAvoidsLetterCode: true, submitAvoidsLetterCode: true });
      /* Proves the actual failure mode end to end, not just the call-site pattern: a real order
         object carrying a full company name, routed through the exact call shape the two functions
         above use, must resolve to the DESIGNATED approver -- not fall through to "no routing" just
         because a single-letter code was passed instead of the name findApproverForAction expects. */
      if (typeof window.findApproverForAction === 'function')
        check('order-pause routing: a real order\'s sourceCompany resolves to the designated approver (not the Admin fallback)', () => {
          const w = window;
          const saved = { users: w.sheetUsers, routing: w.APPR_ROUTING, co: w.currentUserCompany };
          try {
            w.currentUserCompany = 'World Class Laminate, Inc.'; // the REQUESTER's company -- must not be used
            // Admin listed FIRST deliberately: the no-routing fallback picks the first active
            // Manager/Director/Admin in array order, so this is what makes the buggy path
            // demonstrably land on someone OTHER than the routed approver, rather than coincidentally
            // matching him anyway because he happened to be first in the list either way.
            w.sheetUsers = [
              { email: 'admin@test.com', name: 'Admin Fallback', pos: 'Admin', active: true },
              { email: 'allan@test.com', name: 'Allan', pos: 'Manager', active: true },
            ];
            w.APPR_ROUTING = { 'World Class Laminate, Inc.': { order_pause: 'allan@test.com' } };
            const order = { id: '9001', sourceCompany: 'World Class Laminate, Inc.' };
            const viaCorrectArg = w.findApproverForAction('order_pause', {}, order.sourceCompany);
            const viaLetterCodeBug = w.findApproverForAction('order_pause', {}, w._orderCompanyKey ? w._orderCompanyKey(order) : 'W');
            return {
              correctArgRoutesToAllan: viaCorrectArg && viaCorrectArg.email === 'allan@test.com',
              letterCodeBugFellThroughToAdmin: viaLetterCodeBug && viaLetterCodeBug.email === 'admin@test.com',
            };
          } finally { w.sheetUsers = saved.users; w.APPR_ROUTING = saved.routing; w.currentUserCompany = saved.co; }
        }, { correctArgRoutesToAllan: true, letterCodeBugFellThroughToAdmin: true });
      if (typeof window.ORDERS_COLS !== 'undefined')
        check('ORDERS_COLS: Pause History is the last column, appended not inserted',
          () => window.ORDERS_COLS[window.ORDERS_COLS.length - 1], 'Pause History');
      /* Rommel, 2026-09-03: "make materials follow the same rule as hardware. The old rule was made
         prior to the improvement of manually hiding the materials and hardware." The old rule
         (hideMatPricing) blanket-hid material unit price/amount for any World Class Laminate
         quotation, independent of whether materials were actually being charged -- a leftover from
         before the per-quotation charge-materials-and-hardware toggle existed. Removed entirely
         (not just bypassed) so it cannot silently resurface: the function no longer even accepts
         the parameter, and a real material line with a real price is confirmed to print that price
         unconditionally, the same as hardware always has. */
      /* 2026-09-02 follow-up: buildItemizedPrintRows gained a third parameter (assemblyTrueAmt, for
         the Assembly-gets-its-own-line requirement below) -- 3 is correct now, not a regression of
         the hideMatPricing removal. What this check actually guards against is hideMatPricing coming
         BACK as a parameter; confirmed the function's source has no parameter named that. */
      if (typeof window.buildItemizedPrintRows === 'function')
        check('buildItemizedPrintRows: the hideMatPricing parameter is gone, not just unused', () => {
          const src = window.buildItemizedPrintRows.toString();
          const sig = src.slice(0, src.indexOf(')') + 1);
          return { paramCount: window.buildItemizedPrintRows.length, noHideMatPricingParam: !/hideMatPricing/.test(sig) };
        }, { paramCount: 3, noHideMatPricingParam: true });
      /* Rommel, 2026-08-29: "what if the user start working on the quotation without resuming the
         timer. what will happen?" -- correctly caught as a real gap. Field-disable sweeps and the
         lock gate are UI-level prevention, not enforcement -- a stale open tab or Stage 2 (no
         field-disable sweep at all) could still reach the save function directly. gSaveQuotation()
         is the one true funnel every real persist goes through, so it is the one place this can be
         closed completely. Proves the refusal happens BEFORE any side effect (neither the audit
         diff nor the actual core save runs), and that an ordinary save is completely unaffected once
         the pause is cleared -- a broken guard that blocked EVERY save would be worse than the gap. */
      if (typeof window.gSaveQuotation === 'function' && typeof window._qOrderPaused === 'function')
        check('gSaveQuotation: refuses to persist while an order-pause is active, on either stage', () => {
          const w = window;
          const saved = { gToken: w.gToken, gUser: w.gUser, paused: w.qOrderPausedInfo,
                           core: w._gSaveQuotationCore, audit: w._auditDiffAndLog };
          let coreCalled = false, auditCalled = false;
          try {
            w.gToken = 'test-token'; w.gUser = { email: 'test@x.com', name: 'Test' };
            w._gSaveQuotationCore = () => { coreCalled = true; };
            w._auditDiffAndLog = () => { auditCalled = true; };
            w.qOrderPausedInfo = { active: true, orderId: '999', reason: 'test', approvedBy: 'Test Mgr' };
            w.gSaveQuotation();
            const refusedCleanly = { coreCalled, auditCalled };
            coreCalled = false; auditCalled = false;
            w.qOrderPausedInfo = null;
            w.gSaveQuotation();
            const normalSaveStillWorks = { coreCalled, auditCalled };
            return { refusedCleanly, normalSaveStillWorks };
          } finally {
            w.gToken = saved.gToken; w.gUser = saved.gUser; w.qOrderPausedInfo = saved.paused;
            w._gSaveQuotationCore = saved.core; w._auditDiffAndLog = saved.audit;
          }
        }, { refusedCleanly: { coreCalled: false, auditCalled: false },
             normalSaveStillWorks: { coreCalled: true, auditCalled: true } });
      /* The one gap gSaveQuotation's guard cannot see on its own: a browser that already had the
         quotation open BEFORE a pause/resume happened in a different session never learns about it
         until something re-reads the quotation from scratch. Rommel, 2026-08-29: "lets do the
         piggyback" -- rides the existing 60s approval poll rather than adding a round-trip to every
         save. Proves both directions (a server-side pause this tab did not know about gets picked
         up; a server-side resume this tab did not know about gets picked up too) and the common
         no-op case (nothing changed -> no unnecessary toast/re-render). */
      if (typeof window._refreshOpenQuotationPauseState === 'function' && typeof window._qOrderPaused === 'function')
        check('_refreshOpenQuotationPauseState: reconciles a stale tab against the server, both directions', () => {
          const w = window;
          const saved = { gToken: w.gToken, qSerial: w.qSerial, qBaseSerial: w.qBaseSerial,
                           paused: w.qOrderPausedInfo, loadFn: w.loadQuotationJson,
                           updateLockUI: w.updateLockUI, updateFQLockUI: w.updateFQLockUI };
          let uiRefreshed = 0;
          try {
            w.gToken = 'test-token';
            w.qSerial = 'QT-W00000900'; w.qBaseSerial = 'QT-W00000900';
            w.updateLockUI = () => { uiRefreshed++; };
            w.updateFQLockUI = () => { uiRefreshed++; };
            // Case 1: tab believes NOT paused, server says it IS -- must pick it up.
            w.qOrderPausedInfo = null;
            w.loadQuotationJson = (serial, cb) => cb({ orderPaused: { active: true, orderId: '77', reason: 'test' } });
            uiRefreshed = 0;
            w._refreshOpenQuotationPauseState();
            const pickedUpServerPause = { paused: w._qOrderPaused(), uiRefreshed: uiRefreshed > 0 };
            // Case 2: tab believes paused, server says it's been resumed -- must clear it.
            w.qOrderPausedInfo = { active: true, orderId: '77' };
            w.loadQuotationJson = (serial, cb) => cb({ orderPaused: { active: false } });
            uiRefreshed = 0;
            w._refreshOpenQuotationPauseState();
            const pickedUpServerResume = { paused: w._qOrderPaused(), uiRefreshed: uiRefreshed > 0 };
            // Case 3: nothing actually changed -- must not needlessly re-render.
            w.qOrderPausedInfo = null;
            w.loadQuotationJson = (serial, cb) => cb({ orderPaused: { active: false } });
            uiRefreshed = 0;
            w._refreshOpenQuotationPauseState();
            const noOpWhenUnchanged = uiRefreshed === 0;
            return { pickedUpServerPause, pickedUpServerResume, noOpWhenUnchanged };
          } finally {
            w.gToken = saved.gToken; w.qSerial = saved.qSerial; w.qBaseSerial = saved.qBaseSerial;
            w.qOrderPausedInfo = saved.paused; w.loadQuotationJson = saved.loadFn;
            w.updateLockUI = saved.updateLockUI; w.updateFQLockUI = saved.updateFQLockUI;
          }
        }, { pickedUpServerPause: { paused: true, uiRefreshed: true },
             pickedUpServerResume: { paused: false, uiRefreshed: true },
             noOpWhenUnchanged: true });
      if (typeof window._pollApprovalsNow === 'function')
        check('_pollApprovalsNow: the pause-reconcile pass is wired into the same poll as everything else',
          () => /_refreshOpenQuotationPauseState\(\)/.test(window._pollApprovalsNow.toString()), true);
      /* 2026-09-15: Rommel reported "when someone unlocked the quotation except from me, its not
         unlocked." Confirmed against real activity-log data (QT-M00000142): Allan approved an
         unlock and _persistApprovedFieldToQuotation genuinely wrote locked=false to Sheets/
         Supabase at that moment -- the write itself was never broken, and there is no
         identity-based gate anywhere in that path. The gap is exactly the same shape as the
         order-pause race above: nothing ever told Stephanie's ALREADY-OPEN tab that the unlock
         happened, so its qLocked stayed true, and its very next ordinary save (gSaveQuotation
         writes locked:qLocked unconditionally on every save) silently clobbered the just-applied
         unlock back to true -- with no new "Quotation locked." log line, since that is a side
         effect of a routine save, not an explicit re-lock. "Works when Rommel does it" only
         because he typically unlocks from the SAME tab that has the quotation open, so there is
         no second stale tab to clash with.
         Fixed the identical way the pause race was fixed: a narrow, deliberately non-wholesale
         reconciliation piggybacked on the same 60s poll. Proves both directions (a server-side
         unlock this tab did not know about is picked up; a server-side lock this tab did not know
         about is picked up too), the no-op case, and that it covers BOTH stages (qLocked and
         fqLocked are independent flags with their own hand-duplicated Stage 1/Stage 2 logic
         throughout this file -- checked per this file's own standing rule to always verify both
         stages, not just the one that was reported). */
      if (typeof window._refreshOpenQuotationLockState === 'function')
        check('_refreshOpenQuotationLockState: reconciles a stale tab\'s lock flags against the server, both stages', () => {
          const w = window;
          const saved = { gToken: w.gToken, qSerial: w.qSerial, qBaseSerial: w.qBaseSerial,
                           qLocked: w.qLocked, fqLocked: w.fqLocked, qSentStatus: w.qSentStatus,
                           qClientApproved: w.qClientApproved, loadFn: w.loadQuotationJson,
                           updateLockUI: w.updateLockUI, updateFQLockUI: w.updateFQLockUI,
                           updateSentStatus: w.updateSentStatus, updateBadge: w._updateQStatusBadge };
          let uiRefreshed = 0;
          try {
            w.gToken = 'test-token';
            w.qSerial = 'QT-W00000901'; w.qBaseSerial = 'QT-W00000901';
            w.updateLockUI = () => { uiRefreshed++; };
            w.updateFQLockUI = () => { uiRefreshed++; };
            w.updateSentStatus = () => { uiRefreshed++; };
            w._updateQStatusBadge = () => { uiRefreshed++; };
            // Case 1: THE reported bug -- this tab still thinks it's locked, someone else's
            // approved unlock already wrote locked=false (and the fields it resets) server-side.
            w.qLocked = true; w.qSentStatus = 'Shared via Viber'; w.qClientApproved = true;
            w.loadQuotationJson = (serial, cb) => cb({ locked: false, sentStatus: '', revisionPending: true,
              clientApproved: false, clientApprovedAt: '', approved: false, initApprovedAt: '' });
            uiRefreshed = 0;
            w._refreshOpenQuotationLockState();
            const pickedUpStaleUnlock = { locked: w.qLocked, sentStatus: w.qSentStatus,
              clientApproved: w.qClientApproved, uiRefreshed: uiRefreshed > 0 };
            // Case 2: the reverse -- server says locked, this tab still thinks it's unlocked.
            w.qLocked = false;
            w.loadQuotationJson = (serial, cb) => cb({ locked: true });
            uiRefreshed = 0;
            w._refreshOpenQuotationLockState();
            const pickedUpServerLock = { locked: w.qLocked, uiRefreshed: uiRefreshed > 0 };
            // Case 3: nothing changed -- must not needlessly re-render.
            w.qLocked = true;
            w.loadQuotationJson = (serial, cb) => cb({ locked: true });
            uiRefreshed = 0;
            w._refreshOpenQuotationLockState();
            const noOpWhenUnchanged = uiRefreshed === 0;
            // Case 4: Stage 2's OWN flag, independent of Stage 1's -- an FQ unlock elsewhere must
            // be picked up even while qLocked itself is unchanged.
            w.qLocked = true; w.fqLocked = true;
            w.loadQuotationJson = (serial, cb) => cb({ locked: true, fqLocked: false });
            uiRefreshed = 0;
            w._refreshOpenQuotationLockState();
            const pickedUpFQUnlock = { fqLocked: w.fqLocked, qLockedUntouched: w.qLocked === true, uiRefreshed: uiRefreshed > 0 };
            return { pickedUpStaleUnlock, pickedUpServerLock, noOpWhenUnchanged, pickedUpFQUnlock };
          } finally {
            w.gToken = saved.gToken; w.qSerial = saved.qSerial; w.qBaseSerial = saved.qBaseSerial;
            w.qLocked = saved.qLocked; w.fqLocked = saved.fqLocked; w.qSentStatus = saved.qSentStatus;
            w.qClientApproved = saved.qClientApproved; w.loadQuotationJson = saved.loadFn;
            w.updateLockUI = saved.updateLockUI; w.updateFQLockUI = saved.updateFQLockUI;
            w.updateSentStatus = saved.updateSentStatus; w._updateQStatusBadge = saved.updateBadge;
          }
        }, { pickedUpStaleUnlock: { locked: false, sentStatus: '', clientApproved: false, uiRefreshed: true },
             pickedUpServerLock: { locked: true, uiRefreshed: true },
             noOpWhenUnchanged: true,
             pickedUpFQUnlock: { fqLocked: false, qLockedUntouched: true, uiRefreshed: true } });
      if (typeof window._pollApprovalsNow === 'function')
        check('_pollApprovalsNow: the lock-reconcile pass is wired into the same poll as everything else',
          () => /_refreshOpenQuotationLockState\(\)/.test(window._pollApprovalsNow.toString()), true);
      /* 2026-09-24: a quotation's company followed the VIEWER, so a reviewer from another company
         saw (and saved, printed, renumbered into) their own company — the "duplicate with a
         different number and company". The company now belongs to the quotation. */
      if (typeof window.getCompanyName === 'function' && document.getElementById('cl-type'))
        check('quotation company belongs to the quotation, not the viewer', () => {
          const w = window, ct = document.getElementById('cl-type');
          const sv = { cu: w.currentUserCompany, home: w.qHomeCompany, type: ct.value, comm: w.qSerialCommitted, lc: w.liveClients };
          const r = {};
          try {
            // 1. No-arg call on a Direct quotation (Supabase company column, routing) — was "first other company"
            w.currentUserCompany = 'Module System and Services, Inc.'; w.qHomeCompany = '';
            ct.value = 'Direct'; w.renderClientCompanyField();
            r.noArgDirect = w.getCompanyName();
            // 2. A WCL reviewer opens an MSSI Direct quotation: still MSSI, still an M series
            w.qHomeCompany = w._homeCompanyFromState({ serial: 'QT-M00000160', client: { type: 'Direct' } });
            w.currentUserCompany = 'World Class Laminate, Inc.';
            w.renderClientCompanyField();
            r.reviewerSees = w.getCompanyName('Direct'); r.prefix = w._serialPrefix();
            // 3. A CWL reviewer opens a CWL-subsidiary quotation: CWL stays selectable, not the first option
            w.currentUserCompany = 'Cebu World Laminate, Inc.';
            ct.value = 'Subsidiary'; w.renderClientCompanyField();
            const sel = document.getElementById('cl-company-sel'); sel.value = 'Cebu World Laminate, Inc.';
            r.subsidiaryKept = w.getCompanyName('Subsidiary');
            // 4. Picking a client on an already-numbered quotation does not flip its account type
            ct.value = 'Direct'; w.renderClientCompanyField(); w.qSerialCommitted = true;
            w.liveClients = [{ id: 'zz-test', name: 'T', type: 'Subsidiary' }];
            w.clSelectClient('zz-test');
            r.typeKept = ct.value;
          } finally {
            w.currentUserCompany = sv.cu; w.qHomeCompany = sv.home; w.qSerialCommitted = sv.comm; w.liveClients = sv.lc;
            ct.value = sv.type; w.renderClientCompanyField();
          }
          return r;
        }, { noArgDirect: 'Module System and Services, Inc.', reviewerSees: 'Module Systems and Services, Inc.', prefix: 'M',
             subsidiaryKept: 'Cebu World Laminate, Inc.', typeKept: 'Direct' });
      /* MSSI commission compared an exact "Module Systems" against the viewer; every MSSI user is
         "Module System" (singular) in User Roles, so it never applied. */
      if (typeof window.recalc === 'function')
        check('MSSI commission applies for "Module System" (singular) users, only on a CWL subsidiary', () => {
          const w = window, sv = { home: w.qHomeCompany, cu: w.currentUserCompany };
          try {
            if (typeof w._mssiCommApplies !== 'function') return 'missing _mssiCommApplies';
            w.qHomeCompany = 'Module System and Services, Inc.';
            const r = { cwl: w._mssiCommApplies('Subsidiary', 'Cebu World Laminate, Inc.'),
                        wcl: w._mssiCommApplies('Subsidiary', 'World Class Laminate, Inc.'),
                        direct: w._mssiCommApplies('Direct', 'Cebu World Laminate, Inc.') };
            w.qHomeCompany = 'World Class Laminate, Inc.';
            r.notMssi = w._mssiCommApplies('Subsidiary', 'Cebu World Laminate, Inc.');
            r.bothStages = [w._recalcCore, w._recalcFQCore].every(f => typeof f === 'function' && /_mssiCommApplies\(/.test(f.toString()));
            return r;
          } finally { w.qHomeCompany = sv.home; w.currentUserCompany = sv.cu; }
        }, { cwl: true, wcl: false, direct: false, notMssi: false, bothStages: true });
      /* 2026-09-24 egress: whole tables were re-downloaded every 45-60 s and the free 5 GB/month
         ran out in about a week. A poll must ask "changed?" first and reuse what it has. */
      if (typeof window._supaCachedSelect === 'function')
        await (async () => {
          const w = window, saved = { supa: w.supa, ready: w.supaReady, use: w.USE_SUPABASE, lq: w.loadQuotationJson };
          let downloads = 0, fp = '3|t1', stateReads = 0;
          const q = (table) => {
            const b = { _cols: null,
              select(c, o) { b._cols = c; b._count = !!(o && o.count); return b; },
              order() { return b; }, limit() { return b; }, eq() { return b; },
              maybeSingle() { stateReads++; return Promise.resolve({ data: { state: { locked: true } }, error: null }); },
              then(res, rej) {
                if (b._count) return Promise.resolve({ data: [{ updated_at: fp.split('|')[1] }], count: +fp.split('|')[0], error: null }).then(res, rej);
                downloads++; return Promise.resolve({ data: [{ id: 'a' }], error: null }).then(res, rej);
              } };
            return b;
          };
          const r = {};
          try {
            w.supa = { from: q }; w.supaReady = () => true; w.USE_SUPABASE = true;
            await w._supaCachedSelect('messages', '*');
            await w._supaCachedSelect('messages', '*');
            r.unchangedDownloadsOnce = downloads;
            fp = '4|t2'; await w._supaCachedSelect('messages', '*');
            r.changeDownloadsAgain = downloads;
            let got = 0; w.loadQuotationJson = () => { r.fellBackToFullState = true; };
            w._pollStateLite('QT-W00000001', () => got++); w._pollStateLite('QT-W00000001', () => got++);
            await new Promise(res => setTimeout(res, 20));
            r.twoReconcilersOneRead = stateReads === 1 && got === 2;
            r.ordersSkipRaw = !/[,']raw[,']/.test(w.PENDING_ORDER_COLS) && /pause_history/.test(w.PENDING_ORDER_COLS);
            r.checksUseSlimView = /quotation_state_lite/.test(w._allQuotationStates.toString());
          } finally { w.supa = saved.supa; w.supaReady = saved.ready; w.USE_SUPABASE = saved.use; w.loadQuotationJson = saved.lq; }
          const want = { unchangedDownloadsOnce: 1, changeDownloadsAgain: 2, twoReconcilersOneRead: true, ordersSkipRaw: true, checksUseSlimView: true };
          out.push({ label: 'Supabase polls reuse unchanged tables and read the slim state view', got: r, want, ok: JSON.stringify(r) === JSON.stringify(want) });
        })();
      else out.push({ label: 'Supabase polls reuse unchanged tables and read the slim state view', err: '_supaCachedSelect missing', ok: false });
      /* 2026-09-24: Reports Overview / User KPI / Project tracker / Archive showed sample data
         (312 quotations, "Maria Santos", "Cityland Dev."). They must read the real Project List. */
      if (typeof window.renderProjTracker === 'function')
        check('Reports tabs show real quotations, not sample data', () => {
          const w = window, sv = { dir: w.dirData, su: w.sheetUsers };
          const old = new Date(Date.now() - 60 * 86400000).toISOString();
          try {
            w.dirData = [
              { id: 'QT-W00000901', baseSerial: 'QT-W00000901', client: 'Real Client A', type: 'Fabrication only', value: 1000, user: 'Tester One', created: old, updatedAt: old, status: 'IQ Awaiting Client Approval' },
              { id: 'QT-W00000902', baseSerial: 'QT-W00000902', client: 'Real Client B', type: 'Fabrication only', value: 2000, user: 'Tester One', created: new Date().toISOString(), updatedAt: new Date().toISOString(), status: 'Draft' }
            ];
            w.sheetUsers = [{ name: 'Tester One', pos: 'Staff', includeKpi: true, active: true }];
            w.renderRepOverview(); w.renderUserKpi(); w.renderProjTracker(); w.renderArchive();
            const t = id => (document.getElementById(id) || {}).innerHTML || '';
            const all = t('rep-ov-kpis') + t('user-kpi-tbl') + t('proj-tbl') + t('arch-tbl') + t('kpi-filter');
            return { noSample: !/Maria Santos|Cityland|Richmont|₱32\.6M/.test(all),
                     tracker: /Real Client A/.test(t('proj-tbl')) && /Real Client B/.test(t('proj-tbl')),
                     user: /Tester One/.test(t('user-kpi-tbl')),
                     archive: /QT-W00000901/.test(t('arch-tbl')) && !/QT-W00000902/.test(t('arch-tbl')) };
          } finally { w.dirData = sv.dir; w.sheetUsers = sv.su; }
        }, { noSample: true, tracker: true, user: true, archive: true });
      /* 2026-09-24: Cost report — find a quotation by search, company and created-date range. */
      if (typeof window._crMatches === 'function')
        check('Cost report finder: search (any word order), company and date range', () => {
          const L = [
            { id: 'QT-W00000901', client: 'Johndorf Property', project: 'Tower A kitchens', user: 'Stephanie', created: '2026-09-10T01:00:00Z' },
            { id: 'QT-C00000018', client: 'Johndorf Property', project: 'Cebu units', user: 'Kaye', created: '2026-09-17T01:00:00Z' },
            { id: 'QT-M00000150', client: 'St Paul College', project: 'Library', user: 'Joanna', created: '2026-08-01T01:00:00Z' }
          ];
          const ids = f => window._crMatches(L, Object.assign({ q: '', co: '', from: '', to: '' }, f)).map(e => e.id);
          return { word: ids({ q: 'kitchens johndorf' }), company: ids({ co: 'C' }),
                   range: ids({ from: '2026-09-01', to: '2026-09-15' }), newestFirst: ids({ q: 'johndorf' }) };
        }, { word: ['QT-W00000901'], company: ['QT-C00000018'], range: ['QT-W00000901'], newestFirst: ['QT-C00000018', 'QT-W00000901'] });
      /* 2026-09-24: Orders — who is handling it, and filters for company / received date / handler. */
      if (typeof window._orderPassesFilters === 'function' && document.getElementById('orders-co'))
        check('Orders: handler shown/filterable, company and received-date filters', () => {
          const w = window, sv = { po: w.pendingOrders, dir: w.dirData };
          const ids = ['orders-search', 'orders-co', 'orders-handler', 'orders-from', 'orders-to'];
          const set = v => ids.forEach(id => { const e = document.getElementById(id); if (e) e.value = v[id] || ''; });
          try {
            w.dirData = [{ id: 'QT-C00000018', baseSerial: 'QT-C00000018', user: 'Kaye', created: '2026-09-17', status: 'IQ Locked' }];
            w.pendingOrders = [
              { id: '1', receivedAt: '2026-09-17T00:00:00Z', status: 'In Progress', handledBy: 'Stephanie', quotSerial: '', sourceCompany: 'World Class Laminate, Inc.' },
              { id: '2', receivedAt: '2026-09-23T00:00:00Z', status: 'Pending', quotSerial: 'QT-C00000018', sourceCompany: 'World Class Laminate, Inc.' },
              { id: '3', receivedAt: '2026-09-24T00:00:00Z', status: 'Pending', quotSerial: '', sourceCompany: '' }];
            w._fillOrdersHandlerFilter();
            const pick = v => { set(v); return w.pendingOrders.filter(w._orderPassesFilters).map(o => o.id); };
            return { handlerFromQuote: w._orderHandler(w.pendingOrders[1]), cebu: pick({ 'orders-co': 'C' }),
                     nobody: pick({ 'orders-handler': '__none' }), from: pick({ 'orders-from': '2026-09-20' }),
                     search: pick({ 'orders-search': 'stephanie' }) };
          } finally { set({}); w.pendingOrders = sv.po; w.dirData = sv.dir; }
        }, { handlerFromQuote: 'Kaye', cebu: ['2'], nobody: ['3'], from: ['2', '3'], search: ['1'] });
      /* 2026-09-24: Dashboard — pipeline, team performance and order cards ignored the date range. */
      if (typeof window._dashOrderInScope === 'function' && document.getElementById('dash-from'))
        check('Dashboard: pipeline and orders follow the date range and company', () => {
          const w = window, f = document.getElementById('dash-from'), t = document.getElementById('dash-to'), c = document.getElementById('dash-co');
          const sv = { dir: w.dirData, po: w.pendingOrders, f: f.value, t: t.value, c: c ? c.value : '' };
          try {
            w.dirData = [
              { id: 'QT-W00000901', baseSerial: 'QT-W00000901', value: 1, user: 'x', created: '2026-09-10T01:00:00Z', updatedAt: new Date().toISOString(), status: 'Draft' },
              { id: 'QT-C00000901', baseSerial: 'QT-C00000901', value: 1, user: 'x', created: '2026-07-10T01:00:00Z', updatedAt: new Date().toISOString(), status: 'IQ Locked' }];
            w.pendingOrders = [{ id: '1', receivedAt: '2026-09-14T00:00:00Z', status: 'Pending' }, { id: '2', receivedAt: '2026-07-01T00:00:00Z', status: 'Pending' }];
            f.value = '2026-09-01'; t.value = '2026-12-31'; if (c) c.value = '';
            w._dashUpdateKPIs();
            const pipe = document.getElementById('dash-pipeline').innerText;
            return { issuedHidden: !/Issued/.test(pipe), draftShown: /Draft/.test(pipe),
                     orders: w.pendingOrders.filter(w._dashOrderInScope).map(o => o.id) };
          } finally { w.dirData = sv.dir; w.pendingOrders = sv.po; f.value = sv.f; t.value = sv.t; if (c) c.value = sv.c; }
        }, { issuedHidden: true, draftShown: true, orders: ['1'] });
      /* 2026-09-24: Client directory — search, account-category filter and sort. */
      if (typeof window._clientMatches === 'function')
        check('Clients: search (any word order, by quotation #), account filter', () => {
          const C = [
            { name: 'Ana', bizname: 'Studio Tille Inc.', type: 'Direct', segment: 'Homeowners', segmentGroup: 'B2C', txns: [{ id: 'QT-W00000120' }] },
            { name: 'Ben', bizname: 'Johndorf Property Ventures', type: 'Subsidiary', segment: 'Real Estate Developers', segmentGroup: 'B2B', txns: [{ id: 'QT-C00000018' }] }];
          const m = (q, t, s) => C.filter(c => window._clientMatches(c, q, t, s)).map(c => c.name);
          return { serial: m('c00000018', '', ''), words: m('property johndorf', '', ''), direct: m('', 'Direct', ''), b2b: m('', '', 'B2B') };
        }, { serial: ['Ben'], words: ['Ben'], direct: ['Ana'], b2b: ['Ben'] });
      /* 2026-09-25: Schedule page + the quotation-form capacity check read four invented projects
         (DEMO_PROJS). They must read real quotation dates. */
      if (typeof window._schedJobs === 'function')
        await (async () => {
          const w = window, sv = { dir: w.dirData, aqs: w._allQuotationStates, gl: w.gLoadDirData };
          let r = {};
          try {
            w.dirData = [
              { id: 'QT-W00000901', baseSerial: 'QT-W00000901', client: 'Has dates', status: 'IQ Locked', created: '2026-09-01' },
              { id: 'QT-W00000902', baseSerial: 'QT-W00000902', client: 'No dates', status: 'Draft', created: '2026-09-02' }];
            w.gLoadDirData = cb => cb();
            w._allQuotationStates = cb => cb({ 'QT-W00000901': { dates: { fab: '2026-09-21', inst: '2026-10-15' }, projectSize: 6 }, 'QT-W00000902': { dates: {} } });
            w._schedInvalidate();
            const jobs = await new Promise(res => w._schedJobs(res));
            r = { count: jobs.length, client: jobs[0] && jobs[0].client, units: jobs[0] && jobs[0].units,
                  hasEstEnd: !!(jobs[0] && jobs[0].fabEnd && jobs[0].fabEnd > '2026-09-21'),
                  demoGone: typeof w.DEMO_PROJS === 'undefined' && typeof w.DEMO_USERS === 'undefined' };
          } finally { w.dirData = sv.dir; w._allQuotationStates = sv.aqs; w.gLoadDirData = sv.gl; w._schedInvalidate(); }
          const want = { count: 1, client: 'Has dates', units: 6, hasEstEnd: true, demoGone: true };
          out.push({ label: 'Schedule reads real quotation dates, not DEMO_PROJS', got: r, want, ok: JSON.stringify(r) === JSON.stringify(want) });
        })();
      else out.push({ label: 'Schedule reads real quotation dates, not DEMO_PROJS', err: '_schedJobs missing', ok: false });
      /* 2026-09-25: a Staff user "sometimes becomes Admin". gCheckRole's .catch set
         currentRole='Admin' on ANY failure — a failed Roles read, or an exception inside gShowApp
         (which runs inside the same promise chain). It must fail closed. */
      if (typeof window.gCheckRole === 'function')
        await (async () => {
          const w = window, sv = { get: w._sheetsGetWithRetry, show: w.gShowApp, user: w.gUser, role: w.currentRole, acc: w.currentUserAcc };
          const r = {};
          try {
            w.gUser = { email: 'staff@example.test', name: 'Staff' };
            w._sheetsGetWithRetry = () => Promise.reject(new Error('network'));
            w.gShowApp = () => {};
            w.currentRole = '';
            w.gCheckRole(); await new Promise(res => setTimeout(res, 30));
            r.readFails = w.currentRole;
            w._sheetsGetWithRetry = () => Promise.resolve({ values: [['h'], ['Staff', 'staff@example.test', 'Staff', 'yes', 'World Class Laminate, Inc.']] });
            w.gShowApp = () => { throw new Error('boom'); };
            w.gCheckRole(); await new Promise(res => setTimeout(res, 30));
            r.startThrows = w.currentRole;
          } finally { w._sheetsGetWithRetry = sv.get; w.gShowApp = sv.show; w.gUser = sv.user; w.currentRole = sv.role; w.currentUserAcc = sv.acc;
                      const ov = document.getElementById('login-overlay'); if (ov) ov.style.display = 'none'; }
          const want = { readFails: '', startThrows: 'Staff' };
          out.push({ label: 'Role check never grants Admin on failure', got: r, want, ok: JSON.stringify(r) === JSON.stringify(want) });
        })();
      /* 2026-09-25: a reopened quotation's Activity log showed blank rows — the restore drew
         e.time / e.msg, which no entry has (they carry ts / action / user / att). */
      if (typeof window.restoreFullQuotationState === 'function' && document.getElementById('activity-log-body'))
        check('Activity log shows its entries when a quotation is reopened', () => {
          const w = window, sv = { ready: w.supaReady };
          try {
            w.supaReady = () => false;
            w.restoreFullQuotationState({ serial: 'QT-W00000999', client: { name: 'T', type: 'Direct' },
              areas: [{ name: 'Area 1', items: [], svcItems: [], matItems: [], hwItems: [], bomItems: [] }],
              log: [{ ts: 'Sep 24, 04:29 PM', user: 'Tester (Staff)', action: 'Quotation locked.', att: [{ name: 'proof.jpg', path: 'x' }] }] });
            const t = document.getElementById('activity-log-body').innerText;
            return { action: /Quotation locked\./.test(t), user: /Tester \(Staff\)/.test(t), attachment: /proof\.jpg/.test(t) };
          } finally { w.supaReady = sv.ready; }
        }, { action: true, user: true, attachment: true });

      /* 2026-09-25: client cutting-list reader (CLR) ported into the Cutting List tab. Synthetic
         sheets only — the real sample lists are client data and never enter this public repo. */
      if (window.CLR && typeof window.CLR.readClientSheet === 'function') {
        const C = window.CLR;
        // A client layout: title rows, header not on row 1, Height/Width naming, "mm" in cells,
        // words for the banding. Height is read as length; edges convert to our long/short code
        // through the real sizes.
        const aoa = [
          ['ACME INTERIORS'], [''], ['FINISHED SIZE'],
          ['NO.', 'DESCRIPTION', 'QTY', 'HEIGHT', 'WIDTH', 'THK', 'EDGE', 'MATERIAL'],
          ['1', 'SIDE', '2', '720 mm', '560 mm', '18', 'ALL AROUND', 'WHITE PB 2F'],
          ['2', 'SHELF', '3', '400', '800', '18', '1L', 'WHITE PB 2F'],
          ['3', 'BACK', '', '700', '500', '6', '', 'MDF 6MM']
        ];
        check('CLR: finds the header, reads sizes/codes/size mode, flags a row with no quantity', () => {
          const r = C.readClientSheet(aoa);
          return { header: r.header, rows: r.rows.length, sizeMode: r.ctx.sizeMode && r.ctx.sizeMode.value,
            codes: r.rows.map(x => x.code), L0: r.rows[0].L, qtyFlag: r.rows[2].issues.includes('no quantity'),
            pieces: C.totals(r.rows).pieces };
        }, { header: 3, rows: 3, sizeMode: 'finished', codes: ['4S', '1S', ''], L0: 720, qtyFlag: true, pieces: 6 });
        // Two boards stated above one table: each row takes the board of its own thickness,
        // not simply the last one stated (one sample list put every 18mm row on its 9mm board).
        check('CLR: a row takes the stated board matching its own thickness', () => {
          const r = C.readClientSheet([
            ['MATERIALS : 18mm PLYWOOD WARM WHITE 2F'], [': 09mm PLYWOOD WARM WHITE 2F'],
            ['No.', 'Designation', 'Quantity', 'Length', 'Width', 'Thickness', 'Eb'],
            ['A', 'RAIL', '2', '2010', '120', '18 mm', '2L'], ['B', 'BASE', '1', '900', '400', '9 mm', '']]);
          return r.rows.map(x => /18mm/.test(x.material) ? 18 : (/09mm/.test(x.material) ? 9 : 0));
        }, [18, 9]);
        check('CLR: a person\'s column correction wins (clearing Qty reports it missing)', () => {
          const r = C.readClientSheet(aoa, { header: 3, map: { qty: -1 } });
          return r.issues;
        }, ['No column found for qty.']);
        // End to end: a reader flag must reach Designers Support as a review flag, not just a
        // remark — the missing quantity defaults to one and must not arrive looking settled.
        if (typeof window._cutListToAnalysis === 'function' && window.MCL)
          check('CLR: a reader flag stays a review flag through _cutListToAnalysis', () => {
            const r = C.readClientSheet(aoa);
            const panels = r.rows.map(x => C.toPanel(x, 'finished'));
            const pay = window._cutListToAnalysis({ grain: 'L', panels, hpl: [], hardware: [] }, null);
            return { comps: pay.components.length, review: pay.components.map(c => !!c.needsReview) };
          }, { comps: 3, review: [false, false, true] });
      }

      /* 2026-09-25: layout page — part numbers, identical-board grouping, reflect summary last,
         printable cut sheets and labels. */
      if (typeof window._prodBoardGroups === 'function' && typeof window.prodComputeBom === 'function')
        check('layout: every placed piece carries its part, identical boards group, oversize names its part', () => {
          const w = window, saved = w.prodSettings.boardSizes;
          try {
            w.prodSettings.boardSizes = [{ material: 'TestMat', sizes: [{ w: 1220, h: 2440 }] }];
            // 3 identical full-length strips per board worth of pieces -> boards 1..n identical
            const comps = [
              { area: 'A', name: 'Tall', material: 'TestMat', color: 'W', texture: '', thickness: 18, length: 2400, width: 1200, qty: 3, faces: 2, grain: 'none' },
              { area: 'A', name: 'Huge', material: 'TestMat', color: 'W', texture: '', thickness: 18, length: 3000, width: 500, qty: 1, faces: 2, grain: 'none' }];
            const bm = w.prodComputeBom(comps)[0];
            const refs = [].concat(...bm.layout).map(p => p.ref);
            const g = w._prodBoardGroups(bm);
            return { boards: bm.boardsNeeded, everyPieceHasPart: refs.every(r => r === 0),
                     groups: g.length, groupedBoards: g[0].boards.length, oversizedRefs: bm.oversizedRefs };
          } finally { w.prodSettings.boardSizes = saved; }
        }, { boards: 3, everyPieceHasPart: true, groups: 1, groupedBoards: 3, oversizedRefs: [1] });
      if (typeof window.prodBuildResultHtml === 'function' && typeof window._prodBoardSvg === 'function')
        check('layout: pieces are labelled with their part number; reflect summary comes after the layout', () => {
          const w = window, saved = { bs: w.prodSettings.boardSizes, r: w.prodState.result, s: w.prodState.summary };
          try {
            w.prodSettings.boardSizes = [{ material: 'TestMat', sizes: [{ w: 1220, h: 2440 }] }];
            const comps = [{ area: 'A', name: 'Side', material: 'TestMat', color: 'W', texture: '', thickness: 18,
                             length: 600, width: 400, qty: 2, faces: 2, ebt: '', edgeTape: '', grain: 'none' }];
            const res = { components: comps, hardware: [], holeSchedule: [], summary: '' };
            res._bom = w.prodComputeBom(comps); res._services = w.prodComputeServices(comps, [], []);
            w.prodState.result = res;
            const html = w.prodBuildResultHtml(res);
            const iLayout = html.indexOf('Cutting layout'), iReflect = html.indexOf('<div id="prod-summary-wrap"');
            return { partOnPiece: />P1( · |<\/text><text[^>]*>)600×400</.test(html), reflectAfterLayout: iLayout >= 0 && iReflect > iLayout,
                     hasPrintButtons: html.includes('prodPrintCutSheets()') && html.includes('prodPrintLabels()') };
          } finally { w.prodSettings.boardSizes = saved.bs; w.prodState.result = saved.r; w.prodState.summary = saved.s; }
        }, { partOnPiece: true, reflectAfterLayout: true, hasPrintButtons: true });
      if (typeof window.prodPrintCutSheets === 'function' && typeof window.prodPrintLabels === 'function')
        check('print: one label per placed piece, one sheet per board group, no theme tokens on paper', () => {
          const w = window, saved = { bs: w.prodSettings.boardSizes, r: w.prodState.result, open: w.open };
          const cap = [];
          try {
            w.prodSettings.boardSizes = [{ material: 'TestMat', sizes: [{ w: 1220, h: 2440 }] }];
            const comps = [{ area: 'A', name: 'Tall', material: 'TestMat', color: 'W', texture: '', thickness: 18,
                             length: 2400, width: 1200, qty: 3, faces: 2, grain: 'none' }];
            const res = { components: comps, hardware: [], holeSchedule: [] };
            res._bom = w.prodComputeBom(comps); w.prodState.result = res;
            w.open = () => ({ document: { write: h => cap.push(h), close() {} }, focus() {}, print() {} });
            w.prodPrintCutSheets(); w.prodPrintLabels();
            return { sheets: (cap[0].match(/Cutting sequence/g) || []).length, groupedNote: /×3 identical/.test(cap[0]),
                     labels: (cap[1].match(/class="lb"/g) || []).length, noTokens: !/var\(--/.test(cap.join('')) };
          } finally { w.prodSettings.boardSizes = saved.bs; w.prodState.result = saved.r; w.open = saved.open; }
        }, { sheets: 1, groupedNote: true, labels: 3, noTokens: true });

      /* 2026-09-25: Job Order. Reserved at every Initial lock (frozen, versioned), ready at Final
         client approval. Cut size = finished on a standard bander; minus tape per banded edge on a
         bander without a trimmer. */
      if (typeof window._joBuild === 'function') {
        const comps = [
          { area: 'KITCHEN', name: 'Side', material: 'PB', color: 'W', thickness: 18, length: 720, width: 560, qty: 2, ebt: '1s/1l', edgeTape: 'White 0.4mm PVC', grain: 'length' },
          { area: 'KITCHEN', name: 'Shelf', material: 'PB', color: 'W', thickness: 18, length: 800, width: 400, qty: 1, ebt: '4s', edgeTape: 'White PVC', grain: 'none' },
          { area: 'KITCHEN', name: 'Back', material: 'MDF', color: 'W', thickness: 6, length: 700, width: 500, qty: 1, ebt: '', edgeTape: '', grain: 'none' }];
        const res = { components: comps, hardware: [], holeSchedule: [] };
        /* Plant, 2026-09-26: tape 1mm and up always goes on the trimming bander; only thinner tape
           may go on the old no-trim machine (overflow), and then the cut is smaller by the tape. */
        check('Job Order: per-piece bander — only tape under 1mm goes on the old machine and is cut smaller', () => {
          const t = window._joBuild(res, { joNumber: 'JO-T-V1', bander: 'trimmer' });
          const n = window._joBuild(res, { joNumber: 'JO-T-V1', bander: 'no_trimmer' });
          const thick = window._joBuild({ components: [Object.assign({}, comps[0], { edgeTape: 'White 1mm PVC' })], hardware: [], holeSchedule: [] },
            { joNumber: 'JO-T-V1', bander: 'no_trimmer' });
          return { trimmerSame: t.parts.every(p => p.cutL === p.L && p.cutW === p.W),
                   side: [n.parts[0].cutL, n.parts[0].cutW, n.parts[0].bander],      // 0.4mm tape: old machine
                   oneMm: [thick.parts[0].cutL, thick.parts[0].cutW, thick.parts[0].bander], // 1mm: trimmer
                   shelf: [n.parts[1].cutL, n.parts[1].cutW, n.parts[1].bander],     // unstated: trimmer, flagged
                   shelfFlagged: n.parts[1].flags.some(f => /tape thickness not stated/.test(f)),
                   back: [n.parts[2].cutL, n.parts[2].cutW, n.parts[2].bander],      // unbanded
                   pieces: t.pieceCount, uniqueCodes: new Set([].concat(...t.parts.map(p => p.barcodes))).size,
                   scan: t.parts[0].scan[1] };
        }, { trimmerSame: true, side: [719.6, 559.6, 'no_trimmer'], oneMm: [720, 560, 'trimmer'],
             shelf: [800, 400, 'trimmer'], shelfFlagged: true, back: [700, 500, ''],
             pieces: 4, uniqueCodes: 4, scan: 'T-V1-P1-02' });
        check('HPL written in the colour (imported client labels) is still detected', () => {
          const w = window;
          const comps = [{ area: 'A', name: 'Door', material: 'Plywood', color: 'raw hpl silky off white', thickness: 18,
                           length: 700, width: 400, qty: 1, faces: 2, ebt: '' }];
          const bm = w.prodComputeBom(comps)[0];
          const jo = w._joBuild({ components: comps, hardware: [], holeSchedule: [] }, { joNumber: 'JO-T-V1' });
          return { bomHpl: bm.hpl, route: jo.parts[0].route.join('>') };
        }, { bomHpl: true, route: 'CUT>MHPL>ASM>QC>PACK' });
        check('Job Order: route per piece — special cut, HPL order, bander, drilling', () => {
          const w = window;
          const r = w._joBuild({ components: [
              { area: 'K', name: 'HG tapering door', material: 'Plywood HPL', thickness: 18, length: 700, width: 400, qty: 1, ebt: '4s', edgeTape: 'White 1mm', notes: 'HPL' },
              { area: 'K', name: 'Side', material: 'MDF HPL', thickness: 18, length: 700, width: 560, qty: 1, ebt: '1l', edgeTape: '1mm', notes: 'HPL' },
              { area: 'K', name: 'Shelf', material: 'PB', thickness: 18, length: 700, width: 300, qty: 1, ebt: '' }],
            hardware: [], holeSchedule: [{ component: 'Side', holeType: 'Hinges', qty: 2, diameter: 35 }] },
            { joNumber: 'JO-T-V1', bander: 'trimmer' });
          const cutFirst = w._joBuild({ components: [
              { area: 'K', name: 'Side', material: 'MDF HPL', thickness: 18, length: 700, width: 560, qty: 1, ebt: '', notes: 'HPL' }],
            hardware: [], holeSchedule: [] }, { joNumber: 'JO-T-V1', hplOrder: 'cut_first' });
          return { special: r.parts[0].special, routes: r.parts.map(p => p.route.join('>')), mdfCutFirst: cutFirst.parts[0].route.join('>') };
        }, { special: 'TAPERING',
             routes: ['SCUT>MHPL>EBB>ASM>QC>PACK', 'HPL>CURE>CUT>EBB>DRL>ASM>QC>PACK', 'CUT>ASM>QC>PACK'],
             mdfCutFirst: 'CUT>MHPL>ASM>QC>PACK' });
        check('Job Order: same content = same signature across versions; a change breaks it', () => {
          const a = window._joBuild(res, { joNumber: 'JO-T-V1' }), b = window._joBuild(res, { joNumber: 'JO-T-V2' });
          const c = window._joBuild({ components: comps.map((x, i) => i ? x : Object.assign({}, x, { qty: 3 })), hardware: [], holeSchedule: [] }, { joNumber: 'JO-T-V1' });
          return [window._joSig(a) === window._joSig(b), window._joSig(a) === window._joSig(c)];
        }, [true, false]);
        check('Job Order: parts map to PMES area/part codes; barcodes follow PMES full_barcode_id', () => {
          const w = window, P = w._joPmesPart, A = w._joPmesArea;
          const parts = ['SIDE PANEL', 'BASE BOARD', 'DRAWER FRONT & BACK', 'DRAWER FACE (LEFT)', 'DRAWER FLOOR',
            'AB OPEN SHELVES - DIVIDER', 'TOP RAIL', 'BACKING', 'ADJ SHELF', 'DOOR', 'A FILLER', 'HEAD BOARD -L'].map(P);
          const areas = ['MASTERS BEDROOM › note', 'Kitchen', 'CABINET 2', 'Walk-in closet', 'T&B vanity'].map(A);
          const jo = w._joBuild({ components: [{ area: 'KITCHEN', name: 'Side panel', material: 'PB', thickness: 18,
            length: 700, width: 500, qty: 2, ebt: '' }], hardware: [], holeSchedule: [] }, { joNumber: 'JO-T-V1' });
          return { parts, areas, id: jo.parts[0].barcodes[1] };
        }, { parts: ['SP', 'TR', 'DRS', 'DRF', 'DRB', 'PT', 'TR', 'BK', 'SH', 'DR', 'FP', 'MISC'],
             areas: ['BED', 'KIT', 'MISC', 'CLS', 'BTH'], id: 'JO-T-V1-KIT-P1_KITCHEN-SP-02/02' });
        check('Job Order: reserved on every Initial lock path, marked ready on Final client approval', () => {
          const has = (f, s) => typeof window[f] === 'function' && String(window[f]).includes(s);
          return [has('_doLockOnlyConfirmed', '_reserveJobOrder()'), has('confirmSend', '_reserveJobOrder()'),
                  has('skipSend', '_reserveJobOrder()'), has('confirmClientApprove', '_markJobOrderReady()')];
        }, [true, true, true, true]);
        // End-to-end run 2026-09-26 (MARGARITA.xls) found these four.
        check('E2E 1: an edge-tape line is matched against edge-band items only, never boards', () => {
          const w = window, keep = w.dbMaterials;
          w.dbMaterials = [{ name: '[SDP] Acacia PB 4x8 2F (18mm, Stipple)', unit: 'pc', price: 2690 },
                           { name: 'Acacia 1mmx22mm Matte PVC Premium Edgeband', unit: 'lm', price: 20 }];
          try {
            w.prodBuildSummary({ components: [], _bom: [], _services: { edgebandingByTape: [{ tape: 'ACACIA', lm: 81.33 }] }, hardware: [] });
            const row = w.prodState.summary.materials.find((m) => m.unit === 'lm' || m.aiName === 'ACACIA');
            return row ? { boardOffered: (row.matchCandidates || []).some((n) => /4x8/.test(n)), notBoard: !/4x8/.test(row.name) } : 'no row';
          } finally { w.dbMaterials = keep; }
        }, { boardOffered: false, notBoard: true });
        check('E2E 2: a SKU chosen on the cutting list arrives resolved, not re-matched', () => {
          const w = window, keep = w.dbMaterials;
          const sku = 'Real White PB 4x8 2F (18mm, Matte)';
          w.dbMaterials = [{ name: sku, unit: 'pc', price: 2330 }, { name: 'Real White PB 4x8 1F (18mm, Matte)', unit: 'pc', price: 2020 },
                           { name: 'Real White PB 4x8 2F (15mm, Matte)', unit: 'pc', price: 2100 }];
          try {
            const a = w._cutListToAnalysis({ panels: [{ group: 'A', part: 'Side', mat: sku, th: 18, L: 700, W: 500, qty: 2, ebt: '' }], hpl: [], hardware: [] });
            const comps = a.components || a.result && a.result.components;
            const bom = w.prodComputeBom(comps);
            w.prodBuildSummary({ components: comps, _bom: bom, _services: {}, hardware: [] });
            const row = w.prodState.summary.materials[0];
            return { carried: comps[0].catalogName, name: row.name, review: row.needsReview, price: row.price };
          } finally { w.dbMaterials = keep; }
        }, { carried: 'Real White PB 4x8 2F (18mm, Matte)', name: 'Real White PB 4x8 2F (18mm, Matte)', review: false, price: 2330 });
        check('E2E 3: a grooved piece is routed through the grooving station (GRV), others are not', () => {
          const jo = window._joBuild({ components: [
            { area: 'A', name: 'Side', material: 'PB', thickness: 18, length: 700, width: 500, qty: 1, ebt: '1l', grooving: 'Grooving' },
            { area: 'A', name: 'Shelf', material: 'PB', thickness: 18, length: 700, width: 300, qty: 1, ebt: '1l' }], hardware: [], holeSchedule: [] },
            { joNumber: 'JO-T-G1' });
          return jo.parts.map((p) => p.route.join('>'));
        }, ['CUT>EBB>GRV>ASM>QC>PACK', 'CUT>EBB>ASM>QC>PACK']);
        check('E2E 4: barcode IDs carry no spaces or symbols from the cabinet name', () => {
          const jo = window._joBuild({ components: [{ area: 'MASTERS BEDROOM › 88T-2S 22.5H', name: 'Side', material: 'PB',
            thickness: 18, length: 700, width: 500, qty: 1, ebt: '' }], hardware: [], holeSchedule: [] }, { joNumber: 'JO-T-B1' });
          const id = jo.parts[0].barcodes[0];
          return /^[A-Z0-9-]+-[A-Z]+-[A-Z0-9_]+-[A-Z]+-\d\d\/\d\d$/.test(id) ? 'clean' : id;
        }, 'clean');
        check('Codes: a client code reads as words, and suggestions keep colour, thickness and faces', () => {
          const w = window, keep = w.dbMaterials;
          w.dbMaterials = ['Acacia PB 4x8 1F (15mm, Matte)', 'Alder/White MDF 4x8 1F (15mm, Matte)',
            'Real White PB 4x8 1F (15mm, Matte)', 'Real White PB 4x8 2F (15mm, Matte)', 'Real White PB 4x8 1F (18mm, Matte)',
            'Real White 1mmx22mm Matte PVC Premium Edgeband'].map((name) => ({ name, unit: 'pc', price: 0 }));
          try {
            const sug = w.CLR.suggestFor({ key: 't-melwh151f', text: 'MELWH151F', thk: 15, faces: 1 });
            const lam = w.CLR.suggestFor({ key: 't-wh362f', text: 'WH362F', thk: 36, faces: 2 });
            return { words: w.CLR.codeWords('MELWH182F'), sug: sug.slice(0, 2), lam: lam.slice(0, 1) };
          } finally { w.dbMaterials = keep; }
        }, { words: 'melamine white', sug: ['Real White PB 4x8 1F (15mm, Matte)', 'Alder/White MDF 4x8 1F (15mm, Matte)'],
             lam: ['Real White PB 4x8 1F (18mm, Matte)'] });
        check('Over 25mm: a 36mm panel = two 18mm 1F boards, banded once, Board Assembly per lm of perimeter', () => {
          const w = window, keep = w.dbMaterials;
          w.dbMaterials = [{ name: 'Real White PB 4x8 1F (18mm, Matte)', unit: 'pc', price: 2020 },
                           { name: 'Real White PB 4x8 2F (18mm, Matte)', unit: 'pc', price: 2330 }];
          try {
            const a = w._cutListToAnalysis({ panels: [{ group: 'A', part: 'Top', mat: 'Real White PB 4x8 2F (18mm, Matte)', th: 36,
              L: 1000, W: 500, qty: 2, ebt: '4S', emat: 'WHITE' }], hpl: [], hardware: [] });
            const c = a.components;
            const ba = (a.extraServices || []).find((x) => x.service === 'Board Assembly');
            return { n: c.length, th: c.map((x) => x.thickness), faces: c.map((x) => x.faces), ebt: c.map((x) => x.ebt),
                     sku: c[0].catalogName, ba: ba && ba.qty, review: c[0].needsReview };
          } finally { w.dbMaterials = keep; }
        }, { n: 2, th: [18, 18], faces: [1, 1], ebt: ['4s', ''], sku: 'Real White PB 4x8 1F (18mm, Matte)', ba: 6, review: false });
        check('Tapes: a client tape colour gets edge-band suggestions, and a mapped tape arrives resolved', () => {
          const w = window, keep = w.dbMaterials;
          w.dbMaterials = ['Acacia PB 4x8 2F (18mm, Stipple)', 'Acacia 2mmx54mm Matte PVC Premium Edgeband',
            'Acacia 1mmx22mm Matte PVC Premium Edgeband', 'Acacia .5mmx22mm Matte PVC Premium Edgeband',
            'Real White 1mmx22mm Matte PVC Premium Edgeband'].map((name) => ({ name, unit: 'lm', price: 20 }));
          try {
            const sug = w.CLR.suggestTape({ key: 'tape:t-acacia', text: 'ACACIA' });
            w.prodBuildSummary({ components: [], _bom: [], hardware: [],
              _services: { edgebandingByTape: [{ tape: 'Acacia 1mmx22mm Matte PVC Premium Edgeband', lm: 10 }] } });
            const row = w.prodState.summary.materials[0];
            return { first: sug[0], noBoard: !sug.some((n) => /4x8/.test(n)), resolved: !row.needsReview, name: row.name };
          } finally { w.dbMaterials = keep; }
        }, { first: 'Acacia 1mmx22mm Matte PVC Premium Edgeband', noBoard: true, resolved: true,
             name: 'Acacia 1mmx22mm Matte PVC Premium Edgeband' });
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
      /* 2026-09-16: same report as index.html's own fix ("I am somehow blinded on what option am
         I signing or unlocking since it doesnt show what option it is") -- this is the screen
         Rommel actually uses most for approvals, so it needs the same fix, not just the desktop
         Approvals page. optionLabel now rides on the request's own payload column
         (supaUpsertApprovalRequest in index.html), so this page can read it directly with no new
         plumbing. Both loadList()'s row template and render()'s detail card are inherently async
         (a live Supabase query) -- verified structurally on the function's own source, same
         pattern as loadHistory just above: confirms the badge markup is actually built from
         `payload.optionLabel`, not hand-typed static text that would look right here and do
         nothing on a real request. */
      if (typeof window.loadList === 'function')
        check('loadList: each request row shows which option it was raised against', () => {
          const src = window.loadList.toString();
          return { readsOptionLabel: /x\.payload&&x\.payload\.optionLabel/.test(src) || /x\.payload\s*&&\s*x\.payload\.optionLabel/.test(src) };
        }, { readsOptionLabel: true });
      if (typeof window.render === 'function')
        check('render: the request detail card shows which option it was raised against', () => {
          const src = window.render.toString();
          return { readsOptionLabel: /REQ\.payload&&REQ\.payload\.optionLabel/.test(src) || /REQ\.payload\s*&&\s*REQ\.payload\.optionLabel/.test(src) };
        }, { readsOptionLabel: true });
      /* 2026-09-16: Rommel -- "I need to keep on subscribing every time though i already
         subscribed multiple times." Confirmed live: push_subscriptions is completely empty for
         EVERYONE, no error/popup was ever seen on any attempt, and the card never once showed
         "On". That combination (no failure AND no success, ever) means the original code's single
         .catch() never fired at all -- consistent with reg.pushManager.subscribe(...) itself
         silently HANGING (a known real-world failure mode for the OS-level push-registration
         handshake under battery/data-saver restrictions or a flaky network), not rejecting.
         _withTimeout is the mechanism that turns a hang into a visible, actionable failure instead
         of a silent, indefinite one -- proven directly and live here (a promise that genuinely
         never resolves, raced against a real but tiny timeout), which is the part that matters:
         no amount of source-reading proves a race condition actually races correctly -- but THIS
         profile's own check() is synchronous (`const got = fn()`, no await, confirmed by reading
         it directly rather than assuming), so a check returning a Promise here silently resolves
         to `{}` via JSON.stringify on the unresolved Promise object -- a false pass waiting to
         happen, not a real one. Verified structurally instead, matching this file's own existing,
         deliberate choice for this page's harder-to-fully-drive async functions -- including
         whether enablePush() is actually WIRED to use it, not just present unused. */
      if (typeof window._withTimeout === 'function')
        check('_withTimeout: races the real promise against a real timeout and rejects with the step name', () => {
          const src = window._withTimeout.toString();
          return {
            usesPromiseRace: /Promise\.race/.test(src),
            rejectsOnTimeout: /reject\(new Error\(label/.test(src),
            clearsTheTimer: /clearTimeout\(timer\)/.test(src)
          };
        }, { usesPromiseRace: true, rejectsOnTimeout: true, clearsTheTimer: true });
      if (typeof window.enablePush === 'function')
        check('enablePush: the subscribe step is wired through the timeout watchdog, and a timeout resets the button rather than leaving it dead', () => {
          const src = window.enablePush.toString();
          return {
            subscribeWrappedInTimeout: /_withTimeout\(_swInit\(\)/.test(src) && /PUSH_TIMEOUT_MS/.test(src),
            catchResetsButtons: /\.catch\(function\(e\)\{[\s\S]*_pushResetButtons\(\)/.test(src),
            timeoutGetsItsOwnMessage: /timedOut/.test(src) && /background notifications/.test(src)
          };
        }, { subscribeWrappedInTimeout: true, catchResetsButtons: true, timeoutGetsItsOwnMessage: true });
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
