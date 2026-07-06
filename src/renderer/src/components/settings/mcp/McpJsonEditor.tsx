import { GitCompare } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { trpc } from '../../../lib/trpc';
import { CodeEditor } from '../../CodeEditor';
import { Select } from '../../Select';

// Sentinels so the import Select reads as an action menu, not a persisted choice.
const PICK = '__pick__';
const FILE = '__file__';
type ImportId = 'cursor' | 'claude-code' | 'claude-desktop' | 'codex';

/** Merge one client's `mcpServers` into the editor's, so imports add on top of the current set. */
function mergeMcpServers(currentText: string, importedText: string): string {
  const imported = (JSON.parse(importedText).mcpServers ?? {}) as Record<string, unknown>;
  const current = (JSON.parse(currentText).mcpServers ?? {}) as Record<string, unknown>;
  return JSON.stringify({ mcpServers: { ...current, ...imported } }, null, 2);
}

export function McpJsonEditor({ onClose }: { onClose: () => void }): React.JSX.Element {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const [text, setText] = useState('');
  // The last-loaded export — the "current config" side of the diff.
  const [baseline, setBaseline] = useState('');
  // On by default so manual edits surface as a live diff without any toggle;
  // the Compare button turns the change markers off to read the clean result.
  const [diffOn, setDiffOn] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const sources = trpc.mcp.importSources.useQuery();
  const importFileMut = trpc.mcp.importFile.useMutation();

  // The mount-time load must not clobber keystrokes typed while the fetch was
  // in flight (text would then equal baseline and the diff view shows nothing);
  // only the explicit reset button overwrites unconditionally.
  const loadExport = useCallback(
    (overwrite: boolean) => {
      void utils.mcp.exportJson.fetch().then((r) => {
        setText((cur) => (overwrite || cur === '' ? r.json : cur));
        setBaseline(r.json);
      });
    },
    [utils],
  );

  useEffect(() => loadExport(false), [loadExport]);

  // Debounce edits before asking the server to validate + report dropped fields.
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setDebounced(text), 300);
    return () => clearTimeout(id);
  }, [text]);

  const preview = trpc.mcp.previewJson.useQuery(
    { json: debounced },
    { enabled: debounced.trim().length > 0 },
  );

  const apply = trpc.mcp.applyJson.useMutation({
    onError: (e) => setError(e.message),
    onSuccess: () => {
      void utils.mcp.list.invalidate();
      void utils.mcp.attention.invalidate();
      onClose();
    },
  });

  const mergeIn = (json: string): void => {
    // Merging needs to parse the editor's text; surface a plain instruction
    // instead of the raw JSON.parse error when the user's draft is invalid.
    try {
      JSON.parse(text);
    } catch {
      setError(t('settings.mcp.json.fixJsonFirst'));
      return;
    }
    setText(mergeMcpServers(text, json));
    setDiffOn(true);
  };

  const importFrom = async (source: ImportId) => {
    setError(null);
    try {
      mergeIn((await utils.mcp.readImport.fetch({ source })).json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed.');
    }
  };

  const importFile = async () => {
    setError(null);
    try {
      const { json } = await importFileMut.mutateAsync();
      if (json) mergeIn(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed.');
    }
  };

  const p = preview.data;
  const parseError = p && !p.valid ? (p.error ?? 'Invalid JSON') : null;
  const warnings = p?.warnings ?? [];
  // Only offer clients that actually have servers; a file pick is always available.
  const importable = sources.data?.filter((s) => s.available && s.count > 0) ?? [];
  const importOptions = [
    { value: PICK, label: t('settings.mcp.json.importFrom') },
    ...importable.map((s) => ({ value: s.id, label: `${s.label} (${s.count})` })),
    { value: FILE, label: t('settings.mcp.json.fromFile') },
  ];

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setDiffOn((v) => !v)}
          className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm ${
            diffOn
              ? 'border-accent bg-accent/10 text-accent'
              : 'border-border-default text-fg-secondary hover:bg-elevated'
          }`}
        >
          <GitCompare className="size-4" />
          {t('settings.mcp.json.diffToggle')}
        </button>
        <div className="flex-1" />
        <Select
          value={PICK}
          onChange={(v) => {
            if (v === FILE) void importFile();
            else if (v !== PICK) void importFrom(v as ImportId);
          }}
          options={importOptions}
          aria-label={t('settings.mcp.json.importFrom')}
          className="min-w-[160px]"
        />
      </div>

      <CodeEditor
        value={text}
        onChange={(v) => {
          setText(v);
          setError(null);
        }}
        language="json"
        original={baseline}
        diff={diffOn}
        className="min-h-0 flex-1 overflow-hidden rounded-lg border border-border-default bg-surface"
      />

      {warnings.length > 0 && (
        <div className="max-h-20 shrink-0 overflow-y-auto rounded-md bg-elevated px-3 py-2">
          <p className="mb-1 font-medium text-fg-secondary text-xs">
            {t('settings.mcp.json.notes')}
          </p>
          <ul className="flex flex-col gap-0.5">
            {warnings.map((w) => (
              <li key={w} className="text-fg-tertiary text-xs">
                {w}
              </li>
            ))}
          </ul>
        </div>
      )}

      {(error || parseError) && <p className="text-danger text-sm">{error ?? parseError}</p>}

      <div className="flex shrink-0 items-center gap-3">
        <button
          type="button"
          onClick={() => loadExport(true)}
          className="cursor-pointer rounded-md px-3 py-1.5 text-accent text-sm hover:bg-elevated"
        >
          {t('settings.mcp.json.reset')}
        </button>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onClose}
          className="cursor-pointer rounded-md px-3 py-1.5 text-fg-secondary text-sm hover:bg-elevated"
        >
          {t('common.cancel')}
        </button>
        <button
          type="button"
          onClick={() => apply.mutate({ json: text })}
          disabled={apply.isPending || !p || !p.valid}
          className="cursor-pointer rounded-md bg-accent px-3 py-1.5 text-fg-on-accent text-sm hover:bg-accent-hover disabled:cursor-default disabled:opacity-40"
        >
          {apply.isPending ? t('settings.mcp.json.applying') : t('settings.mcp.json.apply')}
        </button>
      </div>
    </div>
  );
}
