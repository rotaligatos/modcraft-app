# Dashboard redesign — proposal

Working prototype: **`dashboard_redesign.html`** (standalone, double-click to open).
`index.html` is untouched. Nothing here is deployed.

---

## Why not React

The brief suggested React-Grid-Layout, Recharts and Framer Motion. None can be used:
Modcraft is one 32,000-line `index.html` with no build step, served from GitHub Pages
and embedded in a Google Site. Adding React means a bundler, a repo restructure and a
rewrite of every page — the exact risk not worth taking for a dashboard.

Everything asked for is in the prototype in **~380 lines of plain JS, no dependencies**:
drag to reorder, drag to resize with snapping, auto-arrange, add/remove from a library,
and per-card chart switching. Charts are hand-drawn SVG for the same reason `drawChart()`
is hand-drawn canvas today — no bundle, no licence, and the palette is ours.

---

## 1. Layout and the edit mode

**Normal mode.** A 12-column dense grid. One widget unit = 3 columns × 96px, so sizes
snap to 1×1, 2×1, 2×2 and full width — the brief's sizes, expressed so CSS Grid can pack
them. `grid-auto-flow: dense` lets a small tile backfill the hole a wide one leaves,
which is what makes auto-arrange work without a collision solver.

Hierarchy, top to bottom:

1. **Command strip** — company scope (All / WCL / MSSI / CWL), period, and Edit. One row,
   sticky candidate. Every widget recomputes from the same filtered slice, so the scope
   control belongs above the grid, not repeated inside three separate cards as today.
2. **Alert tiles** — small, high-contrast, left severity stripe. What needs action today.
3. **Wide charts** — trend and funnel, 2 rows tall, room for axes and a legend.
4. **Tables** — team, clients, ageing.

State reads as **form as well as colour**: a 3px left stripe plus a pill, so severity
survives greyscale and colour-blindness. Semantic colours (teal good / amber warning /
coral critical) are the app's existing four accents — nothing was reskinned, because a
dashboard in a different palette to the other twelve pages reads as a bug.

**Edit mode** turns the surface into a **nesting view**: the board rule appears behind the
widgets, cards go to dashed outlines, each grows a drag handle and a corner resize grip,
and an "Add widget" tile appears at the end. The auto-arrange button says **Nest widgets**
and packs largest-first, because packing rectangles onto a sheet is this company's own
daily metaphor — `guillotinePackBoards()` already does it for real.

While resizing, a badge shows the live size (`2×1`). Reorder animates with FLIP so a move
reads as movement, not a jump-cut. Everything respects `prefers-reduced-motion`.

Below 900px — your Google Sites embed — the grid drops to 6 columns, cards go full width
and resize is disabled with an explanation rather than silently misbehaving.

---

## 2. The KPI menu — 18 widgets

Every one is computable from fields that already exist. Access keys are the ones
`applyNavAccess()` / `canViewCostReport()` already enforce.

### Pipeline & revenue
| Widget | Computed from | Access |
|---|---|---|
| **Open pipeline** | `total` where status is issued but not won/lost | Profit/Revenue |
| **Won revenue** | `total` where `clientApprovedAt` in period | Profit/Revenue |
| **Revenue vs target** | monthly `clientApprovedAt` + target | Profit/Revenue |
| **Revenue by company** | col U `Company`, keyword-matched | Profit/Revenue |
| **Average deal size** | won ÷ count won | Profit/Revenue |

### Conversion & performance
| Widget | Computed from | Access |
|---|---|---|
| **Quotation funnel** | the status ladder, with drop-off per step | Reports |
| **Win rate** | client-approved ÷ issued | KPI |
| **Team performance** | `user` + `includeKpi`, existing table | KPI |
| **Top clients by value** | grouped `bizName` | Reports |
| **Gross margin** | saved `costReport` snapshot | Profit/Revenue 🔒 |

### Operational & speed
| Widget | Computed from | Access |
|---|---|---|
| **Response time** | `jobStartedAt`/order received → `initialLockedAt`, via `calcWorkingMinutes` | KPI |
| **Order queue** | `pendingOrders` status + SLA breach | KPI |
| **Quotation ageing** | the 25/30/35-day ladder off `QUOT_AGE_START` | Reports |
| **Revisions & additions** | `.R1` serials + `additionalFrom` | Reports |

### Needs attention
| Widget | Computed from | Access |
|---|---|---|
| **Unsigned quotations** | locked with no `qSignatures.checked` | open |
| **Awaiting client approval** | `finalLockedAt` set, `clientApprovedAt` null | open |
| **Past SLA** | orders over the working-hours target | open |
| **Data to fix** | drafts to clear, zero-total quotations, approvers with no PIN, missing signature images | Reports |

Two notes worth acting on before this ships:

- **Won revenue is currently unmeasurable with confidence.** No quotation carries a recorded
  approval timestamp; every "won" figure today is inferred from a status label. The widget
  will read whatever that inference gives until approvals are stamped with a date.
- **Response time has a sample of 6.** Until orders are worked through the app, that tile is
  honest but thin. The prototype states the sample size on the card rather than hiding it.

---

## 3. How it would go into `index.html`

**Not a rewrite.** The current dashboard is a fixed stack of 8 hard-coded sections gated by
5 boolean keys. The change is to make that list data-driven — the widgets themselves are
mostly existing code, moved.

Reused unchanged:
- `gLoadDirData()`, `gLoadPendingOrders()`, `calcWorkingMinutes()`, `_orderCompanyKey()`
- `gSaveDashPref()` / `gLoadDashPref()` — the layout array replaces the boolean map in the
  same `DASHPREF_<email>` row. Old saved rows migrate: five `true` keys → the default layout.
- `DASHALLOW_<email>` restrictions and every feature-access key, untouched.
- `renderDashFollowed()`, the team table and the order-queue card become widget renderers
  as-is — same functions, different container.

New code, all additive:
- `DASH_CATALOG` — the 18 definitions above.
- `renderDashGrid()` / drag / resize / nest — the prototype's ~380 lines.
- The library drawer and the per-card popover.

**Risk.** Contained to `page-dashboard`. No pricing code, no `recalc()`/`recalcFQ()`, no
quotation state, no save path. The dashboard is read-only over data other pages own — which
is why this is a safe place to do visual work, unlike anything touching a total.

**Suggested order.** Grid + drag + resize behind the existing Customize button first,
keeping today's 5 widgets. Prove it in the embed. Then add catalogue widgets one at a time.

---

## Open question

The prototype uses the app's own four accents on the warm paper ground. If you want a
sharper, cooler look for the dashboard specifically, say so — but it would then not match
the other twelve pages, and consistency is worth more than novelty here.
