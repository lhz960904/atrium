import type { ToolName } from '@shared/tools';
import type { ParseKeys, TFunction } from 'i18next';
import {
  Bot,
  Brain,
  CalendarClock,
  CalendarX,
  FilePen,
  FilePenLine,
  FileSearch,
  FileText,
  FolderTree,
  Globe,
  Handshake,
  Image as ImageIcon,
  type LucideIcon,
  OctagonX,
  ScrollText,
  Search,
  Sparkles,
  Terminal,
  TextSearch,
  Trash2,
  Wrench,
} from 'lucide-react';

/**
 * Tools that render as a single-line trace marker. Excluded: `todo_write` (its
 * plan renders in the composer-level plan panel) and `ask_clarification` (it
 * renders as a ClarifyCard in the message flow, not a trace marker).
 */
export type MarkerToolName = Exclude<ToolName, 'todo_write' | 'ask_clarification'>;

/** The input fields the presentation reads to build a tool's labels. */
export type ToolInput = {
  path?: string;
  command?: string;
  url?: string;
  query?: string;
  description?: string;
  subagent?: string;
  name?: string;
  prompt?: string;
  shell_id?: string;
  pattern?: string;
  title?: string;
  id?: string;
};

const hostname = (u?: string): string => {
  if (!u) return '';
  try {
    return new URL(u).hostname;
  } catch {
    return u;
  }
};

export type ToolPresentation = {
  icon: LucideIcon;
  /** Catalog key for the past-tense verb, shown once the call has settled (e.g. "Read"). */
  verbKey: ParseKeys;
  /** Catalog key for the present-continuous verb, shown while the call runs (e.g. "Reading"). */
  verbActiveKey: ParseKeys;
  target: (i: ToolInput, t: TFunction) => string;
  typeLabel: (i: ToolInput, t: TFunction) => string;
  /** Shell-style tools surface a `$ command` line in the expanded card. */
  command?: (i: ToolInput) => string | undefined;
};

const basename = (p?: string): string => (p ? (p.split('/').filter(Boolean).pop() ?? p) : '');

/**
 * How each built-in tool shows in the trace — icon, verb, labels. Keyed by
 * ToolName, so adding a tool to the shared name contract forces an entry here.
 * This is the one place to maintain tool display.
 */
export const TOOL_PRESENTATION: Record<MarkerToolName, ToolPresentation> = {
  read_file: {
    icon: FileText,
    verbKey: 'tool.verb.read',
    verbActiveKey: 'tool.verbActive.read',
    target: (i) => basename(i.path),
    typeLabel: (i, t) => t('tool.type.file', { path: i.path ?? '' }),
  },
  write_file: {
    icon: FilePen,
    verbKey: 'tool.verb.write',
    verbActiveKey: 'tool.verbActive.write',
    target: (i) => basename(i.path),
    typeLabel: (i, t) => t('tool.type.file', { path: i.path ?? '' }),
  },
  edit_file: {
    icon: FilePenLine,
    verbKey: 'tool.verb.edit',
    verbActiveKey: 'tool.verbActive.edit',
    target: (i) => basename(i.path),
    typeLabel: (i, t) => t('tool.type.file', { path: i.path ?? '' }),
  },
  list_dir: {
    icon: FolderTree,
    verbKey: 'tool.verb.list',
    verbActiveKey: 'tool.verbActive.list',
    target: (i) => basename(i.path) || 'workspace',
    typeLabel: (i, t) => t('tool.type.directory', { path: i.path ?? '.' }),
  },
  grep: {
    icon: TextSearch,
    verbKey: 'tool.verb.searchGrep',
    verbActiveKey: 'tool.verbActive.searchGrep',
    target: (i) => i.pattern ?? '',
    typeLabel: (i, t) => t('tool.type.grep', { path: i.path ?? t('tool.workspace') }),
  },
  glob: {
    icon: FileSearch,
    verbKey: 'tool.verb.findFiles',
    verbActiveKey: 'tool.verbActive.findFiles',
    target: (i) => i.pattern ?? '',
    typeLabel: (i, t) => t('tool.type.glob', { path: i.path ?? t('tool.workspace') }),
  },
  bash: {
    icon: Terminal,
    verbKey: 'tool.verb.run',
    verbActiveKey: 'tool.verbActive.run',
    target: (i) => i.command ?? '',
    typeLabel: (_i, t) => t('tool.type.shell'),
    command: (i) => i.command,
  },
  bash_output: {
    icon: ScrollText,
    verbKey: 'tool.verb.readOutput',
    verbActiveKey: 'tool.verbActive.readOutput',
    target: (i) => i.shell_id ?? '',
    typeLabel: (i, t) => t('tool.type.bgShell', { id: i.shell_id ?? '' }),
  },
  kill_shell: {
    icon: OctagonX,
    verbKey: 'tool.verb.stop',
    verbActiveKey: 'tool.verbActive.stop',
    target: (i) => i.shell_id ?? '',
    typeLabel: (i, t) => t('tool.type.bgShell', { id: i.shell_id ?? '' }),
  },
  web_fetch: {
    icon: Globe,
    verbKey: 'tool.verb.fetch',
    verbActiveKey: 'tool.verbActive.fetch',
    target: (i) => hostname(i.url),
    typeLabel: (i, t) => t('tool.type.web', { url: i.url ?? '' }),
  },
  web_search: {
    icon: Search,
    verbKey: 'tool.verb.searchWeb',
    verbActiveKey: 'tool.verbActive.searchWeb',
    target: (i) => i.query ?? '',
    typeLabel: (_i, t) => t('tool.type.webSearch'),
  },
  task: {
    icon: Bot,
    verbKey: 'tool.verb.delegate',
    verbActiveKey: 'tool.verbActive.delegate',
    target: (i) => i.description ?? i.subagent ?? 'subagent',
    typeLabel: (i, t) => t('tool.type.subagent', { name: i.subagent ?? 'general-purpose' }),
  },
  skill: {
    icon: Sparkles,
    verbKey: 'tool.verb.useSkill',
    verbActiveKey: 'tool.verbActive.useSkill',
    target: (i) => i.name ?? '',
    typeLabel: (i, t) => t('tool.type.skill', { name: i.name ?? '' }),
  },
  image_gen: {
    icon: ImageIcon,
    verbKey: 'tool.verb.genImage',
    verbActiveKey: 'tool.verbActive.genImage',
    target: (i) => i.prompt ?? '',
    typeLabel: (_i, t) => t('tool.type.image'),
  },
  memory: {
    icon: Brain,
    verbKey: 'tool.verb.memory',
    verbActiveKey: 'tool.verbActive.memory',
    target: (i, t) =>
      t(
        i.command === 'write'
          ? 'tool.memory.write'
          : i.command === 'delete'
            ? 'tool.memory.delete'
            : 'tool.memory.view',
      ),
    typeLabel: (_i, t) => t('tool.type.memory'),
  },
  profile: {
    icon: Handshake,
    verbKey: 'tool.verb.profile',
    verbActiveKey: 'tool.verbActive.profile',
    target: (i, t) => t(i.command === 'write' ? 'tool.profile.write' : 'tool.profile.view'),
    typeLabel: (_i, t) => t('tool.type.profile'),
  },
  schedule_create: {
    icon: CalendarClock,
    verbKey: 'tool.verb.schedule',
    verbActiveKey: 'tool.verbActive.schedule',
    target: (i) => i.title ?? '',
    typeLabel: (_i, t) => t('tool.type.scheduled'),
  },
  schedule_list: {
    icon: CalendarClock,
    verbKey: 'tool.verb.list',
    verbActiveKey: 'tool.verbActive.list',
    target: () => '',
    typeLabel: (_i, t) => t('tool.type.scheduled'),
  },
  schedule_update: {
    icon: CalendarClock,
    verbKey: 'tool.verb.edit',
    verbActiveKey: 'tool.verbActive.edit',
    target: (i) => i.title ?? '',
    typeLabel: (_i, t) => t('tool.type.scheduled'),
  },
  schedule_cancel: {
    icon: CalendarX,
    verbKey: 'tool.verb.cancel',
    verbActiveKey: 'tool.verbActive.cancel',
    target: (i) => i.title ?? '',
    typeLabel: (_i, t) => t('tool.type.scheduled'),
  },
};

/**
 * Icons for an external agent's tools, keyed by ACP tool kind (read/edit/…).
 * External agents bring arbitrary tools, so they render as dynamic parts whose
 * name is the ACP kind rather than a built-in ToolName.
 */
const ACP_KIND_ICON: Record<string, LucideIcon> = {
  read: FileText,
  edit: FilePenLine,
  delete: Trash2,
  move: FolderTree,
  search: Search,
  execute: Terminal,
  think: Sparkles,
  fetch: Globe,
};

/** Resolve a tool's icon by name: a built-in tool, else an ACP kind, else generic. */
export function toolIcon(name: string): LucideIcon {
  return TOOL_PRESENTATION[name as MarkerToolName]?.icon ?? ACP_KIND_ICON[name] ?? Wrench;
}
