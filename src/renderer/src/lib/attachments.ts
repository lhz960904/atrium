// What we accept as a message attachment, and how each maps to a media type the
// model can use. One allowlist drives both the picker (`accept`) and the
// post-pick validation, so the two can't drift.

// Raster image formats (extension → media type) the vision APIs accept; any
// other image type 400s, so it's not here.
const IMAGE_MEDIA: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};
const IMAGE_TYPES = new Set(Object.values(IMAGE_MEDIA));

// Text/code/data extensions we read as text — the OS often doesn't type these
// as text/* (e.g. .ts, .json, .svg). Any file the OS *does* type as text/* is
// also accepted even if its extension isn't listed.
const TEXT_EXT = new Set([
  'md',
  'markdown',
  'svg',
  'json',
  'jsonc',
  'csv',
  'tsv',
  'xml',
  'yaml',
  'yml',
  'toml',
  'ini',
  'env',
  'log',
  'html',
  'css',
  'scss',
  'less',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'ts',
  'tsx',
  'py',
  'rb',
  'go',
  'rs',
  'java',
  'kt',
  'swift',
  'c',
  'h',
  'cpp',
  'cc',
  'cs',
  'php',
  'sh',
  'bash',
  'zsh',
  'sql',
  'vue',
  'svelte',
  'dart',
  'lua',
  'gql',
  'graphql',
  'proto',
]);

/**
 * The `accept` allowlist for the file picker so the OS greys out unsupported
 * files. Derived from the same sets classifyAttachment uses; `text/*` lets the
 * OS offer any file it recognises as text even if its extension isn't listed.
 */
export const ATTACHMENT_ACCEPT = [
  ...IMAGE_TYPES,
  'application/pdf',
  'text/*',
  ...[...TEXT_EXT].map((e) => `.${e}`),
].join(',');

/**
 * Classify a picked file into a media type the model accepts, or null to skip
 * it. Raster images go multimodal; PDFs as documents; text/code/svg/markdown is
 * read as text — SVG in particular is more useful as its XML source than a
 * rejected image. Anything else (office docs, media, archives…) is skipped.
 */
export function classifyAttachment(file: File): string | null {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (ext in IMAGE_MEDIA) return IMAGE_MEDIA[ext];
  if (IMAGE_TYPES.has(file.type)) return file.type;
  if (ext === 'pdf' || file.type === 'application/pdf') return 'application/pdf';
  if (TEXT_EXT.has(ext) || file.type.startsWith('text/')) return 'text/plain';
  return null;
}

/**
 * Pull File objects out of a paste's ClipboardData or a drop's DataTransfer.
 * Prefers `.files` (populated for pasted/dropped files); falls back to the item
 * list for sources that only surface a file item (some image pastes). Returns
 * [] when the transfer carries no files — a plain text/HTML paste — so the caller
 * can let the default paste proceed.
 */
export function filesFromTransfer(data: DataTransfer | null): File[] {
  if (!data) return [];
  if (data.files.length > 0) return Array.from(data.files);
  const files: File[] = [];
  for (const item of data.items) {
    if (item.kind === 'file') {
      const file = item.getAsFile();
      if (file) files.push(file);
    }
  }
  return files;
}

// A pasted screenshot arrives without a filename; give it one so the chip and
// the sent file part aren't blank. Keyed by the classified media type.
const PASTED_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
};

/** A filename for a transfer item that came without one (e.g. a pasted screenshot). */
export function pastedName(mediaType: string): string {
  return `pasted.${PASTED_EXT[mediaType] ?? 'bin'}`;
}
