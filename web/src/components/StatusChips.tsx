import type { StreamEvent } from '../lib/api';
import { IconClock, IconReceipt, IconRefresh, IconSearch } from './Icons';

export type StatusItem = Extract<StreamEvent, { type: 'status' }> & { key: string };

const ICONS = { time: IconClock, recall: IconReceipt, search: IconSearch, recheck: IconRefresh };

/** Live "what I'm doing" chips: resolved dates, ledger recall, each search, each re-check. */
export function StatusChips({ items }: { items: StatusItem[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="mb-3 flex flex-wrap gap-1.5" aria-live="polite" aria-label="Progress">
      {items.map((s) => {
        const Icon = ICONS[s.kind];
        return (
          <li
            key={s.key}
            className={`rise flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] ${
              s.done ? 'bg-fill text-ink-2' : 'bg-accent-soft text-accent'
            }`}
          >
            {s.done ? <Icon width={13} height={13} /> : <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-current" />}
            <span className="truncate">{s.text}</span>
          </li>
        );
      })}
    </ul>
  );
}
