import assert from 'node:assert/strict';
import test from 'node:test';

import {
  extractOfficialThumbnailUrl,
  normaliseOfficialPageUrl
} from '../lib/official-thumbnail.js';

const officialPage = 'https://jp.finalfantasyxiv.com/lodestone/special/example/';

test('FF14日本公式ページのHTTPS URLだけを許可する', () => {
  assert.equal(normaliseOfficialPageUrl(officialPage)?.href, officialPage);
  assert.equal(normaliseOfficialPageUrl('http://jp.finalfantasyxiv.com/lodestone/'), null);
  assert.equal(normaliseOfficialPageUrl('https://example.com/lodestone/'), null);
  assert.equal(normaliseOfficialPageUrl('https://user:pass@jp.finalfantasyxiv.com/lodestone/'), null);
});

test('属性順に依存せずog:imageを取得してHTMLエンティティを復元する', () => {
  const html = `
    <meta content="https://lds-img.finalfantasyxiv.com/example/card.jpg?size=large&amp;lang=ja" property="og:image">
  `;
  assert.equal(
    extractOfficialThumbnailUrl(html, officialPage),
    'https://lds-img.finalfantasyxiv.com/example/card.jpg?size=large&lang=ja'
  );
});

test('og:image:secure_urlを優先し、相対URLにも対応する', () => {
  const html = `
    <meta property="og:image" content="https://lds-img.finalfantasyxiv.com/old.jpg">
    <meta content="/lodestone/special/card.jpg" property="og:image:secure_url">
  `;
  assert.equal(
    extractOfficialThumbnailUrl(html, officialPage),
    'https://jp.finalfantasyxiv.com/lodestone/special/card.jpg'
  );
});

test('公式ドメイン以外の画像は表示対象にしない', () => {
  const html = '<meta property="og:image" content="https://images.example.com/card.jpg">';
  assert.equal(extractOfficialThumbnailUrl(html, officialPage), '');
});
