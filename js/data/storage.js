import { DIFFICULTIES } from '../config.js';
import { emptyStats, normalizeStats, recordClear } from './stats.js';
import {
  emptyScoreProfiles,
  getProfileStats,
  normalizeScoreProfiles,
  selectScoreProfile,
  updateProfileStats,
} from './score-profiles.js';

import { DEFAULT_SETTINGS, getProfileSettings, normalizeSettingsProfiles } from './settings-profiles.js';
import { NORMAL_REGIONS, isValidRegions } from '../game/regions.js';

export { DEFAULT_SETTINGS };
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
  if (game.mode !== undefined && !['normal', 'jigsaw'].includes(game.mode)) return false;
  if (game.mode === 'jigsaw') {
    if (!game.puzzleId.startsWith('jigsaw_') || !isValidRegions(game.regions)) return false;
  } else if (game.puzzleId.startsWith('jigsaw_') || (game.regions !== undefined && game.regions !== NORMAL_REGIONS)) return false;
  if (game.hintsUsed !== undefined && (!Number.isInteger(game.hintsUsed) || game.hintsUsed < 0 || game.hintsUsed > 5)) return false;
  if (game.lastHint !== undefined && game.lastHint !== null) {
    const hint = game.lastHint;
    if (!hint || typeof hint !== 'object' || typeof hint.board !== 'string' || !/^[0-9]{81}$/.test(hint.board)
      || !Number.isInteger(hint.cell) || hint.cell < 0 || hint.cell > 80
      || !Number.isInteger(hint.digit) || hint.digit < 1 || hint.digit > 9
      || !Number.isInteger(game.hintsUsed) || game.hintsUsed < 1) return false;
  }
  const validSnapshot = s => s && validArray(s.currentBoard, 9) && validArray(s.manualIncludedCandidates, 511) && validArray(s.manualExcludedCandidates, 511) && Array.isArray(s.sources) && s.sources.length === 81 && s.sources.every(x => typeof x === 'string') && game.initialBoard.every((n, i) => !n || n === s.currentBoard[i]);
  return validArray(game.initialBoard, 9) && validSnapshot(game) && Number.isFinite(game.elapsedTime) && game.elapsedTime >= 0 && typeof game.startedAt === 'string' && Array.isArray(game.undoStack) && Array.isArray(game.redoStack) && game.undoStack.length <= 100 && game.redoStack.length <= 100 && game.undoStack.every(validSnapshot) && game.redoStack.every(validSnapshot);
}

function currentGamesFor(app) {
  const slots = { normal: null, jigsaw: null, ...app.currentGames };
  if (Object.keys(slots).some(mode => !['normal', 'jigsaw'].includes(mode))) throw new Error('途中データのモードが不正です。');
  for (const mode of ['normal', 'jigsaw']) {
    const game = slots[mode];
    if (!validateGame(game) || (game && (game.mode || 'normal') !== mode)) throw new Error('途中データを読み込めませんでした。保存データは保持されています。');
  }
  if (app.currentGame !== null && app.currentGame !== undefined) {
    if (!validateGame(app.currentGame)) throw new Error('保存する盤面が不正です。');
    slots[app.currentGame.mode || 'normal'] = app.currentGame;
  }
  return slots;
}

export async function loadApp() {
  const saved = await readValue('app');
  if (!saved) {
    const scoreProfiles = emptyScoreProfiles();
    const settingsProfiles = normalizeSettingsProfiles(null);
    return {
      currentGame: null,
      currentGames: { normal: null, jigsaw: null },
      stats: scoreProfiles.guest,
      scoreProfiles,
      settingsProfiles,
      settings: getProfileSettings(settingsProfiles),
    };
  }
  if (!validateGame(saved.currentGame)) throw new Error('途中データを読み込めませんでした。保存データは保持されています。');
  const currentGames = currentGamesFor(saved);
  const legacyStats = normalizeStats(saved.stats || emptyStats());
  const scoreProfiles = normalizeScoreProfiles(saved.scoreProfiles, legacyStats);
  const settingsProfiles = normalizeSettingsProfiles(saved.settingsProfiles, saved.settings, scoreProfiles.activeKey);
  return {
    currentGame: saved.currentGame,
    currentGames,
    stats: getProfileStats(scoreProfiles),
    scoreProfiles,
    settingsProfiles,
    settings: getProfileSettings(settingsProfiles),
  };
}

export function saveApp(app) {
  if (!validateGame(app.currentGame)) return Promise.reject(new Error('保存する盤面が不正です。'));
  let currentGames;
  try { currentGames = currentGamesFor(app); } catch (error) { return Promise.reject(error); }
  const profileSource = app.scoreProfiles;
  let scoreProfiles = normalizeScoreProfiles(profileSource, app.stats || emptyStats());
  const activeKey = profileSource?.activeKey || 'guest';
  scoreProfiles = selectScoreProfile(scoreProfiles, activeKey);
  if (app.stats !== undefined) {
    scoreProfiles = updateProfileStats(scoreProfiles, activeKey, app.stats);
  }
  const settingsProfiles = normalizeSettingsProfiles(app.settingsProfiles, app.settings, activeKey);
  return writeValue('app', {
    ...app,
    currentGames,
    stats: scoreProfiles.guest,
    scoreProfiles,
    settingsProfiles,
    settings: getProfileSettings(settingsProfiles),
  });
}
