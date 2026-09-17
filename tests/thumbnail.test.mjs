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
  const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'www.youtu.be']);
  const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
  ${sourceBetween('  function youtubeVideoFromUrl', '  function validHttpsUrl')}
  ${sourceBetween('  function createThumbnail', '  function createCard')}
  globalThis.helpers = { youtubeVideoFromUrl, extractYouTubeVideo, createThumbnail };
`, context);

const { youtubeVideoFromUrl, extractYouTubeVideo, createThumbnail } = context.helpers;
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
