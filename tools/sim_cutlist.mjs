// One-off simulation, NOT part of the permanent verify gate — this needs real network
// (the CDN-hosted XLSX library, exactly the one index.html loads) and a static file
// server so the app's own relative fetch('Cutting-List-Template.xlsx') resolves the
// way it does on GitHub Pages. Proves the whole Excel round-trip against simulated data:
// download serves the real template file, upload parses a filled one (including a
// deliberately malformed row and a deliberately misspelled edge code), paste fills a
// block of cells, Enter-to-advance moves focus, and the result survives the same
// converter (_cutListToAnalysis) the website's own orders go through.
//
// Run: node tools/sim_cutlist.mjs
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const MIME = { '.html': 'text/html', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.js': 'text/javascript' };

const server = createServer(async (req, res) => {
  try {
    const url = decodeURIComponent((req.url || '/').split('?')[0]);
    const file = url === '/' ? '/index.html' : url;
    const full = path.join(ROOT, file);
    const buf = await readFile(full);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
    res.end(buf);
  } catch (e) {
    res.writeHead(404); res.end('not found');
  }
});
await new Promise(r => server.listen(0, r));
const port = server.address().port;

const results = [];
const step = (label, ok, detail) => { results.push({ label, ok, detail }); console.log((ok ? '  ok ' : '  X  ') + label + (detail ? '  ' + detail : '')); };

const browser = await chromium.launch();
const page = await browser.newPage();
const consoleErrors = [];
page.on('pageerror', e => consoleErrors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });

console.log('SIM: Cutting List Excel round-trip — index.html served at http://localhost:' + port + '/');
await page.goto('http://localhost:' + port + '/index.html', { waitUntil: 'load', timeout: 30000 });

// Wait for the real CDN-hosted XLSX library and MCL to both be ready.
await page.waitForFunction(() => typeof window.XLSX !== 'undefined' && typeof window.MCL === 'object', { timeout: 20000 });
step('page loaded, XLSX + MCL both defined', true);

// MCL renders into #prod-wrap only when prodTab==='cutlist' (renderProductionPage's
// own routing) — without this, every DOM-level check below would find nothing there
// even though MCL's internal state is correct, which is exactly what happened on the
// first run of this script and looked like a real bug until traced to the missing tab switch.
await page.evaluate(() => window.setProdTab('cutlist'));
const tabOk = await page.evaluate(() => !!document.querySelector('#prod-wrap tr[data-i="0"]'));
step('switching to the Cutting List tab renders the grid into #prod-wrap', tabOk);

// A real user reaches this tab through navigate('production'), which the CSS relies
// on to make #page-production visible (.page{display:none} / .page.active{display:block}
// — see index.html:95-96). navigate() itself is gated on being signed in with feature
// access, which this simulation deliberately does not fake (out of scope for testing
// one grid's paste/keyboard behaviour) — so the container is marked active directly.
// Without this, .focus() calls succeed as far as the DOM is concerned (element found,
// connected, not disabled) but silently do nothing, because focusing an element inside
// a display:none ancestor is a no-op per spec — exactly what the first run of this
// script hit, and it looked like a real onCellKey bug until traced to this.
await page.evaluate(() => document.getElementById('page-production').classList.add('active'));

// ---- 1. Fresh state: 10 blank rows -----------------------------------------------
const fresh = await page.evaluate(() => window.MCL.state().panels.length);
step('fresh load shows 10 blank panel rows', fresh === 10, 'got ' + fresh);

// ---- 2. Download template — real fetch of the shipped .xlsx file -----------------
const dl = await page.evaluate(async () => {
  const r = await fetch('Cutting-List-Template.xlsx', { cache: 'no-store' });
  if (!r.ok) return { ok: false, status: r.status };
  const buf = new Uint8Array(await r.arrayBuffer());
  const wb = window.XLSX.read(buf, { type: 'array' });
  return { ok: true, size: buf.length, sheets: wb.SheetNames,
           panelHeader: window.XLSX.utils.sheet_to_json(wb.Sheets['Cutting List'], { header: 1 })[0] };
});
step('template file fetches and parses as a real workbook', dl.ok && dl.size > 10000, JSON.stringify({ size: dl.size, sheets: dl.sheets }));
step('template "Cutting List" header matches MCL\'s own XL_PANEL_HDR', dl.ok && dl.panelHeader && dl.panelHeader[0] === 'Group (cabinet/area)' && dl.panelHeader.length === 12, JSON.stringify(dl.panelHeader));

// Also drive the REAL button + REAL Playwright download event, not just fetch().
const [download] = await Promise.all([
  page.waitForEvent('download', { timeout: 10000 }),
  page.evaluate(() => window.MCL.downloadTemplate())
]);
step('clicking-equivalent download produces a real browser download event', !!download, download.suggestedFilename());

// ---- 3. Build a realistic filled-in template entirely in-page, upload it ---------
const uploadResult = await page.evaluate(async () => {
  const XLSX = window.XLSX;
  const wb = XLSX.utils.book_new();
  const panelRows = [
    ['Group (cabinet/area)','Part','Material SKU','Length (mm)','Width (mm)','Thickness (mm)','Qty','Edge Band','Edge Material','Grain (L/W)','Services','Remarks'],
    ['Kitchen — Base Cabinet 1','Side panel','Real White PB 4x8 2F (18mm, Matte)',720,560,18,2,'1L 1S','Bamboo .5mm PVC Edgeband','L','Boring 35mm (Hinges) x 4 holes','hinge side is the left edge'],
    ['Kitchen — Base Cabinet 1','Door','Walnut 259 PB 4x8 2F (18mm, Matte)',716,296,18,2,'4S','Bamboo .5mm PVC Edgeband','L','',''],
    // deliberately malformed: no width at all — the panel is dropped, not silently counted
    ['Kitchen — Base Cabinet 1','Filler','Walnut 259 PB 4x8 2F (18mm, Matte)',100,'',18,1,'','','','',''],
    // deliberately unusual edge-code spelling ("1S, 1L" instead of the canonical "1L 1S")
    ['Wardrobe — Unit 2','Top rail','Real White PB 4x8 2F (18mm, Matte)',900,80,18,1,'1S, 1L','','L','',''],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(panelRows), 'Cutting List');
  const hplRows = [['Substrate SKU','HPL Finish SKU','Faces (1F/2F)','Length (mm)','Width (mm)','Qty','Cut to size (Y/N)'],
                   ['Raw Boards 4x8 18mm MDF','Pure white 4x8 0.7mm HPL','2F',1220,2440,4,'N']];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(hplRows), 'HPL Lamination');
  const hwRows = [['Item','Qty','Unit','Notes'], ['Overlay hinge',8,'pcs','2 per door']];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(hwRows), 'Hardware');

  const arrayBuf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  const file = new File([arrayBuf], 'filled.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

  // Build a real <input type=file> the way the app's own upload button does, and
  // hand it a real FileList via DataTransfer — the same mechanism a user's file
  // picker produces, so this exercises the ACTUAL uploadExcel() code path.
  const input = document.createElement('input');
  input.type = 'file';
  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
  document.body.appendChild(input);

  // window.confirm would block forever waiting for a click that never comes.
  const savedConfirm = window.confirm;
  window.confirm = () => true;
  window.MCL.uploadExcel(input);
  // uploadExcel's FileReader.onload is async — wait for it to finish (panels replaced).
  await new Promise(resolve => {
    const start = Date.now();
    const poll = () => {
      const s = window.MCL.state();
      if (s.panels.length !== 10 || Date.now() - start > 5000) resolve();
      else setTimeout(poll, 30);
    };
    poll();
  });
  window.confirm = savedConfirm;
  input.remove();

  const s = window.MCL.state();
  return {
    panelCount: s.panels.length,
    panels: s.panels.map(p => ({ group: p.group, part: p.part, mat: p.mat, L: p.L, W: p.W, qty: p.qty, ebt: p.ebt, emat: p.emat, remark: p.remark })),
    hplCount: s.hpl.length,
    hpl: s.hpl,
    hwCount: s.hardware.length,
    hw: s.hardware
  };
});
// All 4 rows are kept — the importer only skips a row with NEITHER length NOR
// width (matching the website's own converter); the Filler row here has a length
// but no width, so it is imported and left for _cutListToAnalysis's own tripwire
// to flag rather than being silently dropped.
step('upload replaced the 10-row scaffold with all 4 parsed rows (none dropped)', uploadResult.panelCount === 4, 'got ' + uploadResult.panelCount);
const p0 = uploadResult.panels[0] || {};
step('row 1 parsed correctly (material, dims, qty, edge code, edge tape, remark)',
  p0.mat === 'Real White PB 4x8 2F (18mm, Matte)' && p0.L === 720 && p0.W === 560 && p0.qty === 2 && p0.ebt === '1L 1S' && p0.emat === 'Bamboo .5mm PVC Edgeband' && p0.remark === 'hinge side is the left edge',
  JSON.stringify(p0));
const p3 = uploadResult.panels[3] || {};
step('the odd edge-code spelling "1S, 1L" normalised to the canonical "1L 1S"', p3.ebt === '1L 1S', JSON.stringify(p3));
step('HPL Lamination sheet imported (1 build)', uploadResult.hplCount === 1 && uploadResult.hpl[0].sub.indexOf('Raw Boards') === 0, JSON.stringify(uploadResult.hpl));
step('Hardware sheet imported (1 line, qty 8)', uploadResult.hwCount === 1 && uploadResult.hw[0].qty === 8, JSON.stringify(uploadResult.hw));

// ---- 3b. Full pipeline on THIS upload: toCl() -> _cutListToAnalysis() ------------
// Run immediately, before anything else touches MCL's state (the header-mismatch
// test below deliberately uploads a second, different file and would overwrite it).
const analysis = await page.evaluate(() => {
  const cl = window.MCL.toCl();
  const payload = window._cutListToAnalysis(cl, null);
  return {
    componentCount: payload.components.length,
    integrity: payload._integrity,
    flagged: payload.components.map(c => ({ name: c.name, needsReview: c.needsReview, reviewNote: c.reviewNote })),
    hardwareCount: payload.hardware.length
  };
});
step('all 4 rows survive into components with no integrity mismatch', analysis.componentCount === 4 && analysis.integrity.ok, JSON.stringify(analysis.integrity));
step('the hardware line survived the same converter', analysis.hardwareCount === 1, JSON.stringify(analysis.hardwareCount));
const fillerFlag = analysis.flagged.find(c => c.name === 'Filler');
step('the width-less Filler row is FLAGGED for review, not silently priced', !!(fillerFlag && fillerFlag.needsReview && /no.*width/i.test(fillerFlag.reviewNote)), JSON.stringify(fillerFlag));
const doorFlag = analysis.flagged.find(c => c.name === 'Door');
step('a clean, fully-specified row (Door) is NOT flagged', !!(doorFlag && !doorFlag.needsReview), JSON.stringify(doorFlag));
console.log('  all rows: ' + JSON.stringify(analysis.flagged, null, 2).split('\n').join('\n  '));

// ---- 4. Header-mismatch warning: a client who moved a column gets told, not silently mis-read ----
const headerWarn = await page.evaluate(async () => {
  const XLSX = window.XLSX;
  const wb = XLSX.utils.book_new();
  const rows = [['Part','Group (cabinet/area)','Material SKU','Length (mm)','Width (mm)','Thickness (mm)','Qty','Edge Band','Edge Material','Grain (L/W)','Services','Remarks'], // columns 1&2 swapped
                ['Side panel','Kitchen 1','Real White PB 4x8 2F (18mm, Matte)',720,560,18,2,'','','','','']];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Cutting List');
  const arrayBuf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  const file = new File([arrayBuf], 'moved-columns.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const input = document.createElement('input'); input.type = 'file';
  const dt = new DataTransfer(); dt.items.add(file); input.files = dt.files;
  document.body.appendChild(input);

  const toasts = [];
  const savedToast = window.showToast;
  window.showToast = (m) => { toasts.push(m); if (savedToast) try { savedToast(m); } catch (e) {} };
  const savedConfirm = window.confirm;
  window.confirm = () => true;
  window.MCL.uploadExcel(input);
  await new Promise(r => setTimeout(r, 300));
  window.confirm = savedConfirm;
  window.showToast = savedToast;
  input.remove();
  return toasts;
});
step('a moved column is caught and named, not silently misread', headerWarn.some(t => /columns do not match/i.test(t) && /column 1/i.test(t)), JSON.stringify(headerWarn));

// ---- 6. Paste a block of cells (feels-like-Excel) ---------------------------------
const pasteResult = await page.evaluate(() => {
  const savedConfirm = window.confirm;
  window.confirm = () => true;
  window.MCL.clear();
  window.confirm = savedConfirm;
  // Simulate pasting a 3-row, 5-column TSV block (as if copied from a real
  // spreadsheet: Material | Th | L | W | Qty) starting at row 0's Material cell,
  // exactly the way MCL.onCellPaste is wired to the 'mat' column.
  const tsv = 'Real White PB 4x8 2F (18mm, Matte)\t18\t720\t560\t2\n' +
              'Walnut 259 PB 4x8 2F (18mm, Matte)\t18\t716\t296\t2\n' +
              'Bleached Chestnut PB 4x8 1F (18mm, Crosscut)\t12\t400\t300\t1';
  const fakeEvent = {
    clipboardData: { getData: () => tsv },
    preventDefault: () => {}
  };
  window.MCL.onCellPaste(fakeEvent, 0, 'mat');
  const s = window.MCL.state();
  return s.panels.slice(0, 3).map(p => ({ mat: p.mat, th: p.th, L: p.L, W: p.W, qty: p.qty }));
});
const wantPaste = [
  { mat: 'Real White PB 4x8 2F (18mm, Matte)', th: 18, L: 720, W: 560, qty: 2 },
  { mat: 'Walnut 259 PB 4x8 2F (18mm, Matte)', th: 18, L: 716, W: 296, qty: 2 },
  { mat: 'Bleached Chestnut PB 4x8 1F (18mm, Crosscut)', th: 12, L: 400, W: 300, qty: 1 }
];
step('pasting a 3x5 block from Material fills 3 rows x 5 columns correctly',
  JSON.stringify(pasteResult) === JSON.stringify(wantPaste), JSON.stringify(pasteResult));

// ---- 7. Enter-to-advance (feels-like-Excel) ----------------------------------------
const enterResult = await page.evaluate(() => {
  window.MCL.onCellKey({ key: 'Enter', preventDefault: () => {} }, 0, 'mat');
  const el = document.querySelector('tr[data-i="1"] .mcl-f-mat');
  return { focused: document.activeElement === el, exists: !!el };
});
step('Enter in row 0\'s Material cell moves focus to row 1\'s Material cell', enterResult.exists && enterResult.focused, JSON.stringify(enterResult));

const enterGrowResult = await page.evaluate(() => {
  const s = window.MCL.state();
  const lastIdx = s.panels.length - 1;
  window.MCL.onCellKey({ key: 'Enter', preventDefault: () => {} }, lastIdx, 'mat');
  const grownLen = window.MCL.state().panels.length;
  const el = document.querySelector('tr[data-i="' + (lastIdx + 1) + '"] .mcl-f-mat');
  return { before: lastIdx + 1, after: grownLen, focused: document.activeElement === el };
});
step('Enter on the last row grows the sheet by one and focuses it, like Excel',
  enterGrowResult.after === enterGrowResult.before + 1 && enterGrowResult.focused, JSON.stringify(enterGrowResult));

// ---- 8. No console errors anywhere during the whole simulation --------------------
step('no uncaught JS errors during the entire simulation', consoleErrors.length === 0, consoleErrors.slice(0, 5).join(' | '));

await browser.close();
server.close();

const failed = results.filter(r => !r.ok);
console.log('\n' + (failed.length ? 'RESULT: FAIL (' + failed.length + ' of ' + results.length + ')' : 'RESULT: PASS (' + results.length + '/' + results.length + ')'));
process.exit(failed.length ? 1 : 0);
