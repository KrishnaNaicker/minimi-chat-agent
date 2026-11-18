import type Anthropic from '@anthropic-ai/sdk';
import {
  allTurns, conversationExists, createConversation, extractClaims, getClaims, getMessage, getMessages,
  saveMessage, waitForExtraction, type Claim,
} from './ledger.js';
import { anthropic, friendlyError, MODEL, speedParams, webSearchTool } from './llm.js';
import { contextBlock, SYNTHESIS_PROMPT, SYSTEM_PROMPT } from './prompts.js';
import { recall, stamp, type Recall, type RecalledTurn } from './recall.js';
import { recheckClaims } from './recheck.js';
import { resolveTemporal, type Temporal } from './temporal.js';
import type { ChatMessage, Metrics, Source, StreamEvent } from './types.js';

// The orchestrator. Per message: resolve dates → recall from the ledger →
// either re-check old claims (fan-out) or answer with web search → store receipts.

export interface ChatInput {
  conversationId?: string;
  text: string;
  timeZone?: string;
  now?: string; // the browser's current time, ISO
  recheckMessageId?: string; // set by the "Re-check" button on an old answer
}

export type Emit = (e: StreamEvent) => void;

const MAX_SEARCHES = 4;
const HISTORY_MESSAGES = 12;
const RECHECK_INTENT =
  /\b(still (correct|true|accurate|valid|right|the case|up to date|current)|(has|have|did) (anything|any of (them|it|those)|it|they|that)\b.*\b(change|changed|moved)|changed|any (changes|updates|news)|shipped|launched|re-?check|outdated|out of date|stale|what'?s new|anything new)\b/i;

export async function chat(input: ChatInput, emit: Emit, signal: AbortSignal): Promise<void> {
  const now = input.now && !Number.isNaN(Date.parse(input.now)) ? new Date(input.now) : new Date();
  const temporal = resolveTemporal(input.text, now, input.timeZone);

  const conversationId =
    input.conversationId && conversationExists(input.conversationId)
      ? input.conversationId
      : createConversation(input.text.replace(/\s+/g, ' ').trim().slice(0, 60) || 'New chat');
  const history = getMessages(conversationId);
  const userMessage = saveMessage({ conversationId, role: 'user', content: input.text });
  emit({ type: 'start', conversationId, userMessageId: userMessage.id });

  for (const ref of temporal.refs) {
    emit({ type: 'status', kind: 'time', text: `“${ref.text}” → ${ref.label}`, done: true });
  }

  const memory = input.recheckMessageId ? forcedRecall(input.recheckMessageId) : recall(input.text, temporal);
  reportRecall(memory, emit);

  const wantsRecheck = Boolean(input.recheckMessageId) || RECHECK_INTENT.test(input.text);
  if (wantsRecheck && memory.turns.length > 0) {
    const claims = await claimsFor(memory.turns);
    if (claims.length > 0) {
      return runRecheck({ conversationId, userMessage, input, temporal, memory, claims }, emit, signal);
    }
  }
  return runAnswer({ conversationId, userMessage, input, temporal, memory, history }, emit, signal);
}

// ── recall helpers ─────────────────────────────────────────────────────────

function forcedRecall(answerId: string): Recall {
  const turn = allTurns().find((t) => t.answerId === answerId);
  const turns: RecalledTurn[] = turn ? [{ ...turn, claims: getClaims([turn.answerId]), score: 99, matchedDate: null }] : [];
  return { triggered: true, turns, window: null, nearest: [], ledgerEmpty: false };
}

function reportRecall(memory: Recall, emit: Emit): void {
  if (!memory.triggered) return;
  const text =
    memory.turns.length > 0
      ? `Recalled ${memory.turns.length} past answer${memory.turns.length > 1 ? 's' : ''}${memory.turns[0]?.matchedDate ? ` from ${memory.turns[0].matchedDate.label}` : ''}`
      : memory.ledgerEmpty
        ? 'Ledger is empty: no past conversations yet'
        : memory.window
          ? `Nothing in the ledger for ${memory.window.label}`
          : 'No matching past conversation';
  emit({ type: 'status', kind: 'recall', text, done: true });
}

/** Claims for the recalled turns. Waits for an in-flight extraction, or extracts on demand. */
async function claimsFor(turns: RecalledTurn[]): Promise<Claim[]> {
  const ids = turns.map((t) => t.answerId);
  await Promise.all(ids.map(waitForExtraction));
  let claims = getClaims(ids);
  if (claims.length === 0) {
    await Promise.all(ids.map((id) => getMessage(id)).filter((m): m is ChatMessage => m !== null).map(extractClaims));
    claims = getClaims(ids);
  }
  return claims;
}

function recallBlock(memory: Recall, temporal: Temporal): string | null {
  const { timeZone, today } = temporal;
  const lines: string[] = [];
  for (const ref of temporal.refs) {
    lines.push(`Resolved date: “${ref.text}” = ${ref.label}${ref.from !== ref.to ? '' : ` (${ref.from})`}.`);
  }
  if (memory.triggered) {
    lines.push('', `RECALLED CONTEXT (from the receipts ledger; times in ${timeZone})`);
    if (memory.ledgerEmpty) lines.push('The ledger is empty: there are no earlier conversations at all.');
    for (const [i, t] of memory.turns.entries()) {
      lines.push(
        '',
        `[${String.fromCharCode(65 + i)}] ${stamp(t.askedAt, timeZone, today)} · conversation “${t.conversationTitle}”${t.isSeed ? ' (demo seed data)' : ''}`,
        `User asked: ${t.question}`,
        `You answered: ${t.answer.length > 2000 ? `${t.answer.slice(0, 2000)}…` : t.answer}`,
      );
      if (t.sources.length) {
        lines.push(`Sources: ${t.sources.slice(0, 6).map((s) => `${s.title} <${s.url}> (retrieved ${stamp(s.retrievedAt, timeZone, today)})`).join('; ')}`);
      }
    }
    if (memory.turns.length === 0 && memory.window) {
      lines.push(`The ledger has NO conversation on ${memory.window.label}.`);
      if (memory.nearest.length) {
        lines.push('Closest entries (offer these; do not claim they are what the user meant):');
        for (const t of memory.nearest) lines.push(`- ${stamp(t.askedAt, timeZone, today)}: “${t.question}”`);
      }
    } else if (memory.turns.length === 0 && !memory.ledgerEmpty) {
      lines.push('No earlier conversation in the ledger matches this message.');
    }
  }
  return lines.length ? lines.join('\n') : null;
}

/** Stored history → API messages. Text only; merges same-role neighbours left by failed turns. */
function toApiHistory(history: ChatMessage[]): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];
  for (const m of history.slice(-HISTORY_MESSAGES)) {
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.content = `${last.content as string}\n\n${m.content}`;
    else out.push({ role: m.role, content: m.content });
  }
  while (out[0]?.role === 'assistant') out.shift();
  return out;
}

// ── answer path ────────────────────────────────────────────────────────────

interface TurnArgs {
  conversationId: string;
  userMessage: ChatMessage;
  input: ChatInput;
  temporal: Temporal;
  memory: Recall;
}

async function runAnswer(args: TurnArgs & { history: ChatMessage[] }, emit: Emit, signal: AbortSignal): Promise<void> {
  const { conversationId, userMessage, input, temporal, memory, history } = args;
  const started = Date.now();
  let firstTokenMs: number | null = null;
  let answer = '';
  let cachedTokens = 0;
  const searches: string[] = [];
  const results = new Map<string, { title: string; pageAge: string | null }>();
  const cited = new Map<string, Source>(); // url → numbered source, in citation order
  const retrievedAt = new Date().toISOString();

  const context = recallBlock(memory, temporal);
  const userContent: Anthropic.ContentBlockParam[] = [
    ...(context ? [{ type: 'text' as const, text: `<turn_context>\n${context}\n</turn_context>` }] : []),
    { type: 'text', text: input.text },
  ];
  const messages: Anthropic.MessageParam[] = [...toApiHistory(history), { role: 'user', content: userContent }];

  const write = (text: string) => {
    if (!text) return;
    if (firstTokenMs === null) firstTokenMs = Date.now() - started;
    answer += text;
    emit({ type: 'text', text });
  };
  // Models sometimes open with "Let me search for that…" before calling the tool.
  // Hold back a short opening until we know whether a search follows; drop it if so.
  let held = '';
  let holding = true;
  const out = (text: string) => {
    if (!holding) return write(text);
    held += text;
    if (held.length > 160 || held.includes('\n')) release();
  };
  const release = () => {
    holding = false;
    write(held);
    held = '';
  };
  const sourceList = (): Source[] => {
    if (cited.size) return [...cited.values()];
    return [...results.entries()].slice(0, 3).map(([url, r]) => ({ n: null, url, title: r.title, pageAge: r.pageAge, retrievedAt }));
  };

  try {
    // Server-side search can return pause_turn on long loops; continue at most twice.
    for (let round = 0; round < 3; round++) {
      const stream = anthropic().messages.stream(
        {
          model: MODEL,
          max_tokens: 4000,
          ...speedParams(MODEL),
          system: [
            { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
            { type: 'text', text: contextBlock(temporal.nowLabel, temporal.timeZone) },
          ],
          tools: [webSearchTool(MODEL, MAX_SEARCHES)],
          messages,
        },
        { signal },
      );

      const blocks = new Map<number, { type: string; json: string; cites: number[] }>();
      for await (const event of stream) {
        if (event.type === 'content_block_start') {
          const b = event.content_block;
          blocks.set(event.index, { type: b.type, json: '', cites: [] });
          if (b.type === 'server_tool_use' && holding) held = ''; // it was filler before a search
          else if (b.type === 'text' && held) release();
          if (b.type === 'web_search_tool_result') {
            if (Array.isArray(b.content)) {
              for (const r of b.content) results.set(r.url, { title: r.title, pageAge: r.page_age ?? null });
              emit({ type: 'status', kind: 'search', id: b.tool_use_id, text: `${b.content.length} results`, done: true });
            } else {
              emit({ type: 'status', kind: 'search', id: b.tool_use_id, text: `Search failed (${b.content.error_code})`, done: true });
            }
          }
        } else if (event.type === 'content_block_delta') {
          const block = blocks.get(event.index);
          const d = event.delta;
          if (d.type === 'text_delta') out(d.text);
          else if (d.type === 'input_json_delta' && block) block.json += d.partial_json;
          else if (d.type === 'citations_delta' && block && d.citation.type === 'web_search_result_location') {
            const { url, title } = d.citation;
            if (!cited.has(url)) {
              cited.set(url, { n: cited.size + 1, url, title: title ?? results.get(url)?.title ?? url, pageAge: results.get(url)?.pageAge ?? null, retrievedAt });
              emit({ type: 'sources', sources: sourceList() });
            }
            const n = cited.get(url)!.n!;
            if (!block.cites.includes(n)) block.cites.push(n);
          }
        } else if (event.type === 'content_block_stop') {
          const block = blocks.get(event.index);
          if (block?.type === 'text' && block.cites.length) out(block.cites.map((n) => `[${n}]`).join(''));
          if (block?.type === 'server_tool_use') {
            const query = parseQuery(block.json);
            if (query) {
              searches.push(query);
              emit({ type: 'status', kind: 'search', id: toolUseId(stream, event.index), text: `Searching: “${query}”` });
            }
          }
        }
      }
      const final = await stream.finalMessage();
      if (final.stop_reason !== 'pause_turn' && held) release();
      cachedTokens += final.usage.cache_read_input_tokens ?? 0;
      if (final.stop_reason !== 'pause_turn') break;
      messages.push({ role: 'assistant', content: final.content });
    }
  } catch (err) {
    if (!signal.aborted) {
      console.error('[agent] answer failed:', err instanceof Error ? err.message : err);
      emit({ type: 'error', ...friendlyError(err) });
      if (!answer) return;
    }
  }

  if (held) release();
  const sources = sourceList();
  const metrics: Metrics = {
    totalMs: Date.now() - started, firstTokenMs, searches: searches.length, sources: sources.length, model: MODEL,
    ...(cachedTokens ? { cachedTokens } : {}), ...(signal.aborted ? { stopped: true } : {}),
  };
  const saved = saveMessage({ conversationId, role: 'assistant', content: answer, replyTo: userMessage.id, searches, sources, metrics });
  // Receipts: extract claims in the background, never blocking the user.
  if (searches.length > 0 && !signal.aborted) void extractClaims(saved);
  emit({ type: 'done', message: saved });
}

function parseQuery(json: string): string | null {
  try {
    const input = JSON.parse(json) as { query?: unknown };
    return typeof input.query === 'string' ? input.query : null;
  } catch {
    return null;
  }
}

function toolUseId(stream: { currentMessage?: Anthropic.Message | undefined }, index: number): string | undefined {
  const block = stream.currentMessage?.content[index];
  return block && 'id' in block ? block.id : undefined;
}

// ── re-check path ──────────────────────────────────────────────────────────

async function runRecheck(args: TurnArgs & { claims: Claim[] }, emit: Emit, signal: AbortSignal): Promise<void> {
  const { conversationId, userMessage, input, temporal, memory, claims } = args;
  const started = Date.now();
  const entities = new Set(claims.map((c) => c.entity)).size;
  emit({ type: 'status', kind: 'recheck', id: 'recheck', text: `Re-checking ${claims.length} claims across ${entities} ${entities === 1 ? 'entity' : 'entities'} in parallel` });

  let answer = '';
  let firstTokenMs: number | null = null;
  try {
    const result = await recheckClaims(claims, temporal.today, signal, (p) => {
      const text = p.state === 'checking' ? p.entity : p.state === 'failed' ? `${p.entity}: couldn't check` : `${p.entity}${p.changed ? `: ${p.changed} changed` : ': no change'}`;
      emit({ type: 'status', kind: 'recheck', id: `rc:${p.entity}`, text, done: p.state !== 'checking' });
    });
    emit({ type: 'status', kind: 'recheck', id: 'recheck', text: `Re-checked ${entities} ${entities === 1 ? 'entity' : 'entities'} in ${(result.ms / 1000).toFixed(1)}s`, done: true });
    emit({ type: 'recheck', result });

    const turn = memory.turns[0]!;
    const table = result.rows
      .map((r) => `- ${r.entity} · ${r.attribute}: then “${r.oldValue}” (${r.oldAsOf.slice(0, 10)}) → ${r.status.toUpperCase()}${r.newValue && r.status === 'changed' ? ` now “${r.newValue}”` : ''}${r.note ? ` (${r.note})` : ''}`)
      .join('\n');
    const news = result.news.map((n) => `- ${n.entity}: ${n.text}`).join('\n') || '(none found)';
    const stream = anthropic().messages.stream(
      {
        model: MODEL,
        max_tokens: 800,
        ...speedParams(MODEL),
        system: [{ type: 'text', text: SYNTHESIS_PROMPT }, { type: 'text', text: contextBlock(temporal.nowLabel, temporal.timeZone) }],
        messages: [{
          role: 'user',
          content:
            `${recallBlock({ ...memory, turns: [turn] }, temporal)}\n\nUser now asks: ${input.text}\n\n` +
            `Re-check results:\n${table}\n\nNotable news since then:\n${news}`,
        }],
      },
      { signal },
    );
    stream.on('text', (t) => {
      if (firstTokenMs === null) firstTokenMs = Date.now() - started;
      answer += t;
      emit({ type: 'text', text: t });
    });
    await stream.finalMessage();

    const sources: Source[] = [];
    for (const row of result.rows) {
      for (const s of row.newSources) {
        if (!sources.some((x) => x.url === s.url)) sources.push({ n: null, url: s.url, title: s.title, pageAge: null, retrievedAt: new Date().toISOString() });
      }
    }
    const metrics: Metrics = { totalMs: Date.now() - started, firstTokenMs, searches: result.searches, sources: sources.length, model: MODEL };
    const saved = saveMessage({
      conversationId, role: 'assistant', content: answer, replyTo: userMessage.id, kind: 'recheck', searches: [], sources, metrics, recheck: result,
    });
    emit({ type: 'done', message: saved });
  } catch (err) {
    if (signal.aborted) {
      const saved = saveMessage({ conversationId, role: 'assistant', content: answer || '_Re-check stopped._', replyTo: userMessage.id, kind: 'recheck', metrics: { totalMs: Date.now() - started, firstTokenMs, searches: 0, sources: 0, model: MODEL, stopped: true } });
      emit({ type: 'done', message: saved });
      return;
    }
    console.error('[agent] re-check failed:', err instanceof Error ? err.message : err);
    emit({ type: 'error', ...friendlyError(err) });
  }
}
