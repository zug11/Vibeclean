# VibeDB Schema Control Hardening Specification

> **Status on publication — 12 November 2026: historical architectural proposal; partially superseded.** The original draft is preserved below for its detailed fidelity, transformation, persistence, migration, and verification requirements. Descriptions of what is “current” refer to that draft's inspection, not a fresh audit or a statement that the proposed work is shipped.
>
> **Current precedence:** the [product roadmap](IMPLEMENTATION_PLAN.md) and [focused Phase 1 plan](PHASE_1_SCHEMA_HISTORY_AND_IR_DDL.md) define the active direction. They keep the existing authoritative `TableNode[]` / `SchemaDocument` representation for near-term work. This draft's replacement with `SchemaIR` requires a separate decision, migration design, and qualification; its internal Phase 1 is not the focused Phase 1 document.
>
> **Superseded hosted-service assumptions:** the server-side connection vault, product-account authentication, and AI-credit/billing proposals in sections 40–42 and their later checklist references are not requirements of the local-first, BYOK roadmap. Privileged administration belongs behind the guarded desktop bridge, with native credential custody and customer-database permissions. Product accounts, billing, and payments are outside the active scope. Database access controls remain necessary.
>
> **Release scope:** the original “production beta” checklist is an aspirational draft, not a release certification. Exact direct Supabase sync remains limited to its explicitly qualified envelope; retaining unsupported SQL does not authorize deploying it. Current data-ownership rules also supersede any suggestion of routinely persisting sampled customer rows. This publication adds documentation only.


**Status:** Draft  
**Scope:** Postgres and Supabase control-plane hardening  
**Primary objective:** Evolve VibeDB from a feature-rich advanced alpha into a trustworthy database architecture control layer without discarding the existing product or rewriting it from scratch.

---

## 1. Purpose

VibeDB already has the shape of a mature database architecture product: an AI generation pipeline, visual schema editor, deterministic validation layer, multiple exporters, Supabase import, schema diffing, migration generation, deployment, project persistence and post-deployment verification.

The next stage is not primarily additional feature development. It is **establishing semantic fidelity, trustworthy state management, safe credential custody, verifiable transformations and production-grade engineering controls** around the features that already exist.

The central architectural change is to separate the current `TableNode[]` representation into:

1. A canonical semantic database representation.
2. A canvas and presentation projection.
3. Schema snapshots and synchronization state.
4. Optional imported or sampled row data.
5. Transformation history and provenance.

The current `TableNode` mixes database semantics, UI state and imported data in one object. It includes column and constraint information alongside `x`, `y`, `isReordering`, `dataRows` and imported row structures.

The goal is not to discard `TableNode`. It should initially remain the canvas-facing model while a more exact `SchemaIR`becomes the authoritative semantic representation underneath it.

---

## 2. Target product invariant

VibeDB should eventually be able to make the following guarantee:

> A database architecture imported, generated, edited, validated, versioned, diffed, deployed and re-imported through VibeDB retains its intended semantics unless the user explicitly approves a semantic change.

This requires six properties:

1. **Representational completeness:** the internal representation can express the database concepts VibeDB claims to manage.
2. **Lossless transformation:** import and export paths preserve represented meaning.
3. **No silent mutation:** advisory logic cannot silently rewrite user-authored or imported architecture.
4. **Authoritative state separation:** desired state, observed database state and canvas presentation are distinct.
5. **Verifiability:** tests and CI defend the important invariants.
6. **Secure execution:** credentials, AI use and database operations are authenticated, authorised, scoped and auditable.

---

# Part I — Canonical Schema Representation

## 3. Replace `TableNode[]` as the semantic source of truth

`TableNode[]` should become a **canvas projection**, not the sole canonical database model.

The new architecture should be:

```
                         SchemaIR
                            │
          ┌─────────────────┼──────────────────┐
          │                 │                  │
    CanvasProjection   SQL serializers   Database adapters
          │                 │                  │
       TableNode[]       Postgres DDL      Supabase/Postgres
```

The browser may continue rendering `TableNode[]`, but all semantic operations should eventually pass through `SchemaIR`.

That includes:

- validation;
- SQL import;
- database introspection;
- AI generation;
- schema comparison;
- migration planning;
- deployment;
- Supabase synchronization;
- Prisma, Drizzle and GraphQL export;
- schema version history.

---

## 4. Introduce a versioned document envelope

Every persisted schema should have an explicit format version.

```
interface SchemaDocument {
  formatVersion: 2;
  documentId: string;
  dialect: {
    name: "postgres";
    version?: string;
  };
  objects: SchemaObject[];
  metadata: SchemaDocumentMetadata;
}
```

The metadata should include:

```
interface SchemaDocumentMetadata {
  createdAt: string;
  updatedAt: string;
  title?: string;
  description?: string;
  canonicalHash: string;
}
```

This version is different from the IndexedDB object-store version. The current persistence model has `DB_VERSION = 1`, but its persisted schema payload does not have its own semantic schema version.

### Required behaviour

- Every saved project includes a `formatVersion`.
- Loading an older project runs explicit migrations.
- Migrations are deterministic and independently tested.
- A migration failure never partially overwrites the original project.
- Before migration, the original payload is retained as a recovery copy.
- Unsupported future versions fail safely rather than being interpreted as the current structure.

---

## 5. Give every semantic object a stable identity

Names must not be the only identity of a table, column, constraint or index.

```
type ObjectId = string;

interface SchemaObjectBase {
  id: ObjectId;
  kind: string;
  name: QualifiedName;
  provenance?: Provenance;
}
```

Stable identities are necessary because name-based comparison cannot reliably distinguish:

```
rename users → customers
```

from:

```
DROP users
CREATE customers
```

A stable identity allows VibeDB to understand that the object remained semantically continuous while its name changed.

### Identity rules

- IDs survive canvas movement, renaming, saving and reloading.
- Child object IDs survive table renames.
- Importers generate IDs once, then preserve them through subsequent reconciliation.
- Live-database metadata such as Postgres OIDs may be retained as observed-source references, but should not become the portable canonical identity because OIDs can change after dump, restore or recreation.
- When importing an externally changed database, VibeDB should use matching heuristics only to propose identity correspondence. Ambiguous matches require user review.

---

## 6. Make namespaces first-class

A database object should use a qualified name rather than a plain string:

```
interface QualifiedName {
  schema: string;
  name: string;
}
```

For example:

```
{
  schema: "billing",
  name: "invoices"
}
```

This prevents ambiguity between:

```
public.users
auth.users
analytics.users
```

The IR must support:

- multiple Postgres schemas;
- schema-qualified foreign-key targets;
- schema-qualified custom types;
- schema-qualified functions;
- quoted and case-sensitive identifiers;
- namespace creation and removal;
- default search-path metadata without relying on it for object identity.

### Acceptance criterion

VibeDB must be able to import, represent and export two tables with the same unqualified name in different schemas without collision or silent renaming.

---

## 7. Replace string types with structured type references

The current `Column.type: string` is convenient for the UI but insufficient for exact database representation.

A structured model should distinguish built-in, custom and composite type forms:

```
type PostgresTypeRef =
  | {
      kind: "builtin";
      name:
        | "uuid"
        | "text"
        | "varchar"
        | "integer"
        | "bigint"
        | "numeric"
        | "boolean"
        | "timestamp"
        | "timestamptz"
        | "json"
        | "jsonb"
        | string;
      modifiers?: TypeModifier[];
    }
  | {
      kind: "named";
      name: QualifiedName;
      objectId?: ObjectId;
    }
  | {
      kind: "array";
      elementType: PostgresTypeRef;
      dimensions?: number;
    }
  | {
      kind: "opaque";
      sql: string;
    };
```

Type modifiers should support concepts such as:

```
type TypeModifier =
  | { kind: "length"; value: number }
  | { kind: "precisionScale"; precision: number; scale?: number }
  | { kind: "timezone"; enabled: boolean };
```

### Why this is necessary

The following are not safely interchangeable strings:

```
varchar(80)
varchar
numeric(18, 4)
numeric
public.currency_code
currency_code
text[]
public.order_status[]
timestamp
timestamp without time zone
```

Structured types allow validation, comparison and serialization without parsing arbitrary strings repeatedly.

### Compatibility strategy

For the transition period:

```
function legacyTypeToTypeRef(type: string): PostgresTypeRef;
function typeRefToDisplayString(type: PostgresTypeRef): string;
```

The canvas can continue displaying a string while the canonical IR stores the structured form.

---

## 8. Model columns as semantic objects

```
interface ColumnIR extends SchemaObjectBase {
  kind: "column";
  tableId: ObjectId;
  ordinal: number;
  type: PostgresTypeRef;
  nullable: boolean;
  default?: SqlExpression;
  generated?: GeneratedColumnDefinition;
  identity?: IdentityDefinition;
  collation?: QualifiedName;
  comment?: string;
}
```

Column order should be represented explicitly through `ordinal`, not inferred solely from array location.

Defaults should not be stored as loosely interpreted generic constraint values. They should be represented as expressions:

```
interface SqlExpression {
  canonicalSql: string;
  sourceSql?: string;
  ast?: unknown;
}
```

The AST may be optional initially, but the original SQL must be preserved when VibeDB cannot fully structure an expression.

---

## 9. Make primary keys first-class

Primary keys should no longer be encoded as generic column constraints such as:

```
{ type: "primary" }
```

They should become table-level objects:

```
interface PrimaryKeyIR extends SchemaObjectBase {
  kind: "primaryKey";
  tableId: ObjectId;
  columnIds: ObjectId[];
  deferrable: boolean;
  initiallyDeferred: boolean;
}
```

This naturally supports:

- single-column primary keys;
- composite primary keys;
- named primary-key constraints;
- ordered key columns;
- deferrability;
- preservation of imported constraint names.

### Acceptance criterion

The IR must represent the following without approximation:

```
CONSTRAINT order_items_pkey
PRIMARY KEY (order_id, line_number)
DEFERRABLE INITIALLY DEFERRED
```

---

## 10. Make unique constraints first-class

Unique constraints are not identical to unique indexes and should not be collapsed into generic column metadata.

```
interface UniqueConstraintIR extends SchemaObjectBase {
  kind: "uniqueConstraint";
  tableId: ObjectId;
  columnIds: ObjectId[];
  deferrable: boolean;
  initiallyDeferred: boolean;
  nullsNotDistinct?: boolean;
}
```

The model must preserve the difference between:

```
CONSTRAINT users_email_key UNIQUE (email)
```

and:

```
CREATE UNIQUE INDEX users_email_active_idx
ON users (email)
WHERE deleted_at IS NULL;
```

The former is a constraint. The latter is an index with a predicate.

---

## 11. Make foreign keys first-class and pair columns explicitly

Foreign keys should not live primarily as flags on individual columns.

The target structure should be:

```
interface ForeignKeyIR extends SchemaObjectBase {
  kind: "foreignKey";
  tableId: ObjectId;
  referencedTableId: ObjectId;
  columnPairs: Array<{
    localColumnId: ObjectId;
    referencedColumnId: ObjectId;
  }>;
  matchType: "SIMPLE" | "FULL" | "PARTIAL";
  onDelete: ReferentialAction;
  onUpdate: ReferentialAction;
  deferrable: boolean;
  initiallyDeferred: boolean;
  validated: boolean;
}

type ReferentialAction =
  | "NO ACTION"
  | "RESTRICT"
  | "CASCADE"
  | "SET NULL"
  | "SET DEFAULT";
```

This structure supports composite relationships:

```
FOREIGN KEY (tenant_id, customer_number)
REFERENCES customers (tenant_id, customer_number)
```

It also prevents a multi-column foreign key from being mistakenly interpreted as two independent relationships.

### Transitional compatibility

The canvas may continue showing per-column foreign-key indicators, but those indicators must be derived from `ForeignKeyIR`. They must not remain the canonical definition.

---

## 12. Make CHECK constraints first-class

```
interface CheckConstraintIR extends SchemaObjectBase {
  kind: "checkConstraint";
  tableId: ObjectId;
  expression: SqlExpression;
  noInherit: boolean;
  validated: boolean;
}
```

CHECK constraints must retain:

- their exact names;
- their expressions;
- quoting;
- schema-qualified function references;
- `NOT VALID`;
- `NO INHERIT`;
- source provenance.

Most importantly, a CHECK generated by AI or suggested by a domain module must be distinguishable from a CHECK imported from the user's database.

---

## 13. Model indexes separately from constraints

```
interface IndexIR extends SchemaObjectBase {
  kind: "index";
  tableId: ObjectId;
  method: string;
  unique: boolean;
  elements: IndexElement[];
  includedColumnIds?: ObjectId[];
  predicate?: SqlExpression;
  storageParameters?: Record<string, string>;
  tablespace?: string;
}

type IndexElement =
  | {
      kind: "column";
      columnId: ObjectId;
      order?: "ASC" | "DESC";
      nulls?: "FIRST" | "LAST";
      opclass?: QualifiedName;
      collation?: QualifiedName;
    }
  | {
      kind: "expression";
      expression: SqlExpression;
      order?: "ASC" | "DESC";
      nulls?: "FIRST" | "LAST";
      opclass?: QualifiedName;
    };
```

This is necessary for:

- composite indexes;
- expression indexes;
- partial indexes;
- covering indexes using `INCLUDE`;
- operator classes;
- GIN and GiST indexes;
- sort order;
- collation;
- index predicates.

---

## 14. Preserve unsupported syntax instead of dropping it

VibeDB does not need to structurally understand every Postgres feature immediately. It must, however, avoid silently deleting constructs it does not understand.

Introduce an opaque fallback:

```
interface OpaqueSchemaObject extends SchemaObjectBase {
  kind: "opaque";
  objectType: string;
  sourceSql: string;
  dependencies?: ObjectId[];
  warning: string;
}
```

The policy should be:

```
Understand it structurally
        OR
preserve it opaquely
        BUT NEVER
silently discard it
```

Unsupported syntax should produce a diagnostic such as:

> VibeDB preserved this exclusion constraint but cannot yet edit it visually.

That is safer than either pretending to support it or removing it during round-trip export.

---

## 15. Separate canvas layout from schema semantics

Create a separate presentation document:

```
interface CanvasProjection {
  schemaDocumentId: string;
  nodes: Record<ObjectId, CanvasNodeState>;
  viewport?: CanvasViewport;
}

interface CanvasNodeState {
  objectId: ObjectId;
  x: number;
  y: number;
  width?: number;
  collapsed?: boolean;
  selectedTab?: string;
}

interface CanvasViewport {
  x: number;
  y: number;
  zoom: number;
}
```

The semantic schema must remain unchanged when:

- a table moves;
- the user zooms;
- a node is collapsed;
- the layout algorithm runs;
- the sidebar is opened;
- selection changes.

This separation allows the same schema to have different visual layouts without creating semantic database versions.

---

## 16. Separate imported or sampled row data

`dataRows` and `importedData` should not live inside semantic table objects.

Use a separate representation:

```
interface DataSampleSet {
  id: string;
  schemaDocumentId: string;
  tableId: ObjectId;
  columns: ObjectId[];
  rows: unknown[][];
  source: "csv" | "database" | "mock" | "manual";
  createdAt: string;
  persistence: "memory" | "local" | "cloud";
}
```

This prevents:

- row samples changing the schema hash;
- large datasets bloating every schema snapshot;
- database architecture exports accidentally containing row data;
- sensitive row data being treated as ordinary schema metadata;
- schema version history duplicating sample data.

The default for live-database samples should be memory-only unless the user explicitly chooses to persist them.

---

## 17. Add provenance to every object and operation

```
interface Provenance {
  origin:
    | "user"
    | "ai-generated"
    | "ai-suggested"
    | "sql-import"
    | "database-introspection"
    | "migration"
    | "system";
  createdAt: string;
  operationId?: string;
  sourceSnapshotId?: string;
  confidence?: number;
}
```

Provenance should answer:

- Did the user write this constraint?
- Did VibeDB import it?
- Did AI generate it?
- Did a deterministic rule add it?
- Was it accepted from a suggestion?
- Did it arrive through external database drift?

This is essential for trustworthy AI database management.

---

# Part II — Transformation Integrity

## 18. Split the current compiler into three responsibilities

The current compiler should no longer operate as one broad mutating pipeline.

It should become:

```
Analyzer
    ↓
Diagnostics
    ↓
Optional Fix Planner
    ↓
Explicit Patch Application
```

### 18.1 Analyzer

A pure function:

```
analyzeSchema(schema: SchemaDocument): Diagnostic[];
```

It must never mutate the schema.

### 18.2 Fix planner

```
planFixes(
  schema: SchemaDocument,
  diagnostics: Diagnostic[],
): SchemaPatch[];
```

A fix includes:

- affected object IDs;
- before state;
- after state;
- reason;
- risk level;
- provenance;
- whether user approval is required.

### 18.3 Patch application

```
applySchemaPatch(
  schema: SchemaDocument,
  patch: SchemaPatch,
): SchemaDocument;
```

Patch application should be deterministic, auditable and undoable.

---

## 19. Establish explicit transformation modes

### Faithful mode

Used for:

- imported SQL;
- imported Supabase schemas;
- manually authored schemas;
- export;
- diff;
- deployment.

Rules:

- no inferred columns;
- no silent CHECK injection;
- no silent timestamp columns;
- no silent naming changes;
- no semantic mutation;
- diagnostics only.

### Assisted mode

Used when the user explicitly asks VibeDB to improve or repair a schema.

Rules:

- propose patches;
- display exact before/after;
- classify risk;
- require approval for semantic changes.

### Generative mode

Used when AI is creating a new schema from a prompt.

Rules:

- defaults and architectural conventions may be synthesized;
- every synthesized object receives AI provenance;
- deterministic validation follows generation;
- the system must still report unresolved assumptions.

This separation resolves the current problem in which generative or advisory rules can operate on user-driven paths. The repository specification currently documents silent CHECK and standard-column injection and identifies compiler mutation on user-driven paths as an architectural hotspot.

---

## 20. Replace regex SQL parsing with an AST-based parser

The current SQL import path must be replaced by a parser capable of representing Postgres DDL structurally.

The parser must support, at minimum:

- `CREATE SCHEMA`;
- `CREATE TABLE`;
- quoted identifiers;
- schema-qualified names;
- column order;
- structured data types;
- defaults;
- primary keys;
- composite primary keys;
- unique constraints;
- foreign keys;
- composite foreign keys;
- `ON DELETE`;
- `ON UPDATE`;
- deferrability;
- CHECK constraints;
- indexes;
- partial indexes;
- expression indexes;
- enums;
- comments;
- functions and triggers already within VibeDB’s claimed scope.

The current repository specification states that the regex parser drops `UNIQUE`, `CHECK`, indexes and `ON DELETE`.

### Parser rule

When the parser encounters unsupported SQL:

1. Preserve it as an opaque object.
2. Emit a diagnostic.
3. Prevent VibeDB from claiming a fully lossless editable import.
4. Do not remove it from subsequent exports.

---

## 21. Build a deterministic serializer

The serializer should be a pure function:

```
serializePostgresSchema(
  schema: SchemaDocument,
  options: SerializationOptions,
): string;
```

It should provide:

- stable object ordering;
- stable formatting;
- correct quoting;
- schema qualification;
- deterministic constraint naming where VibeDB owns the name;
- preservation of imported names;
- cycle-safe foreign-key output;
- separate full-schema and migration modes.

Running the serializer twice on an unchanged IR should produce byte-for-byte equivalent output, excluding explicitly configured formatting differences.

---

## 22. Add a canonicalization layer

Canonicalization is required for meaningful comparisons.

It should normalize representational differences that do not change semantics, such as:

- unquoted lowercase identifier equivalence;
- explicit `public` namespace versus configured default namespace;
- equivalent built-in type aliases where safe;
- stable object ordering;
- stable constraint ordering;
- whitespace in expressions where parser semantics are available.

Canonicalization must not:

- rename user objects;
- add constraints;
- delete expressions;
- convert types based on preference;
- change nullability;
- add columns;
- infer foreign keys.

---

## 23. Establish round-trip invariants

The principal invariant should be:

```
SQL₀
 ↓ parse
IR₀
 ↓ serialize
SQL₁
 ↓ parse
IR₁

canonical(IR₀) == canonical(IR₁)
```

A second invariant should cover database introspection:

```
database₀
 ↓ introspect
IR₀
 ↓ deploy to clean Postgres
database₁
 ↓ introspect
IR₁

canonical(IR₀) == canonical(IR₁)
```

Round-trip tests should include:

- composite keys;
- cyclic relationships;
- multiple schemas;
- quoted identifiers;
- custom enums;
- arrays;
- numeric modifiers;
- defaults containing functions;
- CHECK expressions;
- partial indexes;
- expression indexes;
- deferrable constraints;
- renamed objects;
- unsupported opaque objects.

No release should claim lossless control until this suite passes.

---

## 24. Handle foreign-key cycles without throwing

Schema creation must separate table creation from relationship creation when cycles exist.

For example:

```
Pass 1: create tables and columns
Pass 2: create primary and unique constraints
Pass 3: create foreign-key constraints
Pass 4: create indexes, triggers and dependent objects
```

A cycle such as:

```
employees.manager_id → employees.id
departments.head_id → employees.id
employees.department_id → departments.id
```

must produce valid dependency-ordered DDL rather than causing the topological sort to throw.

The current repository specification identifies FK cycles as an exporter failure case.

---

# Part III — Diffing, Migrations and Live Synchronization

## 25. Replace two-way comparison with explicit state roles

VibeDB should represent:

```
interface ProjectSchemaState {
  desired: SchemaSnapshot;
  observed?: SchemaSnapshot;
  baseline?: SchemaSnapshot;
}
```

### Desired state

What the user and VibeDB intend the database to become.

### Observed state

What VibeDB most recently introspected from the live database.

### Baseline state

The last state confirmed as shared by VibeDB and the live database.

This formalises the control-plane model:

```
baseline
  ↙   ↘
desired observed
```

---

## 26. Introduce versioned schema snapshots

```
interface SchemaSnapshot {
  id: string;
  projectId: string;
  schema: SchemaDocument;
  capturedAt: string;
  source:
    | "manual-save"
    | "database-introspection"
    | "before-deploy"
    | "after-deploy"
    | "external-drift";
  parentSnapshotId?: string;
  canonicalHash: string;
}
```

Snapshots should be immutable.

A project points to current snapshots rather than mutating historical objects in place.

---

## 27. Improve the diff engine

The diff engine should produce semantic operations:

```
type SchemaOperation =
  | CreateObjectOperation
  | DropObjectOperation
  | RenameObjectOperation
  | AlterColumnTypeOperation
  | AlterNullabilityOperation
  | AddConstraintOperation
  | DropConstraintOperation
  | AddIndexOperation
  | DropIndexOperation
  | ReplaceExpressionOperation;
```

Every operation should include:

- object IDs;
- before and after definitions;
- dependencies;
- risk classification;
- reversibility;
- generated migration SQL;
- preconditions;
- user-facing explanation.

### Required improvements

- Compare by stable IDs where available.
- Detect renames instead of treating them as drop and recreate.
- Compare schema-qualified names.
- Understand composite constraints.
- Compare expression and partial indexes.
- Distinguish unique constraints from unique indexes.
- Avoid `DROP ... CASCADE` as a default migration strategy.
- Report dependent objects before destructive changes.
- Require explicit confirmation for data-destructive operations.

---

## 28. Add migration risk classifications

```
type MigrationRisk =
  | "safe"
  | "requires-lock"
  | "requires-backfill"
  | "potential-data-loss"
  | "destructive"
  | "unsupported";
```

Examples:

- Add nullable column: `safe`.
- Add `NOT NULL` without default to populated table: `requires-backfill`.
- Change text to integer: `potential-data-loss`.
- Drop column: `destructive`.
- Drop table with dependants: `destructive`.
- Rename table: normally `safe`, provided identity is known.
- Add large-table index: `requires-lock` unless an appropriate online strategy is selected.

---

## 29. Add preconditions to deployment plans

A migration should be generated against a known observed state.

Before execution, VibeDB must confirm:

```
current live schema hash == migration source hash
```

If not, deployment stops and VibeDB re-introspects.

This prevents applying a migration generated against stale state.

---

## 30. Implement three-way Supabase reconciliation

Before synchronising:

```
B = last confirmed baseline
D = current desired VibeDB schema
L = newly introspected live Supabase schema
```

Calculate:

```
VibeDB changes   = diff(B, D)
external changes = diff(B, L)
```

Then classify:


| VibeDB changed | Live changed             | Action                                            |
| -------------- | ------------------------ | ------------------------------------------------- |
| No             | No                       | Already synchronised                              |
| Yes            | No                       | Prepare migration from live to desired            |
| No             | Yes                      | Refresh desired state or ask user to accept drift |
| Yes            | Yes, disjoint objects    | Merge and review                                  |
| Yes            | Yes, overlapping objects | Conflict review                                   |


The current implementation creates a Supabase baseline only through the linked Supabase import path, compares it with the canvas and generates sync SQL.

It should be extended to re-introspect **before** migration generation, not only after a VibeDB-initiated deployment.

---

## 31. Add continuous drift detection only after secure credential custody

The event-driven version should use database DDL events or a supported provider event as an invalidation signal:

```
external DDL
   ↓
signed change notification
   ↓
VibeDB reconciliation queue
   ↓
authoritative metadata introspection
   ↓
new observed snapshot
   ↓
drift classification
```

The notification should not be treated as the authoritative schema payload. It should only indicate that VibeDB must introspect again.

Polling can be used as a fallback where events are unavailable.

Continuous background reconciliation must not ship until connection credentials can be held securely outside the browser.

---

# Part IV — Persistence, State and Code Structure

## 32. Migrate projects from `TableNode[]` to the versioned envelope

Recommended migration sequence:

### Stage 1: Introduce adapters

```
tableNodesToSchemaDocument(nodes: TableNode[]): SchemaDocument;
schemaDocumentToTableNodes(
  schema: SchemaDocument,
  canvas: CanvasProjection,
): TableNode[];
```

### Stage 2: Shadow mode

For every operation:

1. Run the existing `TableNode[]` path.
2. Run the new `SchemaIR` path.
3. Compare outputs.
4. Log discrepancies without affecting users.

### Stage 3: Dual persistence

Temporarily save:

```
{
  legacyDefinition,
  schemaDocument,
  canvasProjection
}
```

### Stage 4: Canonical cut-over

Make `SchemaDocument` authoritative and generate `TableNode[]` for rendering.

### Stage 5: Remove legacy semantic writes

UI actions issue schema commands or patches rather than directly mutating semantic `TableNode` fields.

---

## 33. Move semantic logic out of React components

The main page is currently approximately 246 KB and the repository specification describes it as a roughly 4,800-line monolith containing canvas behaviour, history, SQL parsing, AI orchestration, project loading, compiler calls, deployment and sync.

The target package boundaries should be:

```
src/schema-core/
  IR types
  validation
  canonicalization
  patches
  snapshots

src/schema-postgres/
  SQL parser
  serializer
  metadata introspection
  Postgres-specific validation

src/schema-diff/
  semantic comparison
  rename detection
  risk classification

src/schema-migrations/
  migration planning
  dependency ordering
  SQL generation

src/schema-sync/
  baseline/desired/observed reconciliation
  conflict classification

src/canvas/
  visual projection
  layout
  selection
  interaction state

src/ai/
  AI request orchestration
  output parsing
  provenance assignment

src/security/
  connection abstractions
  auth-aware API clients
```

React components should orchestrate these modules, not contain their core semantics.

---

## 34. Replace direct state mutation with commands or reducers

Schema-changing UI operations should use explicit commands:

```
type SchemaCommand =
  | { type: "renameTable"; tableId: ObjectId; name: QualifiedName }
  | { type: "addColumn"; tableId: ObjectId; column: ColumnIR }
  | { type: "deleteColumn"; columnId: ObjectId }
  | { type: "applyPatch"; patch: SchemaPatch };
```

A reducer can then return:

```
interface SchemaCommandResult {
  nextSchema: SchemaDocument;
  inverseCommand?: SchemaCommand;
  diagnostics: Diagnostic[];
}
```

This gives undo and redo a semantic basis and helps eliminate stale-closure history bugs.

---

## 35. Fix asynchronous project-loading races

Every project load should have:

- a request identity;
- cancellation or invalidation;
- a current-project check before state application;
- explicit loading and failure states.

A response from an old project load must never overwrite a newly selected or newly created project.

---

# Part V — Verification and Quality Gates

## 36. Enable TypeScript as an actual correctness gate

The current configuration has:

- `strict: false`;
- `noImplicitAny: false`;
- unused checks disabled;
- no dedicated `typecheck` script.

The package scripts currently include build, lint and test, but no typecheck command.

Add:

```
{
  "scripts": {
    "typecheck": "tsc -p tsconfig.app.json --noEmit",
    "verify": "npm run typecheck && npm run lint && npm run test && npm run build"
  }
}
```

Recommended migration:

1. Fix existing type errors.
2. Enable `noImplicitAny`.
3. Enable `strictNullChecks`.
4. Enable full `strict`.
5. Re-enable unused-variable and unused-parameter enforcement with narrow exceptions.
6. Prevent new suppressions without an explanatory comment.

`vite build` should not be treated as type validation.

---

## 37. Build an invariant-focused test suite

The current real unit-test surface is extremely small. `schema-diff.test.ts` contains two focused cases: adding a column and adding a table.

The test suite should be organised around the risks VibeDB introduces.

### 37.1 IR tests

- stable IDs survive rename;
- composite primary keys;
- composite foreign keys;
- unique constraints versus unique indexes;
- multiple schemas;
- structured types;
- opaque object preservation;
- semantic hash stability;
- project format migrations.

### 37.2 Parser tests

Golden SQL fixtures covering:

- quoted names;
- custom schemas;
- defaults;
- CHECK expressions;
- all referential actions;
- partial and expression indexes;
- composite constraints;
- functions and triggers;
- unsupported syntax preservation.

### 37.3 Round-trip property tests

```
parse → serialize → parse
```

must preserve canonical semantic equality.

### 37.4 Diff tests

- rename detection;
- table additions and removals;
- column changes;
- constraint changes;
- index changes;
- namespace movement;
- ambiguous rename refusal;
- destructive risk classification.

### 37.5 Migration integration tests

Run generated DDL against an ephemeral Postgres instance, introspect the result and compare it with the intended IR.

### 37.6 Compiler and advisory tests

- faithful mode never mutates;
- diagnostics are stable;
- accepted patches produce expected changes;
- rejected patches leave the schema unchanged;
- AI output never bypasses deterministic validation.

### 37.7 Sync tests

- desired-only change;
- observed-only drift;
- disjoint concurrent changes;
- conflicting concurrent changes;
- stale migration precondition;
- post-deploy re-introspection;
- failed deployment leaves baseline unchanged.

### 37.8 Security tests

- unauthenticated Edge Function calls fail;
- one tenant cannot access another tenant’s connection;
- expired credentials fail safely;
- invalid webhook signatures are rejected;
- arbitrary external URLs cannot be used for SSRF;
- query endpoints cannot execute mutations;
- rate and quota limits are enforced.

---

## 38. Add continuous integration

Every pull request should run:

```
dependency install
    ↓
typecheck
    ↓
lint
    ↓
unit tests
    ↓
round-trip fixtures
    ↓
Postgres integration tests
    ↓
production build
```

No merge should occur if a required check fails.

---

## 39. Protect the main branch

The current `main` branch is unprotected and has no required status checks.

Enable:

- pull requests required;
- required CI checks;
- stale approvals dismissed after material changes;
- no direct pushes;
- branch required to be up to date before merge;
- protected deployment environments for production secrets;
- separate preview and production deployments.

---

# Part VI — Security Hardening

## 40. Remove service-role credentials from browser persistence

The target Supabase service-role key is currently read from and saved to browser `localStorage`.

This must be removed before production use.

### Immediate transitional option

- Keep the key only in memory.
- Clear it on refresh, logout and tab close.
- Do not persist it.
- Display that the connection is session-only.

### Production option

Store credentials in a server-side connection vault:

```
interface StoredConnection {
  id: string;
  ownerId: string;
  projectReference: string;
  encryptedCredential: string;
  encryptionKeyVersion: string;
  createdAt: string;
  rotatedAt?: string;
}
```

Requirements:

- authenticated ownership;
- encryption at rest;
- separate key management;
- credential rotation;
- revocation;
- no credentials returned to the browser;
- no credentials in logs;
- audit trail of every use.

The preferred long-term integration should use a dedicated, least-privilege database role or narrowly scoped installed function rather than a broadly privileged service-role credential.

---

## 41. Authenticate every protected Edge Function

The current Supabase configuration disables automatic JWT verification for all listed Edge Functions, including `vibedb-ai` and `vibedb-deploy`.

The target policy should be:

- `verify_jwt = true` for user-initiated application functions.
- Public webhook endpoints remain unauthenticated only at the transport layer and must verify cryptographic provider signatures.
- Every request resolves the authenticated user before any AI or database action.
- Every project and connection is authorised against that user.
- Administrative actions require explicit elevated permissions.

---

## 42. Enforce AI credits and quotas atomically

The AI handler defines `CREDIT_COSTS`, but the inspected execution path proceeds toward model selection and provider invocation without a visible credit-debit operation.

The production flow should be:

```
authenticate
    ↓
authorise project
    ↓
validate request
    ↓
reserve credits atomically
    ↓
call model
    ↓
finalise usage
```

Requirements:

- database transaction or atomic RPC;
- no negative balances;
- idempotency key per AI operation;
- rate limiting;
- maximum concurrency per account;
- provider usage metadata;
- refund or release reserved credits on defined failures;
- separate limits for free, paid and enterprise accounts.

---

## 43. Validate all Edge Function inputs

Use explicit schemas for every request type.

Validation must cover:

- action type;
- prompt length;
- model allow-list;
- strategy allow-list;
- SQL length;
- project ownership;
- target URL;
- connection identifier;
- statement count;
- row limits;
- timeout limits.

Unknown fields should not silently alter execution.

---

## 44. Prevent SSRF and arbitrary proxy use

Any endpoint accepting a user-supplied project URL must verify that the destination is allowed.

Requirements:

- parse URLs rather than compare strings;
- HTTPS only;
- reject localhost;
- reject private, loopback and link-local network ranges;
- restrict accepted hosts to supported Supabase project domains unless a separate verified direct-database connection mode is used;
- do not follow arbitrary redirects;
- set strict connection and response-size limits.

---

## 45. Replace prefix-based “read-only SQL” checks

Blocking mutations by checking whether SQL starts with `INSERT`, `UPDATE`, `DELETE`, `DROP`, `CREATE`, `ALTER` or `TRUNCATE` is not a sufficient security boundary.

The secure path should use:

- SQL parsing;
- an allow-list of permitted statement types;
- a database role with read-only privileges;
- read-only transactions;
- statement timeout;
- row limit;
- response-size limit;
- no access to system secrets;
- no security-definer function that can be repurposed for arbitrary execution.

A `SELECT` endpoint should not possess the privileges required to perform DDL.

---

## 46. Restrict CORS

Production Edge Functions should not use unrestricted `Access-Control-Allow-Origin: *` for authenticated, credential-bearing operations.

Use an explicit allow-list for:

- production VibeDB domain;
- preview domains where necessary;
- localhost only in development.

---

## 47. Add an immutable audit trail

Every control-plane action should record:

```
interface ControlPlaneAuditEvent {
  id: string;
  actorId: string;
  projectId: string;
  connectionId?: string;
  action: string;
  inputSnapshotId?: string;
  outputSnapshotId?: string;
  operationIds?: string[];
  status: "started" | "succeeded" | "failed";
  occurredAt: string;
  requestId: string;
  metadata?: Record<string, unknown>;
}
```

The log should include:

- imports;
- AI generations;
- accepted AI patches;
- schema edits;
- migration reviews;
- deployments;
- database introspections;
- detected drift;
- credential rotations;
- failed authorisation attempts.

It must never include raw secrets or sensitive row data.

---

# Part VII — Observability and Operational Reliability

## 48. Add operation identities and idempotency

Every AI request, deployment, sync and webhook should carry a unique operation ID.

Repeated requests using the same idempotency key must not:

- deploy the same migration twice;
- charge credits twice;
- create duplicate schema snapshots;
- apply the same webhook event twice.

---

## 49. Add structured telemetry

Track:

- AI request latency and failure rate;
- model and token usage;
- parser failures;
- opaque-object frequency;
- round-trip mismatches;
- migration planning failures;
- deployment duration;
- failed statements;
- drift detections;
- conflict frequency;
- credential failures;
- sync queue depth.

Logs should include request and operation IDs but exclude credentials, prompts containing secrets and database row values.

---

## 50. Make deployment state explicit

A deployment should have a durable record:

```
interface SchemaDeployment {
  id: string;
  projectId: string;
  connectionId: string;
  sourceSnapshotId: string;
  targetObservedSnapshotId: string;
  migrationPlanId: string;
  status:
    | "planned"
    | "approved"
    | "running"
    | "succeeded"
    | "partially-failed"
    | "failed"
    | "verification-failed";
  startedAt?: string;
  completedAt?: string;
}
```

The VibeDB baseline must update only after:

1. Migration execution succeeds.
2. The database is re-introspected.
3. The observed schema matches the expected result.

A partially successful deployment must never be labelled synchronised.

---

# Part VIII — Recommended Implementation Sequence

## Phase 0 — Stop additional semantic risk

- Add `typecheck`.
- Fix current TypeScript errors.
- Protect `main`.
- Prevent service-role persistence.
- Authenticate AI and deploy endpoints.
- Disable silent compiler mutation on user-driven paths.
- Add tests around current import, export and deployment behaviour before refactoring.

### Exit condition

The current product is no longer accumulating unverified semantic behaviour while the IR is redesigned.

---

## Phase 1 — Introduce `SchemaIR` v2

- Add the versioned document envelope.
- Add stable object IDs.
- Add qualified names and schemas.
- Add structured types.
- Add first-class PK, unique, FK, CHECK and index objects.
- Add opaque-object preservation.
- Add provenance.
- Separate canvas and row-data models.
- Build `TableNode[]` compatibility adapters.

### Exit condition

All existing VibeDB projects can be converted into `SchemaIR` and rendered back onto the existing canvas without losing currently represented information.

---

## Phase 2 — Replace transformation internals

- Split analyzer, fix planner and patch application.
- Introduce faithful, assisted and generative modes.
- Replace regex SQL parsing.
- Implement deterministic serialization.
- Handle FK cycles.
- Add canonicalization.
- Establish round-trip fixtures.

### Exit condition

Supported SQL can complete:

```
import → IR → export → import
```

without semantic difference.

Unsupported SQL is preserved and explicitly reported rather than dropped.

---

## Phase 3 — Rebuild diff and migration planning

- Diff by object identity.
- Add rename operations.
- Add migration risk classification.
- Add preconditions.
- Remove default `CASCADE` behaviour.
- Add composite constraint changes.
- Add migration integration tests.

### Exit condition

No destructive migration can be generated or executed without explicit classification and confirmation.

---

## Phase 4 — Complete the Supabase control loop

- Store desired, observed and baseline snapshots.
- Re-introspect before sync.
- Add three-way comparison.
- Detect external drift.
- Add conflict review.
- Verify after deployment.
- Add event-driven invalidation or polling only after credential security is complete.

### Exit condition

VibeDB cannot overwrite externally changed database architecture without detecting and presenting the conflict.

---

## Phase 5 — Complete security hardening

- Move all privileged credentials server-side.
- Add least-privilege connection roles.
- Enable JWT verification.
- Add per-project authorisation.
- Enforce AI credits.
- Add SSRF prevention.
- Replace SQL prefix checks.
- Restrict CORS.
- Add signed webhook validation.
- Add immutable audit logs.

### Exit condition

No unauthenticated user can consume AI resources, access another tenant’s connection, execute database operations or retrieve stored credentials.

---

## Phase 6 — Production verification

- Expand unit tests.
- Add parser and serializer golden fixtures.
- Add property-based round-trip tests.
- Add ephemeral Postgres integration tests.
- Add sync and conflict tests.
- Add end-to-end browser tests.
- Require all CI checks.
- Run security review and deployment-failure exercises.

### Exit condition

The central product claims are defended by automated verification rather than manual confidence.

---

# Part IX — Production Beta Definition of Done

VibeDB is ready to describe itself as a production-capable database control layer when all of the following are true:

- `SchemaIR` is the authoritative semantic model.
- Canvas layout and row data are separate from schema semantics.
- Every semantic object has stable identity and provenance.
- Multiple Postgres schemas are represented correctly.
- Types and constraints are structured rather than generic strings.
- Composite PKs and FKs are supported.
- Unsupported SQL is preserved rather than discarded.
- Faithful mode cannot silently mutate schemas.
- Parser and serializer round trips are verified.
- FK cycles produce valid DDL.
- Diffing detects renames and classifies destructive operations.
- Migration plans verify their source-state preconditions.
- Desired, observed and baseline states are distinct.
- Supabase drift is checked before deployment.
- Post-deployment introspection confirms the result.
- Persisted schemas have explicit format versions and tested migrations.
- TypeScript strictness is enabled.
- CI runs typecheck, lint, tests, integration tests and build.
- `main` is protected.
- Service-role or database credentials never persist in browser storage.
- Protected Edge Functions authenticate and authorise users.
- AI credits and rate limits are enforced atomically.
- SQL execution uses least privilege and parsed statement policies.
- Every schema-changing operation has an audit event.
- Failed or partially successful deployments cannot update the baseline.

---

## 51. Final architectural position

The required work is substantial, but it is **hardening and separation rather than reinvention**.

VibeDB already has the necessary product primitives:

```
AI intent
visual editing
schema representation
validation
diff
migration
deployment
introspection
```

The improvement programme turns them into a defensible control plane:

```
AI + human intent
        ↓
versioned semantic SchemaIR
        ↓
pure analysis and explicit patches
        ↓
desired / observed / baseline reconciliation
        ↓
risk-classified migration plan
        ↓
authenticated, least-privilege deployment
        ↓
authoritative re-introspection
        ↓
verified new baseline
```

The most important transition is therefore:

> From `TableNode[]` as a convenient all-purpose application object to a versioned, loss-aware and data-independent database architecture IR, with `TableNode[]` retained as its visual projection.

Once that foundation exists, version control, security, synchronization, AI governance, deterministic deployment and source-of-truth management become coherent properties of one architecture rather than separate features.
