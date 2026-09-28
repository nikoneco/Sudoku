import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, transact, undo } from '../js/game/engine.js';
import { getKeypadState } from '../js/ui/keypad.js';

const empty = () => createGame({ puzzleId: 'keypad', difficulty: '初級', puzzle: '0'.repeat(81) });

test('memo keys use legal peers, including filled-cell conversion, not manual exclusions', () => {
  const game = empty();
  game.currentBoard[0] = 1;
  game.currentBoard[1] = 2; // row
  game.currentBoard[9] = 3; // column
  game.currentBoard[10] = 4; // box
  game.manualExcludedCandidates[0] = 1 << 8;
  for (const cell of [0, 2]) {
    const pad = getKeypadState(game, cell, 'memo');
    assert.equal(pad[1].disabled, true);
    assert.equal(pad[3].disabled, true);
    assert.equal(pad[8].disabled, false); // Restoring an excluded candidate remains possible.
  }
  const pad = getKeypadState(game, 0, 'memo');
  assert.equal(pad[0].disabled, false); // Preserve original digit in conversion to notes.
  assert.equal(pad[2].disabled, true);
  const next = transact(game, { type: 'toggleCandidate', cell: 0, value: 9 });
  assert.equal(next.currentBoard[0], 0);
  assert.equal(next.manualIncludedCandidates[0], 257);
});

test('nine entered digits fade in number mode without preventing an incorrect entry; Undo restores emphasis', () => {
  let game = empty();
  for (let i = 0; i < 8; i++) game.currentBoard[i] = 7;
  assert.equal(getKeypadState(game, 20, 'number')[6].muted, false);
  game = transact(game, { type: 'set', cell: 8, value: 7 });
  assert.deepEqual(getKeypadState(game, 20, 'number')[6], { digit: 7, disabled: false, muted: true });
  game = undo(game);
  assert.equal(getKeypadState(game, 20, 'number')[6].muted, false);
});

test('fixed givens cannot accept notes or digits', () => {
  const game = empty(); game.initialBoard[0] = 1; game.currentBoard[0] = 1;
  for (const mode of ['number', 'memo']) assert.ok(getKeypadState(game, 0, mode).every(key => key.disabled && key.muted));
});
