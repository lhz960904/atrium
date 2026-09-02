import { defineTool, Type, textResult } from '../define';
import { ENGINES, formatResults } from './web/engines';
import { runSearch } from './web/run-search';

export const webSearchTool = () =>
  defineTool({
    name: 'web_search',
    label: 'Search the web',
    description:
      'Search the web and get a list of result titles, URLs, and snippets. Use this to find current information or pages you can then read with web_fetch. Returns the top results — follow up with web_fetch on a URL to read its full content.',
    parameters: Type.Object({
      query: Type.String({ minLength: 1, description: 'The search query.' }),
    }),
    execute: async (_id, { query }, signal) => {
      // Engines are tried in order: a bot challenge or timeout on one falls
      // through to the next, so only a failure across all of them surfaces as
      // an error. "No results found" is reserved for a genuinely empty page.
      const failures: string[] = [];
      for (const engine of ENGINES) {
        try {
          return textResult(formatResults(query, await runSearch(engine, query, signal)));
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (signal?.aborted) throw new Error(msg);
          failures.push(`${engine.name}: ${msg}`);
        }
      }
      throw new Error(`all search engines failed — ${failures.join('; ')}`);
    },
  });
