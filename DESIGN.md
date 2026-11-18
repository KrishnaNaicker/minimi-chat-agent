# Design

**Most chat agents forget what they told you and can't tell you whether it's still true.** This one keeps receipts: each answer is stored with its date, searches, sources and extracted claims, and can be re-checked later as a Then → Now diff.

## How it works

```
browser ──(text, IANA time zone, local time)──▶ POST /api/chat  (SSE back)
                                                   │
  1. temporal.ts   "last Tuesday" → Tue 10 Nov, in the user's zone      (no LLM)
  2. recall.ts     past turns in that date window, else keyword overlap (SQLite, no LLM)
                                                   │
           asks "still true / changed / since"? ───┴─── otherwise
                    │                                      │
  3a. recheck.ts  claims grouped by entity          3b. agent.ts  one streamed call:
      Haiku + web_search per entity,                    model + web_search (max 4 uses),
      5 in parallel → Then → Now rows                   recalled context in the user turn
      + one short streamed synthesis                    citations → numbered source chips
                    │                                      │
  4. ledger.ts    store answer, searches, sources, metrics → claims extracted in background
```

The model has **one tool, web search** (Anthropic's server-side tool, so one key runs everything). Status events (dates, recall, each query, each entity) stream to the UI as chips.

## Why it's built this way

- **Time is an input, not a guess.** The browser sends its time zone and clock; dates are resolved in code before the model runs, so recall can query by date and the answer restates it ("On Monday (16 Nov)…"). Ambiguous weekdays carry ranked alternatives.
- **Memory is infrastructure.** The orchestrator decides when to look back (a date, or "you said / we shortlisted / since then") and injects a `RECALLED CONTEXT` block with timestamps, the original answer and its sources. When nothing matches it says so and lists the nearest entries, so the agent never invents a past conversation.
- **Re-check verifies claims, not questions.** Two free-text answers are hard to compare; stored `{entity, attribute, value}` claims give a per-row verdict with sources on both sides. One call per entity, in parallel, makes five CRMs take about as long as one (~4–6 s in the eval). A numeric guard flips "same" to "changed" when the model quotes a different price.
- **Fast by default.** Haiku with thinking off, searches capped per turn, the system prompt cached (~3.5k cached tokens per turn), deltas batched per frame. "Let me search…" filler is held back and dropped. Every answer's footer shows its measured time to first token.
- **Boring storage.** One SQLite file, scanned in JS: milliseconds at personal scale.

## Considered and rejected

| Option | Why not |
|---|---|
| Memory as an LLM tool | The brief allows one tool, and it adds a round trip that depends on the model choosing to call it. Date-based recall is deterministic. |
| Vector DB / embeddings | The key signal is "on 3 Nov", which embeddings handle badly. Date windows plus keyword overlap are exact and explainable. |
| LangChain / agent frameworks | A two-branch orchestrator is ~350 lines; a framework would hide exactly the parts worth reading. |
| Separate search API | Another key and failure point; Anthropic's search returns page age and citations natively. |
| Full re-search instead of a claims diff | Slower, and you can't diff two free-text answers reliably. |
| A pre-routing LLM call ("does this need search / recall?") | Adds 0.5–1 s to every turn. Regexes decide recall and re-check; the model decides on search itself. |

## Minimi touch

Old answers show their age; ones with prices or other volatile claims get a subtle **May be stale · Re-check**. That is one step from a proactive minimi nudge: a nightly job runs `recheckClaims` over volatile claims you relied on and **pings you only when a row flips to changed** ("A CRM you shortlisted on Monday went from $165 to $175"). No scheduler is built, on purpose.

## With another week

1. **Proactive nudges:** the nightly re-check above, plus macOS notifications.
2. **Better claim matching:** canonical entities and structured values (amount, unit, period) instead of strings.
3. **Evals at scale:** ~100 recorded conversations, an LLM judge for faithfulness to recalled context, latency percentiles.
4. **Native Mac shell:** a menu-bar app around the same server, ledger on device.
