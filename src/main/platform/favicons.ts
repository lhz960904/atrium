import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createLogger } from '@main/utils/log';
import { BLANK_OPAQUE_FRACTION, opaqueFraction } from '@shared/favicon';
import decodeIco from 'decode-ico';
import { app, nativeImage, protocol, type Session, session } from 'electron';
import { parseHTML } from 'linkedom';

const log = createLogger('favicons');

/**
 * Site favicons for the chat's inline link chips.
 *
 * The renderer's CSP forbids remote images and remote fetch, so it can't pull a
 * favicon itself. The main process fetches one per host, caches it on disk, and
 * serves it back over a private `atrium-favicon://<host>` scheme that `<img>`
 * tags can point at.
 *
 * The cited site is asked first, so the common case tells nobody else which
 * links a chat contains. A host that refuses — which the large sites gating on
 * a browser TLS client do — falls through to DuckDuckGo's icon service, and
 * that host does reach a third party. See `fromService`.
 */
const SCHEME = 'atrium-favicon';

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

/** Loopback, link-local, private and carrier-grade-NAT IPv4. */
const PRIVATE_IPV4 =
  /^(0\.|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/;

/**
 * Chat citations are public sites, so a link must never become a probe of what
 * the user's own network is running. Requiring a dot is what turns away the
 * addresses no dotted rule would catch — an IPv6 literal, or the integer form
 * of an address — so relaxing it re-opens far more than it looks like.
 */
function isFetchableHost(host: string): boolean {
  if (!host.includes('.')) return false;
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.localhost')) return false;
  return !PRIVATE_IPV4.test(host);
}

/**
 * The same judgement on a whole URL, for the addresses we did not choose: an
 * href a page declares, and every hop a redirect takes. Anything but https is
 * refused outright — Chromium's stack will happily read a `file:` URL, which
 * the Node fetch this replaced could not.
 */
function isFetchableUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && isFetchableHost(u.hostname.toLowerCase());
  } catch {
    return false;
  }
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

let fetchSession: Session | null = null;

/**
 * Favicon lookups run on Chromium's network stack rather than Node's, which is
 * what gets the system proxy, its authentication schemes and the certificate
 * handling the rest of the app uses — and presents the TLS client the sites
 * that gate on one are looking for.
 *
 * It is its own partition, unnamed so nothing is written to disk, so these
 * requests carry none of the app's cookies. The request filter is the only
 * place a redirect can be judged: the fetch that follows one reports neither
 * the hops it took nor the URL it ended on, so every hop is vetted here as
 * Chromium is about to make it.
 */
function fetcher(): Session {
  if (fetchSession) return fetchSession;
  const ses = session.fromPartition('atrium-favicons');
  // Only the app's own name and Electron's are dropped; the Chrome version has
  // to stay the real one. Chromium sends client hints naming the build it
  // actually is, and a user agent claiming a different one is the disagreement
  // the bot filters in front of these sites look for — a hand-written browser
  // string is what gets them to refuse, not what gets them to answer.
  ses.setUserAgent(
    ses
      .getUserAgent()
      .replace(/\s[^\s/]+\/[\d.]+\sChrome\//, ' Chrome/')
      .replace(/\sElectron\/[\d.]+/, ''),
  );
  ses.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !isFetchableUrl(details.url) });
  });
  fetchSession = ses;
  return ses;
}

/**
 * Read at most `maxBytes`, dropping the response the moment it goes over rather
 * than buffering whatever a server decides to send: content-length is a claim,
 * and a server free to omit it is free to be wrong about it.
 */
async function readCapped(body: ReadableStream<Uint8Array>, maxBytes: number) {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return bytes;
}

async function get(
  url: string,
  maxBytes: number,
): Promise<{ bytes: Uint8Array<ArrayBuffer>; type: string | null } | null> {
  if (!isFetchableUrl(url)) return null;
  let res: Response;
  try {
    res = await fetcher().fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { Accept: '*/*' },
    });
  } catch (err) {
    log.debug('fetch failed', url, String(err));
    return null;
  }
  if (!res.ok || !res.body) return null;
  if (Number(res.headers.get('content-length') ?? 0) > maxBytes) {
    await res.body.cancel();
    return null;
  }
  let bytes: Uint8Array<ArrayBuffer> | null;
  try {
    bytes = await readCapped(res.body, maxBytes);
  } catch {
    return null;
  }
  if (!bytes) return null;
  const type = res.headers.get('content-type');
  return { bytes, type: type ? (type.split(';')[0]?.trim().toLowerCase() ?? null) : null };
}

/**
 * Some servers pipe favicon bytes through a text-encoding layer that mangles
 * the binary into UTF-8 replacement characters. Chromium still "decodes" such
 * an ICO — to fully transparent pixels — so the renderer's error fallback never
 * fires; a file decode-ico can't parse is rejected here so the lookup falls
 * through to the next source. Only bytes carrying the ICO magic are checked:
 * many sites serve a PNG at the favicon path, which decode-ico would reject.
 */
function isCorruptIco(bytes: Uint8Array): boolean {
  const b = bytes;
  if (b.length < 6 || b[0] !== 0 || b[1] !== 0 || b[2] !== 1 || b[3] !== 0) return false;
  try {
    decodeIco(bytes);
    return false;
  } catch {
    return true;
  }
}

function asImage(res: { bytes: Uint8Array<ArrayBuffer>; type: string | null }): Favicon | null {
  if (isCorruptIco(res.bytes)) return null;
  const ct = res.type?.startsWith('image/') ? res.type : sniff(res.bytes);
  return ct ? { bytes: res.bytes, contentType: ct } : null;
}

/**
 * A structurally valid icon can still be visually empty — a fully transparent
 * placeholder that a browser would pass over in favour of the icon a page
 * declares in <link rel=icon> (WordPress ships exactly such a default). Decode
 * far enough to see whether any pixel is painted; an icon we can't decode (SVG,
 * WebP) is assumed non-blank so a good icon is never dropped on a guess.
 */
function isBlank(bytes: Uint8Array): boolean {
  if (bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 && bytes[3] === 0) {
    try {
      const largest = decodeIco(bytes).sort((a, b) => b.width * b.height - a.width * a.height)[0];
      return largest ? opaqueFraction(largest.data) < BLANK_OPAQUE_FRACTION : false;
    } catch {
      return false;
    }
  }
  try {
    const img = nativeImage.createFromBuffer(Buffer.from(bytes));
    if (img.isEmpty()) return false;
    // Electron's own types mis-declare getBitmap as void; it returns BGRA bytes,
    // whose alpha lands at the same offset the opaque check reads.
    const bitmap = img.getBitmap() as unknown as Buffer;
    return opaqueFraction(bitmap) < BLANK_OPAQUE_FRACTION;
  } catch {
    return false;
  }
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
  // answers with something that isn't actually an image (SPA catch-all route),
  // or hands back a blank placeholder that hides the real icon the page declares.
  const direct = await get(`https://${host}/favicon.ico`, MAX_ICON_BYTES);
  const directIcon = direct && asImage(direct);
  if (directIcon && !isBlank(directIcon.bytes)) return directIcon;

  const page = await get(`https://${host}/`, MAX_HTML_BYTES);
  if (!page) return null;
  const html = new TextDecoder('utf-8', { fatal: false }).decode(page.bytes);
  const iconUrl = pickIconHref(html, `https://${host}/`);
  if (!iconUrl) return null;
  const icon = await get(iconUrl, MAX_ICON_BYTES);
  const declared = icon && asImage(icon);
  return declared && !isBlank(declared.bytes) ? declared : null;
}

// DuckDuckGo's icon service — the fallback for the sites whose bot filters
// refuse us outright, which no request we can make will get past. It is the one
// path that tells a third party which host a chat cited, so it stays a fallback.
// DDG 404s on unindexed subdomains, so a subdomain that misses retries its parent.
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
      // A corrupt or blank icon cached before this validation existed must not
      // be served forever — ignore it and re-resolve to the real icon.
      if (!isCorruptIco(bytes) && !isBlank(bytes)) {
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
