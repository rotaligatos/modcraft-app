// Does the checker actually catch things? Each case is a real failure mode,
// plus the things it must NOT flag.
// Run with:  node tools/check-collisions.test.mjs
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'colcheck-'));
const TOOL = process.argv[2] || join(dirname(fileURLToPath(import.meta.url)), 'check-collisions.mjs');

function run(name, html, expect) {
  const f = join(dir, name.replace(/\W+/g, '_') + '.html');
  writeFileSync(f, html, 'utf8');
  let out = '', code = 0;
  try { out = execFileSync('node', [TOOL, f], { encoding: 'utf8' }); }
  catch (e) { out = (e.stdout || '') + (e.stderr || ''); code = e.status; }
  const failed = code !== 0;
  const ok = failed === expect.fails && (!expect.mentions || out.includes(expect.mentions));
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (exit ${code}${expect.mentions ? `, looking for "${expect.mentions}"` : ''})`);
  if (!ok) console.log(out.split('\n').map(l => '        ' + l).join('\n'));
  return ok;
}

const wrap = (js, body = '') => `<html><body>${body}<script>\n${js}\n</script></body></html>`;

let all = true;
const t = (...a) => { all = run(...a) && all; };

// ── must FAIL ────────────────────────────────────────────────────────────────
t('duplicate top-level function (the dashToggleWidget bug)',
  wrap(`function dashToggleWidget(k){ return 1; }\nfunction other(){}\nfunction dashToggleWidget(k){ return 2; }`),
  { fails: true, mentions: 'dashToggleWidget' });

t('duplicate top-level var',
  wrap(`var SERVICES = [];\nvar x = 1;\nvar SERVICES = [2];`),
  { fails: true, mentions: 'var SERVICES' });

t('duplicate var inside a comma list',
  wrap(`var a = 1, dupe = 2;\nvar b = 3, dupe = 4;`),
  { fails: true, mentions: 'dupe' });

t('duplicate markup id (the users-wrap bug)',
  wrap(`function f(){}`, `<div id="users-wrap"></div><div id="users-wrap"></div>`),
  { fails: true, mentions: 'users-wrap' });

t('markup id also emitted from JS (the sched-card bug)',
  wrap(`function build(){ return '<div id="sched-card">x</div>'; }`, `<div id="sched-card"></div>`),
  { fails: true, mentions: 'BOTH' });

t('script block does not parse',
  wrap(`function broken( { return 1; }`),
  { fails: true, mentions: 'does not parse' });

t('unterminated regex from a Python-style heredoc patch',
  wrap(`var re = /abc\ndef/;\nfunction g(){}`),
  { fails: true, mentions: 'does not parse' });

// ── must PASS (no false positives) ───────────────────────────────────────────
t('nested helpers may share a name — they are locals',
  wrap(`function a(){\n  function row(){ return 1; }\n  return row();\n}\nfunction b(){\n  function row(){ return 2; }\n  return row();\n}`),
  { fails: false });

t('a declaration inside a block comment is not a declaration',
  wrap(`/*\nfunction ghost(){}\n*/\nfunction ghost(){ return 1; }`),
  { fails: false });

t('a declaration inside a template literal is not a declaration',
  wrap('var t = `\nfunction ghost(){}\n`;\nfunction ghost(){ return 1; }'),
  { fails: false });

t('concatenated id prefixes are not whole ids',
  wrap(`function rows(n){ var h=''; for(var i=0;i<n;i++) h+='<div id="oc-amt-'+i+'"></div>'; return h; }`),
  { fails: false });

t('a regex containing quotes does not open a string',
  wrap(`var r = /['"]/g;\nfunction after(){ return 1; }\nvar q = 'ok';`),
  { fails: false });

t('emoji do not shift the mask (surrogate pairs)',
  wrap(`var icon = '\u{1F4CB} order';\n/*\nfunction ghost(){}\n*/\nfunction real(){ return 1; }`),
  { fails: false });

t('division is not a regex',
  wrap(`var a = 10 / 2 / 5;\nfunction after(){ return a; }`),
  { fails: false });

console.log(all ? '\nAll cases behaved as expected.' : '\nSOME CASES FAILED.');
process.exit(all ? 0 : 1);
