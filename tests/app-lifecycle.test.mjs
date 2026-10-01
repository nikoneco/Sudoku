import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { DIFFICULTIES, THEMES } from '../js/config.js';
import { awardExperience, emptyStats, mergeStats, normalizeStats, recordClear } from '../js/data/stats.js';
import { getExperience } from '../js/data/experience.js';
import { formatDuration } from '../js/ui/render.js';
import { webcrypto } from 'node:crypto';
import * as engine from '../js/game/engine.js';
import { createAutoFillPresentation } from '../js/ui/auto-fill-presentation.js';
import { getKeypadState } from '../js/ui/keypad.js';
import {
  emptyScoreProfiles,
  getGuestScoreCount,
  getProfileStats,
  importGuestScores,
  normalizeScoreProfiles,
  selectScoreProfile,
  updateProfileStats,
} from '../js/data/score-profiles.js';
import {
  DEFAULT_SETTINGS, applySettingsSync, captureSettingsSync, getProfileSettings, getSettingsProfile,
  normalizeSettingsProfiles, selectSettingsProfile, updateProfileSettings,
} from '../js/data/settings-profiles.js';

const source = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8')
  .replace(/^import\s[\s\S]*?from\s+'[^']+';\s*/gm, '')
  .replaceAll("return import('./cloud/firebase-client.js');", 'return loadCloudModule();')
  .replaceAll('import.meta.url', JSON.stringify('http://localhost/Sudoku/js/app.js'));

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function makeCloud({ initialUser = null, users = [], syncStats = async (_uid, stats) => stats,
  syncSettings = null, settingsDocuments = {} } = {}) {
  let authListener = null;
  let signInIndex = 0;
  const calls = [];
  const settingsCalls = [];
  const preferences = new Map(Object.entries(settingsDocuments));
  const client = {
    onAuthStateChanged(listener) {
      authListener = listener;
      queueMicrotask(() => listener(initialUser));
      return () => { authListener = null; };
    },
    async signIn() {
      const user = users[signInIndex++] || null;
      authListener?.(user);
      return user;
    },
    async signOut() {
      authListener?.(null);
    },
    async syncStats(uid, stats) {
      const snapshot = structuredClone(stats);
      calls.push({ uid, stats: snapshot });
      return syncStats(uid, snapshot, calls.length);
    },
    async syncSettings(uid, settings, patch) {
      const local = structuredClone(settings);
      const pending = structuredClone(patch);
      settingsCalls.push({ uid, settings: local, patch: pending });
      if (syncSettings) return syncSettings(uid, local, pending, settingsCalls.length);
      const merged = { ...(preferences.get(uid) || local), ...pending };
      preferences.set(uid, merged);
      return structuredClone(merged);
    },
  };
  return {
    client,
    calls,
    settingsCalls,
    preferences,
    emit(user) { authListener?.(user); },
  };
}

function defaultGame() {
  return {
    puzzleId: 'in-progress', difficulty: '初級', elapsedTime: 83, completed: false,
  };
}

async function app({
  lock = true,
  loadError = false,
  delayed = false,
  loaded = null,
  cloud = makeCloud(),
  cloudModuleError = false,
  cloudModulePending = false,
  catalogError = false,
  online = true,
  presentationClock = null,
  useRealGame = false,
} = {}) {
  const events = {};
  const writes = [];
  const feedbackCalls = [];
  const experienceCalls = [];
  const renders = [];
  const motion = { matches: false, addEventListener(name, listener) { events[`motion:${name}`] = listener; } };
  let finishLoad;
  const loadDeferred = deferred();
  const moduleDeferred = deferred();
  const saved = loaded || {
    currentGame: null,
    stats: emptyStats(),
    scoreProfiles: emptyScoreProfiles(),
    settings: {},
  };
  const root = {
    addEventListener(name, fn) { events[`root:${name}`] = fn; },
    querySelector() { return null; },
  };
  const timers = {
    setTimeout(fn, delay, ...args) {
      return globalThis.setTimeout(fn, delay === 12_000 ? 5 : delay, ...args);
    },
  };
  const context = vm.createContext({
    URL,
    Date,
    console,
    structuredClone,
    setInterval,
    clearInterval,
    setTimeout: timers.setTimeout,
    clearTimeout,
    performance,
    crypto: webcrypto,
    matchMedia: () => motion,
    awardExperience,
    getExperience,
    createExperienceAnimator: () => ({ sync(_root, gain) { experienceCalls.push(gain?.eventId || null); }, cancel() {} }),
    createAutoFillPresentation: options => createAutoFillPresentation({ ...options,
      ...(presentationClock?.options || {}), prefersReducedMotion: () => motion.matches }),
    createPlayFeedback: () => ({
      recordInput(...args) { feedbackCalls.push({ type: 'input', args }); },
      recordInitial(...args) { feedbackCalls.push({ type: 'initial', args }); },
      celebrate() { feedbackCalls.push({ type: 'clear' }); },
      sync() {},
      cancel() { feedbackCalls.push({ type: 'cancel' }); },
    }),
    queueMicrotask,
    document: {
      documentElement: { dataset: {} },
      querySelector: selector => selector === '#app' ? root : null,
      visibilityState: 'hidden',
      addEventListener: (name, fn) => { events[name] = fn; },
    },
    window: { addEventListener: (name, fn) => { events[name] = fn; } },
    navigator: {
      onLine: online,
      locks: { request: async (_name, _options, callback) => callback(lock ? {} : null) },
    },
    DEFAULT_SETTINGS,
    applySettingsSync,
    captureSettingsSync,
    getProfileSettings,
    getSettingsProfile,
    normalizeSettingsProfiles,
    selectSettingsProfile,
    updateProfileSettings,
    DIFFICULTIES,
    THEMES,
    emptyStats,
    recordClear,
    mergeStats,
    normalizeStats,
    emptyScoreProfiles,
    getGuestScoreCount,
    getProfileStats,
    importGuestScores,
    normalizeScoreProfiles,
    selectScoreProfile,
    updateProfileStats,
    getKeypadState: () => [],
    createGame: () => ({}),
    getConflicts: () => [],
    getDisplayedCandidates: () => [],
    isComplete: game => Boolean(game?.completed),
    redo: game => game,
    transact: game => game,
    undo: game => game,
    choosePuzzle: () => ({}),
    loadPuzzles: () => catalogError ? Promise.reject(new Error('catalog offline')) : Promise.resolve([]),
    syncPuzzles: async () => ({}),
    formatDuration: value => String(value),
    renderApp(_root, current, _difficulties, helpers) {
      renders.push({ view: current.view, completionOpen: current.completionOpen,
        projectedGame: structuredClone(helpers.projectedGame) });
    },
    loadApp: () => loadError
      ? Promise.reject(new Error('unreadable'))
      : delayed
        ? new Promise(resolve => { finishLoad = resolve; })
        : Promise.resolve(saved),
    saveApp: async data => { writes.push(structuredClone(data)); },
    loadCloudModule: async () => {
      if (cloudModulePending) return moduleDeferred.promise;
      if (cloudModuleError) throw new Error('optional cloud import failed');
      return { createFirebaseClient: async () => cloud.client };
    },
    ...(useRealGame ? { ...engine, getKeypadState } : {}),
  });
  vm.runInContext(source, context);
  const instance = {
    context,
    events,
    writes,
    feedbackCalls,
    experienceCalls,
    renders,
    motion,
    cloud,
    finish: async () => {
      finishLoad?.(saved);
      await new Promise(resolve => setImmediate(resolve));
    },
    resolveCloudModule(module) { moduleDeferred.resolve(module); },
    click(action, data = {}) {
      const control = { dataset: { action, ...data } };
      events['root:click']({
        target: {
          closest(selector) {
            if (selector === '[data-cell]') return null;
            return selector === '[data-action]' ? control : null;
          },
        },
      });
    },
    state() { return vm.runInContext('state', context); },
    evaluate(script) { return vm.runInContext(script, context); },
  };
  if (delayed) await new Promise(resolve => setImmediate(resolve));
  else await waitFor(() => instance.state().storageReady || instance.state().loadError || instance.state().sessionBlocked);
  return instance;
}

async function waitFor(predicate, attempts = 100) {
  for (let i = 0; i < attempts; i += 1) {
    if (predicate()) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.fail('Timed out waiting for app state');
}

function controlledClock(instance, initialTime = 0) {
  let now = initialTime;
  instance.context.Date = class extends Date { static now() { return now; } };
  instance.context.setInterval = () => 0;
  instance.evaluate("document.visibilityState = 'visible'");
  return {
    advance(milliseconds) { now += milliseconds; },
    set(milliseconds) { now = milliseconds; },
  };
}

function presentationClock() {
  let time = 0;
  let serial = 0;
  const jobs = new Map();
  return { jobs,
    options: {
      now: () => time,
      setTimeout(fn, delay) { const id = ++serial; jobs.set(id, { fn, at: time + delay }); return id; },
      clearTimeout(id) { jobs.delete(id); },
    },
    advance(delta) {
      const end = time + delta;
      while (true) {
        const entry = [...jobs].filter(([, job]) => job.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!entry) break;
        time = entry[1].at; jobs.delete(entry[0]); entry[1].fn();
      }
      time = end;
    },
  };
}

function chainGame(completing = false) {
  const game = engine.createGame({ puzzleId: completing ? 'completing-chain' : 'input-chain', difficulty: '初級', puzzle: '0'.repeat(81) });
  if (completing) {
    game.currentBoard = Array.from({ length: 81 }, (_, cell) => (Math.floor(cell / 9) * 3 + Math.floor(cell / 27) + cell % 9) % 9 + 1);
    game.currentBoard.fill(0, 0, 9);
    game.sources = game.currentBoard.map(digit => digit ? 'manual' : '');
  } else {
    for (let cell = 1; cell <= 3; cell += 1) {
      game.manualExcludedCandidates[cell] = 511 & ~((1 << (cell - 1)) | (1 << cell));
    }
  }
  game.elapsedTime = 83.75;
  return game;
}

function realGameplay(instance) {
  for (const name of ['createGame', 'transact', 'undo', 'redo', 'isComplete', 'getConflicts', 'getDisplayedCandidates']) {
    instance.context[name] = engine[name];
  }
  instance.context.getKeypadState = getKeypadState;
}

function savedGame(game) {
  return { currentGame: game, stats: emptyStats(), scoreProfiles: emptyScoreProfiles(), settings: {} };
}

test('input chains save their atomic result immediately while visible candidates arrive at 100/200ms', async () => {
  const timing = presentationClock();
  const previous = chainGame();
  const instance = await app({ loaded: savedGame(previous), presentationClock: timing });
  await waitFor(() => instance.state().cloud.status === 'signed-out');
  realGameplay(instance);
  controlledClock(instance);
  instance.click('resume');
  instance.click('digit', { digit: '1' });
  await instance.evaluate('flushWrites()');
  const canonical = instance.state().currentGame;
  assert.deepEqual(canonical.currentBoard.slice(0, 4), [1, 2, 3, 4]);
  assert.deepEqual(instance.writes.at(-1).currentGame.currentBoard, canonical.currentBoard);
  assert.equal(canonical.undoStack.length, 1);
  assert.deepEqual(instance.renders.at(-1).projectedGame.currentBoard.slice(0, 4), [1, 0, 0, 0]);
  assert.deepEqual(engine.getDisplayedCandidates(instance.renders.at(-1).projectedGame, 8), [2, 3, 4, 5, 6, 7, 8, 9]);
  timing.advance(99);
  assert.equal(instance.renders.at(-1).projectedGame.currentBoard[1], 0);
  timing.advance(1);
  assert.deepEqual(instance.renders.at(-1).projectedGame.currentBoard.slice(0, 4), [1, 2, 0, 0]);
  instance.evaluate("state.selectedCell = 8; render(); changeSettings({ theme: 'night' });");
  await instance.evaluate('queueSave()');
  timing.advance(100);
  assert.deepEqual(instance.renders.at(-1).projectedGame.currentBoard.slice(0, 4), [1, 2, 3, 0]);
  assert.deepEqual(engine.getDisplayedCandidates(instance.renders.at(-1).projectedGame, 8), [4, 5, 6, 7, 8, 9]);
  instance.click('undo');
  assert.deepEqual(instance.state().currentGame.currentBoard, previous.currentBoard);
  timing.advance(2000);
  assert.deepEqual(instance.renders.at(-1).projectedGame.currentBoard, previous.currentBoard);
  instance.click('redo');
  assert.deepEqual(instance.renders.at(-1).projectedGame.currentBoard, canonical.currentBoard);
  assert.equal(instance.evaluate('autoFillPresentation.isActive()'), false);
});

test('completing chains persist one XP award and frozen time immediately, then show CLEAR after arrivals settle', async () => {
  const timing = presentationClock();
  const instance = await app({ loaded: savedGame(chainGame(true)), presentationClock: timing });
  await waitFor(() => instance.state().cloud.status === 'signed-out');
  realGameplay(instance);
  const clock = controlledClock(instance);
  instance.click('resume');
  clock.advance(250);
  instance.click('digit', { digit: '1' });
  await instance.evaluate('flushWrites()');
  const midChainSave = instance.writes.at(-1);
  assert.equal(instance.state().currentGame.scoreRecorded, true);
  assert.equal(instance.state().currentGame.elapsedTime, 84);
  assert.equal(midChainSave.stats.records['completing-chain'].elapsedTime, 84);
  assert.equal(getExperience(midChainSave.stats).totalExp, 20);
  assert.equal(instance.state().completionOpen, false);
  assert.equal(instance.feedbackCalls.filter(call => call.type === 'clear').length, 0);
  assert.ok(instance.experienceCalls.every(event => event === null));
  timing.advance(799);
  assert.equal(instance.renders.at(-1).projectedGame.currentBoard[8], 0);
  timing.advance(1);
  assert.equal(instance.renders.at(-1).projectedGame.currentBoard[8], 9);
  assert.equal(instance.state().completionOpen, false);
  clock.advance(5000);
  timing.advance(519);
  assert.equal(instance.state().completionOpen, false);
  timing.advance(1);
  assert.equal(instance.state().completionOpen, true);
  assert.equal(instance.state().currentGame.elapsedTime, 84);
  assert.equal(instance.feedbackCalls.filter(call => call.type === 'clear').length, 1);
  assert.ok(instance.experienceCalls.some(event => event === midChainSave.currentGame.experienceAward.eventId));
  instance.evaluate('finishIfComplete(state.currentGame)');
  assert.equal(instance.feedbackCalls.filter(call => call.type === 'clear').length, 1);
  assert.equal(getExperience(instance.state().stats).totalExp, 20);
  instance.click('dismiss-completion');
  instance.evaluate('selectCell(8)');
  timing.advance(2000);
  assert.equal(instance.state().completionOpen, false);
  assert.equal(instance.state().experienceGain, null);
  const restored = await app({ loaded: midChainSave, presentationClock: presentationClock(), useRealGame: true });
  assert.equal(restored.state().completionOpen, true);
  assert.equal(restored.state().experienceGain, null);
  assert.equal(restored.feedbackCalls.filter(call => call.type === 'clear').length, 0);
  assert.equal(getExperience(restored.state().stats).totalExp, 20);
});

test('board no-ops, DEL, Undo/Redo, navigation and background settle chains without stale mutations or lost saves', async () => {
  for (const action of ['no-op', 'unavailable', 'delete', 'undo', 'redo', 'settings', 'home', 'hidden', 'pagehide']) {
    const timing = presentationClock();
    const instance = await app({ loaded: savedGame(chainGame()), presentationClock: timing });
    await waitFor(() => instance.state().cloud.status === 'signed-out');
    realGameplay(instance);
    controlledClock(instance);
    instance.click('resume');
    instance.click('digit', { digit: '1' });
    const stale = [...timing.jobs.values()][0].fn;
    timing.advance(50);
    if (action === 'no-op') instance.click('digit', { digit: '1' });
    else if (action === 'unavailable') {
      instance.context.getKeypadState = () => [{ digit: 9, disabled: true }];
      instance.click('digit', { digit: '9' });
    } else if (action === 'hidden') {
      instance.evaluate("document.visibilityState = 'hidden'");
      instance.events.visibilitychange();
    } else if (action === 'pagehide') instance.events.pagehide();
    else instance.click(action);
    assert.equal(instance.evaluate('autoFillPresentation.isActive()'), false, action);
    const after = structuredClone(instance.state().currentGame.currentBoard);
    stale();
    timing.advance(2000);
    await instance.evaluate('flushWrites()');
    assert.deepEqual(instance.state().currentGame.currentBoard, after, action);
    assert.deepEqual(instance.writes.at(-1).currentGame.currentBoard, after, action);
    assert.deepEqual(instance.renders.at(-1).projectedGame.currentBoard, after, action);
    assert.equal(instance.feedbackCalls.filter(call => call.type === 'clear').length, 0, action);
  }
});

test('rapid new input edits the settled canonical board and owns a fresh Undo step', async () => {
  const timing = presentationClock();
  const instance = await app({ loaded: savedGame(chainGame()), presentationClock: timing });
  realGameplay(instance);
  controlledClock(instance);
  instance.click('resume');
  instance.click('digit', { digit: '1' });
  timing.advance(50);
  instance.evaluate('state.selectedCell = 10');
  instance.click('digit', { digit: '5' });
  assert.deepEqual(instance.renders.at(-1).projectedGame.currentBoard.slice(0, 4), [1, 2, 3, 4]);
  assert.equal(instance.state().currentGame.currentBoard[10], 5);
  assert.equal(instance.state().currentGame.undoStack.length, 2);
  timing.advance(2000);
  instance.click('undo');
  assert.equal(instance.state().currentGame.currentBoard[10], 0);
  assert.deepEqual(instance.state().currentGame.currentBoard.slice(0, 4), [1, 2, 3, 4]);
});

test('an eligible MEMO exclusion animates its naked-single closure and retains that one Undo transaction', async () => {
  const timing = presentationClock();
  const previous = chainGame();
  previous.manualExcludedCandidates[0] = 511 & ~3;
  const instance = await app({ loaded: savedGame(previous), presentationClock: timing });
  realGameplay(instance);
  controlledClock(instance);
  instance.click('resume');
  instance.click('toggle-mode');
  instance.click('digit', { digit: '2' });
  await instance.evaluate('flushWrites()');
  assert.deepEqual(instance.state().currentGame.lastAutoFilled, [0, 1, 2, 3]);
  assert.equal(instance.state().currentGame.undoStack.length, 1);
  assert.equal(instance.state().currentGame.manualExcludedCandidates[0] & 2, 2);
  assert.equal(instance.renders.at(-1).projectedGame.currentBoard[0], 0);
  assert.deepEqual(engine.getDisplayedCandidates(instance.renders.at(-1).projectedGame, 0), [1]);
  timing.advance(100);
  assert.deepEqual(instance.renders.at(-1).projectedGame.currentBoard.slice(0, 4), [1, 0, 0, 0]);
  timing.advance(100);
  assert.deepEqual(instance.renders.at(-1).projectedGame.currentBoard.slice(0, 4), [1, 2, 0, 0]);
  instance.click('undo');
  assert.deepEqual(instance.state().currentGame.currentBoard, previous.currentBoard);
  assert.equal(instance.state().currentGame.manualExcludedCandidates[0], previous.manualExcludedCandidates[0]);
  timing.advance(2000);
  assert.deepEqual(instance.renders.at(-1).projectedGame.currentBoard, previous.currentBoard);
});

test('new-game initial closure animates once, replacement and update settle safely, and resume never replays it', async () => {
  const timing = presentationClock();
  const instance = await app({ presentationClock: timing });
  realGameplay(instance);
  controlledClock(instance);
  const initialPuzzle = { puzzleId: 'initial-chain', difficulty: '初級', puzzle: '012345678' + '0'.repeat(72) };
  instance.context.choosePuzzle = () => initialPuzzle;
  await instance.evaluate("startNewGame('初級')");
  assert.deepEqual(instance.state().currentGame.lastAutoFilled, [0]);
  assert.equal(instance.renders.at(-1).projectedGame.currentBoard[0], 0);
  await instance.evaluate('flushWrites()');
  const saved = instance.writes.at(-1);
  assert.equal(saved.currentGame.currentBoard[0], 9);
  timing.advance(100);
  assert.equal(instance.renders.at(-1).projectedGame.currentBoard[0], 9);
  instance.click('home');
  instance.click('resume');
  assert.equal(instance.evaluate('autoFillPresentation.isActive()'), false);
  assert.equal(instance.feedbackCalls.filter(call => call.type === 'initial').length, 1);
  const restored = await app({ loaded: saved, presentationClock: presentationClock() });
  realGameplay(restored);
  controlledClock(restored);
  restored.click('resume');
  assert.equal(restored.feedbackCalls.filter(call => call.type === 'initial').length, 0);
  await instance.evaluate("startNewGame('初級')");
  instance.evaluate('state.updateWorker = { postMessage() { pendingUpdateAllowed = true; } }; activateUpdate()');
  await waitFor(() => instance.evaluate('pendingUpdateAllowed'));
  assert.equal(instance.evaluate('autoFillPresentation.isActive()'), false);
  assert.equal(instance.writes.at(-1).currentGame.currentBoard[0], 9);
  timing.advance(2000);
  assert.equal(instance.renders.at(-1).projectedGame.currentBoard[0], 9);
});

test('a successful cold new-game load settles an old completion before replacement without a stale CLEAR', async () => {
  const timing = presentationClock();
  const instance = await app({ loaded: savedGame(chainGame(true)), presentationClock: timing, useRealGame: true });
  await waitFor(() => instance.state().cloud.status === 'signed-out');
  controlledClock(instance);
  const catalog = deferred();
  instance.context.loadPuzzles = () => catalog.promise;
  instance.context.choosePuzzle = () => ({ puzzleId: 'cold-replacement', difficulty: '初級', puzzle: '012345678' + '0'.repeat(72) });
  const pendingStart = instance.evaluate("startNewGame('初級')");
  assert.equal(instance.state().busy, true);
  instance.click('resume');
  instance.click('digit', { digit: '1' });
  timing.advance(100);
  assert.equal(instance.evaluate('completionPending'), true);
  const stale = [...timing.jobs.values()][0].fn;
  await instance.evaluate('flushWrites()');
  assert.equal(instance.writes.at(-1).currentGame.scoreRecorded, true);
  catalog.resolve([]);
  await pendingStart;
  assert.equal(instance.state().currentGame.puzzleId, 'cold-replacement');
  assert.equal(instance.evaluate('completionPending'), false);
  assert.equal(instance.state().completionOpen, false);
  assert.equal(instance.state().announce, '');
  assert.equal(instance.state().experienceGain, null);
  stale();
  timing.advance(620);
  await instance.evaluate('flushWrites()');
  assert.equal(engine.isComplete(instance.state().currentGame), false);
  assert.equal(instance.state().completionOpen, false);
  assert.equal(instance.state().announce, '');
  assert.equal(instance.feedbackCalls.filter(call => call.type === 'clear').length, 0);
  assert.equal(getExperience(instance.state().stats).totalExp, 20);
  assert.equal(Object.keys(instance.state().stats.experienceEvents).length, 1);
  assert.equal(instance.writes.at(-1).currentGame.puzzleId, 'cold-replacement');
  assert.equal(instance.writes.at(-1).currentGame.scoreRecorded, undefined);
  assert.deepEqual(instance.writes.at(-1).stats.clearedIds, ['completing-chain']);
  assert.equal(timing.jobs.size, 0);
});

test('a failed cold new-game load or invalid puzzle preserves the old completion and its one pending presentation', async () => {
  for (const failure of ['catalog', 'validation']) {
    const timing = presentationClock();
    const instance = await app({ loaded: savedGame(chainGame(true)), presentationClock: timing, useRealGame: true });
    await waitFor(() => instance.state().cloud.status === 'signed-out');
    controlledClock(instance);
    const catalog = deferred();
    instance.context.loadPuzzles = () => catalog.promise;
    const completedPuzzle = chainGame(true).currentBoard.map((digit, cell) => cell < 9 ? cell + 1 : digit).join('');
    instance.context.choosePuzzle = () => ({ puzzleId: 'invalid-complete', difficulty: '初級', puzzle: completedPuzzle });
    const pendingStart = instance.evaluate("startNewGame('初級')");
    instance.click('resume');
    instance.click('digit', { digit: '1' });
    timing.advance(100);
    const stale = [...timing.jobs.values()][0].fn;
    const oldAward = instance.state().currentGame.experienceAward.eventId;
    if (failure === 'catalog') catalog.reject(new Error('offline catalog'));
    else catalog.resolve([]);
    await pendingStart;
    assert.equal(instance.state().currentGame.puzzleId, 'completing-chain', failure);
    assert.equal(instance.state().currentGame.experienceAward.eventId, oldAward, failure);
    assert.equal(instance.evaluate('completionPending'), true, failure);
    assert.equal(instance.state().completionOpen, false, failure);
    assert.equal(instance.state().busy, false, failure);
    assert.ok(instance.state().uiError, failure);
    timing.advance(1220);
    stale();
    await instance.evaluate('flushWrites()');
    assert.equal(instance.state().completionOpen, true, failure);
    assert.equal(instance.evaluate('completionPending'), false, failure);
    assert.equal(instance.feedbackCalls.filter(call => call.type === 'clear').length, 1, failure);
    assert.equal(getExperience(instance.state().stats).totalExp, 20, failure);
    assert.equal(instance.writes.at(-1).currentGame.experienceAward.eventId, oldAward, failure);
    assert.equal(timing.jobs.size, 0, failure);
  }
});

test('reduced-motion changes finish a completing chain statically, while autoFill OFF and turning ON alone do not start one', async () => {
  const timing = presentationClock();
  const instance = await app({ loaded: savedGame(chainGame(true)), presentationClock: timing });
  realGameplay(instance);
  controlledClock(instance);
  instance.click('resume');
  instance.click('digit', { digit: '1' });
  timing.advance(100);
  instance.motion.matches = true;
  instance.events['motion:change']({ matches: true });
  assert.equal(instance.evaluate('autoFillPresentation.isActive()'), false);
  assert.equal(instance.state().completionOpen, true);
  assert.equal(instance.state().experienceGain, null);
  assert.equal(instance.feedbackCalls.filter(call => call.type === 'clear').length, 0);
  timing.advance(2000);
  assert.equal(getExperience(instance.state().stats).totalExp, 20);
  const off = await app({ loaded: { ...savedGame(chainGame()), settings: { autoFill: false } }, presentationClock: presentationClock() });
  realGameplay(off);
  controlledClock(off);
  off.click('resume');
  off.click('digit', { digit: '1' });
  assert.deepEqual(off.renders.at(-1).projectedGame.currentBoard.slice(0, 4), [1, 0, 0, 0]);
  assert.equal(off.evaluate('autoFillPresentation.isActive()'), false);
  off.click('toggle-auto-fill');
  assert.deepEqual(off.state().currentGame.currentBoard.slice(0, 4), [1, 0, 0, 0]);
  assert.equal(off.evaluate('autoFillPresentation.isActive()'), false);
});

test('partial play seconds survive pauses, checkpoints and reload before whole-second completion', async () => {
  const instance = await app({ loaded: {
    currentGame: { ...defaultGame(), elapsedTime: 0 },
    stats: emptyStats(), scoreProfiles: emptyScoreProfiles(), settings: {},
  } });
  await waitFor(() => instance.state().cloud.status === 'signed-out');
  const clock = controlledClock(instance);
  instance.click('resume');
  for (let segment = 0; segment < 4; segment += 1) {
    clock.advance(750);
    instance.click('settings');
    clock.advance(10_000); // Settings time must not become play time.
    instance.click('back');
  }
  assert.equal(instance.state().currentGame.elapsedTime, 3);

  clock.advance(15_375);
  instance.evaluate('saveClockSnapshot()');
  assert.equal(instance.state().currentGame.elapsedTime, 18.375);
  clock.advance(375);
  instance.click('settings');
  await instance.evaluate('queueSave()');
  const saved = instance.writes.at(-1);
  assert.equal(saved.currentGame.elapsedTime, 18.75);
  assert.equal(formatDuration(saved.currentGame.elapsedTime), '00:18');

  const restored = await app({ loaded: saved });
  await waitFor(() => restored.state().cloud.status === 'signed-out');
  const resumedClock = controlledClock(restored);
  restored.click('resume');
  resumedClock.advance(750);
  assert.equal(restored.evaluate('currentElapsed()'), 19.5);
  restored.evaluate(`
    const previous = state.currentGame;
    commitGame({ ...previous, completed: true }, previous);
    finishIfComplete(state.currentGame);
  `);
  await restored.evaluate('queueSave()');
  assert.equal(restored.state().currentGame.elapsedTime, 19);
  assert.equal(restored.state().stats.records['in-progress'].elapsedTime, 19);
  assert.equal(getExperience(restored.state().stats).totalExp, 20);
  assert.equal(restored.evaluate('clockStartedAt'), null);
});

test('a backwards wall-clock adjustment cannot make saved play time negative', async () => {
  const instance = await app({ loaded: {
    currentGame: { ...defaultGame(), elapsedTime: 0.75 },
    stats: emptyStats(), scoreProfiles: emptyScoreProfiles(), settings: {},
  } });
  await waitFor(() => instance.state().cloud.status === 'signed-out');
  const clock = controlledClock(instance, 10_000);
  instance.click('resume');
  clock.set(5_000);
  instance.click('settings');
  await instance.evaluate('queueSave()');
  assert.equal(instance.state().currentGame.elapsedTime, 0.75);
  assert.equal(instance.writes.at(-1).currentGame.elapsedTime, 0.75);
});

test('blocked or unreadable sessions never replace saved data on hide/close', async () => {
  for (const options of [{ lock: false }, { loadError: true }, { delayed: true }]) {
    const instance = await app(options);
    instance.events.visibilitychange();
    instance.events.pagehide();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(instance.writes.length, 0);
    await instance.finish();
  }
});

test('completion keeps the board, freezes the clock and can be dismissed without editing', async () => {
  const { context, events } = await app();
  vm.runInContext("state.currentGame = { puzzleId: 'complete-once', difficulty: '初級', completed: true, elapsedTime: 83 }; state.view = 'game'; finishIfComplete(state.currentGame);", context);
  assert.equal(vm.runInContext('state.view', context), 'game');
  assert.equal(vm.runInContext('state.completionOpen', context), true);
  assert.equal(vm.runInContext('clockStartedAt', context), null);
  const before = vm.runInContext('JSON.stringify(state.currentGame)', context);
  events['root:keydown']({ key: 'Escape' });
  assert.equal(vm.runInContext('state.completionOpen', context), false);
  for (const key of ['1', 'Delete', 'z']) events['root:keydown']({ key, ctrlKey: key === 'z' });
  for (const action of ['digit', 'delete', 'undo', 'redo', 'clear-notes']) {
    const control = { dataset: { action, digit: '1' } };
    events['root:click']({ target: { closest: selector => selector === '[data-action]' ? control : null } });
  }
  assert.equal(vm.runInContext('JSON.stringify(state.currentGame)', context), before);
  assert.equal(vm.runInContext('state.view', context), 'game');
});

test('new clears earn XP per play, persist once and restore without replaying animation', async () => {
  const instance = await app();
  await waitFor(() => instance.state().cloud.status === 'signed-out');
  for (let play = 0; play < 2; play += 1) {
    instance.evaluate(`state.currentGame = { puzzleId: 'replayed-puzzle', difficulty: '超上級', completed: true, elapsedTime: 83 }; state.view = 'game'; finishIfComplete(state.currentGame);`);
    instance.evaluate('finishIfComplete(state.currentGame)');
  }
  assert.equal(getExperience(instance.state().stats).totalExp, 100);
  assert.equal(instance.state().stats.totalClears, 1);
  assert.equal(instance.state().completionExperience.level, 2);
  assert.equal(instance.state().experienceGain.from, 50);
  await instance.evaluate('queueSave()');
  const saved = instance.writes.at(-1);
  assert.equal(Object.keys(saved.scoreProfiles.guest.experienceEvents).length, 2);
  const restored = await app({ loaded: saved });
  await waitFor(() => restored.state().cloud.status === 'signed-out');
  assert.equal(getExperience(restored.state().stats).totalExp, 100);
  assert.equal(restored.state().completionExperience.level, 2);
  assert.equal(restored.state().experienceGain, null);
});

test('old completed saves never earn XP and account changes hide the previous result', async () => {
  const cloud = makeCloud();
  const instance = await app({ cloud, loaded: {
    currentGame: { puzzleId: 'old', difficulty: '超上級', completed: true, elapsedTime: 5 },
    stats: emptyStats(), scoreProfiles: emptyScoreProfiles(), settings: {},
  } });
  await waitFor(() => instance.state().cloud.status === 'signed-out');
  assert.equal(getExperience(instance.state().stats).totalExp, 0);
  assert.equal(instance.state().completionExperience, null);
  instance.evaluate(`state.currentGame = { puzzleId: 'new', difficulty: '中級', completed: true, elapsedTime: 9 }; finishIfComplete(state.currentGame)`);
  assert.equal(instance.state().completionExperience.totalExp, 30);
  cloud.emit({ uid: 'another-account' });
  await waitFor(() => instance.state().cloud.status === 'synced');
  assert.equal(instance.state().completionExperience, null);
  assert.equal(instance.state().experienceGain, null);
  assert.equal(getExperience(instance.state().stats).totalExp, 0);
  assert.equal(getExperience(instance.state().scoreProfiles.guest).totalExp, 30);
});

test('saved completed games are marked before authentication and cannot register in a later account', async () => {
  const cloud = makeCloud({ initialUser: { uid: 'account-A', displayName: 'A' } });
  const oldGame = { puzzleId: 'old-complete', difficulty: '初級', elapsedTime: 83, completed: true };
  const instance = await app({ cloud, loaded: {
    currentGame: oldGame,
    stats: emptyStats(),
    scoreProfiles: emptyScoreProfiles(),
    settings: { theme: 'night' },
  } });

  await waitFor(() => instance.state().account?.uid === 'account-A' && cloud.calls.length > 0);
  assert.equal(instance.state().currentGame.scoreRecorded, true);
  assert.deepEqual(instance.state().scoreProfiles.guest.clearedIds, ['old-complete']);
  assert.deepEqual(instance.state().scoreProfiles.accounts['account-A'].clearedIds, []);
  assert.equal(instance.writes.at(-1).currentGame.scoreRecorded, true);
  assert.deepEqual(cloud.calls[0].stats.clearedIds, []);
});

test('theme switching updates the whole page and saves without changing the game or statistics', async () => {
  const guestStats = recordClear(emptyStats(), { puzzleId: 'guest-win', difficulty: '初級', elapsedTime: 8 });
  const { context, events, writes } = await app({ loaded: {
    currentGame: defaultGame(), stats: guestStats,
    scoreProfiles: { ...emptyScoreProfiles(), guest: guestStats },
    settings: {},
  } });
  events['root:click']({ target: { closest: selector => selector === '[data-action]' ? { dataset: { action: 'set-theme', theme: 'night' } } : null } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(vm.runInContext('document.documentElement.dataset.theme', context), 'night');
  assert.equal(writes.at(-1).settings.theme, 'night');
  assert.deepEqual(writes.at(-1).stats.clearedIds, ['guest-win']);
  assert.equal(writes.at(-1).currentGame.puzzleId, 'in-progress');
});

test('keyboard input cannot bypass a number key already used nine times', async () => {
  const { context, events } = await app();
  context.getKeypadState = () => [{ digit: 9, disabled: true }];
  context.transact = () => { throw new Error('Unavailable number must not transact'); };
  vm.runInContext("state.view = 'game'; state.currentGame = { elapsedTime: 0 }; state.inputMode = 'number';", context);
  events['root:keydown']({ key: '9', preventDefault() {} });
  assert.equal(vm.runInContext('state.currentGame.elapsedTime', context), 0);
});

test('only accepted digit input requests ink feedback; editing history and completed reloads never celebrate', async () => {
  const instance = await app({ loaded: {
    currentGame: defaultGame(), stats: emptyStats(), scoreProfiles: emptyScoreProfiles(), settings: {},
  } });
  instance.evaluate("state.view = 'game'; state.selectedCell = 2;");
  instance.evaluate('enterDigit(3)');
  assert.equal(instance.feedbackCalls.filter(call => call.type === 'input').length, 0);
  instance.context.transact = game => ({ ...game, currentBoard: [3] });
  instance.evaluate('enterDigit(3)');
  assert.deepEqual(instance.feedbackCalls.find(call => call.type === 'input').args.slice(2), [2, 3, 'number']);
  instance.context.undo = game => ({ ...game, elapsedTime: 9 });
  instance.click('undo');
  instance.click('delete');
  assert.equal(instance.feedbackCalls.filter(call => call.type === 'input').length, 1);
  assert.equal(instance.feedbackCalls.filter(call => call.type === 'clear').length, 0);
  const previous = instance.state().currentGame;
  instance.context.finished = { ...previous, completed: true };
  instance.evaluate('commitGame(finished, state.currentGame)');
  assert.equal(instance.feedbackCalls.filter(call => call.type === 'clear').length, 1);
  instance.click('dismiss-completion');
  instance.click('settings');
  instance.click('back');
  assert.equal(instance.feedbackCalls.filter(call => call.type === 'clear').length, 1);
  const restored = await app({ loaded: instance.writes.at(-1) });
  restored.evaluate('resumeGame()');
  assert.equal(restored.feedbackCalls.filter(call => call.type === 'clear').length, 0);
});

test('initialized owner persists loaded statistics and profiles on close', async () => {
  const guestStats = recordClear(emptyStats(), { puzzleId: 'guest-close', difficulty: '初級', elapsedTime: 5 });
  const instance = await app({ loaded: {
    currentGame: null,
    stats: guestStats,
    scoreProfiles: { ...emptyScoreProfiles(), guest: guestStats },
    settings: {},
  } });
  instance.events.pagehide();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(instance.writes.at(-1).scoreProfiles.guest.clearedIds, ['guest-close']);
  assert.deepEqual(instance.writes.at(-1).stats.clearedIds, ['guest-close']);
});

test('nested statistics returns through settings to its original screen', async () => {
  for (const origin of ['home', 'game']) {
    const { context } = await app();
    vm.runInContext(`state.view = '${origin}'; state.currentGame = ${origin === 'game' ? '{}' : 'null'}; openSettings(); openStats(); goBack();`, context);
    assert.equal(vm.runInContext('state.view', context), 'settings');
    vm.runInContext('goBack()', context);
    assert.equal(vm.runInContext('state.view', context), origin);
  }
});

test('account changes preserve the local game and settings and never upload guest scores implicitly', async () => {
  const guestStats = recordClear(emptyStats(), { puzzleId: 'guest-only', difficulty: '初級', elapsedTime: 21 });
  const cloud = makeCloud({ users: [
    { uid: 'account-A', displayName: 'A' },
    { uid: 'account-B', displayName: 'B' },
  ] });
  const game = defaultGame();
  const instance = await app({ cloud, loaded: {
    currentGame: game,
    stats: guestStats,
    scoreProfiles: { ...emptyScoreProfiles(), guest: guestStats },
    settings: { autoCandidates: false, theme: 'night' },
  } });

  instance.click('sign-in');
  await waitFor(() => instance.state().account?.uid === 'account-A' && instance.state().cloud.status === 'synced');
  assert.deepEqual(instance.state().stats.clearedIds, []);
  assert.deepEqual(instance.state().scoreProfiles.guest.clearedIds, ['guest-only']);
  assert.deepEqual(cloud.calls[0].stats.clearedIds, []);

  instance.evaluate(`
    const before = state.currentGame;
    commitGame({ ...before, completed: true, puzzleId: 'account-a-win', difficulty: '初級', elapsedTime: 4 }, before);
  `);
  await waitFor(() => instance.state().scoreProfiles.accounts['account-A']?.records?.['account-a-win']);
  cloud.emit({ uid: 'account-B', displayName: 'B' });
  await waitFor(() => instance.state().account?.uid === 'account-B' && instance.state().cloud.status === 'synced');
  assert.deepEqual(instance.state().stats.clearedIds, []);
  assert.deepEqual(instance.state().scoreProfiles.accounts['account-A'].clearedIds, ['account-a-win']);
  assert.equal(instance.state().currentGame.puzzleId, 'account-a-win');
  assert.equal(instance.state().settings.theme, 'night');

  instance.click('sign-out');
  await waitFor(() => instance.state().account === null && instance.state().cloud.status === 'signed-out');
  assert.deepEqual(instance.state().stats.clearedIds, ['guest-only']);
  assert.deepEqual(instance.state().scoreProfiles.accounts['account-B'].clearedIds, []);
});

test('guest score import becomes durable locally before the account sync starts', async () => {
  const guestStats = recordClear(emptyStats(), { puzzleId: 'guest-import', difficulty: '中級', elapsedTime: 17 });
  let importedWriteSeen = false;
  let appWrites = null;
  const cloud = makeCloud({
    users: [{ uid: 'account-A', displayName: 'A' }],
    syncStats: async (_uid, stats, callNumber) => {
      if (callNumber > 1) {
        const lastWrite = appWrites?.at(-1);
        importedWriteSeen = Boolean(lastWrite
          && lastWrite.scoreProfiles.guest.totalClears === 0
          && lastWrite.scoreProfiles.accounts['account-A']?.records?.['guest-import']);
      }
      return stats;
    },
  });
  const instance = await app({ cloud, loaded: {
    currentGame: null,
    stats: guestStats,
    scoreProfiles: { ...emptyScoreProfiles(), guest: guestStats },
    settings: {},
  } });
  appWrites = instance.writes;
  instance.click('sign-in');
  await waitFor(() => instance.state().account?.uid === 'account-A' && instance.state().cloud.status === 'synced');
  instance.click('import-guest-scores');
  await waitFor(() => instance.state().scoreProfiles.guest.totalClears === 0
    && instance.state().scoreProfiles.accounts['account-A']?.records?.['guest-import']
    && instance.state().cloud.status === 'synced');
  assert.equal(importedWriteSeen, true);
  assert.equal(instance.state().guestScoreCount, 0);
  assert.equal(instance.state().scoreProfiles.accounts['account-A'].records['guest-import'].elapsedTime, 17);
});

test('a stale response after switching accounts is discarded and cannot leak scores', async () => {
  const firstResponse = deferred();
  const cloud = makeCloud({
    initialUser: { uid: 'account-A', displayName: 'A' },
    syncStats: async (uid, stats, callNumber) => uid === 'account-A' && callNumber === 1
      ? firstResponse.promise
      : stats,
  });
  const instance = await app({ cloud });
  await waitFor(() => cloud.calls.length === 1);
  cloud.emit({ uid: 'account-B', displayName: 'B' });
  firstResponse.resolve(recordClear(emptyStats(), { puzzleId: 'stale-a-score', difficulty: '初級', elapsedTime: 3 }));
  await waitFor(() => cloud.calls.some(call => call.uid === 'account-B')
    && instance.state().account?.uid === 'account-B'
    && instance.state().cloud.status === 'synced');

  assert.deepEqual(instance.state().stats.clearedIds, []);
  assert.deepEqual(instance.state().scoreProfiles.accounts['account-A'].clearedIds, []);
  assert.equal(instance.state().scoreProfiles.accounts['account-B'].records['stale-a-score'], undefined);
});

test('a completion during sync is retained and causes another coalesced sync', async () => {
  const firstResponse = deferred();
  const cloud = makeCloud({
    initialUser: { uid: 'account-A', displayName: 'A' },
    syncStats: async (_uid, stats, callNumber) => callNumber === 1 ? firstResponse.promise : stats,
  });
  const instance = await app({ cloud, loaded: {
    currentGame: defaultGame(), stats: emptyStats(), scoreProfiles: emptyScoreProfiles(), settings: {},
  } });
  await waitFor(() => cloud.calls.length === 1);
  instance.evaluate(`
    const previous = state.currentGame;
    commitGame({ ...previous, completed: true, puzzleId: 'during-sync', difficulty: '初級', elapsedTime: 6 }, previous);
  `);
  await waitFor(() => instance.state().scoreProfiles.accounts['account-A']?.records?.['during-sync']);
  firstResponse.resolve(emptyStats());
  await waitFor(() => cloud.calls.length >= 2 && instance.state().cloud.status === 'synced');

  assert.deepEqual(instance.state().scoreProfiles.accounts['account-A'].clearedIds, ['during-sync']);
  assert.deepEqual(cloud.calls[1].stats.clearedIds, ['during-sync']);
  assert.equal(instance.state().cloud.busy, false);
});

test('a stalled optional cloud module is bounded and leaves local gameplay ready', async () => {
  const instance = await app({
    loaded: { currentGame: defaultGame(), stats: emptyStats(), scoreProfiles: emptyScoreProfiles(), settings: {} },
    cloudModulePending: true,
  });
  await new Promise(resolve => globalThis.setTimeout(resolve, 15));
  assert.equal(instance.state().cloud.status, 'error');
  assert.equal(instance.state().storageReady, true);
  assert.equal(instance.state().currentGame.puzzleId, 'in-progress');
  assert.equal(instance.state().loadError, false);
});

test('catalog failure keeps legacy aggregates available offline', async () => {
  const legacy = { clearedIds: [], byDifficulty: { 初級: { clears: 6, bestTime: 48 } }, totalClears: 6 };
  const instance = await app({
    catalogError: true,
    loaded: { currentGame: null, stats: legacy, scoreProfiles: null, settings: {} },
  });

  assert.equal(instance.state().stats.totalClears, 6);
  assert.equal(instance.state().stats.byDifficulty.初級.bestTime, 48);
  assert.equal(instance.state().scoreProfiles.guest.totalClears, 6);
});

test('failed guest import saving preserves a concurrent clear through retry and reload', async () => {
  const guest = recordClear(emptyStats(), { puzzleId: 'guest-old', difficulty: '初級', elapsedTime: 70 });
  const cloud = makeCloud({ initialUser: { uid: 'account-A', displayName: 'A' } });
  const instance = await app({ cloud, loaded: {
    currentGame: defaultGame(), stats: guest,
    scoreProfiles: { ...emptyScoreProfiles(), guest }, settings: {},
  } });
  await waitFor(() => instance.state().cloud.status === 'synced');
  const callsBefore = cloud.calls.length;
  const saveGate = deferred();
  let saveStarted = false;
  instance.context.saveApp = async () => {
    saveStarted = true;
    await saveGate.promise;
    throw new Error('storage unavailable');
  };
  const importing = instance.evaluate('importGuestScoresForAccount()');
  await waitFor(() => saveStarted);
  instance.evaluate(`
    const previous = state.currentGame;
    commitGame({ ...previous, puzzleId: 'new-win', completed: true }, previous);
  `);
  saveGate.resolve();
  await importing;
  await instance.evaluate('flushWrites()');
  assert.deepEqual(instance.state().stats.clearedIds, ['guest-old', 'new-win']);
  assert.equal(instance.state().currentGame.scoreRecorded, true);
  assert.equal(instance.state().saveError, true);
  assert.equal(cloud.calls.length, callsBefore);

  instance.context.saveApp = async data => instance.writes.push(structuredClone(data));
  await instance.evaluate('queueSave()');
  await instance.evaluate('requestScoreSync()');
  assert.equal(instance.state().cloud.status, 'synced');
  assert.deepEqual(cloud.calls.at(-1).stats.clearedIds, ['guest-old', 'new-win']);
  const restored = await app({ cloud: makeCloud({ initialUser: { uid: 'account-A' } }), loaded: instance.writes.at(-1) });
  await waitFor(() => restored.state().cloud.status === 'synced');
  assert.deepEqual(restored.state().stats.clearedIds, ['guest-old', 'new-win']);
  assert.equal(restored.state().scoreProfiles.guest.totalClears, 0);
});

test('local settings switches and cloud hydration never alter the saved board or history', async () => {
  const game = { ...defaultGame(), currentBoard: [0, 1], undoStack: [{ currentBoard: [0, 0] }], redoStack: [] };
  const remote = { autoCandidates: false, autoFill: false, theme: 'night' };
  const cloud = makeCloud({ users: [{ uid: 'A' }], settingsDocuments: { A: remote } });
  const instance = await app({ cloud, loaded: { currentGame: game, stats: emptyStats(), scoreProfiles: emptyScoreProfiles(), settings: {} } });
  await waitFor(() => instance.state().cloud.status === 'signed-out');
  instance.context.transact = () => { throw new Error('Settings must not transact the board'); };
  const before = JSON.stringify(instance.state().currentGame);
  instance.click('toggle-auto-fill');
  instance.click('toggle-auto');
  instance.click('set-theme', { theme: 'rose' });
  await instance.evaluate('flushWrites()');
  assert.equal(instance.state().settings.autoFill, false);
  assert.equal(instance.state().settings.autoCandidates, false);
  assert.equal(JSON.stringify(instance.state().currentGame), before);
  instance.click('sign-in');
  await waitFor(() => instance.state().cloud.status === 'synced');
  assert.deepEqual(structuredClone(instance.state().settings), remote);
  assert.deepEqual(cloud.settingsCalls[0].patch, {});
  assert.equal(JSON.stringify(instance.state().currentGame), before);
});

test('new puzzles and eligible number and memo actions use the current auto-fill setting independently of display', async () => {
  const instance = await app();
  await waitFor(() => instance.state().cloud.status === 'signed-out');
  const creates = [];
  const transactions = [];
  instance.context.createGame = (puzzle, options) => { creates.push(structuredClone(options)); return defaultGame(); };
  instance.context.transact = (game, action, options) => { transactions.push({ action: structuredClone(action), options: structuredClone(options) }); return game; };
  instance.click('toggle-auto-fill');
  instance.click('new-game', { difficulty: '初級' });
  await waitFor(() => creates.length === 1);
  assert.deepEqual(creates[0], { autoFill: false });
  instance.evaluate('enterDigit(3)');
  instance.click('toggle-mode');
  instance.click('toggle-auto');
  instance.evaluate('enterDigit(4)');
  assert.deepEqual(transactions.map(item => item.options), [{ autoFill: false }, { autoFill: false }]);
  assert.equal(transactions[1].action.autoCandidates, false);
  instance.click('toggle-auto-fill');
  instance.evaluate('enterDigit(5)');
  assert.deepEqual(transactions[2].options, { autoFill: true });
});

test('the real engine starts without filling when off and uses the new option only on the next input', async () => {
  const instance = await app();
  await waitFor(() => instance.state().cloud.status === 'signed-out');
  Object.assign(instance.context, {
    createGame: engine.createGame, transact: engine.transact,
    isComplete: engine.isComplete, getConflicts: engine.getConflicts,
    getDisplayedCandidates: engine.getDisplayedCandidates,
    choosePuzzle: () => ({ puzzleId: 'single-toggle', difficulty: '初級', puzzle: '123456780' + '0'.repeat(72) }),
  });
  instance.click('toggle-auto-fill');
  instance.click('new-game', { difficulty: '初級' });
  await waitFor(() => instance.state().currentGame?.puzzleId === 'single-toggle');
  assert.equal(instance.state().currentGame.currentBoard[8], 0);
  instance.evaluate('state.selectedCell = 9; enterDigit(4)');
  assert.equal(instance.state().currentGame.currentBoard[8], 0);
  const before = JSON.stringify(instance.state().currentGame);
  instance.click('toggle-auto-fill');
  instance.click('toggle-auto');
  assert.equal(JSON.stringify(instance.state().currentGame), before);
  instance.evaluate('state.selectedCell = 10; enterDigit(5)');
  assert.equal(instance.state().currentGame.currentBoard[8], 9);
  assert.equal(instance.state().currentGame.undoStack.length, 2);
});

test('existing accounts hydrate remote settings while new UIDs seed from guest, never a previous account', async () => {
  const guest = { autoCandidates: false, autoFill: true, theme: 'forest' };
  const remoteA = { autoCandidates: true, autoFill: false, theme: 'night' };
  const cloud = makeCloud({ initialUser: { uid: 'A' }, settingsDocuments: { A: remoteA } });
  const instance = await app({ cloud, loaded: { currentGame: defaultGame(), stats: emptyStats(), scoreProfiles: emptyScoreProfiles(), settings: guest } });
  await waitFor(() => instance.state().cloud.status === 'synced');
  assert.deepEqual(structuredClone(instance.state().settings), remoteA);
  assert.deepEqual(cloud.settingsCalls[0].patch, {});
  cloud.emit({ uid: 'B' });
  await waitFor(() => instance.state().account?.uid === 'B' && instance.state().cloud.status === 'synced');
  assert.deepEqual(cloud.preferences.get('B'), guest);
  instance.click('toggle-auto-fill');
  await waitFor(() => instance.state().cloud.status === 'synced');
  cloud.emit({ uid: 'A' });
  assert.deepEqual(structuredClone(instance.state().settings), remoteA);
  await waitFor(() => instance.state().cloud.status === 'synced');
  cloud.emit(null);
  assert.deepEqual(structuredClone(instance.state().settings), guest);
  assert.equal(instance.state().currentGame.puzzleId, 'in-progress');
});

test('offline settings changes are durable per field and retry after reload and online recovery', async () => {
  const originalRemote = { autoCandidates: true, autoFill: true, theme: 'classic' };
  const cloud = makeCloud({ initialUser: { uid: 'A' }, settingsDocuments: { A: originalRemote } });
  const instance = await app({ cloud, online: false });
  await waitFor(() => instance.state().cloud.status === 'offline');
  instance.click('toggle-auto-fill');
  instance.click('set-theme', { theme: 'rose' });
  await instance.evaluate('flushWrites()');
  assert.equal(cloud.settingsCalls.length, 0);
  const saved = instance.writes.at(-1);
  assert.deepEqual(Object.keys(saved.settingsProfiles.accounts.A.pending).sort(), ['autoFill', 'theme']);
  const restored = await app({ cloud, loaded: saved, online: false });
  await waitFor(() => restored.state().cloud.status === 'offline');
  assert.equal(restored.state().settings.autoFill, false);
  cloud.preferences.set('A', { ...originalRemote, autoCandidates: false });
  restored.context.navigator.onLine = true;
  restored.events.online();
  await waitFor(() => restored.state().cloud.status === 'synced');
  assert.deepEqual(cloud.settingsCalls.at(-1).patch, { autoFill: false, theme: 'rose' });
  assert.deepEqual(structuredClone(restored.state().settings), { autoCandidates: false, autoFill: false, theme: 'rose' });
  assert.deepEqual(structuredClone(restored.state().settingsProfiles.accounts.A.pending), {});
});

test('failed settings cloud writes retain pending fields through retry', async () => {
  let fail = false;
  const cloud = makeCloud({ initialUser: { uid: 'A' }, syncSettings: async (_uid, local, patch) => {
    if (fail) throw new Error('cloud unavailable');
    return { ...local, ...patch };
  } });
  const instance = await app({ cloud });
  await waitFor(() => instance.state().cloud.status === 'synced');
  fail = true;
  instance.click('toggle-auto-fill');
  await waitFor(() => instance.state().cloud.status === 'error');
  assert.ok(instance.state().settingsProfiles.accounts.A.pending.autoFill > 0);
  assert.equal(instance.writes.at(-1).settings.autoFill, false);
  fail = false;
  instance.click('sync-scores');
  await waitFor(() => instance.state().cloud.status === 'synced');
  assert.deepEqual(cloud.settingsCalls.at(-1).patch, { autoFill: false });
  assert.deepEqual(structuredClone(instance.state().settingsProfiles.accounts.A.pending), {});
});

test('local durability failure blocks score and settings cloud calls and retains the edit', async () => {
  const cloud = makeCloud({ initialUser: { uid: 'A' } });
  const instance = await app({ cloud });
  await waitFor(() => instance.state().cloud.status === 'synced');
  const settingsCalls = cloud.settingsCalls.length;
  const scoreCalls = cloud.calls.length;
  instance.context.saveApp = async () => { throw new Error('storage unavailable'); };
  instance.click('toggle-auto-fill');
  await waitFor(() => instance.state().cloud.status === 'error');
  assert.equal(instance.state().saveError, true);
  assert.equal(cloud.settingsCalls.length, settingsCalls);
  assert.equal(cloud.calls.length, scoreCalls);
  assert.ok(instance.state().settingsProfiles.accounts.A.pending.autoFill > 0);
  instance.context.saveApp = async data => instance.writes.push(structuredClone(data));
  instance.click('sync-scores');
  await waitFor(() => instance.state().cloud.status === 'synced');
  assert.deepEqual(cloud.settingsCalls.at(-1).patch, { autoFill: false });
});

test('settings edits while syncStats is pending remain pending until a following request', async () => {
  const gate = deferred();
  const cloud = makeCloud({ initialUser: { uid: 'A' }, syncStats: (_uid, stats, call) => call === 1 ? gate.promise : stats });
  const instance = await app({ cloud });
  await waitFor(() => cloud.calls.length === 1);
  instance.click('toggle-auto-fill');
  instance.click('set-theme', { theme: 'night' });
  await instance.evaluate('flushWrites()');
  gate.resolve(emptyStats());
  await waitFor(() => cloud.settingsCalls.length >= 2 && instance.state().cloud.status === 'synced');
  assert.deepEqual(cloud.settingsCalls[0].patch, {});
  assert.deepEqual(cloud.settingsCalls[1].patch, { autoFill: false, theme: 'night' });
  assert.equal(instance.state().settings.autoFill, false);
  assert.equal(instance.state().settings.theme, 'night');
  assert.deepEqual(structuredClone(instance.state().settingsProfiles.accounts.A.pending), {});
});

test('same-field edits during syncSettings are never acknowledged by an older response', async () => {
  const gate = deferred();
  const cloud = makeCloud({ initialUser: { uid: 'A' }, syncSettings: (_uid, local, patch, call) => call === 2
    ? gate.promise
    : { ...local, ...patch } });
  const instance = await app({ cloud });
  await waitFor(() => instance.state().cloud.status === 'synced');
  instance.click('set-theme', { theme: 'night' });
  await waitFor(() => cloud.settingsCalls.length === 2);
  instance.click('set-theme', { theme: 'classic' });
  instance.click('toggle-auto-fill');
  await instance.evaluate('flushWrites()');
  gate.resolve({ autoCandidates: false, autoFill: true, theme: 'night' });
  await waitFor(() => cloud.settingsCalls.length === 3 && instance.state().cloud.status === 'synced');
  assert.deepEqual(cloud.settingsCalls[2].patch, { theme: 'classic', autoFill: false });
  assert.deepEqual(structuredClone(instance.state().settings), { autoCandidates: false, autoFill: false, theme: 'classic' });
  assert.deepEqual(structuredClone(instance.state().settingsProfiles.accounts.A.pending), {});
});

test('account switches discard settings replies, including a return to the same UID in a new auth generation', async () => {
  for (const nextUid of ['B', 'A']) {
    const gate = deferred();
    const cloud = makeCloud({ initialUser: { uid: 'A' }, syncSettings: (_uid, local, patch, call) => call === 1 ? gate.promise : { ...local, ...patch } });
    const instance = await app({ cloud });
    await waitFor(() => cloud.settingsCalls.length === 1);
    cloud.emit({ uid: 'B' });
    if (nextUid === 'A') cloud.emit({ uid: 'A' });
    gate.resolve({ autoCandidates: false, autoFill: false, theme: 'night' });
    await waitFor(() => instance.state().account?.uid === nextUid && instance.state().cloud.status === 'synced');
    assert.equal(instance.state().settings.autoFill, true);
    assert.equal(instance.state().settings.theme, 'classic');
    assert.equal(instance.state().settingsProfiles.accounts.A.settings.theme, 'classic');
    assert.ok(cloud.settingsCalls.slice(1).every(call => call.uid === nextUid));
  }
});
