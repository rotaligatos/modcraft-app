# WCLI Shop Standards — Cabinet Construction Rules

> This is the **source of truth** for how World Class Laminate builds modular cabinets.
> The parametric engine (`poc_cabinet.html`) and, later, the AI drawing reader both
> reference these rules. Update this file whenever plant practice changes.
> Captured from plant feedback 2026-06-08. Items marked **[CONFIRM]** need verification.

EBT notation: `s` = short side (a **width**-direction edge), `l` = long side (a **length**-direction edge).
`4s`/`2s2l` = all four edges. Per-panel L = length, W = width.

---

## 1. Edge Banding (EBT) by component

| Component | EBT rule | Code | Notes |
|-----------|----------|------|-------|
| Side panel | Band **front + bottom** edges | `1s/1l` | front vertical = 1l, bottom = 1s |
| Bottom panel | Band **front** edge | `1l` | |
| Top rail (front) | Band **front-facing** edge | `1l` | |
| Top rail (back) | Band **front-facing** edge | `1l` | ✓ confirmed — both rails banded |
| Back panel (18mm full) | None | `N/A` | hidden |
| Back panel (6mm / 3mm grooved) | None | `N/A` | sits in groove |
| Support back panel | None | `N/A` | behind thin backing |
| **Fixed** shelf | Band **exposed (front)** side only | `1l` | |
| **Adjustable** shelf | Band **all** sides | `2s/2l` | |
| End panel (exposed side cover) | Band **front + bottom** | `1s/1l` | covers assembly screws |
| Door — standard | Band **all 4** edges | `2s/2l` (=4 edges) | |
| Door — aluminum handgrab | Band 3 edges; top edge grooved for alu profile | `1s/2l` | top edge covered by handgrab |
| Door — 45° taper (J-pull) | Edge **all** sides, then 45° cut, then **manual** edgeband | `2s/2l` + manual | |
| Door — routered finger-pull | **Router first, then edgeband** | `2s/2l` | ✓ confirmed: router → edgeband |
| Toe kick board | Band **front** edge | `1l` | |

---

## 2. Backing construction

- **Standard: 18mm single-face backing** (full back panel).
- Options on client preference: **3mm** or **6mm** backing.
- **When 6mm (or 3mm) is used — grooved construction:**
  - Groove cut on **all four sides** — side panels, bottom panel, **and top** (back top rail): **4mm wide × 9mm deep**, offset **18mm from the back edge**.
  - The thin back is inserted into the groove, so it is **recessed 18mm from the rear edge** — the carcass (sides/bottom/top) extends 18mm behind the back panel (an 18mm lip). The back is **not flush** with the rear of the cabinet.
  - Because the groove is 9mm deep on each edge: **backing width += 18mm** (9mm into each side) and **backing height += 18mm** (9mm into bottom + 9mm into top). The 18mm offset is the groove *position*, not a size add.
  - **A horizontal support rail is added across the centre** (behind the thin back) for rigidity — prevents the thin panel bowing.

---

## 3. Assembly fasteners

| Situation | Fastener |
|-----------|----------|
| Standard carcass assembly | **HiLo / chipboard screw 4 × 50** |
| Joining two cabinets together | **HiLo / chipboard screw 4 × 32** |
| When the assembly screw would be **visible** (exposed end) | **Minifix** instead of screw |
| Exposed side panel | Add an **End panel** to cover the screws (if not using minifix) |
| **Fixed** shelf fastening | Screw (4×50) **or** Minifix |
| **Adjustable** shelf | **Shelf pins — 4 per shelf** |
| Dowel + cam lock | **Not used** in WCLI cabinet fabrication — strictly screw / Minifix |

---

## 4. Doors & handles

- **Hinges:** 2 per door leaf. If door height is **double the standard** (tall door), use **4** per leaf.
- **Door gap / reveal:** 3mm.
- **Handle options:**
  1. **Aluminum handgrab** — reduce door height by **~35mm** (depends on handgrab size); groove the **top edge** of the door; **glue** before inserting the aluminum profile for durable attachment.
  2. **45° taper (J-pull)** — edge all sides, 45° cut on the edge, then manual edgebanding.
  3. **Routered finger-pull** — router the door edge so it can be opened (no separate handle).
  4. **Knob / D-handle** — drilled, 1 per leaf.

---

## 5. Carcass & materials

- **Standard carcass thickness: 18mm.** Never 25mm for cabinets **unless** client requests it or the item is a **table**.
- **Adjustable legs** used for base cabinets; **toe kick board** clipped on, standard height **100mm**.
- 2-face melamine board unless stated otherwise.

### Standard board sizes
| Material | Sizes |
|----------|-------|
| MDF / PB / Plywood | **4×8 ft (1220 × 2440 mm)** standard; **6×8 ft (1830 × 2440 mm)** in some cases |
| Compact laminate | various |

---

## Confirmed (2026-06-09)
1. ✓ Both top rails (front + back) band the front-facing edge.
2. ✓ Grooved backing: groove on **all four sides incl. top**, offset 18mm from back edge; backing grows **+18mm width / +18mm height**; **horizontal centre support rail** added (not a full panel).
3. ✓ Routered finger-pull: **router first, then edgeband**.
4. ✓ Dowel + cam lock **not used** — screw / Minifix only.
5. ✓ Aluminum handgrab cut **varies**, but **35mm** is the normal/default reduction.
