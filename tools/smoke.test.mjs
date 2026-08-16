// Do the approve.html smoke checks actually catch anything? Each case breaks ONE
// thing in a COPY of the real file and asserts the gate goes red FOR THE RIGHT REASON.
// A check that cannot reproduce its bug proves nothing about the code it guards.
// Run with:  node tools/smoke.test.mjs        (slow — it launches a browser per case)
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const TOOL = join(HERE, 'smoke.mjs');
const SRC = readFileSync(join(REPO, 'approve.html'), 'utf8');
// The basename must stay approve.html — that is how smoke.mjs picks the profile.
const COPY = join(mkdtempSync(join(tmpdir(), 'smoke-')), 'approve.html');

const CASES = [
  { name: 'control — untouched copy', expect: 'PASS', mutate: s => s },

  { name: 'OVR moved back inside render() (the bug that shipped)', expect: 'FAIL',
    want: /OVR is module-scoped/,
    mutate: s => must(s, 'var OVR=null;', '/* moved */')
      .replace('function render(){', 'function render(){ var OVR=null;') },

  { name: 'reason box id renamed while act() still reads rsn', expect: 'FAIL',
    want: /reasonBoxHtml emits the id/,
    mutate: s => must(s, '<textarea class="rsn" id="rsn"', '<textarea class="rsn" id="reason"') },

  { name: 'ni gate dropped — fab buffer applied unconditionally', expect: 'FAIL',
    want: /fab \+ discount buffer apply only when installation/,
    mutate: s => must(s, '*(m.ni?pc(r.fabBuffer):1)', '*pc(r.fabBuffer)') },

  { name: 'a critical function deleted (ovrRead)', expect: 'FAIL',
    want: /critical functions: FAIL/,
    mutate: s => must(s, 'function ovrRead(){', 'function ovrRead_GONE(){') },

  { name: 'top-level crash — the script defines nothing', expect: 'FAIL',
    want: /load errors \(uncaught JS\): FAIL/,
    mutate: s => must(s, 'function peso(n){', 'nope.this.throws();\nfunction peso(n){') },

  { name: 'boot() never paints the signed-out view', expect: 'FAIL',
    want: /boot\(\) reached the signed-out view: FAIL/,
    mutate: s => must(s, '\nboot();', '\n/* boot(); */') }
];

// A mutation whose anchor has drifted must be reported, never silently applied as a no-op —
// otherwise the case quietly becomes "run the control again" and passes forever.
function must(s, find, repl) {
  if (!s.includes(find)) throw new Error('anchor not found: ' + JSON.stringify(find.slice(0, 40)));
  return s.replace(find, repl);
}

let all = true;
for (const c of CASES) {
  let out, got;
  try {
    writeFileSync(COPY, c.mutate(SRC), 'utf8');
    const r = spawnSync('node', [TOOL, COPY], { encoding: 'utf8', cwd: REPO });
    out = (r.stdout || '') + (r.stderr || '');
    got = (/RESULT: PASS/.test(out) && r.status === 0) ? 'PASS' : 'FAIL';
  } catch (e) {
    console.log('FAIL  ' + c.name + '  — ' + e.message);
    all = false; continue;
  }
  const right = got === c.expect;
  const reason = c.want ? c.want.test(out) : true;   // red is not enough; red for the right check
  const ok = right && reason;
  all = ok && all;
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + c.name + '  → ' + got +
    (right ? '' : ' (expected ' + c.expect + ')') +
    (right && !reason ? ' — but not for the expected reason' : ''));
  if (!ok) console.log(out.split('\n').filter(l => /FAIL|x /.test(l)).slice(0, 6)
    .map(l => '        ' + l.trim()).join('\n'));
}

// An unrecognised target must refuse loudly. Falling back to another page's profile would
// report a confident PASS for a file nothing had checked.
const g = spawnSync('node', [TOOL, join(REPO, 'sw.js')], { encoding: 'utf8', cwd: REPO });
const guarded = g.status === 1 && /no profile for/.test((g.stdout || '') + (g.stderr || ''));
all = guarded && all;
console.log((guarded ? 'PASS' : 'FAIL') + '  unknown target refuses instead of falling back');

console.log('\n' + (all ? 'ALL PASS' : 'FAILURES ABOVE'));
process.exit(all ? 0 : 1);
