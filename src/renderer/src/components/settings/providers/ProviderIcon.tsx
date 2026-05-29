import anthropicSvg from '@lobehub/icons-static-svg/icons/anthropic.svg?raw';
import claudecodeSvg from '@lobehub/icons-static-svg/icons/claudecode-color.svg?raw';
import codexSvg from '@lobehub/icons-static-svg/icons/codex-color.svg?raw';
import deepseekSvg from '@lobehub/icons-static-svg/icons/deepseek-color.svg?raw';
import geminiSvg from '@lobehub/icons-static-svg/icons/gemini-color.svg?raw';
import geminicliSvg from '@lobehub/icons-static-svg/icons/geminicli-color.svg?raw';
import kimiSvg from '@lobehub/icons-static-svg/icons/kimi-color.svg?raw';
import moonshotSvg from '@lobehub/icons-static-svg/icons/moonshot.svg?raw';
import openaiSvg from '@lobehub/icons-static-svg/icons/openai.svg?raw';
import zhipuSvg from '@lobehub/icons-static-svg/icons/zhipu-color.svg?raw';

/**
 * Brand icons sourced from @lobehub/icons-static-svg. Each SVG is sized
 * via `1em` and uses `currentColor` for the monochrome variants, so the
 * wrapper just controls font-size + color.
 *
 * Mapping is by provider id; unknown ids fall back to a letter tile so
 * custom providers added later still render something.
 */
const SVG_BY_ID: Record<string, string> = {
  anthropic: anthropicSvg,
  openai: openaiSvg,
  deepseek: deepseekSvg,
  google: geminiSvg,
  moonshot: moonshotSvg,
  'kimi-coding': kimiSvg,
  'zai-coding': zhipuSvg,
  'claude-code': claudecodeSvg,
  'codex-cli': codexSvg,
  'gemini-cli': geminicliSvg,
};

export function ProviderIcon({
  id,
  className = '',
}: {
  id: string;
  className?: string;
}): React.JSX.Element {
  const svg = SVG_BY_ID[id];
  if (!svg) {
    return (
      <span
        className={`grid place-items-center rounded-md bg-surface-strong font-mono font-semibold text-fg-secondary ${className}`}
      >
        {id.charAt(0).toUpperCase()}
      </span>
    );
  }
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center ${className}`}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: trusted static SVG bundled at build time
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
