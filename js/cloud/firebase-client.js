import { FIREBASE_CONFIG } from '../firebase-config.js';
import { DIFFICULTIES } from '../config.js';
import { emptyStats, mergeStats, normalizeStats } from '../data/stats.js';
import { isExperienceEventId } from '../data/experience.js';

const SDK_VERSION = '12.16.0';
const MAX_ELAPSED_TIME = 31_536_000;
const PUZZLE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const sdkUrl = (name) => `https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-${name}.js`;

function loadFirebaseSdk() {
  return Promise.all([
    import(sdkUrl('app')),
    import(sdkUrl('auth')),
    import(sdkUrl('firestore-lite')),
  ]);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value, expected) {
  if (!isObject(value)) return false;
  const keys = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return keys.length === sortedExpected.length && keys.every((key, index) => key === sortedExpected[index]);
}

function isElapsedTime(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_ELAPSED_TIME;
}

function validScoreRecord(puzzleId, value) {
  return typeof puzzleId === 'string'
    && PUZZLE_ID_PATTERN.test(puzzleId)
    && hasExactKeys(value, ['difficulty', 'elapsedTime'])
    && DIFFICULTIES.includes(value.difficulty)
    && (value.elapsedTime === null || isElapsedTime(value.elapsedTime));
}

function validLegacyData(value) {
  if (!hasExactKeys(value, ['bestTimes']) || !isObject(value.bestTimes)) return false;
  return Object.keys(value.bestTimes).every((difficulty) => DIFFICULTIES.includes(difficulty)
    && (value.bestTimes[difficulty] === null || isElapsedTime(value.bestTimes[difficulty])));
}

function validExperienceEvent(eventId, value) {
  return isExperienceEventId(eventId)
    && hasExactKeys(value, ['difficulty'])
    && DIFFICULTIES.includes(value.difficulty);
}

function defineMapValue(target, key, value) {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    writable: true,
    value,
  });
}

function scoreStatsFromSnapshot(scoreSnapshot, legacySnapshot, experienceSnapshot) {
  const records = {};
  const clearedIds = [];
  for (const item of scoreSnapshot.docs) {
    const puzzleId = item.id;
    const value = item.data();
    if (!validScoreRecord(puzzleId, value)) continue;
    defineMapValue(records, puzzleId, { difficulty: value.difficulty, elapsedTime: value.elapsedTime });
    clearedIds.push(puzzleId);
  }

  const legacyBest = {};
  if (legacySnapshot.exists()) {
    const value = legacySnapshot.data();
    if (validLegacyData(value)) {
      for (const difficulty of DIFFICULTIES) {
        const bestTime = value.bestTimes[difficulty];
        if (isElapsedTime(bestTime)) defineMapValue(legacyBest, difficulty, bestTime);
      }
    }
  }

  const experienceEvents = {};
  for (const item of experienceSnapshot.docs) {
    const eventId = item.id;
    const value = item.data();
    if (!validExperienceEvent(eventId, value)) continue;
    defineMapValue(experienceEvents, eventId, { difficulty: value.difficulty });
  }
  return normalizeStats({ clearedIds, byDifficulty: {}, totalClears: 0, records, legacyBest, experienceEvents });
}

function preferredScore(left, right) {
  const difficulty = DIFFICULTIES.indexOf(left.difficulty) <= DIFFICULTIES.indexOf(right.difficulty)
    ? left.difficulty
    : right.difficulty;
  const times = [left.elapsedTime, right.elapsedTime].filter(isElapsedTime);
  return { difficulty, elapsedTime: times.length ? Math.min(...times) : null };
}

function sameScore(left, right) {
  return Boolean(left)
    && left.difficulty === right.difficulty
    && left.elapsedTime === right.elapsedTime;
}

function mergeBestTimes(left, right) {
  const merged = {};
  for (const difficulty of DIFFICULTIES) {
    const times = [left[difficulty], right[difficulty]].filter(isElapsedTime);
    if (times.length) defineMapValue(merged, difficulty, Math.min(...times));
  }
  return merged;
}

function bestTimesEqual(left, right) {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const difficulty of keys) {
    if (left[difficulty] !== right[difficulty]) return false;
  }
  return true;
}

export async function createFirebaseClient({ sdkLoader = loadFirebaseSdk } = {}) {
  const [appSdk, authSdk, firestoreSdk] = await sdkLoader();
  const appName = 'sudoku';
  const app = appSdk.getApps().find((item) => item.name === appName)
    || appSdk.initializeApp(FIREBASE_CONFIG, appName);
  const auth = authSdk.getAuth(app);
  await authSdk.setPersistence(auth, authSdk.browserLocalPersistence);
  authSdk.useDeviceLanguage(auth);
  const database = firestoreSdk.getFirestore(app);
  const provider = new authSdk.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });

  function assertCurrentUser(uid) {
    if (!uid || auth.currentUser?.uid !== uid) throw new Error('auth-changed');
  }

  async function readStats(uid, scoresRef, legacyRef, experienceRef) {
    assertCurrentUser(uid);
    const [scoreSnapshot, legacySnapshot, experienceSnapshot] = await Promise.all([
      firestoreSdk.getDocs(scoresRef),
      firestoreSdk.getDoc(legacyRef),
      firestoreSdk.getDocs(experienceRef),
    ]);
    assertCurrentUser(uid);
    return scoreStatsFromSnapshot(scoreSnapshot, legacySnapshot, experienceSnapshot);
  }

  async function writeBetterScore(uid, scoresRef, puzzleId, desired) {
    const scoreRef = firestoreSdk.doc(scoresRef, puzzleId);
    assertCurrentUser(uid);
    await firestoreSdk.runTransaction(database, async (transaction) => {
      assertCurrentUser(uid);
      const snapshot = await transaction.get(scoreRef);
      assertCurrentUser(uid);
      const existingData = snapshot.exists() ? snapshot.data() : null;
      const existing = validScoreRecord(puzzleId, existingData) ? existingData : null;
      const merged = existing ? preferredScore(existing, desired) : desired;
      if (sameScore(existing, merged)) return;
      assertCurrentUser(uid);
      transaction.set(scoreRef, { difficulty: merged.difficulty, elapsedTime: merged.elapsedTime });
    });
  }

  async function writeBetterLegacyBest(uid, legacyRef, desiredBestTimes) {
    if (!Object.keys(desiredBestTimes).length) return;
    assertCurrentUser(uid);
    await firestoreSdk.runTransaction(database, async (transaction) => {
      assertCurrentUser(uid);
      const snapshot = await transaction.get(legacyRef);
      assertCurrentUser(uid);
      const currentData = snapshot.exists() ? snapshot.data() : null;
      const currentBestTimes = validLegacyData(currentData) ? currentData.bestTimes : {};
      const mergedBestTimes = mergeBestTimes(currentBestTimes, desiredBestTimes);
      if (bestTimesEqual(currentBestTimes, mergedBestTimes)) return;
      assertCurrentUser(uid);
      transaction.set(legacyRef, { bestTimes: mergedBestTimes });
    });
  }

  async function writeExperienceEventIfMissing(uid, experienceRef, eventId, desired) {
    const eventRef = firestoreSdk.doc(experienceRef, eventId);
    assertCurrentUser(uid);
    await firestoreSdk.runTransaction(database, async (transaction) => {
      assertCurrentUser(uid);
      const snapshot = await transaction.get(eventRef);
      assertCurrentUser(uid);
      if (snapshot.exists()) return;
      assertCurrentUser(uid);
      transaction.set(eventRef, { difficulty: desired.difficulty });
    });
  }

  return {
    onAuthStateChanged(listener) {
      return authSdk.onAuthStateChanged(auth, (user) => {
        listener(user ? { uid: user.uid, displayName: user.displayName || '' } : null);
      });
    },
    signIn() {
      return authSdk.signInWithPopup(auth, provider);
    },
    signOut() {
      return authSdk.signOut(auth);
    },
    async syncStats(uid, localStats) {
      assertCurrentUser(uid);
      const local = normalizeStats(localStats);
      const scoresRef = firestoreSdk.collection(database, 'users', uid, 'scores');
      const legacyRef = firestoreSdk.doc(database, 'users', uid, 'scoreMeta', 'legacy');
      const experienceRef = firestoreSdk.collection(database, 'users', uid, 'experience');
      const remote = await readStats(uid, scoresRef, legacyRef, experienceRef);
      const merged = mergeStats(local, remote);

      for (const puzzleId of Object.keys(merged.records)) {
        const desired = merged.records[puzzleId];
        const current = remote.records[puzzleId];
        if (sameScore(current, desired)) continue;
        await writeBetterScore(uid, scoresRef, puzzleId, desired);
      }
      await writeBetterLegacyBest(uid, legacyRef, merged.legacyBest);

      for (const eventId of Object.keys(merged.experienceEvents)) {
        if (remote.experienceEvents[eventId]) continue;
        const desired = merged.experienceEvents[eventId];
        await writeExperienceEventIfMissing(uid, experienceRef, eventId, desired);
      }

      const finalRemote = await readStats(uid, scoresRef, legacyRef, experienceRef);
      return mergeStats(local, finalRemote);
    },
  };
}
