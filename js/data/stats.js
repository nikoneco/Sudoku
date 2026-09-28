import { DIFFICULTIES } from '../config.js';

const PUZZLE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_ELAPSED_TIME = 31_536_000;
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isPuzzleId(value) {
  return typeof value === 'string' && PUZZLE_ID_PATTERN.test(value);
}

function isDifficulty(value) {
  return DIFFICULTIES.includes(value);
}

function isElapsedTime(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_ELAPSED_TIME;
}

function elapsedTimeOrNull(value) {
  return value === null || value === undefined ? null : isElapsedTime(value) ? value : null;
}

function validCounter(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function compareText(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function defineMapValue(target, key, value) {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    writable: true,
    value,
  });
}

function setMapValue(target, key, value) {
  if (hasOwn(target, key)) return false;
  defineMapValue(target, key, value);
  return true;
}

function chooseDifficulty(left, right, catalogDifficulty = null) {
  if (isDifficulty(catalogDifficulty)) return catalogDifficulty;
  if (!isDifficulty(left)) return isDifficulty(right) ? right : null;
  if (!isDifficulty(right)) return left;
  return DIFFICULTIES.indexOf(left) <= DIFFICULTIES.indexOf(right) ? left : right;
}

function mergeRecord(left, right, catalogDifficulty = null) {
  const difficulty = chooseDifficulty(left?.difficulty, right?.difficulty, catalogDifficulty);
  if (!difficulty) return null;
  const times = [left?.elapsedTime, right?.elapsedTime].filter(isElapsedTime);
  return {
    difficulty,
    elapsedTime: times.length ? Math.min(...times) : null,
  };
}

function catalogDifficulties(puzzles) {
  const catalog = Object.create(null);
  if (!Array.isArray(puzzles)) return catalog;
  for (const puzzle of puzzles) {
    if (!isObject(puzzle) || !isPuzzleId(puzzle.puzzleId) || !isDifficulty(puzzle.difficulty)) continue;
    const previous = catalog[puzzle.puzzleId];
    defineMapValue(catalog, puzzle.puzzleId, chooseDifficulty(previous, puzzle.difficulty));
  }
  return catalog;
}

function recordCounts(records) {
  const counts = {};
  for (const difficulty of DIFFICULTIES) counts[difficulty] = 0;
  for (const record of Object.values(records)) counts[record.difficulty] += 1;
  return counts;
}

function makeAggregate(records, legacyBest, clearedIds, totalClears, countFloors = {}) {
  const counts = recordCounts(records);
  const byDifficulty = {};
  for (const difficulty of DIFFICULTIES) {
    const clears = Math.max(counts[difficulty], validCounter(countFloors[difficulty]));
    const times = [legacyBest[difficulty]];
    for (const record of Object.values(records)) {
      if (record.difficulty === difficulty && isElapsedTime(record.elapsedTime)) times.push(record.elapsedTime);
    }
    const knownTimes = times.filter(isElapsedTime);
    const bestTime = knownTimes.length ? Math.min(...knownTimes) : null;
    if (clears || bestTime !== null) setMapValue(byDifficulty, difficulty, { clears, bestTime });
  }
  return {
    clearedIds: [...clearedIds].sort(compareText),
    byDifficulty,
    totalClears: Math.max(clearedIds.size, validCounter(totalClears)),
    records,
    legacyBest,
  };
}

export function emptyStats() {
  return { clearedIds: [], byDifficulty: {}, totalClears: 0, records: {}, legacyBest: {} };
}

/** Normalize legacy totals and score records into a safe, deterministic shape. */
export function normalizeStats(stats, puzzles = []) {
  const source = isObject(stats) ? stats : {};
  const catalog = catalogDifficulties(puzzles);
  const records = {};
  const clearedIds = new Set();

  if (isObject(source.records)) {
    for (const puzzleId of Object.keys(source.records).sort(compareText)) {
      const candidate = source.records[puzzleId];
      if (!isPuzzleId(puzzleId) || !isObject(candidate) || !isDifficulty(candidate.difficulty)) continue;
      const difficulty = chooseDifficulty(candidate.difficulty, null, catalog[puzzleId]);
      if (!difficulty) continue;
      const elapsedTime = elapsedTimeOrNull(candidate.elapsedTime);
      const record = { difficulty, elapsedTime };
      const previous = records[puzzleId];
      defineMapValue(records, puzzleId, previous ? mergeRecord(previous, record, catalog[puzzleId]) : record);
      clearedIds.add(puzzleId);
    }
  }

  if (Array.isArray(source.clearedIds)) {
    for (const puzzleId of source.clearedIds) {
      if (!isPuzzleId(puzzleId)) continue;
      clearedIds.add(puzzleId);
      const difficulty = catalog[puzzleId];
      if (difficulty && !hasOwn(records, puzzleId)) {
        defineMapValue(records, puzzleId, { difficulty, elapsedTime: null });
      }
    }
  }

  const legacyBest = {};
  if (isObject(source.legacyBest)) {
    for (const difficulty of DIFFICULTIES) {
      if (!hasOwn(source.legacyBest, difficulty)) continue;
      const value = source.legacyBest[difficulty];
      if (isElapsedTime(value)) setMapValue(legacyBest, difficulty, value);
    }
  }

  // Old saves only have aggregate best times. Keep them separate because they
  // cannot be attributed to a specific puzzle record.
  const isLegacyAggregate = !hasOwn(source, 'records') && !hasOwn(source, 'legacyBest');
  if (isLegacyAggregate && isObject(source.byDifficulty)) {
    for (const difficulty of DIFFICULTIES) {
      const oldTier = source.byDifficulty[difficulty];
      if (!isObject(oldTier) || !isElapsedTime(oldTier.bestTime)) continue;
      const previous = legacyBest[difficulty];
      defineMapValue(legacyBest, difficulty, previous === undefined ? oldTier.bestTime : Math.min(previous, oldTier.bestTime));
    }
  }

  const countFloors = {};
  if (isObject(source.byDifficulty)) {
    for (const difficulty of DIFFICULTIES) {
      const tier = source.byDifficulty[difficulty];
      countFloors[difficulty] = isObject(tier) ? validCounter(tier.clears) : 0;
    }
  }
  const totalClears = validCounter(source.totalClears);
  const sortedRecords = {};
  for (const puzzleId of Object.keys(records).sort(compareText)) defineMapValue(sortedRecords, puzzleId, records[puzzleId]);
  return makeAggregate(sortedRecords, legacyBest, clearedIds, totalClears, countFloors);
}

/** Merge two device/account snapshots using puzzle identity and minimum known times. */
export function mergeStats(leftStats, rightStats, puzzles = []) {
  const left = normalizeStats(leftStats, puzzles);
  const right = normalizeStats(rightStats, puzzles);
  const catalog = catalogDifficulties(puzzles);
  const records = {};
  const allRecordIds = new Set([...Object.keys(left.records), ...Object.keys(right.records)]);
  for (const puzzleId of [...allRecordIds].sort(compareText)) {
    const record = mergeRecord(left.records[puzzleId], right.records[puzzleId], catalog[puzzleId]);
    if (record) defineMapValue(records, puzzleId, record);
  }

  const clearedIds = new Set([...left.clearedIds, ...right.clearedIds]);
  for (const puzzleId of Object.keys(records)) clearedIds.add(puzzleId);

  const leftCounts = recordCounts(left.records);
  const rightCounts = recordCounts(right.records);
  const mergedCounts = recordCounts(records);
  const countFloors = {};
  for (const difficulty of DIFFICULTIES) {
    const leftBaseline = Math.max(0, left.byDifficulty[difficulty]?.clears - leftCounts[difficulty] || 0);
    const rightBaseline = Math.max(0, right.byDifficulty[difficulty]?.clears - rightCounts[difficulty] || 0);
    countFloors[difficulty] = Math.max(leftBaseline, rightBaseline) + mergedCounts[difficulty];
  }

  const legacyBest = {};
  for (const difficulty of DIFFICULTIES) {
    const times = [left.legacyBest[difficulty], right.legacyBest[difficulty]].filter(isElapsedTime);
    if (times.length) defineMapValue(legacyBest, difficulty, Math.min(...times));
  }

  const leftTotalBaseline = Math.max(0, left.totalClears - left.clearedIds.length);
  const rightTotalBaseline = Math.max(0, right.totalClears - right.clearedIds.length);
  const totalClears = Math.max(leftTotalBaseline, rightTotalBaseline) + clearedIds.size;
  return makeAggregate(records, legacyBest, clearedIds, totalClears, countFloors);
}

/** Record one completed puzzle. Replays keep the better known time and never double-count. */
export function recordClear(stats, game) {
  const normalized = normalizeStats(stats);
  if (!isObject(game) || !isPuzzleId(game.puzzleId) || !isDifficulty(game.difficulty)) return normalized;
  const elapsedTime = elapsedTimeOrNull(game.elapsedTime);
  let mergeBase = normalized;
  if (normalized.clearedIds.includes(game.puzzleId) && !hasOwn(normalized.records, game.puzzleId)) {
    const tier = normalized.byDifficulty[game.difficulty];
    const knownTierRecords = recordCounts(normalized.records)[game.difficulty];
    if (tier && tier.clears > knownTierRecords) {
      mergeBase = {
        ...normalized,
        byDifficulty: {
          ...normalized.byDifficulty,
          [game.difficulty]: { ...tier, clears: tier.clears - 1 },
        },
      };
    }
  }
  const record = { difficulty: game.difficulty, elapsedTime };
  const oneClear = emptyStats();
  oneClear.clearedIds = [game.puzzleId];
  oneClear.totalClears = 1;
  defineMapValue(oneClear.records, game.puzzleId, record);
  defineMapValue(oneClear.byDifficulty, game.difficulty, {
    clears: 1,
    bestTime: elapsedTime,
  });
  return mergeStats(mergeBase, oneClear);
}
