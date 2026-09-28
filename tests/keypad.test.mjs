import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, transact, undo } from '../js/game/engine.js';
import { getKeypadState } from '../js/ui/keypad.js';

const empty = () => createGame({ puzzleId: 'keypad', difficulty: '初級', puzzle: '0'.repeat(81) });

test('memo colors track visible notes and every editable digit remains selectable', () => {
  const game = empty();
  game.currentBoard[0] = 1;
  game.currentBoard[1] = 2; // row
  game.currentBoard[9] = 3; // column
  game.currentBoard[10] = 4; // box
  game.manualExcludedCandidates[0] = 1 << 8;
  for (const cell of [0, 2]) {
    const pad = getKeypadState(game, cell, 'memo');
    assert.ok(pad.every(key => !key.disabled));
    assert.equal(pad[1].muted, true);
    assert.equal(pad[3].muted, true);
  }
  const pad = getKeypadState(game, 0, 'memo');
  assert.equal(pad[0].disabled, false); // Preserve original digit in conversion to notes.
  assert.equal(pad[2].disabled, false);
  const next = transact(game, { type: 'toggleCandidate', cell: 0, value: 9 });
  assert.equal(next.currentBoard[0], 0);
  assert.equal(next.manualIncludedCandidates[0], 257);
  const convertedPad = getKeypadState(next, 0, 'memo');
  assert.equal(convertedPad[0].muted, false);
  assert.equal(convertedPad[8].muted, false);
  assert.equal(convertedPad[4].muted, true);
});

test('nine entered digits are disabled in number mode; Undo restores availability', () => {
  let game = empty();
  for (let i = 0; i < 8; i++) game.currentBoard[i] = 7;
  assert.equal(getKeypadState(game, 20, 'number')[6].muted, false);
  game = transact(game, { type: 'set', cell: 8, value: 7 });
  assert.deepEqual(getKeypadState(game, 20, 'number')[6], { digit: 7, disabled: true, muted: true });
  assert.equal(transact(game, { type: 'set', cell: 20, value: 7 }), game);
  assert.equal(getKeypadState(game, 20, 'memo')[6].disabled, false);
  game = undo(game);
  assert.equal(getKeypadState(game, 20, 'number')[6].muted, false);
});

test('memo key membership follows display ON/OFF and toggles for an illegal note', () => {
  let game = empty(); game.currentBoard[1] = 9;
  assert.equal(getKeypadState(game, 0, 'memo', true)[0].muted, false);
  assert.equal(getKeypadState(game, 0, 'memo', false)[0].muted, true);
  for (const autoCandidates of [true, false]) {
    const added = transact(game, { type: 'toggleCandidate', cell: 0, value: 9, autoCandidates });
    assert.equal(getKeypadState(added, 0, 'memo', autoCandidates)[8].muted, false);
    const removed = transact(added, { type: 'toggleCandidate', cell: 0, value: 9, autoCandidates });
    assert.equal(getKeypadState(removed, 0, 'memo', autoCandidates)[8].muted, true);
  }
});

test('fixed givens cannot accept notes or digits', () => {
  const game = empty(); game.initialBoard[0] = 1; game.currentBoard[0] = 1;
  for (const mode of ['number', 'memo']) assert.ok(getKeypadState(game, 0, mode).every(key => key.disabled && key.muted));
});
