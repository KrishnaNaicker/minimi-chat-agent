import '../server/env.js';
import { db } from '../server/db.js';
import { createConversation, insertClaims, saveMessage } from '../server/ledger.js';
import { addDays, localDay, resolveTemporal, startOfDayUtc } from '../server/temporal.js';
import type { Source } from '../server/types.js';

// Demo history, dated RELATIVE to today so "on Monday", "last Tuesday" and an
// exact date 15 days ago always resolve to something. Every row is flagged
// is_seed = 1 (shown as a "demo seed" badge) and `npm run seed:reset` removes them.
// A few values are deliberately stale so a re-check has something to find.

export const EXACT_DATE_OFFSET_DAYS = 15;

interface SeedTurn {
  day: string; // local YYYY-MM-DD
  time: string; // local HH:MM
  title: string;
  question: string;
  answer: string;
  sources: [string, string][]; // [url, title], numbered in order
  claims: [entity: string, attribute: string, value: string, sourceIndex: number | null][];
}

export function seedDates(now = new Date(), timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone) {
  const today = localDay(now, timeZone);
  return {
    today,
    monday: resolveTemporal('on Monday', now, timeZone).refs[0]!.from,
    lastTuesday: resolveTemporal('last Tuesday', now, timeZone).refs[0]!.from,
    exact: addDays(today, -EXACT_DATE_OFFSET_DAYS),
    yesterday: addDays(today, -1),
  };
}

function turns(d: ReturnType<typeof seedDates>): SeedTurn[] {
  return [
    {
      day: d.exact,
      time: '10:12',
      title: 'AI assistant subscription prices',
      question: 'What do ChatGPT Plus, Claude Pro and Google’s Gemini paid plan cost per month right now?',
      answer: `All three sit at roughly **$20/month** for an individual:

| Plan | Monthly price |
|---|---|
| ChatGPT Plus | $20/month[1] |
| Claude Pro | $20/month, or $17/month billed annually[2] |
| Google AI Pro (Gemini) | $19.99/month[3] |

Team and business tiers cost more per seat; prices exclude tax.`,
      sources: [
        ['https://openai.com/chatgpt/pricing/', 'ChatGPT Pricing | OpenAI'],
        ['https://claude.com/pricing', 'Plans & Pricing | Claude'],
        ['https://one.google.com/about/google-ai-plans/', 'Google AI Plans'],
      ],
      claims: [
        ['ChatGPT Plus', 'monthly price', '$20/month', 0],
        ['Claude Pro', 'monthly price', '$20/month ($17/month billed annually)', 1],
        ['Google AI Pro', 'monthly price', '$19.99/month', 2],
      ],
    },
    {
      day: d.lastTuesday,
      time: '16:40',
      title: 'Postgres hosting for a small SaaS',
      question: 'Compare managed Postgres hosting for a small SaaS: Neon, Supabase, AWS RDS, Railway and Render. What’s the cheapest sensible production setup?',
      answer: `For a small production SaaS, **Supabase Pro or Neon Launch** are the sensible defaults; RDS is cheapest per GB but costs you ops time.

| Provider | Entry production plan | Starting price |
|---|---|---|
| Neon | Launch | $19/month[1] |
| Supabase | Pro | $25/month per org, includes $10 compute credits[2] |
| AWS RDS | db.t4g.micro, single-AZ | ~$11.68/month + $0.115/GB-month storage[3] |
| Railway | Hobby | $5/month including $5 of usage[4] |
| Render | Basic-256mb Postgres | $6/month[5] |

**My pick:** Supabase Pro if you want auth and storage too; Neon Launch if you only need Postgres and like branching. Revisit RDS once you have someone who owns infra.`,
      sources: [
        ['https://neon.com/pricing', 'Neon Pricing'],
        ['https://supabase.com/pricing', 'Pricing & Fees | Supabase'],
        ['https://aws.amazon.com/rds/postgresql/pricing/', 'Amazon RDS for PostgreSQL Pricing'],
        ['https://railway.com/pricing', 'Pricing | Railway'],
        ['https://render.com/pricing', 'Pricing | Render'],
      ],
      claims: [
        ['Neon', 'Launch plan price', '$19/month', 0],
        ['Supabase', 'Pro plan price', '$25/month per org, includes $10 compute credits', 1],
        ['AWS RDS for PostgreSQL', 'db.t4g.micro single-AZ price (us-east-1)', '~$11.68/month', 2],
        ['Railway', 'Hobby plan price', '$5/month including $5 of usage', 3],
        ['Render', 'Basic-256mb Postgres price', '$6/month', 4],
      ],
    },
    {
      day: d.monday,
      time: '14:05',
      title: 'CRM shortlist for a 20-person sales team',
      question: 'We’re a 20-person sales team choosing a CRM. Shortlist 5 options with pricing for our size.',
      answer: `Here’s a shortlist of 5 that fit a 20-seat sales team, priced per user per month on annual billing:

| CRM | Plan that fits | Per user / month | 20 seats / month |
|---|---|---|---|
| HubSpot Sales Hub | Professional | $90[1] | $1,800 |
| Salesforce Sales Cloud | Enterprise | $165[2] | $3,300 |
| Pipedrive | Professional | $49[3] | $980 |
| Zoho CRM | Enterprise | $40[4] | $800 |
| Attio | Pro | $59[5] | $1,180 |

**Short version:** Pipedrive or Zoho if budget leads; HubSpot if marketing alignment matters; Salesforce only if you need heavy customisation and have an admin. HubSpot Professional also charges a one-time onboarding fee of $1,500[1].`,
      sources: [
        ['https://www.hubspot.com/pricing/sales', 'Sales Hub Pricing | HubSpot'],
        ['https://www.salesforce.com/sales/pricing/', 'Sales Cloud Pricing | Salesforce'],
        ['https://www.pipedrive.com/en/pricing', 'Pricing | Pipedrive'],
        ['https://www.zoho.com/crm/zohocrm-pricing.html', 'Zoho CRM Pricing'],
        ['https://attio.com/pricing', 'Pricing | Attio'],
      ],
      claims: [
        ['HubSpot Sales Hub', 'Professional plan price', '$90/user/month, billed annually', 0],
        ['HubSpot Sales Hub', 'Professional onboarding fee', '$1,500 one-time', 0],
        ['Salesforce Sales Cloud', 'Enterprise plan price', '$165/user/month, billed annually', 1],
        ['Pipedrive', 'Professional plan price', '$49/user/month, billed annually', 2],
        ['Zoho CRM', 'Enterprise plan price', '$40/user/month, billed annually', 3],
        ['Attio', 'Pro plan price', '$59/user/month, billed annually', 4],
      ],
    },
    {
      day: d.yesterday,
      time: '09:30',
      title: 'Follow-up email to a vendor',
      question: 'Draft a short, polite follow-up to a vendor who hasn’t replied about our renewal quote.',
      answer: `**Subject:** Following up on our renewal quote

Hi Sam,

Just following up on the renewal quote we discussed last week. Could you send it over by Friday so we can get it approved before month-end?

Thanks,
Alex`,
      sources: [],
      claims: [],
    },
  ];
}

export function resetSeed(): number {
  return db.prepare('DELETE FROM conversations WHERE is_seed = 1').run().changes;
}

export function seed(now = new Date(), timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone) {
  resetSeed();
  const dates = seedDates(now, timeZone);
  for (const t of turns(dates)) {
    const [hh, mm] = t.time.split(':').map(Number) as [number, number];
    const asked = new Date(startOfDayUtc(t.day, timeZone).getTime() + (hh * 60 + mm) * 60_000);
    const answered = new Date(asked.getTime() + 6_000).toISOString();
    const conversationId = createConversation(t.title, asked.toISOString(), true);
    const q = saveMessage({ conversationId, role: 'user', content: t.question, createdAt: asked.toISOString(), isSeed: true });
    const sources: Source[] = t.sources.map(([url, title], i) => ({ n: i + 1, url, title, pageAge: null, retrievedAt: answered }));
    const a = saveMessage({
      conversationId, role: 'assistant', content: t.answer, createdAt: answered, replyTo: q.id, isSeed: true,
      searches: t.sources.length ? [`${t.title} ${dates.today.slice(0, 4)}`] : [], sources,
    });
    insertClaims(a.id, t.claims.map(([entity, attribute, value, i]) => ({
      entity, attribute, value, asOf: answered, sourceUrl: i === null ? null : t.sources[i]?.[0] ?? null, volatile: true,
    })));
  }
  return dates;
}

// CLI: `npm run seed` / `npm run seed:reset`
if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv.includes('--reset')) {
    console.log(`Removed ${resetSeed()} demo conversations.`);
  } else {
    const d = seed();
    console.log('Seeded demo history (flagged as demo seed):');
    console.log(`  ${d.exact}  AI assistant subscription prices   → try "What did I ask you on ${new Date(`${d.exact}T00:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'long' })}?"`);
    console.log(`  ${d.lastTuesday}  Postgres hosting comparison        → try "Last Tuesday I asked you about Postgres hosting…"`);
    console.log(`  ${d.monday}  CRM shortlist (5 tools)            → try "On Monday we shortlisted 5 CRM tools…"`);
    console.log(`  ${d.yesterday}  Vendor follow-up email (no search)`);
  }
}
