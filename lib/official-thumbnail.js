const OFFICIAL_PAGE_HOST = 'jp.finalfantasyxiv.com';
const POSITIVE_CACHE_SECONDS = 24 * 60 * 60;
const NEGATIVE_CACHE_SECONDS = 60 * 60;
const FETCH_TIMEOUT_MS = 5000;

function isOfficialImageHost(hostname) {
  const host = hostname.toLowerCase();
  return host === 'finalfantasyxiv.com' || host.endsWith('.finalfantasyxiv.com');
}

function decodeHtmlAttribute(value) {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function metaAttributes(tag) {
  const attributes = {};
  const pattern = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  for (const match of tag.matchAll(pattern)) {
    attributes[match[1].toLowerCase()] = decodeHtmlAttribute(match[2] ?? match[3] ?? match[4] ?? '');
  }
  return attributes;
}

export function normaliseOfficialPageUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== OFFICIAL_PAGE_HOST) return null;
    if (url.username || url.password || url.port) return null;
    url.hash = '';
    return url;
  } catch {
    return null;
  }
}

export function extractOfficialThumbnailUrl(html, pageUrlValue) {
  const pageUrl = normaliseOfficialPageUrl(pageUrlValue);
  if (!pageUrl || typeof html !== 'string') return '';

  const secureCandidates = [];
  const candidates = [];
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const attributes = metaAttributes(tag);
    const property = (attributes.property || attributes.name || '').toLowerCase();
    if (!attributes.content) continue;
    if (property === 'og:image:secure_url') secureCandidates.push(attributes.content);
    else if (property === 'og:image') candidates.push(attributes.content);
  }

  for (const value of [...secureCandidates, ...candidates]) {
    try {
      const imageUrl = new URL(value, pageUrl);
      if (imageUrl.protocol !== 'https:' || !isOfficialImageHost(imageUrl.hostname)) continue;
      if (imageUrl.username || imageUrl.password || imageUrl.port) continue;
      return imageUrl.href;
    } catch {
      // 次の候補を確認する。
    }
  }
  return '';
}

async function requestOfficialThumbnail(pageUrl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(pageUrl.href, {
      headers: { Accept: 'text/html,application/xhtml+xml' },
      redirect: 'manual',
      signal: controller.signal
    });
    if (!response.ok) return '';
    const contentType = response.headers.get('Content-Type') || '';
    if (contentType && !contentType.toLowerCase().includes('text/html')) return '';
    return extractOfficialThumbnailUrl(await response.text(), pageUrl.href);
  } finally {
    clearTimeout(timeout);
  }
}

export async function getOfficialThumbnailUrl(value, context) {
  const pageUrl = normaliseOfficialPageUrl(value);
  if (!pageUrl) return '';

  const cacheUrl = new URL('/api/_official-thumbnail-cache', context.request.url);
  cacheUrl.searchParams.set('page', pageUrl.href);
  const cacheKey = new Request(cacheUrl, { method: 'GET' });
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) {
    try {
      const data = await cached.json();
      return typeof data.thumbnailUrl === 'string' ? data.thumbnailUrl : '';
    } catch {
      // 壊れたキャッシュは無視して再取得する。
    }
  }

  let thumbnailUrl = '';
  try {
    thumbnailUrl = await requestOfficialThumbnail(pageUrl);
  } catch (error) {
    console.warn('FF14公式ページのサムネイル取得に失敗しました:', pageUrl.href, error);
  }

  const cacheSeconds = thumbnailUrl ? POSITIVE_CACHE_SECONDS : NEGATIVE_CACHE_SECONDS;
  const response = new Response(JSON.stringify({ thumbnailUrl }), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': `public, max-age=${cacheSeconds}`
    }
  });
  context.waitUntil(cache.put(cacheKey, response).catch((error) => {
    console.warn('FF14公式サムネイルのキャッシュ保存に失敗しました:', error);
  }));
  return thumbnailUrl;
}
