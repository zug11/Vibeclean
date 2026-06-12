# Design — Live Inline SQL Editor (SQL ⇄ Canvas)

**Status:** design proposal. This is the "next document" that `inline.md` and
`AI_TIMEOUT_PROBLEM_BRIEF.md` defer to — it proposes *how* we'd build live SQL↔canvas editing.
**Related:** `inline.md` (the problem statement this answers), `AI_TIMEOUT_PROBLEM_BRIEF.md` (streaming
generation — the same pipeline with a different producer), `CLAUDE_CODE_PROMPTS_V2.md` (Prompts 1/4/5
build the machinery), `CTO_SPRINT_GUIDE.md` §4 (auto-layout, a hard dependency).

---

## 1. Goal & scope

An editor where the **canvas updates as you type SQL**: write `CREATE TABLE users (...)` and the table
appears; add a `REFERENCES` clause and the FK line draws itself. The same surface is where the AI
**writes/streams SQL** — superseding today's `ddl_patch` stopgap (which appends raw SQL to the export
but never round-trips it back onto the canvas).

The insight from `inline.md`: **a human typing SQL and a model streaming SQL are the same input stream
at different speeds.** One incremental `text → IR → canvas` pipeline serves both producers. So this
design is also half of streaming generation.

**In scope:** SQL → canvas live sync; AI writes into the same buffer; typed, real-time diagnostics.
**Out of scope (v1):** full bidirectional canvas → text editing with trivia preservation (see §3 P5);
SQL dialects other than PostgreSQL.

**Non-goals:** replacing the canvas (it stays the primary surface); preserving comments/formatting
through a canvas→text regenerate (semantics are preserved, trivia is not — an acknowledged limit).

---

## 2. Architecture

```
                        ┌─────────── producers ───────────┐
   human keystrokes ───►│  CodeMirror 6 buffer (SQL text) │◄─── AI streamed tokens
                        └───────────────┬─────────────────┘
                                        │ debounced / settled
                                        ▼
                  incremental, error-recovering PARSE  (Lezer SQL grammar)
                                        │  partial AST, statement-isolated
                                        ▼
                          AST → IR  (reuse Prompt 4 sql-schema-parser.ts)
                                        │  Omit<TableNode,"x"|"y">[] + enums + ddl patches
                                        ▼
                IDENTITY-AWARE DIFF/MERGE vs current canvasItems (§3 P1)
                  (reuse schema-diff.ts + mergeImportedTablesWithLayout)
                                        │  stable TableNode.id, preserved x/y
                                        ▼
                              setCanvasItems  ──►  canvas re-render
                                        │
                                        ▼
            analyzeSchema (Prompt 5) ──► typed diagnostics, "still-typing" gated (§3 P6)
```

Everything below the buffer already exists or is planned in the sprint. The **new** pieces are: an
error-recovering incremental parser, an identity-aware merge, and the editing-state discipline
(history batching, auto-save suppression, diagnostic gating). The canvas is already a pure renderer of
`TableNode[]`, so whatever writes the IR gets the canvas for free — AI generation already proves this
path.

**Reused building blocks:**
- `src/lib/schema-diff.ts` — structural IR diff (already the repo's one tested module).
- `mergeImportedTablesWithLayout` (`VibeDBPage.tsx`) — preserves x/y of existing tables, positions only
  new ones. The seam for "no layout thrash."
- `Column.fkStatus` + `resolveCanvasFKsBidirectional` — the pending→resolved FK lifecycle, already
  built because AI generation emits FKs before their targets. Typing `REFERENCES orders(id)` before
  `orders` exists is the same situation.
- Prompt 4 `sql-schema-parser.ts` (AST → IR) and Prompt 5 `analyzeSchema` (typed diagnostics).

---

## 3. The seven hard problems (from `inline.md`) and how we solve each

### P1 — Identity: SQL has no IDs, the canvas does *(the hardest)*

`TableNode.id` is the spine (FK links, positions, history). SQL text has no trace of it, so naïve
name-matching turns a rename into delete+create — losing position, FK links, and attached data rows.

**Approach — a stable matching pass, not name equality.** On each settled parse, match parsed tables
to existing `canvasItems` by a cascade:
1. **Structural similarity score** between each parsed table and each existing node: shared column
   names/types, shared FK targets, PK shape. A high score across a name change ⇒ it's a **rename**,
   reuse the existing `id` (and x/y, data rows). This is the load-bearing heuristic.
2. **Name match** when similarity is ambiguous.
3. **New table** only when nothing scores above a threshold.

Augment with **edit-distance debouncing**: the matcher runs on *settled* buffers (§P3), so a name typed
`c → cu → cus → customers` is matched once at rest, not demolished four times mid-keystroke.

Escape hatch for the genuinely ambiguous case: an optional, invisible `-- @id:<uuid>` trailing comment
the editor maintains per `CREATE TABLE` (round-trips identity losslessly when present; the heuristic is
the fallback when a human pastes SQL without it).

### P2 — Almost-every-state-is-invalid → need error recovery

A buffer mid-edit is syntactically broken most of the time. Both sprint parsers are **fail-fast**: one
syntax error in a 40-line `CREATE TABLE` yields no AST → the whole table flickers off the canvas.

**Approach — an incremental, error-recovering parser at the editor layer.** Use **Lezer** (CodeMirror's
own incremental parser; ships with `@codemirror/lang-sql`), which produces a *partial* tree with error
nodes instead of throwing. Parse **statement-by-statement** (`;`-delimited; `DO $$…$$` aware) so a
broken statement isolates to itself. Keep a **last-good IR per statement**: while statement N is
mid-edit/invalid, the canvas keeps showing its last valid version (marked "editing"), instead of
vanishing. The Prompt 4 `node-sql-parser` stays the authority for the *final* AST→IR conversion; Lezer
is the live, tolerant front line.

### P3 — Destructive intermediate states leak into persistence

Auto-save (every 3s) and `useHistory` (a deep clone per IR write) assume every IR state is deliberate.
Live sync produces hundreds that are not — a select-all-delete mid-paste momentarily *is* an empty
schema.

**Approach — an editing transaction.**
- **"Settled" detection:** only commit IR → canvas after the buffer is idle ~500ms (cadence already
  established in the sprint), and never commit a parse that *removes all tables* unless the buffer is
  genuinely empty (the empty-canvas-race lesson, generalized).
- **History batching:** one editing burst = **one** `useHistory` entry (open a transaction on first
  keystroke, commit on settle), so Ctrl+Z undoes "my paragraph of SQL," not "my last keystroke's
  parse." **Hard dependency on the Prompt 0 `useHistory` `idxRef` fix** landing first.
- **Auto-save suppression** while a burst is in flight; save on settle.

### P4 — Layout thrash

New tables need positions, and re-running force layout moves existing tables — the canvas reorganizes
under your eyes every few seconds.

**Approach — new-tables-only placement.** The diff/merge places only tables whose `id` is new and keeps
every matched table's x/y (exactly `mergeImportedTablesWithLayout`'s contract). **Hard dependency on
Auto-Layout Phase A+C** ("only place new tables; never move user-positioned ones; deterministic").
Without it, live typing + relayout is unusable.

### P5 — Bidirectionality is lossy

If the canvas also writes back to text (drag a column → regenerate SQL), comments/formatting/statement
order are destroyed, and two live writers on one buffer is a classic sync conflict.

**Approach — single-writer ownership in v1.** The **editor owns the buffer while focused**; canvas edits
are disabled (or queued) during active SQL editing, and a canvas→text regenerate happens only on an
explicit "Sync from canvas" action (with a dirty-buffer confirm) — never continuously. A
**non-dismissible banner** states the trivia limit ("comments/formatting are not preserved through
regenerate; schema semantics are"). True simultaneous two-way binding (CRDT/OT over the IR) is a v2
research item, explicitly deferred.

### P6 — Diagnostic noise at typing speed

`analyzeSchema` is built for settled schemas. Run live, a half-typed FK is an "error," a half-typed
CHECK references a nonexistent column — the panel screams every keystroke.

**Approach — a "still-typing" severity gate.** Diagnostics run on the settled buffer (§P3), and any
statement currently under the cursor / containing an error node is treated as **in-progress**: its
findings are suppressed (or shown muted, never red) until it settles. Real-time validity feedback —
the *point* of the feature ("types show valid print") — is preserved for *completed* statements while
the one you're typing stays quiet.

### P7 — Performance amplification in the monolith

`setCanvasItems` re-renders the canvas and history deep-clones the IR on every write — fine at
click-frequency, multiplied by keystroke-frequency it's not. The cost is downstream of the IR write,
not the parse (50 tables parse in ms).

**Approach:**
- **Incremental parse** only the changed statement(s) (Lezer is incremental by construction).
- **Structural sharing in the merge** — only changed `TableNode`s get new references, so React
  re-renders only affected nodes (memoized table components keyed by `id`).
- **Move parse + analyze off the main thread** (Web Worker) at scale; commit results via the settle
  cycle.
- Batch IR writes through the §P3 transaction so history clones once per burst, not per keystroke.

---

## 4. Phased build plan

| Phase | Ships | Depends on |
|---|---|---|
| **0 — Foundations** | Prompt 0 `useHistory` idxRef fix; Auto-Layout Phase A+C (new-tables-only, deterministic) | sprint Prompts 0 + Layout A/C |
| **1 — Editor surface** | CodeMirror 6 inline editor (Prompt 1), debounced parse, settle detection, single-writer ownership + banner | Prompt 1 |
| **2 — Lossless one-way** | Lezer error-recovering parse → Prompt 4 AST→IR → identity-aware diff/merge (§P1) → canvas. Last-good-per-statement. | Prompt 4 |
| **3 — Live diagnostics** | `analyzeSchema` (Prompt 5) wired with the still-typing gate (§P6) | Prompt 5 |
| **4 — Perf hardening** | incremental parse, worker offload, structural-sharing renders (§P7) | — |
| **5 (v2) — True two-way** | continuous canvas⇄text binding; trivia preservation | research |

**First shippable slice:** Phases 0–2 give "type SQL, watch the canvas build" — the headline feature —
without diagnostics or two-way binding.

---

## 5. Relationship to streaming generation and the `ddl_patch` stopgap

- **Streaming generation** (`AI_TIMEOUT_PROBLEM_BRIEF.md`): the model's token stream is just another
  producer feeding the *same* `text → parse → IR → canvas` pipeline. Build the incremental pipeline here
  and streaming generation becomes "point it at the model instead of the keyboard" — tables land
  table-by-table, the 150s timeout stops being a cliff, and Opus-class models become viable.
- **`ddl_patch` (today's stopgap, just hardened):** AI chat raw SQL currently becomes a `ddl_patch`
  auto-appended to the exported SQL with no canvas representation. The inline editor **supersedes** it:
  AI-written SQL parses straight onto the canvas. The `ddl_patch` path remains the correct home only for
  the genuinely non-representable (RLS, triggers, grants) that the IR can't model — the same things the
  Prompt 4 parser routes to `patches[]`.

---

## 6. Tech choices, risks, non-goals

**Tech:** CodeMirror 6 + `@codemirror/lang-sql` (Lezer) for the editor and live parse; `node-sql-parser`
(Prompt 4) for authoritative AST→IR; `schema-diff.ts` + `mergeImportedTablesWithLayout` for the merge;
`analyzeSchema` (Prompt 5) for diagnostics. No new state model — `TableNode[]` stays the single IR.

**Risks:**
- **P1 identity** is the make-or-break. If similarity matching misfires, renames still demolish. Mitigate
  with the `-- @id:` anchor + conservative thresholds (prefer "matched" over "new" when unsure, since a
  wrong-new is recoverable via undo but a wrong-delete loses data).
- **Dependency stacking:** this feature sits on Prompt 0 + Prompt 1 + Prompt 4 + Prompt 5 + Layout A/C.
  It cannot start before those land; attempting it early reproduces the empty-canvas class of bug.
- **Monolith pressure:** `VibeDBPage.tsx` is ~4,800 lines; the editor + pipeline should live in their
  own modules (`UnifiedSQLEditor.tsx`, `sql-live-sync.ts`) and not deepen the monolith.

**Non-goals (restated):** trivia preservation, non-Postgres dialects, and continuous two-way binding are
all v2+. v1 delivers one-way live SQL→canvas with gated diagnostics — which is already the feature users
(and the streaming roadmap) are asking for.
