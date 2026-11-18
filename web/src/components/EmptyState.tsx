import { dayMonth } from '../lib/time';
import { IconReceipt } from './Icons';

// The three test prompts. The exact date is computed (15 days ago, matching the
// demo seed) so the example keeps working on any day.
function examples(): string[] {
  const exact = new Date();
  exact.setDate(exact.getDate() - 15);
  return [
    'On Monday we shortlisted 5 CRM tools for a 20-person sales team. Has any of them changed pricing or shipped something big since?',
    `What did I ask you on ${dayMonth(exact.toISOString())}? Is your answer still correct today?`,
    'Last Tuesday I asked you about Postgres hosting. Has any pricing changed since then?',
  ];
}

export function EmptyState({ onPick, ledgerEmpty }: { onPick: (text: string) => void; ledgerEmpty: boolean }) {
  return (
    <div className="mx-auto flex w-full max-w-[680px] flex-1 flex-col justify-center px-6 py-10">
      <div className="rise">
        <div className="mb-4 grid h-10 w-10 place-items-center rounded-xl bg-accent-soft text-accent">
          <IconReceipt width={20} height={20} />
        </div>
        <h1 className="text-[26px] font-semibold tracking-[-0.02em]">An assistant that keeps receipts.</h1>
        <p className="mt-2 max-w-[560px] text-[15px] leading-relaxed text-ink-2">
          Every answer is stored with its date and sources. Ask what I told you last week, and I’ll check whether it’s still true.
        </p>
      </div>

      <ul className="mt-8 space-y-2">
        {examples().map((p, i) => (
          <li key={p} className="rise" style={{ animationDelay: `${80 + i * 60}ms` }}>
            <button
              onClick={() => onPick(p)}
              className="w-full rounded-xl border border-line bg-elev px-4 py-3 text-left text-[14px] leading-snug text-ink-2 transition-[border-color,color,transform] hover:border-line-strong hover:text-ink active:scale-[0.995]"
            >
              {p}
            </button>
          </li>
        ))}
      </ul>

      {ledgerEmpty && (
        <p className="mt-6 text-[12.5px] text-ink-3">
          Your ledger is empty, so these will (honestly) find nothing yet. Run <code className="rounded bg-fill-2 px-1 font-mono">npm run seed</code> for demo history.
        </p>
      )}
    </div>
  );
}
