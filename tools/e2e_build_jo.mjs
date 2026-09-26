// One-off: build a test Job Order with Modcraft's OWN code (_cutListToAnalysis -> _joBuild),
// headless and offline, and write it to a JSON file for the end-to-end database run.
// Usage: node tools/e2e_build_jo.mjs <out.json>
import { createRequire } from 'module';
import { pathToFileURL } from 'url';
import path from 'path';
import fs from 'fs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const OUT = process.argv[2] || 'e2e_jo.json';
const FILE = pathToFileURL(path.resolve('index.html')).href;
const browser = await chromium.launch();
const page = await browser.newPage();
const errs = [];
page.on('pageerror', e => errs.push(e.message));
await page.route('**/*', r => r.request().url().startsWith('file:') ? r.continue() : r.abort());
await page.goto(FILE, { waitUntil: 'load', timeout: 30000 });
await page.waitForTimeout(1200);
const out = await page.evaluate(() => {
  const P = (group, part, mat, th, L, W, qty, ebt, emat, svcs, remark) =>
    ({ group, part, mat, th, L, W, qty, ebt, emat, grain: '', svcs: svcs || [], remark: remark || '' });
  const WH = 'Real White PB 4x8 2F (18mm, Matte)';
  const cl = { origin: 'typed', grain: 'length', panels: [
    P('Kitchen Base Cabinet 1', 'Side panel', WH, 18, 720, 560, 2, '1L', 'Real White PVC 1mm', []),
    P('Kitchen Base Cabinet 1', 'Bottom panel', WH, 18, 564, 560, 1, '1L', 'Real White PVC 1mm', []),
    P('Kitchen Base Cabinet 1', 'Shelf', WH, 18, 564, 540, 1, '1L', 'Real White PVC 1mm', []),
    P('Kitchen Base Cabinet 1', 'Back panel', 'Real White PB 4x8 1F (5mm, Matte)', 5, 700, 582, 1, '', '',
      ['Grooving 3mm (melamine) (L)']),
    P('Kitchen Base Cabinet 1', 'Door', WH, 18, 716, 297, 2, '4S', 'Real White PVC 1mm',
      ['Boring 35mm (Hinges) × 2 holes']),
    P('Kitchen Wall Cabinet 1', 'Side panel', WH, 18, 720, 320, 2, '1L', 'Real White PVC 1mm', []),
    P('Kitchen Wall Cabinet 1', 'Top panel', WH, 18, 564, 320, 1, '1L', 'Real White PVC 1mm', []),
    P('Kitchen Wall Cabinet 1', 'Corner filler', WH, 18, 720, 100, 1, '1L', 'Real White PVC 1mm', [],
      'special cut - radius corner')
  ], hpl: [], hardware: [
    { item: 'Hinge Clip-on Full Overlay', qty: 4, unit: 'pc', notes: '' },
    { item: 'Adjustable leg 100mm', qty: 4, unit: 'pc', notes: '' }
  ] };
  const pay = window._cutListToAnalysis(cl, null);
  const result = { components: pay.components, holeSchedule: pay.holeSchedule || [],
    extraServices: pay.extraServices || [], hardware: pay.hardware || [], _structured: true };
  const jo = 'JO-T00000001-1';
  const data = window._joBuild(result, { joNumber: jo, serial: 'QT-T00000001', optionId: 0, version: 1,
    client: 'E2E TEST CLIENT', project: 'End-to-end test kitchen', company: 'Module Systems and Services, Inc.',
    preparedBy: 'E2E test', bander: 'trimmer', source: 'e2e typed list', hplOrder: 'laminate_first' });
  data.storageFolder = 'QT-T00000001'; data.sourceKind = 'typed_list';
  return { data, flagged: pay.components.filter(c => c.needsReview).map(c => c.name + ': ' + c.reviewNote) };
});
fs.writeFileSync(OUT, JSON.stringify(out.data));
console.log(JSON.stringify({ errs, pieces: out.data.pieceCount, boards: out.data.boardCount,
  parts: out.data.parts.map(p => [p.p, p.name, p.qty, p.route.join('>'), p.special || '', p.flags.join(';')]),
  flagged: out.flagged, services: out.data.services }, null, 1));
await browser.close();
