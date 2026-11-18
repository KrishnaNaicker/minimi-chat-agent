import { memo, useRef, useState, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ChatMessage, Source } from '../lib/api';
import { ageLabel, isOlderThan, seconds, shortDate } from '../lib/time';
import { IconAlert, IconCheck, IconCopy, IconRefresh } from './Icons';
import { RecheckCard } from './RecheckCard';
import { SourceChips } from './Sources';
import { StatusChips, type StatusItem } from './StatusChips';

export interface UiMessage extends ChatMessage {
  pending?: boolean;
  statuses?: StatusItem[];
  error?: string;
}

// "[3]" in the answer text → a link the markdown renderer turns into a citation chip.
function linkCitations(text: string, sources: Source[]): string {
  return text.replace(/\[(\d{1,2})\](?![(:])/g, (m, n: string) => (sources.some((s) => s.n === Number(n)) ? `[${n}](#cite-${n})` : m));
}

function CodeBlock({ children }: { children?: ReactNode }) {
  const ref = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  return (
    <div className="group relative">
      <pre ref={ref}>{children}</pre>
      <button
        onClick={() => {
          void navigator.clipboard.writeText(ref.current?.innerText ?? '');
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }}
        aria-label="Copy code"
        className="absolute top-2 right-2 rounded-md bg-elev p-1 text-ink-3 opacity-0 ring-1 ring-line transition-opacity group-hover:opacity-100 hover:text-ink focus-visible:opacity-100"
      >
        {copied ? <IconCheck width={14} height={14} /> : <IconCopy width={14} height={14} />}
      </button>
    </div>
  );
}

const Markdown = memo(function Markdown({ text, sources }: { text: string; sources: Source[] }) {
  const components: Components = {
    a: ({ href, children }) => {
      if (href?.startsWith('#cite-')) {
        const s = sources.find((x) => x.n === Number(href.slice(6)));
        if (s) {
          return (
            <a className="cite" href={s.url} target="_blank" rel="noreferrer" title={s.title}>
              {s.n}
            </a>
          );
        }
      }
      return (
        <a href={href} target="_blank" rel="noreferrer">
          {children}
        </a>
      );
    },
    pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
  };
  return (
    <div className="prose-answer">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {linkCitations(text, sources)}
      </ReactMarkdown>
    </div>
  );
});

interface Props {
  message: UiMessage;
  onRecheck: (m: UiMessage) => void;
  busy: boolean;
}

export function MessageView({ message: m, onRecheck, busy }: Props) {
  const [copied, setCopied] = useState(false);
  const age = ageLabel(m.createdAt);

  if (m.role === 'user') {
    return (
      <div className="rise flex flex-col items-end">
        {age && <span className="mb-1 text-[11px] text-ink-3">asked {age} · {shortDate(m.createdAt)}</span>}
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-fill-2 px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap">
          {m.content}
        </div>
      </div>
    );
  }

  const stale = m.kind === 'answer' && m.volatile && isOlderThan(m.createdAt, 24);
  const canRecheck = !m.pending && m.kind === 'answer' && (m.volatile || m.sources.length > 0);
  const metrics = m.metrics;

  return (
    <article className="rise" aria-busy={m.pending}>
      {(age || m.isSeed) && (
        <div className="mb-2 flex items-center gap-2 text-[11.5px] text-ink-3">
          {age && <span>answered {age} · {shortDate(m.createdAt)}</span>}
          {m.isSeed && <span className="rounded px-1 text-[10px] font-medium tracking-wide ring-1 ring-line-strong">DEMO SEED</span>}
        </div>
      )}

      <StatusChips items={m.statuses ?? []} />
      {m.recheck && <RecheckCard result={m.recheck} />}

      {m.content ? (
        <Markdown text={m.content} sources={m.sources} />
      ) : (
        m.pending && (
          <div className="flex h-6 items-center gap-1" aria-label="Working">
            {[0, 1, 2].map((i) => (
              <span key={i} className="pulse-dot h-1.5 w-1.5 rounded-full bg-ink-3" style={{ animationDelay: `${i * 150}ms` }} />
            ))}
          </div>
        )
      )}

      {m.error && (
        <div role="alert" className="mt-3 flex items-start gap-2 rounded-xl bg-warn-soft px-3 py-2.5 text-[13px] text-warn">
          <IconAlert className="mt-0.5 shrink-0" />
          <span>{m.error}</span>
        </div>
      )}

      {m.kind === 'answer' && <SourceChips sources={m.sources} />}

      {!m.pending && (m.metrics || m.isSeed) && (
        <footer className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-ink-3">
          {metrics && (
            <span className="tabular-nums" title={`Model: ${metrics.model}${metrics.cachedTokens ? ` · ${metrics.cachedTokens} cached prompt tokens` : ''}`}>
              {seconds(metrics.totalMs)}
              {metrics.firstTokenMs !== null && ` · first token ${seconds(metrics.firstTokenMs)}`}
              {` · ${metrics.searches} ${metrics.searches === 1 ? 'search' : 'searches'}`}
              {` · ${metrics.sources} ${metrics.sources === 1 ? 'source' : 'sources'}`}
              {metrics.stopped && ' · stopped'}
            </span>
          )}
          <button
            onClick={() => {
              void navigator.clipboard.writeText(m.content);
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            }}
            className="inline-flex items-center gap-1 rounded-md px-1 py-0.5 hover:bg-fill hover:text-ink"
          >
            {copied ? <IconCheck width={13} height={13} /> : <IconCopy width={13} height={13} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
          {canRecheck && (
            <button
              onClick={() => onRecheck(m)}
              disabled={busy}
              className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 transition-colors disabled:opacity-40 ${
                stale ? 'bg-warn-soft text-warn hover:brightness-95' : 'hover:bg-fill hover:text-ink'
              }`}
            >
              <IconRefresh width={13} height={13} />
              {stale ? 'May be stale · Re-check' : 'Re-check'}
            </button>
          )}
        </footer>
      )}
    </article>
  );
}
