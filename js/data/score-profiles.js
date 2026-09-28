import { emptyStats, mergeStats, normalizeStats } from './stats.js';

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function setOwn(object, key, value) {
  Object.defineProperty(object, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

function validProfileKey(value) {
  return typeof value === 'string' && value.length > 0 && value !== 'guest';
}

export function emptyScoreProfiles() {
  return { guest: emptyStats(), accounts: {}, activeKey: 'guest' };
}

/** Normalize persisted profiles, moving legacy aggregate statistics into guest. */
export function normalizeScoreProfiles(value, legacyStats = emptyStats(), puzzles = []) {
  const source = value && typeof value === 'object' ? value : null;
  const guestSource = source && hasOwn(source, 'guest') ? source.guest : legacyStats;
  const accounts = {};

  if (source?.accounts && typeof source.accounts === 'object' && !Array.isArray(source.accounts)) {
    for (const [uid, stats] of Object.entries(source.accounts)) {
      if (validProfileKey(uid)) setOwn(accounts, uid, normalizeStats(stats, puzzles));
    }
  }

  const activeKey = source?.activeKey === 'guest' || validProfileKey(source?.activeKey)
    ? source.activeKey
    : 'guest';
  if (activeKey !== 'guest' && !hasOwn(accounts, activeKey)) {
    setOwn(accounts, activeKey, emptyStats());
  }

  return {
    guest: normalizeStats(guestSource, puzzles),
    accounts,
    activeKey,
  };
}

export function getProfileStats(profiles, key = profiles?.activeKey) {
  if (!profiles || typeof profiles !== 'object') return emptyStats();
  if (key === 'guest') return profiles.guest || emptyStats();
  if (!validProfileKey(key)) return emptyStats();
  return profiles.accounts?.[key] || emptyStats();
}

/** Return normalized profiles with one account selected; guest never maps to a UID. */
export function selectScoreProfile(profiles, key, puzzles = []) {
  const normalized = normalizeScoreProfiles(profiles, profiles?.guest, puzzles);
  if (key !== 'guest' && !validProfileKey(key)) throw new TypeError('Profile key must be guest or a nonempty UID');
  if (key !== 'guest' && !hasOwn(normalized.accounts, key)) {
    setOwn(normalized.accounts, key, emptyStats());
  }
  return { ...normalized, activeKey: key };
}

/** Replace only one profile's score snapshot while keeping every other profile. */
export function updateProfileStats(profiles, key, stats, puzzles = []) {
  const normalized = normalizeScoreProfiles(profiles, profiles?.guest, puzzles);
  const nextStats = normalizeStats(stats, puzzles);
  if (key === 'guest') return { ...normalized, guest: nextStats };
  if (!validProfileKey(key)) throw new TypeError('Profile key must be guest or a nonempty UID');
  const accounts = { ...normalized.accounts };
  setOwn(accounts, key, nextStats);
  return { ...normalized, accounts };
}

/** Import guest results into one account; callers persist this result before syncing it. */
export function importGuestScores(profiles, uid, puzzles = []) {
  if (!validProfileKey(uid)) throw new TypeError('A signed-in UID is required to import guest scores');
  const normalized = normalizeScoreProfiles(profiles, profiles?.guest, puzzles);
  const account = getProfileStats(normalized, uid);
  const merged = mergeStats(account, normalized.guest, puzzles);
  const accounts = { ...normalized.accounts };
  setOwn(accounts, uid, merged);
  return {
    guest: emptyStats(),
    accounts,
    activeKey: uid,
  };
}

export function getGuestScoreCount(profiles) {
  const guest = profiles?.guest || emptyStats();
  const recordsCount = guest.records && typeof guest.records === 'object'
    ? Object.keys(guest.records).length
    : 0;
  const legacyCount = Array.isArray(guest.clearedIds) ? guest.clearedIds.length : 0;
  return Math.max(0, Number(guest.totalClears) || 0, recordsCount, legacyCount);
}
