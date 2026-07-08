import { tool } from 'ai';
import { z } from 'zod';
import { ENGINES, formatResults } from './web/engines';
import { runSearch } from './web/run-search';

export const webSearchTool = () =>
  tool({
    description:
      'Search the web and get a list of result titles, URLs, and snippets. Use this to find current information or pages you can then read with web_fetch. Returns the top results — follow up with web_fetch on a URL to read its full content.',
    inputSchema: z.object({
      query: z.string().min(1).describe('The search query.'),
    }),
    execute: async ({ query }, { abortSignal }) => {
      // Engines are tried in order: a bot challenge or timeout on one falls
      // through to the next, so only a failure across all of them surfaces as
      // an error. "No results found" is reserved for a genuinely empty page.
      const failures: string[] = [];
      for (const engine of ENGINES) {
        try {
          const results = await runSearch(engine, query, abortSignal);
          return formatResults(query, results);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (abortSignal?.aborted) return `Error: ${msg}`;
          failures.push(`${engine.name}: ${msg}`);
        }
      }
      return `Error: all search engines failed — ${failures.join('; ')}`;
    },
  });
