import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { trpc } from '../../../lib/trpc';

export type McpServerItem = {
  id: string;
  name: string;
  enabled: boolean;
  transport: 'stdio' | 'http' | 'sse';
  config: Record<string, unknown> | null;
  hasCredentials: boolean;
  /** Live connection status from the manager; absent while connecting/not attempted. */
  status?: 'connected' | 'needs-auth' | 'error';
};

type Pair = { key: string; value: string };

const input =
  'w-full rounded-lg border border-border-default bg-surface px-3 py-2 text-fg-primary text-sm outline-0 focus:border-accent';
const label = 'mb-1 block font-medium text-fg-secondary text-xs';

const toPairs = (rec: unknown): Pair[] =>
  rec && typeof rec === 'object'
    ? Object.entries(rec as Record<string, unknown>).map(([key, value]) => ({
        key,
        value: String(value),
      }))
    : [];
const fromPairs = (pairs: Pair[]): Record<string, string> =>
  Object.fromEntries(pairs.filter((p) => p.key.trim()).map((p) => [p.key.trim(), p.value]));
const toList = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

type McpFormProps = {
  /** The server being edited, or null to create a new one. */
  server: McpServerItem | null;
  onDone: (id: string | null) => void;
  onCancel: () => void;
};

export function McpForm({ server, onDone, onCancel }: McpFormProps): React.JSX.Element {
  const { t } = useTranslation();
  const cfg = (server?.config ?? {}) as Record<string, unknown>;

  const [name, setName] = useState(server?.name ?? '');
  const [enabled, setEnabled] = useState(server?.enabled ?? true);
  const [transport, setTransport] = useState<'stdio' | 'http'>(
    !server || server.transport === 'stdio' ? 'stdio' : 'http',
  );

  // stdio
  const [command, setCommand] = useState(String(cfg.command ?? ''));
  const [args, setArgs] = useState<string[]>(toList(cfg.args));
  const [env, setEnv] = useState<Pair[]>([]);
  const [envPassthrough, setEnvPassthrough] = useState<string[]>(toList(cfg.envPassthrough));
  const [cwd, setCwd] = useState(String(cfg.cwd ?? ''));

  // http / sse
  const [url, setUrl] = useState(String(cfg.url ?? ''));
  const [bearerTokenEnvVar, setBearerTokenEnvVar] = useState(String(cfg.bearerTokenEnvVar ?? ''));
  const [headers, setHeaders] = useState<Pair[]>([]);
  const [headersFromEnv, setHeadersFromEnv] = useState<Pair[]>(toPairs(cfg.headersFromEnv));

  const [error, setError] = useState<string | null>(null);
  const utils = trpc.useUtils();

  // Editing an existing server: load its encrypted env/headers to prefill.
  useEffect(() => {
    if (!server) return;
    utils.mcp.getCredentials.fetch({ id: server.id }).then((s) => {
      setEnv(toPairs(s.env));
      setHeaders(toPairs(s.headers));
    });
  }, [server, utils]);

  const refresh = (id: string | null): void => {
    utils.mcp.list.invalidate();
    onDone(id);
  };
  const create = trpc.mcp.create.useMutation({
    onSuccess: (r) => refresh(r.id),
    onError: (e) => setError(e.message),
  });
  const update = trpc.mcp.update.useMutation({
    onSuccess: () => server && refresh(server.id),
    onError: (e) => setError(e.message),
  });

  const save = (): void => {
    setError(null);
    const isStdio = transport === 'stdio';
    const config = isStdio
      ? { command: command.trim(), args, envPassthrough, cwd: cwd.trim() || undefined }
      : {
          url: url.trim(),
          bearerTokenEnvVar: bearerTokenEnvVar.trim() || undefined,
          headersFromEnv: fromPairs(headersFromEnv),
        };
    const secrets = isStdio ? { env: fromPairs(env) } : { headers: fromPairs(headers) };
    const payload = { name: name.trim(), enabled, transport, config, secrets };
    if (server) update.mutate({ id: server.id, ...payload });
    else create.mutate(payload);
  };

  const saving = create.isPending || update.isPending;
  const valid = name.trim().length > 0 && (transport === 'stdio' ? command.trim() : url.trim());

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-6">
      <div>
        <span className={label}>{t('settings.mcp.name')}</span>
        <input
          className={input}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('settings.mcp.namePlaceholder')}
        />
      </div>

      <div className="flex rounded-lg border border-border-default p-0.5">
        {(['stdio', 'http'] as const).map((tr) => (
          <button
            key={tr}
            type="button"
            onClick={() => setTransport(tr)}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm ${
              transport === tr ? 'bg-surface-strong text-fg-primary' : 'text-fg-secondary'
            }`}
          >
            {t(tr === 'stdio' ? 'settings.mcp.stdio' : 'settings.mcp.http')}
          </button>
        ))}
      </div>

      {transport === 'stdio' ? (
        <>
          <div>
            <span className={label}>{t('settings.mcp.command')}</span>
            <input
              className={input}
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="npx -y @scope/server"
            />
          </div>
          <StrList
            listLabel={t('settings.mcp.args')}
            items={args}
            onChange={setArgs}
            addLabel={t('settings.mcp.addArg')}
          />
          <PairEditor
            listLabel={t('settings.mcp.env')}
            note={t('settings.mcp.envNote')}
            items={env}
            onChange={setEnv}
            addLabel={t('settings.mcp.addEnv')}
          />
          <StrList
            listLabel={t('settings.mcp.envPassthrough')}
            note={t('settings.mcp.envPassthroughNote')}
            items={envPassthrough}
            onChange={setEnvPassthrough}
            addLabel={t('settings.mcp.addVar')}
          />
          <div>
            <span className={label}>{t('settings.mcp.cwd')}</span>
            <input
              className={input}
              value={cwd}
              onChange={(e) => setCwd(e.target.value)}
              placeholder="~/code"
            />
          </div>
        </>
      ) : (
        <>
          <div>
            <span className={label}>{t('settings.mcp.url')}</span>
            <input
              className={input}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://mcp.example.com/mcp"
            />
          </div>
          <div>
            <span className={label}>{t('settings.mcp.bearerTokenEnvVar')}</span>
            <input
              className={input}
              value={bearerTokenEnvVar}
              onChange={(e) => setBearerTokenEnvVar(e.target.value)}
              placeholder="MCP_BEARER_TOKEN"
            />
          </div>
          <PairEditor
            listLabel={t('settings.mcp.headers')}
            note={t('settings.mcp.headersNote')}
            items={headers}
            onChange={setHeaders}
            addLabel={t('settings.mcp.addHeader')}
          />
          <PairEditor
            listLabel={t('settings.mcp.headersFromEnv')}
            note={t('settings.mcp.headersFromEnvNote')}
            items={headersFromEnv}
            onChange={setHeadersFromEnv}
            addLabel={t('settings.mcp.addVar')}
          />
        </>
      )}

      <label className="flex items-center gap-2 text-fg-secondary text-sm">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        {t('settings.mcp.enabled')}
      </label>

      {error && <p className="text-danger text-sm">{error}</p>}

      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          onClick={save}
          disabled={saving || !valid}
          className="rounded-md bg-accent px-3 py-1.5 text-fg-on-accent text-sm hover:bg-accent-hover disabled:opacity-40"
        >
          {server ? t('common.save') : t('common.create')}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md px-3 py-1.5 text-fg-secondary text-sm hover:bg-elevated"
        >
          {t('common.cancel')}
        </button>
      </div>
    </div>
  );
}

/** A growable list of single strings (args, passthrough var names). */
function StrList({
  listLabel,
  note,
  items,
  onChange,
  addLabel,
}: {
  listLabel: string;
  note?: string;
  items: string[];
  onChange: (next: string[]) => void;
  addLabel: string;
}): React.JSX.Element {
  const set = (i: number, v: string): void => onChange(items.map((x, j) => (j === i ? v : x)));
  const remove = (i: number): void => onChange(items.filter((_, j) => j !== i));
  return (
    <div>
      <span className={label}>{listLabel}</span>
      {note && <p className="mb-1.5 text-fg-tertiary text-xs">{note}</p>}
      <div className="flex flex-col gap-1.5">
        {items.map((item, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional, no stable id
          <div key={i} className="flex items-center gap-1.5">
            <input className={input} value={item} onChange={(e) => set(i, e.target.value)} />
            <RemoveButton onClick={() => remove(i)} />
          </div>
        ))}
      </div>
      <AddButton label={addLabel} onClick={() => onChange([...items, ''])} />
    </div>
  );
}

/** A growable list of key/value pairs (env, headers). */
function PairEditor({
  listLabel,
  note,
  items,
  onChange,
  addLabel,
}: {
  listLabel: string;
  note?: string;
  items: Pair[];
  onChange: (next: Pair[]) => void;
  addLabel: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const set = (i: number, p: Partial<Pair>): void =>
    onChange(items.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const remove = (i: number): void => onChange(items.filter((_, j) => j !== i));
  return (
    <div>
      <span className={label}>{listLabel}</span>
      {note && <p className="mb-1.5 text-fg-tertiary text-xs">{note}</p>}
      <div className="flex flex-col gap-1.5">
        {items.map((pair, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional, no stable id
          <div key={i} className="flex items-center gap-1.5">
            <input
              className={input}
              value={pair.key}
              onChange={(e) => set(i, { key: e.target.value })}
              placeholder={t('settings.mcp.key')}
            />
            <input
              className={input}
              value={pair.value}
              onChange={(e) => set(i, { value: e.target.value })}
              placeholder={t('settings.mcp.value')}
            />
            <RemoveButton onClick={() => remove(i)} />
          </div>
        ))}
      </div>
      <AddButton label={addLabel} onClick={() => onChange([...items, { key: '', value: '' }])} />
    </div>
  );
}

function AddButton({
  label: text,
  onClick,
}: {
  label: string;
  onClick: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-1.5 flex w-full items-center justify-center gap-1.5 rounded-md bg-elevated px-3 py-1.5 text-fg-secondary text-sm hover:bg-surface-strong"
    >
      <Plus className="size-3.5" />
      {text}
    </button>
  );
}

function RemoveButton({ onClick }: { onClick: () => void }): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="shrink-0 rounded-md p-2 text-fg-tertiary hover:bg-danger/10 hover:text-danger"
    >
      <Trash2 className="size-4" />
    </button>
  );
}
