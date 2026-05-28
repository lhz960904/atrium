import type { ToolKind } from '@shared/chat-types';
import {
  Atom,
  FilePen,
  FileText,
  Globe,
  type LucideIcon,
  Search,
  Terminal,
  Wrench,
} from 'lucide-react';

export const TOOL_ICONS: Record<ToolKind, LucideIcon> = {
  shell: Terminal,
  'file-read': FileText,
  'file-write': FilePen,
  'file-edit': FilePen,
  grep: Search,
  glob: Search,
  'web-search': Search,
  'web-fetch': Globe,
  task: Atom,
  other: Wrench,
};
