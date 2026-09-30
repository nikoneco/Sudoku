import { THEMES } from '../config.js';

export const DEFAULT_SETTINGS = Object.freeze({ autoCandidates: true, autoFill: true, theme: 'classic' });
export const SETTINGS_FIELDS = Object.freeze(Object.keys(DEFAULT_SETTINGS));
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const validKey = key => typeof key === 'string' && key.length > 0 && key !== 'guest';
const validRevision = value => Number.isSafeInteger(value) && value > 0;
const validValue = (field, value) => field === 'theme'
  ? THEMES.some(theme => theme.id === value)
  : typeof value === 'boolean';

function setOwn(object, key, value) {
  Object.defineProperty(object, key, { configurable: true, enumerable: true, writable: true, value });
}

export function normalizeSettings(value) {
  const settings = { ...DEFAULT_SETTINGS };
  for (const field of SETTINGS_FIELDS) {
    if (isObject(value) && hasOwn(value, field) && validValue(field, value[field])) settings[field] = value[field];
  }
  return settings;
}

export function validateSettingsPatch(patch) {
  if (!isObject(patch) || Object.keys(patch).some(field => !SETTINGS_FIELDS.includes(field)
    || !validValue(field, patch[field]))) throw new TypeError('Invalid settings patch');
  return { ...patch };
}

export function isValidSettings(value) {
  return isObject(value) && Object.keys(value).length === SETTINGS_FIELDS.length
    && SETTINGS_FIELDS.every(field => hasOwn(value, field) && validValue(field, value[field]));
}

function normalizeProfile(value, fallback, guest = false) {
  const pending = {};
  if (!guest && isObject(value?.pending)) {
    for (const field of SETTINGS_FIELDS) {
      if (validRevision(value.pending[field])) pending[field] = value.pending[field];
    }
  }
  const revision = Math.max(Number.isSafeInteger(value?.revision) && value.revision >= 0 ? value.revision : 0,
    ...Object.values(pending));
  return { settings: normalizeSettings(value?.settings ?? fallback), pending, revision };
}

/** Legacy preferences belonged to the selected local profile before account caches existed. */
export function normalizeSettingsProfiles(value, legacySettings = DEFAULT_SETTINGS, activeKey = value?.activeKey || 'guest') {
  const source = isObject(value) ? value : null;
  const guest = normalizeProfile(source?.guest, legacySettings, true);
  const accounts = {};
  if (isObject(source?.accounts)) {
    for (const [uid, profile] of Object.entries(source.accounts)) {
      if (validKey(uid)) setOwn(accounts, uid, normalizeProfile(profile, guest.settings));
    }
  }
  const key = activeKey === 'guest' || validKey(activeKey) ? activeKey : 'guest';
  if (key !== 'guest' && !hasOwn(accounts, key)) {
    // A legacy selected account keeps its last settings; a new UID starts from guest only.
    setOwn(accounts, key, normalizeProfile(null, source ? guest.settings : legacySettings));
  }
  return { guest, accounts, activeKey: key };
}

export function getSettingsProfile(profiles, key = profiles?.activeKey) {
  return key === 'guest' ? profiles.guest : hasOwn(profiles.accounts, key) ? profiles.accounts[key] : null;
}

export function getProfileSettings(profiles, key = profiles?.activeKey) {
  return { ...normalizeSettings(getSettingsProfile(profiles, key)?.settings) };
}

export function selectSettingsProfile(profiles, key) {
  if (key !== 'guest' && !validKey(key)) throw new TypeError('Invalid settings profile key');
  return normalizeSettingsProfiles(profiles, DEFAULT_SETTINGS, key);
}

function replaceProfile(profiles, key, profile) {
  if (key === 'guest') return { ...profiles, guest: profile };
  const accounts = { ...profiles.accounts };
  setOwn(accounts, key, profile);
  return { ...profiles, accounts };
}

/** Only deliberate, changed fields become pending cloud writes. */
export function updateProfileSettings(profiles, key, patch) {
  const changes = validateSettingsPatch(patch);
  const selected = selectSettingsProfile(profiles, key);
  const current = getSettingsProfile(selected, key);
  const changedFields = Object.keys(changes).filter(field => changes[field] !== current.settings[field]);
  if (!changedFields.length) return selected;
  if (current.revision === Number.MAX_SAFE_INTEGER) throw new RangeError('Settings revision exhausted');
  const revision = current.revision + 1;
  const pending = { ...current.pending };
  if (key !== 'guest') for (const field of changedFields) pending[field] = revision;
  return replaceProfile(selected, key, {
    settings: { ...current.settings, ...changes }, pending, revision,
  });
}

/** Capture the exact per-field revisions sent by one request, before awaiting network work. */
export function captureSettingsSync(profiles, key) {
  const profile = getSettingsProfile(profiles, key);
  if (!profile || !validKey(key)) throw new TypeError('A settings account is required');
  const patch = {};
  for (const field of Object.keys(profile.pending)) patch[field] = profile.settings[field];
  return { settings: { ...profile.settings }, patch, pending: { ...profile.pending }, revision: profile.revision };
}

/** Acknowledge only the revisions actually sent; later edits remain local and pending. */
export function applySettingsSync(profiles, key, remoteSettings, submitted) {
  if (!isValidSettings(remoteSettings)) throw new TypeError('Invalid remote settings');
  const profile = getSettingsProfile(profiles, key);
  if (!profile || !validKey(key)) throw new TypeError('A settings account is required');
  const pending = { ...profile.pending };
  for (const field of Object.keys(submitted.pending)) {
    if (pending[field] === submitted.pending[field]) delete pending[field];
  }
  const settings = { ...remoteSettings };
  for (const field of Object.keys(pending)) settings[field] = profile.settings[field];
  return replaceProfile(profiles, key, { ...profile, settings, pending });
}
