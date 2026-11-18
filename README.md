# minimi chat agent

**A chat agent that keeps receipts:** every answer is stored as a dated, sourced record, so you can ask "what did you tell me on Monday, and is it still true?" and get a real answer.

One tool (web search), one API key, TypeScript end to end.

## Quickstart (60 seconds)

Requires **Node 22.12+** (see `.nvmrc`; developed on Node 26).

```bash
npm install
cp .env.example .env        # then paste your key after ANTHROPIC_API_KEY=
npm run seed                # optional: demo history dated relative to today
npm run dev                 # http://localhost:5173
```

Without a key the app still starts and shows an "Add ANTHROPIC_API_KEY to .env" screen.

The demo seed is dated relative to the day you run it ("Monday", "last Tuesday", 15 days ago), so re-run `npm run seed` on the day you demo.

The demo seed is dated relative to the day you run it ("Monday", "last Tuesday", 15 days ago). Re-run `npm run seed` on the day you demo.

## What to try

With the demo seed loaded, click the example prompts on the empty screen, or type:

1. `On Monday we shortlisted 5 CRM tools for a 20-person sales team. Has any of them changed pricing or shipped something big since?`
   → resolves "Monday" to a date, recalls that conversation, re-checks the 5 tools in parallel and shows a **Then → Now** diff card.
2. `What did I ask you on <date 15 days ago>? Is your answer still correct today?` (the empty-state button fills in the date)
3. `Last Tuesday I asked you about Postgres hosting. Has any pricing changed since then?`
4. `What did I ask you on 1 August?` → it says honestly that it has nothing from then, and offers the closest entries.
5. `hey, how's it going?` → answers directly, no search.
6. Open a seeded conversation in the sidebar and click **May be stale · Re-check** under the answer.

Every answer shows its metrics underneath: total time, time to first token, searches, sources.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | API (Hono, port 8787) + web (Vite, port 5173) with hot reload |
| `npm run seed` | Insert demo conversations, flagged "demo seed" in the UI |
| `npm run seed:reset` | Remove the demo conversations |
| `npm run eval` | Date-resolver and recall checks (no LLM), then 8 live agent cases on a separate DB copy; prints a pass/fail table |
| `npm run typecheck` | Strict TypeScript over server, scripts and web |
| `npm start` | API only, no watch |

## Configuration

All settings live in `.env` (see `.env.example`):

- `ANTHROPIC_API_KEY`: required. Runs the model and its server-side web search.
- `ANTHROPIC_MODEL`: defaults to `claude-haiku-5-5`. Set `claude-sonnet-5-5` for a stronger model; thinking and search settings adapt per model.
- Optional: `API_PORT` (default 8787) and `WEB_PORT` (default 5173).

Web search must be enabled for your Anthropic organization (an admin can turn it on in the Claude Console's organization settings). If it isn't, the chat says so instead of failing silently.

## Project structure

```
server/
  index.ts      HTTP routes and the SSE chat stream (Hono)
  agent.ts      orchestrator: dates → recall → answer with search, or re-check
  temporal.ts   deterministic date resolver ("last Tuesday" → Tue 10 Nov), time-zone aware
  recall.ts     finds past turns by date window and keyword overlap
  ledger.ts     receipts: messages, sources, metrics; background claim extraction
  recheck.ts    parallel per-entity claim verification (Then → Now)
  prompts.ts    every prompt in one place
  llm.ts        model, web search tool and thinking settings; friendly API errors
  db.ts         SQLite schema (data/minimi.db, created automatically)
  types.ts      types shared with the web client
web/src/
  App.tsx       state, streaming, keyboard shortcuts
  components/   Sidebar, MessageView, StatusChips, RecheckCard, Sources, Composer, EmptyState, SetupScreen
  lib/          API client (SSE) and date helpers
scripts/
  seed.ts       demo history, dated relative to today
  eval.ts       the eval
```

Design notes and trade-offs: [DESIGN.md](DESIGN.md).
