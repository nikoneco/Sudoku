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
import { choosePuzzle, loadPuzzles, syncPuzzles } from './data/puzzle-repository.js';
import { formatDuration, renderApp } from './ui/render.js';
import { getKeypadState } from './ui/keypad.js';

const root = document.querySelector('#app');
const state = {
  view: 'loading',
  returnView: 'home',
  statsReturnView: 'home',
  currentGame: null,
  completionOpen: false,
  stats: emptyStats(),
  settings: { ...DEFAULT_SETTINGS },
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

function snapshot() {
  return JSON.parse(JSON.stringify({ currentGame: state.currentGame, stats: state.stats, settings: state.settings }));
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
  const theme = THEMES.find(item => item.id === state.settings.theme) || THEMES[0];
  document.documentElement.dataset.theme = theme.id;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.paper);
  renderApp(root, state, DIFFICULTIES, {
    displayed: getDisplayedCandidates,
    conflicts: getConflicts,
    isComplete,
    pad: getKeypadState,
    elapsed: currentElapsed(),
  });
}

function currentElapsed() {
  if (!state.currentGame) return 0;
  if (clockStartedAt === null) return state.currentGame.elapsedTime || 0;
  return clockBaseSeconds + Math.floor((Date.now() - clockStartedAt) / 1000);
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

function stopClock() {
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
  void queueSave();
}

function changeView(view) {
  const oldView = state.view;
  if (oldView === 'game' && view !== 'game') stopClock();
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
  state.busy = true;
  state.uiError = '';
  render();
  try {
    const puzzles = await loadPuzzles();
    const puzzle = choosePuzzle(puzzles, difficulty, state.stats.clearedIds, state.currentGame?.puzzleId || null);
    const game = createGame(puzzle);
    if (isComplete(game)) throw new Error('Puzzle auto-completed at start');
    state.currentGame = game;
    state.completionOpen = false;
    state.selectedCell = chooseInitialCell(game);
    state.inputMode = 'number';
    state.returnView = 'home';
    state.busy = false;
    clockStartedAt = null;
    clockBaseSeconds = game.elapsedTime || 0;
    state.view = 'game';
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
  state.completionOpen = isComplete(state.currentGame);
  state.view = 'game';
  startClock();
  render();
}

function announce(text) {
  state.announce = text;
  render();
}

function finishIfComplete(game) {
  if (!isComplete(game)) return false;
  stopClock();
  state.currentGame = { ...state.currentGame, ...game, elapsedTime: currentElapsed() };
  state.stats = recordClear(state.stats, state.currentGame);
  state.view = 'game';
  state.completionOpen = true;
  state.announce = '完成しました';
  return true;
}

function commitGame(next, previous) {
  if (next === previous) return false;
  state.currentGame = next;
  if (finishIfComplete(next)) {
    render();
    void queueSave();
    return true;
  }
  const filledCount = Array.isArray(next.lastAutoFilled) ? next.lastAutoFilled.length : 0;
  state.announce = filledCount ? `${filledCount}マスを自動入力しました` : '';
  render();
  void queueSave();
  return true;
}

function enterDigit(digit) {
  const game = state.currentGame;
  const cell = state.selectedCell;
  if (!game || isComplete(game) || !Number.isInteger(cell)) return;
  if (getKeypadState(game, cell, state.inputMode, state.settings.autoCandidates).find(key => key.digit === digit)?.disabled) return;
  const previous = game;
  const next = state.inputMode === 'memo'
    ? transact(game, { type: 'toggleCandidate', cell, value: digit, autoCandidates: state.settings.autoCandidates })
    : transact(game, { type: 'set', cell, value: digit });
  commitGame(next, previous);
}

function deleteSelected() {
  if (!state.currentGame || !Number.isInteger(state.selectedCell)) return;
  const previous = state.currentGame;
  if (state.inputMode === 'memo' && previous.currentBoard[state.selectedCell] === 0) {
    commitGame(transact(previous, { type: 'clearNotes', cell: state.selectedCell }), previous);
    return;
  }
  commitGame(transact(previous, { type: 'delete', cell: state.selectedCell }), previous);
}

function clearSelectedNotes() {
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
    state.settings = { ...state.settings, autoCandidates: !state.settings.autoCandidates };
    state.announce = state.settings.autoCandidates ? '自動候補表示をオンにしました' : '自動候補表示をオフにしました';
    render();
    void queueSave();
  } else if (action === 'set-theme' && THEMES.some(theme => theme.id === control.dataset.theme)) {
    state.settings = { ...state.settings, theme: control.dataset.theme };
    render();
    void queueSave();
  } else if (action === 'retry-save') void queueSave();
  else if (action === 'retry-sync') void runSync();
  else if (action === 'dismiss-error') { state.uiError = ''; render(); }
  else if (action === 'apply-update') activateUpdate();
  else if (action === 'retry-load') void initialize();
  else if (action === 'reload') window.location.reload();
  else if (action === 'dismiss-completion') { state.completionOpen = false; render(); }
});

root.addEventListener('keydown', (event) => {
  if (state.view !== 'game' || !state.currentGame) return;
  if (event.key === 'Escape' && state.completionOpen) {
    state.completionOpen = false;
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
    stopClock();
    void queueSave();
  } else if (state.view === 'game') startClock();
});

window.addEventListener('pagehide', () => {
  stopClock();
  void queueSave();
  void flushWrites();
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
    state.stats = saved.stats || emptyStats();
    state.settings = { ...DEFAULT_SETTINGS, ...(saved.settings || {}) };
    state.storageReady = true;
    if (state.currentGame && isComplete(state.currentGame)) {
      state.stats = recordClear(state.stats, state.currentGame);
      state.view = 'game';
      state.completionOpen = true;
      void queueSave();
    } else {
      state.view = 'home';
    }
    ready = true;
    render();
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
