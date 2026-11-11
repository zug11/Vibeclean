# VibeDB

**Design a database, bring your spreadsheets into it, and build useful dashboards over data you control.**

VibeDB is being developed as a local-first, bring-your-own-key PostgreSQL and Supabase workspace. Its direction connects natural-language schema design, a visual editor, faithful SQL, reviewed database changes, conversational spreadsheet imports, and a management studio with saved dashboards.

The intended experience is one continuous workflow: explain the business → establish the schema and meaning of its data → review the changes → use a supported customer-owned database → import and inspect records → save useful views → update the data without rebuilding everything.

## Project status and this repository

**This is a development roadmap, not a claim that the complete workflow is already available.** The development project is a hardened alpha, with further reliability work and end-to-end qualification required. The plans describe both findings from the audited development checkout and work proposed to address them.

The documentation publication on **12 November 2026 changes Markdown only**. It does not publish the newer local application code. The source snapshot preceding this documentation update is [commit `46f2126`, dated 12 June 2026](https://github.com/zug11/Vibeclean/tree/46f21264cbf7486e4fa9d633a4ef70035380c034), and differs from the development checkout inspected for the October/November plans. Paths and capabilities described in those plans may therefore be absent from the published source.

The [previous README](docs/history/README_BEFORE_ROADMAP_2026-11-12.md) is retained as historical context. It describes an older hosted product model. **The active direction is local-first and BYOK, without product accounts, product authentication, billing, or payments.** Customer-database roles, permissions, and row-level policies are a separate concern and remain part of correct database operation. Older root-level proposals should be read in this context.

## Read the detailed plans

| Document | Purpose and status |
| --- | --- |
| [Full implementation plan](docs/plans/IMPLEMENTATION_PLAN.md) | The main product roadmap: generation completion, connections, faithful design and deployment, conversational CSV imports, customer-database dashboards, repeat imports, scale, Excel, and studio improvements. Originally written 29 October 2026. |
| [Phase 1: Schema History, Parallel Reading, and IR + DDL](docs/plans/PHASE_1_SCHEMA_HISTORY_AND_IR_DDL.md) | The focused foundation plan for durable before/after history, evidence-backed assistant reading, and complete structured-schema plus SQL proposals. Written 3 November 2026; it supplements the main roadmap. |
| [Schema Control Hardening Specification](docs/plans/SCHEMA_CONTROL_HARDENING_SPECIFICATION.md) | A broader architectural proposal retained for its detailed fidelity and verification requirements. Parts are superseded: a wholesale schema-model replacement and hosted account/credit systems are not prerequisites of the active roadmap. |

The main roadmap and focused Phase 1 plan take precedence where the historical hardening proposal conflicts with them. The focused Phase 1 preserves the existing authoritative `TableNode[]` / `SchemaDocument` representation; replacing it with a new canonical IR requires a separately scoped decision and migration plan.

## Two ways into the same workflow

### Design the system, then fit the data

A business can first describe what it needs: customers, orders, order items, payments, returns, or a reporting workflow. VibeDB should help establish a coherent database design, explain relationships, preserve the accepted definitions, and produce reviewable SQL.

Existing spreadsheets can then be mapped into that design. Source headings do not have to dictate the final database structure. The import plan can map fields, convert dates, preserve identifiers, reconcile keys, separate entities, or relate datasets when those operations have a clear business meaning. Ambiguities require focused decisions rather than invented values or silently discarded records.

### Start with spreadsheets, then establish the design

A business can instead add a CSV, preview it immediately, and describe what each row means. A conversation should establish the important choices alongside an editable grid and concrete import plan: headings, types, date formats, row grain, destination, keys, and how files relate.

Importing one coherent spreadsheet as one table is a valid outcome. Splitting it into several tables is useful when the intended work and verified relationships justify it. Both entry points lead to the same schema, dataset identities, connection, saved metrics, dashboards, and recovery model.

## First priority: generation that reaches a useful outcome

Generation must finish with an accepted design or a retained candidate and a precise way to resolve the remaining issue. It must not lose useful work, repeatedly replay the same invalid answer, or leave a user guessing whether the model, transport, validator, or application failed.

The generation work includes:

- Visible effective blueprint and worker model selections, with actionable stage-specific provider failures.
- Durable progress and candidate recovery across interruption and restart.
- Correct validator behavior for supported constraints, composite keys, quoted identifiers, and other reproduced false blockers.
- Separate blocking errors, unresolved requirements, and optional advisories.
- Deterministic repairs when the intended change is fully specified; a focused question when a business choice is missing; bounded AI proposals where interpretation is useful.
- Clearer generated relationship names, such as `parent_comment_id`, while preserving explicitly authored or imported names.
- Explicit requirement accounting: successfully executing SQL does not establish that every requested feature was generated.

Completion does not mean weakening the verification gate. A useful design can be retained and exported while unsupported automatic deployment remains blocked. Naming preferences and speculative performance advice must not become reasons for an otherwise usable design to disappear.

## Phase 1: an assistant that understands what actually changed

The assistant should reason from canonical schema state and recorded application outcomes. It needs four distinguishable states for each attempted edit: **before, proposed after, confirmed after, and current**. A suggestion, rejected operation, later manual edit, and successful application must not become interchangeable chat memories.

Durable semantic versions and operation receipts should allow the assistant to explain an actual change, recognize that a repeated request is already satisfied, and notice when the document has changed since its proposal. Revision checks and a single application boundary remain responsible for preventing stale or duplicate writes. Undo changes the local design; it does not reverse an already executed database operation.

For larger questions, the planned reading pipeline is:

**Prompt → immutable schema snapshot → inspection blueprint → bounded parallel readers → evidence consolidation → one reviewed proposal → deterministic application → recorded outcome.**

Readers inspect explicit objects and dependencies, report evidence and omissions, and do not mutate the schema. Small questions should use a smaller direct inspection. Whole-schema claims require complete declared coverage; an unavailable worker cannot silently become “everything checked.” Concurrency, time, token use, retries, and retained evidence all need bounds.

### Structured schema and SQL must work together

The intermediate representation (IR) handles the exact objects it supports. Functions, triggers, views, and other SQL objects outside that representation need stable, versioned SQL artifacts with ownership, dependency information, recovery text, and honest support status.

Generation and assistant edits should use one explicit capability contract. A request for tables plus an audit trigger must account for both. The proposal must not omit the trigger, define the same object twice, or advertise an operation that the application cannot apply.

The intended lifecycle is to retain structured and SQL artifacts together, assemble them in dependency order, show before/after changes, preserve them through restart and export, and verify what is actually supported. **Retained, exportable, executable, behaviorally verified, and confirmed live are different states.** Opaque SQL preservation alone does not establish safe deployment or correct behavior.

## Faithful design, connections, and deployment

The visual editor, SQL editor, import, export, comparison, and management studio must agree about the same design. Supported DDL should preserve exact names, namespaces and quoting, ordered key pairs, constraints, index definitions, expressions, and timing/action flags through parse → emit → parse. Canvas position and temporary UI state do not belong in semantic equality.

Compiler analysis and repair have explicit roles. Faithful import, manual SQL editing, export, comparison, and deployment must not silently rewrite a schema. Unsupported syntax should retain its identity and verbatim recovery text; unsupported-only changes remain visible blocked work.

Connection work must qualify the application people actually run, including the installed desktop artifact. One verified target identity and credential reference should carry through deployment, imports, browsing, and dashboards. Secret keys require the appropriate native execution path; changing a key's format is not proof of authority.

Every live schema review should compare the last confirmed baseline, a fresh live catalog, and the intended design. Disjoint changes can be reconciled; overlapping changes require an explicit conflict. Immediately before mutation, recheck live state and journal the immutable reviewed SQL and fingerprints. An uncertain response must lead to reconciliation, not automatic replay.

The baseline advances only after a fresh catalog proves the intended supported schema is present. Atomic execution is not a blanket rollback guarantee. The audited exact Supabase sync boundary is ordinary `public` tables, with `auth.users` only as an external foreign-key target; broader object or namespace management needs qualification before the product claims it.

## Conversational CSV import with a concrete plan

The main import interface should be a conversation beside a familiar preview, with direct controls available for every supported decision. Users should be able to say what the data means without learning database-normalization terminology.

VibeDB should propose a typed, editable import plan covering source files, destination, field mappings, transformations, keys, access, and expected effects. Parsing, conversion, validation, upload, publication, and recovery remain deterministic operations. AI helps propose the plan; it is not the uploader or the source of arithmetic truth.

The import path must preserve leading zeros, precise numeric values, NULL versus empty strings, quoted multiline fields, and approved date/time interpretation. Sampling helps propose definitions; full-dataset validation is required to establish keys, conversions, and relationships. Invalid records need specific, recoverable outcomes rather than silent deletion.

After verified publication, the exact imported dataset should open automatically. Users can search, filter, sort, inspect records, and start a useful view without reconstructing the connection or finding the table manually.

## Customer-owned storage and database-side computation

The intended division is straightforward:

| Information or work | Intended location |
| --- | --- |
| Original files | The user's existing storage or explicitly selected customer-controlled storage |
| Staging rows, published datasets, and retained import recovery data | The chosen supported customer database |
| Filtering, joins, grouping, aggregation, and heavy query work | The customer database |
| Schema definitions, stable field/dataset identities, mappings, transformation plans, saved queries, and dashboard layouts | Lightweight versioned VibeDB project records |
| Preview rows and chart results | Bounded temporary application memory by default |
| Credentials | Native credential storage, referenced by scoped handles rather than embedded in projects |

Files may be gigabytes in size, so loading must stream with bounded memory and backpressure. The application must not load the whole dataset into one browser array or a model context. Direct PostgreSQL bulk loading and the Supabase adapter need separate capability and recovery qualification.

The app necessarily reads file chunks and displays query results. Metadata and aggregate values can also be sensitive. “Customer-owned data” is not a claim that no data ever leaves the device or that legal obligations disappear. BYOK credentials are sent to the selected provider or target; row samples and result values require a visible sharing choice before inclusion in AI context.

The web surface can design, validate, preview within declared capabilities, compare, and export. Direct privileged database administration belongs behind the guarded desktop bridge. Initial database choice means supported PostgreSQL and Supabase connections; support for every database engine or cross-server analytics is not implied.

## Dashboards that remain useful after the first import

The first dashboard scope is private desktop dashboards with **number/KPI, table, bar chart, and time-series** components. Users should be able to request “monthly sales and top customers,” review the meaning of the measures, adjust filters and formatting, and save the result.

Correctness depends on explicit row grain, keys, relationship cardinality, date/time rules, units, and currencies. Order count is not necessarily row count. Joining customers must not multiply sales. Totals must be computed over the intended full dataset, independently of the grid's visible page or a chart's top-N limit.

Saved dashboards retain definitions and stable references, not full result arrays. They must survive restart, refresh without an AI call, preserve layouts after imports, and report missing permissions, changed fields, stale results, and failed queries distinctly. A query error must never appear as a zero-value result.

The next file is part of the core product: reuse the approved mapping, show changed headings, review append/update/replace behavior, verify publication, and refresh the same dashboard. Repeated delivery must not duplicate publication; business-event deduplication needs its own explicit rules. Combining files, relating datasets, and splitting entities are different operations with different effects.

## Delivery order and completion criteria

The milestone names below follow the full plan. The focused Phase 1 work supports the early schema and assistant foundations; it does not replace these milestones or make every later feature a prerequisite for the first useful business workflow.

| Milestone | Required outcome |
| --- | --- |
| **G0 — Generation completion** | Retain a failed candidate, explain the actual blocker, resolve it, recheck, and finish without losing work or looping indefinitely. |
| **G1 — Generation quality** | Specific relationship names, correct contracts and advisories, bounded recovery, and explicit fulfillment of requested requirements. |
| **C1 — Connections** | One reliable target/credential model, including a qualified secret-key path in the actual installed desktop build. |
| **D1 — Design to database** | Faithful editing and persistence, immutable deployment review, verified live state, drift handling, and usable studio handoffs. |
| **I1 — Conversational CSV** | Preview, material questions, a reviewed import plan, verified publication, and direct opening of the dataset. |
| **Q1 — Browse and calculate** | Database-side filtering and pagination, saved queries/metrics, and calculations checked against independent SQL. |
| **B1 — Saved dashboards** | Useful charts and KPIs that survive restart and refresh correctly using the customer database. |
| **U1 — Update and consolidate** | Repeat imports, append/update/replace, and multi-file operations preserve identities and existing dashboards. |
| **L1 — Large-file qualification** | Measured loading, bounded memory, complete row accounting, and interruption recovery; 1 GB and 5 GB fixtures are targets, not established performance claims. |
| **X1 — Genuine Excel** | Sheet and header selection, workbook date systems, formatted identifiers, formula/cached-value handling, and separately measured workbook limits. |
| **M1 — Daily management** | Durable SQL drafts, clear design-versus-live execution, qualified transaction behavior, and reviewed record maintenance with stable keys and conflict detection. |
| **R1 — Release qualification** | Both end-to-end journeys work in the declared supported runtime, backend, and installed artifact, with external gates reported accurately. |

The first business delivery target is deliberately concrete: **sales CSV → customer database → browse records → save monthly-sales and top-customer views → quit/reopen → import the next file → refresh the same dashboard with correct totals**. It includes an interrupted import and a lost-acknowledgement recovery case. The schema journey also needs prompt → accepted design → edit/save/restart → reviewed deploy → verified catalog → drift reconciliation.

## Verification and research direction

Progress should be judged by reproducible journeys and semantic evidence. Planned checks include real schema fixtures, executable PGlite verification, Chromium and WebKit behavior, real PostgreSQL round trips, explicitly disposable Supabase tests, permitted real-provider samples, and installed Tauri artifact checks. Local tests do not substitute for external gates, packaging, signing/notarization where required, or measured large-file behavior.

The compiler-in-the-loop architecture also provides a possible research direction: how deterministic analysis, bounded repair, revision-aware context, parallel evidence gathering, and executable feedback affect intent fulfillment and reliable schema evolution. Useful evaluation would compare alternatives on completion, semantic correctness, unintended changes, cost, latency, and recovery. This is a proposed research program, not a claim of established novelty or a validated research result.

## Deliberately later scope

Additional SQL engines, cross-database analytics, public/shared web dashboards, scheduled work while the device is off, and customer-side materialized summaries need separate execution and access designs. ORM and other exports need explicit mappings and target-toolchain validation. Broader exact support for functions, triggers, extensions, namespaces, and advanced objects must extend representation, parser, emitter, catalog, comparison, persistence, and proof together.

These possibilities remain visible without delaying generation reliability or the first complete spreadsheet-to-dashboard workflow. The detailed plans define the acceptance criteria; this documentation update does not implement them or change the repository's licensing terms.
