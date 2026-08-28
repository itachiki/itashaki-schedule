import { fetchGoogleSheetRows } from '../../lib/google-sheets.js';

const CACHE_SECONDS = 60;
const DEFAULT_NOTICES_RANGE = 'notices!A2:F';
const GOOGLE_SHEETS_EPOCH = Date.UTC(1899, 11, 30);

function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      ...extraHeaders
    }
  });
}

function isPublished(value) {
  if (value === true || value === 1) return true;
  return ['TRUE', '1', 'YES', 'ON', '公開'].includes(String(value || '').trim().toUpperCase());
}

function partsToIso(year, month, day, hour, minute, second, rowNumber, fieldName) {
  const check = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (
    check.getUTCFullYear() !== year || check.getUTCMonth() + 1 !== month || check.getUTCDate() !== day
    || check.getUTCHours() !== hour || check.getUTCMinutes() !== minute || check.getUTCSeconds() !== second
  ) {
    throw new Error(`${rowNumber}行目の${fieldName}が有効な日時ではありません。`);
  }
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}+09:00`;
}

function normaliseOptionalDateTime(value, rowNumber, fieldName) {
  if (value === undefined || value === null || String(value).trim() === '') return '';
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(GOOGLE_SHEETS_EPOCH + Math.round(value * 86400) * 1000);
    return partsToIso(
      date.getUTCFullYear(),
      date.getUTCMonth() + 1,
      date.getUTCDate(),
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      rowNumber,
      fieldName
    );
  }
  const match = String(value).trim().match(/^(\d{4})[\-/\.年](\d{1,2})[\-/\.月](\d{1,2})日?[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) throw new Error(`${rowNumber}行目の${fieldName}は yyyy-MM-dd HH:mm 形式にしてください。`);
  return partsToIso(
    Number(match[1]), Number(match[2]), Number(match[3]),
    Number(match[4]), Number(match[5]), Number(match[6] || 0),
    rowNumber, fieldName
  );
}

export function mapRowsToNotices(rows = [], now = new Date()) {
  return rows.flatMap((row, index) => {
    const rowNumber = index + 2;
    if (!row.some((value) => String(value || '').trim())) return [];
    if (!isPublished(row[0])) return [];
    const heading = String(row[2] || '').trim();
    const body = String(row[3] || '').trim();
    if (!body) throw new Error(`${rowNumber}行目のお知らせ本文が空です。`);
    const startsAt = normaliseOptionalDateTime(row[4], rowNumber, '掲載開始日時');
    const endsAt = normaliseOptionalDateTime(row[5], rowNumber, '掲載終了日時');
    if (startsAt && endsAt && new Date(endsAt) < new Date(startsAt)) {
      throw new Error(`${rowNumber}行目の掲載終了日時は掲載開始日時以降にしてください。`);
    }
    if (startsAt && now < new Date(startsAt)) return [];
    if (endsAt && now > new Date(endsAt)) return [];
    const requestedOrder = Number(row[1]);
    return [{
      id: `notice-${rowNumber}`,
      order: Number.isFinite(requestedOrder) && String(row[1]).trim() !== '' ? requestedOrder : rowNumber,
      heading,
      body
    }];
  }).sort((a, b) => a.order - b.order).map(({ order, ...notice }) => notice);
}

async function fetchNotices(env) {
  const rows = await fetchGoogleSheetRows(env, env.GOOGLE_NOTICES_RANGE || DEFAULT_NOTICES_RANGE);
  return mapRowsToNotices(rows);
}

export async function onRequestGet(context) {
  const cacheKey = new Request(new URL('/api/notices', context.request.url), { method: 'GET' });
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  try {
    const notices = await fetchNotices(context.env);
    const response = jsonResponse(notices, 200, {
      'Cache-Control': `public, max-age=30, s-maxage=${CACHE_SECONDS}`
    });
    context.waitUntil(cache.put(cacheKey, response.clone()).catch((error) => {
      console.warn('お知らせAPIのキャッシュ保存に失敗しました:', error);
    }));
    return response;
  } catch (error) {
    console.error('Google Sheetsからお知らせを取得できませんでした:', error);
    const detail = /^\d+行目/.test(error?.message || '') ? error.message : '';
    return jsonResponse({ error: 'お知らせを取得できませんでした。', detail }, 502, { 'Cache-Control': 'no-store' });
  }
}
