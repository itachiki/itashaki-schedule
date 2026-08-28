const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';
const CACHE_SECONDS = 60;
const GOOGLE_SHEETS_EPOCH = Date.UTC(1899, 11, 30);

let cachedAccessToken = '';
let accessTokenExpiresAt = 0;

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

function base64UrlEncode(value) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value);
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function pemToArrayBuffer(pem) {
  const base64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s/g, '');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

function readCredentials(value) {
  if (!value) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON が設定されていません。');
  let credentials;
  try {
    credentials = JSON.parse(value);
  } catch {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON が有効なJSONではありません。');
  }
  if (!credentials.client_email || !credentials.private_key) {
    throw new Error('サービスアカウントJSONに client_email または private_key がありません。');
  }
  return credentials;
}

async function createGoogleJwt(credentials) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  if (credentials.private_key_id) header.kid = credentials.private_key_id;
  const payload = {
    iss: credentials.client_email,
    scope: GOOGLE_SHEETS_SCOPE,
    aud: GOOGLE_TOKEN_URL,
    iat: issuedAt,
    exp: issuedAt + 3600
  };
  const unsignedToken = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(payload))}`;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(credentials.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(unsignedToken)
  );
  return `${unsignedToken}.${base64UrlEncode(signature)}`;
}

async function getGoogleAccessToken(credentials) {
  if (cachedAccessToken && Date.now() < accessTokenExpiresAt - 60000) return cachedAccessToken;
  const assertion = await createGoogleJwt(credentials);
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion
    })
  });
  if (!response.ok) throw new Error(`Google認証に失敗しました（HTTP ${response.status}）。`);
  const data = await response.json();
  if (!data.access_token) throw new Error('Google認証レスポンスにアクセストークンがありません。');
  cachedAccessToken = data.access_token;
  accessTokenExpiresAt = Date.now() + Number(data.expires_in || 3600) * 1000;
  return cachedAccessToken;
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
    if (new Date(end) <= new Date(start)) throw new Error(`${rowNumber}行目の終了日時は開始日時より後にしてください。`);
    return [{
      id: `sheet-${rowNumber}-${startDate.replace(/-/g, '')}-${startTime.replace(/:/g, '')}`,
      title,
      start,
      end,
      category: String(row[6] || '').trim() || '配信',
      content: String(row[7] || '').trim(),
      description: String(row[8] || '').trim(),
      youtubeUrl: String(row[9] || '').trim()
    }];
  });
}

async function fetchSchedules(env) {
  if (!env.GOOGLE_SHEET_ID) throw new Error('GOOGLE_SHEET_ID が設定されていません。');
  if (!env.GOOGLE_SHEET_RANGE) throw new Error('GOOGLE_SHEET_RANGE が設定されていません。');
  const credentials = readCredentials(env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const accessToken = await getGoogleAccessToken(credentials);
  const endpoint = new URL(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(env.GOOGLE_SHEET_ID)}/values/${encodeURIComponent(env.GOOGLE_SHEET_RANGE)}`
  );
  endpoint.searchParams.set('majorDimension', 'ROWS');
  endpoint.searchParams.set('valueRenderOption', 'UNFORMATTED_VALUE');
  endpoint.searchParams.set('dateTimeRenderOption', 'SERIAL_NUMBER');
  const response = await fetch(endpoint, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new Error(`Google Sheets APIの読み取りに失敗しました（HTTP ${response.status}）。`);
  const data = await response.json();
  return mapRowsToSchedules(data.values || []);
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
