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
  await assertFails(sdk.setDoc(sdk.doc(a,'users/account-a/preferences/app'), {theme:'night'}));
  await assertFails(sdk.setDoc(sdk.doc(a,'users/account-a/games/current'), {currentBoard:[]}));
  const meta = db => sdk.doc(db,'users/account-a/scoreMeta/legacy');
  await assertSucceeds(sdk.setDoc(meta(a),{bestTimes:{'初級':123,'中級':null}}));
  await assertFails(sdk.getDoc(meta(b)));
  await assertFails(sdk.setDoc(meta(a),{bestTimes:{'初級':-1}}));
  await assertFails(sdk.setDoc(meta(a),{bestTimes:{unknown:123}}));
  await assertFails(sdk.setDoc(meta(a),{bestTimes:{'初級':123},settings:{}}));
  console.log('PASS: owner-only scores; other-user/guest/board/settings/invalid writes denied; legacy best-times validated.');
} finally { await env.cleanup(); }
