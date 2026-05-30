import { FileCode } from 'lucide-react';
import { Highlight, themes } from 'prism-react-renderer';
import type { IconType } from 'react-icons';
import {
  SiC,
  SiCplusplus,
  SiCss,
  SiDocker,
  SiGnubash,
  SiGo,
  SiGraphql,
  SiHtml5,
  SiJavascript,
  SiJson,
  SiKotlin,
  SiMarkdown,
  SiPhp,
  SiPython,
  SiReact,
  SiRuby,
  SiRust,
  SiSwift,
  SiTypescript,
  SiYaml,
} from 'react-icons/si';
import { useThemeStore } from '../../state/theme-store';
import { CopyButton } from './CopyButton';

// Brand glyph per language (keyed by the fence's language id + common aliases).
const LANG_ICONS: Record<string, IconType> = {
  python: SiPython,
  py: SiPython,
  javascript: SiJavascript,
  js: SiJavascript,
  typescript: SiTypescript,
  ts: SiTypescript,
  jsx: SiReact,
  tsx: SiReact,
  react: SiReact,
  css: SiCss,
  html: SiHtml5,
  json: SiJson,
  bash: SiGnubash,
  sh: SiGnubash,
  shell: SiGnubash,
  zsh: SiGnubash,
  rust: SiRust,
  rs: SiRust,
  go: SiGo,
  ruby: SiRuby,
  rb: SiRuby,
  php: SiPhp,
  markdown: SiMarkdown,
  md: SiMarkdown,
  yaml: SiYaml,
  yml: SiYaml,
  c: SiC,
  cpp: SiCplusplus,
  graphql: SiGraphql,
  swift: SiSwift,
  kotlin: SiKotlin,
  kt: SiKotlin,
  docker: SiDocker,
  dockerfile: SiDocker,
};

/**
 * Fenced code block: Prism highlighting (synchronous, no wasm — reliable in
 * Electron) on our own code surface, with a header showing the language (brand
 * glyph + name) and a copy button.
 */
export function CodeBlock({ code, lang }: { code: string; lang: string }): React.JSX.Element {
  const dark = useThemeStore((s) => s.resolvedTheme === 'dark');
  const Icon = LANG_ICONS[lang] ?? FileCode;

  return (
    <div className="my-3 overflow-hidden rounded-lg border border-border-default">
      <div className="flex items-center justify-between bg-surface px-3 py-1.5 text-fg-tertiary text-xs">
        <span className="flex items-center gap-1.5">
          <Icon className="size-3.5" />
          {lang}
        </span>
        <CopyButton text={code} />
      </div>
      <Highlight code={code} language={lang} theme={dark ? themes.vsDark : themes.github}>
        {({ tokens, getLineProps, getTokenProps }) => (
          <pre className="overflow-x-auto bg-code-bg p-4 font-mono text-sm leading-relaxed">
            {tokens.map((line, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: lines have no stable id
              <div key={i} {...getLineProps({ line })}>
                {line.map((token, k) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: tokens have no stable id
                  <span key={k} {...getTokenProps({ token })} />
                ))}
              </div>
            ))}
          </pre>
        )}
      </Highlight>
    </div>
  );
}
