# Problem Brief — The 150-Second Wall, and Two Ideas That Change the Game

**Status:** problem statement only. No solutions proposed here — this documents *what hurts* and *what we want*, as input to a future design doc.
**Related:** `CTO_SPRINT_GUIDE.md` (Prompt 0 touches batch truncation), `COMPILER_ARCHITECTURE.md`, `TYPESCRIPT_FOUNDATIONS.md`.

---

## 1. The Problem: generation lives or dies inside one 150-second request

### 1.1 The hard wall

Supabase edge functions have a ~150s wall-clock limit, and our entire AI pipeline is **one synchronous request/response** inside it. The constraint is documented in the code itself:

```435:436:supabase/functions/vibedb-ai/index.ts
    // Supabase edge functions have a 150s wall-clock timeout.
    // Sonnet 4.6 at ~130 tok/s: 16384 tokens ≈ 126s → fits within timeout.
```

Read that comment carefully: our token budget is not derived from what schemas need — it's **reverse-engineered from the timeout**. 16,384 tokens at Sonnet's speed ≈ 126s, leaving ~24s of headroom for network, prompt processing, and post-processing. At 151 seconds, the request dies and the user gets nothing, no matter how much of the schema the model had already written.

### 1.2 The mitigations we've built (and why they're patches, not fixes)

A lot of engineering has gone into surviving this wall, and it works *most* of the time:

- **Server-side truncation recovery** — when the model hits `max_tokens`, the edge function trims SQL to the last complete statement, performs "smart table-level recovery" on truncated schema JSON, and auto-closes open brackets/braces for other JSON types, returning a `truncated` flag.
- **Client-side reactive chaining** — `runContinuationChain` re-prompts up to 4 more times (5 calls total, `MAX_CONTINUATION_CALLS = 4`), telling the model "you were truncated, continue from table X," then merges the batches.
- **JSON repair** — a multi-step fixer that closes brackets, terminates strings cut mid-value, and extracts whole table objects out of broken JSON.

This is a real achievement — but it's all *recovery after failure*. Every layer exists because the architecture guarantees the failure happens.

### 1.3 The edge cases that still break

Even with batching, failures persist, and they cluster exactly where recovery is hardest:

1. **Each continuation faces the same wall.** Batch 3 of 5 can itself time out or truncate; the chain has no checkpoint, so a late failure can poison the merge.
2. **Cross-batch coherence.** The model in batch 2 doesn't reliably remember batch 1's exact output — it can re-emit tables, rename them, or reference FK targets that ended up trimmed out of an earlier batch. The merge produces dangling `linkedTable` references that FK resolution can't fix.
3. **Truncation mid-structure.** Smart recovery saves complete tables, but a constraint or index cut mid-token is gone — silently. The user sees a schema that *looks* finished.
4. **All-or-nothing UX.** The canvas is empty for up to 150 seconds × 5 batches, then everything appears at once — or an error appears. The user can't see progress, can't tell partial success from total failure, and can't intervene. (This same opacity is what made the empty-canvas race so painful to diagnose.)
5. **Ambition is capped by the clock.** Complex prompts — 15+ tables, rich constraints — are precisely the ones that take longest and fail most. **Our hardest requests have our worst reliability.** And it caps the *model*, not just the schema: Opus-class models produce better schemas but generate slower, so they're ruled out today not on quality or cost, but on the arithmetic of `tokens/sec × timeout`. Some ideas are too big even for Sonnet.

### 1.4 The structural diagnosis

One sentence: **we buffer the entire generation in a place that has a clock.** Everything above is downstream of that. The batching system fights the symptom (output longer than the window) rather than the cause (the window exists at all). Five batches is one number; the sixth-batch schema fails just like the second-batch schema used to.

---

## 2. Idea One: stream the schema into the canvas, table by table

**The vision:** instead of waiting for a finished response, the canvas builds *live*. The first table appears within seconds. The next one lands beside it. FK lines snap into place as their target tables materialize — keys mapped in real time. Generation stops being a 2-minute black box and becomes something you *watch*.

What this changes, conceptually:

- **The timeout stops being a cliff.** If tables arrive incrementally, a connection cut at second 140 means the user keeps the 12 tables already on the canvas — instead of a spinner dissolving into an error. Partial output becomes partial *success*, visibly.
- **Truncation recovery becomes incremental, not forensic.** Today we reconstruct broken JSON after the fact; with streaming, the unit of arrival is small enough that "what's complete" is always known. (Note: our smart table-level recovery is already groping toward this — it recovers *whole tables* from a broken buffer. Streaming makes that boundary the protocol instead of the band-aid.)
- **FK mapping becomes an observable process.** A foreign key that references a not-yet-arrived table is *visibly pending* and resolves when its target lands — the existing `fkStatus` field and FK-resolution pass already model exactly this pending/resolved lifecycle; streaming would surface it.
- **The progress UI becomes honest.** `generation-tracker.ts` currently animates *estimated* steps; with streaming, progress is the actual schema arriving.

Open questions this raises (deliberately unanswered here): where the stream originates and terminates given the edge-function clock; what the streaming unit is (token? statement? table?); how partial IR coexists with undo/history and auto-save; what "cancel" means mid-stream.

---

## 3. Idea Two: write SQL, watch the canvas build itself

**The vision:** an inline SQL editor where typing `CREATE TABLE users (...)` makes a `users` table appear on the canvas *as you write it*. Add a `REFERENCES` clause and the FK line draws itself. The canvas becomes a live visualization of the SQL buffer — authoring and diagramming collapse into one act.

This is the unified SQL editor (sprint Prompt 1) taken to its logical end: not "edit, then Apply," but **continuous bidirectional sync** — SQL-as-you-type → parse → IR → canvas.

- **Types are the guide rails.** This is where "types would help show valid print" is exactly right: the typed IR plus the parser's diagnostics can show, keystroke by keystroke, what's valid — a `varchar` typo, an FK to a nonexistent table, an incomplete constraint — rendered as the analyzer's structured findings (`code`, `path`, `severity`) rather than a generic syntax error. The Prompt 4 AST parser and Prompt 5 analyzer are precisely the machinery this needs; live typing makes them real-time instead of on-demand.
- **It's the same problem as Idea One.** A human typing SQL and a model streaming SQL are *the same input stream* at different speeds. An incremental SQL-text → IR → canvas pipeline serves both. This is the deep connection between the two ideas — they are one architecture with two producers.

Open questions: parse cadence and incomplete-statement tolerance (a buffer is *usually* invalid mid-keystroke); conflict rules when canvas and editor are edited simultaneously; how live parsing interacts with undo granularity; performance budget for parse-on-keystroke at 50-table scale.

---

## 4. The Prize: model freedom

If generation no longer has to *finish* inside a fixed window — because output is consumed incrementally rather than buffered against a clock — then model choice decouples from the timeout arithmetic:

- **Opus becomes viable** for the requests where its quality matters most: the big, intricate, constraint-heavy schemas that currently time out even on Sonnet.
- **Model selection becomes a pure quality/cost decision** (the strategy system in `generation-strategies.ts` already has the right shape for this) instead of a latency-survival decision.
- **Ambition stops being rationed.** "Keep the response compact to avoid truncation" appears in our system prompts today — we are literally instructing the model to aim lower so the pipe doesn't burst. That instruction should not need to exist.

---

## 5. Summary

| | Today | The idea |
|---|---|---|
| Delivery | One buffered response (×5 batches) | Incremental — table by table |
| Timeout at 150s | Total or messy partial failure | Keep everything already arrived |
| Truncation | Post-hoc JSON surgery | Structurally impossible mid-unit |
| User during generation | Spinner, 2+ minutes | Watches the schema assemble |
| FK mapping | Resolved at the end, can dangle | Visibly pending → resolved, live |
| SQL authoring | Edit → Apply (batch) | Type → see it appear |
| Validity feedback | After Apply / after audit | Real-time, typed diagnostics |
| Model ceiling | Whatever fits 150s | Opus-class welcome |

These are big ideas and they are the *same* idea: **make the schema a stream, and make the canvas its live renderer** — whether the author is Claude or a human at a keyboard. How we get there is the next document.
