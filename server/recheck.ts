import type Anthropic from '@anthropic-ai/sdk';
import type { Claim } from './ledger.js';
import { anthropic, FAST_MODEL, webSearchTool } from './llm.js';
import { RECHECK_PROMPT } from './prompts.js';
import type { RecheckResult, RecheckRow } from './types.js';

// Re-check mode: instead of re-answering from scratch, verify each stored claim.
// One small Haiku + web_search call per entity, run in parallel (max 5 at a time),
// so checking 5 CRM tools takes about as long as checking one.

const CONCURRENCY = 5;
const MAX_ENTITIES = 8;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['rows', 'news'],
  properties: {
    rows: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['claim_id', 'status', 'new_value', 'note', 'source_urls'],
        properties: {
          claim_id: { type: 'integer' },
          status: { type: 'string', enum: ['same', 'changed', 'unknown'] },
          new_value: { type: ['string', 'null'] },
          note: { type: ['string', 'null'] },
          source_urls: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    news: { type: 'string' },
  },
} as const;

interface EntityVerdict {
  rows: { claim_id: number; status: RecheckRow['status']; new_value: string | null; note: string | null; source_urls: string[] }[];
  news: string;
}

export interface RecheckProgress {
  entity: string;
  state: 'checking' | 'done' | 'failed';
  changed?: number;
}

/** Run `fn` over `items` with at most `limit` in flight. Never rejects: failures come back as Error. */
async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<(R | Error)[]> {
  const out: (R | Error)[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      try {
        out[i] = await fn(items[i]!);
      } catch (err) {
        out[i] = err instanceof Error ? err : new Error(String(err));
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

async function checkEntity(entity: string, claims: Claim[], today: string, signal: AbortSignal) {
  const since = claims.reduce((min, c) => (c.asOf < min ? c.asOf : min), claims[0]!.asOf).slice(0, 10);
  const list = claims.map((c) => `- claim_id ${c.id}: ${c.attribute} = ${c.value} (as of ${c.asOf.slice(0, 10)})`).join('\n');
  const params: Anthropic.MessageCreateParamsNonStreaming = {
    model: FAST_MODEL,
    max_tokens: 2000,
    thinking: { type: 'disabled' },
    system: RECHECK_PROMPT,
    tools: [webSearchTool(FAST_MODEL, 2)],
    output_config: { format: { type: 'json_schema', schema: SCHEMA } } as Anthropic.OutputConfig,
    messages: [{ role: 'user', content: `Today is ${today}. Entity: ${entity}\nClaims recorded on or after ${since}:\n${list}` }],
  };

  // Server-side search loops can pause; resume a couple of times at most.
  let res = await anthropic().messages.create(params, { signal });
  for (let i = 0; i < 2 && res.stop_reason === 'pause_turn'; i++) {
    params.messages = [...params.messages, { role: 'assistant', content: res.content }];
    res = await anthropic().messages.create(params, { signal });
  }

  // Sources come from the search results themselves, never from model-typed URLs.
  const found = new Map<string, string>();
  for (const block of res.content) {
    if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
      for (const r of block.content) found.set(r.url, r.title);
    }
  }
  const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('');
  const verdict = JSON.parse(text) as EntityVerdict;
  return { verdict, found, searches: res.usage.server_tool_use?.web_search_requests ?? 0 };
}

export async function recheckClaims(
  claims: Claim[],
  today: string,
  signal: AbortSignal,
  onProgress: (p: RecheckProgress) => void,
): Promise<RecheckResult> {
  const started = Date.now();
  const byEntity = new Map<string, Claim[]>();
  for (const c of claims) byEntity.set(c.entity, [...(byEntity.get(c.entity) ?? []), c]);
  const entities = [...byEntity.entries()].slice(0, MAX_ENTITIES);

  const results = await pool(entities, CONCURRENCY, async ([entity, entityClaims]) => {
    onProgress({ entity, state: 'checking' });
    try {
      const r = await checkEntity(entity, entityClaims, today, signal);
      onProgress({ entity, state: 'done', changed: r.verdict.rows.filter((x) => x.status === 'changed').length });
      return r;
    } catch (err) {
      onProgress({ entity, state: 'failed' });
      throw err;
    }
  });
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

  const rows: RecheckRow[] = [];
  const news: RecheckResult['news'] = [];
  entities.forEach(([entity, entityClaims], i) => {
    const r = results[i];
    const ok = r && !(r instanceof Error) ? r : null;
    if (r instanceof Error) console.warn(`[recheck] ${entity} failed:`, r.message);
    if (ok?.verdict.news.trim()) news.push({ entity, text: ok.verdict.news.trim() });
    for (const c of entityClaims) {
      const v = ok?.verdict.rows.find((x) => x.claim_id === c.id);
      const cited = (v?.source_urls ?? []).filter((u) => ok?.found.has(u));
      const fallback = ok ? [...ok.found.keys()].slice(0, 2) : [];
      rows.push({
        entity,
        attribute: c.attribute,
        oldValue: c.value,
        oldAsOf: c.asOf,
        oldSource: c.sourceUrl,
        status: v?.status ?? 'unknown',
        newValue: v?.status === 'changed' ? v.new_value : v?.status === 'same' ? c.value : null,
        note: v?.note ?? (r instanceof Error ? 'Check failed' : null),
        newSources: (cited.length ? cited : fallback).map((url) => ({ url, title: ok?.found.get(url) ?? url })),
      });
    }
  });

  const since = claims.reduce((min, c) => (c.asOf < min ? c.asOf : min), claims[0]?.asOf ?? new Date().toISOString());
  const searches = results.reduce((n, r) => n + (r instanceof Error ? 0 : r.searches), 0);
  return { since, rows, news, searches, ms: Date.now() - started };
}
