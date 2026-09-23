import {
  type ImportSourceId,
  listImportSources,
  readImportFile,
  readImportSource,
} from '@main/agent/mcp/client-imports';
import { mcpSecretsSchema } from '@main/agent/mcp/config';
import { mcpManager } from '@main/agent/mcp/manager';
import {
  applyServersJson,
  createServer,
  exportServersJson,
  listServers,
  previewServersJson,
  removeServer,
  serverCredentials,
  serversNeedingAttention,
  setServerEnabled,
  updateServer,
} from '@main/agent/mcp/store';
import { getDb } from '@main/db';
import { BrowserWindow, dialog, type OpenDialogOptions } from 'electron';
import { z } from 'zod';
import { badRequest } from '../errors';
import { publicProcedure, router } from '../trpc';

const fields = z.object({
  name: z.string().trim().min(1),
  enabled: z.boolean().default(false),
  transport: z.enum(['stdio', 'http', 'sse']),
  config: z.record(z.string(), z.unknown()),
  // Secret env/headers travel with the form's Save, not a separate call.
  secrets: mcpSecretsSchema.default({}),
});

/** The edited JSON is the full desired state — applying it overwrites to match. */
const jsonInput = z.object({ json: z.string() });

const byId = z.object({ id: z.string() });

export const mcpRouter = router({
  list: publicProcedure.query(() => listServers(getDb())),

  /** Enabled servers that need the user's attention — for the startup prompt + badge. */
  attention: publicProcedure.query(() => serversNeedingAttention(getDb())),

  authenticate: publicProcedure
    .input(byId)
    .mutation(({ input }) => mcpManager.authenticate(input.id)),

  create: publicProcedure
    .input(fields)
    .mutation(({ input }) => ({ id: createServer(getDb(), input) })),

  update: publicProcedure.input(fields.extend({ id: z.string() })).mutation(({ input }) => {
    const { id, ...rest } = input;
    updateServer(getDb(), id, rest);
  }),

  setEnabled: publicProcedure
    .input(byId.extend({ enabled: z.boolean() }))
    .mutation(({ input }) => setServerEnabled(getDb(), input.id, input.enabled)),

  delete: publicProcedure.input(byId).mutation(({ input }) => removeServer(getDb(), input.id)),

  /** Decrypt the secrets so the settings form can prefill them on edit; {} when none. */
  getCredentials: publicProcedure
    .input(byId)
    .query(({ input }) => serverCredentials(getDb(), input.id)),

  /** Which other AI clients have an importable config on this machine, and how many servers. */
  importSources: publicProcedure.query(() => listImportSources()),

  /** Read one client's config, normalized to mcp.json text, to load into the editor. */
  readImport: publicProcedure
    .input(z.object({ source: z.enum(['cursor', 'claude-code', 'claude-desktop', 'codex']) }))
    .query(({ input }) => {
      try {
        return { json: readImportSource(input.source as ImportSourceId) };
      } catch (err) {
        throw badRequest(err instanceof Error ? err.message : 'Import failed.');
      }
    }),

  /** Native picker for any config file (covers project-level scopes); null if cancelled. */
  importFile: publicProcedure.mutation(async () => {
    const opts: OpenDialogOptions = {
      properties: ['openFile'],
      filters: [
        { name: 'MCP config', extensions: ['json', 'toml'] },
        { name: 'All files', extensions: ['*'] },
      ],
    };
    const win = BrowserWindow.getFocusedWindow();
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (res.canceled || res.filePaths.length === 0) return { json: null };
    try {
      return { json: readImportFile(res.filePaths[0]) };
    } catch (err) {
      throw badRequest(err instanceof Error ? err.message : 'Could not read that file.');
    }
  }),

  exportJson: publicProcedure.query(() => ({ json: exportServersJson(getDb()) })),

  /** Validate edited JSON and surface any fields dropped on parse; no DB access. */
  previewJson: publicProcedure.input(jsonInput).query(({ input }) => {
    try {
      return { valid: true as const, error: undefined, ...previewServersJson(input.json) };
    } catch (err) {
      return {
        valid: false as const,
        error: err instanceof Error ? err.message : 'Invalid JSON',
        warnings: [] as string[],
      };
    }
  }),

  applyJson: publicProcedure
    .input(jsonInput)
    .mutation(({ input }) => applyServersJson(getDb(), input.json)),
});
