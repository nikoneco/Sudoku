import { DIFFICULTIES } from '../config.js';
import { readValue, writeValue } from './storage.js';
import { requestApi } from './api.js';
import { getConflicts } from '../game/engine.js';
import { getRegions, isValidRegions } from '../game/regions.js';

const modes = ['normal', 'jigsaw'];
const memory = new Map();
const loads = new Map();
const syncs = new Map();
const cacheKey = mode => mode === 'normal' ? 'dataset' : 'dataset-jigsaw';
function assertMode(mode) {
  if (!modes.includes(mode)) throw new TypeError('Unknown puzzle mode');
}

/** Validate public puzzle metadata and givens, independently of manual notes. */
export function isValidPuzzle(row) {
  if (!row || typeof row.puzzleId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(row.puzzleId)
    || !DIFFICULTIES.includes(row.difficulty) || !/^[0-9]{81}$/.test(row.puzzle)) return false;
  const mode = row.mode ?? 'normal';
  if (!modes.includes(mode) || (mode === 'jigsaw') !== row.puzzleId.startsWith('jigsaw_')) return false;
  if (mode === 'jigsaw' && !isValidRegions(row.regions)) return false;
  if (mode === 'normal' && row.regions !== undefined) return false;
  const board = [...row.puzzle].map(Number);
  if (board.every(n => n === 0) || board.every(n => n !== 0)) return false;
  try { return getConflicts(board, getRegions(row)).length === 0; } catch { return false; }
}

export function validateDataset(data, mode = 'normal') {
  assertMode(mode);
  if (data?.schemaVersion !== 1 || !Number.isInteger(data.datasetVersion) || data.datasetVersion < 1 || !Array.isArray(data.puzzles)) throw new Error('問題集の形式が不正です。');
  const seen = new Set();
  const puzzles = data.puzzles.filter(p => {
    if (!isValidPuzzle(p) || (p.mode ?? 'normal') !== mode || seen.has(p.puzzleId)) { console.warn('不正な問題を除外しました。'); return false; }
    seen.add(p.puzzleId); return true;
  }).map(({ puzzleId, difficulty, puzzle, regions }) => mode === 'jigsaw'
    ? { puzzleId, difficulty, puzzle, mode, regions } : { puzzleId, difficulty, puzzle });
  if (!DIFFICULTIES.every(tier => puzzles.some(p => p.difficulty === tier))) throw new Error('難易度ごとの問題が不足しています。');
  return { schemaVersion: 1, datasetVersion: data.datasetVersion, puzzles };
}

export function loadPuzzles(mode = 'normal') {
  assertMode(mode);
  if (memory.has(mode)) return Promise.resolve(memory.get(mode).puzzles);
  if (loads.has(mode)) return loads.get(mode);
  const loading = (async () => {
    let stored;
    try { stored = await readValue(cacheKey(mode)); } catch (error) { console.warn('問題キャッシュの読み込み失敗', error); }
    if (stored) {
      try { const valid = validateDataset(stored, mode); memory.set(mode, valid); return valid.puzzles; } catch (error) { console.warn(error); }
    }
    const file = mode === 'normal' ? 'puzzles.json' : 'puzzles-jigsaw.json';
    const response = await fetch(new URL(`../../data/${file}`, import.meta.url));
    if (!response.ok) throw new Error('問題集を読み込めません。通信を確認して開き直してください。');
    const valid = validateDataset(await response.json(), mode);
    memory.set(mode, valid);
    try { await writeValue(cacheKey(mode), valid); } catch (error) { console.warn('問題集を保存できませんでした。', error); }
    return valid.puzzles;
  })().finally(() => loads.delete(mode));
  loads.set(mode, loading);
  return loading;
}

export function syncPuzzles(mode = 'normal') {
  assertMode(mode);
  if (syncs.has(mode)) return syncs.get(mode);
  const syncing = (async () => {
    await loadPuzzles(mode);
    const current = memory.get(mode);
    const result = await requestApi('sync', { version: current.datasetVersion, ...(mode === 'jigsaw' ? { mode } : {}) });
    if (result.unchanged) return { updated: false, count: current.puzzles.length };
    const updated = validateDataset(result, mode);
    if (updated.datasetVersion < current.datasetVersion) return { updated: false, count: current.puzzles.length };
    await writeValue(cacheKey(mode), updated);
    memory.set(mode, updated);
    return { updated: true, count: updated.puzzles.length };
  })().finally(() => syncs.delete(mode));
  syncs.set(mode, syncing);
  return syncing;
}

export function choosePuzzle(puzzles, difficulty, clearedIds = [], currentPuzzleId = null, mode = 'normal') {
  assertMode(mode);
  const tier = puzzles.filter(p => p.difficulty === difficulty && (p.mode ?? 'normal') === mode);
  if (!tier.length) throw new Error('この難易度の問題がありません。');
  const alternatives = tier.filter(p => p.puzzleId !== currentPuzzleId);
  const eligible = alternatives.length ? alternatives : tier;
  const cleared = new Set(clearedIds);
  const uncleared = eligible.filter(p => !cleared.has(p.puzzleId));
  const pool = uncleared.length ? uncleared : eligible;
  return pool[Math.floor(Math.random() * pool.length)];
}
