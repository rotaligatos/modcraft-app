// Modcraft verification gate — the single "is this safe to ship?" command.
// Runs both gates and exits 0 only if both pass. This is what the Orion fix
// runner calls before it will open a PR or deploy: no green, no ship.
//   gate 1  tools/check-collisions.mjs  — parses every <script>, catches
//           duplicate function/var names and element ids (static safety)
//   gate 2  tools/smoke.mjs             — loads the app headlessly, catches
//           crashes, missing critical functions, and logic regressions (runtime)
// Run:  node tools/verify.mjs
import { spawnSync } from 'child_process';
function gate(label, args) {
  console.log('\n===== ' + label + ' =====');
  const r = spawnSync('node', args, { stdio: 'inherit' });
  return r.status === 0;
}
const g1 = gate('gate 1 · collisions + parse', ['tools/check-collisions.mjs']);
const g2 = gate('gate 2 · headless smoke',     ['tools/smoke.mjs']);
const ok = g1 && g2;
console.log('\n' + (ok ? '✅ VERIFY: PASS — safe to ship' : '❌ VERIFY: FAIL — do NOT ship'));
process.exit(ok ? 0 : 1);
