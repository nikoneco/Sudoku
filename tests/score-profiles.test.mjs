import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyStats,
  mergeStats,
  recordClear,
} from '../js/data/stats.js';
import {
  emptyScoreProfiles,
  getGuestScoreCount,
  getProfileStats,
  importGuestScores,
  normalizeScoreProfiles,
  selectScoreProfile,
  updateProfileStats,
} from '../js/data/score-profiles.js';

const clear = (stats, puzzleId, elapsedTime, difficulty = '初級') => recordClear(stats, {
  puzzleId,
  difficulty,
  elapsedTime,
});

test('legacy statistics migrate into the guest profile without losing aggregates', () => {
  const legacy = {
    clearedIds: ['old-puzzle'],
    byDifficulty: { 初級: { clears: 3, bestTime: 42 } },
    totalClears: 5,
  };

  const profiles = normalizeScoreProfiles(null, legacy);

  assert.equal(profiles.activeKey, 'guest');
  assert.deepEqual(profiles.accounts, {});
  assert.deepEqual(profiles.guest.clearedIds, ['old-puzzle']);
  assert.equal(profiles.guest.totalClears, 5);
  assert.equal(profiles.guest.byDifficulty.初級.clears, 3);
  assert.equal(profiles.guest.legacyBest.初級, 42);
  assert.equal(getGuestScoreCount(profiles), 5);
});

test('selecting and updating accounts keeps guest and other account scores isolated', () => {
  const guest = clear(emptyStats(), 'guest-win', 19);
  const accountA = clear(emptyStats(), 'a-win', 12);
  const accountB = clear(emptyStats(), 'b-win', 9, '中級');
  let profiles = { ...emptyScoreProfiles(), guest };
  profiles = updateProfileStats(profiles, 'account-A', accountA);
  profiles = updateProfileStats(profiles, 'account-B', accountB);

  const selectedA = selectScoreProfile(profiles, 'account-A');
  assert.equal(selectedA.activeKey, 'account-A');
  assert.deepEqual(getProfileStats(selectedA).clearedIds, ['a-win']);
  assert.deepEqual(selectedA.guest.clearedIds, ['guest-win']);
  assert.deepEqual(selectedA.accounts['account-B'].clearedIds, ['b-win']);

  const selectedGuest = selectScoreProfile(selectedA, 'guest');
  assert.deepEqual(getProfileStats(selectedGuest).clearedIds, ['guest-win']);
  assert.deepEqual(profiles.accounts['account-A'].clearedIds, ['a-win']);
});

test('guest import merges records and best times once, then clears only the guest profile', () => {
  let profiles = {
    guest: clear(clear(emptyStats(), 'shared', 30), 'guest-only', 50),
    accounts: {
      'account-A': clear(emptyStats(), 'shared', 20),
      'account-B': clear(emptyStats(), 'b-only', 10),
    },
    activeKey: 'account-A',
  };
  const before = structuredClone(profiles);

  profiles = importGuestScores(profiles, 'account-A');

  assert.deepEqual(profiles.guest, emptyStats());
  assert.deepEqual(profiles.accounts['account-A'].clearedIds, ['guest-only', 'shared']);
  assert.equal(profiles.accounts['account-A'].records.shared.elapsedTime, 20);
  assert.equal(profiles.accounts['account-A'].records['guest-only'].elapsedTime, 50);
  assert.deepEqual(profiles.accounts['account-B'].clearedIds, ['b-only']);
  assert.equal(profiles.activeKey, 'account-A');
  assert.deepEqual(before.guest.clearedIds, ['guest-only', 'shared']);
  assert.deepEqual(before.accounts['account-A'].clearedIds, ['shared']);

  const secondImport = importGuestScores(profiles, 'account-A');
  assert.deepEqual(secondImport.accounts['account-A'], profiles.accounts['account-A']);
});

test('importing into a new account creates it and preserves legacy guest-only fields', () => {
  const profiles = normalizeScoreProfiles({
    guest: { clearedIds: ['legacy-id'], byDifficulty: { 上級: { clears: 2, bestTime: 33 } }, totalClears: 4 },
    accounts: {},
    activeKey: 'guest',
  });

  const imported = importGuestScores(profiles, 'new-account');

  assert.equal(imported.accounts['new-account'].totalClears, 4);
  assert.equal(imported.accounts['new-account'].legacyBest.上級, 33);
  assert.equal(imported.guest.totalClears, 0);
});

test('profile keys that resemble object prototype fields remain ordinary account IDs', () => {
  const stats = clear(emptyStats(), 'safe-id', 8);
  const profiles = updateProfileStats(emptyScoreProfiles(), '__proto__', stats);

  assert.equal(Object.hasOwn(profiles.accounts, '__proto__'), true);
  assert.deepEqual(getProfileStats(profiles, '__proto__').clearedIds, ['safe-id']);
  assert.deepEqual(mergeStats(profiles.accounts.__proto__, stats).clearedIds, ['safe-id']);
});

