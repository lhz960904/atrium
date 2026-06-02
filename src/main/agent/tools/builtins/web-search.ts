import { tool } from 'ai';
import { z } from 'zod';
import { DDG, formatResults } from './web/engines';
import { runSearch } from './web/run-search';

export const webSearchTool = () =>
  tool({
    description:
      'Search the web and get a list of result titles, URLs, and snippets. Use this to find current information or pages you can then read with web_fetch. Returns the top results — follow up with web_fetch on a URL to read its full content.',
    inputSchema: z.object({
      query: z.string().min(1).describe('The search query.'),
    }),
    execute: async ({ query }) => {
      try {
        const results = await runSearch(DDG, query);
        return formatResults(query, results);
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  });
