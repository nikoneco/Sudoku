import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyStats, mergeStats, normalizeStats, recordClear } from '../js/data/stats.js';

const puzzles = [
  { puzzleId: 'old-a', difficulty: '初級' },
  { puzzleId: 'old-b', difficulty: '中級' },
  { puzzleId: 'same-id', difficulty: '上級' },
];

function record(puzzleId, difficulty, elapsedTime) {
  return recordClear(emptyStats(), { puzzleId, difficulty, elapsedTime });
}

test('empty stats expose additive records and legacy-best maps', () => {
  assert.deepEqual(emptyStats(), {
    clearedIds: [],
    byDifficulty: {},
    totalClears: 0,
    records: {},
    legacyBest: {},
  });
});

test('legacy aggregates migrate puzzle IDs using the catalog and keep old best times separate', () => {
  const migrated = normalizeStats({
    clearedIds: ['old-a', 'old-b', 'old-a', 'unknown-id', 'invalid/id'],
    byDifficulty: {
      '初級': { clears: 1, bestTime: 82 },
      '中級': { clears: 1, bestTime: 105 },
    },
    totalClears: 2,
  }, puzzles);

  assert.deepEqual(migrated.clearedIds, ['old-a', 'old-b', 'unknown-id']);
  assert.deepEqual(migrated.records, {
    'old-a': { difficulty: '初級', elapsedTime: null },
    'old-b': { difficulty: '中級', elapsedTime: null },
  });
  assert.deepEqual(migrated.legacyBest, { '初級': 82, '中級': 105 });
  assert.equal(migrated.byDifficulty['初級'].bestTime, 82);
  assert.equal(migrated.byDifficulty['中級'].bestTime, 105);
  assert.equal(migrated.totalClears, 3);
});

test('recordClear counts a puzzle once and keeps its minimum known time', () => {
  const first = record('fresh-id', '初級', 185);
  const slowerReplay = recordClear(first, { puzzleId: 'fresh-id', difficulty: '初級', elapsedTime: 220 });
  const fasterReplay = recordClear(slowerReplay, { puzzleId: 'fresh-id', difficulty: '初級', elapsedTime: 93 });

  assert.equal(first.totalClears, 1);
  assert.equal(slowerReplay.totalClears, 1);
  assert.equal(fasterReplay.totalClears, 1);
  assert.deepEqual(fasterReplay.records['fresh-id'], { difficulty: '初級', elapsedTime: 93 });
  assert.deepEqual(fasterReplay.byDifficulty['初級'], { clears: 1, bestTime: 93 });
});

test('recording a legacy cleared ID before the puzzle catalog loads does not count it twice', () => {
  const legacy = normalizeStats({
    clearedIds: ['old-a'],
    byDifficulty: { '初級': { clears: 1, bestTime: 80 } },
    totalClears: 1,
  });
  const recorded = recordClear(legacy, { puzzleId: 'old-a', difficulty: '初級', elapsedTime: 90 });
  const afterCatalog = normalizeStats(recorded, puzzles);

  assert.equal(recorded.totalClears, 1);
  assert.equal(recorded.byDifficulty['初級'].clears, 1);
  assert.equal(recorded.records['old-a'].elapsedTime, 90);
  assert.equal(recorded.byDifficulty['初級'].bestTime, 80);
  assert.equal(afterCatalog.totalClears, 1);
  assert.equal(afterCatalog.byDifficulty['初級'].clears, 1);

  const distinct = recordClear(recorded, { puzzleId: 'new-a', difficulty: '初級', elapsedTime: 65 });
  assert.equal(distinct.totalClears, 2);
  assert.equal(distinct.byDifficulty['初級'].clears, 2);
});

test('merge is replay-safe, order-independent, and uses known-time minima', () => {
  const local = recordClear(record('old-a', '初級', 210), { puzzleId: 'local-new', difficulty: '中級', elapsedTime: 150 });
  const remote = recordClear(record('old-a', '初級', 180), { puzzleId: 'remote-new', difficulty: '中級', elapsedTime: 132 });

  const merged = mergeStats(local, remote, puzzles);
  assert.deepEqual(mergeStats(merged, remote, puzzles), merged);
  assert.deepEqual(mergeStats(remote, local, puzzles), merged);
  assert.equal(merged.totalClears, 3);
  assert.equal(merged.records['old-a'].elapsedTime, 180);
  assert.equal(merged.byDifficulty['初級'].clears, 1);
  assert.equal(merged.byDifficulty['中級'].clears, 2);
  assert.equal(merged.byDifficulty['中級'].bestTime, 132);
});

test('duplicate IDs with conflicting difficulties resolve deterministically, with catalog authority', () => {
  const one = record('same-id', '上級', 240);
  const two = record('same-id', '初級', 170);

  const deterministic = mergeStats(one, two);
  assert.deepEqual(deterministic.records['same-id'], { difficulty: '初級', elapsedTime: 170 });
  assert.deepEqual(mergeStats(two, one), deterministic);

  const catalogResolved = mergeStats(one, two, puzzles);
  assert.deepEqual(catalogResolved.records['same-id'], { difficulty: '上級', elapsedTime: 170 });
});

test('invalid IDs, difficulty labels, counters, and times are not propagated', () => {
  const normalized = normalizeStats({
    clearedIds: ['valid-id', 'bad/id', '__proto__', 'valid-id'],
    totalClears: -3,
    byDifficulty: {
      '初級': { clears: -1, bestTime: -10 },
      '特級': { clears: 500, bestTime: 12 },
    },
    records: {
      'valid-id': { difficulty: '初級', elapsedTime: 31_536_001 },
      'bad/id': { difficulty: '初級', elapsedTime: 4 },
      'bad-difficulty': { difficulty: '特級', elapsedTime: 10 },
      'too-long': { difficulty: '中級', elapsedTime: Infinity },
    },
    legacyBest: { '初級': 31_536_001, '特級': 30 },
  });

  assert.deepEqual(normalized.clearedIds, ['__proto__', 'too-long', 'valid-id']);
  assert.deepEqual(normalized.records, {
    'too-long': { difficulty: '中級', elapsedTime: null },
    'valid-id': { difficulty: '初級', elapsedTime: null },
  });
  assert.deepEqual(normalized.legacyBest, {});
  assert.equal(normalized.totalClears, 3);
  assert.deepEqual(normalized.byDifficulty['初級'], { clears: 1, bestTime: null });
});

test('prototype-looking puzzle IDs remain own data keys without modifying object prototypes', () => {
  const legacy = JSON.parse('{"clearedIds":["__proto__","constructor"],"records":{"__proto__":{"difficulty":"初級","elapsedTime":12},"constructor":{"difficulty":"中級","elapsedTime":20}},"byDifficulty":{},"totalClears":2,"legacyBest":{}}');
  const normalized = normalizeStats(legacy);

  assert.equal(Object.getPrototypeOf(normalized.records), Object.prototype);
  assert.equal(Object.hasOwn(normalized.records, '__proto__'), true);
  assert.deepEqual(normalized.records['__proto__'], { difficulty: '初級', elapsedTime: 12 });
  assert.equal(normalized.records.constructor.elapsedTime, 20);
  assert.equal({}.difficulty, undefined);
});

test('aggregate counts survive catalog gaps and duplicate historical IDs are still counted once', () => {
  const old = normalizeStats({
    clearedIds: ['unmapped-a', 'unmapped-a', 'unmapped-b'],
    byDifficulty: { '上級': { clears: 4, bestTime: 500 } },
    totalClears: 5,
  });
  const later = recordClear(old, { puzzleId: 'later-a', difficulty: '上級', elapsedTime: 420 });
  const merged = mergeStats(later, record('later-b', '上級', 300));

  assert.equal(old.totalClears, 5);
  assert.equal(later.totalClears, 6);
  assert.equal(merged.totalClears, 7);
  assert.equal(merged.byDifficulty['上級'].clears, 6);
  assert.equal(merged.byDifficulty['上級'].bestTime, 300);
});
