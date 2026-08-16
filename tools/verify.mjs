// Modcraft verification gate — the single "is this safe to ship?" command.
// Runs both gates and exits 0 only if both pass. This is what the Orion fix
// runner calls before it will open a PR or deploy: no green, no ship.
//   gate 1  tools/check-collisions.mjs  — parses every <script>, catches
//           duplicate function/var names and element ids (static safety)
//   gate 2  tools/smoke.mjs index.html   — loads the app headlessly, catches
//           crashes, missing critical functions, and logic regressions (runtime)
//   gate 3  tools/smoke.mjs approve.html — the same, for the mobile approvals app
//
// approve.html was hand-checked only until 2026-08-17. It is now load-bearing —
// approvals, push, the biometric gate and Lami all live there — and a broken edit
// shipped silently, so it goes through both gates like everything else.
// Run:  node tools/verify.mjs
import { spawnSync } from 'child_process';
function gate(label, args) {
  console.log('\n===== ' + label + ' =====');
  const r = spawnSync('node', args, { stdio: 'inherit' });
  return r.status === 0;
}
const g1 = gate('gate 1 · collisions + parse', ['tools/check-collisions.mjs', 'index.html', 'approve.html']);
const g2 = gate('gate 2 · headless smoke · index.html',   ['tools/smoke.mjs', 'index.html']);
const g3 = gate('gate 3 · headless smoke · approve.html', ['tools/smoke.mjs', 'approve.html']);
const ok = g1 && g2 && g3;
console.log('\n' + (ok ? '✅ VERIFY: PASS — safe to ship' : '❌ VERIFY: FAIL — do NOT ship'));
process.exit(ok ? 0 : 1);
