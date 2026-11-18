import type { ChatMessage, ConversationSummary, StreamEvent } from '../../../server/types';

export type { ChatMessage, ConversationSummary, StreamEvent };
export type { RecheckResult, RecheckRow, Source, Metrics } from '../../../server/types';

export interface Health {
  hasKey: boolean;
  model: string;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return (await res.json()) as T;
}

export const getHealth = () => fetch('/api/health').then((r) => json<Health>(r));
export const listConversations = () => fetch('/api/conversations').then((r) => json<ConversationSummary[]>(r));
export const getConversation = (id: string) => fetch(`/api/conversations/${id}`).then((r) => json<ChatMessage[]>(r));
export const deleteConversation = (id: string) => fetch(`/api/conversations/${id}`, { method: 'DELETE' });

export interface SendOptions {
  conversationId: string | null;
  text: string;
  recheckMessageId?: string;
  signal: AbortSignal;
  onEvent: (e: StreamEvent) => void;
}

/** POST a message and read the SSE stream. Time zone and local time travel with every message. */
export async function sendMessage(o: SendOptions): Promise<void> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal: o.signal,
    body: JSON.stringify({
      conversationId: o.conversationId,
      text: o.text,
      recheckMessageId: o.recheckMessageId,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      now: new Date().toISOString(),
    }),
  });
  if (!res.ok || !res.body) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    o.onEvent({ type: 'error', message: body.error ?? `Request failed (${res.status})`, code: body.code ?? 'http' });
    return;
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let split: number;
    while ((split = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);
      const data = frame
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trimStart())
        .join('\n');
      if (data) o.onEvent(JSON.parse(data) as StreamEvent);
    }
  }
}
