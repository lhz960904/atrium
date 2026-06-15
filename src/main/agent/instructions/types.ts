export type InstructionKind = 'agents' | 'claude';
export type InstructionScope = 'global' | 'project';

export type InstructionFile = {
  path: string;
  kind: InstructionKind;
  scope: InstructionScope;
  content: string;
};

// Same-directory tie-break: AGENTS wins. Order is the only knob.
export const KIND_BY_PRIORITY: { file: string; kind: InstructionKind }[] = [
  { file: 'AGENTS.md', kind: 'agents' },
  { file: 'CLAUDE.md', kind: 'claude' },
];

export const INSTRUCTION_MAX_BYTES = 32 * 1024;
