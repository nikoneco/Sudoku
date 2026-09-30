import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderApp } from '../js/ui/render.js';
import { getKeypadState } from '../js/ui/keypad.js';
import { THEMES } from '../js/config.js';

test('completion is a dismissible result over the full board, with input disabled', () => {
  const game = {
    currentBoard: Array(81).fill(1), initialBoard: Array(81).fill(0),
    manualIncludedCandidates: Array(81).fill(0), sources: Array(81).fill('manual'),
    undoStack: [], redoStack: [], difficulty: '中級', elapsedTime: 83,
  };
  const state = { view: 'game', currentGame: game, completionOpen: true, selectedCell: 0, settings: {} };
  const root = { scrollTop: 0, querySelector: () => null };
  const helpers = { isComplete: () => true, conflicts: () => [], displayed: () => [], elapsed: 83, pad: getKeypadState };
  renderApp(root, state, ['中級'], helpers);
  assert.equal((root.innerHTML.match(/role="gridcell"/g) || []).length, 81);
  assert.match(root.innerHTML, /class="clear-title">CLEAR/);
  assert.match(root.innerHTML, /class="clear-paper-pieces" aria-hidden="true"/);
  assert.equal((root.innerHTML.match(/data-clear-piece /g) || []).length, 6);
  assert.match(root.innerHTML, /中級<\/span><time>01:23/);
  assert.match(root.innerHTML, /data-action="dismiss-completion"/);
  assert.match(root.innerHTML, /data-action="home">ホームへ/);
  assert.match(root.innerHTML, /inert aria-disabled="true"/);
  state.completionOpen = false;
  renderApp(root, state, ['中級'], helpers);
  assert.doesNotMatch(root.innerHTML, /class="clear-overlay"/);
  assert.equal((root.innerHTML.match(/role="gridcell"/g) || []).length, 81);
});

test('home shows the signed-in level and object title below SUDOKU only for an account', () => {
  const root = { scrollTop: 0, querySelector: () => null };
  const state = {
    view: 'home', currentGame: null, account: { uid: 'account-1' },
    stats: { experienceEvents: { '123e4567-e89b-42d3-a456-426614174000': { difficulty: '超上級' } } },
  };
  const helpers = { isComplete: () => false };

  renderApp(root, state, [], helpers);
  assert.match(root.innerHTML, /class="brand-stamp" aria-hidden="true"/);
  assert.match(root.innerHTML, /class="home-level"[^>]*>\s*<span>Lv1<\/span><span>米粒2粒分並み<\/span>/);
  state.account = null;
  renderApp(root, state, [], helpers);
  assert.doesNotMatch(root.innerHTML, /class="home-level"/);
});

test('clear experience is shown from its completion snapshot, including for a guest', () => {
  const game = {
    currentBoard: Array(81).fill(1), initialBoard: Array(81).fill(0),
    manualIncludedCandidates: Array(81).fill(0), sources: Array(81).fill('manual'),
    undoStack: [], redoStack: [], difficulty: '中級', elapsedTime: 83,
  };
  const state = {
    view: 'game', currentGame: game, completionOpen: true, selectedCell: 0, settings: {},
    account: null, completionExperience: { totalExp: 145, level: 2, progress: 45 },
  };
  const root = { scrollTop: 0, querySelector: () => null };
  const helpers = { isComplete: () => true, conflicts: () => [], displayed: () => [], elapsed: 83, pad: getKeypadState };

  renderApp(root, state, ['中級'], helpers);
  assert.match(root.innerHTML, /data-experience-overlay/);
  assert.match(root.innerHTML, /data-experience-level>Lv2/);
  assert.match(root.innerHTML, /data-experience-title>1円玉並み/);
  assert.match(root.innerHTML, /aria-valuenow="45"/);
  assert.doesNotMatch(root.innerHTML, /(?:獲得|earned|XP\s*\+?\s*\d+)/i);

  state.completionExperience = null;
  renderApp(root, state, ['中級'], helpers);
  assert.doesNotMatch(root.innerHTML, /data-experience-overlay/);
});

test('theme settings expose four named choices and their selected state', () => {
  const root = { scrollTop: 0, querySelector: () => null };
  renderApp(root, { view: 'settings', settings: { theme: 'night' } }, [], {});
  for (const theme of THEMES) assert.match(root.innerHTML, new RegExp(`data-theme="${theme.id}" aria-pressed="${theme.id === 'night'}"`));
  assert.match(root.innerHTML, /ナイト/);
});

test('account controls escape user names and keep guest import explicit', () => {
  const root = { scrollTop: 0, querySelector: () => null };
  const state = { view: 'stats', stats: {totalClears: 0}, account: {uid:'a',displayName:'<img src=x>'}, cloud:{status:'synced',busy:false}, guestScoreCount:3 };
  renderApp(root, state, [], {});
  assert.match(root.innerHTML, /&lt;img src=x&gt;/);
  assert.doesNotMatch(root.innerHTML, /<img src=x>/);
  assert.match(root.innerHTML, /data-action="import-guest-scores"/);
  assert.match(root.innerHTML, /同期するのは成績だけ/);
  state.account = null;
  state.cloud.status = 'signed-out';
  renderApp(root, state, [], {});
  assert.match(root.innerHTML, /data-action="sign-in"/);
  assert.doesNotMatch(root.innerHTML, /data-action="import-guest-scores"/);
});
