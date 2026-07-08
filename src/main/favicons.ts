import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app, protocol } from 'electron';
import { parseHTML } from 'linkedom';
import { createLogger } from './log';

const log = createLogger('favicons');

/**
 * Site favicons for the chat's inline link chips.
 *
 * The renderer's CSP forbids remote images and remote fetch, so it can't pull a
 * favicon itself. The main process fetches one per host (straight from the cited
 * site — no third-party favicon service, so nothing about which links appear in
 * a chat leaks anywhere), caches it on disk, and serves it back over a private
 * `atrium-favicon://<host>` scheme that `<img>` tags can point at.
 */
const SCHEME = 'atrium-favicon';

// Present as a real browser — many servers gate their HTML (and so their
// <link rel=icon>) behind a browser UA, matching how web-fetch already fetches.
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const FETCH_TIMEOUT_MS = 6000;
const MAX_HTML_BYTES = 1_000_000;
const MAX_ICON_BYTES = 512_000;
// Re-attempt a host that yielded no icon at most once per window, so a transient
// failure heals but a genuinely icon-less site isn't re-fetched on every render.
const MISS_TTL_MS = 6 * 60 * 60 * 1000;

// The buffer type is pinned to ArrayBuffer (not the generic ArrayBufferLike) so
// the bytes stay valid as a Response BodyInit when served over the scheme.
type Favicon = { bytes: Uint8Array<ArrayBuffer>; contentType: string };

let cacheDir: string | null = null;
function dir(): string {
  if (!cacheDir) cacheDir = join(app.getPath('userData'), 'favicons');
  return cacheDir;
}
function diskPath(host: string): string {
  return join(dir(), createHash('sha1').update(host).digest('hex'));
}

// Resolved icons (persisted to disk too). Negative lookups live only in `misses`
// so a site that later gains a favicon isn't cached as iconless forever.
const mem = new Map<string, Favicon>();
const misses = new Map<string, number>();
// Coalesce concurrent requests for the same host onto a single fetch.
const inflight = new Map<string, Promise<Favicon | null>>();

function isFetchableHost(host: string): boolean {
  if (!host.includes('.')) return false;
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.localhost')) return false;
  // Loopback / private IPv4 — chat citations are public sites; don't let a link
  // probe services on the user's own network.
  return !/^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
}

function sniff(bytes: Uint8Array): string | null {
  const b = bytes;
  if (b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47)
    return 'image/png';
  if (b.length >= 4 && b[0] === 0x00 && b[1] === 0x00 && b[2] === 0x01 && b[3] === 0x00)
    return 'image/x-icon';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 4 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
  if (b.length >= 12 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50)
    return 'image/webp';
  // SVG is text — check the opening tag past any BOM / whitespace / xml prolog.
  const head = new TextDecoder('utf-8', { fatal: false }).decode(b.subarray(0, 256)).trimStart();
  if (head.startsWith('<?xml') || head.toLowerCase().includes('<svg')) return 'image/svg+xml';
  return null;
}

async function get(
  url: string,
  maxBytes: number,
): Promise<{ bytes: Uint8Array<ArrayBuffer>; type: string | null } | null> {
  let res: Response;
  try {
    res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { 'User-Agent': USER_AGENT, Accept: '*/*' },
    });
  } catch (err) {
    log.debug('fetch failed', url, String(err));
    return null;
  }
  if (!res.ok) return null;
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > maxBytes) return null;
  let buf: ArrayBuffer;
  try {
    buf = await res.arrayBuffer();
  } catch {
    return null;
  }
  if (buf.byteLength > maxBytes) return null;
  const type = res.headers.get('content-type');
  return {
    bytes: new Uint8Array(buf),
    type: type ? (type.split(';')[0]?.trim().toLowerCase() ?? null) : null,
  };
}

/**
 * Some servers pipe favicon bytes through a text-encoding layer that mangles
 * the binary into UTF-8 replacement characters. Chromium still "decodes" such
 * an ICO — to fully transparent pixels — so the renderer's error fallback never
 * fires. A real ICO's directory always fits inside the file; one that doesn't
 * is rejected here so the lookup falls through to the next source.
 */
function isCorruptIco(bytes: Uint8Array): boolean {
  const b = bytes;
  if (b.length < 6 || b[0] !== 0 || b[1] !== 0 || b[2] !== 1 || b[3] !== 0) return false;
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const count = view.getUint16(4, true);
  const dirEnd = 6 + count * 16;
  if (count === 0 || dirEnd > b.length) return true;
  for (let i = 0; i < count; i++) {
    const entry = 6 + i * 16;
    const size = view.getUint32(entry + 8, true);
    const offset = view.getUint32(entry + 12, true);
    if (size === 0 || offset < dirEnd || offset + size > b.length) return true;
  }
  return false;
}

function asImage(res: { bytes: Uint8Array<ArrayBuffer>; type: string | null }): Favicon | null {
  if (isCorruptIco(res.bytes)) return null;
  const ct = res.type?.startsWith('image/') ? res.type : sniff(res.bytes);
  return ct ? { bytes: res.bytes, contentType: ct } : null;
}

// Pick the best-looking icon declared in the page head. Prefer scalable SVG,
// then the highest-resolution raster (apple-touch-icons and sized <link>s),
// falling back to the plain "icon"/"shortcut icon" defaults.
function pickIconHref(html: string, baseUrl: string): string | null {
  let doc: Document;
  try {
    ({ document: doc } = parseHTML(html));
  } catch {
    return null;
  }
  let best: string | null = null;
  let bestScore = -1;
  for (const el of doc.querySelectorAll('link[rel]')) {
    const rel = (el.getAttribute('rel') ?? '').toLowerCase();
    const tokens = rel.split(/\s+/);
    const isIcon = tokens.includes('icon') || tokens.includes('apple-touch-icon');
    if (!isIcon) continue; // skips mask-icon (monochrome) and unrelated rels
    const href = el.getAttribute('href');
    if (!href) continue;
    const type = (el.getAttribute('type') ?? '').toLowerCase();
    let score: number;
    if (type.includes('svg') || /\.svg(\?|#|$)/i.test(href)) score = 1000;
    else if (tokens.includes('apple-touch-icon')) score = 180;
    else {
      const dim = /(\d+)x\d+/i.exec(el.getAttribute('sizes') ?? '');
      score = dim ? Number(dim[1]) : tokens.includes('shortcut') ? 16 : 32;
    }
    if (score > bestScore) {
      bestScore = score;
      best = href;
    }
  }
  if (!best) return null;
  try {
    return new URL(best, baseUrl).toString();
  } catch {
    return null;
  }
}

async function fromSite(host: string): Promise<Favicon | null> {
  // /favicon.ico first: one request, and for a ~16px chip its built-in low-res
  // variant is exactly right. Only parse the page HTML when it's missing, errors,
  // or answers with something that isn't actually an image (SPA catch-all route).
  const direct = await get(`https://${host}/favicon.ico`, MAX_ICON_BYTES);
  const directIcon = direct && asImage(direct);
  if (directIcon) return directIcon;

  const page = await get(`https://${host}/`, MAX_HTML_BYTES);
  if (!page) return null;
  const html = new TextDecoder('utf-8', { fatal: false }).decode(page.bytes);
  const iconUrl = pickIconHref(html, `https://${host}/`);
  if (!iconUrl) return null;
  const icon = await get(iconUrl, MAX_ICON_BYTES);
  return icon ? asImage(icon) : null;
}

// DuckDuckGo's icon service — the privacy-respecting fallback for the many large
// sites (openai.com, chatgpt.com, …) that 403 a non-browser TLS client and so
// can't be fetched directly. DDG 404s on unindexed subdomains, so a subdomain
// that misses retries its parent (help.anthropic.com → anthropic.com).
async function fromService(host: string): Promise<Favicon | null> {
  const one = async (h: string): Promise<Favicon | null> => {
    const r = await get(`https://icons.duckduckgo.com/ip3/${h}.ico`, MAX_ICON_BYTES);
    return r ? asImage(r) : null;
  };
  const hit = await one(host);
  if (hit) return hit;
  const parent = host.split('.').slice(1).join('.');
  return parent.includes('.') ? one(parent) : null;
}

// Prefer the site's own icon (private, authentic, no third party); only reach
// for the service when the origin won't hand one over.
async function resolve(host: string): Promise<Favicon | null> {
  return (await fromSite(host)) ?? (await fromService(host));
}

async function load(host: string): Promise<Favicon | null> {
  const path = diskPath(host);
  if (existsSync(path)) {
    try {
      const raw = await readFile(path);
      const bytes = new Uint8Array(raw);
      // A corrupt icon cached before validation existed must not be served
      // forever — ignore it and re-resolve.
      if (!isCorruptIco(bytes)) {
        const fav: Favicon = { bytes, contentType: sniff(raw) ?? 'image/x-icon' };
        mem.set(host, fav);
        return fav;
      }
    } catch {
      // Unreadable cache file — fall through and re-fetch.
    }
  }
  const fav = await resolve(host);
  if (!fav) {
    misses.set(host, Date.now());
    return null;
  }
  mem.set(host, fav);
  void mkdir(dir(), { recursive: true })
    .then(() => writeFile(path, fav.bytes))
    .catch((err) => log.debug('favicon cache write failed', host, String(err)));
  return fav;
}

export async function getFavicon(host: string): Promise<Favicon | null> {
  const h = host.toLowerCase();
  if (!isFetchableHost(h)) return null;
  const cached = mem.get(h);
  if (cached) return cached;
  const missedAt = misses.get(h);
  if (missedAt !== undefined && Date.now() - missedAt < MISS_TTL_MS) return null;
  const existing = inflight.get(h);
  if (existing) return existing;
  const p = load(h).finally(() => inflight.delete(h));
  inflight.set(h, p);
  return p;
}

// Must run before app 'ready'. `standard` gives the URL a parseable host,
// `secure` keeps the images from counting as insecure content, and
// `corsEnabled` (with the allow-origin header below) lets the renderer load
// them as crossorigin images whose pixels it may inspect for visibility.
export function registerFaviconScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: false, corsEnabled: true },
    },
  ]);
}

export function serveFavicons(): void {
  protocol.handle(SCHEME, async (request) => {
    let host: string;
    try {
      host = new URL(request.url).hostname;
    } catch {
      return new Response(null, { status: 400 });
    }
    const fav = await getFavicon(host);
    if (!fav) return new Response(null, { status: 404 });
    return new Response(fav.bytes, {
      status: 200,
      headers: {
        'content-type': fav.contentType,
        'cache-control': 'max-age=86400',
        'access-control-allow-origin': '*',
      },
    });
  });
}
