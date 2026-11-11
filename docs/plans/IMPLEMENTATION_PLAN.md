# VibeDB implementation plan — reliable generation, conversational imports, and customer-database dashboards

> **Publication status — 12 November 2026:** This is the detailed product roadmap, originally written on 29 October 2026. Its findings describe an audited development checkout at that time; they are not a current audit of the published GitHub source or a claim that the planned features are delivered. Generation completion remains the first priority. The separate [Phase 1 plan](PHASE_1_SCHEMA_HISTORY_AND_IR_DDL.md) expands the schema-history, assistant-reading, and IR + DDL foundations without renumbering this roadmap.
>
> Source paths below identify the development checkout and may not exist in the older source snapshot currently published in this repository. Local file links have been converted to portable path references. Dated provider-policy statements and incident findings should be rechecked before implementation. This publication adds documentation only.


29 October 2026 · Planning only · Active source: audited development checkout

This is the consolidated implementation plan for the product direction agreed in this conversation. It brings generation reliability, clearer naming, database connections, conversational spreadsheet imports, and dashboards into one end-to-end delivery sequence. It also retains the necessary schema fidelity, management studio, deployment, and recovery work from the 26 October audit.

Creating this note authorizes documentation only. It does not authorize coding, rebuilding or replacing installed apps, changing credentials, making provider calls, deploying schemas, or modifying customer databases.

## 1. Product outcome and scope

The intended promise is: **Your data lives in your database. VibeDB helps you organize it, work with it, and build dashboards over it.**

The primary business journey is: add spreadsheets → explain their meaning in a conversation → review a concrete import plan → choose a customer-owned database → import and verify → browse the dataset → build and save a useful dashboard → load the next file without rebuilding everything.

The schema-design journey remains first-class: describe or import a schema → finish a usable design → edit and save faithfully → connect → review and deploy → inspect live data → reconcile later changes. Both journeys share connections, schema definitions, dataset identities, query execution, and recovery. They must not become separate products with contradictory state.

The first implementation priority remains generation actually finishing. Once the reliability and connection foundations are usable, prioritize the spreadsheet-to-dashboard journey over expanding advanced SQL administration.

### Agreed decisions

- The main import experience becomes conversational, with an adjacent live preview and editable plan.
- VibeDB retains lightweight project definitions, not durable copies of customer datasets. Rows and heavy query computation belong in the customer's chosen supported database.
- Large files are streamed with bounded memory. A whole spreadsheet must never be placed in a model context or loaded into one browser array.
- AI helps interpret intent and propose definitions. Parsing, validation, known transformations, imports, queries, calculations, and recovery execute through deterministic application and database mechanisms.
- A validator finding does not automatically become an AI repair task. Correct the checker, perform an exact authorized repair, or ask a focused business question as appropriate.
- New generated schemas should use specific relationship names such as parent_comment_id when the relationship is known. Naming style must not become a new reason generation cannot finish.
- PostgreSQL and Supabase are the initial supported database family. Customer choice means a supported provider/connection, not an immediate claim to support every SQL engine.
- Keep the local-first, BYOK, desktop administration model. Do not add product user accounts, authentication, billing, or payments.
- Private dashboards on the user's desktop are the first release. Public sharing, hosted execution, scheduled refresh while the laptop is off, and additional database engines are later decisions.

### Changes to earlier proposals

The earlier suggestion of storing full datasets locally is replaced by customer-database storage. VibeDB's durable local project contains definitions and references; previews and query results are bounded and temporary by default.

A local PGlite verifier remains useful for isolated schema checks. It is not the customer's analytics warehouse or a durable store for their spreadsheets.

Do not make every import wait for normalization into multiple tables. Importing one spreadsheet as one coherent dataset is a normal successful path. Propose splitting or linking tables when it serves the user's intended work and the keys are established.

## 2. Evidence baseline and what is not yet proven

These are investigation findings, not a claim that the implementation below already exists.

| Area | Evidence from this conversation | Consequence |
|---|---|---|
| Generation transport | Saved runs produced blueprints but every table worker failed. The selected worker model remained GPT-4 after only the blueprint model was changed. The user subsequently confirmed generation worked after correcting the worker selection. The original provider response was not retained. | Effective model selection and actionable per-stage provider errors need to be visible. Do not treat this particular incident as proof that every generation failure is a validator problem. |
| Generation recovery | The 26 October audit reproduced a complete orders response containing CHECK(quantity > 0) without quantity. Resume reused the same complete response and failed again. | Response completion, candidate validity, and accepted design must be separate states. |
| Validator correctness | The earlier audit reproduced false rejection of table-scoped constraint names, composite-key misinterpretation, and a quoted-identifier regex crash. | Reproduce and fix these first; keep genuine failures blocked. |
| Installed connection path | Inspection of the JavaScript embedded in /Applications/VibeDB.app found browser fetch for Supabase and the same supplied key in apikey and bearer authorization. The current source instead has a guarded native path and distinct opaque-key handling. | A source fix is not an installed-app fix. Qualify and identify the artifact actually running. |
| Multiple app copies | Two VibeDB copies were running during inspection: the main installed app and a CSV Inference checkpoint build. | Show meaningful versions/build identities and use one deliberate qualification artifact. |
| Secret-key error | Supabase's documented browser detection returns HTTP 401 for secret keys. The observed error matches that protection. | Use native desktop transport; keep browser privileged administration blocked. |
| Index advisory | The exact “planner will never prefer it” sentence originates in VibeDB's static gate. An isolated 100,000-row PGlite experiment selected the smaller index despite a wider matching-prefix unique index. | Remove the universal performance claim. Prefix overlap is not proof of uselessness. |
| Automatic cleanup | The current compiler contains a prefix-index removal rule based on the same incorrect assumption. | Audit and narrow the rule, rather than merely softening the toast. |
| Import UX | The screenshot exposes schema-only mode, normalization, business-key questions, connection/setup details, and recovery in a large modal. Current defaults are schema-only and normalization enabled. | Start from the user's desired dataset and dashboard; move technical choices into contextual controls. |
| Import machinery | Current source already streams CSV, uses destination-bound jobs and receipts, stages remotely, and verifies publication. It also performs repeated file scans and uses small sequential batches. | Reuse this foundation while separately proving large-file throughput, completion, and recovery. |
| Analytics | The inspected workspace is primarily SQL tabs and bounded result tables. No complete saved-dashboard builder was found. | Dashboarding is new product work, including persistence and a trustworthy query model. |

The 26 October findings are historical reproductions to recheck before implementation. The 29 October source and installed-binary findings are a snapshot, not a live database audit. No hosted Supabase or packaged release qualification was established by writing this plan.

Supabase currently recommends sb_secret_ keys as the successor to legacy service_role JWT keys, with legacy API-key deprecation stated for the end of 2026. The new key still maps to the privileged database role; changing key format does not remove the need for correct permissions and transport. Sources: [migration guide](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys), [API-key behaviour](https://supabase.com/docs/guides/getting-started/api-keys).

## 3. Architecture and data ownership

### What persists where

| Information | Intended location and rule |
|---|---|
| Original spreadsheet | User's existing file location or customer-controlled storage; no automatic VibeDB-hosted copy |
| Staged rows, published rows, retained import recovery data | Customer database; any object storage used later is customer-controlled and explicit |
| Exact schema definitions | Versioned VibeDB project; preserve authoritative TableNode[] metadata and opaque SQL recovery |
| Dataset and field identities, meanings, source mappings, transformations | Versioned VibeDB project, with verified references to database objects |
| Saved queries, measures, filters, charts, dashboard layout | Versioned project; definitions survive restart without retaining result rows |
| Import intent and recovery references | Small local job records plus authoritative destination receipts |
| Grid pages and chart results | Bounded temporary memory; no durable result cache by default |
| Credentials | Native credential storage with scoped handles; never project files, chat, recovery exports, or model context |
| AI context | Relevant conversation, selected definitions, and explicitly permitted metadata; row samples and result values require a separate visible sharing choice |

The application necessarily reads file chunks during upload and returns query results to the user's device. The technical promise is no durable dataset copy or routine row-data relay through VibeDB servers. Describe these flows accurately in product copy. Metadata, conversation text, aggregates, and column names can still contain sensitive information.

Raw values must not leak into telemetry, provider diagnostics, crash reports, chat transcripts, or saved project examples. Audit legacy canvas dataRows, persisted samples, query history, and result caches against this boundary. Existing user content needs an explicit recovery/export/migration decision; do not silently delete it or continue copying it into new project records. Error details should identify a field, source position, or customer-side report reference without silently retaining the offending row locally.

### Shared document and operation model

Extend the existing versioned project format rather than replacing the schema representation or launching a broad framework rewrite. Proposed conceptual records:

- **Connection reference:** stable connection ID, verified target identity, runtime capabilities, and credential handle reference.
- **Dataset definition:** stable dataset ID, display name, physical object binding, row grain, schema revision, import version, and last verified status.
- **Field definition:** stable field ID, source header mapping, physical identifier, display label, storage type, semantic type, null handling, locale/time-zone rules, and approved transformation.
- **Relationship definition:** exact field pairs, expected cardinality, matching/null policy, and full-dataset verification evidence with its observation version.
- **Import plan:** file identities, destination, field mapping, combine/link/update operation, transform versions, expected effects, access choice, and immutable review fingerprint.
- **Metric/query definition:** dataset/version references, aggregation, filters, joins, time grouping, currency/unit rules, and readable generated SQL.
- **Dashboard definition:** chart/metric references, layout, filters, formatting, and version.
- **Operation record:** immutable intent, execution identity, receipts, known outcome, and recovery actions.

Separate semantic schema revision, layout revision, dataset publication version, and ephemeral UI state. Moving a table or chart must not invalidate an unrelated semantic proof. A semantic edit must invalidate stale plans and queries that depend on it.

Chat proposes structured changes to these records. It is not the authoritative storage format. Accepting a proposal applies one validated, undoable local operation. Every proposed operation has typed inputs, scope, effects, and a visible review where the action changes existing data or access.

### Runtime boundaries

Desktop: UI → guarded native bridge → selected customer database. Imports, queries, and administrative requests share the same connection identity and credential rules.

Web: design, conversation, validation, previews of user-selected local files, and export can exist within their declared capabilities. Privileged database administration is unavailable without a separately designed and authorized protected adapter. Do not fall back to browser fetch with a secret key.

Initially, consolidation and a dashboard's joins operate within one chosen database. Combining data across independent servers requires a later explicit ingestion/federation design; never download whole remote datasets to perform hidden client-side joins.

## 4. Delivery order

| Milestone | Primary outcome | Dependency |
|---|---|---|
| G0 | A failed generation becomes a retained, resolvable candidate and can finish | Reproduce current defects and establish artifact identity |
| G1 | Clear column names, stronger contract checking, bounded generation recovery | G0 |
| C1 | One reliable connection model and a tested installed secret-key path | Existing native foundation; deliver alongside early generation reliability |
| D1 | Faithful editing, immutable deployment review, and usable studio handoffs | G0/C1 and existing exact-schema contracts |
| I1 | One CSV imported through conversation into a customer database | C1, shared dataset/field definitions, minimum D1 handoff |
| Q1 | Correct browsing and saved query/metric definitions | I1 and a restricted query capability |
| B1 | Saved private dashboards with correct database-side calculations | Q1 |
| U1 | Repeat imports, append/update/replace, and multi-file consolidation | I1/B1 stable identities and publication versions |
| L1 | Measured gigabyte-scale loading and interruption recovery | I1 engine and U1 publication contracts; design performance requirements from the start |
| X1 | Genuine Excel workbook support | Stable mapping/import model |
| M1 | Broader daily SQL and staged record maintenance | Connection/query/journal contracts; does not delay the first dashboard slice |
| R1 | Installed-artifact and supported-backend qualification | Relevant preceding milestones |

A minimum reliable browsing/query surface is part of I1/Q1. Do not make conversational imports wait for every advanced SQL editor, CRUD, ORM-export, or database-engine feature.

Each milestone ends with a reviewable product journey and a declared capability status. Calendar estimates should be based on the first implemented slices and external test access; this note does not promise the whole roadmap can be finished in one day.

## 5. G0 — Generation finishes and failures have a useful next step

### Work

1. Capture effective provider/model choices for both blueprint and worker stages in the run record. Show both in settings and the run details. Do not silently replace an explicitly chosen model or provider.
2. Validate obvious configuration problems before fan-out. Where a provider supports capability checks, distinguish model listing from demonstrated permission to execute the required request. Do not create an expensive test request merely by opening settings.
3. Preserve sanitized error categories and useful provider responses: invalid credentials, model unavailable, unsupported request, rate limit, network failure, timeout, malformed/truncated output, and schema rejection. Redact secrets and raw row data.
4. Stop repeated systemic failures across a fan-out. A uniform credential/model failure should produce one actionable explanation, retain the blueprint, and avoid exhausting retries on every table.
5. Separate response states from assembled-candidate states. A complete response is not a valid schema. Track collecting, assembled, checking, repair available, decision needed, verifier unavailable, ready for design, accepted, cancelled, and failed with retained work.
6. Retain original responses, original SQL, assembled candidate, findings, applied repairs, contract revision, and source context. Persist checkpoints safely with recovery copies for older valid versions.
7. Fix the known false blockers: table-scoped constraint identity; exact ordered composite keys; robust quoted-identifier handling. Optional advisor failure must not be misreported as proven schema invalidity.
8. Add typed diagnostic ownership: code, origin, exact object identity, SQLSTATE/statement location when available, expected/observed facts, blocking scope, and resolution choices. Error prose is presentation, not the repair interface.
9. Introduce the first small deterministic repair: add a missing column only when the contract completely establishes the intended definition. Otherwise show a focused choice. Never erase a CHECK merely to obtain a green result.
10. Make the recovery surface usable: inspect draft, perform an available exact repair, resolve the current question, edit draft, recheck, optionally ask AI for a bounded proposal, or save/export recovery.
11. Use Resume Remaining Generation only for genuinely missing provider work. An unchanged assembled-invalid candidate receives Recheck/Repair/Resolve, not a fake Resume loop.
12. Bind work to its semantic source revision. Discard or retain separately stale results; never overwrite a newer accepted design. Canvas movement alone should not cancel generation.

### Repair decision policy

| Situation | Default action |
|---|---|
| Checker is wrong | Fix the checker; preserve valid authored semantics |
| Exact contract obligation is missing | Pure scoped repair inside the requested generation flow, then revalidate |
| Business intent is incomplete | Ask one concrete question or expose an editable choice |
| Performance/naming suggestion | Advisory; generation can complete |
| Verifier unavailable | Preserve candidate and offer retry; no fabricated proof |
| Valid design exceeds direct-deployment support | Save/inspect/export with explicit coverage limits |
| Provider response incomplete | Retry only affected missing work within its budget |
| Live target drift or uncertain write | Reconcile/inspect the operation; never replay automatically |

Repair rules must be pure, idempotent, versioned, and bound to exact preconditions/postconditions. Fingerprint candidate, contract, findings, affected objects, and repair rule. Repeating unchanged work is not progress. Keep provider retries, semantic proposals, and verifier retries separate. A bounded optional AI repair can propose an edit; it cannot relax requirements without review.

### First thin delivery

Start with the reproduced orders/quantity failure. Preserve the candidate, identify the CHECK and table, complete quantity when its definition is explicit, recheck, and accept. For ambiguous quantity, retain work and ask a targeted question. Add reload and stale-source coverage before broadening the repair catalog.

### Acceptance

- The complete-contract fixture finishes without a repair model call.
- The ambiguous fixture asks for a decision without guessing a type or dropping the CHECK.
- Repeated Resume cannot repeat the same non-progressing failure.
- All table responses failing from a model/configuration problem produce an actionable cause and retain the blueprint.
- Cancel/restart retains work without duplicate generation or stale acceptance.
- Known valid composite/scoped/quoted fixtures pass; truly invalid SQL still fails.
- An unavailable executable verifier never produces a ValidatedSchema.

## 6. G1 — Clear names and a contract that carries intent through generation

### Naming policy

Prefer names that describe both role and target where that adds meaning: parent_comment_id, author_user_id, approved_by_user_id, shipping_address_id, billing_address_id. Keep conventional simple names such as id, email, and created_at when they are already clear.

Choose names in the blueprint before parallel table generation. Workers, FK references, constraints, indexes, SQL, diagrams, and descriptions must reuse the same identity. The current prompts explicitly teach parent_id, so a UI-only rename would not fix the source of the behaviour.

Change all relevant generation prompts and examples together: blueprint, table worker, consistency review, audit/repair, add-table, and conversational schema suggestions. Preserve explicit user terminology.

Generalize compiler rules that special-case the literal parent_id to inspect actual self-referencing FK metadata. Apply a self-reference restriction only where the intended domain rule supports it. A column name alone does not prove a relationship or authorize a constraint.

For existing/imported schemas, preserve physical names. Offer a clearer display label or an explicit dependency-aware rename. Naming style is advisory and cannot block successful generation or silently rewrite deployed objects.

### Contract fidelity

Record explicit requirements, chosen conventions, model assumptions, and unresolved business decisions separately. Use exact types, namespaces, referenced columns, ordered composite pairs, default/nullability semantics, relevant FK actions/timing, and policy decisions where required. Do not guess every FK points to id.

Do not impose UUID IDs, timestamp columns, or other conventions where they conflict with explicit requirements. Normalize ordinary intentional SQL defaults deterministically. Ask only when meaning, identity, or access is unresolved. Check the generated blueprint against the original request as well as checking workers against the blueprint.

Add a pure fulfillment checker for required fields, relationships, uniqueness, vocabulary constraints, and chosen access rules. Executable SQL can still omit a requested relationship; successful execution alone is insufficient.

### Acceptance

- A nested-comment schema generates parent_comment_id consistently across every representation.
- Two references to users retain distinct business roles.
- Explicit user/imported names survive unchanged.
- Naming-only suggestions never prevent completion.
- A missing required FK or vocabulary is detected even when its weaker SQL executes.
- Fully specified repairs preserve the original requirement rather than weakening it.


## 7. C1 — Reliable connections in the artifact the user actually opens

### Work

1. Identify the qualification build with a real app version, source revision, build time, and release channel. Include a safe About/diagnostics view. Distinguish checkpoint builds from the main installation.
2. Reuse the current native Supabase transport. Route connection tests, catalog reads, deployment, CSV helpers, and other privileged calls through the guarded bridge. Eliminate old browser-fetch execution paths.
3. Send opaque sb_secret_ keys as API keys with correct endpoint-specific headers. Retain supported legacy JWT handling during migration. Never treat a key prefix as proof of authority.
4. Use Keychain-backed credential handles scoped to the verified target. Test missing/locked/denied credentials, replacement, disconnect, and deletion without leaking values.
5. Preserve native HTTP guards: approved origins/targets, HTTPS except explicit localhost, no credential-bearing redirects, bounded payloads, and correct bodyless handling for HTTP 204/205/304.
6. Keep browser privileged administration fail-closed with an understandable desktop/export continuation. Do not bypass the gateway by spoofing browser identity.
7. Consolidate connection state across import, designer, studio, and dashboards. Separate saved configuration, an open session's immutable target, and the designer's confirmed baseline target.
8. Expose operation-specific readiness: reachable, catalog readable, query available, CSV setup ready, guarded migration available, and dashboard read authority ready. “Saved” and “connected” do not imply permission for every operation.
9. Remove duplicate error prefixes. Translate known errors into an action and retain sanitized technical detail in an expandable report.
10. Provide connection rename/edit/test/remove and credential replacement. An edit must not silently retarget an existing query tab, running import, dashboard, or unresolved journal.
11. Make required helper installation/version upgrades a concrete reviewed setup step. A successful health request alone is insufficient.
12. Use a separately restricted read capability for AI-assisted data queries and dashboards where needed. A privileged connection is not a fallback for a missing read-only authority. Database permissions and transaction restrictions, not SELECT keyword matching, enforce the boundary.

### Acceptance

- The rebuilt installed app connects using a real sb_secret_ key through native transport.
- No privileged request falls back to browser fetch.
- The same connection can be selected consistently from every workflow.
- Permission/setup problems identify the missing capability.
- Editing a connection cannot change the destination of an in-flight job.
- Keys are absent from projects, chat, logs, support exports, browser storage, and bundles.
- Native direct/session-pooler PostgreSQL and Supabase API capabilities are tested separately.
- Hosted tests use explicitly disposable targets; unavailable external gates remain reported as untested.

## 8. D1 — Faithful design, deployment, and management handoffs

### Exact schema editing

Use dependency-aware semantic operations for rename, type/null/default edits, key changes, and deletion. Update exact keys, ordered FK pairs, indexes, checks, and known dependent expressions atomically. If an opaque dependent definition cannot be rewritten faithfully, stop that specific rename and expose review/export; do not guess with string replacement.

Keep original SQL buffers and last-good designs when parsing fails. Whole-document replacement and clearing are explicit local operations. Preserve versioned migrations, recovery copies, cross-window conflict detection, undo/redo, and save-as-copy.

An executed database operation stays in its journal even if the local design is undone. Undo cannot make previously sent SQL eligible for automatic replay.

### Design acceptance versus deployment proof

A candidate can be saved and inspected even when unsupported objects limit direct deployment. Show separate requirement coverage, SQL evidence, supported deployment scope, and operation outcome. Do not label invalid SQL as successfully validated or unsupported coverage as a schema error.

Only the executable verification gate may mint ValidatedSchema. Persisted historical reports cannot recreate a deployment capability. Verify the exact artifact and intended supported schema before privileged execution.

Preserve supported parse → emit → parse semantic equality, namespaces, quoting, ordered keys, expressions, timing/actions, validation state, and raw recovery text. Unsupported-only changes remain visible blocked work, never “Synced.” Use deferred FK creation for cycles. Do not infer renames by similarity or generate lossy DROP TABLE CASCADE migrations.

### Deployment and reconciliation

- Compare confirmed baseline, fresh live snapshot, and intended local design.
- For first deployment to a nonempty database, construct a reviewed final intent that preserves unrelated live objects. Do not compare a canvas-only schema against the whole live database after writing.
- Merge only disjoint semantic changes. Overlapping divergence requires an explicit decision.
- Show target, exact immutable SQL, effects, access decisions, support limits, and locking/destructive implications in one review.
- Recheck target state immediately before execution using the guarded execution boundary.
- Journal immutable SQL and baseline/live/intended fingerprints before mutation. Preserve prepared, sent, outcome-unknown, verified, and rejected.
- An ambiguous network result never triggers automatic replay. Restart resolves the existing operation.
- Advance a baseline only after a fresh exact catalog matches immutable intended state. Failed introspection retains the previous baseline and journal.
- Existing-row compatibility requires target-data checks for added uniqueness, NOT NULL, CHECK/FK constraints, narrowing/casts, and destructive changes. Empty-schema rehearsal cannot establish those properties.
- New-table access is an explicit reviewed policy choice presented in business language. Imported policies are preserved. Policy syntax checks are not proof of real-role access behaviour.
- Keep ordinary public-table exact sync and the allowed external auth.users FK target as the current envelope. Displaying other objects does not expand deployment support.

Finish and qualify the existing guarded Supabase lifecycle. Native studio SQL is not automatically equivalent to guarded native designer deployment; implement and qualify a purpose-bound native migration adapter before advertising that capability.

### Correct index advice

Replace the universal prefix-index redundancy assertion with a bounded advisory. Consider exact keys/expressions, uniqueness, predicates, methods, order/null placement, operator classes, collations, INCLUDE fields, and constraint dependencies before even proposing equivalence.

Treat exact duplicates and overlapping prefixes separately. An overlapping index is a performance question requiring relevant query plans/workload evidence. Remove automatic prefix-index dropping under the current assumption; retain explicit reviewed removal as an optional action. Do not remove a legitimate single-column unique index because a composite primary key contains that column.

Supabase's actual unused-index rule reads recorded usage statistics; VibeDB must not claim a static overlap test is a live Supabase finding. Reference: [Supabase unused-index rule](https://github.com/supabase/splinter/blob/main/lints/0005_unused_index.sql).

Show findings in a persistent review/activity panel with all affected objects, evidence, blocking scope, and available decisions. Brief toasts may announce completion, but must not be the only home for eleven advisories.

### One continuation into the studio

Introduce one query/dataset handoff carrying exact SQL or dataset ID, source, intended connection, and revision. Route View Data, seed previews, Query Lab, imports, and dashboard drill-through through it. Opening a draft never executes it.

Use a display catalog for browsing accessible objects and a separate exact catalog for proof. Unsupported-for-sync views, schemas, or index definitions must not erase otherwise readable tables from the explorer. A query error is not an empty table; a catalog-refresh error must not erase successful query results.

### Acceptance

- Rename an imported key in the UI, then save, undo/redo, reload, and export without stale dependencies.
- Valid unsupported designs remain inspectable/exportable with accurate coverage.
- Empty and nonempty target deployments verify through the actual guarded path.
- Stale review, changed target, external drift, and unknown acknowledgement stop safely.
- Query Lab and View Data reach the current studio with the right identity.
- The prefix-index counterexample remains advisory and does not remove the useful index.
- Findings remain available until resolved or deliberately dismissed.

## 9. I1 — Conversational CSV import with a live plan

### Main interface

Replace the dense import modal with one task surface: conversation, live data/structure preview, and a compact persistent plan summary. The same surface can switch between previewing columns, relationships, and the eventual dashboard.

Primary entry: **Add data**. Accept a file immediately; ask what the person wants to do if it is not already clear. For a spreadsheet-to-dashboard task, data import is the default. Keep “Use structure only” as a clear secondary action for designers.

Expose direct controls for file selection, connection credentials, date formats, field mapping, and review. Conversation must not force people to describe every correction in prose. Secure connection fields never become ordinary chat messages.

### Conversation behaviour

- Show a small preview promptly, with provisional type suggestions and scan progress. Do not claim a full row count or uniqueness proof from a sample.
- Interpret the user's objective first: combine monthly sales, track inventory, compare regions, or design a schema.
- Ask about a business ambiguity only when it changes the result: order versus order item, whether a field is a stable identifier, which date is the reporting date, or whether a new export replaces prior data.
- Ask a small number of focused questions at a time. Reuse answers already provided.
- Offer defaults as visible proposals, not repeated questionnaires about database terminology.
- Permit “Keep it as one dataset” without treating that as an advanced failure escape.
- Distinguish append/stack, relate/join, and update/replace. Use examples and the live preview to make the choice concrete.
- Show changes to the plan after each accepted answer. A rejected suggestion must not reappear unchanged in a model loop.
- If a provider fails, retain the plan and preview. Deterministically specified imports can continue without another AI call.
- Cancellation or a changed project/target invalidates stale AI responses. An in-flight immutable import cannot be reconfigured by a later chat message.

Illustrative exchange:

User: “Combine these monthly sales files and show sales by region.”

VibeDB: “The columns appear to match. I can combine them into one Sales dataset and retain the source month. Does each row represent an order or an item within an order?”

User: “An item.”

VibeDB: “I will sum line totals for sales and count distinct order IDs for order counts. The proposed destination is Company Reporting. Review the columns and import plan beside this conversation.”

The wording should reflect evidence. “Appear to match” becomes a confirmed mapping only after full validation; illustrative previews are labelled until the real query runs.

### Deterministic plan

Persist a typed, versioned import definition with stable dataset/field IDs, source fingerprint, source header/order mappings, destination identity, transformations, row grain, relationship hypotheses, accepted business rules, import mode, access choice, and review fingerprint.

LLM output is runtime-validated and converted into allowed operations. It cannot issue arbitrary privileged writes or treat file text as instructions. A structured plan is accepted independently of a chat transcript.

Give transformations explicit versions and semantics: trim only when chosen; preserve leading-zero identifiers; distinguish NULL, empty strings, omitted/default values, and invalid values; record date/time locale and currency/unit meaning. Column renaming separates source header, friendly label, and physical identifier.

Duplicate/blank/long headers receive a visible source-to-field mapping instead of requiring the user to edit the original file before every import. Physical names remain collision-safe within PostgreSQL limits. Preserve an exact source-position mapping for diagnostics.

### Review and publication

The review card identifies files, verified/provisional counts, destination, tables/fields, relationships, access scope, create/append/update/replace effects, and unresolved issues. One explicit import action binds the approved plan to immutable execution intent. Additional review is required only when that intent changes materially.

Never silently discard invalid rows. Default to stopping publication with precise actionable findings. If a later supported quarantine/exclusion mode is chosen, disclose and account for accepted/rejected rows and retain details in customer-controlled storage.

After verified publication, open the imported dataset itself and offer its next useful view. Carry its exact dataset ID, destination, and data version forward. A generic SQL tab showing current_database() is not import completion.

### Acceptance

- A nontechnical user can add one CSV, answer only material questions, review, import, and see the dataset.
- The same result can be reached through direct controls if AI is unavailable.
- Leading zeros, NULL/empty values, multiline quoted fields, and exact numeric values survive.
- Wrong data types produce field/record-specific decisions without silently dropping data.
- A plan survives restart; source-file reselection is requested only when access must be re-established.
- Source/destination/transform changes cannot retarget a running or resumable job.
- A successful import opens the exact dataset; a separately failed designer reconciliation is reported separately.

## 10. Import execution, storage, and large-file architecture

Reuse the current streaming parser, immutable destination binding, staged import jobs, acknowledgements, and publication proof. Refactor the UI around these capabilities rather than replacing them with a model-driven uploader.

### Staging and typed interpretation

Preserve original source values in a customer-side landing/staging representation while typed conversion is being established. Typed business tables or views can then be produced through the reviewed transformation plan. The exact physical strategy must preserve recoverability and avoid unnecessary permanent duplication.

VibeDB stores transformation definitions and source lineage, not every row. Retention/cleanup of customer-side staging is explicit and tied to job resolution. Explain that raw staging, typed tables, indexes, and recovery can require more server storage than the original file; show estimates where meaningful and unknowns where not.

Validate keys, conversions, relationship coverage, and reconstruction across the complete staged dataset. Sampling can suggest a type or key but cannot certify it. Temporary server-side staging structures do not silently expand the designer's exact-sync support envelope.

### Bulk loading

The current implementation scans the file for analysis, rechecks its identity before upload, and reads again to upload. Preserve the identity guarantee while reducing avoidable repeated work. Fast previews and background scanning should improve responsiveness without treating a partial scan as complete validation.

For direct PostgreSQL, evaluate and implement bounded COPY FROM STDIN loading into job-owned staging, with transactional chunk receipts and safe retry boundaries. PostgreSQL transmits STDIN data over the client connection. Reference: [COPY documentation](https://www.postgresql.org/docs/current/sql-copy.html).

For the Supabase API adapter, use its qualified bounded upload capability or an explicitly chosen supported direct PostgreSQL route. Do not assume the REST path supports native COPY or silently change connection type/authority.

Do not send one enormous request or one insert per source row. Control concurrency and backpressure. Memory use must be bounded independently of total file size, including parser, preview, encoding, hashing, upload queues, and IPC copies.

### Recovery and long operations

- Bind checkpoints to the exact file, parser/transform version, approved plan, target, and server job.
- Record source-record boundaries and necessary parser state; CSV byte offsets alone are unsafe around quoted multiline records.
- Inspect server receipts after uncertain acknowledgements. Reconcile what committed before sending further chunks.
- Publication is idempotent by immutable job identity and verified result. Retrying after a committed finish must not publish twice.
- Keep upload, server validation, publication, and post-publication verification distinct.
- An app close pauses a client-dependent upload. Do not promise background completion while the laptop is off.
- Where a server job continues independently, expose that actual state and a durable status/recovery path; do not equate “stopped waiting” with rollback.
- Review short request/session timeouts for full-dataset validation and finalization. Long work needs a qualified resumable server job or bounded stages, rather than an arbitrary promise that one HTTP request will finish.
- Restart with a lost response must inspect the original target/job. A new connection choice cannot adopt its authority.

### Scale qualification

Use generated non-sensitive fixtures of at least 1 GB and 5 GB as explicit qualification targets, not claims of current support. Record exact byte size, row width/count, client hardware, destination capacity, connection type, bandwidth, elapsed time, peak application memory, server storage overhead, and verification cost.

Test malformed records near the end, wide records, interrupted network, app restart, lost final acknowledgement, disk/storage quota failure, lock contention, and a later file selected accidentally. Verify complete row accounting and correct results after recovery.

Set responsiveness/memory targets before implementation and publish measured results for supported environments. Bounded memory does not by itself prove acceptable throughput or server cost. A small-fixture test cannot justify a gigabyte-scale marketing claim.


## 11. Q1 — A useful dataset browser and trustworthy calculations

### Dataset browser

Open the published dataset with search, typed filters, sorting, column inspection, refresh, and paginated records. Push these operations to the database. Use stable unique ordering/keyset pagination where available; identify limits for keyless tables.

Retain precise integers/decimals, NULL versus empty string, JSON, date/time zones, and display formatting. Show incomplete/truncated results explicitly. Exact full-table counts are optional operations, not an expensive prerequisite for opening every table.

Separate “connection unavailable,” “query rejected,” “no matching rows,” and “metadata changed.” An inability to read is not zero rows.

Provide explicit export scopes: current page, current result, or all matching rows. A full export streams to a user-chosen destination and is a deliberate exception to the default absence of a local dataset copy. Export must preserve values and handle spreadsheet interpretation of formula-like text explicitly.

### Semantic calculations

Persist approved calculations as structured definitions with stable references. Initial operations: count rows, distinct count, sum, minimum/maximum, average, grouping by a field/time period, typed filters, sorting, and top-N.

Every metric has a known row grain. For order-item data, total sales can sum line amounts; order count uses distinct order IDs. Joining customers must not multiply sales. A many-to-many relationship requires an explicit analytic treatment rather than an automatic join.

Validate relationship cardinality and unmatched/null keys against the complete relevant dataset, with evidence bound to publication version. Refresh that evidence when new imports can invalidate it.

Define handling for nulls, duplicate source events, time zones, week/month boundaries, incomplete periods, units, and currencies. Do not sum mixed currencies without an explicit conversion rule. Preserve database numeric precision; formatting is not storage conversion.

### Query execution

Generate parameterized values and correctly quoted identifiers from typed definitions. User-visible SQL remains available for inspection. Apply filters and aggregations in the customer's database before returning bounded results. Never calculate a dashboard over the studio's first 100 or 5,000 returned rows.

Use qualified read authority and database-enforced restrictions. Do not revive a disabled privileged SQL helper or rely on keyword checks to make arbitrary AI SQL safe. Model proposals that exceed the query builder's supported semantics remain inspectable drafts rather than automatic execution.

Bind results to target identity, dataset/query revisions, filter values, and observation time. Cancel or invalidate obsolete requests after changes. Keep row/byte limits, query timeouts, concurrency, and user cancellation visible. Expensive queries need a useful explanation, not an invented result.

AI is not required to refresh a saved calculation. Ordinary compiled queries should run with no model call. Schema-only assistance and analysis of selected result values remain separate sharing scopes.

### Acceptance

- Filtering/sorting/pagination work on the full dataset without downloading it.
- Correct totals remain unchanged when the visible grid page size changes.
- A one-to-many join cannot silently inflate sums.
- Precise amounts, order counts, time buckets, and NULL behaviour match independent reference SQL.
- Changed dataset/target/query context cannot display an old result as current.
- A saved metric survives restart and refreshes without AI.

## 12. B1 — Private dashboards over the customer's database

### First supported dashboard

Provide four useful components: number/KPI, table, bar chart, and time series. Support titles, readable labels, number/date formatting, date/category filters, basic layout/reordering, manual refresh, and drill-through to underlying matching records.

A user can ask “Show total sales by month and the top customers,” or configure the same view directly. Translate the request into the supported saved metric/query definitions, show assumptions and a preview, and let the person edit the result.

Do not hide ambiguity behind a plausible chart. Ask whether “sales” means gross/net/invoiced/paid if the dataset does not settle it. Once the meaning is approved, reuse it on future refreshes.

### Persistence and identity

Save chart definitions, layout, filter definitions/defaults, formatting, connection reference, dataset/field/metric IDs, and version. Do not save full result arrays in the dashboard or project file.

Display labels may change without breaking references. A physical column or table change requires verified remapping or an explicit unresolved state. Never reconnect a metric to a similarly named object automatically.

Project migrations preserve dashboards and recovery copies. Save/undo/redo apply to definitions; historic database writes remain outside undo. Offline or disconnected mode retains the layout and explains that live values are unavailable.

### Refresh correctness and performance

Run aggregates at the database. A top-N chart should disclose its scope, and a total must come from the full intended dataset rather than the sum of displayed bars.

Coordinate widgets using the same approved filters and publication version. Where the transport supports a consistent snapshot, use it for one logical refresh. Otherwise disclose per-result observation times and do not claim a transactionally consistent cross-widget snapshot.

Use bounded ephemeral caches keyed by connection, dataset/schema/query revision, filters, and relevant data version. Invalidate after known imports/writes and expose refresh for external changes. A cached value must have an honest freshness indication.

Do not duplicate persistent data on VibeDB infrastructure for performance. If a customer later chooses materialized summaries or database-side caching, create and retain them in their environment through a reviewed plan.

A dashboard query failure should affect its component and retain the saved dashboard. Missing permissions, no matching data, missing fields, and timeouts need distinct states. Do not silently replace errors with zero.

### Acceptance

- Sales CSV → monthly sales, top customers, and a total KPI → save → quit/reopen → refresh correctly.
- Dashboard definitions survive restart without embedding row data.
- Dashboard filters and drill-through select the same population.
- A known import invalidates stale results and preserves layout.
- A field rename/removal surfaces an actionable remapping state.
- Full-dataset results match independent SQL, including duplicate and many-to-many traps.
- No provider call is needed for ordinary refresh.

## 13. U1 — Repeat imports and consolidation that preserve the dashboard

### Import modes

Treat these as distinct reviewed operations:

- **Append:** add new source records; specify how repeated files and duplicate business events are handled.
- **Update by key:** match records by a verified stable business key, with explicit insert/update/conflict rules.
- **Replace dataset contents:** validate a staged replacement and publish through a dependency-aware operation with explicit effects.
- **Combine files:** map corresponding fields and stack compatible records, retaining file/sheet/batch lineage.
- **Relate datasets:** verify the declared join key and cardinality without flattening or duplicating facts unnecessarily.

Chunk identity and source row ordinal establish delivery, not business deduplication. A file hash detects repeated content; it does not prove two identical rows are the same real-world event.

### Reuse definitions

When the next file arrives, identify candidate mappings from the saved import definition, show changed/missing/new fields, and ask only about differences that matter. Reuse accepted type, date, grain, metric, and key rules.

Maintain stable dataset and field IDs across approved updates. Version mappings and data publication separately. A dashboard continues to reference the logical dataset, while the binding records which verified publication is current.

Do not infer a destructive table rename/drop from a matching label. Replacing contents must preserve dependencies or explicitly review their consequences. Do not silently drop tables, recreate unrelated objects, or use cascading deletion to force completion.

### Publish and recover

Keep the previous usable dataset available until staged validation succeeds and the publication operation reaches its defined commit boundary. Reconcile uncertain commit outcomes by operation identity and target receipts.

Recheck key/cardinality assumptions after updates. A new duplicate customer key can invalidate a previously safe join; block that affected calculation or ask for reconciliation rather than returning inflated totals.

Show inserted, updated, unchanged, rejected, and conflicted counts where the selected operation supports them. Every source record must be accounted for. Retain customer-side lineage and an explicit cleanup/retention policy.

### Acceptance

- Next month's file updates the existing dashboard with no rebuilding.
- Reopening a committed job does not append or publish twice.
- A different file cannot resume an old checkpoint.
- Changed headers receive an explicit mapping review while stable fields remain connected.
- Duplicate/missing business keys produce actionable conflicts.
- Failed replacement leaves the last published dataset usable.
- Multi-file totals and provenance match the combined sources exactly.

## 14. X1 — Genuine Excel workbook support

CSV remains the first proven path. Excel support needs a deliberate implementation, not a broadened file-picker extension.

Add workbook/sheet discovery, sheet selection, header-row selection, duplicate/blank headers, and a preview for each selected dataset. Explain merged/title rows and hidden/empty rows where they affect interpretation.

Handle date serials and workbook date systems, numbers with display formatting, leading-zero identifiers, locale, and error cells. Distinguish a formula from its stored/cached result. Do not silently claim formula recalculation; unsupported or missing cached values require a clear values-export or review path. Do not execute macros.

Carry sheet and source-cell/row lineage into the import definition. Reuse the same conversational plan, type validation, publication, recovery, and dashboard identities as CSV.

Large workbook parsing may have different memory behaviour from CSV. Measure it separately and declare supported workbook limits. A CSV scale test does not qualify an XLSX parser.

### Acceptance

A real multi-sheet workbook with different headers, dates, formatted identifiers, formulas/cached values, and blank/title rows imports predictably; unclear cells are exposed; the resulting dataset and dashboard survive an updated workbook.

## 15. M1 — Management studio improvements that support the same flow

Deliver the minimum browser/query capabilities before B1. Broader administration follows without blocking the business-data milestone.

### Durable SQL work

Persist query text, title, source, target identity/label, and revision independently of sessions or results. Restore drafts disconnected, with no automatic SQL execution or transaction recreation. Support rename/duplicate/open/save and clear close behaviour.

Keep Design SQL and Database SQL visibly distinct. The first edits a local definition; the second executes against the shown live destination. Manual SQL execution cannot automatically advance a designer baseline.

Preserve the draft after a known PostgreSQL rejection. Show safe SQLSTATE/position detail. A conclusively open failed transaction should permit explicit rollback; an uncertain/broken session must not be silently reconnected and replayed.

Native sessions may expose persistent transaction controls. Supabase API execution has its per-request boundary; never present Commit/Rollback as if the same session remains open across unrelated requests.

### Record maintenance

Add staged one-table inserts, updates, and deletes for ordinary tables with verified stable keys, including composite keys. Keyless tables, unsupported views, and generated-column limitations remain explicit.

Represent omitted/default, NULL, empty string, and explicit values separately. Review target, row identity, changes, and expected affected counts. Use database concurrency conditions to detect stale edits; retain the draft on conflict or known rejection.

Journal write intent and verify outcome according to the transport. Unknown acknowledgements never trigger automatic retry. API record writes need their own qualified typed atomic capability; native support does not prove API parity.

Seed data is a separate reviewed data operation with dependency ordering, conflict policy, and receipts. It should lead into the same dataset browser rather than an obsolete Query Lab.

### Support expansion and exports

Keep functions, triggers, extensions, non-public management, complex indexes, enums, and sequence semantics explicit in the capability matrix. Extend parser, representation, emitter, catalog, comparison, proof, persistence, and migration together when a feature is deliberately added.

Prioritize common support gaps after the first reliable spreadsheet/dashboard release; do not silently replace unsupported definitions to pass validation. SQL export remains faithful with opaque recovery. Advertised ORM/other exports need declared mappings and actual target-toolchain validation.

## 16. Verification matrix and release gates

The reusable product fixture should contain customers, orders, and order items, with composite/role-specific relationships, exact money values, leading-zero identifiers, NULL/empty distinctions, duplicate keys, and dates around reporting boundaries. Add a nested-comments fixture for clearer generation names and a separate large synthetic CSV fixture.

| Scenario | Required outcome |
|---|---|
| Invalid/unavailable worker model after a successful blueprint | Actionable stage/model error, retained blueprint, bounded calls |
| Complete worker output but missing quantity required by CHECK | Exact completion when specified, otherwise one focused decision; no endless Resume |
| Table-scoped CHECK names, composite PK plus separate unique key, quoted punctuation | Correct semantics; no false rejection/crash |
| Nested comments with explicit relationship | parent_comment_id consistently generated; imported parent_id preserved |
| Optional overlap advisory | Generation/deployment eligibility not incorrectly blocked; no automatic prefix-index drop |
| sb_secret_ in the actual packaged desktop app | Native transport and scoped credential handling; no browser fallback |
| Browser privileged admin attempt | Clear unavailable capability and export/desktop continuation |
| Nonempty deployment target and external drift | Preserved intended state, reviewed conflict/merge, exact post-write proof |
| Lost migration acknowledgement | Original journal retained; no replay or premature baseline advance |
| Single CSV through conversation | Preview, approved plan, publication, direct dataset opening |
| Provider unavailable during import setup | Saved plan retained; fully specified deterministic route remains usable |
| NULL, empty, multiline, leading zero, large decimal/integer | Fidelity through parsing, storage, query, display, and explicit export |
| Incorrect type/key late in a large file | No silent data loss; precise report and controlled publication |
| Import disconnect/restart/unknown finish | Original job and destination resolved; no duplicate publication |
| Same file or same-looking events imported again | Explicit business semantics, independent from transport idempotence |
| Dashboard sums/counts with duplicate/one-to-many joins | Matches independent full-dataset SQL |
| Result/grid page cap | Cannot change aggregate totals |
| New data violates earlier relationship cardinality | Affected metric becomes unresolved rather than incorrect |
| Dashboard save/restart/column changes | Definitions survive, data fetched only through intended connection, explicit remapping |
| Concurrent record edit | Conflict retains draft; no silent overwrite |
| 1 GB and 5 GB qualification fixtures | Measured bounded memory, complete accounting, acceptable declared throughput, tested recovery |
| Real Excel workbook | Explicit sheet/header/formula-value semantics and verified output |

### Test ladder

1. Pure contract, naming, mapping, metric, and repair tests with real semantic fixtures. Test idempotence, stale revisions, and negative cases.
2. Actual PGlite parse/emit/execute/catalog checks, including engine unavailable/busy/cancelled behaviour. Mocks cannot mint real proof.
3. Chromium and WebKit journeys for generation, conversation, preview, persistence, stale responses, and capability-limited browser behaviour.
4. Real PostgreSQL for catalogs, read authority, transactions, joins, precision, import publication, concurrency, locks, and failure injection.
5. Explicitly disposable hosted Supabase for actual secret-key gateway behaviour and shipping helper/guard routes.
6. Deliberately authorized real-provider generation samples. Record requirement fulfillment and failure causes; mocked responses do not establish provider quality.
7. Rebuilt installed Tauri app: version identity, Keychain flows, native bridge, connection/import/dashboard paths, restart/offline behaviour, and packaging assets. Distribution requires the relevant signing/notarization and install checks.

Use the repository rule after every future code edit: focused verification, npm run check, then diff inspection. Run npm run build at meaningful integration/release points. Rust changes require formatting, checking, linting, and tests. Browser changes exercise both engines where practical.

Report external gates as passed, failed, or not run with the exact missing prerequisite. Do not hard-code suite counts or describe the app as production-ready solely because local checks pass.

### Two release journeys

**Design journey:** prompt → generation recovery if needed → accepted design → dependency-aware edit → save/restart → connect → reviewed deploy → verified live catalog → browse/query → external drift → reviewed reconciliation → interrupted-operation recovery.

**Business journey:** sales files → conversation establishes row grain and mappings → choose customer database → verified import → browse/filter → saved monthly sales/top-customer dashboard → restart → next file → same dashboard with correct totals → interrupted refresh/import resolved without duplicate writes.

A milestone is complete only when its promised journey works in the declared runtime. A successful isolated component is useful evidence but not the product outcome.

## 17. First implementation backlog

These tasks are proposed and unchecked. Coding begins only after a later explicit implementation request.

- [ ] Reproduce the known G0 failures and record the source/artifact identities without disturbing unrelated working-tree changes.
- [ ] Correct the first verifier false blockers and add the exact semantic regressions.
- [ ] Deliver retained-candidate inspection, one exact missing-column repair or focused decision, recheck, acceptance, and restart recovery.
- [ ] Surface effective blueprint/worker model choices and useful sanitized provider errors.
- [ ] Update naming prompts/contracts together; replace parent_id-only compiler assumptions.
- [ ] Narrow incorrect index-overlap advice and automatic removal; keep all findings accessible.
- [ ] Qualify the native secret-key connection in one deliberately identified installed build.
- [ ] Establish shared connection, dataset, field, import-plan, metric, and dashboard identities using versioned migrations.
- [ ] Deliver one conversational CSV-to-customer-database journey with direct dataset handoff.
- [ ] Add database-side browsing and reference-tested metric definitions.
- [ ] Deliver four basic dashboard components with save/restart/filter/drill-through.
- [ ] Add repeat imports and consolidation while preserving dashboard identity.
- [ ] Qualify large-file performance and failure recovery with measured fixtures.
- [ ] Add genuine Excel workbook support and then broaden daily SQL/record maintenance.
- [ ] Complete supported-backend and installed-artifact release qualification; update capability claims from measured evidence.

## 18. Source map and implementation touchpoints

The links below identify current areas to inspect and extend in the active checkout; they are not instructions for a broad rewrite.

| Area | Existing touchpoints |
|---|---|
| Prompt conventions and blueprint/table generation | `server/ai-local.mjs`; `src/lib/contract-pass.ts` |
| Provider settings, transport, and retained generation | `src/lib/ai-provider-settings.ts`; `src/lib/ai-client.ts`; `src/lib/generation-run.ts`; `src/lib/generation-history.ts` |
| Candidate recovery UI and orchestration | `src/components/vibedb/GenerationRecoveryPanel.tsx`; `src/pages/VibeDBPage.tsx` |
| Deterministic repair and validation | `src/lib/compiler-pass.ts`; `src/lib/verification/gate.ts`; `src/lib/verification/engine.ts` |
| Exact schema and persistence | `src/lib/types.ts`; `src/lib/schema-document-session.ts`; `src/hooks/use-schema-document.ts`; `src/lib/project-storage.ts` |
| SQL fidelity and comparison | `src/lib/sql-ddl-parser.ts`; `src/components/vibedb/ExportGenerators.ts`; `src/lib/schema-diff.ts` |
| Connection identity and native credentials | `src/lib/database-connections.ts`; `src/lib/native-credentials.ts`; `src/components/vibedb/DatabaseConnectionForm.tsx` |
| Supabase and native execution | `src/lib/supabase-deploy.ts`; `src/lib/supabase-integration.ts`; `src/lib/native-postgres.ts`; `src-tauri/src/main.rs`; `src-tauri/src/postgres.rs` |
| CSV plan, streaming, and jobs | `src/components/vibedb/CsvImportModal.tsx`; `src/lib/csv-stream.ts`; `src/lib/csv-import-job.ts`; `src/lib/csv-schema-sql.ts`; `src-tauri/src/csv_import.rs` |
| Database workspace and data assistance | `src/components/vibedb/DatabaseWorkspace.tsx`; `src/components/vibedb/AskDataPanel.tsx`; `src/components/vibedb/QueryBuilderPanel.tsx` |
| Dashboard groundwork | `src/components/ui/chart.tsx` provides chart primitives; dataset/metric/dashboard application models and builder remain planned work |
| Earlier evidence and qualification | `VIBEDB_COMPLETION_AUDIT_2026-10-26.md`; `VIBEDB_END_TO_END_REPAIR_PLAN_2026-10-26.md`; `DATABASE_WORKSPACE_AND_CSV_2026-09-11.md`; `CSV-AND-CONCURRENCY-QUALIFICATION.md`; `SECURITY-VERIFICATION-QUALIFICATION.md` |

Read the applicable `AGENTS.md` before implementation. Preserve unrelated user changes. Keep edits to the large VibeDBPage surgical; broad extraction is a separate task.

This note consolidates the current product direction and implementation sequence. Earlier notes and audits remain historical context; their old feature descriptions or working-tree claims are not automatically current. No customer data, credentials, or screenshot contents containing secrets are embedded here.

## 19. Deferred scope and decisions to settle at the relevant milestone

- Additional database engines require qualified adapters, dialect semantics, permissions, loading, and recovery. Oracle feasibility remains research, not a promise in this release.
- Cross-database analytics needs an explicit customer-controlled consolidation/federation design.
- Shared web dashboards require a deliberate access, hosting, and credential architecture. Do not introduce a product authentication/billing system as an incidental dependency of private dashboards.
- Scheduled imports while the device is offline need a customer-controlled worker or other explicitly selected execution environment.
- Persistent result caching/materialized summaries are opt-in future capabilities stored in the customer's environment.
- Choose supported locale/time-zone and CSV dialect coverage before I1 release; show unsupported inputs clearly.
- Choose quantitative responsiveness, memory, and throughput targets before L1 implementation and report actual measurements.
- Confirm the physical raw/typed storage and cleanup strategy with recovery guarantees before exposing replacement imports.
- Extend exact schema support only through complete representation/round-trip/catalog/proof changes.

The next coding request should begin with G0's thin complete recovery path and C1's installed connection verification, then proceed through I1 → Q1 → B1. All later scope remains visible here without becoming a prerequisite for that first useful business workflow.
