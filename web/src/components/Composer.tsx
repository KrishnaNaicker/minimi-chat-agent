import { useEffect, useRef, useState } from 'react';
import { IconArrowUp, IconStop } from './Icons';

interface Props {
  busy: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  focusKey: string; // refocus when the conversation changes
}

export function Composer({ busy, onSend, onStop, focusKey }: Props) {
  const [text, setText] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => ref.current?.focus(), [focusKey]);

  // Grow with the content, up to ~8 lines.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  const submit = () => {
    const t = text.trim();
    if (!t || busy) return;
    onSend(t);
    setText('');
  };

  return (
    <div className="mx-auto w-full max-w-[760px] px-4 pb-4 sm:px-6">
      <div className="flex items-end gap-2 rounded-2xl border border-line-strong bg-elev p-2 pl-4 shadow-[var(--shadow)] transition-colors focus-within:border-[var(--accent)]">
        <label htmlFor="composer" className="sr-only">
          Message
        </label>
        <textarea
          id="composer"
          ref={ref}
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Ask anything, or ask whether an old answer still holds…"
          className="scroll-thin max-h-[200px] flex-1 resize-none bg-transparent py-2 text-[15px] leading-relaxed outline-none placeholder:text-ink-3"
        />
        {busy ? (
          <button
            onClick={onStop}
            aria-label="Stop generating"
            title="Stop generating (Esc)"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-ink text-bg transition-transform active:scale-95"
          >
            <IconStop />
          </button>
        ) : (
          <button
            onClick={submit}
            disabled={!text.trim()}
            aria-label="Send"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent text-on-accent transition-[transform,opacity] active:scale-95 disabled:opacity-30"
          >
            <IconArrowUp />
          </button>
        )}
      </div>
      <p className="mt-2 hidden text-center text-[11px] text-ink-3 sm:block">
        Enter to send · Shift+Enter for a new line · ⌘K new chat · every answer is kept as a dated, sourced receipt
      </p>
    </div>
  );
}
