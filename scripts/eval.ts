// npm run eval — a small, honest eval.
// Part 1: the date resolver against fixed clocks and literal expected dates (no LLM).
// Part 2: 8 live agent cases against a freshly seeded copy of the ledger (data/eval.db),
//         checking date resolution, recall hit/miss, whether a search happened, and latency.

import { rmSync } from 'node:fs';

process.env.DB_PATH = 'data/eval.db';
for (const f of ['', '-wal', '-shm']) rmSync(`data/eval.db${f}`, { force: true }); // start from a clean ledger
await import('../server/env.js');
const { resolveTemporal } = await import('../server/temporal.js');
const { hasKey } = await import('../server/llm.js');
const { chat } = await import('../server/agent.js');
const { seed, EXACT_DATE_OFFSET_DAYS } = await import('./seed.js');
type StreamEvent = import('../server/types.js').StreamEvent;

const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const pad = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s.padEnd(n));

// ── Part 1: temporal resolver ──────────────────────────────────────────────
// Wed 18 Nov 2026 19:20 UTC unless stated. Expected values are written by hand.
const temporalCases: { text: string; now: string; tz: string; from: string; to?: string; note: string }[] = [
  { text: 'On Monday we shortlisted 5 CRMs', now: '2026-11-18T19:20:00Z', tz: 'Europe/London', from: '2026-11-16', note: 'weekday this week' },
  { text: 'Last Tuesday I asked about Postgres', now: '2026-11-18T19:20:00Z', tz: 'Europe/London', from: '2026-11-10', note: '"last" skips yesterday' },
  { text: 'Last Friday', now: '2026-11-18T19:20:00Z', tz: 'Europe/London', from: '2026-11-13', note: 'last Friday from a Wednesday' },
  { text: 'What did I ask you on 3 November?', now: '2026-11-18T19:20:00Z', tz: 'Europe/London', from: '2026-11-03', note: 'exact date' },
  { text: 'what about Dec 25?', now: '2026-11-18T19:20:00Z', tz: 'Europe/London', from: '2025-12-25', note: 'future date → last year' },
  { text: 'yesterday', now: '2026-11-18T19:20:00Z', tz: 'Europe/London', from: '2026-11-17', note: 'yesterday' },
  { text: 'last week', now: '2026-11-18T19:20:00Z', tz: 'Europe/London', from: '2026-11-09', to: '2026-11-15', note: 'Mon–Sun range' },
  { text: 'on Monday', now: '2026-11-18T07:30:00Z', tz: 'America/Los_Angeles', from: '2026-11-16', note: 'LA, 23:30 Tue local' },
  { text: 'yesterday', now: '2026-11-16T20:00:00Z', tz: 'Asia/Kolkata', from: '2026-11-16', note: 'Kolkata, 01:30 Tue local' },
  { text: 'on Monday', now: '2026-11-16T12:00:00Z', tz: 'Europe/London', from: '2026-11-09', note: 'asked on a Monday' },
];

let failures = 0;
console.log('\nTemporal resolver (fixed clocks, literal expectations)\n');
for (const c of temporalCases) {
  const ref = resolveTemporal(c.text, new Date(c.now), c.tz).refs[0];
  const ok = ref?.from === c.from && ref.to === (c.to ?? c.from);
  if (!ok) failures++;
  console.log(`  ${ok ? green('PASS') : red('FAIL')}  ${pad(`"${c.text}"`, 40)} ${pad(c.note, 26)} → ${ref ? `${ref.from}${ref.to !== ref.from ? `..${ref.to}` : ''}` : 'none'}${ok ? '' : red(`  (expected ${c.from})`)}`);
}
const temporalPassed = temporalCases.length - failures;

// ── Part 2: live agent cases ───────────────────────────────────────────────
if (!hasKey()) {
  console.log(red('\nANTHROPIC_API_KEY is not set; skipping live agent cases.'));
  process.exit(failures ? 1 : 0);
}

const dates = seed();
const exactLabel = new Date(`${dates.exact}T00:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'long' });

interface Case {
  name: string;
  text: string;
  date?: string; // expected resolved local date
  recall: 'hit' | 'miss' | 'none';
  search: boolean | null; // null = don't care
  recheck: boolean;
  maxTotalMs: number;
  answerMatches?: RegExp;
}

const cases: Case[] = [
  {
    name: 'CRM shortlist re-check',
    text: 'On Monday we shortlisted 5 CRM tools for a 20-person sales team. Has any of them changed pricing or shipped something big since?',
    date: dates.monday, recall: 'hit', search: true, recheck: true, maxTotalMs: 25_000,
  },
  {
    name: `Exact date (${EXACT_DATE_OFFSET_DAYS} days ago)`,
    text: `What did I ask you on ${exactLabel}? Is your answer still correct today?`,
    date: dates.exact, recall: 'hit', search: true, recheck: true, maxTotalMs: 25_000,
  },
  {
    name: 'Postgres hosting re-check',
    text: 'Last Tuesday I asked you about Postgres hosting. Has any pricing changed since then?',
    date: dates.lastTuesday, recall: 'hit', search: true, recheck: true, maxTotalMs: 25_000,
  },
  {
    name: 'No memory for that date',
    text: 'What did I ask you on 1 August?',
    recall: 'miss', search: false, recheck: false, maxTotalMs: 8_000,
    answerMatches: /(nothing|don'?t have|no (conversation|record)|couldn'?t find|not find)/i,
  },
  {
    name: 'Topic recall, no date',
    text: 'Which Postgres host did you recommend to me earlier?',
    recall: 'hit', search: null, recheck: false, maxTotalMs: 15_000, answerMatches: /(supabase|neon)/i,
  },
  { name: 'Chit-chat, no search', text: "hey, how's your day going?", recall: 'none', search: false, recheck: false, maxTotalMs: 5_000 },
  { name: 'Stable knowledge, no search', text: 'In two sentences: what is the difference between TCP and UDP?', recall: 'none', search: false, recheck: false, maxTotalMs: 8_000 },
  { name: 'Current events, searches', text: 'What is the latest stable version of Node.js right now?', recall: 'none', search: true, recheck: false, maxTotalMs: 15_000 },
];

interface Row { c: Case; ok: boolean; why: string[]; ttft: number | null; total: number; searches: number; date: string; recall: string; fanoutMs: number | null }
const rows: Row[] = [];
console.log(`\nAgent cases (seeded ledger: Monday=${dates.monday}, last Tuesday=${dates.lastTuesday}, exact=${dates.exact})\n`);

for (const c of cases) {
  const events: StreamEvent[] = [];
  const started = Date.now();
  await chat({ text: c.text, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, now: new Date().toISOString() }, (e) => events.push(e), new AbortController().signal);
  const total = Date.now() - started;

  const done = events.find((e): e is Extract<StreamEvent, { type: 'done' }> => e.type === 'done');
  const error = events.find((e): e is Extract<StreamEvent, { type: 'error' }> => e.type === 'error');
  const timeChip = events.find((e) => e.type === 'status' && e.kind === 'time');
  const recallChip = events.find((e): e is Extract<StreamEvent, { type: 'status' }> => e.type === 'status' && e.kind === 'recall');
  const recheck = events.find((e): e is Extract<StreamEvent, { type: 'recheck' }> => e.type === 'recheck');
  const searches = done?.message.metrics?.searches ?? 0;
  const recall = !recallChip ? 'none' : /^Recalled/.test(recallChip.text) ? 'hit' : 'miss';

  const why: string[] = [];
  if (error) why.push(`error: ${error.message}`);
  if (!done) why.push('no answer');
  if (c.date && !(timeChip?.type === 'status' && timeChip.text.length > 0)) why.push('no date resolved');
  if (c.date && recallChip && recall === 'hit' && !recallChip.text.includes(new Date(`${c.date}T00:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' }))) why.push(`recalled wrong date (${recallChip.text})`);
  if (recall !== c.recall) why.push(`recall ${recall}, expected ${c.recall}`);
  if (c.search !== null && (searches > 0) !== c.search) why.push(`searches=${searches}`);
  if (Boolean(recheck) !== c.recheck) why.push(recheck ? 'unexpected re-check' : 'no re-check');
  if (total > c.maxTotalMs) why.push(`slow: ${(total / 1000).toFixed(1)}s > ${c.maxTotalMs / 1000}s`);
  if (c.answerMatches && !c.answerMatches.test(done?.message.content ?? '')) why.push('answer text check failed');

  const row: Row = {
    c, ok: why.length === 0, why, total, searches, recall,
    ttft: done?.message.metrics?.firstTokenMs ?? null,
    date: timeChip?.type === 'status' ? timeChip.text.split('→')[1]?.trim() ?? '' : '—',
    fanoutMs: recheck?.result.ms ?? null,
  };
  rows.push(row);
  const s = (ms: number | null) => (ms === null ? '—' : `${(ms / 1000).toFixed(1)}s`);
  console.log(
    `  ${row.ok ? green('PASS') : red('FAIL')}  ${pad(c.name, 30)} date ${pad(row.date, 11)} recall ${pad(recall, 5)} search ${pad(String(searches), 3)} ` +
      `${recheck ? `re-check ${recheck.result.rows.length} claims/${new Set(recheck.result.rows.map((r) => r.entity)).size} entities in ${s(row.fanoutMs)} ` : ''}` +
      `ttft ${s(row.ttft)} total ${s(total)}${row.ok ? '' : red(`  ← ${why.join('; ')}`)}`,
  );
}

const median = (xs: number[]) => {
  const v = [...xs].sort((a, b) => a - b);
  return v.length ? (v.length % 2 ? v[(v.length - 1) / 2]! : (v[v.length / 2 - 1]! + v[v.length / 2]!) / 2) : 0;
};
const passed = rows.filter((r) => r.ok).length;
const ttfts = rows.filter((r) => !r.c.recheck && r.ttft !== null).map((r) => r.ttft!);
const fanouts = rows.filter((r) => r.fanoutMs !== null).map((r) => r.fanoutMs!);
console.log(`
${dim('Summary')}
  temporal resolver      ${temporalPassed}/${temporalCases.length} pass
  agent cases            ${passed}/${rows.length} pass
  median first token     ${(median(ttfts) / 1000).toFixed(2)}s  ${dim('(non-re-check answers)')}
  re-check fan-out       ${fanouts.map((f) => `${(f / 1000).toFixed(1)}s`).join(', ')}  ${dim('(parallel per-entity verification)')}
`);
process.exit(failures + rows.length - passed > 0 ? 1 : 0);
