/** Friendly label for a skill's source — the ecosystem it was discovered in. */
const SOURCE_LABEL: Record<string, string> = {
  builtin: 'Built-in',
  agents: 'Agents',
  claude: 'Claude',
  codex: 'Codex',
};

export function skillSourceLabel(source: string): string {
  return SOURCE_LABEL[source] ?? source;
}
