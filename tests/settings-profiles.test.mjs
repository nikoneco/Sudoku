import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SETTINGS, normalizeSettings, normalizeSettingsProfiles, getProfileSettings,
  getSettingsProfile, selectSettingsProfile, updateProfileSettings, captureSettingsSync, applySettingsSync,
} from '../js/data/settings-profiles.js';

test('missing auto-fill preserves old behavior and invalid booleans use defaults', () => {
  assert.deepEqual(normalizeSettings({ autoCandidates: false, theme: 'night' }), { autoCandidates: false, autoFill: true, theme: 'night' });
  assert.deepEqual(normalizeSettings({ autoCandidates: 'false', autoFill: 0, theme: 'unknown', board: [] }), DEFAULT_SETTINGS);
  assert.deepEqual(normalizeSettings({ autoCandidates: false, autoFill: false, theme: 'rose' }), { autoCandidates: false, autoFill: false, theme: 'rose' });
});

test('legacy selected account values and guest survive normalization, account caches stay isolated', () => {
  const legacy = { autoCandidates: false, autoFill: false, theme: 'night' };
  let profiles = normalizeSettingsProfiles(null, legacy, 'A');
  assert.deepEqual(getProfileSettings(profiles), legacy);
  profiles = updateProfileSettings(profiles, 'A', { theme: 'rose' });
  profiles = selectSettingsProfile(profiles, 'B');
  assert.deepEqual(getProfileSettings(profiles), legacy);
  profiles = updateProfileSettings(profiles, 'B', { autoFill: true });
  profiles = selectSettingsProfile(profiles, 'guest');
  assert.deepEqual(getProfileSettings(profiles), legacy);
  profiles = selectSettingsProfile(profiles, 'A');
  assert.equal(getProfileSettings(profiles).theme, 'rose');
  assert.equal(getSettingsProfile(profiles, 'B').settings.theme, 'night');
  assert.deepEqual(getSettingsProfile(profiles, 'guest').pending, {});
});

test('remote hydration wins clean fields and applies explicit patches only', () => {
  let profiles = selectSettingsProfile(normalizeSettingsProfiles(null), 'A');
  const hydration = captureSettingsSync(profiles, 'A');
  profiles = applySettingsSync(profiles, 'A', { autoCandidates: false, autoFill: false, theme: 'night' }, hydration);
  assert.deepEqual(getProfileSettings(profiles), { autoCandidates: false, autoFill: false, theme: 'night' });
  profiles = updateProfileSettings(profiles, 'A', { theme: 'rose' });
  const submitted = captureSettingsSync(profiles, 'A');
  assert.deepEqual(submitted.patch, { theme: 'rose' });
  profiles = applySettingsSync(profiles, 'A', { autoCandidates: true, autoFill: true, theme: 'rose' }, submitted);
  assert.deepEqual(getProfileSettings(profiles), { autoCandidates: true, autoFill: true, theme: 'rose' });
  assert.deepEqual(getSettingsProfile(profiles, 'A').pending, {});
});

test('new edits during a request retain field revisions, including the same field changing back', () => {
  let profiles = selectSettingsProfile(normalizeSettingsProfiles(null), 'A');
  profiles = updateProfileSettings(profiles, 'A', { theme: 'night' });
  const submitted = captureSettingsSync(profiles, 'A');
  profiles = updateProfileSettings(profiles, 'A', { theme: 'classic', autoFill: false });
  profiles = applySettingsSync(profiles, 'A', { autoCandidates: false, autoFill: true, theme: 'night' }, submitted);
  assert.deepEqual(getProfileSettings(profiles), { autoCandidates: false, autoFill: false, theme: 'classic' });
  assert.deepEqual(captureSettingsSync(profiles, 'A').patch, { theme: 'classic', autoFill: false });
  assert.equal(getSettingsProfile(profiles, 'A').pending.theme, 2);
});

test('pending patches survive reload normalization and cannot contain unknown or invalid fields', () => {
  let profiles = selectSettingsProfile(normalizeSettingsProfiles(null), '__proto__');
  profiles = updateProfileSettings(profiles, '__proto__', { autoFill: false });
  const restored = normalizeSettingsProfiles(JSON.parse(JSON.stringify(profiles)));
  assert.deepEqual(captureSettingsSync(restored, '__proto__').patch, { autoFill: false });
  assert.throws(() => updateProfileSettings(restored, '__proto__', { currentBoard: [] }));
  assert.throws(() => updateProfileSettings(restored, '__proto__', { autoFill: 'false' }));
  assert.throws(() => applySettingsSync(restored, '__proto__', { ...DEFAULT_SETTINGS, email: 'x' }, captureSettingsSync(restored, '__proto__')));
  assert.equal(Object.getPrototypeOf(restored.accounts), Object.prototype);
});
