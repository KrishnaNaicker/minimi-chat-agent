import { IconKey } from './Icons';

/** Shown when the server has no ANTHROPIC_API_KEY. The app still boots; it just can't answer yet. */
export function SetupScreen({ onRetry }: { onRetry: () => void }) {
  const step = 'flex gap-3 text-[14px] leading-relaxed text-ink-2';
  const num = 'grid h-6 w-6 shrink-0 place-items-center rounded-full bg-fill-2 text-[12px] font-semibold text-ink';
  return (
    <main className="grid h-full place-items-center px-6">
      <div className="rise w-full max-w-[480px] rounded-2xl border border-line bg-elev p-7 shadow-[var(--shadow)]">
        <div className="mb-4 grid h-10 w-10 place-items-center rounded-xl bg-accent-soft text-accent">
          <IconKey width={20} height={20} />
        </div>
        <h1 className="text-[20px] font-semibold tracking-[-0.01em]">Add ANTHROPIC_API_KEY to .env</h1>
        <p className="mt-1.5 text-[14px] text-ink-2">One key runs everything: the chat model and its web search.</p>
        <ol className="mt-5 space-y-3">
          <li className={step}>
            <span className={num}>1</span>
            <span>
              Copy the template: <code className="rounded bg-fill-2 px-1.5 py-0.5 font-mono text-[12.5px]">cp .env.example .env</code>
            </span>
          </li>
          <li className={step}>
            <span className={num}>2</span>
            <span>
              Paste your key after <code className="rounded bg-fill-2 px-1.5 py-0.5 font-mono text-[12.5px]">ANTHROPIC_API_KEY=</code>
            </span>
          </li>
          <li className={step}>
            <span className={num}>3</span>
            <span>
              Restart <code className="rounded bg-fill-2 px-1.5 py-0.5 font-mono text-[12.5px]">npm run dev</code>
            </span>
          </li>
        </ol>
        <button onClick={onRetry} className="mt-6 w-full rounded-xl bg-accent py-2.5 text-[14px] font-medium text-on-accent transition-transform active:scale-[0.99]">
          Check again
        </button>
      </div>
    </main>
  );
}
