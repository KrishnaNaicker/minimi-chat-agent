import * as chrono from 'chrono-node';

// Deterministic date resolution, done before any LLM call.
// Days are plain "YYYY-MM-DD" strings in the user's time zone; that keeps the
// arithmetic boring and avoids accidental UTC shifts.

export interface DayRange {
  from: string; // first local day, inclusive
  to: string; // last local day, inclusive
  label: string; // "Mon 16 Nov"
}

export interface DateRef extends DayRange {
  text: string; // the phrase as the user wrote it
  alternatives: DayRange[]; // other plausible readings, most likely first
}

export interface Temporal {
  timeZone: string;
  now: Date;
  today: string;
  nowLabel: string; // "Wednesday, 18 November 2026, 19:20"
  refs: DateRef[];
  sinceThen: boolean; // "since then" / "since": compare a past answer with today
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, 'a couple of': 2, 'a few': 3, few: 3,
};

export function safeTimeZone(tz: string | undefined): string {
  if (!tz) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
}

export function localDay(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function weekday(day: string): number {
  return new Date(`${day}T00:00:00Z`).getUTCDay();
}

export function dayLabel(day: string, today?: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  const sameYear = !today || today.slice(0, 4) === day.slice(0, 4);
  return d.toLocaleDateString('en-GB', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

function rangeLabel(from: string, to: string, today: string): string {
  return from === to ? dayLabel(from, today) : `${dayLabel(from, today)} – ${dayLabel(to, today)}`;
}

function range(from: string, to: string, today: string): DayRange {
  return { from, to, label: rangeLabel(from, to, today) };
}

// Offset of `timeZone` from UTC at `date`, in ms.
function tzOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** UTC instant at which local `day` starts in `timeZone` (DST-safe). */
export function startOfDayUtc(day: string, timeZone: string): Date {
  const guess = new Date(`${day}T00:00:00Z`).getTime();
  let t = guess - tzOffsetMs(new Date(guess), timeZone);
  const second = guess - tzOffsetMs(new Date(t), timeZone);
  if (second !== t) t = second;
  return new Date(t);
}

/** [start, end) in UTC for an inclusive local day range. */
export function utcBounds(r: { from: string; to: string }, timeZone: string): [Date, Date] {
  return [startOfDayUtc(r.from, timeZone), startOfDayUtc(addDays(r.to, 1), timeZone)];
}

function weekdayRef(prefix: string | undefined, target: number, today: string): DayRange[] {
  const back = (weekday(today) - target + 7) % 7;
  const mostRecent = addDays(today, back === 0 ? -7 : -back); // strictly before today
  const p = (prefix ?? '').toLowerCase();
  if (p === 'this') {
    const monday = addDays(today, -((weekday(today) + 6) % 7));
    const d = addDays(monday, (target + 6) % 7);
    return [range(d, d, today)];
  }
  if (p === 'last' || p === 'past') {
    // If the most recent one was yesterday, people usually say "yesterday";
    // "last Tuesday" on a Wednesday more often means the week before.
    const ordered = mostRecent === addDays(today, -1) ? [addDays(mostRecent, -7), mostRecent] : [mostRecent, addDays(mostRecent, -7)];
    return ordered.map((d) => range(d, d, today));
  }
  // "on Monday", "Monday", "since Monday": the most recent one; today only if it is that day.
  const alts = back === 0 ? [mostRecent, today] : [mostRecent, addDays(mostRecent, -7)];
  return alts.map((d) => range(d, d, today));
}

interface Rule {
  re: RegExp;
  resolve: (m: RegExpExecArray, today: string) => DayRange[];
}

const RULES: Rule[] = [
  {
    re: new RegExp(`\\b(?:(on|last|this|past|since)\\s+)?(${WEEKDAYS.join('|')})s?\\b`, 'gi'),
    resolve: (m, today) => weekdayRef(m[1], WEEKDAYS.indexOf(m[2]!.toLowerCase()), today),
  },
  { re: /\bday before yesterday\b/gi, resolve: (_m, t) => [range(addDays(t, -2), addDays(t, -2), t)] },
  { re: /\byesterday\b/gi, resolve: (_m, t) => [range(addDays(t, -1), addDays(t, -1), t)] },
  { re: /\b(earlier today|this morning|this afternoon)\b/gi, resolve: (_m, t) => [range(t, t, t)] },
  {
    re: /\b(earlier this week|this week)\b/gi,
    resolve: (_m, t) => [range(addDays(t, -((weekday(t) + 6) % 7)), t, t)],
  },
  {
    re: /\blast week\b/gi,
    resolve: (_m, t) => {
      const monday = addDays(t, -((weekday(t) + 6) % 7) - 7);
      return [range(monday, addDays(monday, 6), t)];
    },
  },
  {
    re: /\blast month\b/gi,
    resolve: (_m, t) => {
      const first = new Date(`${t.slice(0, 7)}-01T00:00:00Z`);
      first.setUTCMonth(first.getUTCMonth() - 1);
      const from = first.toISOString().slice(0, 10);
      return [range(from, addDays(`${t.slice(0, 7)}-01`, -1), t)];
    },
  },
  { re: /\bthe other day\b/gi, resolve: (_m, t) => [range(addDays(t, -7), addDays(t, -1), t)] },
  {
    re: /\b(\d+|an?|one|two|three|four|five|six|seven|a couple of|a few|few)\s+(day|week|month)s?\s+ago\b/gi,
    resolve: (m, t) => {
      const n = /^\d+$/.test(m[1]!) ? Number(m[1]) : NUMBER_WORDS[m[1]!.toLowerCase()] ?? 1;
      const unit = m[2]!.toLowerCase();
      if (unit === 'day') return [range(addDays(t, -n), addDays(t, -n), t)];
      const days = unit === 'week' ? 7 * n : 30 * n;
      const slack = unit === 'week' ? 3 : 10;
      return [range(addDays(t, -days - slack), addDays(t, -days + slack), t)];
    },
  },
];

export function resolveTemporal(text: string, now: Date, tz?: string): Temporal {
  const timeZone = safeTimeZone(tz);
  const today = localDay(now, timeZone);
  const nowLabel = now.toLocaleString('en-GB', {
    timeZone, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  const refs: DateRef[] = [];
  let masked = text;
  const add = (phrase: string, readings: DayRange[]) => {
    const [first, ...alternatives] = readings;
    if (!first || refs.some((r) => r.from === first.from && r.to === first.to)) return;
    refs.push({ text: phrase, ...first, alternatives });
  };

  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rule.re.exec(masked))) {
      add(m[0], rule.resolve(m, today));
      masked = masked.slice(0, m.index) + ' '.repeat(m[0].length) + masked.slice(m.index + m[0].length);
    }
  }

  // Absolute dates ("3 November", "Nov 3", "2026-11-03") via chrono. We only read
  // the calendar components; a date without a year that lands in the future is last year's.
  const reference = { instant: new Date(`${today}T12:00:00Z`), timezone: 0 };
  for (const r of chrono.parse(masked, reference)) {
    if (!r.start.isCertain('day') || !r.start.isCertain('month')) continue;
    const toDay = (c: chrono.ParsedComponents) => {
      let y = c.get('year') ?? Number(today.slice(0, 4));
      const md = `${String(c.get('month')).padStart(2, '0')}-${String(c.get('day')).padStart(2, '0')}`;
      if (!c.isCertain('year') && `${y}-${md}` > today) y -= 1;
      return `${y}-${md}`;
    };
    const from = toDay(r.start);
    const to = r.end ? toDay(r.end) : from;
    if (from === today && to === today) continue; // "today", "now": a reference to the present, not the past
    add(r.text.trim(), [range(from, to, today)]);
  }

  return { timeZone, now, today, nowLabel, refs, sinceThen: /\bsince\b/i.test(text) };
}
