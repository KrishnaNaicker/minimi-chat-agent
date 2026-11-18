import type { RecheckResult, RecheckRow } from '../lib/api';
import { seconds, shortDate } from '../lib/time';
import { Favicon, hostOf } from './Sources';

const STATUS = {
  changed: { icon: '⚠️', label: 'Changed', row: 'bg-warn-soft', text: 'text-warn' },
  same: { icon: '✅', label: 'Still true', row: '', text: 'text-ok' },
  unknown: { icon: '❓', label: "Couldn't verify", row: '', text: 'text-ink-3' },
} as const;

const ORDER = { changed: 0, unknown: 1, same: 2 };

/** The "Then → Now" diff: one row per stored claim, old value with its receipt vs. what the web says today. */
export function RecheckCard({ result }: { result: RecheckResult }) {
  const rows = [...result.rows].sort((a, b) => ORDER[a.status] - ORDER[b.status]);
  const count = (s: RecheckRow['status']) => result.rows.filter((r) => r.status === s).length;

  return (
    <section aria-label="Then and now" className="rise mb-4 overflow-hidden rounded-2xl border border-line bg-elev shadow-[var(--shadow)]">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div className="flex items-baseline gap-2">
          <h3 className="text-[13.5px] font-semibold tracking-[-0.01em]">Then → Now</h3>
          <span className="text-[12px] text-ink-3">
            since {shortDate(result.since)} · {result.rows.length} claims · {result.searches} searches · {seconds(result.ms)}
          </span>
        </div>
        <div className="flex gap-1.5 text-[11.5px] font-medium">
          {count('changed') > 0 && <span className="rounded-full bg-warn-soft px-2 py-0.5 text-warn">{count('changed')} changed</span>}
          {count('same') > 0 && <span className="rounded-full bg-ok-soft px-2 py-0.5 text-ok">{count('same')} still true</span>}
          {count('unknown') > 0 && <span className="rounded-full bg-muted-soft px-2 py-0.5 text-ink-2">{count('unknown')} unverified</span>}
        </div>
      </header>

      <ul className="divide-y divide-[var(--border)]">
        {rows.map((r, i) => {
          const s = STATUS[r.status];
          return (
            <li key={`${r.entity}-${r.attribute}-${i}`} className={`grid gap-x-4 gap-y-1.5 px-4 py-3 sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)] ${s.row}`}>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-[13px] font-medium">
                  <span aria-hidden>{s.icon}</span>
                  <span className="truncate">{r.entity}</span>
                </div>
                <div className="truncate pl-6 text-[12px] text-ink-3">{r.attribute}</div>
              </div>

              <div className="min-w-0 pl-6 sm:pl-0">
                <div className="text-[10.5px] font-medium tracking-wide text-ink-3 uppercase">Then · {shortDate(r.oldAsOf)}</div>
                <div className={`text-[13px] ${r.status === 'changed' ? 'text-ink-2 line-through decoration-[var(--warn)]/50' : 'text-ink'}`}>{r.oldValue}</div>
                {r.oldSource && (
                  <a href={r.oldSource} target="_blank" rel="noreferrer" className="mt-0.5 inline-flex items-center gap-1 text-[11.5px] text-ink-3 hover:text-ink">
                    <Favicon url={r.oldSource} size={12} /> {hostOf(r.oldSource)}
                  </a>
                )}
              </div>

              <div className="min-w-0 pl-6 sm:pl-0">
                <div className={`text-[10.5px] font-medium tracking-wide uppercase ${s.text}`}>Now · {s.label}</div>
                <div className="text-[13px] text-ink">
                  {r.status === 'changed' ? <strong className="font-semibold">{r.newValue}</strong> : r.status === 'same' ? r.newValue : '—'}
                </div>
                {r.note && <div className="mt-0.5 line-clamp-2 text-[11.5px] text-ink-3" title={r.note}>{r.note}</div>}
                <div className="mt-0.5 flex flex-wrap gap-x-2">
                  {r.newSources.slice(0, 2).map((src) => (
                    <a key={src.url} href={src.url} target="_blank" rel="noreferrer" title={src.title} className="inline-flex items-center gap-1 text-[11.5px] text-ink-3 hover:text-ink">
                      <Favicon url={src.url} size={12} /> {hostOf(src.url)}
                    </a>
                  ))}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {result.news.length > 0 && (
        <footer className="border-t border-line bg-fill px-4 py-3">
          <h4 className="mb-1 text-[10.5px] font-medium tracking-wide text-ink-3 uppercase">Since then</h4>
          <ul className="space-y-1 text-[12.5px] text-ink-2">
            {result.news.map((n) => (
              <li key={n.entity}>
                <span className="font-medium text-ink">{n.entity}:</span> {n.text}
              </li>
            ))}
          </ul>
        </footer>
      )}
    </section>
  );
}
