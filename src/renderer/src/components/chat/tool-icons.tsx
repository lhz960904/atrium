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
import type { ToolKind } from '../../lib/chat-types';

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
