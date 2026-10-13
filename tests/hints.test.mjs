import test from "node:test";
import assert from "node:assert/strict";
import { createGame, getConflicts, getEffectiveCandidates, getLegalCandidates } from "../js/game/engine.js";
import { findHint } from "../js/game/hints.js";

const rowUnit = row => Array.from({ length: 9 }, (_, column) => row * 9 + column);
const columnUnit = column => Array.from({ length: 9 }, (_, row) => row * 9 + column);
const firstBox = Array.from({ length: 9 }, (_, offset) => Math.floor(offset / 3) * 9 + offset % 3);
const locations = (board, unit, digit) => unit.filter(cell => getLegalCandidates(board, cell).includes(digit));

function completeBoard() {
  return Array.from({ length: 81 }, (_, cell) =>
    (Math.floor(cell / 9) * 3 + Math.floor(cell / 27) + cell % 9) % 9 + 1);
}

function makeBoard(entries = {}) {
  const board = Array(81).fill(0);
  for (const [cell, digit] of Object.entries(entries)) board[Number(cell)] = digit;
  return board;
}

function rowHintBoard() {
  // Current-board legal candidates are 124 / 12 / 12 in the three blanks.
  return makeBoard({ 2: 3, 4: 5, 5: 6, 6: 7, 7: 8, 8: 9, 13: 4, 28: 4 });
}

function boxHintBoard() {
  return makeBoard({ 1: 2, 2: 3, 12: 1, 18: 4, 19: 5, 20: 6 });
}

test("finds a row-only unique location even when that cell has multiple candidates", () => {
  const board = rowHintBoard();
  assert.deepEqual(getLegalCandidates(board, 0), [1, 2, 4]);
  assert.deepEqual(getLegalCandidates(board, 1), [1, 2]);
  assert.deepEqual(getLegalCandidates(board, 3), [1, 2]);
  assert.deepEqual(locations(board, rowUnit(0), 4), [0]);
  assert.ok(locations(board, columnUnit(0), 4).length > 1);
  assert.ok(locations(board, firstBox, 4).length > 1);
  assert.deepEqual(findHint(board), { status: "found", cell: 0, digit: 4 });
});

test("finds a column-only unique location", () => {
  const source = rowHintBoard();
  const board = Array.from({ length: 81 }, (_, cell) => source[(cell % 9) * 9 + Math.floor(cell / 9)]);
  assert.deepEqual(getLegalCandidates(board, 0), [1, 2, 4]);
  assert.deepEqual(locations(board, columnUnit(0), 4), [0]);
  assert.ok(locations(board, rowUnit(0), 4).length > 1);
  assert.ok(locations(board, firstBox, 4).length > 1);
  assert.deepEqual(findHint(board), { status: "found", cell: 0, digit: 4 });
});

test("finds a box-only unique location", () => {
  const board = boxHintBoard();
  assert.deepEqual(getLegalCandidates(board, 0), [1, 7, 8, 9]);
  assert.deepEqual(locations(board, firstBox, 1), [0]);
  assert.ok(locations(board, rowUnit(0), 1).length > 1);
  assert.ok(locations(board, columnUnit(0), 1).length > 1);
  assert.deepEqual(findHint(board), { status: "found", cell: 0, digit: 1 });
});

test("does not infer a naked pair when the proposed digit has other legal unit locations", () => {
  const board = makeBoard({
    2: 3, 5: 6, 6: 7, 7: 8,
    11: 9, 20: 5, 28: 4, 39: 4, 57: 5, 66: 9,
  });
  assert.deepEqual(getLegalCandidates(board, 0), [1, 2, 4]);
  assert.deepEqual(getLegalCandidates(board, 1), [1, 2]);
  assert.deepEqual(getLegalCandidates(board, 3), [1, 2]);
  assert.deepEqual(locations(board, rowUnit(0), 4), [0, 4, 8]);
  assert.ok(locations(board, columnUnit(0), 4).length > 1);
  assert.ok(locations(board, firstBox, 4).length > 1);
  assert.deepEqual(findHint(board), { status: "none" });
});

test("a sole candidate alone is insufficient unless it is a unique unit location", () => {
  const board = makeBoard({ 3: 2, 4: 3, 5: 4, 6: 5, 27: 6, 36: 7, 45: 8, 54: 9 });
  assert.deepEqual(getLegalCandidates(board, 0), [1]);
  for (const unit of [rowUnit(0), columnUnit(0), firstBox]) {
    assert.ok(locations(board, unit, 1).length > 1);
  }
  assert.deepEqual(findHint(board), { status: "none" });
});

test("handwritten notes and exclusions never influence the board-only result", () => {
  const board = rowHintBoard();
  const game = createGame({ puzzleId: "hint-notes", difficulty: "初級", puzzle: board.join("") }, { autoFill: false });
  const expected = findHint(game.currentBoard);
  game.manualIncludedCandidates.fill(511);
  game.manualExcludedCandidates.fill(511);
  assert.deepEqual(getEffectiveCandidates(game, 0), []);
  const before = structuredClone(game);
  Object.freeze(game.currentBoard);
  assert.deepEqual(findHint(game.currentBoard), expected);
  assert.deepEqual(game, before);
});

test("an empty board has no hint", () => {
  assert.deepEqual(findHint(Array(81).fill(0)), { status: "none" });
});

test("a complete valid board has no hint; a qualifying sole candidate still does", () => {
  const board = completeBoard();
  assert.deepEqual(findHint(Object.freeze([...board])), { status: "none" });
  board[80] = 0;
  assert.deepEqual(findHint(board), { status: "found", cell: 80, digit: 8 });
});

test("chooses the lowest cell index consistently without filling the board", () => {
  const board = completeBoard();
  board[0] = 0;
  board[80] = 0;
  assert.deepEqual(locations(board, rowUnit(0), 1), [0]);
  assert.deepEqual(locations(board, rowUnit(8), 8), [80]);
  const before = [...board];
  Object.freeze(board);
  assert.deepEqual(findHint(board), { status: "found", cell: 0, digit: 1 });
  assert.deepEqual(findHint(board), { status: "found", cell: 0, digit: 1 });
  assert.deepEqual(board, before);
});

test("malformed boards return conflict instead of throwing", () => {
  const malformed = [null, undefined, {}, "0".repeat(81), new Uint8Array(81), [], Array(80).fill(0), Array(82).fill(0), Array(81)];
  for (const value of [-1, 10, 1.5, NaN, Infinity, "1", undefined, null]) {
    const board = Array(81).fill(0);
    board[40] = value;
    malformed.push(board);
  }
  for (const board of malformed) assert.deepEqual(findHint(board), { status: "conflict" });
});

test("duplicates anywhere on the board refuse an otherwise available hint", () => {
  const board = rowHintBoard();
  board[72] = 6;
  board[80] = 6;
  assert.deepEqual(findHint(board), { status: "conflict" });
});

test("an empty cell with no legal candidates returns conflict", () => {
  const board = makeBoard({ 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9 });
  assert.deepEqual(getConflicts(board), []);
  assert.deepEqual(getLegalCandidates(board, 0), []);
  assert.deepEqual(findHint(board), { status: "conflict" });
});

test("a unit missing a digit with no legal location returns conflict even with no zero-candidate cells", () => {
  const board = makeBoard({ 0: 1, 1: 2, 2: 3, 12: 4, 24: 4 });
  assert.deepEqual(getConflicts(board), []);
  for (let cell = 0; cell < 81; cell += 1) {
    if (board[cell] === 0) assert.ok(getLegalCandidates(board, cell).length > 0);
  }
  assert.deepEqual(locations(board, rowUnit(0), 4), []);
  assert.deepEqual(findHint(board), { status: "conflict" });
});

test("incompatible unique-location assignments to the same cell return conflict", () => {
  const board = makeBoard({ 12: 1, 24: 1, 28: 1, 56: 1 });
  for (const cell of [22, 17, 46, 74]) board[cell] = 2;
  assert.deepEqual(getConflicts(board), []);
  assert.deepEqual(locations(board, firstBox, 1), [0]);
  assert.deepEqual(locations(board, firstBox, 2), [0]);
  assert.deepEqual(findHint(board), { status: "conflict" });
});
