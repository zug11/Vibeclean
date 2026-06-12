# Claude Code Prompts — VibeDB SQL System Overhaul (v2)

A pre-flight prompt (Prompt -1), one reliability hotfix (Prompt 0), and six sequenced prompts. Run them in order. Each is independently shippable and individually testable.

---

## Changes from v1 (read this first)

This revision keeps v1's architecture and sequencing intact. Every change below came from auditing the actual code in this repo, not from rethinking the design.

| Area | v1 | v2 | Why |
|---|---|---|---|
| **Verification gates** | Acceptance tests assert "`npm run build` — no TS errors" and "`npm test` passes" | New **Prompt -1** makes those gates real before anything else | `vite build` does **not** typecheck (SWC strips types), so it greenlights any TS regression. `npm test`/`npm run lint` are buried under the vendored `zod-main-2`/`kysely-master` source (1,679 tests, 275 failing; 2,600+ lint errors), none of it yours. The gates the whole sprint leans on are currently theater. |
| **Persisted IR** | Implicit — `StoredProject.definition: TableNode[]` with no version | Prompt -1 adds a **versioned envelope + pass-through migrator** | `DB_VERSION = 1` is IndexedDB's *object-store* version; it does **not** migrate record *shapes*. The load path reads stored JSON straight into state with zero validation. The first time the IR shape changes, every saved project (up to 50) breaks silently. Add the no-op seam now. |
| **Location references** | Exact line numbers (e.g. "line 1473", "lines 4256–4329") | **Symbol/string anchors to grep for** | These prompts edit the very 4,800-line file whose lines they cite; numbers drift *within the sprint* (Prompt 2 references lines Prompt 1 already moved). Line drift is the #1 failure mode for these runs. |
| **Prompt 0 race** | "Fix all three suspected causes" | Diagnose-first; **the project loader is the confirmed culprit** — fix that as Part A; useHistory is a separate correctness bug; the JSON clone is a non-issue | Static analysis is unambiguous (below). Fixing three things blindly hides which one mattered. |
| **Prompt 4 parser** | Worried about `~*` regex CHECKs; node-sql-parser assumed | **Empirically tested**: `~*` parses fine; the *only* failure is `DO $$` blocks, which wrap every CHECK (and deferred FK). The DO-unwrap step is load-bearing, not optional. | Measured 8/11 pass against the exact SQL `generateSQLInternal` emits. Feasibility is higher than feared *if* the unwrap ships first. |
| **Prompts 2 ↔ 3** | Strip compiler (P2), re-add as faithful no-op (P3) — edits the same 7 call sites twice | Kept separate to preserve numbering + companion-file refs, but P2 carries an **optional fusion note** | Same end state with half the call-site churn if you want it. |

Numbering is preserved (Prompt -1 is additive) so `COMPILER_REDESIGN.md`'s references to "Prompts 5 and 6" stay valid.

---

## How to use this document

**Locations are symbols, not line numbers.** Every "find X" below is a string or symbol to `grep`. Do **not** trust any line number; locate by symbol immediately before editing, because earlier prompts shift later lines. When a prompt says "the call site `runCompilerPass(canvasItems).tables` in `handleCompileSQL`," grep for `handleCompileSQL`, then for the call inside it.

**Before you start.** Save your real schema (the one with all the CHECKs, partial indexes, ON DELETE clauses) as `tests/fixtures/production-schema.sql`. Prompts 2, 4, 5, and 6 reference it.

**Companion file.** `COMPILER_REDESIGN.md` (same folder) holds the full audit and the Tier 3/4 diagnostic catalog. Keep it open; don't paste it into Claude Code.

**Run Prompt -1 first, then Prompt 0.** Prompt -1 is ~30–60 min and makes every later acceptance check trustworthy. Prompt 0 is the hard prerequisite for the surface work.

---

## Architectural principles

The v1 principles stand unchanged; they're summarized here, with one addition.

1. **Schema semantics live in the IR; SQL text is one serialization among several.** `TableNode[]` is the engine's source of truth; it already emits to seven targets via `ExportGenerators.ts`. Fidelity is owed to whichever target the user authors in. The parser and generator are the boundary; the round-trip is the per-target contract.
2. **Mutation and analysis are different operations — keep them separate forever.** The compiler mutates; the analyzer observes and reports. The corruption bug exists because the compiler runs in analysis/emission contexts. Never recombine them.
3. **Provenance over cleverness.** Every piece of schema content must answer "where did this come from?" — user-authored, AI-generated, or imported. Don't synthesize what you can't attribute.
4. **The diagnostic model is the right long-term shape.** Structured findings (`code`, `path`, `severity`, `risk`, `suggestedFix`) scale; ad-hoc warning strings don't.
5. **The round-trip test is a product invariant and asserts SQL fidelity, not IR fidelity.** Import → export must be semantically equivalent. Representable features survive in the IR; everything else survives verbatim as DDLPatches. A failing round-trip is a P0 on the level of data loss. *(v2 strengthens the test itself — see Prompt 6.)*
6. **DDLPatch is the right tool when SQL fidelity exceeds IR representability.** Policies, functions, triggers, extensions, PG-specific syntax — preserved verbatim with hash identity, not degraded to fit the IR.
7. **Acknowledged v1 limitations.** Comments and formatting are not preserved through the round-trip; the generator imposes consistent formatting. Set expectations via the editor banner; a trivia-preservation layer is v2-future.
8. **(New) The persisted IR is versioned; migration happens at the storage edge.** The in-memory IR stays a plain `TableNode[]`. The *persisted envelope* carries a `schemaVersion`, and a single `migrateStoredProject` runs at every load (and at the SQL-import → IR boundary). This is provenance/upgrade-safety for stored data, added as a no-op seam in Prompt -1 so the first real shape change is a `case` statement, not a field incident.

---

## Product principle — the flow matrix

Canonical reference for what runs where. Unchanged from v1.

| Flow | Compiler behavior |
|---|---|
| AI generation | `full` mode allowed |
| AI retry / AI auto-fix | `full` mode allowed |
| AI suggestion accept | `full` mode allowed |
| Imported SQL (file or paste) | no mutation; analyzer only |
| SQL editor Apply to Canvas | no mutation; analyzer gate blocks on errors |
| View SQL from manual canvas | faithful generation only |
| Export | faithful generation only + emission gate |
| Deploy | faithful generation + emission gate |
| Reset SQL editor to Canvas | faithful generation only |

---

## Prompt -1 — Pre-flight: make the gates real + version the store

Ship target: **before everything**. Small, mechanical, and a hard prerequisite for trustworthy verification in every later prompt. No product behavior changes.

```
Context: This repo's verification signals are currently meaningless, and the
persisted schema format has no version. Four fixes, all infrastructure.

PROBLEM 1 — `npm run build` does not typecheck.
The build script is `vite build`, which compiles via @vitejs/plugin-react-swc and
strips types without typechecking. Every later prompt's "npm run build — no TS
errors" gate therefore passes even with real type errors. Running `npx tsc -p
tsconfig.app.json --noEmit` today reports ~18 errors, most from one missing file.


PROBLEM 2 — two genuine type holes (independent of Problem 1).
- src/lib/supabase-integration.ts references `OpenAPIPathMethod` which is never
  declared.
- src/pages/VibeDBPage.tsx (grep: `enumSuggestions` / the suggestion-apply block)
  reads `.name`/`.values`/`.body`/`.sql` off a payload typed `unknown`.

PROBLEM 3 — persisted IR has no version / migration path.
project-storage.ts `StoredProject` is `{id,name,definition,...}` with no version.
`DB_VERSION = 1` is the IndexedDB object-store version; it does NOT migrate record
shapes. The load path (grep: `ProjectStorage.getProject(meta.id).then`) reads JSON
straight into state. First IR shape change = silent breakage of saved projects.

Read first (grep, don't trust line numbers):
- package.json (scripts), tsconfig.app.json, eslint.config.js, vite.config.ts
- src/integrations/supabase/client.ts (uses import.meta.env)
- src/lib/supabase-integration.ts (the OpenAPIPathMethod reference)
- src/lib/project-storage.ts (StoredProject, getProject, saveProject, DB_VERSION)

PART A — Type `import.meta.env`.
Create src/vite-env.d.ts containing exactly:
    /// <reference types="vite/client" />
That single line resolves the ~18 "Property 'env' does not exist on ImportMeta"
errors. (Optionally declare an ImportMetaEnv interface for the VITE_* vars you use,
for autocomplete — nice but not required.)

PART B — Add a real typecheck gate and scope the tools to src/.
1. package.json scripts: add
     "typecheck": "tsc -p tsconfig.app.json --noEmit"
   Use THIS as the type gate in all later prompts, NOT `npm run build`.
   (Leave build as-is; don't wire tsc into build unless you want slower builds.)
2. tsconfig.app.json: ensure "include": ["src"] and add
     "exclude": ["zod-main-2", "kysely-master", "node_modules", "dist"]
3. eslint.config.js: extend the ignores entry to
     { ignores: ["dist", "zod-main-2", "kysely-master"] }
4. Vitest: scope tests to src. If there's no vitest config, add one (vite.config.ts
   `test: { include: ["src/**/*.{test,spec}.{ts,tsx}"] }` or a vitest.config.ts).
   Goal: `npm test` runs ONLY src tests. Verify zod tests no longer execute.
DO NOT delete zod-main-2 / kysely-master — they're intentional AI reference. Only
exclude them from typecheck, lint, and test.

PART C — Fix the two real type holes.
1. supabase-integration.ts: define the missing `OpenAPIPathMethod` interface
   (it's the value type of `paths[route][method]` from a PostgREST OpenAPI spec —
   model it on the sibling OpenAPI* interfaces in the same file; a minimal
   `{ parameters?: unknown[]; responses?: Record<string, unknown> }` is acceptable
   if the full shape isn't used).
2. VibeDBPage suggestion-apply block (grep: `enumSuggestions`): give the AI
   suggestion payload a real type instead of `unknown`. Reuse/extend AuditReport's
   suggestion type in src/lib/types.ts (the `payload?: unknown` field) — define a
   discriminated union or a narrow interface with optional `name/values/body/
   sql/title/description` and narrow before access. No `as any`.

PART D — Version the persisted envelope (no-op seam).
1. project-storage.ts: add `schemaVersion: number` to StoredProject. Define
     export const CURRENT_SCHEMA_VERSION = 1;
2. Add a migrator:
     export function migrateStoredProject(raw: any): StoredProject {
       const v = raw?.schemaVersion ?? 0;
       let p = raw;
       // switch (v) { case 0: p = upgrade0to1(p); /* falls through */ }
       // v1 is a pass-through; future shape changes add cases here.
       return { ...p, schemaVersion: CURRENT_SCHEMA_VERSION };
     }
3. Run it at EVERY read boundary: wrap whatever getProject returns in
   migrateStoredProject(...) before handing it to callers. (This is the single
   place the load path trusts stored JSON today.)
4. saveProject writes `schemaVersion: CURRENT_SCHEMA_VERSION`.
5. Keep IndexedDB DB_VERSION as-is; it's unrelated (object-store, not record shape).

DO NOT:
- Change TableNode/Column shape (none of this touches the in-memory IR)
- Build a generalized migration framework, or per-table/per-field versioning (YAGNI)
- Delete vendored folders
- Wire tsc into `vite build`

Acceptance test:
1. `npm run typecheck` — 0 errors. (Was ~18.)
2. `npm test` — runs only src tests; zod/kysely suites do not execute; the
   schema-diff test passes.
3. `npm run lint` — no longer reports zod-main-2 / kysely-master files.
4. App still builds (`npm run build`) and runs (`npm run dev`); env vars resolve.
5. Load an existing saved project — opens normally (migrator is a pass-through);
   a freshly saved project has schemaVersion: 1 in IndexedDB.

Report: the final typecheck error count (before/after), confirmation that vitest is
scoped to src, the OpenAPIPathMethod shape you chose, and the suggestion-payload
type you introduced.
```

---

## Prompt 0 — Reliability hotfixes: the canvas race + useHistory + batch-edit

Ship target: **after Prompt -1, before the surface work**. Bundles reliability fixes for the existing AI flows. None of the later prompts work well until generation and batch-edit are reliable.

**Confirmed root cause of the empty-canvas bug (static analysis):** `canvasItems` is `useHistory` state (grep: `const [canvasItems, setCanvasItems` and `function useHistory`). The generation flow (grep: `handleGenerate`, then `setCanvasItems(prev => ` near `resolveCanvasFKsBidirectional(prev, compiled)`) writes via a **functional** updater — correct, survives the long await. The clobber comes from the **project loader** (grep: `ProjectStorage.getProject(meta.id).then`): it calls `setCanvasItems(full.definition)` as a **direct value, unguarded, from an async `.then`**. It is the only site that can land late and overwrite a populated canvas with the persisted (often empty/old) definition. So:

- **Part A (loader guard) is the actual fix for the reported symptom.**
- **Part B (useHistory ref)** is a real, separate correctness bug (stale-`idx` closure + `setIdx` inside the `setHistory` updater) that corrupts undo/redo and rapid edits — worth fixing, but it does **not** cause the empty-canvas symptom on its own.
- **Part C (JSON clone)** is effectively a non-issue: `TableNode[]` is fully JSON-serializable and the compiler attaches nothing non-serializable. Guard it cheaply; don't expect it to change behavior.

```
Read first (grep, not line numbers):
- src/pages/VibeDBPage.tsx: `function useHistory`
- src/pages/VibeDBPage.tsx: `ProjectStorage.getProject(meta.id).then` (mount loader)
- src/pages/VibeDBPage.tsx: `handleGenerate` (the generation flow + setCanvasItems)
- src/pages/VibeDBPage.tsx: the empty-state prompt screen (grep a stable string from
  it, e.g. the "Describe your database" copy) — this is what shows when canvasItems
  is empty
- src/lib/compiler-pass.ts (confirm it attaches no non-serializable content)
- supabase/functions/vibedb-ai/index.ts: `longOutputTypes`, `fastTypes`, `useFastModel`

PART A — Guard the project loader (THE fix). At the `ProjectStorage.getProject(
meta.id).then(full => {...})` site, never overwrite populated state with empty
content, and use functional setState so it reads current state at resolve time:

  ProjectStorage.getProject(meta.id).then(full => {
    if (!full) return;
    setCanvasItems(prev => prev.length > 0 ? prev : full.definition);
    if (full.supabaseBaseline) setSupabaseBaseline(full.supabaseBaseline);
    if (full.ddlPatches?.length) setDdlPatches(prev => prev.length > 0 ? prev : full.ddlPatches);
  });

PART B — Make useHistory's setState stable (correctness fix). Replace the
`[idx]`-dependent useCallback + the setIdx-inside-setHistory pattern with an idx ref:

  function useHistory<T>(initial: T): [T, (a: T | ((p: T) => T)) => void, () => void, () => void, boolean, boolean] {
    const [history, setHistory] = useState([initial]);
    const [idx, setIdx] = useState(0);
    const idxRef = useRef(idx);
    useEffect(() => { idxRef.current = idx; }, [idx]);
    const state = history[idx];
    const setState = useCallback((action: T | ((p: T) => T)) => {
      setHistory(prev => {
        const currentIdx = idxRef.current;
        const slice = prev.slice(0, currentIdx + 1);
        const current = slice[slice.length - 1];
        const next = typeof action === "function" ? (action as (p: T) => T)(current) : action;
        let cloned: T;
        try { cloned = JSON.parse(JSON.stringify(next)); }
        catch (err) { console.error("[useHistory] clone failed:", err); cloned = next; }
        const newH = [...slice, cloned];
        queueMicrotask(() => setIdx(newH.length - 1));
        return newH;
      });
    }, []); // stable forever
    const undo = useCallback(() => setIdx(p => Math.max(0, p - 1)), []);
    const redo = useCallback(() => setIdx(p => Math.min(history.length - 1, p + 1)), [history.length]);
    return [state, setState, undo, redo, idx > 0, idx < history.length - 1];
  }

Keep the existing signature; do not change canvasItems consumers.

PART C — Diagnostic logging. In handleGenerate around the compiler + setCanvasItems
calls, add bounded logs so this class of regression is debuggable from the console:
  console.log(`[generate] compiler in: ${positioned.length} tables`);
  ... after runCompilerPass: `[generate] compiler out: ${compiled.length} tables, ${cReport.actions.length} fixes`
  ... inside the setCanvasItems updater: `[generate] merge: prev=${prev.length} -> resolved=${resolved.length}`

PART D — Test the history invariants. Create src/lib/use-history.test.ts (it runs
under the src-scoped vitest from Prompt -1): stale-closure setState still produces
correct state; concurrent setState calls don't lose updates; clone failure doesn't
crash.

PART E — Batch-edit truncation. In supabase/functions/vibedb-ai/index.ts add
"batch-command" to `longOutputTypes` (so it gets 16384 tokens, not 8192). In
VibeDBPage's batch handler (grep: `handleBatchCommand`), read the `truncated` flag
from the response and surface a warning while still applying partial results.

PART F — Batch-edit model selector. Widen `useFastModel` in the edge function so
`strategy === "v3-fast"` also routes batch-command to Haiku. In VibeDBPage add
`batchStrategy` state (default `getDefaultStrategy()` from generation-strategies.ts),
a dropdown in the batch modal matching the existing strategy-picker pattern, and pass
batchStrategy through handleBatchCommand.

DO NOT:
- "Fix" the canvas race by touching handleGenerate's logic — it's already correct
  (functional update). The bug is the unguarded loader (Part A).
- Refactor the useHistory public signature or canvasItems consumers
- Remove the JSON clone (only guard it)
- Add a model selector anywhere except the batch modal

Acceptance test:
1. `npm run typecheck` clean. `npm test` (src-scoped) — use-history tests pass.
2. Empty-canvas repro: run 5 successive complex generations (10+ tables, >90s). Every
   one populates the canvas; the [generate] logs show non-zero counts at each stage.
   If even one fails, the loader guard (A) isn't right.
3. Load an existing saved project — still loads its tables (guard must not break the
   normal path).
4. Batch-edit: a long multi-table command applies, or shows the truncation warning
   with partial results — no silent "no changes."
5. Batch model selector routes to Haiku when "Fast" is chosen (edge-function logs
   show model=claude-haiku-4-5-20251001 for batch-command).

Report: confirm Part A alone fixes the empty-canvas symptom (state it explicitly);
the 5-run success rate; the console output of one successful generation; whether
batch complex commands now work; Haiku routing confirmation.
```

## Prompt 1 — Minimal unified inline SQL editor + DDL modal subsumption

Ship target: **first surface prompt**. Establishes the primary SQL authoring surface every later prompt builds on, using existing (still-buggy) infrastructure, with an honest v1 banner. Unchanged in intent from v1; locations are now symbol anchors.

```
Context: VibeDB has no primary surface for hand-written SQL. The Import button is
one-shot and lossy. The DDL Patches Modal (grep: `showDdlPatchesModal` and the
"DDL Patch Ledger Modal" comment) is operationally dead — expert-mode gated,
populated only when AI classifies output as a ddl_patch, edited via a bare textarea,
no "New Patch" button. This prompt builds a unified inline SQL editor as the primary
surface, deletes the dead modal, and folds patches into the editor as a second
section. It ships on top of the existing parser/compiler; later prompts fix the
engine without changing the editor's shape.

Read first (grep, not line numbers):
- src/components/vibedb/SQLViewerModal.tsx (current read-only viewer, whole file)
- src/pages/VibeDBPage.tsx: `showDdlPatchesModal` (all refs — modal + toolbar + state)
- src/pages/VibeDBPage.tsx: `addDdlPatch`, `updateDdlPatch`, `removeDdlPatch`,
  `markDdlPatchesApplied` (KEEP these)
- src/pages/VibeDBPage.tsx: `handleApplySuggestion` (AI fallback site)
- src/pages/VibeDBPage.tsx: `parseSQLDDL` (existing regex parser — keep using for v1)
- src/lib/schema-diff.ts (diff utility for Apply merge)
- src/components/vibedb/ExportGenerators.ts: `generateSQL` (for display)

PART A — Install editor:
  npm install @codemirror/state @codemirror/view @codemirror/lang-sql \
    @codemirror/theme-one-dark @codemirror/commands @codemirror/language

PART B — Build src/components/vibedb/UnifiedSQLEditor.tsx (replaces SQLViewerModal as
the main SQL surface). Two sections (split or tabbed — your call; document it in a
comment).

  NON-DISMISSIBLE v1 BANNER:
  "Inline editing in beta. SQL shown may include auto-generated constraints from the
  compiler — review before applying. Comments and formatting are not preserved
  through Apply (schema semantics are). Engine improvements arriving soon."
  (Caveat 1 — compiler-injected content — is removed in Prompts 2–3/6. Caveat 2 —
  trivia loss — is the acknowledged v1 limitation, removed only when a future trivia
  layer ships.)

  SECTION 1 — Canvas SQL (IR-backed):
  - CodeMirror 6 + @codemirror/lang-sql.
  - On open: populate via generateSQL(canvasItems) (accept compiler-injected content
    for v1; banner covers it).
  - Debounced parse on change (500ms) via existing parseSQLDDL.
  - Count panel, two blocks: "Represented on canvas" (N tables, M columns, K
    constraints, J FKs, L indexes) and "Preserved as DDL patches" (X unsupported
    statements). Prevents the illusion that unsupported SQL was dropped.
  - Buttons (Force Apply lands in Prompt 5):
    * "Apply to Canvas": parse → schema-diff vs canvasItems → preview modal
      ("+X tables, ~Y modified, -Z removed; N patches preserved, D dups skipped") →
      on confirm, preserve x/y for unchanged tables (do NOT re-run force layout on
      them), setCanvasItems(merged), append parsed patches deduped by content hash
      (Part C). No analyzer gate yet; parse errors disable the button with a tooltip.
    * "Reset to Canvas": regenerate via generateSQL(canvasItems); confirm if dirty.
      (Compiler still runs here; Prompt 3 wraps it in faithful mode.)

  SECTION 2 — Patches (text-by-design escape hatch):
  - List ddlPatches as cards (title input, source/status badges, warnings, actions),
    each SQL in its own small CodeMirror (saves on blur via updateDdlPatch).
  - "+ New Patch" button: creates an empty manual patch, opens its editor focused.
  - Per-patch: Mark Applied (markDdlPatchesApplied), Delete (removeDdlPatch), and
    "Try parse into canvas" (run patch SQL through parseSQLDDL; promote representable
    tables via diff preview, leave the rest in the patch; on total failure, toast
    "Couldn't parse — kept as patch").

PART C — Content-hash patch identity. Create src/lib/patch-identity.ts with
`patchIdFromSql(sql)` (normalize whitespace/case; simple stable hash for v1 — Prompt
4 upgrades to sha256). On Apply, skip appending a patch whose id already exists.

PART D — Delete the dead DDL Patches Modal: remove the modal JSX, the expert-mode
toolbar button, the `showDdlPatchesModal` state, and every `setShowDdlPatchesModal`
reference. After: `grep -n "showDdlPatchesModal" src/` returns nothing. KEEP
addDdlPatch/updateDdlPatch/removeDdlPatch/markDdlPatchesApplied, buildDdlPatchSql/
appendDdlPatchSql, the DDLPatch type, and project.ddlPatches storage.

PART E — Route AI Chat raw SQL into patches. In handleApplySuggestion, before the
final else, add a fallback: if `typeof payload.sql === "string" && payload.sql.trim()`,
addDdlPatch({ title: suggestion.description || suggestion.reason || "AI-generated
SQL", description: suggestion.reason, sql: payload.sql, source: "ai-chat" }) and
toast. This is the only AI-flow change in this prompt.

PART F — Toolbar: replace "View SQL" with a single always-visible "SQL" button that
opens the unified editor (no expert-mode gating).

PART G — Read-only guard. RLS SQL and TypeScript-types views must stay read-only.
Add an `isReadOnly` prop (or a ReadOnlyUnifiedSQLEditor) that disables editing, hides
Apply/Reset and Section 2, and shows a "Read-only" badge. Audit SQLViewerModal usage
and route each SQL type correctly. RLS SQL must NEVER be editable.

DO NOT: add validation gates (Prompt 5); run runCompilerPass at any new site (Prompt
2 changes existing ones); modify parseSQLDDL (Prompt 4); touch ExportGenerators.ts
(Prompt 2); delete the canvas UI or the import button; remove the v1 banner.

Acceptance test:
1. `npm run typecheck` clean.
2. Toolbar shows "SQL" always. Editor opens with banner; SQL renders from canvas;
   Section 2 visible.
3. Section 1: edit a column → count updates ≤500ms; Apply shows diff, confirm,
   canvas updates, other tables' x/y unchanged; add/remove a CREATE TABLE works;
   paste CREATE POLICY → routed to patches; Reset restores from canvas.
4. Section 2: +New Patch focuses an empty card; SQL saves on blur; Mark Applied
   flips badge + locks editor; Delete removes; Try-parse promotes representable parts.
5. `grep -n "showDdlPatchesModal" src/` → nothing.
6. AI chat producing raw SQL (e.g. "add a partial unique index on users.email where
   deleted_at is null") shows up as an ai-chat patch.
7. RLS view is read-only (badge, no Apply, Section 2 hidden).

Report: layout choice + rationale; whether layout preservation works on a >10-table
canvas; edge cases; confirm no compiler-bug fixing was attempted (that's Prompt 2).
```

---

## Prompt 2 — Corruption hotfix + cycle-safe View SQL + CHECK dedup

Ship target: **immediately after Prompt 1**. P0 bug fix. After this, the editor stops showing compiler-fabricated content and View SQL stops throwing on FK cycles.

**Confirmed (audit):** `runCompilerPass` runs at 13 sites. The **7 user-driven sites** below all run the full mutating compiler today — synthesizing CHECKs, FK indexes, and id/created_at/updated_at — which is exactly the "lying about user SQL" corruption. The 6 AI/auto-fix sites must keep running it.

```
USER-DRIVEN SITES — these are the corruption (grep each symbol, then the call inside):
- src/pages/VibeDBPage.tsx: `handleCompileSQL`        → runCompilerPass(canvasItems).tables  (View SQL)
- src/pages/VibeDBPage.tsx: `handleGenerateRLS`       → runCompilerPass(canvasItems).tables  (RLS)
- src/pages/VibeDBPage.tsx: `handleExport`            → runCompilerPass(canvasItems).tables  (export)
- src/pages/VibeDBPage.tsx: the deploy handler        → `const { tables: compiledItems, report: deployCompileReport } = runCompilerPass(canvasItems)`
- src/pages/VibeDBPage.tsx: the pre-audit path        → `const { tables: compiledForAudit } = runCompilerPass(canvasItems)`
- src/components/vibedb/SupabasePanel.tsx: the two `runCompilerPass(canvasItems)` calls (RLS panel + TS types)

AI-GENERATION / AUTO-FIX SITES — DO NOT TOUCH (compiler MUST keep running):
- `handleGenerate`            → runCompilerPass(positioned)
- `handleGenerateSidebarTables` → runCompilerPass(withPos)
- `handleFixSqlIssues`        → runCompilerPass(result.fixedItems)   (explicit auto-fix)
- the deploy auto-fix retry   → runCompilerPass(currentItems)
- handleApplySuggestion / accept-AI-tables → runCompilerPass(resolved)  (two calls)

>>> OPTIONAL SEQUENCING NOTE <<<
v1 removes the compiler at the 7 user sites here (Prompt 2) and re-adds it as a
faithful no-op in Prompt 3 — editing those 7 sites twice. If you'd rather edit them
once: do Prompt 3's `mode` parameter FIRST, then in this prompt change each user site
to `runCompilerPass(canvasItems, { mode: "faithful" })` instead of removing the call.
Same end state, half the churn. The steps below assume the v1 order (remove now);
if you fuse, substitute "pass { mode: 'faithful' }" for "remove the call."

Read first:
- src/pages/VibeDBPage.tsx (skim the handlers above for context)
- src/components/vibedb/ExportGenerators.ts: `topologicalSort`, `deduplicateSchema`,
  `generateSQLInternal` (the CHECK emission `DO $$ BEGIN IF NOT EXISTS ...`)
- src/lib/compiler-pass.ts: `injectCheckConstraints`, `runDeduplicationPass`
- src/components/vibedb/UnifiedSQLEditor.tsx (verify CHECKs stop appearing after)

PART A — Remove runCompilerPass at the 7 user-driven sites; pass canvasItems directly
to generateSQL/generateRLS/etc. Drop now-unused vars (cReport, deployCompileReport,
compiledForAudit) and imports.

PART B — Cycle-safe View SQL. In topologicalSort, replace the
`throw "Circular dependency detected..."` with a console.warn + early return
(best-effort sort). At the View SQL path (handleCompileSQL), use generateSQLDeferred
(FKs via ALTER at the end) so output is valid even with cycles; document the choice
in a comment.

PART C — CHECK dedup at the IR layer (two sub-fixes).
C.1 (prevent new pollution): in compiler-pass.ts `injectCheckConstraints`, before
appending a generated CHECK, skip if a constraint with that name already exists
(case-insensitive). Same-name/different-expression conflicts are NOT merged — Prompt
5's W10 surfaces them.
C.2 (clean existing pollution): extend ExportGenerators.ts `deduplicateSchema` to
dedupe checkConstraints by (name, normalized-expression), returning a new
`duplicateChecksRemoved` count; surface it in runDeduplicationPass's actions and in
the manual Dedup toast.

  >>> v2 note — frame C.1+C.2 as one invariant. The durable version of both is a
  single rule the generator can rely on: "checkConstraints is a set keyed by
  normalized name; index/FK names are unique per table." Implement C.1/C.2 as written,
  but keep that invariant in mind — Prompt 4's parser and Prompt 5's analyzer should
  uphold it rather than re-introduce array duplicates. (Do NOT switch checkConstraints
  to a Record/map type — that's a persisted-shape change with a migration cost the
  array-dedup avoids.)

DO NOT: modify the individual compiler passes' logic beyond the C.1 skip; merge
conflicting CHECK expressions automatically (v2 = analyzer surfaces them); touch AI
sites.

Acceptance test:
1. `npm run typecheck` clean.
2. Import tests/fixtures/production-schema.sql; open the editor. Canvas SQL MUST NOT
   contain compiler-synthesized CHECKs (e.g. a chk_*_role_enum with 'admin','user',
   'moderator','viewer') that weren't in the input.
3. UI-create table "users" with "role VARCHAR"; editor output has NO synthesized CHECK
   on role.
4. Hidden-compiler test: import the fixture, immediately export; diff — no new table/
   column/index/CHECK/DEFAULT/ON DELETE appears (it may LOSE shallow-parser drops —
   Prompt 4 — but must ADD nothing).
5. Cycle test: create a FK cycle (team.owner_id→users.id, users.primary_team_id→
   team.id); editor opens and shows SQL; no "Circular dependency" throw.
6. CHECK dedup: a schema with 6 identical chk_* → exactly one in output; report says
   "Removed N duplicate CHECK constraints"; same-name/different-expr NOT merged;
   different-name/same-expr NOT removed here (Prompt 5 V10).

Report: files modified, vars/imports removed, cycle approach taken, before/after
duplicate-CHECK counts, confirmation C.1 skips colliding names without blocking
legitimate non-colliding rules.
```

---

## Prompt 3 — Faithful vs Full compiler modes

Ship target: **after Prompt 2** (or fused into it per the note above). Adds a `mode` parameter so AI paths keep full treatment while user-driven paths run a **faithful** mode that performs zero schema-semantic mutation. Polish behaviors return later as opt-in analyzer diagnostics, never as silent mutation.

```
Context: Prompt 2 removed the compiler from user paths. This prompt makes that
principled: faithful mode (no mutation) for user/import/export/deploy paths; full
mode (existing behavior) for AI paths only. "Faithful," not "safe": snake_case
renames, dedup heuristics, NOT NULL stripping, and gen_random_uuid() defaults all
change SQL semantics — see COMPILER_REDESIGN.md.

Read first: src/lib/compiler-pass.ts (whole file — adding a mode gate, not editing
passes); COMPILER_REDESIGN.md; src/components/vibedb/UnifiedSQLEditor.tsx (Reset).

Steps:
1. Change signature:
     runCompilerPass(tables, options?: { mode?: "faithful" | "full" })
   Default "full" (no AI call site changes).
2. Gate: if mode === "faithful", return immediately with tables unchanged and an
   empty report (counts 0). Full mode runs every pass exactly as today.
3. Re-add (or, if fused, leave) explicit calls at the 7 user-driven sites from Prompt
   2 with { mode: "faithful" } — functional no-ops in v1, but they create the seam
   Prompts 5–6 attach the analyzer to.
4. UnifiedSQLEditor Reset-to-Canvas: runCompilerPass(canvasItems, { mode: "faithful" })
   then generateSQL.
5. Leave AI sites calling runCompilerPass(items) (defaults to full). Add a comment at
   the apply-suggestion / accept-AI-tables sites noting the mixed-provenance edge case
   (accepting one AI suggestion runs full-mode on the whole canvas, incl. imported
   tables; v1 accepts this; per-table provenance is the real fix later).
6. Document the faithful/full contract in a comment atop runCompilerPass.

DO NOT: reintroduce any pass under faithful; add a third "safe" mode; edit passes
1–7; change AI call sites.

Acceptance test:
1. `npm run typecheck` clean.
2. Import the fixture; editor output is byte-identical modulo whitespace + shallow-
   parser drops. No new content.
3. UI-create "MyTable" with "role"; output keeps `MyTable` (not my_table) and `role`
   with NO injected CHECK.
4. AI generation still gets full treatment (names normalized, CHECKs/FK indexes/
   standard columns present).
5. Reset to Canvas matches step 2/3 output.

Report: confirm faithful is a no-op in v1; all 7 user sites pass { mode: "faithful" };
Reset uses faithful; no AI site touched.
```

## Prompt 4 — Replace `parseSQLDDL` with an AST parser

Ship target: **after Prompts 1–3**. The editor displays clean SQL and accepts edits, but import/Apply still drop UNIQUE, CHECK, indexes, and ON DELETE because the regex parser doesn't extract them. After this, Apply-to-Canvas is lossless on representable features.

**Measured feasibility (do not skip this).** node-sql-parser (PostgreSQL dialect) was tested against the exact strings `generateSQLInternal` emits — **8/11 pass**. The only failures are `DO $$ … $$` blocks. Crucially, your generator wraps **every CHECK constraint** (and every deferred FK) in `DO $$ BEGIN IF NOT EXISTS (...) THEN ALTER TABLE ... END $$;`. So feeding generator output straight to node-sql-parser loses **100% of CHECKs** — it looks like the parser "drops everything." But the **inner `ALTER TABLE … ADD CONSTRAINT`** statements parse perfectly on their own, including the `~*` regex operator and `IN (...)` lists (the `~*` worry from v1 is a non-issue). Therefore the DO-unwrap step below is **load-bearing, not optional** — if the agent skips it, CHECKs vanish silently.

Verified results for reference:

```
PASS  CREATE TYPE ... AS ENUM
PASS  CREATE TABLE (inline FK + ON DELETE + DEFAULT gen_random_uuid())
FAIL  DO $$ ... $$  (deferred FK block)        <- unwrap the inner ALTER
FAIL  DO $$ ... $$  (CHECK block, simple)      <- unwrap the inner ALTER
FAIL  DO $$ ... $$  (CHECK block, ~* regex)    <- unwrap the inner ALTER
PASS  ALTER TABLE ... ADD CONSTRAINT ... CHECK (total >= 0)
PASS  ALTER TABLE ... ADD CONSTRAINT ... CHECK (email ~* '^...$')
PASS  ALTER TABLE ... ADD CONSTRAINT ... CHECK (role IN ('a','b'))
PASS  CREATE UNIQUE INDEX ... WHERE deleted_at IS NULL   (partial index)
PASS  CREATE INDEX ... (user_id, created_at)
PASS  CREATE OR REPLACE FUNCTION ... $$ ... $$ LANGUAGE plpgsql
```

```
The TableNode/Column types already have every slot the parser needs — no JSON
migration. Verify in src/lib/types.ts: Column.onDelete; Column.constraints (use
{ type: "unique" } for UNIQUE); TableNode.checkConstraints ({ name, expression });
TableNode.indexes ({ name, columns, type, unique, where? }); SchemaEnum; DDLPatch.

Read first: src/pages/VibeDBPage.tsx `parseSQLDDL` (the regex parser to replace at
the call site); UnifiedSQLEditor.tsx (uses parseSQLDDL on Apply + parse-on-change);
src/lib/patch-identity.ts (upgrade the hash to sha256 here).

Steps:
1. npm install node-sql-parser
   (If, after step 5, the unwrapped inner ALTERs come back with an AST too shallow to
   extract expression text reliably, evaluate `pgsql-ast-parser` or `libpg-query`
   instead — both parse DO blocks natively and would drop the regex pre-pass. Decide
   based on the spike, don't pre-commit.)
2. Create src/lib/sql-schema-parser.ts exporting:
     parseSQLDDL(sql): { tables: Omit<TableNode,"x"|"y">[]; enums: SchemaEnum[];
       patches: DDLPatch[]; diagnostics: { line?; code; message; severity }[] }
3. PostgreSQL dialect. Route statements: CREATE TABLE → tables[]; CREATE [UNIQUE]
   INDEX → table.indexes[] (preserve unique, multi-column, partial WHERE); ALTER
   TABLE ADD CONSTRAINT CHECK → table.checkConstraints[]; CREATE TYPE AS ENUM →
   enums[]; CREATE FUNCTION/TRIGGER/POLICY, raw DO blocks, extensions →
   patches[] (verbatim, source "manual", status "pending").
4. Patch identity via sha256 of normalized SQL (upgrade patch-identity.ts;
   crypto.subtle.digest → keep async signature). Dedup patches by id.
5. **DO-unwrap (the load-bearing step).** For each `DO $$ ... $$;` block, regex out
   the inner `ALTER TABLE ... ADD CONSTRAINT ... (CHECK|FOREIGN KEY) ...` statement(s)
   and parse those individually. Attach CHECKs to checkConstraints[], FKs to the
   column's onDelete/linkedTable. If an inner statement still won't parse, preserve
   the WHOLE DO block as a patch with a diagnostic. (Confirmed: the inner ALTERs
   parse, ~* included.)
6. Per-column extraction in CREATE TABLE: name, type, PRIMARY KEY, NOT NULL, inline
   UNIQUE → constraints [{type:"unique"}], DEFAULT, REFERENCES ... ON DELETE →
   column.onDelete.
7. Wrap each statement parse in try/catch; route failures to patches[] with a
   diagnostic. EVERY catch logs: severity (warning if preserved, error if not),
   first 200 chars of the SQL, the parser error, and line if available. No silent
   catches.
8. Swap the import flow (grep: `handleImport`, which calls parseSQLDDL on both
   importText and the normalized aiSQL) and UnifiedSQLEditor to the new parser; wire
   enums into project state, patches into project.ddlPatches.
9. Leave the old parseSQLDDL in VibeDBPage in place but unused; Prompt 6 deletes it
   after round-trip parity is proven.

DO NOT: add provenance flags to constraints; run the compiler anywhere new; change
TableNode/Column shape; modify ExportGenerators.ts.

Acceptance test — create src/lib/sql-schema-parser.test.ts against the fixture:
- all tables parsed; users.email has {type:"unique"}; a CASCADE FK preserves
  onDelete; partial unique indexes preserve `where`; a column today's parser drops is
  now present; ~all CHECKs captured (proves DO-unwrap works); indexes incl. unique +
  partial captured.
- No representable feature lost (every UNIQUE/CHECK/INDEX/ON DELETE/ENUM lands in
  tables or enums); patches.length may be >0 for out-of-model statements.
- Re-parsing the same SQL yields identical patch ids (hash stability).
Manual: import the fixture → editor round-trips it (modulo whitespace/comments);
add a CREATE UNIQUE INDEX in the editor, Apply → canvas receives the real index.

Report: parse coverage (what went to tables vs patches), the DO-unwrap behavior on
your fixture's CHECK blocks, hash-id stability, and any parser limitations worked
around (and whether you switched parsers).
```

---

## Prompt 5 — `analyzeSchema` architecture + Tier 1 validators + editor Apply gate + Force Apply

Ship target: **after Prompt 4**. The architectural unlock — a Zod/ESLint-style diagnostics engine (structured findings, optional one-click fixes, no mutation by default), wired into the editor's Apply as a hard gate with Force Apply as the explicit bypass.

```
Read first: src/lib/compiler-pass.ts (model around it, don't modify); src/lib/types.ts;
src/components/vibedb/UnifiedSQLEditor.tsx; COMPILER_REDESIGN.md.

PART A — src/lib/schema-analyzer.ts:
  SchemaDiagnostic { code; severity: "error"|"warning"|"info"; path: (string|number)[];
    message; origin?; documentationUrl?; suggestedFix?: { description; risk:
    "safe"|"breaking"|"destructive"; apply: (tables) => tables } }
  AnalysisOptions { autofix?: "safe"|"all"|"none"; overrideAutofix?; enabledRules?;
    disabledRules? }
  AnalysisResult { tables; diagnostics; hasErrors }
  AnalysisContext { tables; reportedCodes: Set; suppressDownstreamFor: Set }
  analyzeSchema(tables, options?): AnalysisResult
Rules live in src/lib/schema-analyzer/rules/ (one file each) with a central registry
(allRules). Each rule: { code; severity; description; documentationUrl?; check(tables,
ctx): SchemaDiagnostic[]; safeAutofix? }.

PART B — Tier 1 validators (9 high-impact, all from the canonicalization audit):
  V1 fk-target-not-unique (ERROR) — FK target must be PK/UNIQUE/unique-index; single-
     column only in v1; on fire, add "missing-pk:{target}" to suppressDownstreamFor.
  V2 fk-type-mismatch (ERROR) — compare normalized types (src/lib/schema-analyzer/
     pg-types.ts: int=integer=int4, bigint=int8, varchar=character varying,
     timestamptz=..., numeric=decimal, etc.; do NOT normalize across widths). Suppress
     if target's missing-pk already fired.
  V3 missing-primary-key (ERROR) — suggestedFix add id uuid PK (risk breaking);
     add "missing-pk:{table}" to suppressDownstreamFor.
  V4 reserved-word-identifier (ERROR true reserved / WARNING keyword) — minimal PG list.
  V5 btree-on-json (ERROR) — btree index over json/jsonb (null type = btree).
  V6 not-null-with-set-null-fk (ERROR) — NOT NULL column whose FK is ON DELETE SET NULL.
  V7 check-references-nonexistent-column (ERROR) — extract cols from CHECK expr; verify.
  V8 duplicate-constraint-name (ERROR) — constraint names must be globally unique.
  V9 index-references-nonexistent-column (ERROR) — catches AI `_desc` suffix
     hallucinations (e.g. stars_count_desc); suggestedFix remove (destructive).
  V10 redundant-equivalent-checks (WARNING) — same column, equivalent normalized
     expressions, different names; recommend which to keep. Complements Prompt 2's
     identical-CHECK dedup (this catches semantic equivalents).

PART C — Orchestration: init ctx; run rules deterministically (Tier 1 errors first,
then warnings); honor enabled/disabled; collect diagnostics + hasErrors; apply fixes
only when autofix === "safe"/"all".

PART D — Editor Apply gate. In UnifiedSQLEditor handleApply: parse → analyzeSchema;
if hasErrors && !forceApply, show diagnostics, reveal "Force Apply", return. Force
Apply → strong confirm modal → proceed, toast logs "Applied with N errors (Force
Apply)". Apply re-enables when errors are fixed.

PART E — Tests: per-rule unit tests (small 2–3 table fixtures, pass + fail); snapshot
test using tests/fixtures/production-schema.expected.json (start { tablesCount, errors:
0, warningsByCode:{}, infoByCode:{} }) parsed via the Prompt 4 parser.

DO NOT: touch compiler-pass.ts (both coexist); wire analyze into export/deploy yet
(Prompt 6); build the panel yet (Prompt 6); implement Tier 2+; remove the banner.

Acceptance test: `npm test` rule tests pass; analyzeSchema(productionSchema) → 0
errors; a deliberately broken schema returns exactly the expected codes/paths;
cascade suppression yields ONE missing-pk (not N cascading fk errors); V9 flags a
`_desc` index; V10 groups equivalent CHECKs; editor Apply gate blocks on errors and
Force Apply works with confirmation.

Report: rule files, coverage, any deviation from spec, end-to-end gate confirmation.
```

---

## Prompt 6 — Diagnostics panel + Tier 2 warnings + emission gate + cleanup + banner removal

Ship target: **last**. Wires the analyzer into a visible sidebar, adds 10 Tier 2 warnings, blocks export/deploy on errors, hardens import to file-only, locks in a round-trip CI gate, deletes the legacy parser, and removes the v1 banner.

```
Read first: src/lib/schema-analyzer.ts; COMPILER_REDESIGN.md (Tier 2 catalog); the
import handler in VibeDBPage (grep: `handleImport`); UnifiedSQLEditor.tsx (banner).

PART A — Tier 2 rules (same registry pattern), each with tests:
  W1 timestamp-vs-timestamptz (WARNING; ERROR for created_at/updated_at)
  W2 json-vs-jsonb (WARNING; fix → jsonb)
  W3 serial-vs-identity (WARNING; fix → bigint GENERATED BY DEFAULT AS IDENTITY)
  W4 money-type (ERROR; fix → numeric(15,2) + currency_code)
  W5 nullable-boolean (WARNING; fix → NOT NULL DEFAULT false)
  W6 fk-without-index (WARNING; fix → btree index; risk safe)
  W7 soft-delete-unique-without-partial (WARNING; fix → WHERE deleted_at IS NULL)
  W8 tenant-id-not-leading (WARNING; fix → reorder index cols)
  W9 duplicate-uniqueness (WARNING; inline UNIQUE + redundant unique index)
  W10 conflicting-enum-checks (WARNING; same column, different IN(...) sets; manual
      reconcile; risk destructive)
Update production-schema.expected.json with the actual Tier 2 counts (the test
ratchets — adding a rule means deliberately updating expected.json).

PART B — src/components/vibedb/DiagnosticsPanel.tsx: analyzeSchema(canvasItems)
debounced 500ms; group by severity then code; click a diagnostic's path → focus +
highlight the table/column ~2s; risk-aware fix buttons ("Apply fix" safe / "Apply
fix…" breaking confirm / "Apply destructive fix…" strong confirm); filter chips
(All/Errors/Warnings/Info); per-rule disable persisted to
`vibedb.disabledRules.${projectId}.v1` (try/catch JSON.parse, default []); empty
state "No issues detected." Wire into the sidebar.

PART C — Emission gate: export path runs analyzeSchema first; if hasErrors, block with
a modal listing errors + an "Export anyway" confirm. Deploy path: same gate, NO
bypass (deploy with known errors is too dangerous). The editor Apply gate (Prompt 5)
already uses the analyzer.

PART D — Import hardening: label "Import .sql File"; remove the textarea-paste path;
file picker (.sql/.ddl/.txt); parse via sql-schema-parser; run analyzeSchema; diff
dialog shows counts + findings ("[Cancel] [Review issues] [Import anyway]"); on
confirm, same merge as editor Apply. Inline hint pointing clipboard users to the
editor.

PART E — CI lock-in: src/lib/sql-schema-parser.roundtrip.test.ts — parse fixture →
runCompilerPass(..., { mode: "faithful" }) → generateSQL → re-parse → assert the two
IRs are deep-equal (modulo x/y), plus a few not.toContain fabrication guards
(e.g. NOT the synthesized role-enum values). (v2: assert IR-equivalence, not brittle
SQL substrings.) Add script "test:schema" and a .github/workflows/test.yml running
`npm ci`, `npm run typecheck`, `npm run build`, `npm run test:schema`.

PART F — Delete the legacy parseSQLDDL in VibeDBPage and remaining textarea-paste
import code, now that round-trip parity is proven.

PART G — Remove the v1 banner from UnifiedSQLEditor. Faithful mode + AST parser +
analyzer gate + emission gate make the editor trustworthy.

DO NOT: re-enable textarea paste; skip the file-import confirm; autofix anything
automatically (fixes are per-finding, user-driven); delete runCompilerPass (AI paths
use it); allow deploy with errors; leave the banner.

Acceptance test: `npm run test:schema` passes (round-trip IR-equivalence + analyzer
snapshot); panel renders/groups/fix-buttons/risk tiers; disable-rule persists across
reload; click-path highlights; export blocked-with-bypass; deploy blocked-no-bypass;
file import shows accurate diff + findings; legacy parseSQLDDL gone; `npm run build`
clean; banner gone.

Report: which Tier 2 rules fired on the fixture (and the resulting expected.json), a
description of the panel, and any UX iterations.
```

---

## Pitfalls between prompts

**After Prompt -1:** `npm run typecheck` must be 0 and `npm test` must run only src
tests. If zod tests still execute, the vitest scoping didn't take — fix it before
proceeding, or every later "tests pass" is noise. Confirm a saved project still loads
(migrator pass-through).

**After Prompt 0:** Run ≥5 successive complex generations; every one must populate the
canvas. The fix that matters is Part A (loader guard) — verify that explicitly. Watch
the `[generate]` logs for non-zero counts. Confirm batch complex commands no longer
truncate silently and the model selector routes to Haiku. Confirm loading an existing
project still works.

**After Prompt 1:** Editor opens, shows SQL, accepts edits. `grep -n
"showDdlPatchesModal" src/` → nothing. Banner visible/non-dismissible. Apply succeeds
on anything parseable (no analyzer yet). AI raw SQL shows in Section 2.

**After Prompt 2:** Click every View SQL / Export / Deploy / Generate RLS / Generate
Types affordance on a manually-built canvas — some UI may have read
`compileReport.*` and need patching. Editor shows clean SQL (no fabricated CHECKs);
View SQL survives a circular FK. CHECK dedup: identical dupes collapse to one; same-
name/different-expr NOT merged (Prompt 5 W10); different-name/same-expr stays (Prompt
5 V10).

**After Prompt 3:** AI generation still gets full treatment. Faithful mode is a true
no-op: import the fixture, open the editor — identical modulo whitespace/parser-drops.
If even one identifier was renamed or one CHECK synthesized, faithful has a leak.

**After Prompt 4:** The `DO $$` wrapper is the whole game — confirm the inner ALTERs
are unwrapped and CHECKs land in checkConstraints[] (not patches). If most CHECKs went
to patches, the unwrap regex is wrong. Verify the editor's Apply now preserves UNIQUE,
CHECK, partial indexes, and ON DELETE.

**After Prompt 5:** If analyzeSchema(productionSchema) returns errors, the rules are
buggy — your schema is legal; fix the rules. Verify cascade suppression (one
missing-pk, not N). Verify Apply blocks on errors and Force Apply works.

**After Prompt 6:** The round-trip test is your insurance. A red round-trip in CI is a
P0. Confirm expected.json holds the real Tier 2 counts (ratchet on new rules) and the
banner is gone.

---

## Companion file

See `COMPILER_REDESIGN.md` for the full architectural rationale, the complete pass
audit, and the Tier 3 / Tier 4 rule catalog — they slot into the schema-analyzer
pattern from Prompt 5 with no further architectural work.


