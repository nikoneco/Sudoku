import { test } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { NORMAL_REGIONS } from '../js/game/regions.js';
import { createGame, transact } from '../js/game/engine.js';
import { saveApp, loadApp, writeValue, validateGame } from '../js/data/storage.js';
import { isValidPuzzle, validateDataset, choosePuzzle } from '../js/data/puzzle-repository.js';
import { emptyStats, recordClear, getModeStats, awardExperience, mergeStats } from '../js/data/stats.js';
import { getExperience } from '../js/data/experience.js';
import { normalizeSettingsProfiles, selectSettingsProfile, updateProfileSettings, captureSettingsSync, applySettingsSync, getProfileSettings } from '../js/data/settings-profiles.js';

const map = [...NORMAL_REGIONS];
[map[11], map[21]] = [map[21], map[11]];
const regions = map.join('');
const normal = { puzzleId: 'normal_fixture', difficulty: '初級', puzzle: '1' + '0'.repeat(80) };
const jigsaw = { ...normal, puzzleId: 'jigsaw_fixture', mode: 'jigsaw', regions };

test('two mode slots preserve independent boards, notes, time and undo stacks across saves', async () => {
  const first = { ...transact(createGame(normal, { autoFill: false }), { type: 'set', cell: 1, value: 2 }, { autoFill: false }), elapsedTime: 12.75 };
  const second = { ...transact(createGame(jigsaw, { autoFill: false }), { type: 'toggleCandidate', cell: 1, value: 9 }, { autoFill: false }), elapsedTime: 9.25 };
  await saveApp({ currentGame: second, currentGames: { normal: first, jigsaw: second }, stats: emptyStats(), settings: { mode: 'jigsaw' } });
  const saved = await loadApp();
  assert.deepEqual(saved.currentGames, { normal: first, jigsaw: second });
  assert.deepEqual(saved.currentGame, second);
  assert.equal(saved.settings.mode, 'jigsaw');
  await saveApp({ ...saved, currentGame: first, settingsProfiles: undefined, settings: { mode: 'normal' } });
  assert.deepEqual((await loadApp()).currentGames.jigsaw, second);
});

test('legacy save migrates to normal and damaged inactive jigsaw is preserved by rejecting load', async () => {
  const game = createGame(normal, { autoFill: false });
  await writeValue('app', { currentGame: game, stats: emptyStats(), settings: {} });
  assert.deepEqual((await loadApp()).currentGames, { normal: game, jigsaw: null });
  assert.equal(validateGame({ ...game, mode: 'jigsaw', puzzleId: 'jigsaw_bad', regions: '0'.repeat(81) }), false);
  await writeValue('app', { currentGame: game, currentGames: { normal: game, jigsaw: { ...game, mode: 'jigsaw' } } });
  await assert.rejects(loadApp(), /保持/);
  await writeValue('app', null);
});

test('catalogs validate irregular regions and choose only the requested mode', () => {
  assert.equal(isValidPuzzle(jigsaw), true);
  assert.equal(isValidPuzzle({ ...jigsaw, regions: NORMAL_REGIONS.slice(1) }), false);
  assert.equal(isValidPuzzle({ ...jigsaw, mode: 'normal' }), false);
  const rows = ['初級', '中級', '上級', '超上級'].map((difficulty, i) => ({ ...jigsaw, puzzleId: `jigsaw_${i}`, difficulty, solution: 'PRIVATE' }));
  const dataset = validateDataset({ schemaVersion: 1, datasetVersion: 1, puzzles: rows }, 'jigsaw');
  assert.equal(dataset.puzzles.length, 4);
  assert.equal(JSON.stringify(dataset).includes('PRIVATE'), false);
  assert.deepEqual(choosePuzzle([normal, jigsaw], '初級', [], null, 'jigsaw'), jigsaw);
  assert.deepEqual(choosePuzzle([normal, jigsaw], '初級'), normal);
});

test('mode statistics separate best times and legacy baselines while XP and merged records stay shared', () => {
  let stats = recordClear(emptyStats(), { ...normal, elapsedTime: 120 });
  stats = recordClear(stats, { ...jigsaw, elapsedTime: 30 });
  stats.legacyBest = { '初級': 90 };
  stats = awardExperience(stats, '018f47d2-a590-7cc2-9b60-bc5472b7d824', '初級');
  stats = awardExperience(stats, '018f47d2-a590-7cc2-9b60-bc5472b7d825', '中級');
  const merged = mergeStats(stats, stats);
  const regular = getModeStats(merged, 'normal');
  const irregular = getModeStats(merged, 'jigsaw');
  assert.deepEqual(regular.byDifficulty['初級'], { clears: 1, bestTime: 90 });
  assert.deepEqual(irregular.byDifficulty['初級'], { clears: 1, bestTime: 30 });
  assert.equal(regular.totalClears, 1);
  assert.equal(irregular.totalClears, 1);
  assert.equal(getExperience(regular).totalExp, 50);
  assert.deepEqual(getExperience(regular), getExperience(irregular));
  assert.equal(merged.totalClears, 2);
});

test('mode changes use per-field revisions and a later local switch survives a stale cloud reply', () => {
  let profiles = selectSettingsProfile(normalizeSettingsProfiles(null), 'account');
  profiles = updateProfileSettings(profiles, 'account', { mode: 'jigsaw' });
  const sent = captureSettingsSync(profiles, 'account');
  profiles = updateProfileSettings(profiles, 'account', { mode: 'normal' });
  profiles = applySettingsSync(profiles, 'account', { autoCandidates: true, autoFill: true, theme: 'classic', mode: 'jigsaw' }, sent);
  assert.equal(getProfileSettings(profiles).mode, 'normal');
  assert.deepEqual(captureSettingsSync(profiles, 'account').patch, { mode: 'normal' });
  assert.throws(() => updateProfileSettings(profiles, 'account', { mode: 'unknown' }));
});
