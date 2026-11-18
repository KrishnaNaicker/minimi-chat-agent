// Types shared by the server and the web client (the web imports them type-only).

export interface Source {
  n: number | null; // citation number shown in the answer, null if found but not cited
  url: string;
  title: string;
  pageAge: string | null; // as reported by the search index, e.g. "3 days ago"
  retrievedAt: string; // ISO timestamp of when we fetched it
}

export interface Metrics {
  totalMs: number;
  firstTokenMs: number | null;
  searches: number;
  sources: number;
  model: string;
  cachedTokens?: number;
  stopped?: boolean;
}

export type RecheckStatus = 'same' | 'changed' | 'unknown';

export interface RecheckRow {
  entity: string;
  attribute: string;
  oldValue: string;
  oldAsOf: string; // ISO
  oldSource: string | null;
  status: RecheckStatus;
  newValue: string | null;
  note: string | null;
  newSources: { url: string; title: string }[];
}

export interface RecheckResult {
  since: string; // ISO of the oldest claim checked
  rows: RecheckRow[];
  news: { entity: string; text: string }[]; // notable launches since, per entity
  searches: number;
  ms: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  kind: 'answer' | 'recheck';
  searches: string[];
  sources: Source[];
  metrics: Metrics | null;
  recheck: RecheckResult | null;
  volatile: boolean; // contains prices or other fast-moving claims
  isSeed: boolean;
}

export interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: string;
  isSeed: boolean;
}

// Server-sent events streamed by POST /api/chat
export type StreamEvent =
  | { type: 'start'; conversationId: string; userMessageId: string }
  | { type: 'status'; kind: 'time' | 'recall' | 'search' | 'recheck'; text: string; done?: boolean; id?: string }
  | { type: 'text'; text: string }
  | { type: 'sources'; sources: Source[] }
  | { type: 'recheck'; result: RecheckResult }
  | { type: 'done'; message: ChatMessage }
  | { type: 'error'; message: string; code: string };
