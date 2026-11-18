import type { Source } from '../lib/api';

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function Favicon({ url, size = 14 }: { url: string; size?: number }) {
  const host = hostOf(url);
  return (
    <img
      src={`https://icons.duckduckgo.com/ip3/${host}.ico`}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      className="shrink-0 rounded-[3px]"
      onError={(e) => {
        e.currentTarget.style.visibility = 'hidden';
      }}
    />
  );
}

/** Source chips under an answer: favicon, domain, citation number, and age when known. */
export function SourceChips({ sources }: { sources: Source[] }) {
  if (sources.length === 0) return null;
  return (
    <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Sources">
      {sources.map((s) => (
        <li key={s.url}>
          <a
            href={s.url}
            target="_blank"
            rel="noreferrer"
            title={`${s.title}${s.pageAge ? ` · page updated ${s.pageAge}` : ''}`}
            className="flex max-w-[240px] items-center gap-1.5 rounded-full bg-fill py-1 pr-2.5 pl-1.5 text-[12px] text-ink-2 ring-1 ring-line transition-colors hover:bg-fill-2 hover:text-ink"
          >
            {s.n !== null && <span className="text-[10.5px] font-semibold text-accent">{s.n}</span>}
            <Favicon url={s.url} />
            <span className="truncate">{hostOf(s.url)}</span>
            {s.pageAge && <span className="shrink-0 text-ink-3">· {s.pageAge}</span>}
          </a>
        </li>
      ))}
    </ul>
  );
}
