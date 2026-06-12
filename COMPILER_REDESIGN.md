# VibeDB Compiler Redesign — Audit + Recommendations

Three research streams: existing compiler audit, Kysely/Zod patterns, current PostgreSQL static-analysis best practices. This file consolidates the findings into a concrete plan.

---

## Part 1 — Honest Audit of Existing 7 Passes

Categorization based on whether the pass invents content from heuristics (HALLUCINATORY), adds opinionated defaults (OPINIONATED), or fixes invariants without inventing (SAFE).

| Pass | Function | Location | Category | Risk |
|---|---|---|---|---|
| 1 | `enforceSnakeCaseNaming` | lines 36–96 | **SAFE** | Low — deterministic rename, no invention |
| 2 | `injectCheckConstraints` | lines 409–475 | **HALLUCINATORY** | **CRITICAL** — pattern-matches column names to inject business logic (`status IN ('active', 'inactive', ...)`) |
| 2b | `applyTypeUpgrades` (domain-driven) | lines 879–909 | **OPINIONATED** | Medium — only fires when a domain is detected, but still invents intent |
| 3 | `injectMissingFKIndexes` | lines 479–514 | **SAFE-ish** | Low for perf, but it's still mutation. Better as a suggestion. |
| 4 | `runDeduplicationPass` | lines 518–539 | **SAFE** | Low — idempotent cleanup |
| 5 | `ensureTimestampDefaults` | lines 543–570 | **OPINIONATED** | Low — `created_at` getting `now()` default is conventional |
| 6 | `fixSemanticConstraints` | lines 576–756 | **MIXED** | Sub-rules 1–5 SAFE; Rule 6 warning-only; Rule 7 (cascade inference) OPINIONATED |
| 7 | `ensureStandardColumns` | lines 760–873 | **HALLUCINATORY** | **CRITICAL** — auto-injects `id`/`created_at`/`updated_at`; can produce dual PKs if user already has one named differently |

**The two passes that need to die or become opt-in: Pass 2 (CHECK injection) and Pass 7 (standard column injection).** These are the source of the corruption your example schema exhibited.

Domain modules (`healthcare.ts`, `quant-finance.ts`, `pe-vc.ts`) are heavily HALLUCINATORY — they detect a domain from table/column name patterns, then inject 13–20 CHECK rules and cross-column rules based on the detection. Healthcare module assumes patient consent requirements from table names alone. These should also become suggestion passes, not mutation passes.

---

## Part 2 — Architectural Recommendation

**Shift the compiler from "mutate-by-default" to "analyze-and-suggest" with structured diagnostics, modeled after Zod's issue/error shape.**

Current API:
```ts
runCompilerPass(tables: TableNode[]): { tables: TableNode[]; report: CompilerReport }
```

Proposed API:
```ts
analyzeSchema(tables: TableNode[], options?: { autofix?: "safe" | "all" | "none" }): {
  tables: TableNode[];           // unchanged unless autofix is enabled
  diagnostics: SchemaDiagnostic[];
}

interface SchemaDiagnostic {
  code: string;                  // "fk_type_mismatch", "missing_pk", "varchar_no_index", ...
  severity: "error" | "warning" | "info";
  path: (string | number)[];     // ["tables", "users", "columns", "email"] — Zod-style
  message: string;
  suggestedFix?: {
    description: string;
    apply: (tables: TableNode[]) => TableNode[];
  };
}
```

Properties this gives you:

- **Zod-style path tracking** lets the UI highlight the exact column/constraint a diagnostic applies to.
- **Severity** lets the UI render errors red, warnings yellow, info blue. Users dismiss what they don't care about.
- **Optional `suggestedFix`** means lint findings can offer a one-click fix, but the fix is opt-in per finding — not silently applied across the whole schema.
- **`autofix: "safe"`** can run only the truly invariant-preserving fixes (naming, dedup) automatically; everything else is a suggestion the user accepts.

This pattern is exactly how Zod's `errors.ts` (lines 10–115) reports issues: `code`, `path`, `message`, structured. ESLint, TypeScript, Rust's `cargo check` all use variants of this. It scales infinitely — you can add 100 lint rules without ever worsening the corruption risk because none of them mutate by default.

---

## Part 3 — New Passes to Add (Prioritized by Impact)

Drawn from PG best practices + Kysely's first-class feature modeling + Zod's structured-error pattern. Each pass produces diagnostics, not mutations.

### Tier 1: High-Impact Validators (catch real production bugs)

**V1. FK target must be UNIQUE/PRIMARY KEY**
- Error if `FOREIGN KEY → some_table.some_column` and `some_column` isn't covered by a UNIQUE or PK constraint
- Why: This fails at `apply` time with cryptic PG error. Static catch is much friendlier.
- Severity: **ERROR**
- Detection: walk FKs, check target table for PK/UNIQUE covering the target columns
- Inspired by: PG docs + Kysely FK builder semantics

**V2. FK column type must match target type**
- Error if `posts.user_id INT` references `users.id BIGINT` (silent cast or apply-time failure)
- Severity: **ERROR**
- Detection: type comparison after normalization
- Inspired by: Kysely's typed FK builder — types are enforced at compile time

**V3. Every table needs a PRIMARY KEY**
- Error if a table has no PK
- Why: Breaks logical replication, ORMs choke, `REPLICA IDENTITY FULL` is expensive
- Severity: **ERROR**
- Detection: trivial — count PK constraints per table

**V4. Reserved-word identifiers**
- Error if any table/column name matches the PG reserved-word list (Appendix C)
- Why: Requires permanent double-quoting; drop the quotes once and your query silently targets something else
- Severity: **ERROR** for true reserved words, **WARNING** for unreserved keywords
- Detection: check against a static list (PG ships one)

**V5. JSON column with btree index**
- Error if a btree index is created on a `json`/`jsonb` column
- Why: Btree on JSON is essentially useless; user wanted GIN or an expression index on a path
- Severity: **ERROR**
- Detection: check index column types

### Tier 2: High-Value Warnings (suboptimal, almost-always wrong)

**W1. `timestamp` instead of `timestamptz` on `*_at` columns**
- Why: Timestamps without timezone produce wrong values across DST/regions
- Severity: **WARNING** generally, **ERROR** for `created_at`/`updated_at`
- Suggested fix: replace type with `timestamptz`

**W2. `json` instead of `jsonb`**
- Why: `json` can't be GIN-indexed, has no containment operators, slower for everything except byte-perfect round-trip
- Severity: **WARNING**
- Suggested fix: replace `json` with `jsonb`

**W3. `serial`/`bigserial` instead of `GENERATED ... AS IDENTITY`**
- Why: Sequence ownership is fragile; identity columns are the modern PG idiom
- Severity: **WARNING**
- Suggested fix: replace with `BIGINT GENERATED BY DEFAULT AS IDENTITY`

**W4. `money` type**
- Why: Locale-dependent, fixed scale, no multi-currency support
- Severity: **ERROR** (it's that bad)
- Suggested fix: `numeric(p, s)` + a `currency_code` column

**W5. `varchar(n)` with arbitrary length cap**
- Why: Adds runtime CHECK with no storage benefit; widening can require a rewrite
- Severity: **INFO**
- Suggested fix: `text` plus an explicit CHECK if a real limit exists

**W6. `char(n)` for text**
- Why: Pads with spaces, comparison semantics weird, no storage win
- Severity: **WARNING**

**W7. Boolean column nullable**
- Why: `WHERE NOT is_active` silently drops NULL rows — three-valued booleans are almost always a bug
- Severity: **WARNING**
- Suggested fix: add NOT NULL and DEFAULT

**W8. FK column without supporting index**
- Why: Cascading deletes scan the child; joins on FK are slow
- Severity: **WARNING**
- Suggested fix: add a btree index covering the FK columns
- **NOTE: This is your existing Pass 3 reformulated as a suggestion instead of auto-injection.**

**W9. Soft-delete + UNIQUE without partial predicate**
- Why: `UNIQUE(email)` blocks re-registration after soft delete; tombstones accumulate
- Severity: **WARNING**
- Detection: table has `deleted_at` AND a unique index without `WHERE deleted_at IS NULL`
- Suggested fix: add `WHERE deleted_at IS NULL` to the unique index

**W10. Multi-tenant table: secondary index doesn't lead with `tenant_id`**
- Why: Without `tenant_id` first, every query scans across tenants
- Severity: **WARNING**
- Detection: table has `tenant_id`/`org_id`/`workspace_id` column AND a secondary index that doesn't lead with it

**W11. Boolean indexed alone (without partial predicate)**
- Why: Indexing low-cardinality bool is wasted; want `WHERE is_active = true` partial
- Severity: **INFO**
- Suggested fix: convert to partial index

### Tier 3: Style/Cleanup (style consistency, low-stakes)

**S1. Duplicate indexes**
- Detect: indexes with identical (columns, where, opclass, unique)
- Severity: **WARNING**
- **NOTE: Your Pass 4 (dedup) already does this; convert to a diagnostic rather than silent removal so users see what's being removed.**

**S2. Index prefix redundancy**
- Detect: index `(a, b)` exists AND index `(a)` exists — the second is dead weight
- Severity: **INFO**

**S3. CHECK constraint hardcoding enum-like values on a `text` column**
- Why: Adding a value requires migration; ENUM or lookup table is more flexible
- Severity: **INFO**
- Suggested fix: convert to a real ENUM type
- **NOTE: This is the inverse of your Pass 2 — instead of INJECTING these, you SUGGEST refactoring them when found.**

**S4. Constraint naming convention**
- Detect: PK not named `{table}_pkey`, FK not named `{table}_{col}_fkey`
- Severity: **INFO**

**S5. Missing NOT NULL on `tenant_id`, FK columns, or timestamps with defaults**
- Severity: **WARNING**
- Suggested fix: add NOT NULL

**S6. `numeric` without precision on monetary columns**
- Detect: column name matches `*price|*amount|*cost|*balance` with bare `numeric` type
- Severity: **INFO**
- Suggested fix: specify `numeric(p, s)`

### Tier 4: Advanced / Kysely-Inspired (less common, more sophisticated)

**A1. Deferrable FK + CASCADE delete combination**
- Why: Cascading deletes on deferred FKs can violate user expectations
- Severity: **WARNING**
- Inspired by Kysely `ForeignKeyConstraintBuilder.deferrable()` at `src/schema/foreign-key-constraint-builder.ts:42-68`

**A2. Circular FK without deferrable settings**
- Detect: cycle in FK graph where no FK in the cycle has `deferrable initially deferred`
- Severity: **WARNING**
- Suggested fix: mark one FK in the cycle as deferrable

**A3. Generated column expression validation**
- Detect: `GENERATED ALWAYS AS (expr)` references columns that don't exist or types that don't match
- Severity: **ERROR**
- Inspired by Kysely `GeneratedNode`

**A4. NULLS NOT DISTINCT on non-unique index**
- Detect: index with `nulls_not_distinct` flag that isn't UNIQUE
- Severity: **WARNING** (semantically meaningless)
- Inspired by Kysely `CreateIndexBuilder.nullsNotDistinct()`

**A5. `deleted_at` column exists but no index on it**
- Detect: column matches `deleted_at` AND no index references it
- Severity: **INFO**
- Why: every read should `WHERE deleted_at IS NULL`; without an index, scans degrade over time

---

## Part 4 — What to Keep, What to Refactor, What to Cut

### Keep as-is (rename for clarity):
- Pass 1 `enforceSnakeCaseNaming` — rename to `normalizeNaming`, mark as safe-autofix
- Pass 4 `runDeduplicationPass` — convert to diagnostic-with-autofix (show what was removed)
- Pass 5 `ensureTimestampDefaults` — keep as opt-in suggestion
- Pass 6 sub-rules 1–4 (UUID defaults, self-FK NOT NULL, lifecycle timestamps, contradictory CHECK) — keep, mark as safe

### Refactor from mutation to suggestion:
- Pass 3 `injectMissingFKIndexes` — becomes lint W8 above (suggest, don't inject)
- Pass 6 Rule 5 (partial indexes on `deleted_at`) — becomes lint A5
- Pass 6 Rule 7 (cascade inference on FKs) — becomes a prompt: "FK has no ON DELETE clause — choose CASCADE / SET NULL / RESTRICT" rather than silent assignment

### Cut or make heavily opt-in:
- Pass 2 `injectCheckConstraints` — **delete the auto-injection.** The 27 heuristic patterns become a "suggested CHECK constraints" panel users can browse and apply individually. Keep the patterns; remove the mutation.
- Pass 2b `applyTypeUpgrades` — same treatment, suggestions only
- Pass 7 `ensureStandardColumns` — **delete the auto-injection.** Replace with: when a user creates a new table via the UI, a wizard offers "add id/created_at/updated_at?" with checkboxes defaulting to on. For imported tables: do nothing.
- Domain modules (`healthcare`, `quant-finance`, `pe-vc`) — keep the detection, but their suggestions ALL go through the diagnostics panel. No silent injection. The detection itself becomes an INFO diagnostic: "This schema looks like a healthcare domain. Would you like to apply 13 recommended CHECK constraints? [Review]"

---

## Part 5 — Implementation Order

If shipping this as a v2 of the compiler, sequence:

1. **Add the `analyzeSchema` function** alongside `runCompilerPass`. Both exist temporarily.
2. **Port the SAFE passes** (1, 4, parts of 6) into `analyzeSchema` with autofix annotations. Verify behavior matches.
3. **Port the OPINIONATED passes** (2b, 5, 6 Rule 7) as suggestion-mode-only diagnostics.
4. **Implement the new Tier 1 validators** (V1–V5). These are pure additions and probably catch real bugs in your existing user projects on day one.
5. **Implement Tier 2 warnings** (W1–W11). High value, no risk.
6. **Add the diagnostic panel UI** — sidebar showing all findings, grouped by severity, with one-click apply buttons.
7. **Switch user-driven call sites** from `runCompilerPass(canvasItems)` to `analyzeSchema(canvasItems, { autofix: "safe" })`. Now they get naming normalization and dedup but no fabricated content.
8. **Keep AI-generation paths on `runCompilerPass`** OR switch them to `analyzeSchema(canvasItems, { autofix: "all" })` if you want AI-generated tables to receive the full opinionated treatment.
9. **Implement Tier 3–4 passes** as needed. These are nice-to-haves.
10. **Deprecate and delete `runCompilerPass`** once nothing calls it.

---

## Sources / References

**Kysely patterns:**
- `src/schema/foreign-key-constraint-builder.ts:26-68` — FK with ON DELETE/UPDATE, deferrable
- `src/schema/create-index-builder.ts:65-312` — partial indexes, NULLS NOT DISTINCT, expression indexes
- `src/operation-node/generated-node.ts` — generated column modeling

**Zod patterns:**
- `packages/zod/src/v4/core/errors.ts:10-115` — `$ZodIssueBase`: path, code, message
- `src/v4/core/checks.ts:10-80` — refinement composition

**PG best practices:**
- PostgreSQL "Don't Do This" wiki (https://wiki.postgresql.org/wiki/Don%27t_Do_This)
- schemalint (https://github.com/kristiandupont/schemalint)
- Squawk linter (https://squawkhq.com/)
- Mercury — "8 Lints for your Postgres schema" (https://mercury.com/blog/lints-for-postgres-schema)
- Crunchy Data — Indexing JSONB
- Cybertec — Index your foreign key
