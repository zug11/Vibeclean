# VibeDB Dev Plan — Phase 1: Schema History, Parallel Reading, and IR + DDL

> **Publication status — 12 November 2026:** This focused plan was written on 3 November 2026. It specifies proposed work, not a completed implementation. It supplements the [full product roadmap](IMPLEMENTATION_PLAN.md); generation completion and connection reliability remain the immediate priorities.
>
> Near-term work keeps the authoritative `TableNode[]` / `SchemaDocument` representation and extends its versioning and application boundaries. The broader model replacement in the [historical hardening proposal](SCHEMA_CONTROL_HARDENING_SPECIFICATION.md) is a separate architectural decision, not a prerequisite for this phase. Source paths refer to the audited development checkout, which is newer than the source currently published here. This publication adds documentation only.


**Schema history, parallel reading for chat, and proper IR + DDL support in generation and the assistant**

3 November 2026 · Planning only · Source checkout: audited development checkout

## 1. Purpose and relationship to the broader roadmap

Make the assistant able to establish what the schema was, what it proposed, what the application actually changed, and what the schema is now. Give larger requests a bounded parallel inspection pipeline. Extend generation and assistant proposals to cover both structured schema objects and SQL objects outside the structured model, with honest validation and deployment status.

This is a separate, self-contained implementation note to keep the original roadmap's context manageable. “Phase 1” names this focused foundation work; it does not claim implementation is complete or renumber the original roadmap.

Related roadmap: [VibeDB implementation plan — reliable generation, conversational imports, and customer-database dashboards](IMPLEMENTATION_PLAN.md).

The original priorities remain: generation must finish or provide a useful resolution; connections must work in the shipped application; conversational imports and customer-database dashboards follow. This note specifies three foundations that support those journeys. It does not duplicate the CSV/dashboard roadmap or authorize a broad rewrite.

**Authorization:** documentation only. No application coding, rebuilding, provider calls, deployment, or customer-database changes are authorized by creating this note.

### Product outcomes

- After an edit, the assistant can explain the actual before/after difference and distinguish a later manual change or undo.
- Repeating an already-satisfied request produces an explanation or no-op rather than duplicate work.
- Large-schema questions receive evidence-backed inspection with declared coverage, rather than a silently shortened context.
- A request for tables plus a function, trigger, or view accounts for every requested component.
- Unsupported automatic deployment still permits a retained, reviewable, exportable design with clear limitations.

## 2. Evidence baseline

These findings come from source inspection in this conversation. They are not installed-app reproductions of duplicate application, fresh release qualification, or live-model success-rate measurements.

| Area | Source behaviour | Work required |
|---|---|---|
| Chat context | Sends a semantic projection of the current document, including tables, enums, functions and DDL patches. Default context ceiling is 120,000 characters; oversized requests block. | Add scoped reading and explicit coverage; preserve exact evidence. |
| Change application | Clones a draft, validates it, checks source revisions, and commits through a shared boundary. Some duplicate/no-op checks exist. | Retain operation-linked before/proposed/confirmed states and feed outcomes back to chat. |
| History | Session undo/redo retains bounded in-memory snapshots. Project recovery copies serve a separate purpose. | Provide durable, addressable semantic versions and linked receipts across restart. |
| Conversation memory | Recent message text is sent; suggestion payloads and apply outcomes are omitted. Cards retain a revision and applied flag. | Supply structured outcomes and distinguish historic application from current state. |
| Capability contract | Chat advertises operations such as raw DDL and functions that the apply boundary rejects; some FK examples omit required identity fields. | Derive allowed proposals and examples from the actual typed capability contract. |
| Generation | Blueprint and workers accept table-focused JSON; strict response parsing rejects extra top-level SQL/function collections. | Introduce an explicit versioned envelope for structured objects, SQL artifacts and unresolved requirements. |
| Raw SQL | Editor reconciliation retains SQL and stable object identities; export includes pending patches. | Reuse and extend this machinery for AI-originated objects and dependency-aware assembly. |
| Verification | Exact executable proof and direct deployment cover a narrower envelope than export. Opaque functions/triggers/views are blocked. | Separate design acceptance, validation evidence and deployment eligibility without weakening the gate. |

Existing safeguards must remain. Better AI context supplements deterministic revision checks, validation, operation identity and database journals.

## 3. Shared state and operation contracts

### Four states for every attempted change

1. **Before:** immutable semantic document version used to inspect and plan.
2. **Proposed after:** exact candidate or a lossless, reconstructable change set.
3. **Confirmed after:** document version actually committed, or an explicit no-change outcome.
4. **Current:** latest document, potentially changed by manual edits, another operation, undo or redo.

A rejected proposal has no committed after-state. A proposed SQL artifact is not evidence of database execution. Local design revision and last verified live database state must be separately labelled.

### Representation

Keep authoritative TableNode[] metadata and the existing SchemaDocument foundation. Extend versioned records rather than replacing the whole application with a new IR.

Proposed conceptual records:

| Record | Required information |
|---|---|
| Semantic version | Durable version ID, project ID, parent version(s), schema-format version, structured objects, exact SQL-artifact references, semantic fingerprint |
| Change proposal | Proposal/request ID, source version, requested outcome, supported typed operations, read dependencies, proposed result/diff, unresolved assumptions |
| Operation receipt | Stable operation ID, proposal ID, before/proposed/confirmed references, actual changes, outcome, validation evidence, origin, timestamp |
| Read plan | Request/snapshot identity, scope, tasks, object/dependency coverage, exclusions, provider/model settings and budgets |
| Reader evidence | Exact object/version references, observed facts, proposed implications, unresolved facts, coverage and completion status |
| SQL artifact | Stable ID, exact object identity where known, SQL text, dependencies and uncertainty, provenance, verification/export/deployment classification |

These are design contracts, not a requirement to create these exact filenames or classes.

Separate semantic version, presentation/layout revision, project persistence revision and database-operation identity. Existing epoch/revision guards remain useful within a session, but they are not durable version identifiers across restarts.

### Persistence and integrity

Store the schema change and its receipt through one transactional durable commit, or an explicit recoverable prepared/committed protocol. Never display “saved” if only React state changed. A save failure preserves the candidate and last durable state.

Use shared immutable snapshots or checkpoints plus lossless diffs; do not copy the whole schema into every chat message. A fingerprint detects change but cannot reconstruct a historical schema. Referenced versions must remain resolvable.

Set bounded retention by version count and bytes. Preserve references needed by active proposals, recovery and unresolved operations. Compaction must not leave dangling history links; show the oldest reconstructable version honestly.

Migrate older valid project/history records with recovery copies. Reject unknown future formats. Do not manufacture before-state evidence for legacy edits. Integrate manual edits, SQL imports, accepted generation, chat changes and undo/redo through the same history boundary as each path is qualified.

New semantic history excludes layout, transient UI state, dataset rows, sampled rows and credentials. Existing legacy samples require the separate preservation/migration decision in the broader roadmap. Raw SQL can contain sensitive literals; source-sharing controls apply, and authored text must not be silently rewritten to sanitize it.

## 4. Workstream H — Before/after history and truthful chat feedback

### Implementation

- Capture the immutable semantic version and proposal before an application attempt.
- Apply typed operations to a candidate; validate and compare it to the source without mutating the source.
- Recheck revision immediately before commit. Stale proposals are retained for re-evaluation, not blindly replayed.
- Record exact affected object identities and before/after definitions. Include SQL bodies, names, signatures and dependencies where present.
- Give receipts distinct outcomes: applied, unchanged, blocked, failed and interrupted/pending recovery as appropriate. Keep execution status separate from whether an old result is still present.
- Represent undo/redo as traceable transitions. “Applied at version A; undone at B” preserves history while describing the current schema accurately.
- Use stable operation IDs to resolve repeat delivery. Before a newly requested equivalent operation, check supported exact postconditions against current state. Do not invent general SQL equivalence from lowercasing or regexes.
- Do not automatically reapply an action merely because it was undone. A new explicit user request can authorize a new transition.
- Include relevant receipts and the latest version in subsequent chat context. Do not rely on conversational prose as execution evidence.
- When one suggestion is applied, mark remaining same-revision suggestions as needing re-evaluation. Rebase only with demonstrated unchanged dependencies; otherwise request a fresh plan.
- Restore useful operation history after restart. Restore retained chat context with links to the same records, or rebuild a bounded activity digest from receipts; never claim missing conversation text was recovered.
- Display a compact result: “Added X to the local design”, “Already satisfied”, “Blocked because…”, and “Not deployed” where applicable. Expand for exact before/after details.

### Acceptance

Ask to add a column; apply; ask the same request again; manually alter it; undo; restart. The assistant identifies every actual transition, does not duplicate the column, and never reports an uncommitted proposal as applied. Simulate a failed durable save and two windows attempting the same source revision: preserve work and accept only the permitted commit.

## 5. Workstream R — Parallel schema reading for chat

### Reading pipeline

**Prompt → immutable snapshot and capability inventory → reading blueprint → bounded parallel readers → evidence consolidation → one proposal → deterministic validation/commit → receipt and refreshed state.**

### Planner and coverage

Give the planner a compact schema inventory, relevant operation history, task intent and available capabilities. It selects exact table/object groups and inspection questions.

Expand known dependencies mechanically: referenced and referencing keys, indexes/constraints, policies, SQL artifacts and recorded function/view/trigger dependencies. Where opaque SQL prevents dependency analysis, mark that uncertainty; absence of a detected edge is not proof of independence.

Choose the least costly sufficient strategy:

- Simple, local question: direct inspection, often one model call.
- Multi-object request: targeted readers over dependency groups.
- Whole-schema audit: explicit partition covering every in-scope object and cross-group dependency, plus global consistency review.

The planner cannot silently downgrade “inspect the whole schema” to a sample. Record requested, inspected, excluded, failed and unresolved objects. Claims of absence require adequate coverage.

### Reader contracts

Every reader uses the same snapshot and bounded exact definitions. Supply stable references alongside schema-qualified names; existing context strips some IDs, so extend the projection deliberately.

Readers return structured evidence: object/version references, facts, whether requirements appear satisfied, conflicts, missing facts, proposed implications and limits. They do not apply changes, run arbitrary generated SQL, alter credentials or mutate a live database.

Treat descriptions and SQL comments as untrusted data. Definitions may go to the selected BYOK provider according to existing sharing rules; row values are unnecessary for ordinary schema inspection.

### Consolidation and follow-up

The consolidator merges findings, reconciles contradictions and produces a compact answer/change proposal. Preserve exact evidence references and fetchable definitions. Do not compress away FK column order, predicates, nullability, literal bytes, policy expressions, function signatures or execution status.

Use targeted follow-up reads when evidence is incomplete. A failed reader remains visible as incomplete coverage. The consolidator cannot invent findings to fill a gap or claim a complete audit from partial results.

Before mutation, resolve required evidence against the current version. If it has changed, re-read affected dependencies and revalidate or retain the stale proposal with an explanation.

### Cost and recovery

Bound concurrency, total input/output, elapsed time, reader count and follow-up rounds. Initial concurrency should be conservative and configurable; model limits and provider throttling must inform budgets.

Show stage and coverage progress. Stop repeated systemic credential/model failures. Cache inspection by exact object/version and task-relevant configuration, invalidate affected dependency groups, and never mix snapshots.

Cancellation stops remaining reads. Preserve completed evidence when useful. Retrying a reader or consolidator must not trigger a mutation. Use one coordinated writer after reading.

### Acceptance

Inspect a schema beyond the single-request context limit without silent truncation. Verify whole-schema coverage, a dependency crossing reader groups, a reader failure, cancellation, and a mid-read schema edit. A one-table question avoids unnecessary fan-out. Readers never write, and unsupported dependency analysis remains explicit.

## 6. Workstream D — Proper IR + DDL generation and assistant support

### Object and capability inventory

All structured schema objects still emit DDL. The distinction is between faithfully modeled objects and retained SQL objects outside that model.

Create one versioned capability registry used by prompts, runtime response schemas, operation handlers, UI and tests. For each operation/object kind declare whether it can be read, represented, proposed, retained, structurally verified, behaviour-tested, exported and automatically deployed. These statuses are independent.

Use structured metadata for supported policies, generated columns, exact keys and indexes. Avoid duplicate structured and raw definitions of the same object.

Extend existing DDLPatch/editor identity machinery. Reconcile legacy SchemaFunction entries and patches without discarding SQL or emitting two copies. Where identity is ambiguous, retain the original text and block automatic replacement.

### Generation contract

Extend the blueprint beyond tables and vocabularies to include required SQL objects, dependencies, assumptions and unresolved requirements. Bind each requested behaviour to deliverables: e.g. an order-status audit requirement needs tables, a trigger function, a trigger binding and defined event behaviour.

Use an explicit versioned response envelope containing structured candidates, SQL artifacts, requirement coverage and unresolved items. Preserve legacy checkpoint recovery; do not reinterpret old responses as the new format.

Assign one owner per shared SQL object. Table workers must not each generate their own copy of a common function. SQL-object workers operate from the agreed blueprint and exact dependencies. Retain each result and its diagnostics, assemble centrally, and run a completeness check across both representations.

Missing required behaviour remains visible even if the table SQL executes. A richer candidate can finish as a retained export-only design; it must not be labelled deployable or have requirements silently removed.

### Assistant contract

Align advertised operations with runtime support first. Add a reviewed path to create or explicitly replace a SQL artifact. Replacement must carry expected prior identity/version/body fingerprint and exact new SQL. Changed dependencies invalidate the proposal.

Use the shared proposal/history boundary for structured and SQL edits. The model must not bypass it through a helper that directly appends raw text. Distinguish a suggested SQL edit, an accepted local definition and a database mutation.

Classify data backfills and other DML as separate reviewed data operations. Their presence inside a “DDL patch” does not make them schema-only or authorize execution.

### Assembly and verification

Build an ordered artifact from known dependencies. Required types/functions can precede dependent objects; triggers follow their tables and functions. Resolve supported FK cycles through deferred constraint creation. Unknown dependencies or unsupported cycles produce a retained, clearly unverified export and an actionable explanation.

Preserve exact SQL and legitimate ordered statements. Do not use blanket CREATE OR REPLACE, IF NOT EXISTS, automatic drops or text deduplication to hide identity conflicts. Distinguish an object definition from a sequence of migration operations.

Track separate evidence levels:

- Response/format accepted.
- Required objects and declared intent accounted for.
- Local design retained, with unresolved items where necessary.
- SQL parsed or preserved opaquely.
- Executable structural verification for the declared supported envelope.
- Behavioural tests for relevant functions/triggers when a suitable test environment is available.
- Exact live deployment verification where implemented.

Only the existing verification gate may mint ValidatedSchema. Retaining an export-only design must use a separate status and cannot create deployment authority. PGlite success does not prove all business behaviour or hosted Supabase compatibility.

Phase 1 delivers generation, assistant authoring, preservation, review and honest export status for SQL artifacts. It does not silently expand automatic deployment to every PostgreSQL object. Any expansion needs coordinated modeling, introspection, comparison, execution and verification work.

### Acceptance example

“Create orders and an audit log; record every order-status change.”

The result accounts for tables, function and trigger exactly once, identifies their dependencies, and reports any unfulfilled requirement. Save/restart/export preserves all definitions. Ask the assistant to change the trigger behaviour: it retrieves the prior definition, proposes an explicit replacement and records the actual before/after result. Unsupported automatic deployment remains blocked without losing the design. Behaviour is tested on a disposable real database before claiming it is proven.

## 7. Delivery sequence

| Increment | Concrete delivery | Exit evidence |
|---|---|---|
| P1.0 — Align contracts | Inventory current operations; correct prompt/parser/handler mismatch; establish typed versions, receipts and capability statuses | Advertised examples match accepted schemas; unsupported proposals have an explicit disposition |
| P1.1 — Durable change history | One existing structured edit with before/proposed/confirmed references and transactional receipt | Apply, no-op, stale edit, failed save, restart and undo preserve truthful state |
| P1.2 — Close the chat loop | Relevant receipts, current-state checks and direct scoped reading | Repeat an intent and discuss an undo without duplication or fabricated success |
| P1.3 — SQL-object lifecycle | Identity-aware retained artifacts, explicit replacement, migration/recovery and review | Function/view/trigger definitions survive save/reload/export without append-only copies |
| P1.4 — Generation and assistant outputs | Shared dual-output contract and requirement coverage; dependency-aware artifact assembly | Tables-plus-audit-trigger fixture completes as a qualified or explicitly export-only design |
| P1.5 — Parallel reading | Planner, dependency expansion, readers, consolidator, coverage and budgets | Large and cross-domain tasks complete or report exact incomplete coverage |
| P1.6 — Integrated qualification | Actual app journeys, model samples and appropriate runtime gates | The user can inspect, change, restart and explain the complete design consistently |

Deliver the smallest visible journey at each increment. Do not wait for the whole parallel system before fixing chat receipts or impossible suggestion cards. Address original G0 generation false blockers where these paths depend on them; preserve its deterministic-repair policy. CSV/dashboard implementation stays in the broader roadmap and does not need this note to duplicate it.

## 8. Verification matrix

| Scenario | Required result |
|---|---|
| Same request twice | Current-state check returns no-op or an exact explanation; no duplicate object |
| Same operation delivered twice | Original receipt resolved; no second mutation |
| Applied, then manually edited/undone | Historic result and current state both described correctly |
| Individual suggestion changes revision | Remaining suggestions visibly stale and re-evaluated |
| Save failure or crash at commit boundary | Last durable state and recoverable intent retained; no invented success |
| Concurrent windows / delayed result | Revision guard prevents stale overwrite |
| Restart / old project format | Durable references restored or honestly unavailable; recovery preserved |
| Large-schema global question | Declared complete coverage or explicit omissions; no silent truncation |
| One reader fails or uses old snapshot | No fabricated completion or mixed-version proposal |
| Raw SQL references hidden dependency | Uncertainty visible; automatic rewrite/deploy remains restricted |
| Prompt asks for tables plus view/trigger | Every deliverable tracked; missing SQL cannot disappear behind table success |
| SQL-object replacement | Correct identity, previous definition and dependency checks; exact before/after receipt |
| Structured/raw duplicate ownership | Conflict or explicit migration; no duplicate emission |
| Export-only design | Retained and exportable without minting deployment proof |
| Actual deployed change | Separate database journal and fresh catalog proof; local undo does not claim DB rollback |

Start with deterministic fixtures and existing focused tests. Add real PGlite/catalog tests where the verifier supports the artifact; use Chromium and WebKit for state/history/coverage UX. Test behaviour, locks and publication on disposable PostgreSQL where necessary. Hosted Supabase, selected real-provider runs and the installed Tauri/Keychain paths require their actual environments and explicit test scope.

After future code edits, follow AGENTS.md: focused checks, npm run check and diff inspection; Rust changes require its formatting/checking/linting/tests. Perform build and packaging gates at the relevant release milestone. Report external gates as not run when prerequisites are absent. No new tests or implementation are claimed by this planning document.

## 9. Existing implementation touchpoints

| Area | Read before implementation |
|---|---|
| Chat messages, context and apply acknowledgements | `src/components/vibedb/AIChatPanel.tsx` |
| Document versions and shared application boundary | `src/lib/schema-document-session.ts`, `src/lib/schema-change-plan.ts` |
| Durable storage, revisions and save lifecycle | `src/lib/project-storage.ts`, `src/lib/project-save-session.ts` |
| Generation checkpoint and candidate contracts | `src/lib/generation-run.ts`, `src/lib/schema-candidate-plan.ts`, `src/lib/contract-pass.ts` |
| Prompts and orchestration | `server/ai-local.mjs`, `src/pages/VibeDBPage.tsx` |
| Raw SQL identity, reconciliation and assembly | `src/lib/sql-ddl-parser.ts`, `src/lib/ddl-patch-reconciliation.ts`, `src/lib/ddl-patch-artifact.ts`, `src/components/vibedb/ExportGenerators.ts` |
| Proof and deployment boundaries | `src/lib/verification/gate.ts`, `src/lib/verification/engine.ts`, `src/lib/deployment-support-envelope.ts`, `src/lib/mutation-journal.ts` |

Preserve unrelated checkout changes. Keep changes to VibeDBPage surgical. Do not introduce a replacement schema model, product authentication/billing, dataset storage, universal PostgreSQL support or a separate autonomous writer as incidental scope.

## 10. First implementation checklist

- [ ] Establish current source/build baseline and reproduce the prompt/operation mismatch.
- [ ] Agree typed semantic-version, proposal, receipt, coverage and SQL-artifact contracts.
- [ ] Deliver one durable before/after edit with restart, no-op, stale-source and undo coverage.
- [ ] Feed actual outcomes and current state back into chat.
- [ ] Introduce identity-aware SQL-artifact addition/replacement with safe legacy recovery.
- [ ] Extend generation/assistant responses and requirement coverage across IR and DDL.
- [ ] Assemble known dependencies and separate retained design from deployment proof.
- [ ] Add adaptive parallel inspection with exact evidence and coverage accounting.
- [ ] Qualify the two integrated fixtures: repeated structured edit; generated audit function/trigger followed by an explicit assistant replacement.
- [ ] Record actual verification, limits and remaining work before returning to the broader import/dashboard milestones.

**Definition of done:** the assistant can explain what it inspected, proposed and actually changed across the whole design; generation accounts for structured and SQL deliverables; large-schema inspection is bounded and honest; all retained state survives the promised restart path; and no unsupported object or uncertain operation is silently presented as verified or deployed.
