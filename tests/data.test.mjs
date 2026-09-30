import { test } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { saveApp, loadApp, emptyStats, recordClear, writeValue, readValue } from '../js/data/storage.js';
import { choosePuzzle, isValidPuzzle, validateDataset } from '../js/data/puzzle-repository.js';
import { createGame, transact, undo, redo } from '../js/game/engine.js';
import { normalizeSettingsProfiles, selectSettingsProfile, updateProfileSettings } from '../js/data/settings-profiles.js';
const digits = '530070000600195000098000060800060003400803001700020006060000280000419005000080079';
const puzzle = { puzzleId: 'sample_1', difficulty: '初級', puzzle: digits };

function deferred() {
  let resolve;
  const promise = new Promise(res => { resolve = res; });
  return { promise, resolve };
}

function dataset(version, prefix) {
  return {
    schemaVersion: 1,
    datasetVersion: version,
    puzzles: ['初級', '中級', '上級', '超上級'].map((difficulty, index) => ({
      ...puzzle, puzzleId: `${prefix}_${index}`, difficulty,
    })),
  };
}

test('concurrent startup loading and synchronization cannot overwrite the newer dataset', async t => {
  await writeValue('dataset', null);
  const repository = await import('../js/data/puzzle-repository.js?startup-single-flight');
  const bundled = dataset(1, 'bundle');
  const updated = dataset(2, 'remote');
  const bundleResponse = deferred();
  const bundleStarted = deferred();
  let bundleRequests = 0;
  let syncRequests = 0;
  t.mock.method(globalThis, 'fetch', async url => {
    if (String(url).endsWith('/data/puzzles.json')) {
      bundleRequests += 1;
      bundleStarted.resolve();
      return bundleResponse.promise;
    }
    syncRequests += 1;
    return { ok: true, json: async () => updated };
  });

  const catalog = repository.loadPuzzles();
  const syncing = repository.syncPuzzles();
  const additionalLoad = repository.loadPuzzles();
  await bundleStarted.promise;
  await new Promise(setImmediate);
  assert.equal(bundleRequests, 1);
  bundleResponse.resolve({ ok: true, json: async () => bundled });
  await Promise.all([catalog, additionalLoad]);
  assert.deepEqual(await syncing, { updated: true, count: 4 });
  assert.equal(syncRequests, 1);
  assert.deepEqual((await readValue('dataset')), updated);
  assert.deepEqual(await repository.loadPuzzles(), updated.puzzles);
});

test('a failed shared initial load allows a later successful retry', async t => {
  await writeValue('dataset', null);
  const repository = await import('../js/data/puzzle-repository.js?initial-load-retry');
  const recovered = dataset(1, 'recovered');
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    requests += 1;
    return requests === 1 ? { ok: false } : { ok: true, json: async () => recovered };
  });

  const failed = await Promise.allSettled([repository.loadPuzzles(), repository.syncPuzzles()]);
  assert.equal(requests, 1);
  assert.deepEqual(failed.map(result => result.status), ['rejected', 'rejected']);
  assert.deepEqual(await repository.loadPuzzles(), recovered.puzzles);
  assert.equal(requests, 2);
  assert.deepEqual(await readValue('dataset'), recovered);
});

test('themes persist and existing or invalid settings fall back without losing progress', async () => {
  const game = createGame({ ...puzzle, puzzle: '0'.repeat(81) });
  for (const theme of ['classic', 'forest', 'rose', 'night', undefined, 'unknown']) {
    await saveApp({ currentGame: game, stats: emptyStats(), settings: { autoCandidates: false, theme } });
    const saved = await loadApp();
    assert.equal(saved.settings.theme, theme && theme !== 'unknown' ? theme : 'classic');
    assert.equal(saved.settings.autoCandidates, false);
    assert.deepEqual(saved.currentGame, game);
  }
});

test('dataset rejects conflicting givens, malformed boards and absent tiers', () => {
  assert.equal(isValidPuzzle(puzzle), true);
  assert.equal(isValidPuzzle({ ...puzzle, puzzle: '550' + digits.slice(3) }), false);
  assert.equal(isValidPuzzle({ ...puzzle, puzzle: '0'.repeat(81) }), false);
  assert.throws(() => validateDataset({ schemaVersion: 1, datasetVersion: 1, puzzles: [puzzle] }));
});
test('selection prefers uncleared alternatives, falls back and excludes current', () => {
  const list = ['a', 'b', 'c'].map(puzzleId => ({ ...puzzle, puzzleId }));
  assert.equal(choosePuzzle(list, '初級', ['a', 'b'], 'b').puzzleId, 'c');
  assert.equal(choosePuzzle(list.slice(0, 2), '初級', ['a', 'b'], 'b').puzzleId, 'a');
  assert.throws(() => choosePuzzle(list, '上級'));
});
test('serialized snapshots capture at call time and preserve stats across replacement', async () => {
  const state = { currentGame: null, stats: emptyStats(), settings: { autoCandidates: false } };
  const first = saveApp(state);
  state.stats.totalClears = 99;
  await first;
  assert.equal((await loadApp()).stats.totalClears, 0);
  await Promise.all([writeValue('order', 1), writeValue('order', 2), writeValue('order', 3)]);
  assert.equal(await readValue('order'), 3);
  const game = { puzzleId: 'a', difficulty: '初級', elapsedTime: 45 };
  const stats = recordClear(emptyStats(), game);
  assert.equal(recordClear(stats, game).totalClears, 1);
  await saveApp({ ...state, stats });
  assert.equal((await loadApp()).stats.byDifficulty['初級'].bestTime, 45);
  assert.equal((await loadApp()).settings.autoCandidates, false);
});

test('real game, candidate masks and both history stacks survive storage round trip', async () => {
  const initial = createGame({ ...puzzle, puzzle: '0'.repeat(81) });
  let game = transact(initial, { type: 'set', cell: 0, value: 1 });
  game = transact(game, { type: 'toggleCandidate', cell: 10, value: 2 });
  game = undo(game);
  game = { ...game, elapsedTime: 83.625 };
  const stats = recordClear(emptyStats(), { puzzleId: 'previous', difficulty: '初級', elapsedTime: 30 });
  await saveApp({ currentGame: game, stats, settings: { autoCandidates: true } });
  const loaded = await loadApp();
  assert.deepEqual(loaded.currentGame, game);
  assert.equal(loaded.currentGame.elapsedTime, 83.625);
  assert.deepEqual(redo(loaded.currentGame), redo(game));
  await saveApp({ ...loaded, currentGame: { ...initial, puzzleId: 'replacement' } });
  assert.equal((await loadApp()).stats.totalClears, 1);
  await assert.rejects(saveApp({ ...loaded, currentGame: { ...game, undoStack: [{}] } }));
  assert.equal((await loadApp()).currentGame.puzzleId, 'replacement');
});

test('legacy settings use strict booleans and preserve the selected account values without altering progress', async () => {
  const game = createGame({ ...puzzle, puzzle: '0'.repeat(81) });
  const scoreProfiles = { guest: emptyStats(), accounts: { A: emptyStats() }, activeKey: 'A' };
  await writeValue('app', { currentGame: game, stats: emptyStats(), scoreProfiles, settings: { autoCandidates: false, autoFill: 'false', theme: 'night' } });
  const loaded = await loadApp();
  assert.deepEqual(loaded.currentGame, game);
  assert.deepEqual(loaded.settings, { autoCandidates: false, autoFill: true, theme: 'night' });
  assert.deepEqual(loaded.settingsProfiles.accounts.A.settings, loaded.settings);
  assert.deepEqual(loaded.settingsProfiles.accounts.A.pending, {});
});

test('pending per-account settings revisions survive atomic app storage', async () => {
  const game = createGame({ ...puzzle, puzzle: '0'.repeat(81) });
  let settingsProfiles = normalizeSettingsProfiles(null, { theme: 'forest' });
  settingsProfiles = selectSettingsProfile(settingsProfiles, 'A');
  settingsProfiles = updateProfileSettings(settingsProfiles, 'A', { autoFill: false });
  const scoreProfiles = { guest: emptyStats(), accounts: { A: emptyStats() }, activeKey: 'A' };
  await saveApp({ currentGame: game, scoreProfiles, settingsProfiles, stats: emptyStats() });
  const loaded = await loadApp();
  assert.deepEqual(loaded.settingsProfiles, settingsProfiles);
  assert.deepEqual(loaded.settings, { autoCandidates: true, autoFill: false, theme: 'forest' });
  assert.deepEqual(loaded.currentGame, game);
});
