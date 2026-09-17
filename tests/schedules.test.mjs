import assert from 'node:assert/strict';
import test from 'node:test';
import { mapRowsToSchedules } from '../functions/api/schedules.js';

function row(overrides = {}) {
  const values = [
    true,
    '予定タイトル',
    '2026-09-20',
    '23:00',
    '2026-09-21',
    '01:00',
    '本配信',
    '対象コンテンツ',
    '補足',
    '',
    ''
  ];
  Object.entries(overrides).forEach(([index, value]) => { values[Number(index)] = value; });
  return values;
}

test('本配信休みはタイトルと開始・終了時刻を空欄にできる', () => {
  const [schedule] = mapRowsToSchedules([row({ 1: '', 3: '', 5: '', 6: '本配信休み' })]);

  assert.equal(schedule.title, '本配信休み');
  assert.equal(schedule.start, '2026-09-20T00:00:00+09:00');
  assert.equal(schedule.end, '2026-09-21T23:59:59+09:00');
  assert.equal(schedule.category, '本配信休み');
});

test('本配信は引き続きタイトルが必須', () => {
  assert.throws(
    () => mapRowsToSchedules([row({ 1: '', 6: '本配信' })]),
    /2行目のタイトルが空です/
  );
});

test('本配信休み以外は開始・終了時刻が必須', () => {
  assert.throws(
    () => mapRowsToSchedules([row({ 3: '', 6: '本配信' })]),
    /2行目の開始時刻は HH:mm 形式/
  );
});
