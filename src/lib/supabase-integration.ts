import type { TableNode, Column, DomainRLSPolicy } from "@/lib/types";
import { v4 as uuidv4 } from "uuid";

export interface SupabaseProject {
  url: string;
  anonKey: string;
  serviceRoleKey?: string;
}

// OpenAPI spec types (subset of what PostgREST returns)
interface OpenAPISpec {
  definitions?: Record<string, OpenAPIDefinition>;
  paths?: Record<string, Record<string, OpenAPIPathMethod>>;
}

interface OpenAPIDefinition {
  type?: string;
  required?: string[];
  properties?: Record<string, OpenAPIProperty>;
  description?: string;
}

interface OpenAPIProperty {
  type?: string;
  format?: string;
  default?: unknown;
  description?: string;
  maxLength?: number;
  enum?: string[];
  items?: { type?: string; format?: string };
  // PostgREST uses $ref for foreign key references
  $ref?: string;
}

// Introspect a Supabase project's schema via the REST API
export async function introspectSupabaseSchema(project: SupabaseProject): Promise<TableNode[]> {
  // Fetch the OpenAPI spec from PostgREST
  const resp = await fetch(`${project.url}/rest/v1/`, {
    headers: {
      apikey: project.anonKey,
      Accept: "application/openapi+json",
    },
  });

  if (!resp.ok) {
    throw new Error(`Failed to introspect: ${resp.status} ${resp.statusText}`);
  }

  const spec: OpenAPISpec = await resp.json();

  if (!spec.definitions) {
    throw new Error("No table definitions found in the OpenAPI spec");
  }

  const tables: TableNode[] = [];
  const tableNames = Object.keys(spec.definitions);

  // First pass: build all tables with columns
  let xOffset = 100;
  let yOffset = 100;

  for (const tableName of tableNames) {
    const def = spec.definitions[tableName];
    if (!def.properties) continue;

    const requiredCols = new Set(def.required || []);
    const columns: Column[] = [];

    for (const [colName, prop] of Object.entries(def.properties)) {
      const pgType = openApiTypeToPgType(prop);
      const constraints: { type: string; value?: string }[] = [];

      // Check if required (NOT NULL)
      if (requiredCols.has(colName)) {
        constraints.push({ type: "notNull" });
      }

      // Detect primary key heuristic: column named "id" that's required and has a default
      if (colName === "id" && requiredCols.has(colName)) {
        constraints.push({ type: "primary" });
      }

      // Check for default value
      if (prop.default !== undefined) {
        constraints.push({ type: "default", value: String(prop.default) });
      }

      // Detect foreign key heuristic: column ending in _id that references another table
      let isForeignKey = false;
      let linkedTable = "";
      let linkedColumn = "";

      if (colName.endsWith("_id") && colName !== "id") {
        const potentialTable = colName.slice(0, -3); // Remove _id suffix
        // Check if a table with that name (singular or plural) exists
        const match = tableNames.find(
          (t) =>
            t.toLowerCase() === potentialTable.toLowerCase() ||
            t.toLowerCase() === potentialTable.toLowerCase() + "s" ||
            t.toLowerCase() + "s" === potentialTable.toLowerCase()
        );
        if (match) {
          isForeignKey = true;
          linkedTable = match;
          linkedColumn = "id";
        }
      }

      columns.push({
        id: uuidv4(),
        name: colName,
        type: pgType,
        isForeignKey,
        linkedTable,
        linkedColumn,
        fkStatus: isForeignKey ? "resolved" : undefined,
        constraints: constraints.length > 0 ? constraints : undefined,
        description: prop.description || undefined,
      });
    }

    tables.push({
      id: uuidv4(),
      name: tableName,
      columns,
      x: xOffset,
      y: yOffset,
      description: def.description || undefined,
    });

    // Stagger positions for visual layout
    xOffset += 350;
    if (xOffset > 1200) {
      xOffset = 100;
      yOffset += 300;
    }
  }

  // Second pass: resolve foreign key references using PostgREST path info
  if (spec.paths) {
    for (const [path, methods] of Object.entries(spec.paths)) {
      // PostgREST paths look like "/{table}" — skip the leading /
      const pathTable = path.replace(/^\//, "").split("?")[0];
      const table = tables.find((t) => t.name === pathTable);
      if (!table) continue;

      // Check GET parameters for foreign key embed hints
      const getMethod = methods.get;
      if (getMethod?.parameters) {
        for (const param of getMethod.parameters as any[]) {
          if (param.name === "select" && param.description) {
            // PostgREST select parameter description may list embeddable tables
            // This is a secondary heuristic — the _id matching above covers most cases
          }
        }
      }
    }
  }

  return tables;
}

// Convert OpenAPI property types to Postgres types
function openApiTypeToPgType(prop: OpenAPIProperty): string {
  const { type, format } = prop;

  if (format === "uuid") return "uuid";
  if (format === "timestamp with time zone" || format === "timestamptz") return "timestamptz";
  if (format === "timestamp without time zone" || format === "timestamp") return "timestamp";
  if (format === "date") return "date";
  if (format === "time with time zone" || format === "timetz") return "timetz";
  if (format === "time without time zone" || format === "time") return "time";
  if (format === "interval") return "interval";
  if (format === "inet") return "inet";
  if (format === "cidr") return "cidr";
  if (format === "macaddr") return "macaddr";
  if (format === "bytea") return "bytea";
  if (format === "jsonb") return "jsonb";
  if (format === "json") return "json";
  if (format === "bigint" || format === "int8") return "bigint";
  if (format === "smallint" || format === "int2") return "smallint";
  if (format === "double precision" || format === "float8") return "double precision";
  if (format === "real" || format === "float4") return "real";
  if (format === "numeric") return "numeric";
  if (format === "money") return "money";
  if (format === "text") return "text";

  // Fall back on the OpenAPI type field
  if (type === "integer") return "integer";
  if (type === "number") return "numeric";
  if (type === "boolean") return "boolean";
  if (type === "string") {
    if (prop.maxLength) return `varchar(${prop.maxLength})`;
    return "text";
  }
  if (type === "array") {
    if (prop.items) {
      const inner = openApiTypeToPgType(prop.items as OpenAPIProperty);
      return `${inner}[]`;
    }
    return "text[]";
  }
  if (type === "object") return "jsonb";

  // Default
  return format || type || "text";
}

// Generate production-ready RLS policies with role-based access, security definer helpers,
// audit log protection, hierarchical scoping, and soft-delete awareness.
export function generateRLSPolicies(tables: TableNode[], domainPolicies?: DomainRLSPolicy[]): string {
  let sql = "-- Row Level Security Policies\n";
  sql += "-- Generated by VibeDB Supabase Integration\n\n";

  if (tables.length === 0) return sql;

  // 1. Detect the main user/auth table (users, profiles, traders, employees, etc.)
  const authTable = tables.find(t =>
    ['users', 'profiles', 'traders', 'employees', 'accounts'].includes(t.name.toLowerCase()) ||
    t.columns.some(c => c.name.toLowerCase() === 'role' || c.name.toLowerCase() === 'is_admin')
  );

  const roleCol = authTable?.columns.find(c => c.name.toLowerCase() === 'role' || c.name.toLowerCase() === 'role_id');
  const deskCol = authTable?.columns.find(c => ['desk', 'team', 'department'].includes(c.name.toLowerCase()));

  // 2. Generate Security Definer Helpers if auth table exists
  if (authTable) {
    sql += `-- Security Definer Helpers (prevents infinite recursion)\n`;
    if (roleCol) {
      sql += `CREATE OR REPLACE FUNCTION get_auth_role()\nRETURNS VARCHAR\nLANGUAGE plpgsql\nSECURITY DEFINER SET search_path = public\nAS $$\nDECLARE\n  v_role VARCHAR;\nBEGIN\n  SELECT ${roleCol.name} INTO v_role FROM ${authTable.name} WHERE id = auth.uid();\n  RETURN COALESCE(v_role, 'none');\nEND;\n$$;\n\n`;
    }
    if (deskCol) {
      sql += `CREATE OR REPLACE FUNCTION get_auth_${deskCol.name}()\nRETURNS VARCHAR\nLANGUAGE plpgsql\nSECURITY DEFINER SET search_path = public\nAS $$\nDECLARE\n  v_val VARCHAR;\nBEGIN\n  SELECT ${deskCol.name} INTO v_val FROM ${authTable.name} WHERE id = auth.uid();\n  RETURN v_val;\nEND;\n$$;\n\n`;
    }
  }

  // 3. Iterate through tables and apply heuristics
  for (const table of tables) {
    sql += `-- RLS for ${table.name}\n`;
    sql += `ALTER TABLE ${table.name} ENABLE ROW LEVEL SECURITY;\n\n`;

    const nameLower = table.name.toLowerCase();
    const isAudit = nameLower.includes('audit') || nameLower.includes('log') || nameLower.includes('history');

    // Find ownership column (must be UUID to match Supabase auth.uid)
    const ownerCol = table.columns.find(c =>
      ['user_id', 'account_id', 'trader_id', 'owner_id', 'profile_id'].includes(c.name.toLowerCase()) &&
      c.type.toLowerCase() === 'uuid'
    );

    // Soft delete handling
    const hasDeletedAt = table.columns.some(c => c.name.toLowerCase() === 'deleted_at');
    const activeCheck = hasDeletedAt ? ` AND deleted_at IS NULL` : '';

    if (isAudit) {
      // Pattern A: Audit Log (Append-only)
      sql += `CREATE POLICY "${table.name}_insert_system" ON ${table.name} FOR INSERT WITH CHECK (true);\n`;
      if (roleCol) {
        sql += `CREATE POLICY "${table.name}_select_admin" ON ${table.name} FOR SELECT USING (get_auth_role() IN ('admin', 'compliance_officer', 'risk_manager'));\n`;
      } else {
        sql += `CREATE POLICY "${table.name}_select_all" ON ${table.name} FOR SELECT USING (true);\n`;
      }
    }
    else if (ownerCol) {
      // Pattern B: Ownership (User-scoped data)
      const tableHasDesk = table.columns.some(c => c.name.toLowerCase() === deskCol?.name.toLowerCase());

      if (roleCol && deskCol && tableHasDesk) {
        // Hierarchical Scoping
        sql += `CREATE POLICY "${table.name}_select_hierarchy" ON ${table.name} FOR SELECT USING (\n  ${ownerCol.name} = auth.uid() OR \n  get_auth_role() IN ('admin', 'compliance_officer', 'risk_manager') OR\n  (get_auth_role() = 'head_trader' AND ${deskCol.name} = get_auth_${deskCol.name}())\n)${activeCheck};\n`;
      } else if (roleCol) {
        // Standard Role Fallback
        sql += `CREATE POLICY "${table.name}_select_owned" ON ${table.name} FOR SELECT USING (\n  ${ownerCol.name} = auth.uid() OR get_auth_role() = 'admin'\n)${activeCheck};\n`;
      } else {
        // Basic Ownership
        sql += `CREATE POLICY "${table.name}_select_owned" ON ${table.name} FOR SELECT USING (${ownerCol.name} = auth.uid())${activeCheck};\n`;
      }

      sql += `CREATE POLICY "${table.name}_insert_owned" ON ${table.name} FOR INSERT WITH CHECK (${ownerCol.name} = auth.uid());\n`;
      sql += `CREATE POLICY "${table.name}_update_owned" ON ${table.name} FOR UPDATE USING (${ownerCol.name} = auth.uid())${activeCheck};\n`;
      sql += `CREATE POLICY "${table.name}_delete_owned" ON ${table.name} FOR DELETE USING (${ownerCol.name} = auth.uid());\n`;
    }
    else {
      // Pattern C: Reference / Lookup Tables (Public Read, Admin Write)
      sql += `CREATE POLICY "${table.name}_select_public" ON ${table.name} FOR SELECT USING (true${activeCheck});\n`;
      if (roleCol) {
        sql += `CREATE POLICY "${table.name}_all_admin" ON ${table.name} FOR ALL USING (get_auth_role() = 'admin');\n`;
      }
    }
    sql += `\n`;
  }

  // Append domain-specific RLS policies
  if (domainPolicies && domainPolicies.length > 0) {
    sql += `-- Domain-Specific RLS Policies\n`;
    for (const dp of domainPolicies) {
      sql += `-- ${dp.description}\n`;
      sql += dp.sql + `\n\n`;
    }
  }

  return sql;
}

// Generate TypeScript types from schema
export function generateSupabaseTypes(tables: TableNode[]): string {
  let ts = "// Generated by VibeDB Supabase Integration\n\n";
  ts +=
    'export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];\n\n';
  ts += "export interface Database {\n";
  ts += "  public: {\n";
  ts += "    Tables: {\n";

  for (const table of tables) {
    ts += `      ${table.name}: {\n`;

    // Row type — all columns with their types
    ts += `        Row: {\n`;
    for (const col of table.columns) {
      const tsType = pgTypeToTs(col.type);
      const nullable =
        !col.constraints?.some((c) => c.type === "notNull") ? " | null" : "";
      ts += `          ${col.name}: ${tsType}${nullable};\n`;
    }
    ts += `        };\n`;

    // Insert type — optional for columns with defaults or PKs
    ts += `        Insert: {\n`;
    for (const col of table.columns) {
      const tsType = pgTypeToTs(col.type);
      const hasDefault =
        col.constraints?.some((c) => c.type === "default") ||
        col.constraints?.some((c) => c.type === "primary");
      const nullable =
        !col.constraints?.some((c) => c.type === "notNull") ? " | null" : "";
      ts += `          ${col.name}${hasDefault ? "?" : ""}: ${tsType}${nullable};\n`;
    }
    ts += `        };\n`;

    // Update type — all columns optional
    ts += `        Update: {\n`;
    for (const col of table.columns) {
      const tsType = pgTypeToTs(col.type);
      const nullable =
        !col.constraints?.some((c) => c.type === "notNull") ? " | null" : "";
      ts += `          ${col.name}?: ${tsType}${nullable};\n`;
    }
    ts += `        };\n`;

    ts += `      };\n`;
  }

  ts += "    };\n";
  ts += "  };\n";
  ts += "}\n";

  return ts;
}

function pgTypeToTs(pgType: string): string {
  const t = pgType.toLowerCase();
  if (
    t === "uuid" ||
    t === "varchar" ||
    t === "text" ||
    t === "char" ||
    t.startsWith("varchar(") ||
    t.startsWith("char(")
  )
    return "string";
  if (
    t === "int" ||
    t === "integer" ||
    t === "bigint" ||
    t === "smallint" ||
    t === "numeric" ||
    t === "decimal" ||
    t === "float" ||
    t === "double precision" ||
    t === "real" ||
    t === "money" ||
    t === "serial" ||
    t === "bigserial" ||
    t === "smallserial"
  )
    return "number";
  if (t === "boolean" || t === "bool") return "boolean";
  if (t === "jsonb" || t === "json") return "Json";
  if (
    t === "timestamp" ||
    t === "timestamptz" ||
    t === "date" ||
    t === "time" ||
    t === "timetz" ||
    t === "interval" ||
    t === "timestamp with time zone" ||
    t === "timestamp without time zone"
  )
    return "string";
  if (t === "bytea") return "string";
  if (t === "inet" || t === "cidr" || t === "macaddr") return "string";
  if (t.endsWith("[]")) return `${pgTypeToTs(t.slice(0, -2))}[]`;
  return "string";
}
