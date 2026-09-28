import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { DIFFICULTIES, THEMES } from '../js/config.js';
import { emptyStats, mergeStats, normalizeStats, recordClear } from '../js/data/stats.js';
import {
  emptyScoreProfiles,
  getGuestScoreCount,
  getProfileStats,
  importGuestScores,
  normalizeScoreProfiles,
  selectScoreProfile,
  updateProfileStats,
} from '../js/data/score-profiles.js';

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

function makeCloud({ initialUser = null, users = [], syncStats = async (_uid, stats) => stats } = {}) {
  let authListener = null;
  let signInIndex = 0;
  const calls = [];
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
  };
  return {
    client,
    calls,
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
} = {}) {
  const events = {};
  const writes = [];
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
    queueMicrotask,
    document: {
      documentElement: { dataset: {} },
      querySelector: selector => selector === '#app' ? root : null,
      visibilityState: 'hidden',
      addEventListener: (name, fn) => { events[name] = fn; },
    },
    window: { addEventListener: (name, fn) => { events[name] = fn; } },
    navigator: {
      onLine: true,
      locks: { request: async (_name, _options, callback) => callback(lock ? {} : null) },
    },
    DEFAULT_SETTINGS: { autoCandidates: true, theme: 'classic' },
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
    renderApp() {},
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
  });
  vm.runInContext(source, context);
  const instance = {
    context,
    events,
    writes,
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
