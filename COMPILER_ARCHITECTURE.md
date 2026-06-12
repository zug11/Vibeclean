# The VibeDB Compiler — How It Works, Where It's Going, and Why TypeScript Is the Vehicle

**Audience:** engineering.
**Synthesizes:** the live implementation (`src/lib/compiler-pass.ts`), the redesign plan (`COMPILER_REDESIGN.MD` — audit, diagnostics architecture, rule catalog), and the language argument (`TYPESCRIPT_FOUNDATIONS.md`).
**Sprint mapping:** the redesign ships as Prompts 2, 3, 5, 6 in `CTO_SPRINT_GUIDE.md` (Jira: KAN-8, KAN-10, KAN-12, KAN-13).

One sentence of thesis: **the compiler today is a well-engineered machine pointed at the wrong contract — it mutates when it should observe — and the redesign is a contract change that TypeScript lets us make safely.**

---

## Part 1 — How the Compiler Works Today

### 1.1 The shape of the machine

The entire compiler is one exported function with one honest signature:

```919:919:src/lib/compiler-pass.ts
export function runCompilerPass(tables: TableNode[]): { tables: TableNode[]; report: CompilerReport } {
```

It takes the IR (`TableNode[]`), threads it through a fixed sequence of passes — each pass a pure-shaped function `TableNode[] → { tables, actions }` — and accumulates a typed `CompilerReport` describing everything it did. The orchestration is a textbook pipeline:

```923:928:src/lib/compiler-pass.ts
  let current = tables;

  // Pass 1: Naming
  const naming = enforceSnakeCaseNaming(current);
  current = naming.tables;
  allActions.push(...naming.actions);
```

### 1.2 The passes, in execution order

| # | Pass | What it does | Audit category (from `COMPILER_REDESIGN.MD`) |
|---|---|---|---|
| 1 | `enforceSnakeCaseNaming` | Deterministic rename of tables/columns to snake_case | **SAFE** — no invention |
| — | `detectDomains` | Pattern-matches table/column names against domain modules (healthcare, quant-finance, PE/VC); merges their rule packs into pass 2 | **HALLUCINATORY** input amplifier |
| 2 | `injectCheckConstraints` | ~27 heuristic patterns + domain rules; pattern-matches column *names* and injects business-logic CHECKs | **HALLUCINATORY — CRITICAL** |
| 2b | `applyTypeUpgrades` | Domain-driven type rewrites (only when a domain is detected) | **OPINIONATED** |
| 3 | `injectMissingFKIndexes` | Adds a btree index for every unindexed FK column | **SAFE-ish** — still mutation; better as a suggestion |
| 4 | `runDeduplicationPass` | Removes duplicate indexes/columns | **SAFE** — idempotent cleanup |
| 5 | `ensureTimestampDefaults` | `created_at`/`updated_at` get `now()` defaults | **OPINIONATED** — conventional |
| 6 | `fixSemanticConstraints` | Universal relational invariants (UUID defaults, self-FK NOT NULL, lifecycle timestamps, contradictory CHECKs, cascade inference) | **MIXED** — sub-rules 1–5 safe, rule 7 opinionated |
| 7 | `ensureStandardColumns` | Auto-injects `id` / `created_at` / `updated_at` | **HALLUCINATORY — CRITICAL** (can produce dual PKs) |

The two critical passes are the corruption: **Pass 2 invents business rules from column names** — a column named `role` *of any kind* gets `IN ('admin', 'user', 'moderator', 'viewer')` baked into it:

```121:126:src/lib/compiler-pass.ts
  {
    pattern: (n) => n === "role",
    expression: (c) => `${c} IN ('admin', 'user', 'moderator', 'viewer')`,
    label: "role enum",
    category: "enum",
  },
```

— and **Pass 7 invents columns**, which is catastrophic when a user's table already has a primary key under a different name. The domain modules compound this: detection from *names alone* triggers 13–20 injected rules (the healthcare module assumes patient-consent requirements from table names).

### 1.3 What's genuinely good about the current design

The redesign keeps more than it discards, because the engineering bones are right:

- **Single typed entry point.** All mutation flows through one signature, which is why the 13-call-site audit was even possible.
- **Passes are data-driven.** `CHECK_RULES` is a typed array of `CheckRule` objects (`pattern`, `expression`, `label`, `category`) — the rules are *values*, not control flow. That's exactly the shape a suggestion engine needs; only the application is wrong.
- **Self-reporting.** Every pass emits typed `CompilerAction`s into a `CompilerReport` (counts, descriptions, durations). The compiler already explains itself in structured data.
- **Domain artifacts are computed but not applied** (triggers, RLS policies, companion tables ride in the report only) — proof the codebase already knows the difference between *doing* and *suggesting*. The redesign extends that distinction to everything.

### 1.4 The actual problem: where it runs

`runCompilerPass` executes at **13 call sites** in two morally distinct groups:

- **6 AI-generation / auto-fix sites** (`handleGenerate`, sidebar generation, explicit fix flows, suggestion accepts) — full treatment is *wanted* here; AI output benefits from normalization and hardening.
- **7 user-driven sites** (View SQL, Generate RLS, Export, Deploy, pre-audit, and two in `SupabasePanel`) — here the same machine **fabricates content the user never wrote** and presents it as their schema. This is the "lying about user SQL" P0.

The bug is not in any pass. The bug is that *mutation and analysis are different operations* and the codebase runs the mutator in analysis contexts. That is the redesign's first principle, and it's permanent: **never recombine them.**

---

## Part 2 — The Redesign: From Mutate-by-Default to Analyze-and-Suggest

### 2.1 The contract change

`COMPILER_REDESIGN.MD`'s core recommendation, modeled on Zod's issue/error shape:

```ts
// Today — the compiler decides for you:
runCompilerPass(tables: TableNode[]): { tables: TableNode[]; report: CompilerReport }

// Tomorrow — the analyzer informs you, and you decide:
analyzeSchema(tables: TableNode[], options?: { autofix?: "safe" | "all" | "none" }): {
  tables: TableNode[];           // unchanged unless autofix is enabled
  diagnostics: SchemaDiagnostic[];
}

interface SchemaDiagnostic {
  code: string;                  // "fk_type_mismatch", "missing_pk", ...
  severity: "error" | "warning" | "info";
  path: (string | number)[];     // ["tables", "users", "columns", "email"] — Zod-style
  message: string;
  suggestedFix?: {
    description: string;
    risk: "safe" | "breaking" | "destructive";
    apply: (tables: TableNode[]) => TableNode[];
  };
}
```

This is the ESLint / TypeScript / `cargo check` architecture: structured findings, optional per-finding fixes, zero mutation by default. It scales to hundreds of rules **without increasing corruption risk**, because adding a rule adds a *report*, never a side effect.

### 2.2 The triage — keep, refactor, cut

| Disposition | Passes | Redesigned form |
|---|---|---|
| **Keep** (safe-autofix) | Pass 1 naming, Pass 4 dedup, Pass 6 sub-rules 1–4 | Run under `autofix: "safe"`; dedup becomes a diagnostic-with-autofix so users *see* what's removed |
| **Refactor to suggestion** | Pass 3 FK indexes → rule W8 (fk-without-index); Pass 6 rule 5 → A5 (deleted_at index); Pass 6 rule 7 cascade inference → an explicit prompt | Same logic, new delivery: a finding with a one-click fix |
| **Cut the auto-injection** | Pass 2 CHECK injection, Pass 2b type upgrades, Pass 7 standard columns | The 27 patterns survive as a browsable "suggested CHECK constraints" panel; new-table standard columns become a creation-wizard checkbox; imported tables get **nothing** |
| **Demote to opt-in** | Domain modules | Detection itself becomes an INFO diagnostic: "This looks like a healthcare domain — apply 13 recommended constraints? [Review]" |

Note the elegance of rule S3: it's Pass 2 *inverted*. Instead of injecting enum-like CHECKs, the analyzer *finds* hand-rolled enum CHECKs and suggests refactoring to a real ENUM. Same domain knowledge, opposite direction of trust.

### 2.3 The rule catalog (what the analyzer knows)

- **Tier 1 — validators that catch production bugs (ERROR):** FK target not UNIQUE/PK, FK type mismatch, missing primary key, reserved-word identifiers, btree index on json/jsonb — plus sprint additions: NOT NULL columns with SET NULL FKs, CHECKs/indexes referencing nonexistent columns (the AI `_desc` hallucination), duplicate constraint names. *(Prompt 5 / KAN-12.)*
- **Tier 2 — almost-always-wrong warnings:** `timestamp` vs `timestamptz`, `json` vs `jsonb`, `serial` vs IDENTITY, the `money` type (ERROR — it's that bad), nullable booleans, FK without index, soft-delete UNIQUE without partial predicate, tenant-id not leading an index. *(Prompt 6 / KAN-13.)*
- **Tier 3 — style:** duplicate/redundant indexes, constraint naming conventions, bare `numeric` on money-ish columns.
- **Tier 4 — advanced:** deferrable+CASCADE interactions, circular FKs without deferrable settings, generated-column expression validation.

Tiers 3–4 require **no further architectural work** — they're just more rule files in the same registry. That's the point of the architecture.

### 2.4 The migration path (sequenced in the sprint)

1. **Sever the corruption (Prompt 2 / KAN-8):** remove `runCompilerPass` from the 7 user sites. AI sites untouched.
2. **Make it principled (Prompt 3 / KAN-10):** add the `mode: "faithful" | "full"` gate; faithful = zero mutation, and the re-added faithful calls at the 7 sites are the seam the analyzer plugs into.
3. **Build the analyzer (Prompt 5 / KAN-12):** `analyzeSchema` + Tier 1 rules + the editor Apply gate (errors block; Force Apply is the explicit, confirmed bypass).
4. **Make it visible and enforced (Prompt 6 / KAN-13):** diagnostics panel, Tier 2 rules, export gate (bypassable), deploy gate (**no bypass**), round-trip CI invariant.
5. **Endgame:** user paths call `analyzeSchema(tables, { autofix: "safe" })` — naming and dedup, nothing fabricated. AI paths either stay on `runCompilerPass` or move to `autofix: "all"`. When nothing calls the old entry point, delete it.

The flow matrix is the permanent law: AI generation gets `full`; imported SQL gets analyzer-only; export/deploy get faithful generation plus an emission gate.

---

## Part 3 — Why TypeScript Is What Makes the Redesign Work

The redesign is a *trust* refactor, and every trust boundary in it is enforced by a TypeScript fundamental (the long-form argument is `TYPESCRIPT_FOUNDATIONS.md`; this is its application).

### 3.1 The mode gate is a closed literal union, not a boolean

```ts
runCompilerPass(tables, { mode: "faithful" })
```

`"faithful" | "full"` is self-documenting policy at every call site, and it's *closed*: a typo'd `"faithfull"` is a compile error, and a future third mode forces every `switch` over modes to be revisited. A `boolean` would have given us none of that — and the audit that found 13 call sites would have found 13 ambiguous `true`s.

### 3.2 The diagnostic is a discriminated, structured value — so the UI can't mishandle it

`severity: "error" | "warning" | "info"` and `risk: "safe" | "breaking" | "destructive"` are closed unions, which means:

- The diagnostics panel's rendering and the fix buttons' confirmation escalation (`safe` → click, `breaking` → confirm, `destructive` → strong confirm) are exhaustive `switch`es. Add a risk tier, and **every consumer fails to compile until it handles it** — the `never`-exhaustiveness trick turns UI policy into a checked contract.
- `path: (string | number)[]` is typed data, not a formatted string — click-to-highlight is a typed walk into the IR, the exact mechanism Zod uses for `issue.path`. We're not imitating Zod's aesthetics; we're reusing its type-level design because it's already proven at scale in this very stack (`zod` is a dependency).

### 3.3 Rules are typed plugins; the registry is checked, not trusted

Each of the ~20 rules is a value conforming to a `Rule` interface — and the current code shows the pattern already half-exists: `CheckRule` and `DomainModule` are typed plugin contracts today. The redesign's rule registry is the same idea with one upgrade, `satisfies`:

```ts
export const fkTypeMismatch = {
  code: "fk-type-mismatch",
  severity: "error",
  check(tables, ctx) { /* ... */ },
} satisfies Rule;
```

The rule keeps its narrow literal `code` (so tests and the per-rule disable list stay string-literal-checked) while the compiler verifies the contract. A rule that forgets `check`, returns the wrong shape, or claims an invalid severity **does not build**. One hundred contributors can add one hundred rules and the registry stays sound.

### 3.4 `readonly` + function-typed fixes make "no mutation by default" mechanical

The analyzer's promise — *observes, never mutates* — should not depend on discipline:

- `check(tables: readonly TableNode[], ctx)` makes accidental mutation a compile error inside every rule.
- `suggestedFix.apply: (tables: TableNode[]) => TableNode[]` forces fixes to be expressed as transformations that *return* a new IR — which is precisely what makes them previewable (run apply, diff, show the user) and undoable (one `useHistory` entry). The fix's type signature *is* the feature.

Contrast with today: the hallucinatory passes mutate deep inside a pipeline where nothing in the types distinguishes "fixed an invariant" from "invented a business rule." The redesign makes that distinction a *type* (`risk`), attached to every change, surfaced in UI.

### 3.5 The structural symmetry, stated once

TypeScript's own pipeline is parse → bind → **check** → emit, where the checker computes structured diagnostics (`code`, position, message) and **never alters program behavior**. The redesigned VibeDB engine is the same machine pointed at Postgres:

| tsc | VibeDB (post-redesign) |
|---|---|
| Parses source into an AST | Prompt 4 parser: SQL → AST → IR |
| Binds identifiers to symbols | FK/enum resolution across the IR |
| Checks, emits diagnostics, changes nothing | `analyzeSchema` — findings, zero mutation |
| Quick-fixes are opt-in, per-diagnostic | `suggestedFix` with risk tiers |
| `strict` is an opt-in ratchet | `autofix: "safe"` is an opt-in ratchet |
| Emit is separate from checking | Generation (faithful) is separate from analysis |

The current compiler conflates checking with emitting *and* with rewriting — the exact conflation tsc's architecture exists to avoid. The redesign un-conflates them. That's the whole story: **we are restructuring our compiler to work the way the compiler we build it with works.**

### 3.6 What guards the guards

Finally, TypeScript is also how we *verify* the redesign:

- The **round-trip CI test** (Prompt 6) asserts deep-equality of two IR values — a typed structural comparison, meaningful precisely because the IR is one canonical type.
- The **faithful-mode contract** ("returns tables unchanged") is testable as identity over `TableNode[]`.
- The `typecheck` gate from Prompt -1 means every contract in this document — mode literals, rule shapes, diagnostic unions, readonly arrays — is *enforced on every commit*, not aspirational.

---

## Summary

| | Today | After redesign |
|---|---|---|
| Default behavior | Mutate | Observe and report |
| User SQL | Rewritten silently | Faithful — byte-honest modulo formatting |
| AI output | Full treatment | Full treatment (unchanged) |
| Heuristic knowledge (27 CHECK patterns, domain packs) | Injected | Suggested, browsable, opt-in |
| Change visibility | `CompilerReport` after the fact | `SchemaDiagnostic` before the act, risk-tiered |
| Safety mechanism | Code review | Type system: closed unions, readonly, typed fixes, exhaustiveness |
| Architecture lineage | Ad-hoc pipeline | Zod's issues + ESLint's rules + tsc's separation of check/emit |

The machine is good. The contract was wrong. TypeScript is how we change the contract without breaking the machine.
