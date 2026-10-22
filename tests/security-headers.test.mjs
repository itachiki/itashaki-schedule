import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { API_SECURITY_HEADERS } from '../lib/security-headers.js';

const staticHeaders = readFileSync(new URL('../public/_headers', import.meta.url), 'utf8');

test('静的ページは必要なセキュリティヘッダーを設定する', () => {
  assert.match(staticHeaders, /Content-Security-Policy:/);
  assert.match(staticHeaders, /frame-ancestors 'none'/);
  assert.match(staticHeaders, /X-Frame-Options: DENY/);
  assert.match(staticHeaders, /X-Content-Type-Options: nosniff/);
  assert.match(staticHeaders, /Referrer-Policy: strict-origin-when-cross-origin/);
  assert.match(staticHeaders, /Permissions-Policy:/);
  assert.match(staticHeaders, /Strict-Transport-Security: max-age=604800/);
  assert.doesNotMatch(staticHeaders, /'unsafe-inline'|'unsafe-eval'/);
});

test('CSPは現在使用する外部画像とCloudflare Web Analyticsだけを許可する', () => {
  assert.match(staticHeaders, /https:\/\/i\.ytimg\.com/);
  assert.match(staticHeaders, /https:\/\/\*\.finalfantasyxiv\.com/);
  assert.match(staticHeaders, /https:\/\/static\.cloudflareinsights\.com/);
  assert.match(staticHeaders, /https:\/\/cloudflareinsights\.com/);
});

test('APIレスポンス用ヘッダーは外部コンテンツと埋め込みを拒否する', () => {
  assert.equal(API_SECURITY_HEADERS['X-Content-Type-Options'], 'nosniff');
  assert.equal(API_SECURITY_HEADERS['X-Frame-Options'], 'DENY');
  assert.equal(API_SECURITY_HEADERS['Referrer-Policy'], 'no-referrer');
  assert.equal(API_SECURITY_HEADERS['Strict-Transport-Security'], 'max-age=604800');
  assert.match(API_SECURITY_HEADERS['Content-Security-Policy'], /default-src 'none'/);
  assert.match(API_SECURITY_HEADERS['Content-Security-Policy'], /frame-ancestors 'none'/);
});
