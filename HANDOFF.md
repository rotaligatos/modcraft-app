# Modcraft — Session Handoff (as of 2026-07-18)

Quick-start doc for picking up work in a fresh session. Full technical detail for everything
below lives in `CLAUDE.md` under "What was changed on 2026-07-18" — this file is the short
version: what's done, what's still open, and what to know before touching anything.

## What shipped today (all live, deployed, verified)

1. **Supabase disconnection is now impossible to miss silently** — real liveness check every
   15 min, three-state status in Settings → Company & DB, urgent banner + 24h Admin escalation
   on a confirmed break.
2. **RLS tightened to company/role on 10 core tables** — Admin/Director see everything,
   Manager+receive_all sees everything, everyone else sees their own company. Tested against
   real data, two real data-quality bugs (company name typo, trailing-space emails) caught and
   fixed before going live.
3. **Explicit per-company access grants** — Settings → Users → "Additional company access."
   Real grants are already set for Allan Lagsao, Michael Delos Reyes, and several MSSI staff.
4. **A 2-month-old crash bug fixed** — Stage 2 (Final Quotation) summary panel was silently
   failing on every "Fabrication with Installation" quotation since 2026-05-26. Affected 22
   real quotations. Fixed, plus 4 related Stage 1/Stage 2 inconsistencies in the same area.
5. **Wufoo attachment consolidation** — a quotation exported from a Wufoo order now gets the
   original attachment copied into its own Drive/Storage folder at lock time (both stages),
   and those supplementary files get cleaned up automatically if the quotation is cancelled.
6. **Discount escalation threshold** — Manager can approve up to 10% (configurable) on their
   own; above that, it always goes to a Director. Built and tested end-to-end.
7. **Mandatory PIN setup before approving** — closes the old "1234" fallback gap. Anyone
   without a PIN gets redirected to set one before their approval action, then it resumes
   automatically.
8. Confirmed healthy, no code needed: the serial-number atomic claim service, and the
   Synology nightly backup (unbroken daily dumps, no actual gap despite an earlier scare).

## What's still open

**Needs your decision:**
- Price DB cleanup — 9 leftover template typo duplicates, ~16 unmatched catalog items, ~600
  unpriced material color rows. Needs your call on whether WCLI still carries those colors.

**Needs your action (data entry, not code):**
- Services capacity data — Cost Breakdown → Services still has `outputPerShift=0` for most
  services, so margins show "—" instead of real numbers.

**Standalone / long-horizon, no urgency:**
- Cabinet Drawing Intelligence POC (`poc_cabinet.html`, not in the live app) — oven tower on
  hold pending your plant team, 5 more cabinet types unverified, door-style system and DXF
  parsing not started.
- ElevenLabs voice upgrade for Lami — nice-to-have, not blocking anything.

**Explicitly NOT this app's problem, tracked but deliberately out of scope:**
- The `pmes_*` Production Management system (22 tables in the same Supabase project) is
  currently wide open to `anon` — no login required. Confirmed with the user this gets
  addressed in that app's own separate development, not folded into Modcraft's RLS work.

## Things worth knowing before touching code here

- **`recalc()` (Stage 1) and `recalcFQ()` (Stage 2) are hand-duplicated and drift out of
  sync constantly.** Today alone found 5 real discrepancies between them. Any fix to one
  needs an explicit check against the other before calling it done.
- **This app's org data (company names, emails) has real typos and whitespace drift.** Never
  exact-match a company name or email pulled from User Roles / `public.users` — normalize
  first (keyword-based for companies, `trim()`+`lowercase()` for emails). Getting this wrong
  silently locks real people out with no error shown.
- **External tests of Google-hosted endpoints (Apps Script webhooks, etc.) can give false
  negatives.** A curl-based check of the serial-claim service failed; the actual in-app test
  (real browser, real session) passed cleanly. When in doubt, ask the user to click the
  in-app test button rather than trusting an external check.
- Always verify claims against live data (Supabase MCP, direct SQL) before reporting status
  — several things believed "not yet built" or "still pending" this session turned out to
  already be done, live, and working (Wufoo→Supabase dual-write, the serial claim service,
  the Synology backups). Don't trust a stale summary — check first.

## Where the deep detail lives
Full commit-by-commit technical writeup: `CLAUDE.md`, section "What was changed on
2026-07-18." Everything above is shipped to `main` and deployed — no uncommitted work, no
half-finished features from this session.
