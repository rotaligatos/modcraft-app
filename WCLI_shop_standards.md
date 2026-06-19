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

### Screw counts (confirmed 2026-06-17)
| Joint | Screws (4×50 HiLo) |
|-------|--------------------|
| Bottom panel ↔ side panels | **4 pcs** (2 per side) |
| Solid top panel ↔ side panels | **4 pcs** (2 per side) |
| 18mm solid back panel | **8 pcs** — 2 each side + 2 top + 2 bottom |
| Thin grooved back (3/5/6mm) | none — sits in groove |
| Rail ↔ side panel | **2 screws per end** = **4 pcs per rail** |

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

### Shelves (confirmed 2026-06-17)
- **Shelf depth = cabinet depth − 20mm** (both fixed and adjustable).
- **Adjustable-shelf pin holes:** drilled in the side panels in **two rows** — one **35mm from the front edge**, one **35mm from the backing**. At each shelf level, drill the hole **plus one 50mm above and one 50mm below** (±50mm adjustability) → **3 holes per row per shelf** = **12 holes per shelf** (2 rows × 2 sides). **4 pins per shelf.**
- Fixed shelf: band front edge only (`1l`); fasten with screw 4×50 or Minifix.

### Standard board sizes
| Material | Sizes |
|----------|-------|
| MDF / PB / Plywood | **4×8 ft (1220 × 2440 mm)** standard; **6×8 ft (1830 × 2440 mm)** in some cases |
| Compact laminate | various |

---

## 6. Wall / upper cabinet (confirmed 2026-06-17)

- **Carcass:** 18mm full panels on **top, bottom, and both sides** (closed box — not rails). No toe kick.
- **Backing thickness by material:**
  - **MDF or PB → 3mm or 6mm**
  - **Plywood → 5mm**
  - Thin backing is **grooved into the sides/top/bottom** and **recessed 18mm from the rear edge** (same construction as the base cabinet grooved backing).
- **Two 18mm horizontal rails at the rear — only when the backing is THIN (3/5/6mm).** With **18mm backing there are NO rails** — the 18mm back is flush to the rear edge of the side panels, so a rear rail would protrude. (Universal rule: thin grooved backing → back rails; 18mm backing → none.)
  - Rail width **80–100mm** (model uses 90mm).
  - **Lower rail ≈ ¼ of cabinet height up from the bottom.**
  - **Upper rail ≈ ¼ of cabinet height down from the top.**
  - Both sit in the rear recess (behind the backing), spanning between the side panels.
  - The suspension brackets screw to the **side panels** (not the rails), so they are present regardless of backing type.
- **Suspension brackets (the white plastic adjustable corner brackets):**
  - **One at each top corner (L + R)**, screwed to the **inner face of the side panel**; a hole through the back panel lets the bracket flush to the rear.
  - Hooks onto a **steel wall mounting plate** screwed to the wall.
  - Height-adjustable so adjoining cabinets can be aligned. Qty: **2 brackets + 2 wall plates** per cabinet.
- No 45° / French cleat / direct-screw hanging — the plastic bracket + steel plate system is standard.

---

## 7. Tall / pantry cabinet (confirmed 2026-06-17)

- **Built like the base cabinet** — **solid 18mm top, bottom, and side panels**, floor-standing (toe kick + adjustable legs).
- **3 to 4 horizontal rails evenly distributed at the rear — only when the backing is THIN (grooved 3/5/6mm).** With **18mm solid backing there are NO back rails** (the solid back provides the rigidity, same as the base cabinet). Rails span between the side panels, ~90mm wide, 18mm, at the rear recess. (Model: 4 rails when height ≥ 1900mm, otherwise 3.)
- Each rail fastened with **2 screws per end** (4 per rail), same as other rails.
- **Doors vary by client preference:** single, double, or **pull-out larder** (full-extension pull-out frame with a fixed front panel).

---

## 8. Drawer base cabinet (confirmed 2026-06-17)

- **Drawer slide/guide thickness: 13mm per side** → drawer box width = **inner cabinet width − 26mm**.
- **Drawer box: 15mm boards** for sides, front/back, **and bottom** (not thin ply).
- **Drawer face: 18mm.**
- **Drawer box top edge is edgebanded** (`1l` on sides and front/back); bottom not banded.
- **Drawer guide (slide) is 50mm shorter than the cabinet depth** so it doesn't bump the backing → drawer box depth = cabinet depth − 50mm.
- Carcass like the base cabinet: **full bottom panel** + top front/back rails (and thin-backing rear support follows the universal backing rule).

---

## 9. Sink / open base cabinet (confirmed 2026-06-17)

- **Built like the base cabinet** — 18mm sides, **18mm full bottom panel**, **top front + back rails**, toe kick + adjustable legs.
- **Backing: always thinner board** (grooved 3/5/6mm) — a sink cabinet **never uses 18mm backing**. (A back can be omitted entirely, but when fitted it is always thin.)
- **2 back rails at the TOP and BOTTOM of the backing** (instead of the base's single centre rail) — the **centre is left clear so a hole can be cut for the sink plumbing**.
- **No shelves** on a sink cabinet.
- Doors per client preference.

---

## 10. Corner base cabinet — L-shape (confirmed 2026-06-17)

- **True L-shape:** outer footprint A1 × A2 (e.g. 900 × 900), each leg **D deep** (e.g. 600), leaving a notch (A1−D) × (A2−D) at the room-facing corner. The two inner faces are the door openings, meeting at the corner that points into the room.
- **Door openings** = leg length − depth (e.g. 900 − 600 = 300mm each). Doors can be **bi-fold** OR **two separate doors** (client preference).
- **Bottom panel and shelves are ONE L-shaped (notched) piece each** — NOT split into two halves.
- **Assembly:** the side/wall panels run full height and the **bottom is captured between the panels** (inset by the panel thickness) — the side panels are NOT sitting on top of the bottom. All internal members (bottom, shelves, rails, fascia) are inset to fit *between* the panels and must not protrude past them. Vertical panels **butt-joint** (one runs through, the adjacent insets to butt its inner face) — never overlap/expose double edges.
- **The left "backing" panel — whether 18mm or thin — is captured between the back-wall and left-end side panels** (inset to the same length as the top rail that sits on it); it must not extend past those panels. The back wall runs full to the left edge.
- **Special cut:** any L-shaped (notched) piece is flagged as a **Special cut** — a panel saw cannot stop a cut in the middle of a board, so the L is cut from its full bounding-rectangle blank with the notch as a separate operation (the notch is waste; bounding rectangle = material consumed).
- **Backing:** the **left side only** carries the (optional) thin grooved backing, using the base-cabinet procedure. It is **captured between the perpendicular side panels** (inset by the panel thickness) and **recessed 18mm** — the side panels extend to the rear and form the lip, so **no 18mm edge of the backing is left exposed** (same as the base cabinet). Centre support rail behind it (anti-bow). **Every other panel is an 18mm side panel — even the one facing the wall.** Thin backing is optional; with 18mm there is no separate backing.
- **3 top rails, all parallel** (run front-to-back, parallel to the left door): ① on top of the left backing, ② in front of the left door — **runs the full leg length up to the side panel** (same length as ①), ③ on the right side panel.
- **Shelves are housed (dado) into the side panels** — the shelf penetrates the side panel; it spans the full L footprint to the panels (not inset).
- **Fascia** — placed **on top of each door opening** (horizontal), acting as the **door stopper / stabilizer**; the doors close up against it.
- Toe kick + ~5 adjustable legs (outer + inner). 4 hinges (separate doors) or ~6 (bi-fold).

---

## Confirmed (2026-06-09)
1. ✓ Both top rails (front + back) band the front-facing edge.
2. ✓ Grooved backing: groove on **all four sides incl. top**, offset 18mm from back edge; backing grows **+18mm width / +18mm height**; **horizontal centre support rail** added (not a full panel).
3. ✓ Routered finger-pull: **router first, then edgeband**.
4. ✓ Dowel + cam lock **not used** — screw / Minifix only.
5. ✓ Aluminum handgrab cut **varies**, but **35mm** is the normal/default reduction.
