import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8')
  .replace(/^import\s[\s\S]*?from\s+'[^']+';\s*/gm, '')
  .replaceAll('import.meta.url', JSON.stringify('http://localhost/Sudoku/js/app.js'));

async function app({ lock = true, loadError = false, delayed = false, completed = false } = {}) {
  const events = {};
  const writes = [];
  let finishLoad;
  const loaded = { currentGame: completed ? { completed: true, elapsedTime: 83 } : null, stats: { totalClears: 7 }, settings: {} };
  const root = { addEventListener(name, fn) { events[`root:${name}`] = fn; }, querySelector() { return null; } };
  const context = vm.createContext({
    URL, console, setInterval, clearInterval, performance,
    document: { querySelector: () => root, visibilityState: 'hidden', addEventListener: (name, fn) => { events[name] = fn; } },
    window: { addEventListener: (name, fn) => { events[name] = fn; } },
    navigator: { locks: { request: async (_name, _options, callback) => callback(lock ? {} : null) } },
    DEFAULT_SETTINGS: {}, DIFFICULTIES: ['初級'], emptyStats: () => ({ totalClears: 0 }),
    loadApp: () => loadError ? Promise.reject(new Error('unreadable')) : delayed ? new Promise(resolve => { finishLoad = resolve; }) : Promise.resolve(loaded),
    saveApp: async (data) => { writes.push(data); },
    renderApp() {}, getDisplayedCandidates() {}, getConflicts() {}, isComplete: game => Boolean(game?.completed),
    recordClear: stats => stats,
    syncPuzzles: async () => ({}),
  });
  vm.runInContext(source, context);
  await new Promise(resolve => setImmediate(resolve));
  return { context, events, writes, finish: async () => { finishLoad?.(loaded); await new Promise(resolve => setImmediate(resolve)); } };
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
  vm.runInContext(`state.currentGame = { completed: true, elapsedTime: 83 }; state.view = 'game'; finishIfComplete(state.currentGame);`, context);
  assert.equal(vm.runInContext('state.view', context), 'game');
  assert.equal(vm.runInContext('state.completionOpen', context), true);
  assert.equal(vm.runInContext('clockStartedAt', context), null);
  const before = vm.runInContext('JSON.stringify(state.currentGame)', context);
  events['root:keydown']({ key: 'Escape' });
  assert.equal(vm.runInContext('state.completionOpen', context), false);
  for (const key of ['1', 'Delete', 'z']) events['root:keydown']({ key, ctrlKey: key === 'z' });
  for (const action of ['digit', 'delete', 'undo', 'redo', 'clear-notes']) {
    events['root:click']({ target: { closest: selector => selector === '[data-action]' ? { dataset: { action, digit: '1' } } : null } });
  }
  assert.equal(vm.runInContext('JSON.stringify(state.currentGame)', context), before);
  assert.equal(vm.runInContext('state.view', context), 'game');
});

test('saved completed games reopen on the board with their result overlay', async () => {
  const { context } = await app({ completed: true });
  assert.equal(vm.runInContext('state.view', context), 'game');
  assert.equal(vm.runInContext('state.completionOpen', context), true);
  assert.equal(vm.runInContext('currentElapsed()', context), 83);
});

test('initialized owner persists loaded statistics on close', async () => {
  const instance = await app();
  instance.events.pagehide();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(instance.writes.at(-1).stats.totalClears, 7);
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
