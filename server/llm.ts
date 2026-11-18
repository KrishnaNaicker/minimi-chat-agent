import Anthropic from '@anthropic-ai/sdk';

// Everything model-specific lives here, so switching ANTHROPIC_MODEL is one env change.

export const MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-5-5';
// Background jobs (claim extraction, per-entity re-checks) are small and parallel: always Haiku.
export const FAST_MODEL = 'claude-haiku-5-5';

export function hasKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

let client: Anthropic | null = null;
export function anthropic(): Anthropic {
  // Created lazily so the server boots (and shows the setup screen) without a key.
  client ??= new Anthropic({ maxRetries: 2 });
  return client;
}

const isHaiku = (model: string) => model.includes('haiku');

/** Web search tool. Haiku runs the basic version (faster and cleaner in our tests);
 *  larger models get the dynamic-filtering version. */
export function webSearchTool(model: string, maxUses: number): Anthropic.ToolUnion {
  const type = isHaiku(model) ? 'web_search_20250305' : 'web_search_20260209';
  return { type, name: 'web_search', max_uses: maxUses } as Anthropic.ToolUnion;
}

/** Thinking/effort settings tuned for chat latency. Each family has its own way of saying "don't think". */
export function speedParams(model: string): Pick<Anthropic.MessageCreateParams, 'thinking' | 'output_config'> {
  if (isHaiku(model)) return { thinking: { type: 'disabled' } };
  if (model.includes('sonnet-5-5')) return { thinking: { type: 'between_tools' } as unknown as Anthropic.ThinkingConfigParam };
  return { output_config: { effort: 'low' } };
}

/** Turn an API error into a message that is safe and useful to show the user. Never includes the key. */
export function friendlyError(err: unknown): { message: string; code: string } {
  if (err instanceof Anthropic.APIUserAbortError) return { message: 'Stopped.', code: 'aborted' };
  if (err instanceof Anthropic.AuthenticationError)
    return { message: 'The Anthropic API key was rejected. Check ANTHROPIC_API_KEY in .env and restart.', code: 'auth' };
  if (err instanceof Anthropic.RateLimitError)
    return { message: 'Rate limited by the Anthropic API. Give it a few seconds and try again.', code: 'rate_limit' };
  if (err instanceof Anthropic.APIError) {
    const detail = (err.error as { error?: { message?: string } } | undefined)?.error?.message ?? '';
    if (/web.?search/i.test(detail))
      return {
        message: 'Web search is not enabled for this Anthropic organization. An admin can turn it on in the Claude Console organization settings; then retry.',
        code: 'web_search_disabled',
      };
    if (err.status === 529 || err.status === 503) return { message: 'Claude is overloaded right now. Try again in a moment.', code: 'overloaded' };
    if (err.status === 404) return { message: `Model "${MODEL}" was not found. Check ANTHROPIC_MODEL in .env.`, code: 'model' };
    return { message: `The Anthropic API returned an error (${err.status ?? 'network'}). ${detail}`.trim(), code: 'api' };
  }
  return { message: 'Something went wrong on the server. Check the terminal for details.', code: 'internal' };
}
