import { DIFFICULTIES, THEMES } from './config.js';
import {
  createGame,
  getConflicts,
  getDisplayedCandidates,
  isComplete,
  redo,
  transact,
  undo,
} from './game/engine.js';
import { DEFAULT_SETTINGS, emptyStats, loadApp, recordClear, saveApp } from './data/storage.js';
import { awardExperience, mergeStats, normalizeStats } from './data/stats.js';
import { getExperience } from './data/experience.js';
import { createExperienceAnimator } from './ui/experience-animation.js';
import { createPlayFeedback } from './ui/play-feedback.js';
import { createAutoFillPresentation } from './ui/auto-fill-presentation.js';
import {
  emptyScoreProfiles,
  getGuestScoreCount,
  getProfileStats,
  importGuestScores,
  normalizeScoreProfiles,
  selectScoreProfile,
  updateProfileStats,
} from './data/score-profiles.js';
import {
  applySettingsSync,
  captureSettingsSync,
  getProfileSettings,
  getSettingsProfile,
  normalizeSettingsProfiles,
  selectSettingsProfile,
  updateProfileSettings,
} from './data/settings-profiles.js';
import { choosePuzzle, loadPuzzles, syncPuzzles } from './data/puzzle-repository.js';
import { formatDuration, renderApp } from './ui/render.js';
import { getKeypadState } from './ui/keypad.js';

const root = document.querySelector('#app');
const experienceAnimator = createExperienceAnimator();
const playFeedback = createPlayFeedback();
const autoFillPresentation = createAutoFillPresentation({
  onChange: () => render(),
  onFinish: () => { presentCompletion(); render(); },
});
const state = {
  view: 'loading',
  returnView: 'home',
  statsReturnView: 'home',
  currentGame: null,
  completionOpen: false,
  completionExperience: null,
  experienceGain: null,
  stats: emptyStats(),
  scoreProfiles: emptyScoreProfiles(),
  guestScoreCount: 0,
  account: null,
  cloud: { status: 'loading', busy: false, error: '' },
  settings: { ...DEFAULT_SETTINGS },
  settingsProfiles: normalizeSettingsProfiles(null),
  selectedCell: 0,
  inputMode: 'number',
  busy: false,
  saveError: false,
  syncError: false,
  loadError: false,
  sessionBlocked: false,
  storageReady: false,
  uiError: '',
  announce: '',
  updateWorker: null,
};

let ready = false;
let lastTap = null;
let clockStartedAt = null;
let clockBaseSeconds = 0;
let clockInterval = null;
let saveWorker = null;
let pendingWrite = null;
let requestedWrite = 0;
let completedWrite = 0;
let pendingUpdateAllowed = false;
let serviceWorkerRegistration = null;
let releaseSessionLock = null;
let sessionLockHeld = false;
let firebaseClient = null;
let firebaseClientPromise = null;
let firebaseAuthUnsubscribe = null;
let authGeneration = 0;
let scoreRevision = 0;
let scoreSyncRequested = false;
let scoreSyncWorker = null;
let scorePuzzles = [];
let scorePuzzlesPromise = null;
let completionPending = false;
const FIREBASE_CLIENT_TIMEOUT_MS = 12_000;

function presentCompletion(celebrate = true) {
  if (!completionPending) return;
  completionPending = false;
  state.completionOpen = true;
  state.announce = '完成しました';
  if (celebrate) playFeedback.celebrate();
  else state.experienceGain = null;
}

function settleAutoFill(renderNow = true) {
  const hadChain = autoFillPresentation.cancel();
  if (hadChain) playFeedback.cancel();
  presentCompletion(false);
  if (hadChain && renderNow) render();
}

function snapshot() {
  return JSON.parse(JSON.stringify({
    currentGame: state.currentGame,
    stats: state.stats,
    scoreProfiles: state.scoreProfiles,
    settings: state.settings,
    settingsProfiles: state.settingsProfiles,
  }));
}

function refreshGuestScoreCount() {
  state.guestScoreCount = getGuestScoreCount(state.scoreProfiles);
}

function updateActiveStats(stats, puzzles = scorePuzzles) {
  const key = state.scoreProfiles.activeKey || 'guest';
  state.scoreProfiles = updateProfileStats(state.scoreProfiles, key, stats, puzzles);
  state.stats = getProfileStats(state.scoreProfiles, key);
  scoreRevision += 1;
  refreshGuestScoreCount();
}

function activateScoreProfile(key, displayName) {
  const previousKey = state.scoreProfiles.activeKey || 'guest';
  const previousName = state.account?.uid === key ? state.account.displayName : '';
  state.scoreProfiles = selectScoreProfile(state.scoreProfiles, key, scorePuzzles);
  state.stats = getProfileStats(state.scoreProfiles, key);
  state.settingsProfiles = selectSettingsProfile(state.settingsProfiles, key);
  state.settings = getProfileSettings(state.settingsProfiles, key);
  state.account = key === 'guest'
    ? null
    : { uid: key, displayName: displayName || previousName || '保存済みアカウント' };
  if (previousKey !== key) {
    scoreRevision += 1;
    state.experienceGain = null;
    restoreCompletionExperience();
  }
  refreshGuestScoreCount();
  void queueSave();
}

function cloudFailure(message) {
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  state.cloud = {
    status: offline ? 'offline' : 'error',
    busy: false,
    error: message || 'Google同期に接続できません。成績と設定はこの端末に残っています。',
  };
  render();
}

function isCurrentCloudSession(uid, generation) {
  return authGeneration === generation
    && state.account?.uid === uid
    && state.scoreProfiles.activeKey === uid
    && state.settingsProfiles.activeKey === uid;
}

function changeSettings(patch) {
  const key = state.settingsProfiles.activeKey;
  state.settingsProfiles = updateProfileSettings(state.settingsProfiles, key, patch);
  state.settings = getProfileSettings(state.settingsProfiles, key);
  render();
  void queueSave();
  if (state.account?.uid) void requestScoreSync();
}

function updateCloudState(patch) {
  state.cloud = { ...state.cloud, ...patch };
  render();
}

function drainWrites() {
  if (saveWorker) return saveWorker;
  saveWorker = (async () => {
    while (pendingWrite) {
      const job = pendingWrite;
      pendingWrite = null;
      try {
        await saveApp(job.data);
        completedWrite = Math.max(completedWrite, job.version);
        state.saveError = false;
      } catch {
        state.saveError = true;
      }
      render();
    }
  })().finally(() => {
    saveWorker = null;
    if (pendingWrite) void drainWrites();
  });
  return saveWorker;
}

function queueSave() {
  if (!sessionLockHeld || !state.storageReady || state.sessionBlocked) return Promise.resolve();
  pendingWrite = { version: ++requestedWrite, data: snapshot() };
  return drainWrites();
}

async function flushWrites() {
  if (pendingWrite || saveWorker) await drainWrites();
  while (pendingWrite || saveWorker) await drainWrites();
  return !state.saveError && completedWrite >= requestedWrite;
}

function render() {
  if (globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) settleAutoFill(false);
  const theme = THEMES.find(item => item.id === state.settings.theme) || THEMES[0];
  document.documentElement.dataset.theme = theme.id;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.paper);
  renderApp(root, state, DIFFICULTIES, {
    displayed: getDisplayedCandidates,
    conflicts: getConflicts,
    isComplete,
    pad: getKeypadState,
    projectedGame: autoFillPresentation.project(state.currentGame),
    elapsed: currentElapsed(),
  });
  experienceAnimator.sync(root, state.view === 'game' && state.completionOpen ? state.experienceGain : null);
  playFeedback.sync(root, { visible: state.view === 'game' && document.visibilityState !== 'hidden', completionOpen: state.completionOpen });
}

function currentElapsed() {
  if (!state.currentGame) return 0;
  if (clockStartedAt === null) return state.currentGame.elapsedTime || 0;
  // Keep partial seconds across checkpoints and pauses; renderers round for display.
  return clockBaseSeconds + Math.max(0, Date.now() - clockStartedAt) / 1000;
}

function refreshTimerText() {
  const timer = root.querySelector('.game-timer');
  if (timer) timer.textContent = formatDuration(currentElapsed());
}

function saveClockSnapshot() {
  if (!state.currentGame || clockStartedAt === null) return;
  const now = Date.now();
  const elapsedTime = currentElapsed();
  state.currentGame = {
    ...state.currentGame,
    elapsedTime,
  };
  clockBaseSeconds = elapsedTime;
  clockStartedAt = now;
  void queueSave();
}

function startClock() {
  if (!state.currentGame || isComplete(state.currentGame) || state.view !== 'game' || document.visibilityState === 'hidden') return;
  if (clockStartedAt !== null) return;
  clockBaseSeconds = state.currentGame.elapsedTime || 0;
  clockStartedAt = Date.now();
  clearInterval(clockInterval);
  clockInterval = setInterval(() => {
    refreshTimerText();
    if (Date.now() - clockStartedAt >= 15_000) saveClockSnapshot();
  }, 1000);
  void queueSave();
}

function stopClock(persist = true) {
  clearInterval(clockInterval);
  clockInterval = null;
  if (clockStartedAt === null || !state.currentGame) return;
  const elapsedTime = currentElapsed();
  state.currentGame = {
    ...state.currentGame,
    elapsedTime,
  };
  clockStartedAt = null;
  clockBaseSeconds = elapsedTime;
  if (persist) void queueSave();
}

function changeView(view) {
  const oldView = state.view;
  if (view !== 'game') settleAutoFill(false);
  if (oldView === 'game' && view !== 'game') stopClock();
  if (view !== 'game') state.experienceGain = null;
  state.view = view;
  if (view === 'game' && oldView !== 'game') startClock();
  render();
}

function openSettings() {
  state.returnView = state.view;
  changeView('settings');
}

function openStats() {
  state.statsReturnView = state.view;
  changeView('stats');
}

function goBack() {
  const target = state.view === 'stats' ? state.statsReturnView : state.view === 'settings' ? state.returnView : 'home';
  state.uiError = '';
  changeView(target === 'game' && !state.currentGame ? 'home' : target);
}

function chooseInitialCell(game) {
  const index = game.currentBoard.findIndex((value, cell) => value === 0 && game.initialBoard[cell] === 0);
  return index >= 0 ? index : 0;
}

async function startNewGame(difficulty = state.currentGame?.difficulty) {
  if (!ready || state.busy || !DIFFICULTIES.includes(difficulty)) return;
  settleAutoFill(false);
  state.busy = true;
  state.uiError = '';
  render();
  try {
    const puzzles = await loadPuzzles();
    const puzzle = choosePuzzle(puzzles, difficulty, state.stats.clearedIds, state.currentGame?.puzzleId || null);
    const game = createGame(puzzle, { autoFill: state.settings.autoFill });
    if (isComplete(game)) throw new Error('Puzzle auto-completed at start');
    // The old board can still be played while a cold catalog load is pending.
    settleAutoFill(false);
    playFeedback.cancel();
    state.currentGame = game;
    state.completionOpen = false;
    state.completionExperience = null;
    state.experienceGain = null;
    state.announce = '';
    state.selectedCell = chooseInitialCell(game);
    state.inputMode = 'number';
    state.returnView = 'home';
    state.busy = false;
    clockStartedAt = null;
    clockBaseSeconds = game.elapsedTime || 0;
    state.view = 'game';
    if (document.visibilityState !== 'hidden') {
      autoFillPresentation.start(null, game);
      playFeedback.recordInitial(game);
    }
    startClock();
    render();
    void queueSave();
  } catch {
    state.uiError = '問題を準備できませんでした。保存済みの問題をもう一度読み込んでください。';
    state.busy = false;
    render();
  }
}

function resumeGame() {
  if (!state.currentGame) return;
  settleAutoFill(false);
  state.completionOpen = isComplete(state.currentGame);
  state.view = 'game';
  startClock();
  render();
}

function announce(text) {
  state.announce = text;
  render();
}

function restoreCompletionExperience() {
  const award = state.currentGame?.experienceAward;
  const total = award?.totalExp;
  state.completionExperience = award?.profileKey === state.scoreProfiles.activeKey
    && Number.isSafeInteger(total) && total >= 0
    ? { totalExp: total, level: Math.floor(total / 100) + 1, progress: total % 100 }
    : null;
}

function registerCompletedGame(game, earnExperience = false) {
  if (game.scoreRecorded) return game;
  const completedGame = { ...game, scoreRecorded: true };
  let nextStats = recordClear(state.stats, completedGame);
  // Only a newly completed play earns XP. Loading an old completed board never does.
  if (earnExperience) {
    const eventId = crypto.randomUUID();
    const from = getExperience(state.stats).totalExp;
    nextStats = awardExperience(nextStats, eventId, game.difficulty);
    const result = getExperience(nextStats);
    completedGame.experienceAward = { eventId, profileKey: state.scoreProfiles.activeKey, totalExp: result.totalExp };
    state.completionExperience = result;
    state.experienceGain = { eventId, from, to: result.totalExp };
  }
  updateActiveStats(nextStats);
  return completedGame;
}

function finishIfComplete(game) {
  if (!isComplete(game)) return false;
  const newlyCompleted = !game.scoreRecorded;
  const elapsedTime = Math.floor(currentElapsed());
  stopClock(false);
  state.currentGame = registerCompletedGame({
    ...state.currentGame,
    ...game,
    elapsedTime,
  }, true);
  state.view = 'game';
  completionPending = autoFillPresentation.isActive();
  state.completionOpen = !completionPending;
  state.announce = completionPending ? '' : '完成しました';
  if (!completionPending && newlyCompleted) playFeedback.celebrate();
  return true;
}

function commitGame(next, previous, input = null) {
  // Board actions, including no-ops, settle the previous projection before editing.
  settleAutoFill(next === previous);
  if (next === previous) return false;
  if (input) playFeedback.recordInput(previous, next, input.cell, input.digit, input.mode);
  else playFeedback.cancel();
  state.currentGame = next;
  if (input && state.view === 'game' && document.visibilityState !== 'hidden') autoFillPresentation.start(previous, next);
  if (finishIfComplete(next)) {
    render();
    void queueSave();
    void requestScoreSync();
    return true;
  }
  const filledCount = Array.isArray(next.lastAutoFilled) ? next.lastAutoFilled.length : 0;
  state.announce = filledCount ? `${filledCount}マスを自動入力しました` : '';
  render();
  void queueSave();
  return true;
}

function enterDigit(digit) {
  settleAutoFill();
  const game = state.currentGame;
  const cell = state.selectedCell;
  if (!game || isComplete(game) || !Number.isInteger(cell)) return;
  if (getKeypadState(game, cell, state.inputMode, state.settings.autoCandidates).find(key => key.digit === digit)?.disabled) return;
  const previous = game;
  const next = state.inputMode === 'memo'
    ? transact(game, { type: 'toggleCandidate', cell, value: digit, autoCandidates: state.settings.autoCandidates }, { autoFill: state.settings.autoFill })
    : transact(game, { type: 'set', cell, value: digit }, { autoFill: state.settings.autoFill });
  commitGame(next, previous, { cell, digit, mode: state.inputMode });
}

function deleteSelected() {
  settleAutoFill();
  if (!state.currentGame || !Number.isInteger(state.selectedCell)) return;
  const previous = state.currentGame;
  if (state.inputMode === 'memo' && previous.currentBoard[state.selectedCell] === 0) {
    commitGame(transact(previous, { type: 'clearNotes', cell: state.selectedCell }), previous);
    return;
  }
  commitGame(transact(previous, { type: 'delete', cell: state.selectedCell }), previous);
}

function clearSelectedNotes() {
  settleAutoFill();
  if (!state.currentGame || !Number.isInteger(state.selectedCell)) return;
  const previous = state.currentGame;
  if (commitGame(transact(previous, { type: 'clearNotes', cell: state.selectedCell }), previous)) {
    state.announce = '候補を消去しました';
    render();
  }
}

function selectCell(cell, event) {
  const now = performance.now();
  const isDouble = event?.detail > 0 && lastTap && lastTap.cell === cell && now - lastTap.time <= 360;
  state.selectedCell = cell;
  if (isDouble) {
    state.inputMode = state.inputMode === 'memo' ? 'number' : 'memo';
    state.announce = state.inputMode === 'memo' ? '候補メモに切り替えました' : '数字入力に切り替えました';
    lastTap = null;
  } else {
    lastTap = event?.detail > 0 ? { cell, time: now } : null;
    state.announce = '';
  }
  render();
}

function toggleInputMode() {
  state.inputMode = state.inputMode === 'memo' ? 'number' : 'memo';
  state.announce = state.inputMode === 'memo' ? '候補メモに切り替えました' : '数字入力に切り替えました';
  render();
}

async function loadFirebaseClientModule() {
  return import('./cloud/firebase-client.js');
}

function withTimeout(promise, timeoutMs = FIREBASE_CLIENT_TIMEOUT_MS) {
  let timer;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Optional cloud setup timed out')), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

async function loadScorePuzzleCatalog() {
  if (scorePuzzlesPromise) return scorePuzzlesPromise;
  scorePuzzlesPromise = loadPuzzles().then((puzzles) => {
    scorePuzzles = puzzles;
    const before = JSON.stringify(state.scoreProfiles);
    const profiles = normalizeScoreProfiles(state.scoreProfiles, state.scoreProfiles?.guest || state.stats, puzzles);
    if (JSON.stringify(profiles) !== before) {
      state.scoreProfiles = profiles;
      state.stats = getProfileStats(profiles);
      scoreRevision += 1;
      refreshGuestScoreCount();
      void queueSave();
      render();
      if (state.account?.uid) void requestScoreSync();
    }
    return scorePuzzles;
  }).catch(() => {
    scorePuzzlesPromise = null;
    scorePuzzles = [];
    return [];
  });
  return scorePuzzlesPromise;
}

function handleFirebaseAuthState(user) {
  authGeneration += 1;
  const uid = typeof user?.uid === 'string' && user.uid && user.uid !== 'guest' ? user.uid : null;
  scoreSyncRequested = Boolean(uid);
  state.cloud = uid
    ? { status: 'syncing', busy: true, error: '' }
    : { status: 'signed-out', busy: false, error: '' };
  activateScoreProfile(uid || 'guest', user?.displayName);
  render();
  if (uid) void requestScoreSync();
}

async function ensureFirebaseClient() {
  if (firebaseClient) return firebaseClient;
  if (firebaseClientPromise) return firebaseClientPromise;
  firebaseClientPromise = (async () => {
    const { createFirebaseClient } = await withTimeout(loadFirebaseClientModule());
    if (typeof createFirebaseClient !== 'function') throw new Error('Firebase adapter is unavailable');
    const client = await withTimeout(createFirebaseClient());
    if (!client || typeof client.onAuthStateChanged !== 'function'
      || typeof client.signIn !== 'function' || typeof client.signOut !== 'function'
      || typeof client.syncStats !== 'function' || typeof client.syncSettings !== 'function') {
      throw new Error('Firebase adapter has an incomplete interface');
    }
    firebaseClient = client;
    firebaseAuthUnsubscribe = client.onAuthStateChanged(handleFirebaseAuthState) || null;
    return client;
  })().catch((error) => {
    firebaseClient = null;
    firebaseClientPromise = null;
    cloudFailure('Google同期に接続できません。成績と設定はこの端末に残っています。');
    throw error;
  });
  return firebaseClientPromise;
}

async function prepareFirebaseClient() {
  try {
    await ensureFirebaseClient();
  } catch {
    // Local play and score profiles stay available when the optional cloud client fails.
  }
}

function requestScoreSync() {
  const uid = state.account?.uid;
  if (!uid || state.scoreProfiles.activeKey !== uid) return Promise.resolve(null);
  if (!firebaseClient) {
    return ensureFirebaseClient().then(() => requestScoreSync()).catch(() => null);
  }

  scoreSyncRequested = true;
  if (scoreSyncWorker) return scoreSyncWorker;
  state.cloud = { status: 'syncing', busy: true, error: '' };
  render();
  scoreSyncWorker = (async () => {
    while (scoreSyncRequested) {
      scoreSyncRequested = false;
      const currentUid = state.account?.uid;
      if (!currentUid || state.scoreProfiles.activeKey !== currentUid) break;
      const generation = authGeneration;

      try {
        const puzzles = await loadScorePuzzleCatalog();
        if (!isCurrentCloudSession(currentUid, generation)) continue;
        const revision = scoreRevision;
        const settingsRequest = captureSettingsSync(state.settingsProfiles, currentUid);
        const localStats = structuredClone(normalizeStats(
          getProfileStats(state.scoreProfiles, currentUid),
          puzzles,
        ));

        await queueSave();
        const locallyDurable = await flushWrites();
        if (!isCurrentCloudSession(currentUid, generation)) continue;
        if (!locallyDurable) {
          state.cloud = {
            status: 'error',
            busy: false,
            error: '成績と設定を端末に保存できません。保存後にもう一度同期してください。',
          };
          render();
          scoreSyncRequested = false;
          break;
        }
        if (scoreRevision !== revision || getSettingsProfile(state.settingsProfiles, currentUid).revision !== settingsRequest.revision) {
          scoreSyncRequested = true;
          continue;
        }

        if (navigator.onLine === false) {
          state.cloud = { status: 'offline', busy: false, error: '' };
          render();
          scoreSyncRequested = false;
          break;
        }

        const remoteStats = await firebaseClient.syncStats(currentUid, localStats);
        if (!isCurrentCloudSession(currentUid, generation)) continue;
        const remoteSettings = await firebaseClient.syncSettings(currentUid, settingsRequest.settings, settingsRequest.patch);
        if (!isCurrentCloudSession(currentUid, generation)) continue;
        const changedDuringRequest = scoreRevision !== revision;
        const normalizedRemote = normalizeStats(remoteStats, puzzles);
        const merged = changedDuringRequest
          ? mergeStats(getProfileStats(state.scoreProfiles, currentUid), normalizedRemote, puzzles)
          : normalizedRemote;
        state.scoreProfiles = updateProfileStats(state.scoreProfiles, currentUid, merged, puzzles);
        state.stats = getProfileStats(state.scoreProfiles, currentUid);
        state.settingsProfiles = applySettingsSync(state.settingsProfiles, currentUid, remoteSettings, settingsRequest);
        state.settings = getProfileSettings(state.settingsProfiles, currentUid);
        const settingsStillPending = Object.keys(getSettingsProfile(state.settingsProfiles, currentUid).pending).length > 0;
        scoreRevision += 1;
        refreshGuestScoreCount();
        render();

        await queueSave();
        const mergedLocallyDurable = await flushWrites();
        if (!isCurrentCloudSession(currentUid, generation)) continue;
        if (!mergedLocallyDurable) {
          state.cloud = {
            status: 'error',
            busy: false,
            error: '同期した成績と設定を端末に保存できませんでした。再試行してください。',
          };
          render();
          scoreSyncRequested = false;
          break;
        }
        if (changedDuringRequest || settingsStillPending) scoreSyncRequested = true;
        if (scoreSyncRequested) continue;
        state.cloud = { status: 'synced', busy: false, error: '' };
        render();
      } catch {
        if (!isCurrentCloudSession(currentUid, generation)) continue;
        scoreSyncRequested = false;
        cloudFailure('成績と設定をGoogleへ同期できませんでした。端末には保存されています。再試行できます。');
        break;
      }
    }
  })().finally(() => {
    scoreSyncWorker = null;
    if (scoreSyncRequested && state.account?.uid) void requestScoreSync();
  });
  return scoreSyncWorker;
}

async function signInToGoogle() {
  state.cloud = { ...state.cloud, status: 'loading', busy: true, error: '' };
  render();
  try {
    const client = await ensureFirebaseClient();
    const generation = authGeneration;
    state.cloud = { status: 'loading', busy: true, error: '' };
    render();
    const user = await client.signIn();
    if (authGeneration === generation && user?.uid) handleFirebaseAuthState(user);
    else if (authGeneration === generation) {
      state.cloud = { status: 'signed-out', busy: false, error: '' };
      render();
    }
  } catch {
    cloudFailure('Googleログインに失敗しました。接続を確認してもう一度お試しください。');
  }
}

async function signOutOfGoogle() {
  const uid = state.account?.uid;
  if (!uid) return;
  state.cloud = { ...state.cloud, busy: true, error: '' };
  render();
  try {
    const client = await ensureFirebaseClient();
    const generation = authGeneration;
    await client.signOut();
    if (authGeneration === generation) handleFirebaseAuthState(null);
  } catch {
    cloudFailure('Googleからログアウトできませんでした。もう一度お試しください。');
  }
}

async function importGuestScoresForAccount() {
  const uid = state.account?.uid;
  if (!uid || state.scoreProfiles.activeKey !== uid || state.guestScoreCount === 0) return;
  const generation = authGeneration;
  state.cloud = { status: 'syncing', busy: true, error: '' };
  render();
  try {
    const puzzles = await loadScorePuzzleCatalog();
    if (!isCurrentCloudSession(uid, generation)) return;
    state.scoreProfiles = importGuestScores(state.scoreProfiles, uid, puzzles);
    state.stats = getProfileStats(state.scoreProfiles, uid);
    scoreRevision += 1;
    refreshGuestScoreCount();
    render();
    await queueSave();
    const durable = await flushWrites();
    if (!isCurrentCloudSession(uid, generation)) return;
    if (!durable) {
      // Keep the latest in-memory results, including clears made while saving.
      // The failed atomic write leaves the previous durable snapshot intact.
      state.cloud = {
        status: 'error',
        busy: false,
        error: '取り込んだ成績を端末に保存できませんでした。保存を再試行してから同期してください。',
      };
      render();
      return;
    }
    void requestScoreSync();
  } catch {
    if (isCurrentCloudSession(uid, generation)) {
      state.cloud = {
        status: 'error',
        busy: false,
        error: 'ゲスト成績を取り込めませんでした。もう一度お試しください。',
      };
      render();
    }
  }
}

function runSync() {
  state.syncError = false;
  render();
  return syncPuzzles().then((result) => {
    state.syncError = Boolean(result?.offline);
    render();
    return result;
  }).catch(() => {
    state.syncError = true;
    render();
    return null;
  });
}

function activateUpdate() {
  void (async () => {
    const waiting = state.updateWorker || serviceWorkerRegistration?.waiting;
    if (!waiting) return;
    settleAutoFill();
    playFeedback.cancel();
    stopClock();
    const saved = await flushWrites();
    if (!saved) {
      state.saveError = true;
      if (state.view === 'game') startClock();
      render();
      return;
    }
    pendingUpdateAllowed = true;
    waiting.postMessage({ type: 'SKIP_WAITING' });
  })();
}

root.addEventListener('click', (event) => {
  const cellTarget = event.target.closest('[data-cell]');
  if (cellTarget && state.view === 'game') {
    selectCell(Number(cellTarget.dataset.cell), event);
    return;
  }
  const control = event.target.closest('[data-action]');
  if (!control) return;
  const action = control.dataset.action;
  if (state.view === 'game' && isComplete(state.currentGame)
    && ['digit', 'delete', 'clear-notes', 'undo', 'redo', 'toggle-mode'].includes(action)) return;
  if (action === 'new-game') void startNewGame(control.dataset.difficulty);
  else if (action === 'new-same') void startNewGame(state.currentGame?.difficulty);
  else if (action === 'resume') resumeGame();
  else if (action === 'home') { state.uiError = ''; changeView('home'); }
  else if (action === 'settings') openSettings();
  else if (action === 'stats') openStats();
  else if (action === 'back') goBack();
  else if (action === 'toggle-mode') toggleInputMode();
  else if (action === 'digit') enterDigit(Number(control.dataset.digit));
  else if (action === 'delete') deleteSelected();
  else if (action === 'clear-notes') clearSelectedNotes();
  else if (action === 'undo' && state.currentGame) commitGame(undo(state.currentGame), state.currentGame);
  else if (action === 'redo' && state.currentGame) commitGame(redo(state.currentGame), state.currentGame);
  else if (action === 'toggle-auto') {
    state.announce = state.settings.autoCandidates ? '自動候補表示をオフにしました' : '自動候補表示をオンにしました';
    changeSettings({ autoCandidates: !state.settings.autoCandidates });
  } else if (action === 'toggle-auto-fill') {
    state.announce = state.settings.autoFill ? '自動入力をオフにしました' : '自動入力をオンにしました';
    changeSettings({ autoFill: !state.settings.autoFill });
  } else if (action === 'set-theme' && THEMES.some(theme => theme.id === control.dataset.theme)) {
    changeSettings({ theme: control.dataset.theme });
  } else if (action === 'retry-save') void queueSave();
  else if (action === 'retry-sync') void runSync();
  else if (action === 'sign-in') void signInToGoogle();
  else if (action === 'sign-out') void signOutOfGoogle();
  else if (action === 'sync-scores') void requestScoreSync();
  else if (action === 'import-guest-scores') void importGuestScoresForAccount();
  else if (action === 'dismiss-error') { state.uiError = ''; render(); }
  else if (action === 'apply-update') activateUpdate();
  else if (action === 'retry-load') void initialize();
  else if (action === 'reload') window.location.reload();
  else if (action === 'dismiss-completion') { state.completionOpen = false; state.experienceGain = null; render(); }
});

root.addEventListener('keydown', (event) => {
  if (state.view !== 'game' || !state.currentGame) return;
  if (event.key === 'Escape' && state.completionOpen) {
    state.completionOpen = false;
    state.experienceGain = null;
    render();
    return;
  }
  if (isComplete(state.currentGame)) return;
  if (event.ctrlKey || event.metaKey) {
    if (event.key.toLowerCase() === 'z') {
      event.preventDefault();
      commitGame(event.shiftKey ? redo(state.currentGame) : undo(state.currentGame), state.currentGame);
    } else if (event.key.toLowerCase() === 'y') {
      event.preventDefault();
      commitGame(redo(state.currentGame), state.currentGame);
    }
    return;
  }
  if (/^[1-9]$/.test(event.key)) {
    event.preventDefault();
    enterDigit(Number(event.key));
    return;
  }
  if (event.key === 'Backspace' || event.key === 'Delete') {
    event.preventDefault();
    deleteSelected();
    return;
  }
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
    event.preventDefault();
    const row = Math.floor(state.selectedCell / 9);
    const col = state.selectedCell % 9;
    const nextRow = Math.max(0, Math.min(8, row + (event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0)));
    const nextCol = Math.max(0, Math.min(8, col + (event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0)));
    state.selectedCell = nextRow * 9 + nextCol;
    state.announce = `${nextRow + 1}行${nextCol + 1}列`;
    render();
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    settleAutoFill(false);
    playFeedback.cancel();
    stopClock();
    void queueSave();
    render();
  } else {
    if (state.view === 'game') startClock();
    if (state.account?.uid) void requestScoreSync();
  }
});

window.addEventListener('online', () => {
  if (state.account?.uid) void requestScoreSync();
  else if (!firebaseClient) void prepareFirebaseClient();
  void runSync();
});

window.addEventListener('pagehide', () => {
  settleAutoFill(false);
  playFeedback.cancel();
  stopClock();
  void queueSave();
  void flushWrites();
  render();
});

globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').addEventListener?.('change', (event) => {
  if (!event.matches) return;
  settleAutoFill(false);
  playFeedback.cancel();
  render();
});

const appServiceWorkerUrl = new URL('../sw.js', import.meta.url).href;

function isControlledByThisApp(registration) {
  return navigator.serviceWorker.controller?.scriptURL === appServiceWorkerUrl
    && registration.active?.scriptURL === appServiceWorkerUrl;
}

function watchServiceWorker(registration) {
  serviceWorkerRegistration = registration;
  if (registration.waiting && isControlledByThisApp(registration)) {
    state.updateWorker = registration.waiting;
    render();
  }
  registration.addEventListener('updatefound', () => {
    const worker = registration.installing;
    if (!worker) return;
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed' && registration.waiting && isControlledByThisApp(registration)) {
        state.updateWorker = registration.waiting;
        render();
      }
    });
  });
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register(new URL('../sw.js', import.meta.url), { scope: new URL('../', import.meta.url).pathname })
    .then(watchServiceWorker)
    .catch(() => {});
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (pendingUpdateAllowed) window.location.reload();
  });
}

async function acquireSessionLock() {
  if (sessionLockHeld) return true;
  if (!navigator.locks?.request) {
    sessionLockHeld = true;
    return true;
  }
  let resolveClaim;
  const claimed = new Promise((resolve) => { resolveClaim = resolve; });
  const hold = new Promise((resolve) => { releaseSessionLock = resolve; });
  navigator.locks.request('sudoku-v1-writable-session', { mode: 'exclusive', ifAvailable: true }, async (lock) => {
    if (!lock) {
      resolveClaim(false);
      return;
    }
    sessionLockHeld = true;
    resolveClaim(true);
    await hold;
  }).catch(() => resolveClaim(false));
  return claimed;
}

async function initialize() {
  settleAutoFill(false);
  playFeedback.cancel();
  state.view = 'loading';
  state.loadError = false;
  state.sessionBlocked = false;
  render();
  try {
    const ownsSession = await acquireSessionLock();
    if (!ownsSession) {
      state.sessionBlocked = true;
      state.view = 'home';
      render();
      return;
    }
    const saved = await loadApp();
    state.currentGame = saved.currentGame || null;
    state.scoreProfiles = normalizeScoreProfiles(saved.scoreProfiles, saved.stats || emptyStats());
    state.stats = getProfileStats(state.scoreProfiles);
    const cachedKey = state.scoreProfiles.activeKey;
    state.account = cachedKey === 'guest'
      ? null
      : { uid: cachedKey, displayName: '保存済みアカウント' };
    refreshGuestScoreCount();
    state.settingsProfiles = normalizeSettingsProfiles(saved.settingsProfiles, saved.settings, cachedKey);
    state.settings = getProfileSettings(state.settingsProfiles);
    state.storageReady = true;
    let initializationNeedsSave = JSON.stringify(saved.scoreProfiles || null) !== JSON.stringify(state.scoreProfiles)
      || JSON.stringify(saved.settingsProfiles || null) !== JSON.stringify(state.settingsProfiles);
    if (state.currentGame && isComplete(state.currentGame)) {
      const previousGame = state.currentGame;
      state.currentGame = registerCompletedGame(state.currentGame);
      restoreCompletionExperience();
      initializationNeedsSave ||= previousGame !== state.currentGame;
      state.view = 'game';
      state.completionOpen = true;
    } else {
      state.view = 'home';
    }
    ready = true;
    render();
    if (initializationNeedsSave) void queueSave();
    void loadScorePuzzleCatalog();
    void prepareFirebaseClient();
    void runSync();
  } catch {
    state.view = 'home';
    state.loadError = true;
    state.storageReady = false;
    ready = false;
    render();
  }
}

void initialize();
