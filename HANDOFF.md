# Modcraft — Session Handoff (as of 2026-07-20)

Quick-start doc for picking up work in a fresh session. Full technical detail lives in
`CLAUDE.md` under "What was changed on 2026-07-19/20" (FORGE) and "What was changed on
2026-07-20" (Designers Support) — this file is the short version: what's done, what's
still open, and what to know before touching anything. Two separate threads this
session: the **FORGE** app (standalone, `forge.html`) and the **deployed Modcraft app**
(`index.html`) — don't confuse which codebase a given item belongs to.

## What shipped today (all live, deployed, verified where noted)

### FORGE (`forge.html`) — standalone 3D cabinet-drawing review tool, 12 rounds
1. Fixed several real interaction bugs: repeated part deletion collided/targeted the
   wrong box, module splitting duplicated the full shelf count into every module instead
   of dividing it, a height clamp silently capped every cabinet at 2700mm regardless of
   real height, Delete key didn't work, independent-module resize didn't preserve total
   height.
2. Rebuilt edge-banding visualization to shade/outline the actual banded edge location
   instead of a whole-part color that only said "banded somewhere."
3. Draft save/load (switched from localStorage, which hit quota fast, to real
   downloadable `.json` files), shelf add/subtract, per-part resize + reposition +
   shelf-type conversion with live feedback, fascia/filler cabinet detection, and full
   cabinet-type reclassification (change a detected cabinet's type without starting
   over).
4. **Two real, confirmed layout bugs found via live testing against a real MSSI
   drawing:** two-tier layouts (wall cabinet directly over a base cabinet) were
   splitting apart instead of stacking; the whole scene was left-right MIRRORED versus
   the source drawing (confirmed via actual screen-space projection math, not just
   eyeballing). Both fixed.
5. Built a **position-debug diagnostic table + raw AI response viewer** directly in the
   app after 3 rounds of screenshot-based guessing weren't converging on the same
   drawing. That data immediately revealed two concrete AI misreadings (a wall+base pair
   getting collapsed into one fake "tall" cabinet; the AI grabbing the wrong kind of
   "filler" instead of the real fascia) — both fixed with targeted prompt rules. A
   follow-up re-test then found the diagnostic tool ITSELF had a false-positive bug
   (flagging cabinets at completely different heights as "overlapping" just because
   their footprints crossed) — fixed to a real 2D overlap test.

**Status: genuinely NOT fully resolved.** Positioning itself is now solid (verified
against the drawing's real reported data multiple times, no more mirroring/false
overlaps/wrong stacking). But on live re-tests of the same drawing, the AI still
sometimes misses a real cabinet between separate runs (non-determinism, not a
positioning bug), and the fascia has never actually been found by the live API despite
the prompt fix. Don't report this drawing as "done" — it isn't.

### Designers Support (deployed `index.html`)
1. Fixed a real bug where the AI writes a detailed, accurate prose summary of a cutting
   list but never populates the actual components table — looked like a clean success
   with nothing extracted underneath. Now detects and clearly warns on this mismatch,
   plus a stronger prompt instruction. **User confirmed fixed on a live re-test** of
   their real 75-component pharmacy cutting list.
2. Redesigned the materials/hardware catalog-matching UI. The automated matcher scores
   the whole catalog but only showed the top 6 results — when that cap hid the correct
   item, Outsource was the only fallback. User correctly pushed back that capping wasn't
   saving real search effort, just hiding results. Corrected to one always-searchable
   list: AI suggestions shown by default, full uncapped catalog search the moment you
   type anything.

## What's still open

**FORGE, needs more live-API testing (top priority — mid-investigation, don't drop):**
- AI cabinet-detection consistency — same drawing, same prompt, different cabinet count
  between runs. Not yet clear if this needs a different mitigation (self-consistency
  check, explicit "count and verify" instruction) or should just be accepted as
  inherent model non-determinism.
- The real ~100mm top fascia on the test drawing has still never been found by a live
  run, despite the prompt now correctly telling the AI to stop grabbing the wrong thing.
  Worth asking the user to zoom into that specific area of the drawing to check it's
  actually legible, rather than assuming it's still a prompt-wording problem.

**FORGE, not started (lower priority, no urgency):**
- Drag-and-drop repositioning of parts/cabinets.
- Generalizing the interaction layer beyond cabinets to other fabrication types
  (explicitly the user's long-term vision, but deliberately deferred until cabinets are
  fully proven out).

**Designers Support / cutting list, pre-existing, not touched this session:**
- Special-cut flag (non-rectangular parts), finish-size vs. cut-size detection,
  hardware-in-remarks/separate-sheet extraction, server-side API key (currently
  client-side, a security hardening item not an accuracy one).
- DXF vector parsing as a second, more reliable input path for files coming straight out
  of Cabinet Vision/SketchUp Pro/AutoCAD — not started.

## Things worth knowing before touching code here

- **FORGE (`forge.html`) is a fully separate, standalone app from the deployed Modcraft
  (`index.html`).** Don't confuse the two codebases — they don't share code or state.
  `poc_cabinet.html` is a THIRD, separate reference file and must never be touched
  (explicit standing instruction from an earlier session).
- **When any future "the layout/positions look wrong" report comes in for FORGE, pull
  the position-debug table first** — don't guess from a screenshot. This exact tool is
  what broke a 3-round stalemate this session; screenshots alone were not enough to
  distinguish "the AI reported bad data" from "the render pipeline is still broken."
- **A rich, detailed AI summary does NOT guarantee the underlying structured data
  actually got populated** — true in both FORGE (cabinet detection) and Designers
  Support (cutting-list extraction). The model can describe something correctly in
  prose while leaving the required structured fields empty. Both apps now have
  detection/warnings for this specific failure mode, but it's worth remembering as a
  general class of risk with any tool-use extraction task.
- **When a "cap the automated results, add a manual fallback for when the cap fails"
  design gets proposed again, default straight to "one uncapped, always-searchable UI"
  instead.** The two-step version was tried and explicitly rejected by the user this
  session for good reason — the cap was never actually saving real work.
- `prodApiCall()` (deployed app) and FORGE's `analyzeDrawing()` are separate
  implementations of similar streaming/parsing logic — a fix to one does not
  automatically apply to the other (same "hand-duplicated code drifts apart" pattern
  already known for `recalc()`/`recalcFQ()`, see the 2026-07-18 handoff notes below).

## Where the deep detail lives
FORGE: `CLAUDE.md` → "What was changed on 2026-07-19/20 (session — FORGE app...)", plus
the full round-by-round writeup in memory (`project_forge_app.md`, Rounds 11–22, every
commit hash and verification step). Designers Support: `CLAUDE.md` → "What was changed
on 2026-07-20 (session — Designers Support...)", plus memory
(`project_drawing_analysis_dxf_direction.md`). Everything above is shipped to `main` and
deployed where applicable (FORGE has no separate deploy step — it's a static file, same
repo) — no uncommitted work, no half-finished features from this session.

---

## Previous handoff (2026-07-18) — still relevant, not superseded

The items below are from the session before this one and remain accurate unless
contradicted above.

### What shipped 2026-07-18
1. Supabase disconnection is now impossible to miss silently — real liveness check
   every 15 min, three-state status in Settings → Company & DB, urgent banner + 24h
   Admin escalation on a confirmed break.
2. RLS tightened to company/role on 10 core tables — Admin/Director see everything,
   Manager+receive_all sees everything, everyone else sees their own company.
3. Explicit per-company access grants — Settings → Users → "Additional company access."
4. A 2-month-old crash bug fixed — Stage 2 (Final Quotation) summary panel was silently
   failing on every "Fabrication with Installation" quotation since 2026-05-26.
5. Wufoo attachment consolidation, discount escalation threshold, mandatory PIN setup
   before approving.

### Still open from 2026-07-18
- Price DB cleanup (9 leftover template typo duplicates, ~16 unmatched catalog items,
  ~600 unpriced material color rows) — needs the user's decision, not code.
- Services capacity data — Cost Breakdown → Services still has `outputPerShift=0` for
  most services, so margins show "—" instead of real numbers.
- ElevenLabs voice upgrade for Lami — nice-to-have, not blocking anything.
- The `pmes_*` Production Management system (22 tables, same Supabase project) is wide
  open to `anon` — confirmed with the user this is out of scope for this app, handled
  in that system's own separate development.

### Things worth knowing (carried forward)
- `recalc()` (Stage 1) and `recalcFQ()` (Stage 2) are hand-duplicated and drift out of
  sync constantly — any fix to one needs an explicit check against the other.
- This app's org data (company names, emails) has real typos and whitespace drift —
  never exact-match, always normalize first.
- External tests of Google-hosted endpoints can give false negatives — an in-app test
  (real browser, real session) is the reliable check, not a curl-based one.
