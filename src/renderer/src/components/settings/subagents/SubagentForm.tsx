import { useState } from 'react';
import { trpc } from '../../../lib/trpc';
import type { ModelGroup } from '../../../lib/use-chat-model';
import { ModelPicker, type ModelValue } from '../../ModelPicker';

export type SubagentItem = {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  toolAllow: string[] | null;
  toolDeny: string[] | null;
  providerId: string | null;
  modelId: string | null;
  builtin: boolean;
};

type SubagentFormProps = {
  /** The custom subagent being edited, or null to create a new one. */
  subagent: SubagentItem | null;
  groups: ModelGroup[];
  assignableTools: string[];
  /** After a successful save — parent refreshes the list and exits edit mode. */
  onDone: (selectId: string | null) => void;
  /** Discard without saving — back to the read-only view (or deselect on new). */
  onCancel: () => void;
};

const input =
  'w-full rounded-lg border border-border-default bg-surface px-3 py-2 text-fg-primary text-sm outline-0 focus:border-accent';
const label = 'mb-1 block font-medium text-fg-secondary text-xs';

const initialModel = (s: SubagentItem | null): ModelValue =>
  s?.providerId && s.modelId ? { providerId: s.providerId, modelId: s.modelId } : null;

export function SubagentForm({
  subagent,
  groups,
  assignableTools,
  onDone,
  onCancel,
}: SubagentFormProps): React.JSX.Element {
  const [name, setName] = useState(subagent?.name ?? '');
  const [description, setDescription] = useState(subagent?.description ?? '');
  const [systemPrompt, setSystemPrompt] = useState(subagent?.systemPrompt ?? '');
  const [restrict, setRestrict] = useState(subagent?.toolAllow != null);
  const [allowed, setAllowed] = useState<Set<string>>(new Set(subagent?.toolAllow ?? []));
  const [model, setModel] = useState<ModelValue>(initialModel(subagent));
  const [error, setError] = useState<string | null>(null);

  const utils = trpc.useUtils();
  const refresh = (selectId: string | null): void => {
    utils.subagents.list.invalidate();
    onDone(selectId);
  };
  const create = trpc.subagents.create.useMutation({
    onSuccess: (r) => refresh(r.id),
    onError: (e) => setError(e.message),
  });
  const update = trpc.subagents.update.useMutation({
    onSuccess: () => subagent && refresh(subagent.id),
    onError: (e) => setError(e.message),
  });

  const toggleTool = (tool: string): void =>
    setAllowed((prev) => {
      const next = new Set(prev);
      if (next.has(tool)) next.delete(tool);
      else next.add(tool);
      return next;
    });

  const save = (): void => {
    setError(null);
    const payload = {
      name: name.trim(),
      description,
      systemPrompt,
      toolAllow: restrict ? [...allowed] : null,
      toolDeny: null,
      providerId: model?.providerId ?? null,
      modelId: model?.modelId ?? null,
    };
    if (subagent) update.mutate({ id: subagent.id, ...payload });
    else create.mutate(payload);
  };

  const saving = create.isPending || update.isPending;

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-6">
      <div>
        <span className={label}>名称</span>
        <input
          className={input}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例如 code-reviewer"
        />
      </div>
      <div>
        <span className={label}>描述（主 agent 据此决定何时委派）</span>
        <textarea
          className={`${input} min-h-[60px] resize-y`}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <div>
        <span className={label}>System prompt</span>
        <textarea
          className={`${input} min-h-[160px] resize-y font-mono text-xs`}
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
        />
      </div>

      <div>
        <label className="flex items-center gap-2 text-fg-secondary text-sm">
          <input
            type="checkbox"
            checked={restrict}
            onChange={(e) => setRestrict(e.target.checked)}
          />
          限制可用工具（默认继承主 agent 的全部工具）
        </label>
        {restrict && (
          <div className="mt-2 flex flex-wrap gap-2">
            {assignableTools.map((tool) => (
              <label
                key={tool}
                className="flex items-center gap-1.5 rounded-md border border-border-default px-2 py-1 text-fg-secondary text-xs"
              >
                <input
                  type="checkbox"
                  checked={allowed.has(tool)}
                  onChange={() => toggleTool(tool)}
                />
                {tool}
              </label>
            ))}
          </div>
        )}
      </div>

      <div>
        <span className={label}>承接模型</span>
        <ModelPicker
          value={model}
          onChange={setModel}
          groups={groups}
          variant="field"
          inheritLabel="继承主对话模型"
        />
      </div>

      {error && <p className="text-danger text-sm">{error}</p>}

      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          onClick={save}
          disabled={saving || name.trim().length === 0}
          className="rounded-md bg-accent px-3 py-1.5 text-fg-on-accent text-sm hover:bg-accent-hover disabled:opacity-40"
        >
          {subagent ? '保存' : '创建'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md px-3 py-1.5 text-fg-secondary text-sm hover:bg-elevated"
        >
          取消
        </button>
      </div>
    </div>
  );
}
