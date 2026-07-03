import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useInView, useReducedMotion } from "framer-motion";
import { CheckCircle2, Key, Link2, Sparkles, Table2 } from "lucide-react";
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
  badge: number;
  cycleMs: number;
}

interface StageSpec {
  w: number;
  h: number;
  prompt: string | null;
  tables: TableSpec[];
  edges: EdgeSpec[];
  t: Timing;
}

const HEADER_H = 36;
const ROW_H = 28;

const DESKTOP: StageSpec = {
  w: 960,
  h: 520,
  prompt: "an app with users, projects and deployments",
  tables: [
    {
      id: "users",
      name: "users",
      x: 40,
      y: 170,
      w: 230,
      columns: [
        { name: "id", type: "uuid", pk: true },
        { name: "email", type: "text" },
        { name: "name", type: "text" },
        { name: "created_at", type: "timestamptz" },
      ],
    },
    {
      id: "projects",
      name: "projects",
      x: 365,
      y: 104,
      w: 230,
      columns: [
        { name: "id", type: "uuid", pk: true },
        { name: "owner_id", type: "uuid", fk: true },
        { name: "name", type: "text" },
        { name: "status", type: "text" },
        { name: "updated_at", type: "timestamptz" },
      ],
    },
    {
      id: "deployments",
      name: "deployments",
      x: 690,
      y: 210,
      w: 230,
      columns: [
        { name: "id", type: "uuid", pk: true },
        { name: "project_id", type: "uuid", fk: true },
        { name: "triggered_by", type: "uuid", fk: true },
        { name: "region", type: "text" },
        { name: "deployed_at", type: "timestamptz" },
      ],
    },
  ],
  edges: [
    { from: ["projects", 1], to: ["users", 0] },
    { from: ["deployments", 1], to: ["projects", 0] },
    { from: ["deployments", 2], to: ["users", 0] },
  ],
  t: {
    prompt: 0.3,
    promptDur: 1.3,
    tables: 1.6,
    tableStagger: 0.45,
    rowStagger: 0.07,
    edges: 4.0,
    edgeStagger: 0.55,
    edgeDur: 0.7,
    badge: 6.4,
    cycleMs: 11_000,
  },
};

const MOBILE: StageSpec = {
  w: 380,
  h: 340,
  prompt: null,
  tables: [
    {
      id: "projects",
      name: "projects",
      x: 174,
      y: 24,
      w: 190,
      columns: [
        { name: "id", type: "uuid", pk: true },
        { name: "owner_id", type: "uuid", fk: true },
        { name: "name", type: "text" },
      ],
    },
    {
      id: "users",
      name: "users",
      x: 16,
      y: 190,
      w: 190,
      columns: [
        { name: "id", type: "uuid", pk: true },
        { name: "email", type: "text" },
        { name: "name", type: "text" },
      ],
    },
  ],
  edges: [{ from: ["projects", 1], to: ["users", 0] }],
  t: {
    prompt: 0,
    promptDur: 0,
    tables: 0.4,
    tableStagger: 0.45,
    rowStagger: 0.07,
    edges: 2.4,
    edgeStagger: 0.55,
    edgeDur: 0.7,
    badge: 3.8,
    cycleMs: 8_000,
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
}

function resolveEdge(spec: StageSpec, edge: EdgeSpec): ResolvedEdge {
  const source = spec.tables.find((t) => t.id === edge.from[0])!;
  const target = spec.tables.find((t) => t.id === edge.to[0])!;
  const sy = rowCenterY(source, edge.from[1]);
  const ty = rowCenterY(target, edge.to[1]);

  // Anchor each end on the side facing the other table.
  const targetIsLeft = tableCenterX(target) < tableCenterX(source);
  const sx = targetIsLeft ? source.x : source.x + source.w;
  const sDir = targetIsLeft ? -1 : 1;
  const tx = targetIsLeft ? target.x + target.w : target.x;
  const tDir = targetIsLeft ? 1 : -1;

  const dx = Math.max(40, Math.min(120, Math.abs(tx - sx) * 0.5));
  const path = `M ${sx} ${sy} C ${sx + sDir * dx} ${sy}, ${tx + tDir * dx} ${ty}, ${tx} ${ty}`;
  return { path, sx, sy, tx, ty };
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

const SchemaShowcase = () => {
  const reduce = useReducedMotion();
  const isMobile = useIsMobile();
  const spec = isMobile ? MOBILE : DESKTOP;
  const { t } = spec;

  const wrapRef = useRef<HTMLDivElement>(null);
  const inView = useInView(wrapRef, { amount: 0.2 });
  const [scale, setScale] = useState(1);
  const [cycle, setCycle] = useState(0);
  const gradId = useId();

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

  const edges = spec.edges.map((e) => resolveEdge(spec, e));
  const flashes = flashDelays(spec);
  const promptChars = spec.prompt ? Array.from(spec.prompt) : [];

  return (
    <div
      ref={wrapRef}
      aria-hidden="true"
      className="pointer-events-none relative mx-auto w-full max-w-[960px] select-none overflow-hidden"
      style={{ height: spec.h * scale }}
    >
      <AnimatePresence mode="wait">
        <motion.div
          key={`${cycle}-${isMobile ? "m" : "d"}`}
          exit={reduce ? undefined : { opacity: 0, transition: { duration: 0.5 } }}
          className="absolute left-0 top-0"
          style={{ width: spec.w, height: spec.h, transform: `scale(${scale})`, transformOrigin: "top left" }}
        >
          {/* Prompt chip */}
          {spec.prompt && (
            <motion.div
              className="absolute flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-4 py-2"
              style={{ left: 40, top: 44 }}
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

          {/* FK edges */}
          <svg
            className="absolute inset-0"
            width={spec.w}
            height={spec.h}
            viewBox={`0 0 ${spec.w} ${spec.h}`}
            fill="none"
          >
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2={spec.w} y2="0" gradientUnits="userSpaceOnUse">
                <stop offset="0" stopColor="#2eb889" />
                <stop offset="1" stopColor="#E87A31" />
              </linearGradient>
            </defs>
            {edges.map((edge, i) => {
              const delay = t.edges + i * t.edgeStagger;
              return (
                <g key={i}>
                  <motion.path
                    d={edge.path}
                    stroke={`url(#${gradId})`}
                    strokeWidth={2}
                    strokeLinecap="round"
                    initial={reduce ? false : { pathLength: 0, opacity: 0 }}
                    animate={{ pathLength: 1, opacity: 0.9 }}
                    transition={{ delay: reduce ? 0 : delay, duration: reduce ? 0 : t.edgeDur, ease: "easeInOut" as const }}
                  />
                  <motion.circle
                    cx={edge.sx}
                    cy={edge.sy}
                    r={3.5}
                    fill="#2eb889"
                    initial={reduce ? false : { scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ delay: reduce ? 0 : delay, duration: 0.25 }}
                  />
                  <motion.circle
                    cx={edge.tx}
                    cy={edge.ty}
                    r={3.5}
                    fill="#E87A31"
                    initial={reduce ? false : { scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ delay: reduce ? 0 : delay + t.edgeDur, duration: 0.25 }}
                  />
                </g>
              );
            })}
          </svg>

          {/* Tables */}
          {spec.tables.map((table, ti) => {
            const tableDelay = t.tables + ti * t.tableStagger;
            return (
              <motion.div
                key={table.id}
                className="absolute rounded-lg border border-white/10 bg-[#0d0f0e] shadow-[0_8px_40px_rgba(0,0,0,0.6)]"
                style={{ left: table.x, top: table.y, width: table.w }}
                initial={reduce ? false : { opacity: 0, y: 14, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={
                  reduce
                    ? { duration: 0 }
                    : { type: "spring", stiffness: 260, damping: 24, delay: tableDelay }
                }
              >
                <div className="flex items-center gap-2 border-b border-white/10 px-3" style={{ height: HEADER_H }}>
                  <Table2 size={13} className="shrink-0 text-vibe-green" />
                  <span className="text-[13px] font-semibold tracking-wide text-white/90">{table.name}</span>
                </div>
                {table.columns.map((col, ci) => {
                  const flashAt = flashes.get(`${table.id}:${ci}`);
                  return (
                    <div key={col.name} className="relative flex items-center px-3" style={{ height: ROW_H }}>
                      {flashAt !== undefined && !reduce && (
                        <motion.div
                          className="absolute inset-x-0 inset-y-[1px] bg-vibe-green/20"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: [0, 1, 0] }}
                          transition={{ delay: flashAt, duration: 0.6, times: [0, 0.3, 1] }}
                        />
                      )}
                      <motion.div
                        className="flex w-full items-center gap-2 font-mono"
                        initial={reduce ? false : { opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{
                          delay: reduce ? 0 : tableDelay + 0.25 + ci * t.rowStagger,
                          duration: 0.35,
                          ease: "easeOut" as const,
                        }}
                      >
                        {col.pk ? (
                          <Key size={11} className="shrink-0 text-vibe-orange" />
                        ) : col.fk ? (
                          <Link2 size={11} className="shrink-0 text-vibe-green" />
                        ) : (
                          <span className="w-[11px] shrink-0" />
                        )}
                        <span className="text-xs text-white/80">{col.name}</span>
                        <span className="ml-auto text-[11px] text-white/35">{col.type}</span>
                      </motion.div>
                    </div>
                  );
                })}
              </motion.div>
            );
          })}

          {/* Validated badge */}
          <motion.div
            className="absolute bottom-4 right-4"
            initial={reduce ? false : { opacity: 0, y: 8, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={
              reduce ? { duration: 0 } : { delay: t.badge, type: "spring", stiffness: 300, damping: 20 }
            }
          >
            <Badge className="gap-1.5 border-vibe-green/40 bg-vibe-green/10 font-medium text-vibe-green hover:bg-vibe-green/10">
              <CheckCircle2 size={13} />
              Schema validated · 0 issues
            </Badge>
          </motion.div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
};

export default SchemaShowcase;
