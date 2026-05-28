import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/settings/$section')({
  component: SectionView,
});

const SECTION_TITLES: Record<string, string> = {
  general: 'General',
  appearance: 'Appearance',
  providers: 'Providers',
  subagents: 'Subagents',
  permissions: 'Permissions',
  memories: 'Memories',
  about: 'About',
};

function SectionView(): React.JSX.Element {
  const { section } = Route.useParams();
  const title = SECTION_TITLES[section] ?? section;

  return (
    <div className="px-10 py-8">
      <h1 className="mb-2 text-2xl font-semibold tracking-tight text-fg-primary">{title}</h1>
      <p className="text-sm text-fg-tertiary">
        Section{' '}
        <code className="rounded bg-elevated px-1.5 py-0.5 font-mono text-xs">{section}</code> ·
        内容待 Step 1.5 / Step 4 实装
      </p>
    </div>
  );
}
