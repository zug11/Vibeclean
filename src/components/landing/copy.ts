// All landing copy, verbatim from VibeDB_Overview2.docx.

export const HERO = {
  h1Line1: "AI writes schemas.",
  h1Line2: "VibeDB makes them survive contact with reality.",
  p1: "Most AI-generated databases look perfect until you try to use them.",
  p2: "VibeDB turns AI output into production-grade schemas with deterministic guardrails, live feedback, bidirectional sync, and a single source of truth that does not rot the moment you add the second feature.",
  p3a: "It is not just an AI app for generating SQL.",
  p3b: "It is a database control plane for designing, managing, querying, syncing, migrating, and evolving your backend in one place.",
  cta: "Get started for free",
} as const;

export const PROBLEM = {
  heading: "The real problem isn’t generation. It’s everything after.",
  story: "You describe your app to Claude. It gives you a schema. It looks clean. You feel productive.",
  storyPunch: "Then reality hits:",
  pains: [
    "A critical constraint is missing and only appears at scale.",
    "The AI invented a relationship that breaks your actual workflows.",
    "You change one table and suddenly twenty other things become inconsistent.",
    "The schema exists, but you never got a real mental model of it.",
    "The backend becomes something you depend on, but do not fully control.",
  ],
  beforeChain: "And that is before the real workflow even begins:",
  toolChain: [
    "Sketch in dbdiagram",
    "Generate migrations with Prisma/Drizzle",
    "Manage in Supabase Dashboard",
    "Query in TablePlus",
    "Maintain in pgAdmin",
    "Track everything in scattered SQL files",
  ],
  drift:
    "Every handoff creates drift. The design becomes outdated. Documentation rots. Your AI loses context. Six weeks later, you are staring at a schema no one fully understands and no tool fully owns.",
  closer1: "This is not a prompting problem.",
  closer2: "It is a fragmentation problem.",
} as const;

export const SOLUTION = {
  heading: "VibeDB is the missing layer between AI and your backend.",
  p1: "VibeDB collapses the entire database lifecycle into one coherent system.",
  p2: "Design, generate, validate, deploy, sync, query, migrate, and evolve — all from a single source of truth.",
  p3: "Instead of treating your schema as a static artifact, VibeDB treats your database as a living system. You can start from natural language, a diagram, SQL, messy data, or a live Supabase database, then keep managing that backend as it changes.",
  p4: "Under the hood is a TypeScript Postgres compiler that validates structure, catches invalid relationships, and applies deterministic self-healing fixes in real time.",
  quote: "AI is used aggressively, but it is supervised by software.",
  result:
    "The result: faster generation, fewer broken schemas, fewer wasted tokens, and a backend that stays understandable as it grows.",
} as const;

export const PIPELINE = {
  heading: "Engineered for ambitious schemas.",
  intro1: "Small projects are easy. The hard part is when your idea grows.",
  intro2:
    "VibeDB is designed for schemas with dozens or hundreds of tables. Instead of one giant AI response, it uses a parallel strategy:",
  steps: [
    { title: "Blueprint", text: "AI creates a high-level blueprint." },
    { title: "Parallel workers", text: "Specialized table workers generate parts of the schema in parallel." },
    { title: "Live diagram", text: "The diagram builds live as tables appear." },
    { title: "Consistency review", text: "A consistency reviewer checks for drift between the blueprint and generated schema." },
    { title: "Deterministic compiler", text: "The deterministic compiler validates everything before deployment." },
  ],
  outro1: "You do not just get “some tables.”",
  outro2:
    "You get an architecture that can scale with the shape of your product — while still being visible, editable, and grounded in a real database workflow.",
} as const;

export const FEATURES = {
  heading: "Built different.",
  cards: [
    {
      title: "Deterministic compiler with self-healing fixes",
      text: "Catch structural errors before they deploy, and apply deterministic repairs where possible.",
    },
    {
      title: "Parallel AI workers + consistency review",
      text: "Generate large schemas cleanly without relying on one fragile AI response.",
    },
    {
      title: "Zero-latency bidirectional sync between SQL editor and diagram",
      text: "Edit visually or in SQL while keeping the same source of truth.",
    },
    {
      title: "Bidirectional Supabase sync",
      text: "Push changes to Supabase and pull live state back into your workspace.",
    },
    {
      title: "Natural language querying against your actual live database",
      text: "Ask questions of your real data, not just a static schema.",
    },
    {
      title: "One source of truth across design, migrations, deployment, and ongoing evolution",
      text: "Your database stays manageable after the first version ships.",
    },
    {
      title: "Database control plane for the whole lifecycle",
      text: "VibeDB is not only for generating databases. It is for operating them, understanding them, and evolving them over time.",
    },
  ],
} as const;

export const HOW_IT_WORKS = {
  heading: "How it works.",
  steps: [
    {
      title: "Describe or design.",
      text: "Start with natural language, a visual schema, SQL, messy data, or an existing live database. You stay in control from the first step.",
    },
    {
      title: "Live deterministic engine.",
      text: "The compiler enforces correctness on every change. The diagram updates instantly. Errors surface immediately instead of in production.",
    },
    {
      title: "One system for the entire lifecycle.",
      text: "Design, generate migrations, deploy, query, sync, refine, and evolve — all from the same source of truth. No more handoffs between disconnected tools.",
    },
  ],
} as const;

export const CLOSING = {
  heading: "For vibe coders, founders, and serious builders.",
  p1: "VibeDB is for people who want to move fast without treating the backend as disposable.",
  p2: "Whether you are starting from a prompt, a diagram, messy data, SQL, or a live Supabase database, it gives you one place to understand and evolve your backend with both AI speed and real control.",
  p3a: "Your database is not just something you generate once.",
  p3b: "It is where your product’s memory, permissions, relationships, workflows, and future features live.",
  lead: "Stop treating your backend like a black box.",
  imperatives: ["Design it.", "Understand it.", "Deploy it.", "Query it.", "Sync it.", "Evolve it."],
  cta: "Get started for free",
} as const;
