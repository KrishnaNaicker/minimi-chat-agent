import type { ConversationSummary } from '../lib/api';
import { dateGroup } from '../lib/time';
import { IconCompose, IconTrash } from './Icons';

interface Props {
  conversations: ConversationSummary[];
  activeId: string | null;
  model: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}

export function Sidebar({ conversations, activeId, model, onSelect, onNew, onDelete }: Props) {
  const groups = new Map<string, ConversationSummary[]>();
  for (const c of conversations) {
    const g = dateGroup(c.updatedAt);
    groups.set(g, [...(groups.get(g) ?? []), c]);
  }

  return (
    <nav aria-label="Conversations" className="glass flex h-full w-[264px] flex-col border-r border-line">
      <div className="flex items-center justify-between px-4 pt-4 pb-3">
        <div className="flex items-center gap-2">
          <img src="/favicon.svg" alt="" className="h-6 w-6 rounded-[7px]" />
          <span className="text-[15px] font-semibold tracking-[-0.01em]">minimi</span>
        </div>
        <button
          onClick={onNew}
          title="New chat (⌘K)"
          aria-label="New chat"
          className="rounded-lg p-1.5 text-ink-2 transition-colors hover:bg-fill-2 hover:text-ink"
        >
          <IconCompose />
        </button>
      </div>

      <div className="scroll-thin flex-1 overflow-y-auto px-2 pb-4">
        {conversations.length === 0 && (
          <p className="px-3 py-6 text-[12.5px] leading-relaxed text-ink-3">
            No conversations yet. Everything you ask is kept here as a dated receipt.
          </p>
        )}
        {[...groups.entries()].map(([group, items]) => (
          <section key={group} className="mt-3 first:mt-1">
            <h2 className="px-3 pb-1 text-[11px] font-medium tracking-wide text-ink-3">{group}</h2>
            <ul>
              {items.map((c) => (
                <li key={c.id} className="group relative">
                  <button
                    onClick={() => onSelect(c.id)}
                    aria-current={c.id === activeId ? 'page' : undefined}
                    className={`flex w-full items-center gap-2 rounded-lg px-3 py-[7px] pr-8 text-left text-[13px] transition-colors ${
                      c.id === activeId ? 'bg-fill-2 text-ink' : 'text-ink-2 hover:bg-fill hover:text-ink'
                    }`}
                  >
                    <span className="truncate">{c.title}</span>
                    {c.isSeed && (
                      <span className="shrink-0 rounded px-1 text-[9.5px] font-medium tracking-wide text-ink-3 ring-1 ring-line-strong">
                        DEMO
                      </span>
                    )}
                  </button>
                  <button
                    onClick={() => onDelete(c.id)}
                    aria-label={`Delete “${c.title}”`}
                    className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded-md p-1 text-ink-3 opacity-0 transition-opacity group-hover:opacity-100 hover:text-ink focus-visible:opacity-100"
                  >
                    <IconTrash width={14} height={14} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <div className="border-t border-line px-4 py-3 text-[11.5px] text-ink-3">
        <span className="font-mono">{model}</span> · web search
      </div>
    </nav>
  );
}
