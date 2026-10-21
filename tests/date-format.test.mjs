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

const context = { Intl, Date };
vm.createContext(context);
vm.runInContext(`
  const TIME_ZONE = 'Asia/Tokyo';
  const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;
  const DATE_PARTS_FORMATTER = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  });
  const WEEKDAY_FORMATTER = new Intl.DateTimeFormat('ja-JP', { timeZone: TIME_ZONE, weekday: 'short' });
  ${sourceBetween('  function tokyoParts', '  function getStatus')}
  globalThis.formatTimeRange = formatTimeRange;
`, context);

const { formatTimeRange } = context;

test('年をまたぐ長期予定の終了日は年・月・日をスラッシュで区切る', () => {
  const start = new Date('2026-10-28T17:00:00+09:00');
  const end = new Date('2027-01-01T17:00:00+09:00');

  assert.equal(formatTimeRange(start, end), '17:00 ～ 2027/1/1（金） 17:00');
});

test('同一年の長期予定は終了年を表示しない', () => {
  const start = new Date('2026-10-28T17:00:00+09:00');
  const end = new Date('2026-11-01T17:00:00+09:00');

  assert.equal(formatTimeRange(start, end), '17:00 ～ 11/1（日） 17:00');
});

test('12時間未満の日付またぎは24時超え表記を維持する', () => {
  const start = new Date('2026-12-31T23:00:00+09:00');
  const end = new Date('2027-01-01T01:00:00+09:00');

  assert.equal(formatTimeRange(start, end), '23:00 ～ 25:00');
});
