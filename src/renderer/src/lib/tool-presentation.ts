import type { ToolName } from '@shared/tools';
import {
  Bot,
  FilePen,
  FilePenLine,
  FileSearch,
  FileText,
  FolderTree,
  Globe,
  Image as ImageIcon,
  type LucideIcon,
  OctagonX,
  ScrollText,
  Search,
  Sparkles,
  Terminal,
  TextSearch,
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
  /** Past tense, shown once the call has settled (e.g. "Read"). */
  verb: string;
  /** Present continuous, shown while the call is running (e.g. "Reading"). */
  verbActive: string;
  target: (i: ToolInput) => string;
  typeLabel: (i: ToolInput) => string;
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
    verb: 'Read',
    verbActive: 'Reading',
    target: (i) => basename(i.path),
    typeLabel: (i) => `File · ${i.path ?? ''}`,
  },
  write_file: {
    icon: FilePen,
    verb: 'Wrote',
    verbActive: 'Writing',
    target: (i) => basename(i.path),
    typeLabel: (i) => `File · ${i.path ?? ''}`,
  },
  edit_file: {
    icon: FilePenLine,
    verb: 'Edited',
    verbActive: 'Editing',
    target: (i) => basename(i.path),
    typeLabel: (i) => `File · ${i.path ?? ''}`,
  },
  list_dir: {
    icon: FolderTree,
    verb: 'Listed',
    verbActive: 'Listing',
    target: (i) => basename(i.path) || 'workspace',
    typeLabel: (i) => `Directory · ${i.path ?? '.'}`,
  },
  grep: {
    icon: TextSearch,
    verb: 'Searched',
    verbActive: 'Searching',
    target: (i) => i.pattern ?? '',
    typeLabel: (i) => `Grep · ${i.path ?? 'workspace'}`,
  },
  glob: {
    icon: FileSearch,
    verb: 'Found files',
    verbActive: 'Finding files',
    target: (i) => i.pattern ?? '',
    typeLabel: (i) => `Glob · ${i.path ?? 'workspace'}`,
  },
  bash: {
    icon: Terminal,
    verb: 'Ran',
    verbActive: 'Running',
    target: (i) => i.command ?? '',
    typeLabel: () => 'Shell',
    command: (i) => i.command,
  },
  bash_output: {
    icon: ScrollText,
    verb: 'Read output',
    verbActive: 'Reading output',
    target: (i) => i.shell_id ?? '',
    typeLabel: (i) => `Background shell · ${i.shell_id ?? ''}`,
  },
  kill_shell: {
    icon: OctagonX,
    verb: 'Stopped',
    verbActive: 'Stopping',
    target: (i) => i.shell_id ?? '',
    typeLabel: (i) => `Background shell · ${i.shell_id ?? ''}`,
  },
  web_fetch: {
    icon: Globe,
    verb: 'Fetched',
    verbActive: 'Fetching',
    target: (i) => hostname(i.url),
    typeLabel: (i) => `Web · ${i.url ?? ''}`,
  },
  web_search: {
    icon: Search,
    verb: 'Searched',
    verbActive: 'Searching',
    target: (i) => i.query ?? '',
    typeLabel: () => 'Web search',
  },
  task: {
    icon: Bot,
    verb: 'Delegated',
    verbActive: 'Delegating',
    target: (i) => i.description ?? i.subagent ?? 'subagent',
    typeLabel: (i) => `Subagent · ${i.subagent ?? 'general-purpose'}`,
  },
  skill: {
    icon: Sparkles,
    verb: 'Used skill',
    verbActive: 'Using skill',
    target: (i) => i.name ?? '',
    typeLabel: (i) => `Skill · ${i.name ?? ''}`,
  },
  image_gen: {
    icon: ImageIcon,
    verb: 'Generated image',
    verbActive: 'Generating image',
    target: (i) => i.prompt ?? '',
    typeLabel: () => 'Image',
  },
};
