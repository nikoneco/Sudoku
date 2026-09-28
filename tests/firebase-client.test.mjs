import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFirebaseClient } from '../js/cloud/firebase-client.js';
import { awardExperience, emptyStats, recordClear } from '../js/data/stats.js';

function makeSdk({ documents = {}, beforeTransaction = null, existingApps = [] } = {}) {
  const state = {
    auth: { currentUser: { uid: 'account-a', displayName: 'Player' } },
    documents: new Map(Object.entries(documents).map(([path, value]) => [path, structuredClone(value)])),
    writes: [],
    transactionCount: 0,
    initializedApps: [],
    persistence: null,
    providerParameters: null,
    authListener: null,
  };
  const appSdk = {
    getApps: () => existingApps,
    initializeApp(config, name) {
      const app = { config, name };
      state.initializedApps.push(app);
      return app;
    },
  };
  const authSdk = {
    browserLocalPersistence: 'browser-local',
    getAuth: (app) => { state.auth.app = app; return state.auth; },
    setPersistence: async (auth, persistence) => { state.persistence = persistence; auth.currentUser = state.auth.currentUser; },
    useDeviceLanguage() {},
    GoogleAuthProvider: class {
      setCustomParameters(parameters) { state.providerParameters = parameters; }
    },
    onAuthStateChanged(auth, listener) {
      state.authListener = listener;
      listener(auth.currentUser);
      return () => { state.authListener = null; };
    },
    signInWithPopup: async (auth) => ({ user: { uid: auth.currentUser?.uid || 'account-a' } }),
    signOut: async (auth) => { auth.currentUser = null; state.auth.currentUser = null; state.authListener?.(null); },
  };
  const firestoreSdk = {
    getFirestore: (app) => ({ app }),
    collection(_database, ...segments) { return { path: segments.join('/') }; },
    doc(parent, ...segments) {
      const prefix = parent?.path || '';
      return { path: [prefix, ...segments].filter(Boolean).join('/') };
    },
    async getDoc(reference) { return documentSnapshot(reference.path, state.documents); },
    async getDocs(reference) {
      const prefix = `${reference.path}/`;
      const docs = [...state.documents.entries()]
        .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
        .map(([path]) => documentSnapshot(path, state.documents));
      return { docs };
    },
    async runTransaction(_database, callback) {
      state.transactionCount += 1;
      await beforeTransaction?.(state, state.transactionCount);
      const pending = new Map();
      const transaction = {
        async get(reference) { return documentSnapshot(reference.path, state.documents); },
        set(reference, value) { pending.set(reference.path, structuredClone(value)); },
      };
      await callback(transaction);
      for (const [path, value] of pending) {
        state.documents.set(path, value);
        state.writes.push({ path, data: structuredClone(value) });
      }
    },
  };
  return { state, sdkLoader: async () => [appSdk, authSdk, firestoreSdk] };
}

function documentSnapshot(path, documents) {
  const exists = documents.has(path);
  const value = documents.get(path);
  return {
    id: path.slice(path.lastIndexOf('/') + 1),
    exists: () => exists,
    data: () => exists ? structuredClone(value) : undefined,
  };
}

const record = (puzzleId, difficulty, elapsedTime) => recordClear(emptyStats(), { puzzleId, difficulty, elapsedTime });

test('Firebase client selects the Sudoku app and requests a local-persistent account chooser', async () => {
  const { state, sdkLoader } = makeSdk();
  const client = await createFirebaseClient({ sdkLoader });
  const users = [];
  const unsubscribe = client.onAuthStateChanged((user) => users.push(user));

  assert.deepEqual(users, [{ uid: 'account-a', displayName: 'Player' }]);
  assert.equal(state.initializedApps[0].name, 'sudoku');
  assert.equal(state.persistence, 'browser-local');
  assert.deepEqual(state.providerParameters, { prompt: 'select_account' });
  assert.equal(typeof unsubscribe, 'function');
  assert.equal((await client.signIn()).user.uid, 'account-a');
});

test('score sync merges remote records and writes only missing or better score data', async () => {
  const { state, sdkLoader } = makeSdk({
    documents: {
      'users/account-a/scores/local-a': { difficulty: '初級', elapsedTime: 240 },
      'users/account-a/scores/remote-a': { difficulty: '上級', elapsedTime: 90 },
      'users/account-a/scoreMeta/legacy': { bestTimes: { '初級': 120 } },
    },
  });
  const client = await createFirebaseClient({ sdkLoader });
  const local = recordClear(recordClear(emptyStats(), { puzzleId: 'local-a', difficulty: '初級', elapsedTime: 110 }), {
    puzzleId: 'local-b', difficulty: '中級', elapsedTime: 130,
  });
  local.legacyBest = { '初級': 95, '中級': 100 };

  const merged = await client.syncStats('account-a', local);

  assert.deepEqual(merged.clearedIds, ['local-a', 'local-b', 'remote-a']);
  assert.deepEqual(merged.records['local-a'], { difficulty: '初級', elapsedTime: 110 });
  assert.deepEqual(merged.records['remote-a'], { difficulty: '上級', elapsedTime: 90 });
  assert.equal(merged.byDifficulty['中級'].bestTime, 100);
  assert.deepEqual(state.writes, [
    { path: 'users/account-a/scores/local-a', data: { difficulty: '初級', elapsedTime: 110 } },
    { path: 'users/account-a/scores/local-b', data: { difficulty: '中級', elapsedTime: 130 } },
    { path: 'users/account-a/scoreMeta/legacy', data: { bestTimes: { '初級': 95, '中級': 100 } } },
  ]);
});

test('transaction rereads preserve a concurrently saved faster score', async () => {
  let raced = false;
  const { state, sdkLoader } = makeSdk({
    documents: { 'users/account-a/scores/race': { difficulty: '初級', elapsedTime: 300 } },
    beforeTransaction(current, count) {
      if (!raced && count === 1) {
        raced = true;
        current.documents.set('users/account-a/scores/race', { difficulty: '初級', elapsedTime: 80 });
      }
    },
  });
  const client = await createFirebaseClient({ sdkLoader });
  const merged = await client.syncStats('account-a', record('race', '初級', 130));

  assert.equal(state.writes.length, 0);
  assert.equal(merged.records.race.elapsedTime, 80);
});

test('auth changing inside a transaction prevents its write', async () => {
  const { state, sdkLoader } = makeSdk({
    beforeTransaction(current) { current.auth.currentUser = null; },
  });
  const client = await createFirebaseClient({ sdkLoader });

  await assert.rejects(
    client.syncStats('account-a', record('guarded', '初級', 100)),
    /auth-changed/,
  );
  assert.equal(state.writes.length, 0);
});

test('malformed cloud scores and legacy maps are ignored on read', async () => {
  const { state, sdkLoader } = makeSdk({
    documents: {
      'users/account-a/scores/valid': { difficulty: '中級', elapsedTime: 70 },
      'users/account-a/scores/extra-field': { difficulty: '中級', elapsedTime: 20, notes: 'not accepted' },
      'users/account-a/scores/bad-time': { difficulty: '中級', elapsedTime: 31_536_001 },
      'users/account-a/scores/bad-tier': { difficulty: '特級', elapsedTime: 20 },
      'users/account-a/scoreMeta/legacy': { bestTimes: { '初級': 40, '特級': 20 } },
    },
  });
  const client = await createFirebaseClient({ sdkLoader });
  const merged = await client.syncStats('account-a', emptyStats());

  assert.deepEqual(merged.clearedIds, ['valid']);
  assert.deepEqual(merged.records, { valid: { difficulty: '中級', elapsedTime: 70 } });
  assert.deepEqual(merged.legacyBest, {});
  assert.equal(state.writes.length, 0);
});

test('experience sync unions remote events and creates each local event once without mutable totals', async () => {
  const localEvent = '018f47d2-a590-7cc2-9b60-bc5472b7d824';
  const remoteEvent = '018f47d2-a590-7cc2-9b60-bc5472b7d825';
  const { state, sdkLoader } = makeSdk({
    documents: {
      [`users/account-a/experience/${remoteEvent}`]: { difficulty: '上級' },
    },
  });
  const client = await createFirebaseClient({ sdkLoader });
  const local = awardExperience(emptyStats(), localEvent, '超上級');

  const first = await client.syncStats('account-a', local);
  const second = await client.syncStats('account-a', first);

  assert.deepEqual(second.experienceEvents, {
    [localEvent]: { difficulty: '超上級' },
    [remoteEvent]: { difficulty: '上級' },
  });
  assert.deepEqual(state.writes, [
    { path: `users/account-a/experience/${localEvent}`, data: { difficulty: '超上級' } },
  ]);
  assert.equal(Object.values(state.documents).some((value) => Object.hasOwn(value, 'totalExp')), false);
});

test('a concurrent immutable event wins its document while local conflict merging remains deterministic', async () => {
  const eventId = '018f47d2-a590-7cc2-9b60-bc5472b7d826';
  let raced = false;
  const { state, sdkLoader } = makeSdk({
    beforeTransaction(current, count) {
      if (!raced && count === 1) {
        raced = true;
        current.documents.set(`users/account-a/experience/${eventId}`, { difficulty: '初級' });
      }
    },
  });
  const client = await createFirebaseClient({ sdkLoader });
  const local = awardExperience(emptyStats(), eventId, '超上級');

  const merged = await client.syncStats('account-a', local);

  assert.deepEqual(merged.experienceEvents, { [eventId]: { difficulty: '初級' } });
  assert.deepEqual(state.writes, []);
});

test('malformed cloud experience documents are ignored', async () => {
  const validEvent = '018f47d2-a590-7cc2-9b60-bc5472b7d827';
  const { state, sdkLoader } = makeSdk({
    documents: {
      [`users/account-a/experience/${validEvent}`]: { difficulty: '中級' },
      'users/account-a/experience/not-a-uuid': { difficulty: '超上級' },
      'users/account-a/experience/018f47d2-a590-7cc2-9b60-bc5472b7d828': { difficulty: '特級' },
      'users/account-a/experience/018f47d2-a590-7cc2-9b60-bc5472b7d829': { difficulty: '初級', extra: true },
    },
  });
  const client = await createFirebaseClient({ sdkLoader });

  const merged = await client.syncStats('account-a', emptyStats());

  assert.deepEqual(merged.experienceEvents, { [validEvent]: { difficulty: '中級' } });
  assert.deepEqual(state.writes, []);
});
