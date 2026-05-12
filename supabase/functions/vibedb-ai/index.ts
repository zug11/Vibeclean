import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Credit costs per action type
const CREDIT_COSTS: Record<string, number> = {
  "generate-schema": 3,
  "batch-command": 3,
  "inspect-schema": 2,
  "normalize-csv": 2,
  "generate-sql": 1,
  "generate-mock-data": 1,
  "generate-query": 1,
  "smart-add-column": 1,
  "schema-chat": 1,
  "analyze-data": 2,
};

// Retryable HTTP status codes
const RETRYABLE = new Set([429, 500, 502, 503, 529]);
const MAX_RETRIES = 4; // up to 4 attempts (initial + 3 retries)

// ─── Resilient Claude API caller ────────────────────────
// Retries the SAME model with exponential backoff on transient failures.
// No fallback to weaker models — the user pays for Sonnet, they get Sonnet.
async function callClaudeWithRetry(
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  model: string,
  maxTokens: number,
): Promise<{ content: string; stopReason: string; modelUsed: string }> {
  let lastError = "";

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          system: systemPrompt,
          messages: [{ role: "user", content: userPrompt }],
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const content = data.content?.[0]?.text || "";
        const stopReason = data.stop_reason || "end_turn";
        if (attempt > 0) console.log(`[RECOVERED] ${model} succeeded on attempt ${attempt + 1}`);
        return { content, stopReason, modelUsed: model };
      }

      const status = response.status;
      const errBody = await response.text();
      lastError = `${status}: ${errBody.substring(0, 200)}`;

      if (!RETRYABLE.has(status)) {
        // Non-retryable (400, 401, 403, 404) — no point retrying
        throw new Error(`Claude API error ${status}`);
      }

      // Retryable — exponential backoff with jitter
      const backoffMs = Math.min(1000 * Math.pow(2, attempt), 16000) + Math.random() * 1000;
      console.warn(`[RETRY ${attempt + 1}/${MAX_RETRIES}] ${model} returned ${status}, waiting ${Math.round(backoffMs)}ms`);
      await new Promise(r => setTimeout(r, backoffMs));

    } catch (err) {
      if (err instanceof Error && err.message.startsWith("Claude API error")) throw err;
      // Network-level failure — retry
      lastError = String(err);
      const backoffMs = Math.min(1000 * Math.pow(2, attempt), 16000) + Math.random() * 1000;
      console.warn(`[RETRY ${attempt + 1}/${MAX_RETRIES}] ${model} network error, waiting ${Math.round(backoffMs)}ms`);
      await new Promise(r => setTimeout(r, backoffMs));
    }
  }

  throw new Error(`${model} failed after ${MAX_RETRIES} attempts: ${lastError}`);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { prompt, type, context, strategy } = await req.json();
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not configured");

    // ─── Build prompts ──────────────────────────────────
    let systemPrompt = "";
    let userPrompt = prompt;

    if (type === "generate-schema") {
      systemPrompt = `You are an expert database architect. Given a user's description, generate a complete production-quality PostgreSQL database schema.

CRITICAL: Your entire response must be a single valid JSON object. No text before or after. No markdown. No comments. No explanation.

The JSON must have this exact structure:
{"tables":[{"name":"string","columns":[{"name":"string","type":"string","isForeignKey":false,"linkedTable":"","linkedColumn":"","constraints":[]}],"indexes":[{"name":"string","columns":["string"],"type":"btree","unique":false,"where":"optional filter"}],"checkConstraints":[{"name":"string","expression":"column_name > 0"}]}]}

COLUMN TYPE RULES — use the CORRECT type for each column's semantic meaning:
- uuid: ONLY for primary key "id" columns and foreign key "_id" columns. NEVER for any other column.
- varchar: names, titles, slugs, short strings (email, username, phone, status, role, country_code, currency, version, license_key, coupon_code)
- text: long text (description, bio, content, notes, body, readme, changelog, url, github_url, website_url, avatar_url, image_url)
- int: counts, quantities, whole numbers (stock_count, download_count, max_retries, sort_order, port)
- boolean: true/false flags (is_active, is_verified, is_public, is_featured, has_free_tier, enabled)
- numeric OR decimal: money, prices, percentages, ratings (price, amount, total, discount, commission_rate, rating, latitude, longitude)
- timestamptz: dates and times (created_at, updated_at, published_at, expires_at, last_login_at, deleted_at)
- jsonb: structured data, metadata, settings, configuration blobs

NEVER use uuid for: names, emails, URLs, descriptions, statuses, versions, codes, slugs, titles, or any non-ID column.
NEVER use timestamp for: codes, names, identifiers, or any non-date column.

Constraint types: [{"type":"primary"},{"type":"notNull"},{"type":"unique"},{"type":"default","value":"now()"}]

MANDATORY RULES — violating these makes the schema invalid:
1. EVERY table MUST have exactly ONE "id" column as its FIRST column: {"name":"id","type":"uuid","constraints":[{"type":"primary"},{"type":"notNull"},{"type":"default","value":"gen_random_uuid()"}]}
2. EVERY table MUST have created_at and updated_at timestamp columns with default now().
3. NEVER duplicate column names within a table. Each column name must be unique.
4. NEVER have more than one primary key per table (only the id column).
5. Foreign key columns must reference a column that EXISTS. Always reference "id" on the target table.
6. Use snake_case for all table and column names. Pluralize table names (users, orders, products).
7. Foreign key columns MUST be named: <singular_target_table>_id (e.g. user_id, project_id, category_id).
8. NOT NULL CONSTRAINT: Add {"type":"notNull"} to EVERY column that is logically required. In a well-designed schema, 80%+ of columns should be NOT NULL. MUST be nullable (NO notNull constraint): deleted_at, self-referential FKs (parent_id — root records have no parent), optional association FKs (coupon_id, referral_id — not every row has one), future-event timestamps (shipped_at, delivered_at, paid_at, refunded_at, completed_at — events that haven't happened yet), optional address fields (address_line2), optional descriptions, secondary contact info, metadata fields.
9. Generate INDEXES for: every FK column, columns commonly used in WHERE/ORDER BY, email/username (unique), composite indexes for multi-column queries, partial indexes with WHERE clauses for filtered queries (e.g. active records only), GIN indexes on JSONB columns.
10. Generate CHECK CONSTRAINTS for ALL bounded columns: status/role/type enums (IN list), positive amounts (> 0), percentage/rating ranges (BETWEEN 0 AND 100 or BETWEEN 1 AND 5), non-negative counts (>= 0), priority levels, currency codes (IN ('USD','EUR','GBP','JPY','CAD','AUD') or similar). Name format: chk_<table>_<column>.
11. For junction/mapping tables (many-to-many), add a COMPOSITE UNIQUE index on the two FK columns to prevent duplicate associations.
12. For tables involving financial records, legal data, or user-generated content, add a "deleted_at" TIMESTAMP column (nullable, default null) for soft deletes.
13. For columns storing secrets, tokens, or API keys, add companion columns: "expires_at" (timestamp), "last_rotated_at" (timestamp).
14. For self-referential FK columns (e.g. parent_id referencing same table): make them NULLABLE (root records have no parent) and add a CHECK constraint: parent_id != id.
15. Prefer timestamptz over plain timestamp for all date/time columns — ensures timezone-aware storage.
16. Prefer text over varchar when no max-length constraint exists — avoids silent truncation.
17. Use numeric (not float/real/double) for money and financial amounts — prevents floating-point rounding.
18. Add a GIN index on every JSONB column for efficient containment/key-exists queries.
19. For tables with a soft-delete deleted_at column, add a partial index WHERE deleted_at IS NULL on commonly queried columns.
20. For composite indexes, place high-selectivity columns first, then range/sort columns (e.g. user_id, created_at DESC).
21. Never duplicate quantity/count/balance columns across parent-child tables (e.g. stock_count on both products AND product_variants). Store the value in ONE place — the most granular table — and derive the parent total via query or trigger.

CRITICAL MISTAKES TO AVOID — your schema is INVALID if any of these occur:
- id columns WITHOUT {"type":"default","value":"gen_random_uuid()"} → WRONG. Every id MUST have this default.
- parent_id with {"type":"notNull"} → WRONG. Self-referential FKs MUST be nullable so root records can exist.
- coupon_id / referral_id / discount_id with {"type":"notNull"} → WRONG. Optional association FKs MUST be nullable.
- shipped_at / delivered_at / paid_at / refunded_at / completed_at with {"type":"notNull"} → WRONG. Future-event timestamps MUST be nullable — these events haven't happened at creation time.
- address_line2 with {"type":"notNull"} → WRONG. Optional address fields MUST be nullable.
- Tables with deleted_at but NO partial index WHERE deleted_at IS NULL → WRONG. Always add partial indexes on soft-delete tables.
- JSONB columns without a GIN index → WRONG. Every JSONB column needs a GIN index.
- currency/country columns without a CHECK constraint → WRONG. Constrain to valid ISO codes.
Before emitting JSON, review every column: can this column realistically be empty at INSERT time? If yes, it MUST be nullable.

Generate as many tables as the idea genuinely requires — don't artificially limit. A simple blog might need 3-5 tables, but a full e-commerce platform or marketplace might need 15-25+. Be thorough and include all tables needed for a production-ready schema.
Use double quotes for all JSON strings. Emit compact JSON (no pretty-printing, no unnecessary whitespace).`;
      userPrompt = `Requirement: ${prompt}`;
    } else if (type === "generate-sql") {
      systemPrompt = `You are a SQL expert. Given a database schema context, generate valid PostgreSQL DDL statements.
Rules:
- Include CREATE TABLE statements with proper types, constraints, foreign keys, and indexes.
- Every CREATE TABLE must end with );
- Every statement must end with a semicolon.
- Return ONLY valid SQL code. No markdown. No \`\`\` fences.`;
      userPrompt = `Generate SQL DDL for this schema:\n${context}`;
    } else if (type === "generate-mock-data") {
      systemPrompt = `You are a SQL data generator. Generate realistic INSERT statements for the given PostgreSQL schema.
Rules:
- Generate 2-3 rows per table using INSERT INTO statements.
- Respect foreign key relationships — insert parent table rows BEFORE child table rows.
- Use proper UUIDs for uuid columns (e.g. 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11').
- Use realistic data (real names, emails, timestamps, etc).
- Use '2024-01-15T10:30:00Z' style for timestamps. Do NOT use NOW().
- Every INSERT statement MUST end with a semicolon.
- Return ONLY valid SQL INSERT statements. No markdown. No comments. No explanation. No \`\`\` fences.
- Be concise. Do not add extra whitespace or formatting.
- If there are many tables, keep it to 2 rows each to stay within limits.`;
      userPrompt = prompt
        ? `${prompt}\n\nSchema:\n${context}`
        : `Generate mock data for this schema:\n${context}`;
    } else if (type === "generate-query") {
      systemPrompt = `You are a SQL query expert. Given the schema context and a user request, generate a valid PostgreSQL query.

Rules:
- Use EXISTS instead of COUNT(*) > 0 for existence checks.
- Never use SELECT * — always list specific columns needed.
- For paginated results, use cursor-based pagination (WHERE id > $cursor ORDER BY id LIMIT N) instead of OFFSET.
- When the schema uses RLS or Supabase auth, wrap user-scoped queries with auth.uid() for the current user's ID.
- Return ONLY valid SQL, no markdown formatting.`;
      userPrompt = `Schema:\n${context}\n\nRequest: ${prompt}`;
    } else if (type === "analyze-data") {
      systemPrompt = `You are a data analyst. You are given actual row data from database tables. Analyze the provided data and answer the user's question.

Rules:
- Answer the user's question directly first, then provide supporting details.
- Summarize key findings, patterns, outliers, and distributions you find in the actual data.
- Use specific numbers and values from the data provided. Reference actual row values.
- If a table has no data rows, say so clearly.
- If the data is insufficient to answer the question, explain what additional data would help.
- Keep the response conversational but precise — 2-5 paragraphs.
- Use bullet points for lists of findings. Use **bold** for key metrics.
- Do NOT output SQL or suggest queries. You are analyzing data that is already provided to you.
- Do NOT reference "query results" or "SQL execution". The data comes directly from the user's canvas tables.
- Output plain English only — no JSON, no code blocks.`;
      userPrompt = context
        ? `${context}\n\nUser Question: ${prompt}`
        : `User Question: ${prompt}`;
    } else if (type === "inspect-schema") {
      systemPrompt = `You are a database architecture reviewer. CRITICAL: Your entire response must be a single valid JSON object. No text before or after. No markdown.

Return format:
{"score":<CALCULATED>,"issues":[{"severity":"warning","message":"..."}],"suggestions":[...],"strengths":["..."],"missing_elements":["..."],"risks":["..."]}

SCORING RUBRIC — calculate precisely:
- Start at 100, then subtract:
  - Missing primary key on a table: -15 each
  - Missing created_at or updated_at per table: -5 each
  - Unresolved or broken foreign key: -10 each
  - Missing index on FK column or frequently filtered column: -5 each
  - Naming convention violation (camelCase, inconsistent pluralization, reserved words): -3 each
  - Denormalization issue (repeated data across tables): -8 each
  - Missing NOT NULL on clearly required fields (e.g. name, email): -2 each
  - Table with zero indexes at all: -5 each
  - Missing CHECK constraint where values are clearly bounded: -2 each
  - Junction/mapping table without composite unique on FK pair: -8 each
  - Self-referential FK column without guard CHECK (parent_id != id): -5 each
  - Column storing secrets/tokens without expires_at or rotation tracking: -8 each
  - Financial/legal table missing soft delete (deleted_at): -5 each
  - JSONB column without description or documentation comment: -2 each
  - Missing composite index on multi-column query patterns: -3 each
  - JSONB column without a GIN index: -3 each
  - Function marked SECURITY DEFINER without explicit search_path set: -5 each
  - Using timestamp instead of timestamptz: -2 each
- Minimum score: 0
- A well-designed schema with PKs, timestamps, indexes, clean naming, and constraints → 90-100
- A typical new schema with tables but no indexes → 50-65
- A schema with major issues (missing PKs, broken FKs, no timestamps) → below 40
- Apply deductions precisely based on what you find. Do NOT default to a middle value.

ADDITIONAL CHECKS:
- For each junction/mapping table: verify a composite unique index exists on the two FK columns. If missing, suggest add_index.
- For self-referential FK columns (e.g. parent_id on same table): verify a CHECK constraint exists (parent_id != id). If missing, suggest add_constraint.
- For columns with names like "token", "secret", "api_key", "password_hash": verify companion columns (expires_at, last_rotated_at) exist.
- For tables storing financial records, orders, transactions, invoices: verify deleted_at column exists for soft delete.
- For JSONB columns: note if they lack documentation — suggest a description column or comment.

Suggestion format — each must have "type", "target_table", "payload", "reason":
- add_index: {"type":"add_index","target_table":"users","payload":{"columns":["email"],"unique":false,"name":"idx_users_email"},"reason":"..."}
- add_index (partial): {"type":"add_index","target_table":"orders","payload":{"columns":["user_id","created_at DESC"],"unique":false,"name":"idx_orders_user","where":"status = 'active'"},"reason":"..."}
- add_column: {"type":"add_column","target_table":"users","payload":{"name":"deleted_at","type":"timestamp"},"reason":"..."}
- add_table: {"type":"add_table","target_table":"","payload":{"name":"audit_logs","columns":[{"name":"id","type":"uuid","constraints":[{"type":"primary"}]}]},"reason":"..."}
- rename_table: {"type":"rename_table","target_table":"User","payload":{"newName":"users"},"reason":"..."}
- rename_column: {"type":"rename_column","target_table":"users","payload":{"targetColumn":"fname","newName":"first_name"},"reason":"..."}
- change_type: {"type":"change_type","target_table":"users","payload":{"targetColumn":"price","newType":"decimal"},"reason":"..."}
- add_fk: {"type":"add_fk","target_table":"orders","payload":{"column":"user_id","referencesTable":"users","referencesColumn":"id"},"reason":"..."}
- add_constraint: {"type":"add_constraint","target_table":"orders","payload":{"name":"chk_positive_qty","expression":"quantity > 0"},"reason":"..."}
- add_enum: {"type":"add_enum","target_table":"","payload":{"name":"order_side","values":["buy","sell"]},"reason":"..."}
- add_function: {"type":"add_function","target_table":"","payload":{"name":"update_updated_at","body":"CREATE OR REPLACE FUNCTION ..."},"reason":"..."}
- remove_column: {"type":"remove_column","target_table":"users","payload":{"column":"temp_field"},"reason":"..."}
- remove_table: {"type":"remove_table","target_table":"unused_table","payload":{},"reason":"..."}

Rules:
- Check for: missing indexes on FK/query columns, denormalization, naming conventions, missing audit fields (created_at, updated_at), relationship issues, missing constraints, security concerns.
- Be thorough but don't hallucinate issues that don't exist. If the schema is genuinely good, score it high.
- Include ALL applicable suggestions — do not cap or limit the count. Every suggestion must be actionable.
- Keep the response compact to avoid truncation.`;
      userPrompt = `${prompt}\n\n${context}`;
    } else if (type === "smart-add-column") {
      systemPrompt = `You are a database expert. CRITICAL: Your entire response must be a single valid JSON object. No text before or after. No markdown.

Return exactly: {"name":"column_name","type":"varchar","description":"..."}`;
    } else if (type === "batch-command") {
      systemPrompt = `You are a database batch processor. CRITICAL: Your entire response must be a single valid JSON object. No text before or after. No markdown.

Return: {"changes":[...]}

Each change must have an "action" field. Supported actions and their formats:
- {"action":"add_column","targetTable":"users","column":{"name":"deleted_at","type":"timestamp","constraints":[]}}
- {"action":"remove_column","targetTable":"users","column":"temp_field"}
- {"action":"rename_column","targetTable":"users","targetColumn":"fname","newName":"first_name"}
- {"action":"change_type","targetTable":"users","targetColumn":"age","newType":"int"}
- {"action":"add_table","table":{"name":"audit_logs","columns":[{"name":"id","type":"uuid","constraints":[{"type":"primary"}]},{"name":"created_at","type":"timestamp","constraints":[]}]}}
- {"action":"remove_table","targetTable":"temp_data"}
- {"action":"rename_table","targetTable":"User","newName":"users"}
- {"action":"add_fk","targetTable":"orders","column":"user_id","referencesTable":"users","referencesColumn":"id"}
- {"action":"add_index","targetTable":"users","columns":["email"],"unique":true,"name":"idx_users_email"}
- {"action":"add_index","targetTable":"orders","columns":["user_id","status","created_at DESC"],"unique":false,"name":"idx_orders_user_status","where":"status = 'active'"}
- {"action":"add_constraint","targetTable":"orders","name":"chk_positive_qty","expression":"quantity > 0"}
- {"action":"add_constraint","targetTable":"orders","name":"chk_order_side","expression":"side IN ('buy', 'sell')"}
- {"action":"add_enum","name":"order_side","values":["buy","sell","cancel"]}
- {"action":"add_function","name":"update_updated_at","body":"CREATE OR REPLACE FUNCTION update_updated_at() RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql;"}
- {"action":"ddl_patch","title":"Add tenant RLS policies","description":"Raw SQL for database objects outside the visual schema model","sql":"ALTER TABLE projects ENABLE ROW LEVEL SECURITY; CREATE POLICY ...;"}

Rules:
- Apply the command to ALL relevant tables. If they say "add X to all tables", emit one add_column per table.
- Column types: uuid, varchar, int, timestamp, boolean, numeric, text, jsonb, decimal, float, or any custom enum type name.
- Constraints: [{"type":"primary"},{"type":"notNull"},{"type":"unique"},{"type":"default","value":"now()"}]
- For add_index: include "name" field, "columns" array (can include DESC/ASC), optional "where" for partial indexes.
- For add_constraint: include CHECK expression without the CHECK keyword or outer parens.
- For add_enum: name is the type name, values is a string array.
- For add_function: body is the full CREATE OR REPLACE FUNCTION statement.
- Use ddl_patch for edge cases that cannot be represented safely in schema JSON: RLS policies, triggers, views, grants, extensions, generated columns, expression indexes, data backfills, preserving table/column renames with ALTER ... RENAME, or complex ALTER COLUMN TYPE ... USING migrations.
- Do NOT force raw SQL edge cases into add_column/remove_column/change_type if that would lose data or intent.
- Return ONLY the changes needed. Do NOT return unchanged tables.
- Keep it compact to avoid truncation.`;
      userPrompt = `Current Schema:\n${context}\n\nCommand: ${prompt}`;
    } else if (type === "schema-chat") {
      systemPrompt = `You are an expert database architect assistant having a friendly conversation about a database schema.

CONTEXT: The user's current schema is provided. Use it to give relevant advice when asked.

CRITICAL: Your entire response must be a single valid JSON object. No text before or after. No markdown.

Return format:
{"message":"Your conversational response here.","suggestions":[],"ask_to_apply":false}

CONVERSATION BEHAVIOR:
- You are a conversational partner first, not a suggestion machine.
- When the user asks general questions, discusses ideas, or wants to brainstorm — just TALK. Have a natural conversation. Keep suggestions array empty.
- Ask clarifying questions. Understand what they're building and why.
- When you discuss potential improvements in conversation, end your message by asking if they'd like you to generate the suggestions. Set "ask_to_apply" to true in this case.
- Only include actual suggestion objects in the "suggestions" array when:
  1. The user explicitly asks for suggestions/improvements/changes (e.g. "what should I improve?", "suggest changes", "yes apply them", "go ahead")
  2. The user says "yes" or agrees after you asked via ask_to_apply
  3. The user gives a direct command like "add a users table" or "remove the posts table"

WHEN YOU DO INCLUDE SUGGESTIONS:
Every improvement you mention MUST have a corresponding suggestion card. Never tell the user to do something manually.
Do NOT be afraid to suggest remove_table or remove_column when appropriate.
Include ALL applicable suggestions — do not cap or limit the count. Keep suggestion payloads minimal — only include required fields.
Keep your "message" text concise (2-4 sentences max). Do not write essays.
If the schema is already well-designed, return empty suggestions and say something positive. Do NOT hallucinate unnecessary changes.
IMPORTANT: Your response MUST be valid JSON. Keep it compact to avoid truncation.

Suggestion types and payload formats:
- add_table: {"action":"add_table","table":{"name":"...","columns":[{"name":"...","type":"...","constraints":[]}]}}
- add_column: {"action":"add_column","targetTable":"...","column":{"name":"...","type":"...","isForeignKey":false,"linkedTable":"","linkedColumn":"","constraints":[]}}
- rename_table: {"action":"rename_table","targetTable":"...","newName":"..."}
- rename_column: {"action":"rename_column","targetTable":"...","targetColumn":"...","newName":"..."}
- change_type: {"action":"change_type","targetTable":"...","targetColumn":"...","newType":"..."}
- add_index: {"action":"add_index","targetTable":"...","columns":["..."],"unique":false,"name":"idx_..."}
- add_index (partial): {"action":"add_index","targetTable":"...","columns":["col1","col2 DESC"],"unique":false,"name":"idx_...","where":"status = 'active'"}
- add_fk: {"action":"add_fk","targetTable":"...","column":"...","referencesTable":"...","referencesColumn":"id"}
- add_constraint: {"action":"add_constraint","targetTable":"...","name":"chk_...","expression":"quantity > 0"}
- add_enum: {"action":"add_enum","name":"order_status","values":["pending","filled","cancelled"]}
- add_function: {"action":"add_function","name":"fn_name","body":"CREATE OR REPLACE FUNCTION ..."}
- ddl_patch: {"action":"ddl_patch","title":"Add tenant RLS policies","description":"Raw SQL for objects outside schema JSON","sql":"ALTER TABLE projects ENABLE ROW LEVEL SECURITY; CREATE POLICY ...;"}
- remove_column: {"action":"remove_column","targetTable":"...","column":"..."}
- remove_table: {"action":"remove_table","targetTable":"..."}

Column types: uuid, varchar, int, timestamp, boolean, numeric, text, jsonb, decimal, float, or custom enum type names.
Constraint types: primary, notNull, unique, default (with value).
For add_table, always include id (uuid, primary), created_at, updated_at columns.
Use ddl_patch for edge cases that cannot be represented safely in schema JSON: RLS policies, triggers, views, grants, extensions, generated columns, expression indexes, data backfills, preserving table/column renames with ALTER ... RENAME, or complex ALTER COLUMN TYPE ... USING migrations.
Do NOT force raw SQL edge cases into add_column/remove_column/change_type if that would lose data or intent.
Use double quotes for all JSON strings.`;
      userPrompt = context ? `Current Schema:\n${context}\n\nConversation:\n${prompt}` : prompt;
    } else if (type === "normalize-csv") {
      systemPrompt = `You are an expert database normalizer. Given a flat denormalized CSV, generate a complete normalized PostgreSQL database schema in Third Normal Form (3NF).

Output ONLY valid PostgreSQL SQL. No markdown. No \`\`\` fences.

REQUIRED OUTPUT SECTIONS (in this order):
1. DROP TABLE IF EXISTS ... CASCADE for each table (child/fact tables first, then parent/entity tables)
2. CREATE TABLE for each entity/dimension table (parent tables first):
   - Use SERIAL PRIMARY KEY for IDs
   - Add proper column types (VARCHAR, INTEGER, DECIMAL, DATE, BOOLEAN, TEXT as appropriate)
   - Add NOT NULL, UNIQUE, CHECK constraints where appropriate
   - Add created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP and updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
3. CREATE TABLE for the fact/transaction table with proper FOREIGN KEY REFERENCES to entity tables
4. CREATE INDEX for all FK columns and commonly queried columns
5. INSERT INTO statements for EVERY entity/dimension table with deduplicated data extracted from the CSV
6. INSERT INTO for the fact/transaction table with every original CSV row, using integer FK IDs that match the SERIAL order from entity INSERTs

NORMALIZATION RULES:
- Identify repeated column groups by shared prefix (customer_, product_, salesperson_, etc.) and extract into separate entity tables
- The leaf/fact table (sales, orders, transactions) keeps only per-row columns (quantity, total, date, discount) plus FK references
- Deduplicate entity data: if customer_name+customer_email repeat across rows, insert each unique customer only once
- Every CSV column must end up in exactly one table — no data lost
- Use snake_case for all table and column names
- Strip redundant prefixes in entity tables (customer_name → name in customers table, product_category → category in products table)
- Keep it practical: 2-6 tables is typical for most spreadsheets

FOR INSERT STATEMENTS (CRITICAL):
- Include ALL rows from the provided CSV data — do not skip or truncate
- For entity tables: each unique entity appears exactly once, in insertion order matching SERIAL IDs (first inserted = ID 1)
- For the fact table: include every original CSV row with proper integer FK references matching the entity insertion order
- Values must be properly SQL-escaped (single quotes for strings, no quotes for numbers/NULL)
- Use multi-row INSERT syntax: INSERT INTO table (cols) VALUES (row1), (row2), ...;`;
      userPrompt = prompt;
    } else if (type === "sre-analyze-incident") {
      systemPrompt = `You are an expert Site Reliability Engineer. Analyze the incident described below and provide root cause analysis.

Your response should include:
1. Likely root cause (be specific about the failure mode)
2. Contributing factors
3. Immediate mitigation steps
4. Long-term preventive measures
5. Suggested monitoring improvements

Be concise and actionable. Reference specific services when relevant.`;
      userPrompt = context ? `Service topology:\n${context}\n\nIncident:\n${prompt}` : prompt;
    } else if (type === "sre-generate-runbook") {
      systemPrompt = `You are an expert Site Reliability Engineer. Generate an operational runbook for the specified service.

CRITICAL: Your entire response must be a single valid JSON object. No text before or after. No markdown.

Return format:
{"title":"Runbook: <service name> - <scenario>","steps":[{"order":1,"action":"Description of what to do","command":"optional shell command","expected":"what you should see if successful"}]}

Generate 5-10 practical steps covering:
- Health check verification
- Common failure diagnosis
- Service restart procedures
- Log analysis commands
- Rollback procedures
- Escalation criteria

Use realistic commands (systemctl, kubectl, docker, curl, psql, etc.) appropriate for the service type.`;
      userPrompt = context ? `Service context:\n${context}\n\nGenerate runbook for: ${prompt}` : prompt;
    } else {
      systemPrompt = "You are a helpful AI assistant.";
    }

    // ─── Model selection + token limits ──────────────────
    const fastTypes = ["generate-mock-data", "generate-sql", "generate-query", "smart-add-column"];
    // Use Haiku for explicitly fast types OR when "v3-fast" strategy is requested
    const useFastModel = fastTypes.includes(type) || (strategy === "v3-fast" && type === "generate-schema");
    const model = useFastModel ? "claude-haiku-4-5-20251001" : "claude-sonnet-4-6";
    const longOutputTypes = ["generate-mock-data", "generate-sql", "generate-schema", "normalize-csv"];
    // Supabase edge functions have a 150s wall-clock timeout.
    // Sonnet 4.6 at ~130 tok/s: 16384 tokens ≈ 126s → fits within timeout.
    // Reactive chaining handles overflow for complex schemas (20+ tables).
    const maxTokens = longOutputTypes.includes(type) ? 16384 : 8192;

    console.log(`[vibedb-ai] type=${type} model=${model} max_tokens=${maxTokens}`);

    // ─── Call Claude with automatic retry ────────────────
    const { content: rawContent, stopReason, modelUsed } = await callClaudeWithRetry(
      ANTHROPIC_API_KEY, systemPrompt, userPrompt, model, maxTokens
    );

    let content = rawContent;
    let truncated = false;

    console.log(`[vibedb-ai] Success: model=${modelUsed} stop=${stopReason} len=${content.length}`);

    // ─── Post-process truncated responses ────────────────

    // SQL truncation: trim to last complete statement
    if (stopReason === "max_tokens" && (type === "generate-mock-data" || type === "generate-sql" || type === "generate-query" || type === "normalize-csv")) {
      const lastSemicolon = content.lastIndexOf(";");
      if (lastSemicolon > 0) {
        content = content.substring(0, lastSemicolon + 1);
        content += "\n\n-- Note: Output was truncated. Some tables may be missing.";
      }
    }

    // JSON truncation: smart recovery for generate-schema
    if (stopReason === "max_tokens" && type === "generate-schema") {
      console.log("[vibedb-ai] Schema JSON truncated, using smart table-level recovery...");
      const tablesStart = content.indexOf('"tables"');
      if (tablesStart !== -1) {
        const arrayStart = content.indexOf("[", tablesStart);
        if (arrayStart !== -1) {
          // Walk through the tables array, tracking depth to find complete table objects
          let lastGoodPos = -1;
          let depth = 0;
          let inStr = false;
          let esc = false;
          for (let i = arrayStart + 1; i < content.length; i++) {
            const ch = content[i];
            if (esc) { esc = false; continue; }
            if (ch === "\\") { esc = true; continue; }
            if (ch === '"') { inStr = !inStr; continue; }
            if (inStr) continue;
            if (ch === "{" || ch === "[") depth++;
            if (ch === "}" || ch === "]") {
              depth--;
              if (depth === 0) {
                // Back at the tables array level — this is a complete table object
                lastGoodPos = i;
              }
            }
          }
          if (lastGoodPos > arrayStart) {
            content = content.substring(0, lastGoodPos + 1) + "]}";
            truncated = true;
            console.log("[vibedb-ai] Recovered truncated schema, trimmed to last complete table");
          }
        }
      }
    }

    // JSON truncation: generic close open brackets/braces (for non-schema types)
    if (stopReason === "max_tokens" && type !== "generate-schema" && (type === "schema-chat" || type === "batch-command" || type === "inspect-schema" || type === "smart-add-column")) {
      console.log("[vibedb-ai] JSON truncated, attempting auto-close...");
      content = content.replace(/,\s*"[^"]*$/, "");
      content = content.replace(/,\s*$/, "");
      let openBraces = 0, openBrackets = 0, inStr = false, esc = false;
      for (const ch of content) {
        if (esc) { esc = false; continue; }
        if (ch === "\\") { esc = true; continue; }
        if (ch === '"') { inStr = !inStr; continue; }
        if (inStr) continue;
        if (ch === "{") openBraces++;
        if (ch === "}") openBraces--;
        if (ch === "[") openBrackets++;
        if (ch === "]") openBrackets--;
      }
      if (inStr) content += '"';
      content = content.replace(/,\s*$/, "");
      for (let i = 0; i < openBrackets; i++) content += "]";
      for (let i = 0; i < openBraces; i++) content += "}";
      // Signal frontend to issue continuation calls for inspect-schema
      if (type === "inspect-schema") {
        truncated = true;
      }
    }

    return new Response(JSON.stringify({
      result: content,
      model_used: modelUsed,
      truncated,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("vibedb-ai error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
