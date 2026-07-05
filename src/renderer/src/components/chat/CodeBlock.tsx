import { ShikiStreamTokenizer } from '@shikijs/stream';
import { FileCode } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
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
import { getTokenStyleObject, type ThemedToken } from 'shiki';
import { DARK_THEME, highlighter, LIGHT_THEME, resolveLang } from '../../lib/code-highlighter';
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
 * Fenced code block: Shiki highlighting on our own code surface, with a header
 * (language glyph + name) and a copy button.
 *
 * Streaming is handled by @shikijs/stream's tokenizer: each render feeds only
 * the newly-appended text (`enqueue(delta)`), and the tokenizer keeps its own
 * stable/unstable token split — including "recall" corrections when later text
 * changes how earlier text should be coloured. One tokenizer per block keeps its
 * grammar state isolated (a shared highlighter tokenized directly is order-
 * dependent across blocks); enqueue is async, so calls are chained to stay in
 * order. Newlines live inside token content, so the flat span list lays out
 * correctly under `white-space: pre`.
 */
export function CodeBlock({ code, lang }: { code: string; lang: string }): React.JSX.Element {
  const dark = useThemeStore((s) => s.resolvedTheme === 'dark');
  const Icon = LANG_ICONS[lang] ?? FileCode;
  const langId = resolveLang(lang);
  const theme = dark ? DARK_THEME : LIGHT_THEME;

  const [tokens, setTokens] = useState<ThemedToken[]>([]);
  const stream = useRef<{
    tokenizer: ShikiStreamTokenizer;
    fed: string;
    key: string;
    chain: Promise<void>;
  } | null>(null);

  useEffect(() => {
    const key = `${langId}|${theme}`;
    let s = stream.current;
    // Rebuild on a language/theme change or when `code` isn't an append of what
    // we've fed (an edit, or a reused component now showing a different block).
    if (!s || s.key !== key || !code.startsWith(s.fed)) {
      s = stream.current = {
        tokenizer: new ShikiStreamTokenizer({ highlighter, lang: langId, theme }),
        fed: '',
        key,
        chain: Promise.resolve(),
      };
      setTokens([]);
    }
    const delta = code.slice(s.fed.length);
    s.fed = code;
    if (!delta) return;
    const tk = s.tokenizer;
    s.chain = s.chain.then(async () => {
      await tk.enqueue(delta);
      // A theme/lang change may have swapped the tokenizer while awaiting — only
      // the current one publishes.
      if (stream.current?.tokenizer === tk) setTokens([...tk.tokensStable, ...tk.tokensUnstable]);
    });
  }, [code, langId, theme]);

  return (
    <div className="my-3 overflow-hidden rounded-lg border border-border-default">
      <div className="flex items-center justify-between bg-surface px-3 py-1.5 text-fg-tertiary text-xs">
        <span className="flex items-center gap-1.5">
          <Icon className="size-3.5" />
          {lang}
        </span>
        <CopyButton text={code} />
      </div>
      <pre className="overflow-x-auto bg-code-bg p-4 font-mono text-sm leading-relaxed">
        <code>
          {tokens.map((token, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: token stream has no stable id
            <span key={i} style={token.htmlStyle ?? getTokenStyleObject(token)}>
              {token.content}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}
