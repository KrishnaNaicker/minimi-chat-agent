import { useCallback, useEffect, useRef, useState } from 'react';
import { Composer } from './components/Composer';
import { EmptyState } from './components/EmptyState';
import { IconSidebar } from './components/Icons';
import { MessageView, type UiMessage } from './components/MessageView';
import { SetupScreen } from './components/SetupScreen';
import { Sidebar } from './components/Sidebar';
import * as api from './lib/api';
import { shortDate } from './lib/time';

export default function App() {
  const [health, setHealth] = useState<api.Health | null>(null);
  const [conversations, setConversations] = useState<api.ConversationSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  const checkHealth = useCallback(() => {
    api.getHealth().then(setHealth).catch(() => setHealth({ hasKey: false, model: '' }));
  }, []);
  const refreshList = useCallback(() => {
    api.listConversations().then(setConversations).catch(() => {});
  }, []);

  useEffect(() => {
    checkHealth();
    refreshList();
  }, [checkHealth, refreshList]);

  const scrollToBottom = (smooth = false) => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  };
  useEffect(() => {
    if (stickToBottom.current) scrollToBottom();
  }, [messages]);

  const openConversation = useCallback(async (id: string) => {
    abortRef.current?.abort();
    setActiveId(id);
    setSidebarOpen(false);
    stickToBottom.current = true;
    setMessages(await api.getConversation(id));
  }, []);

  const newChat = useCallback(() => {
    abortRef.current?.abort();
    setActiveId(null);
    setMessages([]);
    setSidebarOpen(false);
  }, []);

  const stop = useCallback(() => abortRef.current?.abort(), []);

  const send = useCallback(
    async (text: string, recheckMessageId?: string) => {
      const controller = new AbortController();
      abortRef.current = controller;
      setBusy(true);
      stickToBottom.current = true;

      const now = new Date().toISOString();
      const pendingId = `pending-${now}`;
      const blank = { createdAt: now, kind: 'answer' as const, searches: [], sources: [], metrics: null, recheck: null, volatile: false, isSeed: false };
      setMessages((ms) => [
        ...ms,
        { ...blank, id: `user-${now}`, role: 'user', content: text },
        { ...blank, id: pendingId, role: 'assistant', content: '', pending: true, statuses: [] },
      ]);
      const patch = (fn: (m: UiMessage) => UiMessage) => setMessages((ms) => ms.map((m) => (m.id === pendingId ? fn(m) : m)));

      // Batch text deltas into one render per frame so streaming stays smooth.
      let buffered = '';
      let frame = 0;
      const flush = () => {
        frame = 0;
        const chunk = buffered;
        buffered = '';
        if (chunk) patch((m) => ({ ...m, content: m.content + chunk }));
      };

      let statusKey = 0;
      try {
        await api.sendMessage({
          conversationId: activeId,
          text,
          recheckMessageId,
          signal: controller.signal,
          onEvent: (e) => {
            switch (e.type) {
              case 'start':
                setActiveId(e.conversationId);
                break;
              case 'status':
                patch((m) => {
                  const items = m.statuses ?? [];
                  const i = e.id ? items.findIndex((s) => s.id === e.id) : -1;
                  if (i >= 0) return { ...m, statuses: items.map((s, j) => (j === i ? { ...e, key: s.key } : s)) };
                  return { ...m, statuses: [...items, { ...e, key: `s${statusKey++}` }] };
                });
                break;
              case 'text':
                buffered += e.text;
                frame ||= requestAnimationFrame(flush);
                break;
              case 'sources':
                patch((m) => ({ ...m, sources: e.sources }));
                break;
              case 'recheck':
                patch((m) => ({ ...m, recheck: e.result, kind: 'recheck' }));
                break;
              case 'done':
                cancelAnimationFrame(frame);
                buffered = '';
                patch((m) => ({ ...e.message, statuses: m.statuses?.map((s) => ({ ...s, done: true })) }));
                break;
              case 'error':
                flush();
                patch((m) => ({ ...m, pending: false, error: e.message }));
                break;
            }
          },
        });
      } catch (err) {
        flush();
        const aborted = controller.signal.aborted;
        patch((m) => ({
          ...m,
          pending: false,
          statuses: m.statuses?.map((s) => ({ ...s, done: true })),
          error: aborted ? undefined : 'Lost connection to the server. Is `npm run dev` still running?',
          metrics: aborted ? { totalMs: 0, firstTokenMs: null, searches: 0, sources: 0, model: '', stopped: true } : m.metrics,
        }));
        if (!aborted) console.error(err);
      } finally {
        flush();
        patch((m) => ({ ...m, pending: false }));
        if (abortRef.current === controller) abortRef.current = null;
        setBusy(false);
        refreshList();
      }
    },
    [activeId, refreshList],
  );

  const recheck = useCallback(
    (m: UiMessage) => void send(`Re-check my answer from ${shortDate(m.createdAt)}: is it still correct?`, m.id),
    [send],
  );

  const remove = useCallback(
    async (id: string) => {
      const c = conversations.find((x) => x.id === id);
      if (!window.confirm(`Delete “${c?.title ?? 'this conversation'}” and its receipts?`)) return;
      await api.deleteConversation(id);
      if (id === activeId) newChat();
      refreshList();
    },
    [conversations, activeId, newChat, refreshList],
  );

  // ⌘K / Ctrl+K: new chat. Esc: stop generating.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        newChat();
      } else if (e.key === 'Escape' && abortRef.current) {
        stop();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [newChat, stop]);

  if (!health) return null;
  if (!health.hasKey) return <SetupScreen onRetry={checkHealth} />;

  const title = conversations.find((c) => c.id === activeId)?.title;

  return (
    <div className="flex h-full">
      {/* Sidebar: fixed on desktop, a drawer on small screens */}
      <div
        className={`fixed inset-y-0 left-0 z-30 transition-transform duration-200 md:static md:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <Sidebar
          conversations={conversations}
          activeId={activeId}
          model={health.model}
          onSelect={(id) => void openConversation(id)}
          onNew={newChat}
          onDelete={(id) => void remove(id)}
        />
      </div>
      {sidebarOpen && <div className="fixed inset-0 z-20 bg-black/20 md:hidden" onClick={() => setSidebarOpen(false)} aria-hidden />}

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-4">
          <button onClick={() => setSidebarOpen(true)} aria-label="Show conversations" className="rounded-lg p-1.5 text-ink-2 hover:bg-fill md:hidden">
            <IconSidebar />
          </button>
          <h1 className="truncate text-[13px] font-medium text-ink-2">{title ?? 'New chat'}</h1>
        </header>

        <div
          ref={scrollRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          }}
          className="scroll-thin flex flex-1 flex-col overflow-y-auto"
        >
          {messages.length === 0 ? (
            <EmptyState onPick={(t) => void send(t)} ledgerEmpty={conversations.length === 0} />
          ) : (
            <div className="mx-auto w-full max-w-[760px] space-y-7 px-4 pt-8 pb-10 sm:px-6">
              {messages.map((m) => (
                <MessageView key={m.id} message={m} onRecheck={recheck} busy={busy} />
              ))}
            </div>
          )}
        </div>

        <Composer busy={busy} onSend={(t) => void send(t)} onStop={stop} focusKey={activeId ?? 'new'} />
      </main>
    </div>
  );
}
