import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Split SQL into individual statements, respecting $$ dollar-quoted blocks
// (functions/triggers contain ; inside $$ ... $$ which must not be split)
function splitSQL(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let inDollarQuote = false;
  const lines = sql.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!inDollarQuote && trimmed.startsWith("--")) continue;
    // Track $$ dollar-quoting (toggle on odd number of $$ per line)
    const dollarMatches = (line.match(/\$\$/g) || []).length;
    if (dollarMatches % 2 === 1) inDollarQuote = !inDollarQuote;
    current += line + "\n";
    // Only split on ; at end of line when NOT inside a dollar-quoted block
    if (!inDollarQuote && trimmed.endsWith(";")) {
      const stmt = current.trim();
      if (stmt.length > 0 && stmt !== ";") {
        // Strip trailing semicolon for exec_sql (we add it back when executing)
        statements.push(stmt.endsWith(";") ? stmt.slice(0, -1).trim() : stmt);
      }
      current = "";
    }
  }
  // Flush any remaining content
  if (current.trim().length > 0 && current.trim() !== ";") {
    const stmt = current.trim();
    statements.push(stmt.endsWith(";") ? stmt.slice(0, -1).trim() : stmt);
  }
  return statements.filter(s => s.length > 0);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { sql, supabaseUrl, serviceRoleKey, action } = await req.json();

    if (!supabaseUrl || !serviceRoleKey) {
      return new Response(JSON.stringify({ error: "Missing Supabase URL or service role key" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const baseUrl = supabaseUrl.replace(/\/$/, "");

    if (action === "test") {
      const healthRes = await fetch(`${baseUrl}/rest/v1/`, {
        method: "GET",
        headers: {
          "apikey": serviceRoleKey,
          "Authorization": `Bearer ${serviceRoleKey}`,
        },
      });

      if (healthRes.ok) {
        return new Response(JSON.stringify({ success: true, message: "Connection successful" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } else {
        const errText = await healthRes.text();
        return new Response(JSON.stringify({ error: `Connection failed: ${healthRes.status} ${errText}` }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    if (action === "deploy") {
      if (!sql) {
        return new Response(JSON.stringify({ error: "No SQL to deploy" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Check if exec_sql exists
      const testRes = await fetch(`${baseUrl}/rest/v1/rpc/exec_sql`, {
        method: "POST",
        headers: {
          "apikey": serviceRoleKey,
          "Authorization": `Bearer ${serviceRoleKey}`,
          "Content-Type": "application/json",
          "Prefer": "return=minimal",
        },
        body: JSON.stringify({ query: "SELECT 1;" }),
      });

      if (!testRes.ok) {
        const errBody = await testRes.text();
        if (errBody.includes("PGRST202") || errBody.includes("could not find")) {
          return new Response(JSON.stringify({
            error: "Setup required",
            setup_needed: true,
            message: "exec_sql function not found",
          }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      } else {
        await testRes.text();
      }

      // Try deploying ALL SQL as a single batch first (preserves ordering/dependencies)
      const cleanSql = sql
        .split("\n")
        .filter((line: string) => !line.trim().startsWith("--"))
        .join("\n")
        .trim();

      const batchRes = await fetch(`${baseUrl}/rest/v1/rpc/exec_sql`, {
        method: "POST",
        headers: {
          "apikey": serviceRoleKey,
          "Authorization": `Bearer ${serviceRoleKey}`,
          "Content-Type": "application/json",
          "Prefer": "return=minimal",
        },
        body: JSON.stringify({ query: cleanSql }),
      });

      if (batchRes.ok) {
        await batchRes.text();
        // Count statements for the success message
        const stmtCount = (cleanSql.match(/CREATE TABLE/gi) || []).length;
        return new Response(JSON.stringify({
          success: true,
          results: [{ statement: `All ${stmtCount} CREATE TABLE statements`, success: true }],
          message: `Successfully deployed ${stmtCount} table(s)`,
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Batch failed — fall back to individual statements
      const batchErr = await batchRes.text();
      console.log("Batch deploy failed, trying individual statements:", batchErr);

      const statements = splitSQL(sql);

      const results: { statement: string; success: boolean; error?: string }[] = [];
      let hasErrors = false;

      for (const statement of statements) {
        try {
          const execRes = await fetch(`${baseUrl}/rest/v1/rpc/exec_sql`, {
            method: "POST",
            headers: {
              "apikey": serviceRoleKey,
              "Authorization": `Bearer ${serviceRoleKey}`,
              "Content-Type": "application/json",
              "Prefer": "return=minimal",
            },
            body: JSON.stringify({ query: statement + ";" }),
          });

          if (execRes.ok) {
            await execRes.text();
            results.push({ statement: statement.substring(0, 80) + "...", success: true });
          } else {
            const errText = await execRes.text();
            // Treat idempotent errors as success — expected during deploys/re-deploys
            const isDrop = statement.trim().toUpperCase().startsWith("DROP");
            const isIdempotent = errText.includes("42P07") || errText.includes("42710") || errText.includes("already exists") || errText.includes("duplicate_object") || (isDrop && errText.includes("does not exist"));
            if (isIdempotent) {
              results.push({ statement: statement.substring(0, 80) + "...", success: true, error: "(already exists — skipped)" });
            } else {
              hasErrors = true;
              // Send full statement (up to 300 chars) on errors so the client can parse table/column names
              results.push({ statement: statement.substring(0, 300), success: false, error: errText });
            }
          }
        } catch (e: unknown) {
          hasErrors = true;
          const msg = e instanceof Error ? e.message : "Unknown error";
          results.push({ statement: statement.substring(0, 80) + "...", success: false, error: msg });
        }
      }

      return new Response(JSON.stringify({
        success: !hasErrors,
        results,
        message: hasErrors
          ? `Deployed with ${results.filter(r => !r.success).length} error(s)`
          : `Successfully deployed ${results.length} statement(s)`
      }), {
        status: hasErrors ? 207 : 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Invalid action. Use 'test' or 'deploy'" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("vibedb-deploy error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
