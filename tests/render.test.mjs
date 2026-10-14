import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderApp } from '../js/ui/render.js';
import { getKeypadState } from '../js/ui/keypad.js';
import { GAME_MODES, THEMES } from '../js/config.js';
import { NORMAL_REGIONS } from '../js/game/regions.js';
import { createGame, getDisplayedCandidates, getConflicts, isComplete } from '../js/game/engine.js';

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
  assert.match(root.innerHTML, /成績と設定をGoogleで同期/);
  assert.match(root.innerHTML, /途中の盤面はこの端末に保存/);
  assert.match(root.innerHTML, /data-action="sync-scores"[^>]*>成績と設定を同期/);
  state.account = null;
  state.cloud.status = 'signed-out';
  renderApp(root, state, [], {});
  assert.match(root.innerHTML, /data-action="sign-in"/);
  assert.doesNotMatch(root.innerHTML, /data-action="import-guest-scores"/);
});

test('auto-fill and candidate-display settings expose independent accessible switches', () => {
  const root = { scrollTop: 0, querySelector: () => null };
  renderApp(root, { view: 'settings', settings: { theme: 'classic', autoCandidates: true, autoFill: false } }, [], {});
  assert.match(root.innerHTML, /候補が1つのとき自動入力/);
  assert.match(root.innerHTML, /role="switch" aria-checked="false" aria-labelledby="auto-fill-label" data-action="toggle-auto-fill"/);
  assert.match(root.innerHTML, /role="switch" aria-checked="true" aria-labelledby="auto-candidates-label" data-action="toggle-auto"/);
});

test('board, candidates, highlighting and pad consume the projection while completion controls follow canonical state', () => {
  const game = createGame({ puzzleId: 'projection', difficulty: '初級', puzzle: '0'.repeat(81) });
  game.currentBoard = Array.from({ length: 81 }, (_, cell) => (Math.floor(cell / 9) * 3 + Math.floor(cell / 27) + cell % 9) % 9 + 1);
  game.undoStack = [{}];
  const projectedGame = { ...game, currentBoard: [...game.currentBoard] };
  projectedGame.currentBoard[0] = 0;
  projectedGame.currentBoard[1] = 0;
  const root = { scrollTop: 0, querySelector: () => null };
  const state = { view: 'game', currentGame: game, completionOpen: false, selectedCell: 0,
    inputMode: 'memo', settings: { autoCandidates: true } };
  const helpers = { isComplete, conflicts: getConflicts, displayed: getDisplayedCandidates,
    pad: getKeypadState, projectedGame, elapsed: 1 };
  renderApp(root, state, [], helpers);
  assert.match(root.innerHTML, /aria-label="1行1列、候補 1、入力可能"/);
  assert.doesNotMatch(root.innerHTML, /same-number/);
  assert.doesNotMatch(root.innerHTML, /class="clear-overlay"/);
  assert.match(root.innerHTML, /inert aria-disabled="true"/);
  assert.doesNotMatch(root.innerHTML, /data-action="clear-notes"/);
  for (const action of ['undo', 'redo', 'delete', 'toggle-mode']) {
    assert.match(root.innerHTML, new RegExp(`data-action="${action}" disabled`));
  }
  assert.equal((root.innerHTML.match(/disabled title="この数字は入力できません"/g) || []).length, 9);
  assert.match(root.innerHTML, /data-digit="1" aria-label="1" aria-pressed="true" disabled/);
});

test('hint button shows remaining uses and highlights only the supplied cell without revealing a digit', () => {
  const game = createGame({ puzzleId: 'hint', difficulty: '初級', puzzle: '0'.repeat(81) });
  const root = { scrollTop: 0, querySelector: () => null };
  const helpers = { isComplete: () => false, conflicts: () => [0], displayed: () => [], elapsed: 0, pad: getKeypadState };
  for (const theme of THEMES) {
    const state = { view: 'game', currentGame: game, selectedCell: 0, hintCell: 0, settings: { theme: theme.id } };
    renderApp(root, state, [], helpers);
    assert.match(root.innerHTML, /data-action="hint" aria-label="ヒント 残り5回">/);
    const header = root.innerHTML.match(/<header class="screen-header game-header">([\s\S]*?)<\/header>/)[1];
    assert.match(header, /data-action="hint"/);
    const headerEnd = header.match(/<div class="header-end">([\s\S]*?)<\/div>/)[1];
    assert.deepEqual([...headerEnd.matchAll(/data-action="([^"]+)"/g)].map(match => match[1]), ['hint', 'settings']);
    const utility = root.innerHTML.match(/<div class="utility-row"[^>]*>([\s\S]*?)<\/div>/)[1];
    assert.deepEqual([...utility.matchAll(/data-action="([^"]+)"/g)].map(match => match[1]), ['undo', 'redo', 'toggle-mode', 'delete']);
    assert.equal((root.innerHTML.match(/class="cell[^\"]*hint-target/g) || []).length, 1);
    assert.match(root.innerHTML, /aria-label="1行1列、空欄、入力可能、衝突、ヒント対象"/);
    assert.doesNotMatch(root.innerHTML, /data-hint-digit|正解は|答えは/);
  }
});

test('hint availability respects use limit, completion and storage/session readiness while old saves default to five', () => {
  const game = createGame({ puzzleId: 'hint-limits', difficulty: '初級', puzzle: '0'.repeat(81) });
  const root = { scrollTop: 0, querySelector: () => null };
  const helpers = { isComplete: () => false, conflicts: () => [], displayed: () => [], elapsed: 0, pad: getKeypadState };
  const state = { view: 'game', currentGame: game, selectedCell: 0, settings: {} };
  const button = () => root.innerHTML.match(/<button class="header-button hint-button"[^>]*>/)?.[0] || '';

  renderApp(root, state, [], helpers);
  assert.match(button(), /aria-label="ヒント 残り5回"/);
  assert.doesNotMatch(button(), / disabled/);

  state.currentGame = { ...game, hintsUsed: 2 };
  renderApp(root, state, [], helpers);
  assert.match(button(), /aria-label="ヒント 残り3回"/);

  for (const disabledState of [
    { currentGame: { ...game, hintsUsed: 5 } },
    { busy: true },
    { storageReady: false },
    { sessionBlocked: true },
  ]) {
    Object.assign(state, { currentGame: game, busy: false, storageReady: true, sessionBlocked: false }, disabledState);
    renderApp(root, state, [], helpers);
    assert.match(button(), / disabled/);
  }

  state.busy = false;
  state.storageReady = true;
  state.sessionBlocked = false;
  state.currentGame = game;
  renderApp(root, state, [], { ...helpers, isComplete: () => true });
  assert.match(button(), / disabled/);
});

test('hint messages are visible and escaped without opening an overlay', () => {
  const game = createGame({ puzzleId: 'hint-message', difficulty: '初級', puzzle: '0'.repeat(81) });
  const root = { scrollTop: 0, querySelector: () => null };
  const state = { view: 'game', currentGame: game, selectedCell: 0, hintMessage: '候補はありません。', settings: {} };
  const helpers = { isComplete: () => false, conflicts: () => [], displayed: () => [], elapsed: 0, pad: getKeypadState };
  renderApp(root, state, [], helpers);
  assert.match(root.innerHTML, /<span class="hint-feedback" role="status">候補はありません。<\/span>/);
  assert.doesNotMatch(root.innerHTML, /class="clear-overlay"/);
  state.hintMessage = '<script>';
  renderApp(root, state, [], helpers);
  assert.match(root.innerHTML, /&lt;script&gt;/);
  assert.doesNotMatch(root.innerHTML, /<span class="hint-feedback" role="status"><script>/);
});

test('Sudoku mode settings expose both modes and current home and stats labels', () => {
  const root = { scrollTop: 0, querySelector: () => null };
  const state = { view: 'settings', settings: { mode: 'jigsaw' }, stats: { records: {
    normal_score: { difficulty: '初級', elapsedTime: 20 },
    jigsaw_score: { difficulty: '初級', elapsedTime: 70 },
  } } };
  renderApp(root, state, ['初級'], {});
  for (const mode of GAME_MODES) {
    assert.match(root.innerHTML, new RegExp(`data-mode="${mode.id}" aria-pressed="${mode.id === 'jigsaw'}"`));
  }
  assert.match(root.innerHTML, /つづきは種類ごとに保存/);
  state.view = 'home';
  renderApp(root, state, ['初級'], { isComplete: () => false });
  assert.match(root.innerHTML, /home-game-mode">ジグソー<\/p>/);
  state.view = 'stats';
  renderApp(root, state, ['初級'], {});
  assert.match(root.innerHTML, /stats-game-mode">ジグソー<\/p>/);
  assert.match(root.innerHTML, /stats-total-value">1<\/strong>/);
  assert.match(root.innerHTML, /stats-best">01:10<\/span>/);
  state.settings.mode = 'normal';
  renderApp(root, state, ['初級'], {});
  assert.match(root.innerHTML, /stats-game-mode">通常<\/p>/);
  assert.match(root.innerHTML, /stats-best">00:20<\/span>/);
  assert.equal(Object.keys(state.stats.records).length, 2);
});

test('jigsaw boundaries, related cells, conflicts and displayed notes follow the board region map in every theme', () => {
  const regions = [...NORMAL_REGIONS];
  [regions[2], regions[12]] = [regions[12], regions[2]];
  const game = createGame({ puzzleId: 'jigsaw_render', difficulty: '初級', puzzle: '0'.repeat(81),
    mode: 'jigsaw', regions: regions.join('') }, { autoFill: false });
  game.currentBoard[14] = 7;
  const root = { scrollTop: 0, querySelector: () => null };
  const state = { view: 'game', currentGame: game, selectedCell: 2,
    inputMode: 'memo', settings: { mode: 'normal', autoCandidates: true } };
  let conflictRegions;
  const helpers = { isComplete, displayed: getDisplayedCandidates, elapsed: 0, pad: getKeypadState,
    conflicts: (board, value) => { conflictRegions = value; return getConflicts(board, value); } };
  const cell = index => [...root.innerHTML.matchAll(/<button class="cell[^>]*>/g)]
    .map(match => match[0]).find(markup => markup.includes(`data-cell="${index}"`));
  for (const theme of THEMES) {
    state.settings.theme = theme.id;
    renderApp(root, state, ['初級'], helpers);
    assert.match(root.innerHTML, /class="board board--jigsaw" role="grid" aria-label="ジグソー数独盤面"/);
    assert.match(root.innerHTML, /game-mode-inline">ジグソー<\/span>/);
    assert.equal(conflictRegions, game.regions);
    assert.match(cell(1), /region-right/);
    assert.doesNotMatch(cell(2), /region-right/);
    assert.match(cell(2), /region-bottom/);
    assert.match(cell(14), /related/);
    assert.doesNotMatch(cell(9), /related/);
    assert.match(cell(2), /候補 1、2、3、4、5、6、8、9/);
    assert.equal((root.innerHTML.match(/role="gridcell"/g) || []).length, 81);
  }
});

test('jigsaw highlights exactly nine region cells above its row and column while normal highlighting stays uniform', () => {
  const regions = [...NORMAL_REGIONS];
  [regions[2], regions[12]] = [regions[12], regions[2]];
  const root = { scrollTop: 0, querySelector: () => null };
  const helpers = { isComplete, displayed: getDisplayedCandidates, conflicts: getConflicts, elapsed: 0, pad: getKeypadState };
  for (const mode of GAME_MODES) {
    const game = createGame({ puzzleId: 'highlight_regions', difficulty: '初級', puzzle: '0'.repeat(81),
      ...(mode.id === 'jigsaw' ? { mode: 'jigsaw', regions: regions.join('') } : {}) }, { autoFill: false });
    const original = JSON.stringify(game);
    for (const selectedCell of [0, 2, 12, 40, 80]) {
      for (const inputMode of ['number', 'memo']) {
        renderApp(root, { view: 'game', currentGame: game, selectedCell, inputMode, settings: {} }, [], helpers);
        const cells = [...root.innerHTML.matchAll(/<button class="(cell[^"]*)"[^>]*data-cell="(\d+)"/g)]
          .map(match => ({ classes: new Set(match[1].split(' ')), index: Number(match[2]) }));
        assert.equal(cells.length, 81);
        assert.equal(cells.filter(cell => cell.classes.has('region-related')).length, mode.id === 'jigsaw' ? 9 : 0);
        for (const { classes, index } of cells) {
          const inLine = Math.floor(index / 9) === Math.floor(selectedCell / 9) || index % 9 === selectedCell % 9;
          const inRegion = (mode.id === 'jigsaw' ? regions : NORMAL_REGIONS)[index] === (mode.id === 'jigsaw' ? regions : NORMAL_REGIONS)[selectedCell];
          assert.equal(classes.has('related'), inLine || inRegion);
          assert.equal(classes.has('line-related'), mode.id === 'jigsaw' && inLine);
          assert.equal(classes.has('region-related'), mode.id === 'jigsaw' && inRegion);
          assert.equal(classes.has('selected'), index === selectedCell);
        }
      }
    }
    assert.equal(JSON.stringify(game), original);
  }
});
