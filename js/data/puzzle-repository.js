import { DIFFICULTIES } from '../config.js';
import { readValue, writeValue } from './storage.js';
import { requestApi } from './api.js';

/** Validate client data structure and givens before using or caching a dataset. */
export function isValidPuzzle(row) {
  if (!row || typeof row.puzzleId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(row.puzzleId) || !DIFFICULTIES.includes(row.difficulty) || !/^[0-9]{81}$/.test(row.puzzle)) return false;
  const board = [...row.puzzle].map(Number);
  if (board.every(n => n === 0) || board.every(n => n !== 0)) return false;
  for (let i = 0; i < 81; i++) for (let j = i + 1; j < 81; j++) {
    if (!board[i] || board[i] !== board[j]) continue;
    if (Math.floor(i / 9) === Math.floor(j / 9) || i % 9 === j % 9 || Math.floor(i / 27) === Math.floor(j / 27) && Math.floor(i % 9 / 3) === Math.floor(j % 9 / 3)) return false;
  }
  return true;
}

export function validateDataset(data) {
  if (data?.schemaVersion !== 1 || !Number.isInteger(data.datasetVersion) || data.datasetVersion < 1 || !Array.isArray(data.puzzles)) throw new Error('問題集の形式が不正です。');
  const seen = new Set();
  const puzzles = data.puzzles.filter(p => {
    if (!isValidPuzzle(p) || seen.has(p.puzzleId)) { console.warn('不正な問題を除外しました。'); return false; }
    seen.add(p.puzzleId); return true;
  }).map(({ puzzleId, difficulty, puzzle }) => ({ puzzleId, difficulty, puzzle }));
  if (!DIFFICULTIES.every(tier => puzzles.some(p => p.difficulty === tier))) throw new Error('難易度ごとの問題が不足しています。');
  return { schemaVersion: 1, datasetVersion: data.datasetVersion, puzzles };
}

let memory;
export async function loadPuzzles() {
  if (memory) return memory.puzzles;
  let stored;
  try { stored = await readValue('dataset'); } catch (error) { console.warn('問題キャッシュの読み込み失敗', error); }
  if (stored) {
    try { memory = validateDataset(stored); return memory.puzzles; } catch (error) { console.warn(error); }
  }
  const response = await fetch(new URL('../../data/puzzles.json', import.meta.url));
  if (!response.ok) throw new Error('問題集を読み込めません。通信を確認して開き直してください。');
  memory = validateDataset(await response.json());
  // A playable bundled dataset should remain usable even when device storage is full.
  try { await writeValue('dataset', memory); } catch (error) { console.warn('問題集を保存できませんでした。', error); }
  return memory.puzzles;
}

let syncInFlight;
export function syncPuzzles() {
  if (syncInFlight) return syncInFlight;
  syncInFlight = (async () => {
    await loadPuzzles();
    const result = await requestApi('sync', { version: memory.datasetVersion });
    if (result.unchanged) return { updated: false, count: memory.puzzles.length };
    const updated = validateDataset(result);
    if (updated.datasetVersion < memory.datasetVersion) return { updated: false, count: memory.puzzles.length };
    await writeValue('dataset', updated);
    memory = updated;
    return { updated: true, count: memory.puzzles.length };
  })().finally(() => { syncInFlight = null; });
  return syncInFlight;
}

export function choosePuzzle(puzzles, difficulty, clearedIds = [], currentPuzzleId = null) {
  const tier = puzzles.filter(p => p.difficulty === difficulty);
  if (!tier.length) throw new Error('この難易度の問題がありません。');
  const alternatives = tier.filter(p => p.puzzleId !== currentPuzzleId);
  const eligible = alternatives.length ? alternatives : tier;
  const cleared = new Set(clearedIds);
  const uncleared = eligible.filter(p => !cleared.has(p.puzzleId));
  const pool = uncleared.length ? uncleared : eligible;
  return pool[Math.floor(Math.random() * pool.length)];
}
