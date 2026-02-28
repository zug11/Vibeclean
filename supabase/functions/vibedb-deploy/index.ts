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

    // ─── Query Action: Execute read-only SQL and return rows ───
    if (action === "query") {
      if (!sql) {
        return new Response(JSON.stringify({ error: "No SQL query provided" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Safety: block mutating statements
      const upperSql = sql.trim().toUpperCase();
      const MUTATING = ["INSERT", "UPDATE", "DELETE", "DROP", "CREATE", "ALTER", "TRUNCATE"];
      const isMutating = MUTATING.some((kw: string) => upperSql.startsWith(kw));
      if (isMutating) {
        return new Response(JSON.stringify({ error: "Only SELECT queries are allowed. Use deploy for DDL/DML." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const queryRes = await fetch(`${baseUrl}/rest/v1/rpc/exec_sql_read`, {
        method: "POST",
        headers: {
          "apikey": serviceRoleKey,
          "Authorization": `Bearer ${serviceRoleKey}`,
          "Content-Type": "application/json",
          "Prefer": "return=representation",
        },
        body: JSON.stringify({ query: sql }),
      });

      if (!queryRes.ok) {
        const errText = await queryRes.text();
        if (errText.includes("PGRST202") || errText.includes("could not find")) {
          // Auto-create exec_sql_read function using exec_sql, then retry
          console.log("[vibedb-deploy] exec_sql_read not found, auto-creating...");
          const createFnSql = `CREATE OR REPLACE FUNCTION exec_sql_read(query text) RETURNS json AS $$ DECLARE result json; BEGIN EXECUTE 'SELECT json_agg(row_to_json(t)) FROM (' || query || ') t' INTO result; RETURN COALESCE(result, '[]'::json); END; $$ LANGUAGE plpgsql SECURITY DEFINER`;
          const createRes = await fetch(`${baseUrl}/rest/v1/rpc/exec_sql`, {
            method: "POST",
            headers: {
              "apikey": serviceRoleKey,
              "Authorization": `Bearer ${serviceRoleKey}`,
              "Content-Type": "application/json",
              "Prefer": "return=minimal",
            },
            body: JSON.stringify({ query: createFnSql + ";" }),
          });

          if (!createRes.ok) {
            const createErr = await createRes.text();
            if (createErr.includes("PGRST202") || createErr.includes("could not find")) {
              return new Response(JSON.stringify({
                error: "Setup required",
                setup_needed: true,
                message: "Database functions not found. Deploy your schema first using the Deploy panel.",
              }), {
                status: 400,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              });
            }
            return new Response(JSON.stringify({ error: `Failed to auto-setup: ${createErr}` }), {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          // Notify PostgREST to reload its schema cache so it sees the new function
          await fetch(`${baseUrl}/rest/v1/rpc/exec_sql`, {
            method: "POST",
            headers: {
              "apikey": serviceRoleKey,
              "Authorization": `Bearer ${serviceRoleKey}`,
              "Content-Type": "application/json",
              "Prefer": "return=minimal",
            },
            body: JSON.stringify({ query: "NOTIFY pgrst, 'reload schema';" }),
          });

          // Wait for PostgREST to pick up the schema reload
          await new Promise(r => setTimeout(r, 2000));

          // Retry the query via exec_sql_read
          const retryRes = await fetch(`${baseUrl}/rest/v1/rpc/exec_sql_read`, {
            method: "POST",
            headers: {
              "apikey": serviceRoleKey,
              "Authorization": `Bearer ${serviceRoleKey}`,
              "Content-Type": "application/json",
              "Prefer": "return=representation",
            },
            body: JSON.stringify({ query: sql }),
          });

          if (!retryRes.ok) {
            // Schema cache still stale — tell user to retry
            return new Response(JSON.stringify({
              error: "Query function was just installed. Please try your query again in a moment.",
            }), {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          const retryRows = await retryRes.json();
          const retryArray = Array.isArray(retryRows) ? retryRows : [];
          const retryCols = retryArray.length > 0 ? Object.keys(retryArray[0]) : [];
          return new Response(JSON.stringify({
            success: true,
            columns: retryCols,
            rows: retryArray,
            rowCount: retryArray.length,
          }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ error: `Query failed: ${errText}` }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const rows = await queryRes.json();
      const rowArray = Array.isArray(rows) ? rows : [];
      const columns = rowArray.length > 0 ? Object.keys(rowArray[0]) : [];

      return new Response(JSON.stringify({
        success: true,
        columns,
        rows: rowArray,
        rowCount: rowArray.length,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
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
        // Count all statement types for the success message
        const createCount = (cleanSql.match(/CREATE TABLE/gi) || []).length;
        const insertCount = (cleanSql.match(/INSERT INTO/gi) || []).length;
        const parts = [`${createCount} table(s)`];
        if (insertCount > 0) parts.push(`${insertCount} row(s)`);
        return new Response(JSON.stringify({
          success: true,
          results: [{ statement: `All statements executed: ${parts.join(", ")}`, success: true }],
          message: `Successfully deployed ${parts.join(" and ")}`,
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

    return new Response(JSON.stringify({ error: "Invalid action. Use 'test', 'deploy', or 'query'" }), {
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
