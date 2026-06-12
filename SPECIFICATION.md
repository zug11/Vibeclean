# VibeDB — Repository Specification

**Repo:** `Vibeclean` · **Product:** VibeDB — AI-powered visual database schema designer
**Stack:** React 18 + TypeScript + Vite 5 (SWC) · Tailwind 3 + shadcn/ui · Supabase (Auth, Postgres, Edge Functions) · Anthropic Claude · Stripe
**Last updated:** June 12, 2026

This document explains every directory and file in the repository, what it does, and how the pieces fit together. For the upcoming sprint plan, see `CTO_SPRINT_GUIDE.md`.

---

## 1. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Browser (React SPA, Vite)                                   │
│  ┌──────────────┐  ┌───────────────┐  ┌──────────────────┐  │
│  │ VibeDBPage   │→ │ compiler-pass │→ │ ExportGenerators │  │
│  │ (canvas/IR)  │  │ (7 passes)    │  │ (SQL/Prisma/...) │  │
│  └──────┬───────┘  └───────────────┘  └──────────────────┘  │
│         │ IndexedDB (project-storage)                        │
└─────────┼────────────────────────────────────────────────────┘
          │ HTTPS
┌─────────▼────────────────────────────────────────────────────┐
│  Supabase                                                     │
│  Auth · Postgres (profiles, schemas + RLS) · Edge Functions   │
│  vibedb-ai (Claude gateway) · vibedb-deploy · Stripe funcs    │
└───────────────────────────────────────────────────────────────┘
```

The **in-memory IR** is `TableNode[]` (defined in `src/lib/types.ts`). The canvas edits it, the compiler mutates it, the export generators serialize it to seven targets, and project storage persists it.

---

## 2. Root Directory

| File | Purpose |
|---|---|
| `README.md` | Product overview, features, setup instructions, environment variables, scripts. |
| `package.json` | App manifest. Scripts: `dev`, `build`, `build:dev`, `lint`, `preview`, `test`, `test:watch`. Note: **`build` does not typecheck** (SWC strips types) and there is no `typecheck` script yet — see sprint guide. |
| `package-lock.json` | Locked dependency tree (npm). |
| `index.html` | Vite HTML entry point; mounts `src/main.tsx`. |
| `vite.config.ts` | Vite config (dev server port 8080, React SWC plugin, `@/` path alias). |
| `tsconfig.json` / `tsconfig.app.json` / `tsconfig.node.json` | TypeScript project references. `tsconfig.app.json` covers `src/` (`strict: false`, vitest globals, `@/*` path mapping). `tsconfig.node.json` covers Vite config files. |
| `eslint.config.js` | Flat ESLint config (typescript-eslint, react-hooks, react-refresh). |
| `tailwind.config.ts` | Tailwind theme — design tokens, colors, animations used by shadcn/ui. |
| `postcss.config.js` | PostCSS pipeline (Tailwind + Autoprefixer). |
| `.env.example` | Template for `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`; documents edge-function secrets (Stripe, Anthropic). |
| `.gitignore` | Standard ignores (node_modules, dist, .env, etc.). |
| `test-ai.js` | Ad-hoc manual script for poking the `vibedb-ai` edge function. Not part of the vitest suite. |
| `test-compiler.mjs` | Ad-hoc manual script exercising the compiler pass pipeline. Not part of the vitest suite. |
| `INVESTOR_PITCH_ANALYSIS.md` | Business document — investor pitch analysis. Not engineering-relevant. |
| `PITCH_DECK_REFERENCE.md` | Business document — pitch deck reference. Not engineering-relevant. |
| `.claude/launch.json` | Claude Code launch configuration. |

> **Note:** Unlike earlier working copies of this repo, the vendored `zod-main-2/` and `kysely-master/` reference trees are **not present** in this clean checkout. Verify test/lint scoping anyway (see sprint guide, Prompt -1).

---

## 3. `public/` — Static Assets

| File | Purpose |
|---|---|
| `favicon.ico`, `favicon.png` | App icons (the PNG is also used in the README header). |
| `placeholder.svg` | Generic placeholder image. |
| `robots.txt` | Crawler directives. |

---

## 4. `src/` — Application Source

### 4.1 Entry & Routing

| File | Purpose |
|---|---|
| `main.tsx` | React entry point; mounts `<App />`, wires Vercel Analytics. |
| `App.tsx` | React Router v6 routes + auth route guards; wraps providers (React Query, tooltips, toasts). |
| `index.css` | Tailwind layers + CSS custom properties (design tokens, dark theme), canvas/FK-line animations. |
| `vite-env.d.ts` | **Missing.** `import.meta.env` is currently untyped (~18 tsc errors). Created in sprint Prompt -1. |

### 4.2 `src/pages/` — Route-Level Views

| File | Purpose |
|---|---|
| `LandingPage.tsx` | Marketing landing page. |
| `AuthPage.tsx` | Login / signup (Google OAuth + email/password via Supabase Auth). |
| `PricingPage.tsx` | Subscription plans; entry to Stripe checkout. |
| `NotFound.tsx` | 404 page. |
| `VibeDBPage.tsx` | **The monolith (~4,800 lines).** The main canvas editor. Contains: the infinite canvas (pan/zoom/drag), table node rendering, FK bezier-curve SVG layer, `runForceLayout` (auto-layout), `useHistory` (undo/redo), `parseSQLDDL` (regex SQL parser), all AI handlers (`handleGenerate`, `handleBatchCommand`, `handleApplySuggestion`, …), compile/export/deploy handlers, the project loader, and the DDL patch ledger. Nearly every sprint item touches this file — locate code by **symbol, not line number**. |

### 4.3 `src/components/vibedb/` — Feature Components

| File | Purpose |
|---|---|
| `ExportGenerators.ts` | (~1,600 lines) Serializes the IR to **seven targets**: PostgreSQL DDL (incl. `DO $$` wrapped CHECKs/deferred FKs), Prisma, Drizzle, GraphQL, CSV, RLS SQL, TS types. Contains `topologicalSort` (FK dependency ordering — currently **throws on cycles**) and `deduplicateSchema`. |
| `SQLViewerModal.tsx` | Read-only SQL preview modal. Replaced by the unified inline SQL editor in sprint Prompt 1. |
| `AIChatPanel.tsx` | Conversational AI assistant; can propose schema changes and raw SQL. |
| `VibeDBSidebar.tsx` | Table library / sidebar; AI table suggestions. |
| `SchemaAuditModal.tsx` | AI audit with 0–100 quality score, rubric, and fix suggestions. |
| `SchemaCompareModal.tsx` | Schema snapshot diff/compare UI (uses `schema-diff.ts`). |
| `SupabasePanel.tsx` | Supabase connection panel; generates RLS SQL and TS types (two `runCompilerPass` call sites — corruption-relevant, see sprint Prompt 2). |
| `DatabaseManagerPanel.tsx` | Live database management against a connected project. |
| `QueryBuilderPanel.tsx` | AI query generation ("describe what you want → SQL"). |
| `AskDataPanel.tsx` | Natural-language questions against data. |
| `MockDataModal.tsx` | AI-generated INSERT statements respecting FK order. |
| `GenerationHistoryPanel.tsx` | History of AI generations (uses `generation-history.ts`). |
| `SREModePanel.tsx` | SRE/observability mode panel (uses `sre-types.ts`). |

### 4.4 `src/components/ui/` — shadcn/ui Library

~50 generated Radix-based primitives (`button.tsx`, `dialog.tsx`, `table.tsx`, `toast.tsx`, `sidebar.tsx`, …). **Vendored boilerplate — do not hand-edit during the sprint**; regenerate via the shadcn CLI if changes are needed.

### 4.5 `src/lib/` — Core Domain Logic

| File | Purpose |
|---|---|
| `types.ts` | **The IR.** `TableNode`, `Column` (incl. `onDelete`, `constraints`, `isForeignKey`/`linkedTableId`), `checkConstraints`, `indexes`, `SchemaEnum`, `DDLPatch`, `AuditReport`. The IR already has every slot the new AST parser needs — no shape change required. |
| `compiler-pass.ts` | (~1,000 lines) `runCompilerPass` — the 7-pass mutating compiler: snake_case naming, **CHECK injection (hallucinatory)**, FK index injection, dedup, timestamp defaults, semantic constraint fixes, **standard-column injection (hallucinatory)**. Runs at **13 call sites** (7 user-driven = the corruption; 6 AI-driven = intended). Full audit in `COMPILER_REDESIGN.md` (companion doc, external). |
| `project-storage.ts` | IndexedDB persistence. `StoredProject { id, name, definition, … }` — **no `schemaVersion` field yet**; `DB_VERSION = 1` is the object-store version only. Versioned envelope + migrator added in sprint Prompt -1. |
| `schema-diff.ts` / `schema-diff.test.ts` | Structural diff between two IRs (added/modified/removed tables); the repo's **only real unit test**. |
| `supabase-integration.ts` | Connect/introspect a target Supabase project via PostgREST OpenAPI. Contains the **undeclared `OpenAPIPathMethod`** type hole (sprint Prompt -1, Part C). |
| `database-connection.ts` | Direct database connection helpers for the manager/ask-data panels. |
| `generation-strategies.ts` | AI model strategy registry (e.g. quality vs `v3-fast`/Haiku routing); `getDefaultStrategy()`. |
| `generation-history.ts` | Persists past AI generations. |
| `generation-tracker.ts` | Tracks step-by-step progress of an in-flight generation (drives the progress UI). |
| `sre-types.ts` | Types for the SRE mode panel. |
| `utils.ts` | `cn()` class-merge helper. |
| `domains/` | Domain-specific rule modules — `healthcare.ts`, `quant-finance.ts`, `pe-vc.ts`, `index.ts` (registry). Detect a domain from table/column names and inject 13–20 CHECK rules. **Heavily hallucinatory**; slated to become opt-in suggestions, not silent mutation. |

### 4.6 `src/hooks/`

| File | Purpose |
|---|---|
| `use-auth.tsx` | Supabase auth context/provider (session, profile, credits). |
| `use-mobile.tsx` | Responsive breakpoint hook. |
| `use-toast.ts` | Toast state hook (paired with `components/ui/toaster`). |

### 4.7 `src/integrations/supabase/`

| File | Purpose |
|---|---|
| `client.ts` | Supabase JS client singleton, configured from `import.meta.env` (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`). |
| `types.ts` | Generated Postgres types for the app's own database (`profiles`, `schemas`). |

---

## 5. `supabase/` — Backend

| Path | Purpose |
|---|---|
| `config.toml` | Supabase CLI project configuration. |
| `migrations/001_initial_schema.sql` | `profiles` + `schemas` tables, RLS policies, auth trigger (auto-create profile). |
| `migrations/002_subscription_credits.sql` | Subscription tier + AI credit columns. |
| `functions/vibedb-ai/index.ts` | **The AI gateway** (Deno). Routes all request types (generate, audit, chat, batch-command, mock data, queries) to Claude; owns model selection (`useFastModel`, `fastTypes`), token budgets (`longOutputTypes`), and the `truncated` flag. Batch-edit truncation and Haiku routing fixes land here (sprint Prompt 0, Parts E–F). |
| `functions/vibedb-deploy/index.ts` | Deploys generated DDL to a target Supabase project: dependency-ordered, idempotent, dollar-quote-aware statement splitting. |
| `functions/check-subscription/index.ts` | Returns subscription status + remaining credits. |
| `functions/create-checkout/index.ts` | Creates Stripe Checkout sessions. |
| `functions/buy-credits/index.ts` | Credit top-up purchases. |
| `functions/customer-portal/index.ts` | Opens the Stripe customer portal. |
| `functions/stripe-webhook/index.ts` | Handles Stripe webhook events (subscription lifecycle, payments). |

---

## 6. Key Data Flows

1. **AI generation:** `VibeDBPage.handleGenerate` → `vibedb-ai` (Claude) → parse → position → `runCompilerPass` (full mode, intended) → `resolveCanvasFKsBidirectional` → `setCanvasItems` → auto-save to IndexedDB.
2. **Manual canvas → SQL:** `handleCompileSQL` → *(currently `runCompilerPass` — the corruption bug)* → `generateSQL` → viewer.
3. **Import:** `handleImport` → `parseSQLDDL` (regex; drops UNIQUE/CHECK/indexes/ON DELETE) → canvas. Replaced by an AST parser in sprint Prompt 4.
4. **Deploy:** compile → validate → `vibedb-deploy` → target Supabase project.
5. **Persistence:** auto-save every 3s to IndexedDB (`project-storage.ts`); cloud save to the `schemas` table.

## 7. Known Architectural Hotspots (carried into the sprint)

| Hotspot | Where | Status |
|---|---|---|
| Build doesn't typecheck; no `typecheck` script | `package.json` | Prompt -1 |
| `import.meta.env` untyped (~18 tsc errors) | missing `src/vite-env.d.ts` | Prompt -1 |
| Persisted IR unversioned | `project-storage.ts` | Prompt -1 |
| Empty-canvas race (unguarded async project loader) | `VibeDBPage.tsx` loader `.then` | Prompt 0 |
| `useHistory` stale-closure bug | `VibeDBPage.tsx` | Prompt 0 |
| Compiler corruption at 7 user-driven sites | `VibeDBPage.tsx`, `SupabasePanel.tsx` | Prompts 2–3 |
| `topologicalSort` throws on FK cycles | `ExportGenerators.ts` | Prompt 2 |
| Lossy regex SQL parser | `parseSQLDDL` in `VibeDBPage.tsx` | Prompt 4 |
| No diagnostics engine | — | Prompts 5–6 |
| Naive force layout → overlapping nodes, spaghetti edges | `runForceLayout` in `VibeDBPage.tsx` | **New UX epic — see CTO guide §4** |
