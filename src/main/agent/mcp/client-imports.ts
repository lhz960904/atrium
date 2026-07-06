import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { parseMcpJson } from './json-config';

/*
 * Import MCP servers from other AI clients' config files, so users don't have to
 * hunt down deeply-nested config paths. Each source is normalized to the common
 * `mcpServers` JSON dialect and then handed to parseMcpJson. Codex is TOML with
 * `[mcp_servers.*]` sections; the rest are JSON keyed by `mcpServers`.
 */

export type ImportSourceId = 'cursor' | 'claude-code' | 'claude-desktop' | 'codex';

type SourceDef = {
  id: ImportSourceId;
  label: string;
  format: 'json' | 'toml';
  file: string;
};

const SOURCES: SourceDef[] = [
  { id: 'cursor', label: 'Cursor', format: 'json', file: '.cursor/mcp.json' },
  { id: 'claude-code', label: 'Claude Code', format: 'json', file: '.claude.json' },
  {
    id: 'claude-desktop',
    label: 'Claude Desktop',
    format: 'json',
    file: 'Library/Application Support/Claude/claude_desktop_config.json',
  },
  { id: 'codex', label: 'Codex', format: 'toml', file: '.codex/config.toml' },
];

const asRecord = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/** Codex `[mcp_servers.*]` TOML → the common `mcpServers` object shape. */
export function codexTomlToMcpServers(tomlText: string): Record<string, unknown> {
  const table = asRecord(parseToml(tomlText).mcp_servers) ?? {};
  const out: Record<string, unknown> = {};
  for (const [name, raw] of Object.entries(table)) {
    const s = asRecord(raw);
    if (!s) continue;
    const entry: Record<string, unknown> = {};
    if (typeof s.url === 'string') {
      entry.type = 'http';
      entry.url = s.url;
      if (typeof s.bearer_token_env_var === 'string') {
        entry.bearerTokenEnvVar = s.bearer_token_env_var;
      }
    } else {
      entry.type = 'stdio';
      if (typeof s.command === 'string') entry.command = s.command;
      if (Array.isArray(s.args)) entry.args = s.args;
      if (asRecord(s.env)) entry.env = s.env;
      if (Array.isArray(s.env_vars)) entry.envPassthrough = s.env_vars;
      if (typeof s.cwd === 'string') entry.cwd = s.cwd;
    }
    if (s.enabled === false) entry.enabled = false;
    out[name] = entry;
  }
  return out;
}

/**
 * Claude Code keeps user-scope servers under a top-level `mcpServers`, but
 * per-project ones live under `projects["<path>"].mcpServers`. Merge both so the
 * import surfaces every server the user actually configured; on a name clash the
 * later (project) definition wins. The user curates the set in the diff anyway.
 */
export function claudeCodeToMcpServers(jsonText: string): Record<string, unknown> {
  const root = asRecord(JSON.parse(jsonText)) ?? {};
  const merged: Record<string, unknown> = { ...(asRecord(root.mcpServers) ?? {}) };
  const projects = asRecord(root.projects) ?? {};
  for (const project of Object.values(projects)) {
    const servers = asRecord(asRecord(project)?.mcpServers);
    if (servers) Object.assign(merged, servers);
  }
  return merged;
}

/**
 * Normalize any client config text to `mcpServers` JSON: Codex TOML, Claude
 * Code's projects-nested JSON, or a plain `mcpServers`/`servers` document. The
 * format is chosen by file extension, falling back to content sniffing — so it
 * works for a picked project-level file just as well as a known global one.
 */
export function normalizeConfigText(text: string, filename = ''): string {
  if (filename.toLowerCase().endsWith('.toml')) {
    return JSON.stringify({ mcpServers: codexTomlToMcpServers(text) });
  }
  try {
    const root = asRecord(JSON.parse(text));
    if (root && asRecord(root.projects)) {
      return JSON.stringify({ mcpServers: claudeCodeToMcpServers(text) });
    }
    return text; // already mcpServers / servers / bare — parseMcpJson handles it
  } catch {
    // Not JSON — treat as TOML (a config.toml renamed without the extension).
    return JSON.stringify({ mcpServers: codexTomlToMcpServers(text) });
  }
}

const readIfPresent = (def: SourceDef): string | null => {
  try {
    return readFileSync(join(homedir(), def.file), 'utf8');
  } catch {
    return null;
  }
};

export type ImportSource = {
  id: ImportSourceId;
  label: string;
  available: boolean;
  count: number;
};

/** List each client with whether its config exists and how many servers it holds. */
export function listImportSources(): ImportSource[] {
  return SOURCES.map((def) => {
    const raw = readIfPresent(def);
    if (raw == null) return { id: def.id, label: def.label, available: false, count: 0 };
    try {
      const { servers } = parseMcpJson(normalizeConfigText(raw, def.file));
      return { id: def.id, label: def.label, available: true, count: servers.length };
    } catch {
      return { id: def.id, label: def.label, available: false, count: 0 };
    }
  });
}

/** Read one client's config, normalized to `mcpServers` JSON text for the editor. */
export function readImportSource(id: ImportSourceId): string {
  const def = SOURCES.find((d) => d.id === id);
  if (!def) throw new Error(`Unknown import source: ${id}`);
  const raw = readIfPresent(def);
  if (raw == null) throw new Error(`No ${def.label} config found.`);
  return normalizeConfigText(raw, def.file);
}

/** Read and normalize an arbitrary config file the user picked (any scope, any client). */
export function readImportFile(path: string): string {
  return normalizeConfigText(readFileSync(path, 'utf8'), path);
}
