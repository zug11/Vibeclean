import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, animate, motion, useInView, useReducedMotion } from "framer-motion";
import { CheckCircle2, Hash, Key, Link2, Loader2, Pencil, Sparkles, Table2, Trash2, Wand2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useIsMobile } from "@/hooks/use-mobile";

interface ColumnSpec {
  name: string;
  type: string;
  pk?: boolean;
  fk?: boolean;
}

interface TableSpec {
  id: string;
  name: string;
  x: number;
  y: number;
  w: number;
  columns: ColumnSpec[];
}

interface EdgeSpec {
  from: [tableId: string, colIdx: number];
  to: [tableId: string, colIdx: number];
  /** Self-references render as a small arc in orange, like the product. */
  accent?: boolean;
}

interface Timing {
  prompt: number;
  promptDur: number;
  tables: number;
  tableStagger: number;
  rowStagger: number;
  edges: number;
  edgeStagger: number;
  edgeDur: number;
  /** Generation progress bar + % counter run from `tables` to `genDone`. */
  genDone: number;
  badge: number;
  cycleMs: number;
}

interface StageSpec {
  w: number;
  h: number;
  prompt: string | null;
  minimap: boolean;
  tables: TableSpec[];
  edges: EdgeSpec[];
  t: Timing;
}

const HEADER_H = 32;
const ROW_H = 24;
const FOOTER_H = 24;

const tableH = (t: TableSpec) => HEADER_H + t.columns.length * ROW_H + FOOTER_H;

const DESKTOP: StageSpec = {
  w: 960,
  h: 600,
  prompt: "a marketplace with merchants, brands and products",
  minimap: true,
  tables: [
    {
      id: "merchants",
      name: "merchants",
      x: 388,
      y: 64,
      w: 205,
      columns: [
        { name: "id", type: "uuid", pk: true },
        { name: "name", type: "varchar" },
        { name: "status", type: "varchar" },
        { name: "country_code", type: "varchar" },
        { name: "website_url", type: "text" },
      ],
    },
    {
      id: "brands",
      name: "brands",
      x: 60,
      y: 96,
      w: 205,
      columns: [
        { name: "id", type: "uuid", pk: true },
        { name: "merchant_id", type: "uuid", fk: true },
        { name: "name", type: "varchar" },
        { name: "slug", type: "varchar" },
        { name: "status", type: "varchar" },
        { name: "created_at", type: "timestamptz" },
      ],
    },
    {
      id: "products",
      name: "products",
      x: 700,
      y: 72,
      w: 205,
      columns: [
        { name: "id", type: "uuid", pk: true },
        { name: "merchant_id", type: "uuid", fk: true },
        { name: "brand_id", type: "uuid", fk: true },
        { name: "name", type: "varchar" },
        { name: "price", type: "numeric" },
        { name: "currency", type: "varchar" },
        { name: "is_active", type: "boolean" },
      ],
    },
    {
      id: "users",
      name: "users",
      x: 60,
      y: 372,
      w: 205,
      columns: [
        { name: "id", type: "uuid", pk: true },
        { name: "email", type: "varchar" },
        { name: "username", type: "varchar" },
        { name: "status", type: "varchar" },
        { name: "last_login_at", type: "timestamptz" },
      ],
    },
    {
      id: "user_interests",
      name: "user_interests",
      x: 388,
      y: 348,
      w: 205,
      columns: [
        { name: "id", type: "uuid", pk: true },
        { name: "user_id", type: "uuid", fk: true },
        { name: "interest_id", type: "uuid", fk: true },
        { name: "source", type: "varchar" },
        { name: "confidence_score", type: "numeric" },
        { name: "created_at", type: "timestamptz" },
      ],
    },
    {
      id: "interests",
      name: "interests",
      x: 700,
      y: 340,
      w: 205,
      columns: [
        { name: "id", type: "uuid", pk: true },
        { name: "parent_id", type: "uuid", fk: true },
        { name: "name", type: "varchar" },
        { name: "slug", type: "varchar" },
        { name: "metadata", type: "jsonb" },
      ],
    },
  ],
  edges: [
    { from: ["brands", 1], to: ["merchants", 0] },
    { from: ["products", 1], to: ["merchants", 0] },
    { from: ["products", 2], to: ["brands", 0] },
    { from: ["user_interests", 1], to: ["users", 0] },
    { from: ["user_interests", 2], to: ["interests", 0] },
    { from: ["interests", 1], to: ["interests", 0], accent: true },
  ],
  t: {
    prompt: 0.3,
    promptDur: 1.5,
    tables: 1.7,
    tableStagger: 0.5,
    rowStagger: 0.06,
    edges: 5.0,
    edgeStagger: 0.45,
    edgeDur: 0.8,
    genDone: 8.2,
    badge: 8.6,
    cycleMs: 14_000,
  },
};

const MOBILE: StageSpec = {
  w: 380,
  h: 400,
  prompt: null,
  minimap: false,
  tables: [
    {
      id: "merchants",
      name: "merchants",
      x: 16,
      y: 28,
      w: 190,
      columns: [
        { name: "id", type: "uuid", pk: true },
        { name: "name", type: "varchar" },
        { name: "status", type: "varchar" },
      ],
    },
    {
      id: "products",
      name: "products",
      x: 174,
      y: 224,
      w: 190,
      columns: [
        { name: "id", type: "uuid", pk: true },
        { name: "merchant_id", type: "uuid", fk: true },
        { name: "name", type: "varchar" },
        { name: "price", type: "numeric" },
      ],
    },
  ],
  edges: [{ from: ["products", 1], to: ["merchants", 0] }],
  t: {
    prompt: 0,
    promptDur: 0,
    tables: 0.4,
    tableStagger: 0.5,
    rowStagger: 0.06,
    edges: 2.6,
    edgeStagger: 0.45,
    edgeDur: 0.8,
    genDone: 3.6,
    badge: 3.9,
    cycleMs: 9_500,
  },
};

const rowCenterY = (table: TableSpec, colIdx: number) =>
  table.y + HEADER_H + colIdx * ROW_H + ROW_H / 2;

const tableCenterX = (table: TableSpec) => table.x + table.w / 2;

interface ResolvedEdge {
  path: string;
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  sDir: number;
  tDir: number;
  color: string;
}

function resolveEdge(spec: StageSpec, edge: EdgeSpec): ResolvedEdge {
  const source = spec.tables.find((t) => t.id === edge.from[0])!;
  const target = spec.tables.find((t) => t.id === edge.to[0])!;
  const sy = rowCenterY(source, edge.from[1]);
  const ty = rowCenterY(target, edge.to[1]);
  const color = edge.accent ? "#E87A31" : "#2eb889";

  // Self-reference: small arc bulging off the table's right edge.
  if (source.id === target.id) {
    const x = source.x + source.w;
    return {
      path: `M ${x} ${sy} C ${x + 54} ${sy}, ${x + 54} ${ty}, ${x} ${ty}`,
      sx: x,
      sy,
      tx: x,
      ty,
      sDir: 1,
      tDir: 1,
      color,
    };
  }

  // Anchor each end on the side facing the other table; long sweeping handles.
  const targetIsLeft = tableCenterX(target) < tableCenterX(source);
  const sx = targetIsLeft ? source.x : source.x + source.w;
  const sDir = targetIsLeft ? -1 : 1;
  const tx = targetIsLeft ? target.x + target.w : target.x;
  const tDir = targetIsLeft ? 1 : -1;

  const dx = Math.max(60, Math.min(220, Math.abs(tx - sx) * 0.6));
  const path = `M ${sx} ${sy} C ${sx + sDir * dx} ${sy}, ${tx + tDir * dx} ${ty}, ${tx} ${ty}`;
  return { path, sx, sy, tx, ty, sDir, tDir, color };
}

/** Rows that receive a highlight flash when their FK edge finishes drawing. */
function flashDelays(spec: StageSpec): Map<string, number> {
  const map = new Map<string, number>();
  spec.edges.forEach((edge, i) => {
    const at = spec.t.edges + i * spec.t.edgeStagger + spec.t.edgeDur;
    map.set(edge.from.join(":"), at);
    map.set(edge.to.join(":"), at);
  });
  return map;
}

const RowPill = ({ kind }: { kind: "pk" | "fk" }) => (
  <span
    className={
      kind === "pk"
        ? "rounded-[3px] border border-vibe-orange/40 bg-vibe-orange/10 px-[3px] py-px text-[8px] font-semibold leading-none text-vibe-orange"
        : "rounded-[3px] border border-vibe-green/40 bg-vibe-green/10 px-[3px] py-px text-[8px] font-semibold leading-none text-vibe-green"
    }
  >
    {kind === "pk" ? "PK" : "FK"}
  </span>
);

const SchemaShowcase = () => {
  const reduce = useReducedMotion();
  const isMobile = useIsMobile();
  const spec = isMobile ? MOBILE : DESKTOP;
  const { t } = spec;

  const wrapRef = useRef<HTMLDivElement>(null);
  const inView = useInView(wrapRef, { amount: 0.2 });
  const [scale, setScale] = useState(1);
  const [cycle, setCycle] = useState(0);
  const [pct, setPct] = useState(reduce ? 100 : 0);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setScale(Math.min(1, el.clientWidth / spec.w));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [spec.w]);

  useEffect(() => {
    if (reduce || !inView) return;
    const id = window.setInterval(() => setCycle((c) => c + 1), t.cycleMs);
    return () => window.clearInterval(id);
  }, [reduce, inView, t.cycleMs]);

  // Generation % counter, synced to the table/edge window.
  useEffect(() => {
    if (reduce) {
      setPct(100);
      return;
    }
    setPct(0);
    const controls = animate(0, 100, {
      delay: t.tables - 0.3,
      duration: t.genDone - (t.tables - 0.3),
      ease: "linear",
      onUpdate: (v) => setPct(Math.round(v)),
    });
    return () => controls.stop();
  }, [cycle, reduce, t.tables, t.genDone]);

  const edges = spec.edges.map((e) => resolveEdge(spec, e));
  const flashes = flashDelays(spec);
  const promptChars = spec.prompt ? Array.from(spec.prompt) : [];

  return (
    <div
      ref={wrapRef}
      aria-hidden="true"
      className="pointer-events-none relative mx-auto w-full max-w-[960px] select-none overflow-hidden rounded-lg"
      style={{
        height: spec.h * scale,
        backgroundImage: "radial-gradient(rgba(255,255,255,0.055) 1px, transparent 1.2px)",
        backgroundSize: "22px 22px",
      }}
    >
      <AnimatePresence mode="wait">
        <motion.div
          key={`${cycle}-${isMobile ? "m" : "d"}`}
          className="absolute inset-0"
          exit={reduce ? undefined : { opacity: 0, transition: { duration: 0.5 } }}
        >
      {/* Generation progress bar, like the strip under the app toolbar */}
      <motion.div
        className="absolute left-0 top-0 z-10 h-[2px] rounded-full bg-vibe-green shadow-[0_0_12px_rgba(46,184,137,0.8)]"
        initial={reduce ? { width: "100%" } : { width: "0%" }}
        animate={{ width: "100%" }}
        transition={reduce ? { duration: 0 } : { delay: t.tables - 0.3, duration: t.genDone - (t.tables - 0.3), ease: "linear" }}
      />

      {/* Top-right: spinner + % while generating → validated badge when done */}
      <div className="absolute right-3 top-3 z-10 md:right-4 md:top-4">
        {!reduce && (
          <motion.div
            className="absolute right-0 top-0 flex items-center gap-1.5 whitespace-nowrap font-mono text-[11px] text-white/60"
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 1, 1, 0] }}
            transition={{ duration: t.badge, times: [0, 0.08, 0.94, 1] }}
          >
            <motion.span
              className="inline-flex"
              animate={{ rotate: 360 }}
              transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
            >
              <Loader2 size={12} className="text-vibe-green" />
            </motion.span>
            {pct}%
          </motion.div>
        )}
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 6, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={reduce ? { duration: 0 } : { delay: t.badge, type: "spring", stiffness: 300, damping: 20 }}
        >
          <Badge className="gap-1.5 border-vibe-green/40 bg-vibe-green/10 font-medium text-vibe-green hover:bg-vibe-green/10">
            <CheckCircle2 size={13} />
            Schema validated · 0 issues
          </Badge>
        </motion.div>
      </div>

        <div
          className="absolute left-0 top-0"
          style={{ width: spec.w, height: spec.h, transform: `scale(${scale})`, transformOrigin: "top left" }}
        >
          {/* Prompt chip */}
          {spec.prompt && (
            <motion.div
              className="absolute flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-4 py-2"
              style={{ left: 40, top: 24 }}
              initial={reduce ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: reduce ? 0 : t.prompt, duration: 0.4 }}
            >
              <Sparkles size={13} className="shrink-0 text-vibe-green" />
              <span className="font-mono text-xs text-white/70">
                {reduce
                  ? spec.prompt
                  : promptChars.map((ch, i) => (
                      <motion.span
                        key={i}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: t.prompt + (i * t.promptDur) / promptChars.length, duration: 0.02 }}
                      >
                        {ch}
                      </motion.span>
                    ))}
              </span>
              {!reduce && (
                <motion.span
                  className="-ml-1"
                  initial={{ opacity: 1 }}
                  animate={{ opacity: 0 }}
                  transition={{ delay: t.prompt + t.promptDur + 0.6, duration: 0.2 }}
                >
                  <motion.span
                    className="inline-block h-3 w-[2px] bg-vibe-green align-middle"
                    animate={{ opacity: [1, 0, 1] }}
                    transition={{ duration: 0.9, repeat: Infinity, ease: "linear" as const }}
                  />
                </motion.span>
              )}
            </motion.div>
          )}

          {/* FK edges — behind the table cards, like the product canvas */}
          <svg
            className="absolute inset-0"
            width={spec.w}
            height={spec.h}
            viewBox={`0 0 ${spec.w} ${spec.h}`}
            fill="none"
          >
            {edges.map((edge, i) => {
              const delay = t.edges + i * t.edgeStagger;
              const selfRef = edge.sx === edge.tx && edge.sDir === edge.tDir;
              return (
                <g key={i}>
                  <motion.path
                    d={edge.path}
                    stroke={edge.color}
                    strokeWidth={1.8}
                    strokeLinecap="round"
                    initial={reduce ? false : { pathLength: 0, opacity: 0 }}
                    animate={{ pathLength: 1, opacity: 0.85 }}
                    transition={{ delay: reduce ? 0 : delay, duration: reduce ? 0 : t.edgeDur, ease: "easeInOut" as const }}
                  />
                  <motion.circle
                    cx={edge.sx}
                    cy={edge.sy}
                    r={3}
                    fill={edge.color}
                    initial={reduce ? false : { scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ delay: reduce ? 0 : delay, duration: 0.25 }}
                  />
                  <motion.circle
                    cx={edge.tx}
                    cy={edge.ty}
                    r={3}
                    fill={edge.color}
                    initial={reduce ? false : { scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ delay: reduce ? 0 : delay + t.edgeDur, duration: 0.25 }}
                  />
                  {/* Cardinality labels (N → 1), skipped on self-reference arcs */}
                  {!selfRef && (
                    <>
                      <motion.text
                        x={edge.sx + edge.sDir * 8}
                        y={edge.sy - 6}
                        fill="rgba(255,255,255,0.55)"
                        fontSize={9}
                        fontFamily="'JetBrains Mono', monospace"
                        textAnchor={edge.sDir > 0 ? "start" : "end"}
                        initial={reduce ? false : { opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: reduce ? 0 : delay + 0.15, duration: 0.3 }}
                      >
                        N
                      </motion.text>
                      <motion.text
                        x={edge.tx + edge.tDir * 8}
                        y={edge.ty - 6}
                        fill="rgba(255,255,255,0.55)"
                        fontSize={9}
                        fontFamily="'JetBrains Mono', monospace"
                        textAnchor={edge.tDir > 0 ? "start" : "end"}
                        initial={reduce ? false : { opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: reduce ? 0 : delay + t.edgeDur, duration: 0.3 }}
                      >
                        1
                      </motion.text>
                    </>
                  )}
                </g>
              );
            })}
          </svg>

          {/* Table cards */}
          {spec.tables.map((table, ti) => {
            const tableDelay = t.tables + ti * t.tableStagger;
            return (
              <motion.div
                key={table.id}
                className="absolute rounded-lg border border-white/[0.09] bg-[#0f1312] shadow-[0_10px_44px_rgba(0,0,0,0.65)]"
                style={{ left: table.x, top: table.y, width: table.w }}
                initial={reduce ? false : { opacity: 0, y: 14, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={
                  reduce
                    ? { duration: 0 }
                    : { type: "spring", stiffness: 260, damping: 24, delay: tableDelay }
                }
              >
                <div
                  className="flex items-center gap-1.5 rounded-t-lg border-b border-white/[0.07] bg-white/[0.03] px-2.5"
                  style={{ height: HEADER_H }}
                >
                  <Table2 size={11} className="shrink-0 text-vibe-green" />
                  <span className="truncate text-xs font-semibold tracking-wide text-white/90">{table.name}</span>
                  <span className="ml-auto flex shrink-0 items-center gap-1.5 text-white/20">
                    <Pencil size={9} />
                    <Wand2 size={9} />
                    <Trash2 size={9} />
                  </span>
                </div>
                {table.columns.map((col, ci) => {
                  const flashAt = flashes.get(`${table.id}:${ci}`);
                  return (
                    <div key={col.name} className="relative flex items-center px-2.5" style={{ height: ROW_H }}>
                      {flashAt !== undefined && !reduce && (
                        <motion.div
                          className="absolute inset-x-0 inset-y-px bg-vibe-green/20"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: [0, 1, 0] }}
                          transition={{ delay: flashAt, duration: 0.6, times: [0, 0.3, 1] }}
                        />
                      )}
                      <motion.div
                        className="flex w-full items-center gap-1.5 font-mono"
                        initial={reduce ? false : { opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{
                          delay: reduce ? 0 : tableDelay + 0.25 + ci * t.rowStagger,
                          duration: 0.35,
                          ease: "easeOut" as const,
                        }}
                      >
                        {col.pk ? (
                          <Key size={10} className="shrink-0 text-vibe-orange" />
                        ) : col.fk ? (
                          <Link2 size={10} className="shrink-0 text-vibe-green" />
                        ) : (
                          <Hash size={10} className="shrink-0 text-white/20" />
                        )}
                        <span
                          className={
                            col.fk
                              ? "truncate text-[11px] text-vibe-green"
                              : col.pk
                                ? "truncate text-[11px] text-white/90"
                                : "truncate text-[11px] text-white/70"
                          }
                        >
                          {col.name}
                        </span>
                        <span className="ml-auto flex shrink-0 items-center gap-1.5">
                          <span className="text-[10px] text-white/30">{col.type}</span>
                          {col.pk && <RowPill kind="pk" />}
                          {col.fk && <RowPill kind="fk" />}
                        </span>
                      </motion.div>
                    </div>
                  );
                })}
                <div
                  className="flex items-center justify-center rounded-b-lg border-t border-white/[0.05] text-[10px] text-white/25"
                  style={{ height: FOOTER_H }}
                >
                  + Add Column
                </div>
              </motion.div>
            );
          })}

          {/* Minimap, bottom-right like the product */}
          {spec.minimap && (
            <motion.div
              className="absolute bottom-2 right-2 h-[72px] w-[110px] overflow-hidden rounded-md border border-vibe-green/25 bg-black/60"
              initial={reduce ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: reduce ? 0 : t.tables, duration: 0.5 }}
            >
              <div className="absolute inset-1 rounded-sm border border-vibe-green/20" />
              {spec.tables.map((table, ti) => (
                <motion.div
                  key={table.id}
                  className="absolute rounded-[2px] border border-vibe-orange/70 bg-vibe-orange/40"
                  style={{
                    left: `${(table.x / spec.w) * 100}%`,
                    top: `${(table.y / spec.h) * 100}%`,
                    width: `${(table.w / spec.w) * 100}%`,
                    height: `${(tableH(table) / spec.h) * 100}%`,
                  }}
                  initial={reduce ? false : { opacity: 0, scale: 0.6 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={
                    reduce
                      ? { duration: 0 }
                      : { delay: t.tables + ti * t.tableStagger + 0.1, type: "spring", stiffness: 300, damping: 22 }
                  }
                />
              ))}
            </motion.div>
          )}
        </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
};

export default SchemaShowcase;
