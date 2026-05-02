# VibeDB — Pitch Deck Reference Document

> **Product:** VibeDB · **URL:** [vibedb.me](https://vibedb.me) · **Repo:** [github.com/zug11/Vibeclean](https://github.com/zug11/Vibeclean)

---

## 1. The Problem

Database schema design is one of the highest-friction steps in modern software development. Developers are forced to choose between:

- Writing raw DDL SQL by hand — brittle, hard to read, no visual context
- Using GUI tools that don't integrate with AI coding agents
- Relying on platforms like Supabase's built-in editor — functional but locked to their ecosystem

For AI-native developers using Claude Code, Cursor, or Codex, there is **no canonical visual schema layer** that understands their database *and* talks to their agent. The schema lives in disconnected SQL files, Prisma configs, or migrations — never as a living, queryable source of truth.

---

## 2. The Solution (Today)

**VibeDB** is an AI-powered visual database schema designer. It lets developers describe, build, and deploy production-grade PostgreSQL schemas through a drag-and-drop canvas — with Claude-powered AI built in at every step.

### Current Core Features

- **Infinite visual canvas** — drag, drop, and connect tables with FK relationship lines rendered as smooth bezier curves
- **Complete schema modeling** — 10+ column types, constraints, indexes, check constraints, enums, functions, and triggers
- **AI superpowers via Claude** — schema generation from plain English, batch edit commands, smart column suggestions, schema audit scoring (0–100), AI chat assistant, SQL query generation, and realistic mock data (INSERT statements respecting FK relationships)
- **Export anywhere** — PostgreSQL DDL, Prisma, Drizzle, GraphQL, CSV
- **One-click deploy to Supabase** — pre-deploy validation, smart FK ordering, idempotent re-deploy, dollar-quote-aware function deployment
- **Schema quality tools** — AI audit, deduplication, linting, schema diff, and auto-fix
- **Cloud-backed project management** — auto-save every 3 seconds, Google OAuth / email auth, Stripe-powered subscriptions and AI credit system

### Current Positioning

VibeDB today operates as a **deployment and design tool** — it generates SQL DDL that can either be:
1. Deployed directly to a connected Supabase project (one-click), or
2. Copied and run against any PostgreSQL-compatible SQL interpreter

This makes it immediately useful to every developer on any Postgres-backed stack, with zero migration required.

---

## 3. The Vision (Where We're Going)

> **VibeDB is becoming its own SQL server — a visual-first, AI-native database platform built to rival Supabase.**

The long-term product is not just a design tool that deploys *to* someone else's database. It is the database.

### Roadmap

| Phase | Feature | Description |
|-------|---------|-------------|
| **Now** | Visual schema designer + Supabase deploy | Production-ready DDL, one-click deploy, AI-assisted design |
| **Near** | DML execution layer | Execute INSERT, UPDATE, DELETE directly from the canvas — the schema becomes a live data editor |
| **Near** | Hosted SQL server | VibeDB provisions and manages its own Postgres instances — no Supabase dependency |
| **Future** | REST & GraphQL API | Auto-generated data API layer served directly from VibeDB projects |
| **Future** | MCP server | A native Model Context Protocol server so Claude Code, Cursor, Codex, and other AI agents can read, write, and migrate the schema as a first-class tool call |
| **Future** | Live schema sync | Real-time schema state pushed to connected AI agents — the canvas becomes the ground truth for agent-driven development |

### Why This Wins

The next generation of databases won't be managed by humans through a CLI or migration files. They'll be managed by AI agents through structured context. VibeDB is positioned to be the **schema layer that AI agents natively understand** — not as a plugin or adapter, but as the primary interface.

---

## 4. Market Opportunity

- **Database-as-a-Service** market is projected to exceed $30B by 2027, driven by developer tooling consolidation
- Supabase reached a $2B valuation in 2024 — validating the open-source BaaS category
- The AI coding agent market (Claude Code, Cursor, Codex, Devin) is growing at >200% YoY — none of them have a canonical visual schema layer
- Every team using Postgres, Prisma, or Drizzle is a potential user; the canvas lowers the barrier for non-SQL developers to contribute to schema design

---

## 5. Competitive Landscape

| | VibeDB | Supabase | dbdiagram.io | Prisma Studio | TablePlus |
|---|--------|----------|--------------|---------------|-----------|
| Visual canvas | ✅ | ❌ | ✅ | ❌ | ❌ |
| AI schema generation | ✅ | ❌ | ❌ | ❌ | ❌ |
| One-click deploy | ✅ | Native | ❌ | ❌ | ❌ |
| Own SQL server (roadmap) | ✅ | ✅ | ❌ | ❌ | ❌ |
| MCP / agent integration (roadmap) | ✅ | ❌ | ❌ | ❌ | ❌ |
| Export to Prisma / Drizzle | ✅ | ❌ | ❌ | ❌ | ❌ |
| Schema audit + linting | ✅ | ❌ | ❌ | ❌ | ❌ |

VibeDB is the only product in this space that combines visual design, AI generation, multi-format export, deployment, and a clear path to becoming a fully hosted, agent-integrated database platform.

---

## 6. Business Model

- **Freemium** — free tier with limited AI credits and projects
- **Pro subscription** — higher AI credit caps, unlimited projects, advanced features (via Stripe)
- **Credit top-ups** — users can purchase additional AI credits on demand
- **Future: Hosted DB tier** — managed Postgres instances provisioned and billed through VibeDB (usage-based, similar to Supabase/Neon pricing)
- **Future: Team/Enterprise** — shared workspaces, SSO, audit logs, SLA

---

## 7. Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18 + TypeScript + Vite (SWC) |
| Styling | Tailwind CSS + shadcn/ui (Radix UI) |
| Animation | Framer Motion |
| Backend (current) | Supabase — Auth, Postgres, Edge Functions |
| AI | Anthropic Claude API |
| Payments | Stripe |
| Server State | TanStack React Query |

The frontend is a mature, production-grade React application. The backend is currently Supabase-hosted, which will migrate to VibeDB's own infrastructure as the hosted SQL server layer ships.

---

## 8. Traction & Status

- Live product at [vibedb.me](https://vibedb.me)
- Full auth, billing, and AI pipeline in production
- 7 Supabase Edge Functions deployed (AI gateway, deploy function, Stripe webhooks, subscription management)
- AI-powered schema generation, audit, batch edit, chat, mock data, and query generation all shipping today
- BSL licensed — protects commercial interests while remaining source-visible

---

## 9. The Ask

*[To be completed — funding amount, use of funds, milestones targeted]*

**Suggested use-of-funds framing:**
- **Engineering** — DML execution layer, hosted SQL server, REST/GraphQL API auto-generation
- **MCP integration** — native Claude Code / Cursor / Codex tooling
- **GTM** — developer community growth, content, partnerships with AI coding tool vendors
- **Infrastructure** — Postgres provisioning, billing, reliability for hosted DB tier

---

## 10. Team

*[To be completed]*

---

## Appendix — Key Technical Terms for Slides

| Term | Plain English |
|------|---------------|
| **DDL** | SQL commands that define structure (CREATE TABLE, etc.) — what VibeDB generates today |
| **DML** | SQL commands that manipulate data (INSERT, UPDATE, DELETE) — coming in next phase |
| **MCP (Model Context Protocol)** | Anthropic's open standard for giving AI agents structured tool access — VibeDB will expose its schema and data as MCP tools |
| **Schema canvas** | The infinite visual whiteboard where tables, columns, and relationships are designed |
| **Idempotent deploy** | Safe to run multiple times — VibeDB won't break a database that already has the schema |
| **Schema audit** | AI-scored review (0–100) of schema quality, with specific deductions and fix suggestions |
