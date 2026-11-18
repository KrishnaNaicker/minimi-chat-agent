import './env.js';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { chat, type ChatInput } from './agent.js';
import { deleteConversation, getMessages, listConversations } from './ledger.js';
import { friendlyError, hasKey, MODEL } from './llm.js';

const app = new Hono();

app.onError((err, c) => {
  console.error('[server]', err.message);
  return c.json({ error: 'Internal error' }, 500);
});

// The UI uses this to decide between the chat and the "add your key" screen.
// Only a boolean ever leaves the server; the key itself never does.
app.get('/api/health', (c) => c.json({ hasKey: hasKey(), model: MODEL }));

app.get('/api/conversations', (c) => c.json(listConversations()));
app.get('/api/conversations/:id', (c) => c.json(getMessages(c.req.param('id'))));
app.delete('/api/conversations/:id', (c) => {
  deleteConversation(c.req.param('id'));
  return c.body(null, 204);
});

app.post('/api/chat', async (c) => {
  if (!hasKey()) return c.json({ error: 'Add ANTHROPIC_API_KEY to .env and restart the server.', code: 'no_key' }, 503);
  const body = await c.req.json<Partial<ChatInput>>().catch(() => ({}) as Partial<ChatInput>);
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text || text.length > 8000) return c.json({ error: 'Message must be 1–8000 characters.' }, 400);

  return streamSSE(c, async (stream) => {
    const abort = new AbortController();
    stream.onAbort(() => abort.abort()); // "Stop generating" or a closed tab
    const emit: Parameters<typeof chat>[1] = (event) => {
      if (!abort.signal.aborted) void stream.writeSSE({ data: JSON.stringify(event) });
    };
    try {
      await chat(
        {
          text,
          conversationId: body.conversationId,
          timeZone: body.timeZone,
          now: body.now,
          recheckMessageId: body.recheckMessageId,
        },
        emit,
        abort.signal,
      );
    } catch (err) {
      console.error('[chat]', err instanceof Error ? err.message : err);
      emit({ type: 'error', ...friendlyError(err) });
    }
  });
});

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, () => {
  console.log(`minimi API on http://localhost:${port}  (model: ${MODEL}, key: ${hasKey() ? 'present' : 'MISSING'})`);
});
