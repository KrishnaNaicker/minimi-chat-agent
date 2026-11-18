# Design

**Most chat agents forget what they told you and can't say whether it's still true.** This one keeps receipts: every answer is stored with its date, searches, sources and extracted claims, and can be re-checked later as a Then → Now diff.

## How it works

```
browser ─(text, time zone, local time)─▶ POST /api/chat ─▶ SSE: status chips, text, diff
 1 temporal.ts  "last Tuesday" → Tue 10 Nov in the user's zone              (code, no LLM)
 2 recall.ts    "I asked / we shortlisted / you said" → past turns by date + keywords (SQLite)
 3a asks "still true / changed / since"?  recheck.ts: claims grouped by entity, one
    Haiku + web_search call per entity, 5 in parallel → Then → Now rows → short synthesis
 3b otherwise   agent.ts: one streamed call, model + web_search (≤4), recalled context
 4 ledger.ts    store answer, searches, sources, metrics; extract claims in the background
```

The model has **one tool, web search**: Anthropic's server-side tool, so one key runs everything.

## Why it's built this way

- **Time is an input.** The browser sends its zone and clock; dates resolve in code before the model runs, so recall queries by date and the answer restates it ("On Monday (16 Nov)…"). Ambiguous weekdays carry ranked readings; recall takes the first that matches the topic.
- **Memory is infrastructure.** The orchestrator decides when to look back (talk about the conversation, not a date alone) and injects `RECALLED CONTEXT` with timestamps, the original answer and its sources. If nothing matches, it says so and offers the nearest entries, so the agent never invents a past conversation.
- **Re-check verifies claims, not questions.** Two free-text answers are hard to diff; stored `{entity, attribute, value}` claims give one verdict per row with sources on both sides. Parallel calls make five CRMs take about as long as one (~4–6 s). A numeric guard flips "same" to "changed" when the quoted price differs.
- **Fast by default.** Haiku with thinking off, capped searches, a cached system prompt (~3.5k tokens), deltas batched per frame, "Let me search…" filler held back and dropped. Every answer shows its measured time to first token.
- **Boring storage.** One SQLite file, scanned in JS. Milliseconds at personal scale.

## Considered and rejected

| Option | Why not |
|---|---|
| Memory as an LLM tool | The brief allows one tool; it also adds a round trip that depends on the model calling it. |
| Vector DB / embeddings | The key signal is "on 3 Nov", which embeddings handle badly. Dates + keywords are exact and explainable. |
| LangChain / agent frameworks | The orchestrator is ~400 lines; a framework would hide the parts worth reading. |
| Separate search API | Another key and failure point; Anthropic's search returns page age and citations. |
| Full re-search instead of a claims diff | Slower, and two free-text answers can't be diffed reliably. |
| Pre-routing LLM call | +0.5–1 s on every turn. Regexes route recall and re-check; the model decides when to search. |

## Minimi touch

Old answers show their age; volatile ones (prices, plans, versions) get a subtle **May be stale · Re-check**. That is one step from a proactive nudge: a nightly job runs `recheckClaims` over claims you relied on and **pings you only when a row flips to changed** ("A CRM you shortlisted on Monday went from $165 to $175"). No scheduler is built, on purpose.

## With another week

1. **Proactive nudges:** the nightly re-check above, delivered as macOS notifications.
2. **Better claim matching:** canonical entities and structured values (amount, unit, period).
3. **Evals at scale:** ~100 recorded conversations, an LLM judge for faithfulness to recalled context, latency percentiles.
4. **Native Mac shell:** a menu-bar app around the same server, ledger on device.
