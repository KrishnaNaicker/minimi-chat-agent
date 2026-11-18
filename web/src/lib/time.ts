// Small date helpers for the UI, always in the browser's own time zone.

const DAY = 86_400_000;

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Sidebar group: Today / Yesterday / Earlier this week / "Mon 9 Nov" / "October 2026". */
export function dateGroup(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const days = Math.round((startOfDay(now) - startOfDay(d)) / DAY);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  const mondayOffset = (now.getDay() + 6) % 7; // days since Monday
  if (days <= mondayOffset) return 'Earlier this week';
  if (days < 31) return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

/** "answered 15 days ago", or null for anything from the last hour. */
export function ageLabel(iso: string, now = new Date()): string | null {
  const ms = now.getTime() - new Date(iso).getTime();
  if (ms < 3_600_000) return null;
  const days = Math.round((startOfDay(now) - startOfDay(new Date(iso))) / DAY);
  if (days === 0) return `${Math.round(ms / 3_600_000)}h ago`;
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

export function dayMonth(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
}

export function isOlderThan(iso: string, hours: number, now = new Date()): boolean {
  return now.getTime() - new Date(iso).getTime() > hours * 3_600_000;
}

export function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}
