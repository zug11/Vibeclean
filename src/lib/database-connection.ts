// ─── Network Database Connection Manager ──────────────────────────

export interface DatabaseConnection {
  id: string;
  name: string;
  host: string;
  port: number;
  database: string;
  username: string;
  // password is NOT stored in localStorage — prompted per session
  ssl: boolean;
  createdAt: number;
  lastConnectedAt?: number;
}

export interface ConnectionTestResult {
  success: boolean;
  message: string;
  version?: string;
}

export interface IntrospectedSchema {
  tables: {
    name: string;
    columns: {
      name: string;
      type: string;
      nullable: boolean;
      defaultValue: string | null;
      isPrimaryKey: boolean;
    }[];
  }[];
}

const STORAGE_KEY = "vibedb_db_connections";

export const DatabaseConnectionStore = {
  list(): DatabaseConnection[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      return JSON.parse(raw) as DatabaseConnection[];
    } catch {
      return [];
    }
  },

  get(id: string): DatabaseConnection | null {
    const connections = this.list();
    return connections.find((c) => c.id === id) || null;
  },

  save(conn: DatabaseConnection): void {
    const connections = this.list();
    const idx = connections.findIndex((c) => c.id === conn.id);
    if (idx >= 0) {
      connections[idx] = conn;
    } else {
      connections.push(conn);
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(connections));
  },

  delete(id: string): void {
    const connections = this.list().filter((c) => c.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(connections));
  },
};

// Helper to get edge function URL from localStorage (same pattern as deploy)
function getEdgeFunctionUrl(): string {
  return (
    localStorage.getItem("vibedb_deploy_url")?.replace(/\/vibedb-deploy$/, "") || ""
  );
}

export async function testConnection(
  conn: DatabaseConnection,
  password: string
): Promise<ConnectionTestResult> {
  const baseUrl = getEdgeFunctionUrl();
  if (!baseUrl) {
    return { success: false, message: "Edge function URL not configured. Set up Supabase connection first." };
  }

  const response = await fetch(`${baseUrl}/vibedb-db-proxy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "test",
      connection: {
        host: conn.host,
        port: conn.port,
        database: conn.database,
        username: conn.username,
        password,
        ssl: conn.ssl,
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    return { success: false, message: `HTTP ${response.status}: ${text}` };
  }

  return response.json();
}

export async function introspectDatabase(
  conn: DatabaseConnection,
  password: string
): Promise<IntrospectedSchema> {
  const baseUrl = getEdgeFunctionUrl();
  if (!baseUrl) {
    throw new Error("Edge function URL not configured. Set up Supabase connection first.");
  }

  const response = await fetch(`${baseUrl}/vibedb-db-proxy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "introspect",
      connection: {
        host: conn.host,
        port: conn.port,
        database: conn.database,
        username: conn.username,
        password,
        ssl: conn.ssl,
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text}`);
  }

  return response.json();
}

// ─── Supabase Query Execution (via deploy edge function) ───────────
// Uses the existing deploy connection (URL + service role key) — no external DB needed
export async function executeSupabaseQuery(
  sql: string
): Promise<{ columns: string[]; rows: Record<string, unknown>[]; rowCount: number }> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  const deployUrl = localStorage.getItem("vibedb_deploy_url");
  const deployKey = localStorage.getItem("vibedb_deploy_key");

  if (!deployUrl || !deployKey) {
    throw new Error("No Supabase deploy connection configured. Connect via Deploy first.");
  }

  const response = await fetch(`${supabaseUrl}/functions/v1/vibedb-deploy`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${supabaseKey}`,
    },
    body: JSON.stringify({
      action: "query",
      sql,
      supabaseUrl: deployUrl,
      serviceRoleKey: deployKey,
    }),
  });

  const data = await response.json();

  if (!response.ok || data.error) {
    if (data.setup_needed) {
      throw new Error("Database query functions not available. Please deploy your schema first using the Deploy panel, then try again.");
    }
    throw new Error(data.error || `Query failed: HTTP ${response.status}`);
  }

  return {
    columns: data.columns || [],
    rows: data.rows || [],
    rowCount: data.rowCount || 0,
  };
}

export async function executeQuery(
  conn: DatabaseConnection,
  password: string,
  query: string,
  readOnly: boolean = true
): Promise<{ columns: string[]; rows: any[][]; rowCount: number }> {
  const baseUrl = getEdgeFunctionUrl();
  if (!baseUrl) {
    throw new Error("Edge function URL not configured. Set up Supabase connection first.");
  }

  const response = await fetch(`${baseUrl}/vibedb-db-proxy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: readOnly ? "query" : "execute",
      connection: {
        host: conn.host,
        port: conn.port,
        database: conn.database,
        username: conn.username,
        password,
        ssl: conn.ssl,
      },
      query,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text}`);
  }

  return response.json();
}
