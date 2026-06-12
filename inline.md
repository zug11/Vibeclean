# Problem Brief — Live Inline SQL Editing

**Status:** problem statement only. No solutions proposed — this documents what makes
live SQL-to-canvas editing hard, as input to a future design doc.
**Related:** `AI_TIMEOUT_PROBLEM_BRIEF.md` (the streaming sibling of this idea),
`CTO_SPRINT_GUIDE.md` (Prompts 1, 4, 5 build the machinery this depends on),
`TYPESCRIPT_FOUNDATIONS.md` §2 (the typed IR/AST/analyzer this would lean on).

---

## 1. The Idea Being Examined

An inline SQL editor where the canvas updates *as you type*: write
`CREATE TABLE users (...)` and the table appears; add a `REFERENCES` clause and the
FK line draws itself. Authoring and diagramming collapse into one act. A human typing
SQL and a model streaming SQL are the same input stream at different speeds — so
solving this solves half of streaming generation too.

The pipeline sounds simple: editor buffer → parse → IR → canvas. Every hard problem
below lives in one of those arrows.

---

## 2. What Makes It Plausible (the foundations already exist)

These aren't solutions — they're the reasons the idea isn't dead on arrival.

1. **SQL DDL is statement-delimited.** Statements end in `;` and `CREATE TABLE` is
   self-contained. A buffer mid-keystroke is invalid as a whole but mostly valid
   statement-by-statement — there is a natural "settled" unit to react to.
2. **The canvas is already a pure renderer of `TableNode[]`.** No second model to
   sync; whatever writes IR gets a canvas for free. AI generation proves the path.
3. **Dangling FKs are a modeled state.** `Column.fkStatus` and bidirectional FK
   resolution exist because generation already produces FKs before their targets.
   Typing `REFERENCES orders(id)` before `orders` exists is the same situation.
4. **Diff-merge machinery exists.** `schema-diff.ts` + the Apply-merge design
   (preserve x/y of unchanged tables) is what an incremental loop needs.
5. **Parse cost is small.** Even 50 tables of DDL parses in milliseconds; the
   editor's 500ms debounce cadence is already established in the sprint plan.

---

## 3. The Problems

### P1 — Identity: SQL has no IDs, the canvas does

`TableNode.id` is the spine of the system (FK links, positions, history) — and SQL
text contains no trace of it. Matching parsed tables to canvas nodes by *name* breaks
exactly when names are mid-edit:

- Rename `users` → `customers` in text, and a name-matcher sees **delete `users`,
  create `customers`**: position lost, FK links pointing at a dead id, attached data
  rows orphaned.
- Typed character-by-character, a table name passes through `c`, `cu`, `cus`... —
  each a "new table" to a naive matcher. Renames become demolitions.

This is the single hardest problem in the brief. Everything else is engineering;
this is a semantic gap between the two representations.

### P2 — Almost-every-state-is-invalid

A text buffer being edited is syntactically broken most of the time. The current
parsers make this worse:

- The legacy regex `parseSQLDDL` silently drops UNIQUE/CHECK/indexes — live-syncing
  it would paint *confidently wrong* canvases.
- The planned AST parser (`node-sql-parser`, Prompt 4) is **fail-fast**: one syntax
  error inside a 40-line `CREATE TABLE` yields no partial AST — that whole table
  vanishes from the canvas until the statement is valid again. Flicker that reads
  as data loss.

IDE-grade live editing uses incremental, *error-recovering* parsers (tree-sitter,
Lezer) for exactly this reason. We don't have one, and neither sprint parser is one.

### P3 — Destructive intermediate states leak into persistence

The pipeline assumes every IR state is deliberate. Live sync produces hundreds of
states that are not:

- **Auto-save (every 3s)** can persist a mid-gesture state — select-all-delete as
  step one of a paste-replace momentarily *is* an empty schema.
- **`useHistory` snapshots every IR write** with a full deep clone
  (`JSON.parse(JSON.stringify(...))`). A debounced live loop means a whole-schema
  clone per editing burst, and Ctrl+Z degrades to "undo my last keystroke's parse."
  There is no transaction/batching concept ("this burst = one history entry").
- This is the empty-canvas race lesson generalized: unguarded writers of
  `canvasItems` are how we got our worst bug.

### P4 — Layout thrash

New tables need positions, and the current pattern re-runs force layout after
additions — which **moves existing tables**. Live typing + auto relayout = a canvas
that reorganizes under your eyes every few seconds. The auto-layout epic's Phase C
contract ("only place new tables; never move user-positioned ones; deterministic")
is a hard prerequisite, not a nice-to-have.

### P5 — Bidirectionality is lossy

If the canvas also writes back to the text (drag a column → regenerate SQL), the
user's comments, formatting, and statement order are destroyed — the round-trip
preserves semantics, not text (the acknowledged trivia limitation). Two live writers
on one buffer is a classically hard sync problem; even deciding *who owns the buffer
when* is non-trivial.

### P6 — Diagnostic noise at typing speed

The analyzer (Prompt 5) is built for settled schemas. Run live, a half-typed FK is
an error, a half-typed CHECK references a nonexistent column, and the panel screams
through every keystroke. Real-time validity feedback is the *point* ("types show
valid print") — but without a notion of "still being typed," the signal drowns in
its own noise.

### P7 — Performance amplification in the monolith

`VibeDBPage.tsx` is ~4,800 lines; `setCanvasItems` re-renders the canvas, and
history clones the IR on every write. Each is fine at click-frequency. Live editing
multiplies all of them by keystroke-frequency — the cost isn't the parse, it's
everything downstream of the IR write.

---

## 4. The Dependency Picture

Live inline editing is *downstream* of most of the current sprint:

| Prerequisite | Why |
|---|---|
| Prompt 0 (useHistory fix) | Sane history before history-batching is even discussable |
| Prompt 1 (unified editor) | The surface itself + debounced parse cadence |
| Prompt 4 (AST parser) | Lossless parsing — though error-recovery remains unsolved |
| Prompt 5 (analyzer) | Typed diagnostics that could become keystroke feedback |
| Layout Phase A+C | New-tables-only placement; no thrash |

In one line: **the sprint builds the engine; live editing demands the engine be
incremental, identity-aware, and tolerant of broken input — three properties nothing
in the current plan provides yet.**

---

## 5. Summary

| Arrow | The problem hiding in it |
|---|---|
| buffer → parse | Invalid-most-of-the-time input; fail-fast parsers; no error recovery |
| parse → IR | No stable identity; renames look like delete+create |
| IR → canvas | Layout thrash; render and clone costs at keystroke frequency |
| IR → persistence | Auto-save and history capture unintentional intermediate states |
| canvas → buffer | Lossy round-trip; two-writer ownership conflict |
| IR → diagnostics | Analyzer noise without a "still typing" concept |

The idea survives scrutiny — the foundations (§2) are real. But it is not a feature
to bolt onto the editor; it is a contract change for every system that consumes the
IR, and the identity problem (P1) has no obvious answer yet. How we resolve these is
the next document.