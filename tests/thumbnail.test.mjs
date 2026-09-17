import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/script.js', import.meta.url), 'utf8');

function sourceBetween(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1, `${startMarker} が見つかりません。`);
  assert.notEqual(end, -1, `${endMarker} が見つかりません。`);
  return source.slice(start, end);
}

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.dataset = {};
    this.children = [];
    this.listeners = {};
  }

  addEventListener(type, listener) {
    this.listeners[type] = listener;
  }

  append(...children) {
    this.children.push(...children);
  }

  setAttribute(name, value) {
    this[name] = value;
  }

  remove() {
    this.removed = true;
  }

  dispatch(type) {
    this.listeners[type]?.();
  }
}

const context = {
  URL,
  document: { createElement: (tagName) => new FakeElement(tagName) }
};
vm.createContext(context);
vm.runInContext(`
  const DEFAULT_THUMBNAIL_URL = 'assets/images/default-stream-thumbnail.jpg';
  const STREAM_BREAK_THUMBNAIL_URL = 'assets/images/stream-break-thumbnail.jpg';
  const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'www.youtu.be']);
  const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
  ${sourceBetween('  function youtubeVideoFromUrl', '  function validHttpsUrl')}
  ${sourceBetween('  function categoryClassName', '  function isOfficialCategory')}
  ${sourceBetween('  function isOfficialCategory', '  function createThumbnail')}
  ${sourceBetween('  function createThumbnail', '  function createCard')}
  globalThis.helpers = {
    youtubeVideoFromUrl,
    extractYouTubeVideo,
    categoryClassName,
    shouldDisplayTime,
    createThumbnail,
    createOfficialThumbnail,
    hasDisplayThumbnail
  };
`, context);

const {
  youtubeVideoFromUrl,
  extractYouTubeVideo,
  categoryClassName,
  shouldDisplayTime,
  createThumbnail,
  createOfficialThumbnail,
  hasDisplayThumbnail
} = context.helpers;
const videoId = 'ABCDEFGHIJK';

test('対応するYouTube URL形式から動画IDを取得する', () => {
  const urls = [
    `https://www.youtube.com/watch?v=${videoId}`,
    `https://youtu.be/${videoId}`,
    `https://www.youtube.com/live/${videoId}`,
    `https://youtube.com/live/${videoId}?si=xxxx`
  ];
  urls.forEach((url) => assert.equal(youtubeVideoFromUrl(url)?.videoId, videoId));
});

test('文章中の複数URLからYouTube動画URLだけを検出する', () => {
  const text = `案内 https://example.com/ 配信URL：\nhttps://www.youtube.com/live/${videoId}?si=xxxxx。`;
  const result = extractYouTubeVideo(text);
  assert.equal(result?.videoId, videoId);
  assert.equal(result?.url, `https://www.youtube.com/live/${videoId}?si=xxxxx`);
});

test('チャンネルURLや不正な動画IDは動画として扱わない', () => {
  assert.equal(youtubeVideoFromUrl('https://www.youtube.com/'), null);
  assert.equal(youtubeVideoFromUrl('https://www.youtube.com/watch?v=short'), null);
  assert.equal(youtubeVideoFromUrl(`https://example.com/watch?v=${videoId}`), null);
});

test('YouTube画像はmaxres、hq、共通画像の順にフォールバックする', () => {
  const frame = createThumbnail({
    title: 'テスト配信',
    youtubeVideo: { videoId, url: `https://www.youtube.com/watch?v=${videoId}` }
  }, true);
  const image = frame.children[0];

  assert.equal(frame.tagName, 'a');
  assert.equal(frame.target, '_blank');
  assert.equal(frame.rel, 'noopener noreferrer');
  assert.equal(image.loading, 'eager');
  assert.equal(image.src, `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`);

  image.dispatch('error');
  assert.equal(image.src, `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`);
  image.dispatch('error');
  assert.equal(image.src, 'assets/images/default-stream-thumbnail.jpg');
  image.dispatch('error');
  assert.equal(image.src, 'assets/images/default-stream-thumbnail.jpg');
});

test('YouTube URLがない予定はクリックできない共通画像を遅延読込する', () => {
  const frame = createThumbnail({ title: '未設定配信', youtubeVideo: null });
  const image = frame.children[0];

  assert.equal(frame.tagName, 'div');
  assert.equal(image.loading, 'lazy');
  assert.equal(image.src, 'assets/images/default-stream-thumbnail.jpg');
  assert.equal(image.dataset.fallbackStage, 'default');
});

test('本配信休みは専用画像をリンクなしで表示し、時間を表示しない', () => {
  const frame = createThumbnail({
    title: '本配信お休み',
    category: '本配信休み',
    youtubeVideo: { videoId, url: `https://www.youtube.com/watch?v=${videoId}` }
  });
  const image = frame.children[0];

  assert.equal(frame.tagName, 'div');
  assert.equal(frame.className, 'thumbnail-frame');
  assert.equal(image.src, 'assets/images/stream-break-thumbnail.jpg');
  assert.equal(image.alt, '本配信お休みの配信休みサムネイル');
  assert.equal(categoryClassName('本配信休み'), 'category category-break');
  assert.equal(shouldDisplayTime('本配信休み'), false);
  assert.equal(shouldDisplayTime('本配信'), true);
});

test('突発配信は専用のカテゴリークラスを使用する', () => {
  assert.equal(categoryClassName('突発配信'), 'category category-special');
});

test('FF14公式画像は公式ページへのリンクになり、読込失敗時は画像領域を削除する', () => {
  const schedule = {
    title: '公式イベント',
    category: 'FF14公式',
    linkUrl: 'https://jp.finalfantasyxiv.com/lodestone/special/example/',
    officialThumbnailUrl: 'https://lds-img.finalfantasyxiv.com/example/card.jpg'
  };
  const frame = createOfficialThumbnail(schedule, true);
  const image = frame.children[0];

  assert.equal(frame.tagName, 'a');
  assert.equal(frame.href, schedule.linkUrl);
  assert.equal(frame.target, '_blank');
  assert.equal(frame.rel, 'noopener noreferrer');
  assert.equal(image.src, schedule.officialThumbnailUrl);
  assert.equal(image.loading, 'eager');
  assert.equal(hasDisplayThumbnail(schedule), true);

  image.dispatch('error');
  assert.equal(frame.removed, true);
});

test('FF14公式画像を取得できない場合はサムネイルを作らない', () => {
  const schedule = {
    title: '公式イベント',
    category: 'FF14公式',
    linkUrl: 'https://jp.finalfantasyxiv.com/lodestone/special/example/',
    officialThumbnailUrl: ''
  };
  assert.equal(createOfficialThumbnail(schedule), null);
  assert.equal(hasDisplayThumbnail(schedule), false);
});
