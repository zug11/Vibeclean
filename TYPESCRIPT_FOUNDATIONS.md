# TypeScript Foundations — Why TypeScript Is the Backbone of VibeDB

**Audience:** the whole team — engineering, product, and anyone onboarding.
**Companions:** `SPECIFICATION.md` (repo map), `CTO_SPRINT_GUIDE.md` (sprint plan), `COMPILER_REDESIGN.md` (analyzer architecture).

This document makes three arguments, in order:

1. TypeScript is not an implementation detail of VibeDB — it is the load-bearing wall.
2. The four hard problems of our sprint — the **IR**, the **AST parser**, the **linter/analyzer**, and the **compiler** — are all problems TypeScript's fundamentals were built to solve.
3. To use those fundamentals well, you have to understand what TypeScript actually does and how it works — so the last section is a from-scratch explanation.

---

## Part 1 — How Important TypeScript Is to VibeDB

### 1.1 VibeDB is a program that manipulates other programs

Most apps use types to describe *their own* data. VibeDB is different: **our product's core object is itself a type system.** A database schema *is* a set of types — tables, columns, constraints — and VibeDB's entire job is to create, transform, validate, and serialize those types without corrupting them.

That means the cost of a type error in VibeDB is not a crashed component. It is a **corrupted user schema** — a fabricated CHECK constraint, a silently dropped UNIQUE, a deploy that destroys a production table. The corruption bug this sprint exists to fix (see `COMPILER_REDESIGN.md`) happened in the gap between what the code *assumed* about data shapes and what was actually true. TypeScript is the tool that closes that gap.

### 1.2 Everything in VibeDB flows through one typed artifact

Every feature in the product is a function over a single TypeScript type — the IR:

```17:32:src/lib/types.ts
export interface TableNode {
  id: string;
  name: string;
  columns: Column[];
  x: number;
  y: number;
  indexes?: { name: string; columns: string[]; type: string; unique: boolean; where?: string }[];
  checkConstraints?: { name: string; expression: string }[];
  description?: string;
  isReordering?: boolean;
  dataRows?: Record<string, string>[];
  importedData?: {
    headers: string[];
    rows: string[][];
  };
}
```

Trace any feature and you arrive at `TableNode[]`:

| Feature | What it is, typed |
|---|---|
| The canvas | A renderer of `TableNode[]` (x/y are part of the IR) |
| AI generation | Claude output parsed *into* `TableNode[]` |
| The compiler | `(tables: TableNode[]) => { tables: TableNode[]; report: CompilerReport }` |
| Export (SQL/Prisma/Drizzle/GraphQL/CSV) | Seven serializers of `TableNode[]` |
| Import | A parser producing `TableNode[]` + `DDLPatch[]` |
| Deploy | A pipeline that validates and emits `TableNode[]` as DDL |
| Persistence | `TableNode[]` written to IndexedDB and Supabase |
| Undo/redo | `useHistory<TableNode[]>` — a generic over the IR |

One type, consumed by every subsystem, written by five different sources (user, AI, parser, compiler, storage). The *only* thing keeping those five writers and seven readers in agreement is the TypeScript type system. Without it, every subsystem would re-derive the shape from folklore — and drift.

### 1.3 TypeScript already does invisible work across the stack

- **Frontend ↔ backend contract:** `src/integrations/supabase/types.ts` is *generated from the database* — our own Postgres schema becomes TypeScript, so a renamed column breaks the build, not production.
- **Edge functions:** the Deno functions (`vibedb-ai`, `vibedb-deploy`) are TypeScript end to end; the AI gateway's request routing (`longOutputTypes`, `fastTypes`) is typed dispatch.
- **The product output itself:** one of our seven export targets *is TypeScript* (generated TS types for the user's schema), and two more (Prisma, Drizzle) exist primarily to give users typed database access. We don't just use TypeScript — **we sell it.**
- **Domain modules:** `DomainModule` in `types.ts` is a typed plugin interface — detection, check rules, triggers, RLS policies — that keeps three domain packs structurally identical.

### 1.4 The honest caveat: we are not yet using TypeScript at full strength

Two facts from the sprint audit keep us humble:

1. `tsconfig.app.json` has `strict: false`, `noImplicitAny: false` — we run TypeScript with its strongest checks off.
2. `npm run build` (`vite build` via SWC) **strips types without checking them** — until Prompt -1 lands the `typecheck` script, type errors don't fail anything.

So the thesis of this document cuts both ways: TypeScript makes VibeDB work, *and* the places where we've weakened it are exactly where our worst bugs live (`payload?: unknown` accessed unchecked, the undeclared `OpenAPIPathMethod`, the untyped loader path that caused the empty-canvas race). The sprint's Prompt -1 is, at heart, a decision to take TypeScript seriously.

---

## Part 2 — TypeScript Fundamentals Applied to the IR, AST, Linting, and Compiling

This is the practical core: the language features that map one-to-one onto the four systems we're building this sprint.

### 2.1 The IR — types as the single source of truth

**Fundamental: interfaces, union literals, and optional fields.**

The IR is a tree of plain data described by interfaces. The most important technique already in use is the **string-literal union**, which turns "any string" into "exactly these strings":

```12:12:src/lib/types.ts
  onDelete?: "CASCADE" | "SET NULL" | "RESTRICT" | "NO ACTION";
```

A typo like `"CASCDE"` is a compile error, not a runtime deploy failure. The same pattern protects `DDLPatch.source` (`"ai-chat" | "batch-edit" | "manual"`), `DDLPatch.status`, and `DomainId`.

**Where to go further:**

- **`type` aliases for shared vocab.** `Column.type` is a bare `string` today. A `PostgresType` union (`"uuid" | "text" | "timestamptz" | ...` plus a parameterized escape hatch) would let the compiler catch invalid types at every one of the 13 call sites at once.
- **Branded types for IDs.** `TableNode.id`, `Column.linkedTableId`, and `Column.id` are all `string`, so the compiler can't stop you passing a column id where a table id belongs — a real class of FK-resolution bug. A brand makes them incompatible at zero runtime cost:

```ts
type TableId = string & { readonly __brand: "TableId" };
type ColumnId = string & { readonly __brand: "ColumnId" };
```

- **`readonly` for analysis paths.** The analyzer must *never* mutate. Accepting `readonly TableNode[]` makes "analysis doesn't mutate" a compiler-enforced contract instead of a code-review hope.
- **Versioned envelopes (Prompt -1).** The persisted IR gains `schemaVersion: number`; the migrator is a typed function `(raw: unknown) => StoredProject`. `unknown` at the storage boundary is the point: stored JSON is untrusted until narrowed.

**The principle:** the IR is where TypeScript's *nominal vocabulary* lives. Every concept in the product (constraint, index, patch, enum) should exist exactly once as a type, and every subsystem should import it rather than redescribe it.

### 2.2 The AST — discriminated unions and exhaustive narrowing

**Fundamental: discriminated unions + `switch` narrowing + `never` exhaustiveness.**

An AST (abstract syntax tree) is the canonical use case for discriminated unions. When Prompt 4's parser (`node-sql-parser`) hands us SQL statements, each node carries a *discriminant* — a literal field that tells TypeScript which variant you're holding:

```ts
type SqlStatement =
  | { type: "create";  keyword: "table";  /* table def fields */ }
  | { type: "create";  keyword: "index";  /* index fields */ }
  | { type: "alter";   /* constraint fields */ }
  | { type: "create";  keyword: "type";   /* enum fields */ };

function routeStatement(stmt: SqlStatement): IRContribution {
  switch (stmt.type) {
    case "create":
      // TypeScript now KNOWS stmt has `keyword` — narrow again on it
      ...
    case "alter":
      // here stmt is the ALTER variant; constraint fields are visible
      ...
    default: {
      // exhaustiveness guard: if node-sql-parser adds a variant we
      // didn't handle, this line stops compiling
      const _exhaustive: never = stmt;
      return preserveAsPatch(_exhaustive);
    }
  }
}
```

Two properties make this the right tool for the parser:

1. **Narrowing**: inside each `case`, the compiler *proves* which fields exist. No `as any`, no optimistic property access — which is precisely the bug class the regex parser suffers from (it "knows" things about the SQL that aren't checked anywhere).
2. **Exhaustiveness via `never`**: the statement router must make a decision for *every* statement kind — representable ones go to the IR, everything else becomes a verbatim `DDLPatch`. The `never` trick turns "we forgot to handle CREATE TRIGGER" from a silent data-loss bug into a compile error. That is the round-trip invariant ("nothing is silently dropped") expressed in the type system.

The same pattern guards the **DO-unwrap step**: the inner `ALTER TABLE ... ADD CONSTRAINT` extracted from a `DO $$` block either parses into a known variant or falls into the `never`-guarded default and is preserved as a patch with a diagnostic. The type system makes "silently vanishing CHECKs" structurally impossible.

### 2.3 Linting — structured diagnostics, typed paths, and rule contracts

**Fundamental: literal types, tuple/union paths, function types, and `satisfies`.**

The Prompt 5 analyzer is consciously modeled on Zod's issue shape — which is itself a master class in TypeScript design:

```ts
interface SchemaDiagnostic {
  code: string;                          // "fk_type_mismatch", "missing_pk", ...
  severity: "error" | "warning" | "info";
  path: (string | number)[];             // ["tables", "users", "columns", "email"]
  message: string;
  suggestedFix?: {
    description: string;
    risk: "safe" | "breaking" | "destructive";
    apply: (tables: TableNode[]) => TableNode[];
  };
}
```

Every field is doing type-level work:

- **`severity` and `risk` are closed unions**, so the UI's red/yellow/blue rendering and its confirm-dialog escalation (safe → one click, destructive → strong confirm) can `switch` exhaustively. A new risk tier forces every consumer to handle it — at compile time.
- **`path` is typed data, not a string.** `["tables", "users", "columns", "email"]` is machine-traversable; the diagnostics panel's click-to-highlight feature is just a typed walk of that path into the IR.
- **`suggestedFix.apply` is a function type:** `(tables: TableNode[]) => TableNode[]`. A fix cannot return half an IR, mutate in place undetected (pair with `readonly`), or forget to return — the signature *is* the contract that makes one-click fixes safe to offer.
- **Rules are values conforming to an interface.** Each of the 20 rules (V1–V10, W1–W10) is one file exporting an object `{ code, severity, check(tables, ctx), safeAutofix? }`. The `satisfies` operator lets each rule keep its narrow literal `code` (useful for the registry and tests) while the compiler verifies it matches the `Rule` contract:

```ts
export const fkTypeMismatch = {
  code: "fk-type-mismatch",
  severity: "error",
  check(tables, ctx) { /* ... */ },
} satisfies Rule;
```

This is ESLint's architecture, Zod's error model, and `cargo check`'s philosophy — all of which scale to hundreds of rules *because* the diagnostic is a structured, typed value rather than a formatted string. You can add 100 rules without increasing corruption risk, since the types guarantee none of them mutate by default.

### 2.4 Compiling — typed passes, mode gates, and reports

**Fundamental: function signatures as contracts, generics, and option-literal overloading.**

A compiler is a pipeline of functions with one honest signature. Ours is:

```ts
runCompilerPass(tables: TableNode[]): { tables: TableNode[]; report: CompilerReport }
```

Each of the 7 passes is itself `TableNode[] → TableNode[]` plus typed `CompilerAction` entries — which means the entire mutation surface of the product is enumerable by reading type signatures. That's how the sprint audit was even possible: the 13 call sites were findable and classifiable *because* the compiler has one typed entry point rather than scattered ad-hoc mutation.

Prompt 3's faithful/full split is a type-level design decision:

```ts
runCompilerPass(tables: TableNode[], options?: { mode?: "faithful" | "full" })
```

The mode is a **literal union, not a boolean** — self-documenting at every call site (`{ mode: "faithful" }` reads as policy) and extensible later without a signature break. The typed `CompilerReport` (counts, actions, durations) is the compiler explaining itself in data — the same structured-output philosophy as the analyzer.

And the supporting cast is generic where it should be:

```ts
function useHistory<T>(initial: T): [T, (a: T | ((p: T) => T)) => void, ...]
```

`useHistory<TableNode[]>` gives undo/redo over the IR with full type flow — the functional-updater union `T | ((p: T) => T)` is exactly React's own `setState` contract, reimplemented safely for our history semantics.

### 2.5 The meta-point

Notice the symmetry: **VibeDB's analyzer wants to do for Postgres schemas precisely what TypeScript does for JavaScript programs.**

| TypeScript | VibeDB analyzer |
|---|---|
| Parses JS+types into an AST | Parses SQL into an AST |
| Checks the AST against rules | Checks the IR against V/W rules |
| Reports `code`/`path`/`message` diagnostics | Reports `SchemaDiagnostic`s |
| Never changes runtime behavior | Never mutates by default |
| Offers quick-fixes in the editor | Offers risk-tiered `suggestedFix`es |
| `strict` mode is opt-in rigor | `autofix: "safe"` is opt-in rigor |

We aren't just *using* a type checker — we are *building one* for databases. Understanding how TypeScript works is therefore not background knowledge; it's the design blueprint for our own engine.

---

## Part 3 — What TypeScript Is and How It Works

### 3.1 What it is

TypeScript is a **statically typed superset of JavaScript**. Every valid JavaScript program is valid TypeScript; TypeScript adds a layer of type annotations and type inference *on top*, checked at compile time, then **erased** entirely. The browser never sees a type. There is no runtime.

```ts
function resolveFk(column: Column, tables: TableNode[]): TableNode | undefined {
  return tables.find(t => t.id === column.linkedTableId);
}
```

Strip the annotations and you have the exact JavaScript that ships. The types exist only for the checker — and for every human reading the code.

### 3.2 How it works — the pipeline

The TypeScript compiler (`tsc`) runs four conceptual stages:

1. **Scan & parse.** Source text becomes an **AST** — the same kind of structure our SQL parser produces. `const x = users.length` becomes a tree of nodes (`VariableStatement` → `PropertyAccessExpression` → ...).
2. **Bind.** The compiler walks the AST and connects every identifier to a **symbol** — *this* `users` refers to *that* declaration. Scopes, imports, and merging happen here.
3. **Check.** The heart. For every expression the checker computes a type, then verifies every *use* against every *declaration*: assignments, calls, property accesses, returns. Errors are reported as structured diagnostics — code, file position (a path!), message — exactly the shape our analyzer copies.
4. **Emit.** Types are deleted and JavaScript comes out. Notably, **our build doesn't use tsc to emit** — Vite uses SWC, which does stage 4 *without* stage 3 (it strips types at high speed but checks nothing). That's why "the build passed" has never meant "the types are right" in this repo, and why Prompt -1 adds `tsc --noEmit` — running stages 1–3 *only*, as a pure verifier.

### 3.3 The big ideas that make it powerful

**Structural typing ("duck typing, checked").** Two types are compatible if their *shapes* are compatible — names don't matter. Anything with `{ id: string; name: string; columns: Column[]; x: number; y: number }` *is* a `TableNode` as far as the checker cares. This is why parsed AI output, storage reads, and test fixtures can all flow into IR-consuming functions without ceremony — and why the shape must be guarded at trust boundaries, because structure is all there is.

**Inference.** You annotate boundaries; TypeScript fills in the middle. `const ids = tables.map(t => t.id)` is `string[]` without anyone saying so. Good TypeScript is mostly *un*-annotated, with explicit types at function signatures and module edges.

**Narrowing.** The checker tracks control flow. Inside `if (col.isForeignKey && col.linkedTableId)`, the optional `linkedTableId` is `string`, not `string | undefined`. Discriminated-union `switch`es (Part 2.2) are narrowing's industrial form.

**`unknown` vs `any` — the trust dial.** `any` switches the checker *off* for a value (every property access allowed, errors flow downstream silently). `unknown` is the opposite: nothing is allowed until you *prove* a shape with a check. Rule of thumb, and the moral of our `payload?: unknown` bug: **`unknown` at boundaries, narrow immediately, `any` never.** Data from Claude, from IndexedDB, from PostgREST is `unknown` until validated.

**Generics.** Types parameterized by types: `useHistory<T>`, `Array<TableNode>`, `(tables: T[]) => T[]`. Generics let one implementation serve many types *without* giving up checking — the difference between a typed history hook and a stringly-typed one.

**Erasure and its consequence.** Because types vanish at runtime, TypeScript cannot validate data that arrives *at* runtime. A fetch response typed `TableNode[]` is a promise the network never made. That's why runtime validators (Zod — already a dependency) exist: they check at runtime *and* derive the static type from one definition. Our storage migrator and AI-response parsing are exactly where this belongs.

### 3.4 Strictness is a dial — and where ours is set

`strict: true` enables the checks that catch real bugs: `strictNullChecks` (forces handling of `null`/`undefined` — would have flagged the unguarded loader), `noImplicitAny` (forbids silent `any` holes), and friends. VibeDB currently runs with `strict: false`.

The pragmatic path, post-Prompt -1: get `typecheck` to zero errors as-is, then ratchet — `noImplicitAny` first, `strictNullChecks` next, file-by-file if needed. Each notch converts a category of runtime incident into a compile-time error. For a product whose failure mode is *corrupting other people's databases*, every notch is product quality, not code aesthetics.

### 3.5 One-paragraph summary

TypeScript parses your code into an AST, binds names to symbols, checks every use against every declaration, then erases itself — leaving plain JavaScript plus a guarantee: *the shapes line up*. VibeDB is a machine for transforming one precious shape (`TableNode[]`) between English, canvas, SQL, and five export formats; TypeScript is what keeps that shape intact across five writers and seven readers. And the analyzer we're building this sprint is the same idea pointed at Postgres: parse, check, report structured diagnostics, never mutate. We use a type checker, we ship type checkers to users, and we're building one — TypeScript isn't a tool we picked; it's the discipline the whole product is made of.
