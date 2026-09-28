import { DIFFICULTIES, THEMES } from '../config.js';
import { emptyStats, normalizeStats, recordClear } from './stats.js';
import {
  emptyScoreProfiles,
  getProfileStats,
  normalizeScoreProfiles,
  selectScoreProfile,
  updateProfileStats,
} from './score-profiles.js';

export const DEFAULT_SETTINGS = Object.freeze({ autoCandidates: true, theme: 'classic' });
export { emptyStats, recordClear };
let database;
let writeQueue = Promise.resolve();

/** One database, atomic app snapshots; a failed write never poisons later saves. */
function openDatabase() {
  if (database) return database;
  database = new Promise((resolve, reject) => {
    const request = indexedDB.open('sudoku-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('kv');
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('別のタブを閉じてから開き直してください。'));
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); database = null; };
      resolve(db);
    };
  }).catch(error => { database = null; throw error; });
  return database;
}

export async function readValue(key) {
  await writeQueue;
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('kv', 'readonly');
    const request = tx.objectStore('kv').get(key);
    tx.oncomplete = () => resolve(request.result);
    tx.onabort = () => reject(tx.error || new Error('読み込みに失敗しました。'));
    tx.onerror = () => reject(tx.error);
  });
}

export function writeValue(key, value) {
  const snapshot = structuredClone(value);
  const next = writeQueue.then(async () => {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(snapshot, key);
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error || new Error('保存に失敗しました。'));
      tx.onerror = () => reject(tx.error);
    });
  });
  writeQueue = next.catch(() => {});
  return next;
}

function validArray(value, max) {
  return Array.isArray(value) && value.length === 81 && value.every(n => Number.isInteger(n) && n >= 0 && n <= max);
}

/** Reject damaged save data without silently replacing it on load. */
export function validateGame(game) {
  if (game === null) return true;
  if (!game || typeof game.puzzleId !== 'string' || !DIFFICULTIES.includes(game.difficulty)) return false;
  const validSnapshot = s => s && validArray(s.currentBoard, 9) && validArray(s.manualIncludedCandidates, 511) && validArray(s.manualExcludedCandidates, 511) && Array.isArray(s.sources) && s.sources.length === 81 && s.sources.every(x => typeof x === 'string') && game.initialBoard.every((n, i) => !n || n === s.currentBoard[i]);
  return validArray(game.initialBoard, 9) && validSnapshot(game) && Number.isFinite(game.elapsedTime) && game.elapsedTime >= 0 && typeof game.startedAt === 'string' && Array.isArray(game.undoStack) && Array.isArray(game.redoStack) && game.undoStack.length <= 100 && game.redoStack.length <= 100 && game.undoStack.every(validSnapshot) && game.redoStack.every(validSnapshot);
}

export async function loadApp() {
  const saved = await readValue('app');
  if (!saved) {
    const scoreProfiles = emptyScoreProfiles();
    return {
      currentGame: null,
      stats: scoreProfiles.guest,
      scoreProfiles,
      settings: { ...DEFAULT_SETTINGS },
    };
  }
  if (!validateGame(saved.currentGame)) throw new Error('途中データを読み込めませんでした。保存データは保持されています。');
  const settings = { ...DEFAULT_SETTINGS, ...saved.settings };
  if (!THEMES.some(theme => theme.id === settings.theme)) settings.theme = DEFAULT_SETTINGS.theme;
  const legacyStats = normalizeStats(saved.stats || emptyStats());
  const scoreProfiles = normalizeScoreProfiles(saved.scoreProfiles, legacyStats);
  return {
    currentGame: saved.currentGame,
    stats: getProfileStats(scoreProfiles),
    scoreProfiles,
    settings,
  };
}

export function saveApp(app) {
  if (!validateGame(app.currentGame)) return Promise.reject(new Error('保存する盤面が不正です。'));
  const profileSource = app.scoreProfiles;
  let scoreProfiles = normalizeScoreProfiles(profileSource, app.stats || emptyStats());
  const activeKey = profileSource?.activeKey || 'guest';
  scoreProfiles = selectScoreProfile(scoreProfiles, activeKey);
  if (app.stats !== undefined) {
    scoreProfiles = updateProfileStats(scoreProfiles, activeKey, app.stats);
  }
  return writeValue('app', {
    ...app,
    stats: scoreProfiles.guest,
    scoreProfiles,
  });
}
