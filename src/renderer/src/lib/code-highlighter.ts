import bash from '@shikijs/langs/bash';
import c from '@shikijs/langs/c';
import cpp from '@shikijs/langs/cpp';
import css from '@shikijs/langs/css';
import diff from '@shikijs/langs/diff';
import docker from '@shikijs/langs/docker';
import go from '@shikijs/langs/go';
import graphql from '@shikijs/langs/graphql';
import html from '@shikijs/langs/html';
import java from '@shikijs/langs/java';
import javascript from '@shikijs/langs/javascript';
import json from '@shikijs/langs/json';
import jsonc from '@shikijs/langs/jsonc';
import jsx from '@shikijs/langs/jsx';
import kotlin from '@shikijs/langs/kotlin';
import markdown from '@shikijs/langs/markdown';
import php from '@shikijs/langs/php';
import python from '@shikijs/langs/python';
import ruby from '@shikijs/langs/ruby';
import rust from '@shikijs/langs/rust';
import scss from '@shikijs/langs/scss';
import sql from '@shikijs/langs/sql';
import swift from '@shikijs/langs/swift';
import toml from '@shikijs/langs/toml';
import tsx from '@shikijs/langs/tsx';
import typescript from '@shikijs/langs/typescript';
import xml from '@shikijs/langs/xml';
import yaml from '@shikijs/langs/yaml';
import darkPlus from '@shikijs/themes/dark-plus';
import githubLight from '@shikijs/themes/github-light';
import { createHighlighterCoreSync } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';

/**
 * One synchronous Shiki highlighter for the whole renderer. Built with the JS
 * RegExp engine + a curated, fine-grained set of languages/themes so the module
 * is created *synchronously* at import — no async load, no first-paint flash,
 * and no wasm. `codeToTokens` is then a plain sync call, streaming-friendly.
 *
 * Languages outside this set fall back to plaintext (see resolveLang). Adding
 * one is a two-line import here; a lazy on-demand loader can come later if the
 * long tail matters.
 */
export const LIGHT_THEME = 'github-light';
export const DARK_THEME = 'dark-plus';

export const highlighter = createHighlighterCoreSync({
  // forgiving: skip a grammar regex the JS engine can't translate instead of
  // throwing mid-render — a rare token loses color, the block still renders.
  engine: createJavaScriptRegexEngine({ forgiving: true }),
  themes: [githubLight, darkPlus],
  langs: [
    typescript,
    javascript,
    jsx,
    tsx,
    python,
    css,
    scss,
    html,
    json,
    jsonc,
    bash,
    rust,
    go,
    ruby,
    php,
    markdown,
    yaml,
    c,
    cpp,
    graphql,
    swift,
    kotlin,
    docker,
    java,
    sql,
    toml,
    diff,
    xml,
  ],
});

const loaded = new Set(highlighter.getLoadedLanguages());

/** Map a fence's language id (or alias) to a loaded grammar, else plaintext. */
export function resolveLang(lang: string): string {
  return loaded.has(lang) ? lang : 'text';
}
