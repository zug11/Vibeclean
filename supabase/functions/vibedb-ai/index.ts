import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Credit costs per action type
const CREDIT_COSTS: Record<string, number> = {
  "generate-schema": 3,
  "batch-command": 3,
  "inspect-schema": 2,
  "generate-sql": 1,
  "generate-mock-data": 1,
  "generate-query": 1,
  "smart-add-column": 1,
  "schema-chat": 1,
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
    const { prompt, type, context } = await req.json();
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not configured");

    // ─── Credit gate (check BEFORE, deduct AFTER success) ─
    const authHeader = req.headers.get("Authorization");
    let userId: string | null = null;
    let currentCredits = 0;

    if (authHeader) {
      const supabaseAdmin = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
        { auth: { persistSession: false } }
      );

      const token = authHeader.replace("Bearer ", "");
      const { data: userData } = await supabaseAdmin.auth.getUser(token);
      userId = userData.user?.id ?? null;

      if (userId) {
        const creditCost = CREDIT_COSTS[type] ?? 1;

        const { data: profile } = await supabaseAdmin
          .from("profiles")
          .select("ai_credits, subscription_tier")
          .eq("user_id", userId)
          .maybeSingle();

        if (!profile || profile.subscription_tier === "none") {
          return new Response(JSON.stringify({
            error: "Active subscription required. Please subscribe to use AI features.",
            code: "NO_SUBSCRIPTION",
          }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        currentCredits = profile.ai_credits ?? 0;
        if (currentCredits < creditCost) {
          return new Response(JSON.stringify({
            error: `Not enough credits. This action costs ${creditCost} credit${creditCost > 1 ? "s" : ""}. You have ${currentCredits}.`,
            code: "NO_CREDITS",
            credits_remaining: currentCredits,
            credits_required: creditCost,
          }), {
            status: 402,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
    }

    // ─── Build prompts ──────────────────────────────────
    let systemPrompt = "";
    let userPrompt = prompt;

    if (type === "generate-schema") {
      systemPrompt = `You are an expert database architect. Given a user's description, generate a complete database schema.

CRITICAL: Your entire response must be a single valid JSON object. No text before or after. No markdown. No comments. No explanation.

The JSON must have this exact structure:
{"tables":[{"name":"string","columns":[{"name":"string","type":"string","isForeignKey":false,"linkedTable":"","linkedColumn":"","constraints":[]}],"indexes":[{"name":"string","columns":["string"],"type":"btree","unique":false,"where":"optional filter"}],"checkConstraints":[{"name":"string","expression":"column_name > 0"}]}]}

Column types: uuid, varchar, int, timestamp, boolean, numeric, text, jsonb, decimal, float.
Constraints: [{"type":"primary"},{"type":"notNull"},{"type":"unique"},{"type":"default","value":"now()"}]

MANDATORY RULES — violating these makes the schema invalid:
1. EVERY table MUST have exactly ONE "id" column as its FIRST column: {"name":"id","type":"uuid","constraints":[{"type":"primary"},{"type":"notNull"}]}
2. EVERY table MUST have created_at and updated_at timestamp columns.
3. NEVER duplicate column names within a table. Each column name must be unique.
4. NEVER have more than one primary key per table (only the id column).
5. Foreign key columns must reference a column that EXISTS. Always reference "id" on the target table.
6. Use snake_case for all table and column names.
7. Foreign key columns should be named like: user_id, project_id, etc.
8. Generate INDEXES for: every FK column, columns commonly used in WHERE/ORDER BY, composite indexes for multi-column queries, partial indexes with WHERE clauses for filtered queries (e.g. active records only).
9. Generate CHECK CONSTRAINTS for columns with bounded values: status enums (IN list), positive amounts (> 0), percentage ranges (BETWEEN 0 AND 100), rating ranges, priority levels. Use the column name in the constraint name.
10. For junction/mapping tables (many-to-many), add a COMPOSITE UNIQUE index on the two FK columns to prevent duplicate associations.
11. For tables involving financial records, legal data, or user-generated content, add a "deleted_at" TIMESTAMP column (nullable, default null) for soft deletes.
12. For columns storing secrets, tokens, or API keys, add companion columns: "expires_at" (timestamp), "last_rotated_at" (timestamp), and "description" (varchar).
13. For self-referential FK columns (e.g. parent_id referencing same table), add a CHECK constraint: parent_id != id.

Generate as many tables as the idea genuinely requires — don't artificially limit. A simple blog might need 3 tables, but a full e-commerce platform or crypto exchange might need 15-25+. Be thorough and include all tables needed for a production-ready schema.
Use double quotes for all JSON strings. Emit compact JSON (no pretty-printing, no unnecessary whitespace).`;
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
Return ONLY valid SQL, no markdown formatting.`;
      userPrompt = `Schema:\n${context}\n\nRequest: ${prompt}`;
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

Rules:
- Apply the command to ALL relevant tables. If they say "add X to all tables", emit one add_column per table.
- Column types: uuid, varchar, int, timestamp, boolean, numeric, text, jsonb, decimal, float, or any custom enum type name.
- Constraints: [{"type":"primary"},{"type":"notNull"},{"type":"unique"},{"type":"default","value":"now()"}]
- For add_index: include "name" field, "columns" array (can include DESC/ASC), optional "where" for partial indexes.
- For add_constraint: include CHECK expression without the CHECK keyword or outer parens.
- For add_enum: name is the type name, values is a string array.
- For add_function: body is the full CREATE OR REPLACE FUNCTION statement.
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
- remove_column: {"action":"remove_column","targetTable":"...","column":"..."}
- remove_table: {"action":"remove_table","targetTable":"..."}

Column types: uuid, varchar, int, timestamp, boolean, numeric, text, jsonb, decimal, float, or custom enum type names.
Constraint types: primary, notNull, unique, default (with value).
For add_table, always include id (uuid, primary), created_at, updated_at columns.
Use double quotes for all JSON strings.`;
      userPrompt = context ? `Current Schema:\n${context}\n\nConversation:\n${prompt}` : prompt;
    } else {
      systemPrompt = "You are a helpful AI assistant.";
    }

    // ─── Model selection + token limits ──────────────────
    const fastTypes = ["generate-mock-data", "generate-sql", "generate-query", "smart-add-column"];
    const model = fastTypes.includes(type) ? "claude-haiku-4-5-20251001" : "claude-sonnet-4-6-20250514";
    const longOutputTypes = ["generate-mock-data", "generate-sql", "generate-schema"];
    const maxTokens = longOutputTypes.includes(type) ? 64000 : 16384;

    console.log(`[vibedb-ai] type=${type} model=${model} max_tokens=${maxTokens}`);

    // ─── Call Claude with automatic retry ────────────────
    const { content: rawContent, stopReason, modelUsed } = await callClaudeWithRetry(
      ANTHROPIC_API_KEY, systemPrompt, userPrompt, model, maxTokens
    );

    let content = rawContent;

    console.log(`[vibedb-ai] Success: model=${modelUsed} stop=${stopReason} len=${content.length}`);

    // ─── Post-process truncated responses ────────────────

    // SQL truncation: trim to last complete statement
    if (stopReason === "max_tokens" && (type === "generate-mock-data" || type === "generate-sql" || type === "generate-query")) {
      const lastSemicolon = content.lastIndexOf(";");
      if (lastSemicolon > 0) {
        content = content.substring(0, lastSemicolon + 1);
        content += "\n\n-- Note: Output was truncated. Some tables may be missing.";
      }
    }

    // JSON truncation: close open brackets/braces
    if (stopReason === "max_tokens" && (type === "generate-schema" || type === "schema-chat" || type === "batch-command" || type === "inspect-schema" || type === "smart-add-column")) {
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
    }

    // ─── Deduct credits AFTER successful response ────────
    let creditsRemaining: number | undefined;
    if (userId) {
      const supabaseAdmin = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
        { auth: { persistSession: false } }
      );
      const creditCost = CREDIT_COSTS[type] ?? 1;
      // Re-read current credits (may have changed during retries)
      const { data: freshProfile } = await supabaseAdmin
        .from("profiles")
        .select("ai_credits")
        .eq("user_id", userId)
        .maybeSingle();
      const freshCredits = freshProfile?.ai_credits ?? 0;
      const newCredits = Math.max(0, freshCredits - creditCost);
      await supabaseAdmin.from("profiles").update({ ai_credits: newCredits }).eq("user_id", userId);
      creditsRemaining = newCredits;
    }

    return new Response(JSON.stringify({
      result: content,
      credits_remaining: creditsRemaining,
      model_used: modelUsed,
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
