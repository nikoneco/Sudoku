import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Use the local Firestore emulator only.');
const qaRoot = process.env.SUDOKU_FIREBASE_QA_ROOT || path.resolve('.local/firebase-qa');
const require = createRequire(path.join(qaRoot, 'package.json'));
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const sdk = require('firebase/firestore');
const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
const env = await initializeTestEnvironment({projectId: 'demo-sudoku', firestore: {
  host, port: Number(port), rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8'),
}});
try {
  const a = env.authenticatedContext('account-a').firestore();
  const b = env.authenticatedContext('account-b').firestore();
  const guest = env.unauthenticatedContext().firestore();
  const score = db => sdk.doc(db, 'users/account-a/scores/easy-001');
  const valid = { difficulty: '初級', elapsedTime: 123 };
  await assertSucceeds(sdk.setDoc(score(a), valid));
  assert.equal((await sdk.getDoc(score(a))).data().elapsedTime, 123);
  assert.equal((await assertSucceeds(sdk.getDocs(sdk.collection(a, 'users/account-a/scores')))).size, 1);
  for (const db of [b, guest]) {
    await assertFails(sdk.getDoc(score(db)));
    await assertFails(sdk.getDocs(sdk.collection(db, 'users/account-a/scores')));
    await assertFails(sdk.setDoc(score(db), valid));
  }
  for (const data of [{...valid,currentBoard:[]}, {...valid,difficulty:'unknown'}, {...valid,elapsedTime:-1}, {...valid,elapsedTime:31536001}, {difficulty:'初級'}]) {
    await assertFails(sdk.setDoc(score(a), data));
  }
  await assertSucceeds(sdk.setDoc(sdk.doc(a,'users/account-a/scores/legacy-001'), {difficulty:'中級',elapsedTime:null}));
  await assertFails(sdk.deleteDoc(score(a)));

  const experienceId = '018f47d2-a590-7cc2-9b60-bc5472b7d824';
  const experience = db => sdk.doc(db, `users/account-a/experience/${experienceId}`);
  await assertSucceeds(sdk.setDoc(experience(a), { difficulty: '超上級' }));
  assert.equal((await sdk.getDoc(experience(a))).data().difficulty, '超上級');
  assert.equal((await assertSucceeds(sdk.getDocs(sdk.collection(a, 'users/account-a/experience')))).size, 1);
  for (const db of [b, guest]) {
    await assertFails(sdk.getDoc(experience(db)));
    await assertFails(sdk.getDocs(sdk.collection(db, 'users/account-a/experience')));
    await assertFails(sdk.setDoc(experience(db), { difficulty: '初級' }));
  }
  await assertFails(sdk.setDoc(experience(a), { difficulty: '初級' }));
  await assertFails(sdk.updateDoc(experience(a), { hintsUsed: 5 }));
  await assertFails(sdk.deleteDoc(experience(a)));
  const hintedEventId = hintsUsed => `018f47d2-a590-7cc2-9b60-${(16 + hintsUsed).toString(16).padStart(12, '0')}`;
  for (let hintsUsed = 0; hintsUsed <= 5; hintsUsed += 1) {
    const ref = sdk.doc(a, `users/account-a/experience/${hintedEventId(hintsUsed)}`);
    const data = { difficulty: '中級', hintsUsed };
    await assertSucceeds(sdk.setDoc(ref, data));
    assert.deepEqual((await sdk.getDoc(ref)).data(), data);
    await assertFails(sdk.setDoc(ref, data));
    await assertFails(sdk.updateDoc(ref, { hintsUsed: (hintsUsed + 1) % 6 }));
    await assertFails(sdk.updateDoc(ref, { difficulty: '超上級' }));
    await assertFails(sdk.deleteDoc(ref));
  }
  for (const db of [b, guest]) {
    const hinted = sdk.doc(db, `users/account-a/experience/${hintedEventId(5)}`);
    await assertFails(sdk.getDoc(hinted));
    await assertFails(sdk.setDoc(sdk.doc(db, 'users/account-a/experience/018f47d2-a590-7cc2-9b60-bc5472b7d828'), { difficulty: '中級', hintsUsed: 5 }));
    await assertFails(sdk.updateDoc(hinted, { hintsUsed: 0 }));
    await assertFails(sdk.deleteDoc(hinted));
  }
  for (const [eventId, data] of [
    ['not-a-uuid', { difficulty: '初級' }],
    ['018f47d2-a590-7cc2-9b60-bc5472b7d825', { difficulty: 'unknown' }],
    ['018f47d2-a590-7cc2-9b60-bc5472b7d826', { difficulty: '初級', totalExp: 20 }],
    ['018f47d2-a590-7cc2-9b60-bc5472b7d827', {}],
  ]) {
    await assertFails(sdk.setDoc(sdk.doc(a, `users/account-a/experience/${eventId}`), data));
  }
  const invalidHintPayloads = [
    ...[-1, 6, 1.5, '5', true, null].map(hintsUsed => ({ difficulty: '中級', hintsUsed })),
    { hintsUsed: 5 },
    { difficulty: '中級', hintsUsed: 5, totalExp: 1.5 },
    { difficulty: '中級', hintsUsed: 5, currentBoard: [] },
  ];
  for (const [index, data] of invalidHintPayloads.entries()) {
    const eventId = `018f47d2-a590-7cc2-9b60-${(32 + index).toString(16).padStart(12, '0')}`;
    await assertFails(sdk.setDoc(sdk.doc(a, `users/account-a/experience/${eventId}`), data));
  }
  const preferences = db => sdk.doc(db, 'users/account-a/preferences/app');
  const settings = { autoCandidates: true, autoFill: true, theme: 'classic' };
  await assertSucceeds(sdk.setDoc(preferences(a), settings));
  assert.deepEqual((await sdk.getDoc(preferences(a))).data(), settings);
  await assertSucceeds(sdk.updateDoc(preferences(a), { autoFill: false }));
  assert.deepEqual((await sdk.getDoc(preferences(a))).data(), { ...settings, autoFill: false });
  for (const db of [b, guest]) {
    await assertFails(sdk.getDoc(preferences(db)));
    await assertFails(sdk.setDoc(preferences(db), settings));
    await assertFails(sdk.updateDoc(preferences(db), { theme: 'rose' }));
    await assertFails(sdk.getDocs(sdk.collection(db, 'users/account-a/preferences')));
  }
  await assertFails(sdk.getDocs(sdk.collection(a, 'users/account-a/preferences')));
  await assertFails(sdk.deleteDoc(preferences(a)));
  const mode = db => sdk.doc(db, 'users/account-a/preferences/mode');
  await assertSucceeds(sdk.setDoc(mode(a), { mode: 'jigsaw' }));
  await assertSucceeds(sdk.updateDoc(mode(a), { mode: 'normal' }));
  assert.deepEqual((await sdk.getDoc(mode(a))).data(), { mode: 'normal' });
  for (const db of [b, guest]) {
    await assertFails(sdk.getDoc(mode(db)));
    await assertFails(sdk.setDoc(mode(db), { mode: 'jigsaw' }));
  }
  for (const data of [{ mode: 'unknown' }, { mode: 0 }, {}, { mode: 'jigsaw', currentBoard: [] }]) await assertFails(sdk.setDoc(mode(a), data));
  await assertFails(sdk.deleteDoc(mode(a)));
  await assertFails(sdk.setDoc(sdk.doc(a, 'users/account-a/preferences/app'), { ...settings, mode: 'jigsaw' }));
  for (const data of [
    { theme: 'night' }, { autoCandidates: true, autoFill: true },
    { ...settings, autoCandidates: 'true' }, { ...settings, autoFill: 0 },
    { ...settings, autoFill: null }, { ...settings, theme: 'unknown' },
    { ...settings, currentBoard: [] }, { ...settings, notes: [] },
    { ...settings, undoStack: [] }, { ...settings, email: 'private' },
    { ...settings, settings: {} }, { ...settings, revision: 1 },
  ]) await assertFails(sdk.setDoc(preferences(a), data));
  await assertFails(sdk.updateDoc(preferences(a), { autoFill: 'false' }));
  await assertFails(sdk.setDoc(sdk.doc(a, 'users/account-a/preferences/other'), settings));
  await assertFails(sdk.getDoc(sdk.doc(a, 'users/account-a/preferences/other')));
  const reservedGuest = env.authenticatedContext('guest').firestore();
  await assertFails(sdk.getDoc(sdk.doc(reservedGuest, 'users/guest/preferences/app')));
  await assertFails(sdk.setDoc(sdk.doc(reservedGuest, 'users/guest/preferences/app'), settings));
  await assertFails(sdk.setDoc(sdk.doc(a,'users/account-a/games/current'), {currentBoard:[]}));
  const meta = db => sdk.doc(db,'users/account-a/scoreMeta/legacy');
  await assertSucceeds(sdk.setDoc(meta(a),{bestTimes:{'初級':123,'中級':null}}));
  await assertFails(sdk.getDoc(meta(b)));
  await assertFails(sdk.setDoc(meta(a),{bestTimes:{'初級':-1}}));
  await assertFails(sdk.setDoc(meta(a),{bestTimes:{unknown:123}}));
  await assertFails(sdk.setDoc(meta(a),{bestTimes:{'初級':123},settings:{}}));
  console.log('PASS: owner-only scores, immutable legacy/hinted XP events with optional integer hintsUsed 0..5, and exact three-field app preferences; other-user/guest/board/other-preferences/invalid writes denied; legacy best-times validated.');
} finally { await env.cleanup(); }
