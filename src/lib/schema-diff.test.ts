import { describe, expect, it } from "vitest";

import { computeSchemaDiff, generateMigrationSQL } from "@/lib/schema-diff";
import type { TableNode } from "@/lib/types";

const baseline: TableNode[] = [
  {
    id: "profiles",
    name: "profiles",
    x: 0,
    y: 0,
    columns: [
      { id: "profiles-id", name: "id", type: "uuid", constraints: [{ type: "primary" }, { type: "notNull" }] },
      { id: "profiles-email", name: "email", type: "text", constraints: [{ type: "notNull" }] },
    ],
  },
];

describe("schema diff migration SQL", () => {
  it("generates additive column SQL without full rebuild drops", () => {
    const next: TableNode[] = [
      {
        ...baseline[0],
        columns: [
          ...baseline[0].columns,
          { id: "profiles-display-name", name: "display_name", type: "text" },
        ],
      },
    ];

    const sql = generateMigrationSQL(computeSchemaDiff(baseline, next));

    expect(sql).toContain("ALTER TABLE profiles ADD COLUMN display_name TEXT;");
    expect(sql).not.toContain("DROP TABLE");
  });

  it("generates create table SQL for added tables", () => {
    const next: TableNode[] = [
      ...baseline,
      {
        id: "orders",
        name: "orders",
        x: 300,
        y: 0,
        columns: [
          { id: "orders-id", name: "id", type: "uuid", constraints: [{ type: "primary" }, { type: "notNull" }] },
          { id: "orders-profile-id", name: "profile_id", type: "uuid", isForeignKey: true, linkedTable: "profiles", linkedColumn: "id" },
        ],
      },
    ];

    const sql = generateMigrationSQL(computeSchemaDiff(baseline, next));

    expect(sql).toContain("CREATE TABLE orders");
    expect(sql).toContain("REFERENCES profiles(id)");
    expect(sql).not.toContain("DROP TABLE");
  });
});
