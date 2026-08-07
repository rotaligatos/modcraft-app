#!/usr/bin/env node
// Collision checker for Modcraft's single-file app.
//
// Why this exists: in JavaScript a later definition silently WINS, and
// document.getElementById silently returns the FIRST match. Neither throws.
// Both have already bitten this app:
//   - a new dashToggleWidget was nearly shipped shadowed by an older one
//     defined further down the file (2026-08-06)
//   - a duplicate id="users-wrap" made the Users page render into a hidden
//     div, so the page looked blank (2026-06-05)
//   - two card ids landed on the WRONG cards during the two-column layout
//     work and threw nothing (2026-08-07)
//
// So it reports four things, all of which are silent in the browser:
//   1. duplicate top-level function names
//   2. duplicate top-level var names
//   3. duplicate element ids
//   4. any <script> block that does not parse
//
// Usage:  node tools/check-collisions.mjs [file...]      (default: index.html)
// Exit 1 on any finding, so it works as a git pre-commit hook.

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';

// ── Mask out comments and string/template literals ───────────────────────────
// Replaced with spaces so every character offset — and therefore every line
// number — stays exactly where it was. We only need this so that a `function`
// or `var` sitting at column 0 INSIDE a block comment or template literal is
// not mistaken for a real declaration.
//
// Regex literals are tracked only so that a quote or backtick inside one
// (e.g. /['"]/) cannot falsely open a string. A regex cannot span a line, so
// if we hit a newline while in one we assume we misread a division and back
// out — which keeps a wrong guess from swallowing the rest of the file.
export function maskLiterals(src) {
  // split('') and not Array.from(): Array.from splits by code POINT, but
  // src[i] indexes by UTF-16 code UNIT. index.html holds 98 emoji, each a
  // surrogate pair, so the two disagree by 98 characters and the mask drifts
  // steadily out of alignment with the source.
  const out = src.split('');
  const blank = (i) => { if (out[i] !== '\n') out[i] = ' '; };

  let i = 0;
  const n = src.length;
  // Stack of open template literals; each entry counts the brace depth of the
  // ${ } expression we are currently inside, so nested templates work.
  const tmpl = [];
  let lastSig = ''; // last significant character, for the regex heuristic

  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];

    // -- inside a ${ } expression of a template literal --------------------
    if (tmpl.length && tmpl[tmpl.length - 1].inExpr) {
      const top = tmpl[tmpl.length - 1];
      if (c === '{') { top.depth++; i++; lastSig = c; continue; }
      if (c === '}') {
        top.depth--;
        if (top.depth === 0) { top.inExpr = false; blank(i); i++; continue; }
        i++; lastSig = c; continue;
      }
      // fall through — expression body is normal code
    }

    // -- line comment ------------------------------------------------------
    if (c === '/' && c2 === '/') {
      while (i < n && src[i] !== '\n') blank(i++);
      continue;
    }

    // -- block comment -----------------------------------------------------
    if (c === '/' && c2 === '*') {
      blank(i++); blank(i++);
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) blank(i++);
      if (i < n) { blank(i++); blank(i++); }
      continue;
    }

    // -- regex literal (masked only to protect quotes inside it) -----------
    if (c === '/' && isRegexStart(lastSig)) {
      const start = i;
      let j = i + 1, cls = false, ok = false;
      while (j < n) {
        const d = src[j];
        if (d === '\n') break;              // regexes cannot span lines
        if (d === '\\') { j += 2; continue; }
        if (d === '[') cls = true;
        else if (d === ']') cls = false;
        else if (d === '/' && !cls) { ok = true; j++; break; }
        j++;
      }
      if (ok) {
        for (let k = start; k < j; k++) blank(k);
        i = j; lastSig = '/'; continue;
      }
      // Not a regex after all — it was division. Fall through as a plain char.
    }

    // -- single / double quoted string -------------------------------------
    if (c === '"' || c === "'") {
      const q = c;
      blank(i++);
      while (i < n) {
        if (src[i] === '\\') { blank(i++); blank(i++); continue; }
        if (src[i] === q) { blank(i++); break; }
        if (src[i] === '\n') break;         // unterminated; let the parser say so
        blank(i++);
      }
      lastSig = q;
      continue;
    }

    // -- template literal ---------------------------------------------------
    if (c === '`') {
      if (tmpl.length && !tmpl[tmpl.length - 1].inExpr) {
        tmpl.pop();                          // closing backtick
      } else {
        tmpl.push({ inExpr: false, depth: 0 });
      }
      blank(i++);
      lastSig = '`';
      continue;
    }
    if (tmpl.length && !tmpl[tmpl.length - 1].inExpr) {
      if (c === '\\') { blank(i++); blank(i++); continue; }
      if (c === '$' && c2 === '{') {
        const top = tmpl[tmpl.length - 1];
        top.inExpr = true; top.depth = 1;
        blank(i++); blank(i++);
        continue;
      }
      blank(i++);
      continue;
    }

    if (!/\s/.test(c)) lastSig = c;
    i++;
  }
  return out.join('');
}

// A `/` begins a regex when the previous significant character cannot end an
// expression. After an identifier, digit, `)`, `]` or `}` it is division.
function isRegexStart(prev) {
  if (prev === '') return true;
  return !/[A-Za-z0-9_$)\]}]/.test(prev);
}

// ── Pull <script> blocks out of the HTML ─────────────────────────────────────
function scriptBlocks(html) {
  const blocks = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const attrs = m[1] || '';
    if (/\bsrc\s*=/i.test(attrs)) continue;                 // external file
    const type = /\btype\s*=\s*["']?([^"'\s>]+)/i.exec(attrs);
    if (type && !/javascript|module/i.test(type[1])) continue; // e.g. a template
    const bodyStart = m.index + m[0].indexOf('>', m[0].indexOf('<script')) + 1;
    blocks.push({
      code: m[2],
      start: bodyStart,
      line: html.slice(0, bodyStart).split('\n').length,
      module: !!(type && /module/i.test(type[1])),
    });
  }
  return blocks;
}

const lineOf = (text, idx) => text.slice(0, idx).split('\n').length;

// ── Run over each file ───────────────────────────────────────────────────────
export function check(files) {
let findings = 0;
const say = (s) => process.stdout.write(s + '\n');

for (const file of files) {
  let html;
  try { html = readFileSync(file, 'utf8'); }
  catch (e) { say(`✗ ${file}: cannot read — ${e.message}`); findings++; continue; }

  say(`\n${file}`);
  const blocks = scriptBlocks(html);

  // 4. every <script> block parses ------------------------------------------
  let parseFails = 0;
  blocks.forEach((b, n) => {
    try {
      new vm.Script(b.code, { filename: `${file}:script#${n + 1}` });
    } catch (e) {
      parseFails++;
      say(`  ✗ script block #${n + 1} (line ${b.line}) does not parse: ${e.message}`);
    }
  });
  if (!parseFails) say(`  ✓ ${blocks.length} script block(s) parse`);
  findings += parseFails;

  // Declarations are gathered across ALL blocks, because they share one
  // global scope — a function in block 1 is shadowed by one in block 3.
  const fns = new Map();   // name -> [line, ...]
  const vars = new Map();

  for (const b of blocks) {
    const masked = maskLiterals(b.code);
    const push = (map, name, idx) => {
      const line = b.line + lineOf(masked, idx) - 1;
      if (!map.has(name)) map.set(name, []);
      map.get(name).push(line);
    };

    // Top level in this file means column 0 — verified against the real file:
    // 1339 declarations sit at column 0 and every indented one is a genuine
    // nested helper, i.e. a local, which is not a collision.
    let m;
    const fnRe = /^function\s+([A-Za-z_$][\w$]*)\s*\(/gm;
    while ((m = fnRe.exec(masked))) push(fns, m[1], m.index);

    const varRe = /^var\s+([^\n;]*)/gm;
    while ((m = varRe.exec(masked))) {
      // `var a = 1, b = 2` — take each name before its `=`, ignoring any
      // commas that belong to a call or literal in an initialiser.
      const decl = m[1];
      let depth = 0, cur = '', names = [];
      for (const ch of decl) {
        if ('([{'.includes(ch)) depth++;
        else if (')]}'.includes(ch)) depth--;
        if (ch === ',' && depth === 0) { names.push(cur); cur = ''; continue; }
        cur += ch;
      }
      names.push(cur);
      for (const raw of names) {
        const nm = /^\s*([A-Za-z_$][\w$]*)/.exec(raw);
        if (nm) push(vars, nm[1], m.index);
      }
    }
  }

  // 1 + 2. duplicate declarations -------------------------------------------
  for (const [label, map] of [['function', fns], ['var', vars]]) {
    const dupes = [...map.entries()].filter(([, l]) => l.length > 1);
    if (!dupes.length) { say(`  ✓ no duplicate top-level ${label} names (${map.size} checked)`); continue; }
    findings += dupes.length;
    say(`  ✗ ${dupes.length} duplicate top-level ${label} name(s) — the LAST one wins silently:`);
    for (const [name, lines] of dupes.sort((a, b) => a[0].localeCompare(b[0]))) {
      say(`      ${label} ${name} — lines ${lines.join(', ')}`);
    }
  }

  // 3. duplicate element ids -------------------------------------------------
  // Ids arrive two ways in this app and both have to be looked at: written in
  // the static markup, and emitted from JS string literals. The two-column
  // layout bug (2026-08-07) was a JS-built card carrying an id that already
  // existed in the markup, so a markup-only scan would have missed it.
  const scriptSpans = [];
  {
    const re = /<script\b[^>]*>[\s\S]*?<\/script\s*>/gi;
    let m; while ((m = re.exec(html))) scriptSpans.push([m.index, m.index + m[0].length]);
  }
  const inScript = (i) => scriptSpans.some(([a, b]) => i >= a && i < b);

  // Matched quotes only, so a concatenated prefix cannot be mistaken for a
  // whole id: in  id="oc-amt-'+i+'"  the closing quote is a ' and not a ",
  // so the literal correctly fails to match.
  const idRe = /\bid\s*=\s*(["'])([A-Za-z][\w:.-]*)\1/g;

  const markupIds = new Map();
  const jsIds = new Map();
  let im;
  while ((im = idRe.exec(html))) {
    const val = im[2];
    const map = inScript(im.index) ? jsIds : markupIds;
    if (!map.has(val)) map.set(val, []);
    map.get(val).push(lineOf(html, im.index));
  }

  // Hard failure: the same id twice in the static markup.
  const markupDupes = [...markupIds.entries()].filter(([, l]) => l.length > 1);
  // Hard failure: an id that exists in the markup AND is emitted by JS — two
  // different elements end up sharing it, and getElementById picks whichever
  // is first in the document.
  const overlap = [...jsIds.keys()].filter((k) => markupIds.has(k));

  if (!markupDupes.length && !overlap.length) {
    say(`  ✓ no duplicate element ids (${markupIds.size} in markup, ${jsIds.size} emitted from JS)`);
  }
  if (markupDupes.length) {
    findings += markupDupes.length;
    say(`  ✗ ${markupDupes.length} duplicate id(s) in the markup — getElementById returns the FIRST:`);
    for (const [id, lines] of markupDupes.sort((a, b) => a[0].localeCompare(b[0]))) {
      say(`      id="${id}" — lines ${lines.join(', ')}`);
    }
  }
  if (overlap.length) {
    findings += overlap.length;
    say(`  ✗ ${overlap.length} id(s) in BOTH the markup and JS-generated HTML:`);
    for (const id of overlap.sort()) {
      say(`      id="${id}" — markup line ${markupIds.get(id).join(', ')}; emitted at line ${jsIds.get(id).join(', ')}`);
    }
  }

  // Softer: the same id emitted from more than one place in JS. Often fine —
  // a create-if-missing guard, or two paths that never both run — so this is
  // reported for the eye but does not fail the commit.
  const jsDupes = [...jsIds.entries()].filter(([, l]) => l.length > 1);
  if (jsDupes.length) {
    say(`  · ${jsDupes.length} id(s) emitted from more than one place in JS (fine if each path is guarded, or only one runs):`);
    for (const [id, lines] of jsDupes.sort((a, b) => a[0].localeCompare(b[0]))) {
      say(`      id="${id}" — lines ${lines.join(', ')}`);
    }
  }
}

say('');
if (findings) {
  say(`${findings} collision(s) found. None of these throw an error in the browser.`);
  return 1;
}
say('No collisions.');
return 0;
}

// Only run when invoked directly, so the masker can be imported and tested.
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const files = process.argv.slice(2);
  if (!files.length) files.push('index.html');
  process.exit(check(files));
}
