const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';

let cachedAccessToken = '';
let accessTokenExpiresAt = 0;

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

export async function fetchGoogleSheetRows(env, range) {
  if (!env.GOOGLE_SHEET_ID) throw new Error('GOOGLE_SHEET_ID が設定されていません。');
  if (!range) throw new Error('Google Sheetsの読取範囲が設定されていません。');
  const credentials = readCredentials(env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const accessToken = await getGoogleAccessToken(credentials);
  const endpoint = new URL(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(env.GOOGLE_SHEET_ID)}/values/${encodeURIComponent(range)}`
  );
  endpoint.searchParams.set('majorDimension', 'ROWS');
  endpoint.searchParams.set('valueRenderOption', 'UNFORMATTED_VALUE');
  endpoint.searchParams.set('dateTimeRenderOption', 'SERIAL_NUMBER');
  const response = await fetch(endpoint, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new Error(`Google Sheets APIの読み取りに失敗しました（HTTP ${response.status}）。`);
  const data = await response.json();
  return data.values || [];
}
