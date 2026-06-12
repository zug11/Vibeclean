# CTO Sprint Guide — VibeDB SQL System Overhaul + Canvas Auto-Layout

**Audience:** CTO / engineering lead
**Sources:** `CLAUDE_CODE_PROMPTS_V2.md` (the eight sequenced prompts), `COMPILER_REDESIGN.md` (compiler audit + diagnostics architecture), and `SPECIFICATION.md` (repo map, this repo).
**Sprint theme:** Make the SQL engine trustworthy (faithful compiler, AST parser, diagnostics) **and** make the canvas readable at scale (auto-layout that doesn't produce spaghetti).

---

## 1. Sprint Objective

Two parallel tracks:

1. **SQL System Overhaul (Prompts -1 → 6).** Stop the compiler from fabricating schema content on user-driven paths, replace the lossy regex parser with an AST parser, and ship a Zod/ESLint-style diagnostics engine with editor/export/deploy gates. Eight independently shippable, individually testable prompts, run in order.
2. **Canvas Auto-Layout UX Epic.** A real layout algorithm for table nodes and bezier FK curves so auto-layout prevents node overlap and edge spaghetti. **This is flagged as the hardest item in the sprint** — staff it accordingly (see §4).

Both tracks ride on a hardened version-control discipline (§5): every step must be individually revertible.

---

## 2. Sequenced Work Plan (Track 1 — from CLAUDE_CODE_PROMPTS_V2.md)

Run strictly in order. Each prompt is a shippable unit with its own acceptance test — **do not start the next until the previous one's acceptance test passes.**

| # | Prompt | What ships | Why it's sequenced here |
|---|---|---|---|
| 1 | **Prompt -1 — Pre-flight** | Real `typecheck` script (`tsc --noEmit`), `vite-env.d.ts`, src-scoped test/lint, two type-hole fixes, **versioned persisted-IR envelope + pass-through migrator** | Every later "build passes" gate is currently theater (`vite build` doesn't typecheck). The migrator seam must exist before any IR-adjacent change. ~30–60 min. |
| 2 | **Prompt 0 — Reliability hotfixes** | Loader guard (THE empty-canvas fix), `useHistory` idx-ref fix, diagnostic logging, batch-edit truncation + Haiku model selector | AI generation and batch edit must be reliable before surface work. Root cause is confirmed: the unguarded async project loader. |
| 3 | **Prompt 1 — Unified inline SQL editor** | CodeMirror-based editor (Canvas SQL + Patches sections), v1 honesty banner, DDL-modal deletion, AI-raw-SQL → patches | Establishes the primary SQL surface everything later builds on. |
| 4 | **Prompt 2 — Corruption hotfix (P0)** | Remove `runCompilerPass` from the 7 user-driven sites; cycle-safe View SQL; CHECK dedup | The "lying about user SQL" bug. AI sites keep the full compiler. |
| 5 | **Prompt 3 — Faithful vs Full modes** | `runCompilerPass(tables, { mode })`; faithful = zero mutation; re-add faithful calls at the 7 sites | Makes Prompt 2 principled and creates the seam the analyzer attaches to. May be fused with Prompt 2 (option in the doc) to halve call-site churn. |
| 6 | **Prompt 4 — AST parser** | `node-sql-parser`-based `sql-schema-parser.ts`; **the load-bearing `DO $$` unwrap step**; sha256 patch identity | Measured feasibility: 8/11 statements parse; the only failures are `DO $$` wrappers, and the inner ALTERs parse perfectly. Skip the unwrap and 100% of CHECKs silently vanish. |
| 7 | **Prompt 5 — `analyzeSchema` + Tier 1 validators** | Diagnostics engine (code/path/severity/suggestedFix), 10 validators (V1–V10), editor Apply gate + Force Apply | The architectural unlock from `COMPILER_REDESIGN.md`: analyze-and-suggest, never silently mutate. |
| 8 | **Prompt 6 — Diagnostics panel + gates + cleanup** | Tier 2 warnings (W1–W10), sidebar panel, export gate (bypassable) + deploy gate (**no bypass**), file-only import, round-trip CI test, legacy parser deletion, banner removal | The round-trip test becomes a product invariant: a red round-trip in CI is a P0. |

**Non-negotiables carried from the source docs:**

- Locate code by **symbol/grep anchors, never line numbers** — the prompts edit the same 4,800-line file they cite; line drift is the #1 failure mode.
- Save the real production schema as `tests/fixtures/production-schema.sql` **before starting**; Prompts 2, 4, 5, 6 test against it.
- Schema semantics live in the IR; mutation (compiler) and analysis (analyzer) stay separate forever; provenance over cleverness.
- This clean checkout does **not** contain the vendored `zod-main-2`/`kysely-master` trees the prompts reference — still apply Prompt -1's exclusions defensively so the configs are correct if they return.

---

## 3. Flow Matrix (canonical — what runs where)

| Flow | Compiler behavior |
|---|---|
| AI generation / retry / auto-fix / suggestion accept | `full` mode allowed |
| Imported SQL (file) | no mutation; analyzer only |
| SQL editor Apply to Canvas | no mutation; analyzer gate blocks on errors |
| View SQL / Export / Deploy / Reset editor | faithful generation only (+ emission gate on export/deploy) |

---

## 4. UX Epic — Auto-Layout Algorithm for Nodes & Bezier Curves

> **Requirement (product):** Auto Layout must prevent the canvas from looking like spaghetti, and table nodes must never overlap. **This is going to be a very hard feature to fulfil — plan for it explicitly.** Budget it as its own epic with a spike, not a one-day task.

### 4.1 Current state (why it's broken)

The existing implementation is `runForceLayout` in `VibeDBPage.tsx` (~line 1196): a naive force-directed loop — 150 iterations, O(n²) point-charge repulsion (`repulsion = 2500`), FK springs (`springLength = 140`), a weak centering pull, and a ±20px per-iteration displacement clamp. FK edges render as cubic bezier curves with purely horizontal control points (`M … C cp1x sy, cp2x ty, ex ty`).

Failure modes:

1. **Node overlap.** Repulsion treats tables as points, but tables are ~`TABLE_WIDTH` wide rectangles whose height grows with column count. Two "far enough" centers still produce overlapping cards.
2. **Spaghetti edges.** Bezier control points ignore every other node — edges cut straight through table cards and cross each other freely. No crossing minimization exists anywhere.
3. **Non-determinism & layout thrash.** Every run re-simulates from current positions; the same schema can settle in different shapes, and re-layout after AI generation moves tables the user already placed.
4. **No spring at all between unrelated tables** — disconnected clusters drift apart with only the weak centering force holding the canvas together.

### 4.2 Required algorithm (engineering spec)

Treat layout as **two separable problems — node placement, then edge routing** — and make both node-geometry-aware.

**Phase A — Node placement (layered/Sugiyama-style, recommended):**

1. Build a graph: nodes = tables with measured width/height (height = f(column count)); edges = FK relationships.
2. Rank tables into layers by FK dependency (roughly the same topological order `ExportGenerators.topologicalSort` already computes — reuse it, with its new cycle-safe behavior from Prompt 2; break cycles by temporarily dropping one edge per cycle).
3. Order nodes within each layer to minimize edge crossings (median/barycenter heuristic, a few sweeps).
4. Assign coordinates with **mandatory minimum gaps** (e.g. ≥ 48px horizontal, ≥ 32px vertical) computed from real node rectangles — this is what makes overlap *impossible by construction* rather than probabilistically rare.
5. **Strongly recommended: do not hand-roll steps 2–4.** Adopt `elkjs` (ELK layered) or `dagre` — both are battle-tested Sugiyama implementations. The build-vs-buy spike (3 days max) should compare elkjs vs dagre vs improved-force on the 25-table fixture and pick one. Hand-rolling is only justified if bundle size or layout-animation constraints rule both out.
6. If force-directed is kept as a fallback for "organic" mode: replace point repulsion with **rectangle-aware repulsion** (separation force based on AABB overlap + margin) and finish with a deterministic **overlap-removal pass** (e.g. push-apart sweep along the dominant axis) so the no-overlap guarantee holds regardless of simulation quality.

**Phase B — Edge routing (bezier curves):**

1. Keep cubic beziers, but choose anchor sides per edge (left/right of each card, at the FK row's y — already partially done) based on relative node positions after layout.
2. Set control-point tangents perpendicular to the node edge with length proportional to node distance (clamped), so short edges stay tight and long edges arc gently.
3. **Obstacle avoidance:** if an edge's straight-line corridor intersects a third table's rectangle (+margin), bow the curve around it by offsetting the control points, or route via ELK's edge routing if elkjs is chosen.
4. **Fan-out separation:** multiple edges sharing a node side get vertically distributed anchor points and staggered curvature so parallel FK lines don't stack into a single rope.
5. Self-referencing FKs render as a small loop on one side of the card.

**Phase C — UX behavior contract:**

- **Determinism:** same schema in → same layout out (stable sort keys, no `Math.random`).
- **Respect user intent:** auto-layout after AI generation must only place *new* tables; tables the user has manually positioned keep their x/y (this is already a requirement of sprint Prompt 1's Apply-merge — share the implementation).
- **Animate** position changes (~300ms ease) so users can track where their tables went; layout runs in a worker or chunked rAF if it exceeds ~16ms.
- **One undo step:** an auto-layout run is a single `useHistory` entry (depends on the Prompt 0 useHistory fix landing first).
- **Performance budget:** ≤ 200ms for 50 tables / 150 FKs, no dropped frames during the animation.

**Acceptance test (ship gate):**

1. 25-table fixture with 40+ FKs: zero overlapping node rectangles (assert programmatically: no AABB intersection over all pairs).
2. Edge crossings reduced ≥ 60% vs current `runForceLayout` on the same fixture (count crossings programmatically).
3. No edge passes through a non-endpoint table rectangle.
4. Two consecutive runs on an untouched canvas produce identical positions.
5. Manual positions survive an AI generation that adds 5 tables.
6. Ctrl+Z after Auto Layout restores all prior positions in one step.

### 4.3 Sequencing & risk

- Depends on: Prompt 0 (useHistory fix) and ideally Prompt 2 (cycle-safe `topologicalSort`).
- Run the 3-day **library spike first**; the spike's output is a one-page decision memo (elkjs vs dagre vs custom) with measured layout quality + bundle impact.
- Risk: this epic can swallow the sprint. Timebox Phase A+C as the must-have (no overlaps, deterministic, undo-able); Phase B obstacle avoidance and fan-out separation may slip to the next sprint **but anchor-side selection and tangent improvement must not** — they're cheap and remove most visual spaghetti.

---

## 5. Version Control & Rollback Discipline (mandatory)

The CTO directive: **if something doesn't work, we must be able to roll it back.** The sprint's structure (8 independently shippable prompts + 1 epic) maps directly onto VCS practice:

1. **One branch per prompt/epic phase.** `feat/p-1-preflight`, `fix/p0-loader-race`, `feat/p1-sql-editor`, … `feat/layout-spike`, `feat/layout-phase-a`, etc. Never stack two prompts in one branch.
2. **`main` is always releasable.** Work merges to `main` only via PR, only after that prompt's acceptance test passes, and only with CI green (typecheck + src-scoped tests; from Prompt 6 onward, the round-trip schema test too).
3. **Small, atomic, conventional commits** (`feat:`, `fix:`, `test:`, `chore:`) within each branch — each commit should build. This is what makes `git bisect` usable when a regression slips through.
4. **Rollback strategy — revert, don't rewrite:**
   - Bad merge on `main` → `git revert -m 1 <merge-sha>` (a new commit that undoes it). **Never force-push or hard-reset `main`.**
   - Because every prompt is a separate merge, reverting "Prompt 4" is one command and doesn't drag Prompts 1–3 down with it.
   - Tag the repo after each prompt lands: `sprint-overhaul/p-1`, `…/p0`, … `…/p6`, `…/layout-a`. Tags are the named rollback points.
5. **Data rollback, not just code rollback.** Code reverts are not enough once the persisted IR changes shape: Prompt -1's `schemaVersion` envelope + `migrateStoredProject` is the rollback insurance for **user data**. Any future shape change must add a migration `case` — and reverting such a change must keep the migrator able to read the newer version (forward-compat read or a down-migration). Treat a persisted-shape change without a migration case as a blocking review failure.
6. **Feature-risk isolation.** The auto-layout epic ships behind the existing expert-mode gating (the Auto Layout button) until acceptance passes; the old `runForceLayout` stays in the tree until the new layout has survived a full sprint in production, then is deleted in its own commit (trivially revertible).
7. **CI as the rollback tripwire.** Prompt 6 adds `.github/workflows/test.yml` (`npm ci` → `typecheck` → `build` → `test:schema`). Add it **now** (Prompt -1 makes the gates real) rather than at sprint end — every PR from day one runs the same gates. A red round-trip test on `main` is a P0: revert first, investigate second.
8. **PR hygiene:** every PR description links the prompt it implements, states its acceptance-test results verbatim, and names its rollback command (`git revert -m 1 <sha>`). No drive-by refactors inside prompt PRs — they poison clean reverts.

---

## 6. Jira Tracking ([vibedb.atlassian.net](https://vibedb.atlassian.net), project **KAN — Vibedb**)

| Ticket | Work item |
|---|---|
| [KAN-4](https://vibedb.atlassian.net/browse/KAN-4) | **Epic:** SQL System Overhaul (Prompts -1 → 6) |
| [KAN-6](https://vibedb.atlassian.net/browse/KAN-6) | Prompt -1 — Pre-flight: real gates + versioned persisted IR |
| [KAN-7](https://vibedb.atlassian.net/browse/KAN-7) | Prompt 0 — Reliability hotfixes (loader race, useHistory, batch-edit) |
| [KAN-9](https://vibedb.atlassian.net/browse/KAN-9) | Prompt 1 — Unified inline SQL editor |
| [KAN-8](https://vibedb.atlassian.net/browse/KAN-8) | Prompt 2 — P0 corruption hotfix + cycle-safe View SQL + CHECK dedup |
| [KAN-10](https://vibedb.atlassian.net/browse/KAN-10) | Prompt 3 — Faithful vs Full compiler modes |
| [KAN-11](https://vibedb.atlassian.net/browse/KAN-11) | Prompt 4 — AST parser (`node-sql-parser` + DO $$ unwrap) |
| [KAN-12](https://vibedb.atlassian.net/browse/KAN-12) | Prompt 5 — `analyzeSchema` + Tier 1 validators + Apply gate |
| [KAN-13](https://vibedb.atlassian.net/browse/KAN-13) | Prompt 6 — Diagnostics panel + Tier 2 + emission gates + CI + cleanup |
| [KAN-14](https://vibedb.atlassian.net/browse/KAN-14) | Version control & rollback discipline (§5) |
| [KAN-5](https://vibedb.atlassian.net/browse/KAN-5) | **Epic:** Canvas Auto-Layout (UX, HIGH RISK — §4) |
| [KAN-15](https://vibedb.atlassian.net/browse/KAN-15) | Layout spike (3-day timebox): elkjs vs dagre vs improved force |
| [KAN-16](https://vibedb.atlassian.net/browse/KAN-16) | Layout Phase A — overlap-free node placement |
| [KAN-17](https://vibedb.atlassian.net/browse/KAN-17) | Layout Phase B — bezier edge routing |
| [KAN-18](https://vibedb.atlassian.net/browse/KAN-18) | Layout Phase C — UX behavior contract |

---

## 7. Definition of Done (sprint)

- [ ] Prompts -1 → 6 merged in order, each tagged, each acceptance test recorded in its PR.
- [ ] `npm run typecheck` = 0 errors; tests src-scoped; CI green on `main`.
- [ ] Round-trip test (import → faithful generate → re-parse → deep-equal IR) green in CI.
- [ ] Editor shows no compiler-fabricated content; deploy blocked on analyzer errors (no bypass).
- [ ] Auto-layout: zero node overlaps, deterministic, single undo step, crossing reduction measured; spike memo committed.
- [ ] Every saved project written this sprint carries `schemaVersion`; an old project still loads.
- [ ] All rollback tags exist; at least one rehearsed `git revert` of a merge commit on a staging branch (prove the process, not just the policy).
