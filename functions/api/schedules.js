import { fetchGoogleSheetRows } from '../../lib/google-sheets.js';

const CACHE_SECONDS = 60;
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

function googleSerialDate(value, rowNumber, fieldName) {
  if (!Number.isFinite(value) || value < 1) {
    throw new Error(`${rowNumber}行目の${fieldName}が有効な日付ではありません。`);
  }
  const date = new Date(GOOGLE_SHEETS_EPOCH + Math.floor(value) * 86400000);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function normaliseDate(value, rowNumber, fieldName) {
  if (typeof value === 'number') return googleSerialDate(value, rowNumber, fieldName);
  const match = String(value || '').trim().match(/^(\d{4})[\-/\.年](\d{1,2})[\-/\.月](\d{1,2})日?$/);
  if (!match) throw new Error(`${rowNumber}行目の${fieldName}は yyyy-MM-dd 形式にしてください。`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() + 1 !== month || check.getUTCDate() !== day) {
    throw new Error(`${rowNumber}行目の${fieldName}が有効な日付ではありません。`);
  }
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function normaliseTime(value, rowNumber, fieldName) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const fraction = ((value % 1) + 1) % 1;
    const totalSeconds = Math.round(fraction * 86400) % 86400;
    const hour = Math.floor(totalSeconds / 3600);
    const minute = Math.floor((totalSeconds % 3600) / 60);
    const second = totalSeconds % 60;
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`;
  }
  const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) throw new Error(`${rowNumber}行目の${fieldName}は HH:mm 形式にしてください。`);
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] || 0);
  if (hour > 23 || minute > 59 || second > 59) throw new Error(`${rowNumber}行目の${fieldName}が有効な時刻ではありません。`);
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`;
}

function normaliseUpdatedAt(value, rowNumber) {
  if (value === undefined || value === null || value === '') return '';
  try {
    if (typeof value === 'number') {
      const date = googleSerialDate(value, rowNumber, '更新日時');
      const time = normaliseTime(value, rowNumber, '更新日時');
      return `${date}T${time}+09:00`;
    }
    const text = String(value).trim();
    const localMatch = text.match(/^(\d{4}[\-/\.]\d{1,2}[\-/\.]\d{1,2})[ T](\d{1,2}:\d{2}(?::\d{2})?)$/);
    if (localMatch) {
      const date = normaliseDate(localMatch[1], rowNumber, '更新日時');
      const time = normaliseTime(localMatch[2], rowNumber, '更新日時');
      return `${date}T${time}+09:00`;
    }
    if (/(Z|[+-]\d{2}:\d{2})$/i.test(text)) {
      const parsed = new Date(text);
      if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
    }
  } catch {
    // 更新日時は補助情報のため、不正な場合も予定自体は表示する。
  }
  return '';
}

export function mapRowsToSchedules(rows = []) {
  return rows.flatMap((row, index) => {
    const rowNumber = index + 2;
    if (!row.some((value) => String(value || '').trim())) return [];
    if (!isPublished(row[0])) return [];
    const title = String(row[1] || '').trim();
    if (!title) throw new Error(`${rowNumber}行目のタイトルが空です。`);
    const startDate = normaliseDate(row[2], rowNumber, '開始日');
    const startTime = normaliseTime(row[3], rowNumber, '開始時刻');
    const endDate = normaliseDate(row[4], rowNumber, '終了日');
    const endTime = normaliseTime(row[5], rowNumber, '終了時刻');
    const start = `${startDate}T${startTime}+09:00`;
    const end = `${endDate}T${endTime}+09:00`;
    if (new Date(end) < new Date(start)) throw new Error(`${rowNumber}行目の終了日時は開始日時以降にしてください。`);
    return [{
      id: `sheet-${rowNumber}-${startDate.replace(/-/g, '')}-${startTime.replace(/:/g, '')}`,
      title,
      start,
      end,
      category: String(row[6] || '').trim() || '配信',
      content: String(row[7] || '').trim(),
      description: String(row[8] || '').trim(),
      youtubeUrl: String(row[9] || '').trim(),
      updatedAt: normaliseUpdatedAt(row[10], rowNumber)
    }];
  });
}

async function fetchSchedules(env) {
  if (!env.GOOGLE_SHEET_RANGE) throw new Error('GOOGLE_SHEET_RANGE が設定されていません。');
  const range = String(env.GOOGLE_SHEET_RANGE).replace(/:J(\d*)$/i, ':K$1');
  const rows = await fetchGoogleSheetRows(env, range);
  return mapRowsToSchedules(rows);
}

export async function onRequestGet(context) {
  const cacheKey = new Request(new URL('/api/schedules', context.request.url), { method: 'GET' });
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  try {
    const schedules = await fetchSchedules(context.env);
    const response = jsonResponse(schedules, 200, {
      'Cache-Control': `public, max-age=30, s-maxage=${CACHE_SECONDS}`
    });
    context.waitUntil(cache.put(cacheKey, response.clone()).catch((error) => {
      console.warn('配信予定APIのキャッシュ保存に失敗しました:', error);
    }));
    return response;
  } catch (error) {
    console.error('Google Sheetsから配信予定を取得できませんでした:', error);
    const detail = /^\d+行目/.test(error?.message || '') ? error.message : '';
    return jsonResponse({ error: '配信予定を取得できませんでした。', detail }, 502, { 'Cache-Control': 'no-store' });
  }
}
