import { allTurns, getClaims, type Claim, type Turn } from './ledger.js';
import { dayLabel, localDay, utcBounds, type DayRange, type Temporal } from './temporal.js';

// Memory is infrastructure, not a tool: the orchestrator decides when to look
// back, using the resolved dates and simple keyword overlap. No embeddings —
// a personal ledger is small, and exact dates matter more than fuzzy similarity.

const PAST_REFERENCE =
  /\b(i|we)\s+(asked|shortlisted|discussed|talked|looked|compared|mentioned|said|chose|picked|decided)\b|\byou\s+(said|told|recommended|suggested|answered|mentioned|found)\b|\b(your|the)\s+(answer|reply|recommendation)\b|\bsince then\b|\blast time\b|\bearlier\b|\bremind me\b|\bstill (correct|true|accurate|valid|right|the case)\b/i;

const STOPWORDS = new Set(
  ('the a an and or but if of to in on at for from by with about into over is are was were be been being do does did done ' +
    'have has had having i me my we our us you your it its this that these those what which who whom when where why how ' +
    'any some all each there their them they he she his her not no yes can could would should will just than then so ' +
    'ask asked tell told said say says still correct true today now since changed change changes anything something ' +
    'monday tuesday wednesday thursday friday saturday sunday yesterday week weeks month months day days ago last ' +
    'january february march april may june july august september october november december jan feb mar apr jun jul aug sep sept oct nov dec ' +
    'answer question please thanks hey hi big shipped').split(' '),
);

export function keywords(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().match(/[a-z][a-z0-9+.-]*[a-z0-9]|[a-z]/g) ?? []) {
    const w = raw.replace(/(ies)$/, 'y').replace(/(?<!s)s$/, '');
    if (w.length >= 3 && !STOPWORDS.has(w) && !/^\d+$/.test(w)) out.add(w);
  }
  return out;
}

export interface RecalledTurn extends Turn {
  claims: Claim[];
  score: number;
  matchedDate: DayRange | null; // the date reading that matched, if any
}

export interface Recall {
  triggered: boolean;
  turns: RecalledTurn[]; // best matches, most relevant first
  window: DayRange | null; // the date window the user referred to
  nearest: RecalledTurn[]; // when the window was empty: closest turns, for an honest "did you mean…?"
  ledgerEmpty: boolean;
}

function topicScore(query: Set<string>, turn: Turn, claims: Claim[]): number {
  if (query.size === 0) return 0;
  const body = keywords(`${turn.question} ${turn.answer} ${turn.conversationTitle}`);
  const entities = keywords(claims.map((c) => c.entity).join(' '));
  let score = 0;
  for (const w of query) {
    if (body.has(w)) score += 1;
    if (entities.has(w)) score += 1;
  }
  return score;
}

export function shouldRecall(text: string, temporal: Temporal): boolean {
  return temporal.refs.length > 0 || PAST_REFERENCE.test(text);
}

export function recall(text: string, temporal: Temporal): Recall {
  const empty: Recall = { triggered: false, turns: [], window: null, nearest: [], ledgerEmpty: false };
  if (!shouldRecall(text, temporal)) return empty;

  const turns = allTurns().filter((t) => t.kind === 'answer');
  if (turns.length === 0) return { ...empty, triggered: true, ledgerEmpty: true };

  const query = keywords(text);
  const claimsByTurn = new Map<string, Claim[]>();
  for (const c of getClaims(turns.map((t) => t.answerId))) {
    claimsByTurn.set(c.messageId, [...(claimsByTurn.get(c.messageId) ?? []), c]);
  }
  const scored: RecalledTurn[] = turns.map((t) => {
    const claims = claimsByTurn.get(t.answerId) ?? [];
    return { ...t, claims, score: topicScore(query, t, claims), matchedDate: null };
  });

  // 1. The user named a date: try each reading in order; the first with hits wins.
  const ref = temporal.refs[0];
  if (ref) {
    for (const reading of [ref, ...ref.alternatives]) {
      const [start, end] = utcBounds(reading, temporal.timeZone);
      const hits = scored
        .filter((t) => t.askedAt >= start.toISOString() && t.askedAt < end.toISOString())
        .map((t) => ({ ...t, matchedDate: { from: reading.from, to: reading.to, label: reading.label } }))
        .sort((a, b) => b.score - a.score || b.askedAt.localeCompare(a.askedAt));
      // Within the window, prefer topical hits; if the question has no topic words, take them all.
      const topical = hits.filter((h) => h.score > 0);
      const chosen = query.size > 0 && topical.length > 0 ? topical : hits;
      if (chosen.length > 0) return { triggered: true, turns: chosen.slice(0, 3), window: ref, nearest: [], ledgerEmpty: false };
    }
    // Nothing on that date: offer the closest days and the best topical match instead of inventing one.
    const [start] = utcBounds(ref, temporal.timeZone);
    const byDistance = [...scored].sort(
      (a, b) => Math.abs(Date.parse(a.askedAt) - start.getTime()) - Math.abs(Date.parse(b.askedAt) - start.getTime()),
    );
    const nearest = byDistance.slice(0, 2);
    const bestTopic = [...scored].sort((a, b) => b.score - a.score)[0];
    if (bestTopic && bestTopic.score >= 2 && !nearest.includes(bestTopic)) nearest.push(bestTopic);
    return { triggered: true, turns: [], window: ref, nearest, ledgerEmpty: false };
  }

  // 2. No date, but a reference to the past ("you said…", "the CRM tools we compared"): topic only.
  const hits = scored.filter((t) => t.score >= 2).sort((a, b) => b.score - a.score || b.askedAt.localeCompare(a.askedAt));
  return { triggered: true, turns: hits.slice(0, 3), window: null, nearest: [], ledgerEmpty: false };
}

/** "Mon 16 Nov, 14:05" in the user's zone. */
export function stamp(iso: string, timeZone: string, today: string): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString('en-GB', { timeZone, hour: '2-digit', minute: '2-digit' });
  return `${dayLabel(localDay(d, timeZone), today)}, ${time}`;
}
