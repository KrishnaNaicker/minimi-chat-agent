import { randomUUID } from 'node:crypto';
import type Anthropic from '@anthropic-ai/sdk';
import { db } from './db.js';
import { anthropic, FAST_MODEL } from './llm.js';
import { CLAIMS_PROMPT } from './prompts.js';
import type { ChatMessage, ConversationSummary, Metrics, RecheckResult, Source } from './types.js';

// The receipts ledger: every answer is stored with its timestamp, searches,
// sources and metrics, and its key claims are extracted for later re-checks.

export interface Claim {
  id: number;
  messageId: string;
  entity: string;
  attribute: string;
  value: string;
  asOf: string;
  sourceUrl: string | null;
  volatile: boolean;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
  reply_to: string | null;
  kind: 'answer' | 'recheck';
  searches: string;
  sources: string;
  metrics: string | null;
  recheck: string | null;
  is_seed: number;
  volatile: number | null;
}

const MESSAGE_COLUMNS = `m.*, (SELECT MAX(volatile) FROM claims c WHERE c.message_id = m.id) AS volatile`;

function toMessage(r: MessageRow): ChatMessage {
  return {
    id: r.id,
    role: r.role,
    content: r.content,
    createdAt: r.created_at,
    kind: r.kind,
    searches: JSON.parse(r.searches) as string[],
    sources: JSON.parse(r.sources) as Source[],
    metrics: r.metrics ? (JSON.parse(r.metrics) as Metrics) : null,
    recheck: r.recheck ? (JSON.parse(r.recheck) as RecheckResult) : null,
    volatile: Boolean(r.volatile) || /[$€£]\s?\d/.test(r.content),
    isSeed: Boolean(r.is_seed),
  };
}

// ── conversations ──────────────────────────────────────────────────────────

export function createConversation(title: string, at = new Date().toISOString(), isSeed = false): string {
  const id = randomUUID();
  db.prepare('INSERT INTO conversations (id, title, created_at, updated_at, is_seed) VALUES (?, ?, ?, ?, ?)').run(
    id, title.slice(0, 80), at, at, isSeed ? 1 : 0,
  );
  return id;
}

export function conversationExists(id: string): boolean {
  return Boolean(db.prepare('SELECT 1 FROM conversations WHERE id = ?').get(id));
}

export function listConversations(): ConversationSummary[] {
  const rows = db.prepare('SELECT id, title, updated_at, is_seed FROM conversations ORDER BY updated_at DESC LIMIT 200').all() as {
    id: string; title: string; updated_at: string; is_seed: number;
  }[];
  return rows.map((r) => ({ id: r.id, title: r.title, updatedAt: r.updated_at, isSeed: Boolean(r.is_seed) }));
}

export function deleteConversation(id: string): void {
  db.prepare('DELETE FROM conversations WHERE id = ?').run(id);
}

// ── messages ───────────────────────────────────────────────────────────────

export interface NewMessage {
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt?: string;
  replyTo?: string | null;
  kind?: 'answer' | 'recheck';
  searches?: string[];
  sources?: Source[];
  metrics?: Metrics | null;
  recheck?: RecheckResult | null;
  isSeed?: boolean;
}

export function saveMessage(m: NewMessage): ChatMessage {
  const id = randomUUID();
  const createdAt = m.createdAt ?? new Date().toISOString();
  db.prepare(
    `INSERT INTO messages (id, conversation_id, role, content, created_at, reply_to, kind, searches, sources, metrics, recheck, is_seed)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id, m.conversationId, m.role, m.content, createdAt, m.replyTo ?? null, m.kind ?? 'answer',
    JSON.stringify(m.searches ?? []), JSON.stringify(m.sources ?? []),
    m.metrics ? JSON.stringify(m.metrics) : null, m.recheck ? JSON.stringify(m.recheck) : null, m.isSeed ? 1 : 0,
  );
  db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ? AND updated_at < ?').run(createdAt, m.conversationId, createdAt);
  return getMessage(id)!;
}

export function getMessage(id: string): ChatMessage | null {
  const row = db.prepare(`SELECT ${MESSAGE_COLUMNS} FROM messages m WHERE m.id = ?`).get(id) as MessageRow | undefined;
  return row ? toMessage(row) : null;
}

export function getMessages(conversationId: string): ChatMessage[] {
  const rows = db.prepare(`SELECT ${MESSAGE_COLUMNS} FROM messages m WHERE m.conversation_id = ? ORDER BY m.created_at`).all(conversationId) as MessageRow[];
  return rows.map(toMessage);
}

/** A past question/answer pair, the unit of recall. */
export interface Turn {
  answerId: string;
  conversationId: string;
  conversationTitle: string;
  askedAt: string;
  question: string;
  answer: string;
  kind: 'answer' | 'recheck';
  sources: Source[];
  isSeed: boolean;
}

/** All past question/answer turns, newest first. A full scan is fine at personal scale. */
export function allTurns(): Turn[] {
  const rows = db.prepare(
    `SELECT a.id, a.conversation_id, c.title, a.created_at, q.content AS question, a.content AS answer, a.kind, a.sources, a.is_seed
       FROM messages a
       JOIN messages q ON q.id = a.reply_to
       JOIN conversations c ON c.id = a.conversation_id
      WHERE a.role = 'assistant'
      ORDER BY a.created_at DESC`,
  ).all() as {
    id: string; conversation_id: string; title: string; created_at: string; question: string; answer: string;
    kind: 'answer' | 'recheck'; sources: string; is_seed: number;
  }[];
  return rows.map((r) => ({
    answerId: r.id,
    conversationId: r.conversation_id,
    conversationTitle: r.title,
    askedAt: r.created_at,
    question: r.question,
    answer: r.answer,
    kind: r.kind,
    sources: JSON.parse(r.sources) as Source[],
    isSeed: Boolean(r.is_seed),
  }));
}

// ── claims ─────────────────────────────────────────────────────────────────

export function getClaims(messageIds: string[]): Claim[] {
  if (messageIds.length === 0) return [];
  const rows = db.prepare(
    `SELECT * FROM claims WHERE message_id IN (${messageIds.map(() => '?').join(',')}) ORDER BY id`,
  ).all(...messageIds) as { id: number; message_id: string; entity: string; attribute: string; value: string; as_of: string; source_url: string | null; volatile: number }[];
  return rows.map((r) => ({
    id: r.id, messageId: r.message_id, entity: r.entity, attribute: r.attribute, value: r.value,
    asOf: r.as_of, sourceUrl: r.source_url, volatile: Boolean(r.volatile),
  }));
}

export function insertClaims(messageId: string, claims: Omit<Claim, 'id' | 'messageId'>[]): void {
  const insert = db.prepare(
    'INSERT INTO claims (message_id, entity, attribute, value, as_of, source_url, volatile) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  db.transaction(() => {
    for (const c of claims) insert.run(messageId, c.entity, c.attribute, c.value, c.asOf, c.sourceUrl, c.volatile ? 1 : 0);
  })();
}

const CLAIMS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['claims'],
  properties: {
    claims: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['entity', 'attribute', 'value', 'source_url', 'volatile'],
        properties: {
          entity: { type: 'string' },
          attribute: { type: 'string' },
          value: { type: 'string' },
          source_url: { type: ['string', 'null'] },
          volatile: { type: 'boolean' },
        },
      },
    },
  },
} as const;

// Extractions in flight, so a re-check that arrives right after an answer can wait for them.
const pending = new Map<string, Promise<void>>();

export function waitForExtraction(messageId: string): Promise<void> {
  return pending.get(messageId) ?? Promise.resolve();
}

/** Pull the key factual claims out of an answer (one small Haiku call). Runs after the answer streamed. */
export function extractClaims(message: ChatMessage): Promise<void> {
  const job = (async () => {
    const res = await anthropic().messages.create({
      model: FAST_MODEL,
      max_tokens: 2000,
      thinking: { type: 'disabled' },
      system: CLAIMS_PROMPT,
      output_config: { format: { type: 'json_schema', schema: CLAIMS_SCHEMA } } as Anthropic.OutputConfig,
      messages: [{
        role: 'user',
        content: `Answer given on ${message.createdAt}:\n\n${message.content}\n\nSources:\n${message.sources.map((s) => `[${s.n ?? '-'}] ${s.url}`).join('\n')}`,
      }],
    });
    const text = res.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text ?? '{"claims":[]}';
    const parsed = JSON.parse(text) as { claims: { entity: string; attribute: string; value: string; source_url: string | null; volatile: boolean }[] };
    const known = new Set(message.sources.map((s) => s.url));
    insertClaims(message.id, parsed.claims.slice(0, 30).map((c) => ({
      entity: c.entity.trim(),
      attribute: c.attribute.trim(),
      value: c.value.trim(),
      asOf: message.createdAt,
      // Only keep URLs we actually retrieved; never trust a model-typed URL.
      sourceUrl: c.source_url && known.has(c.source_url) ? c.source_url : null,
      volatile: c.volatile,
    })));
  })()
    .catch((err: unknown) => console.warn('[ledger] claim extraction failed:', err instanceof Error ? err.message : err))
    .finally(() => pending.delete(message.id));
  pending.set(message.id, job);
  return job;
}
