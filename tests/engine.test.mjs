import test from "node:test";
import assert from "node:assert/strict";
import {
  createGame,
  getConflicts,
  getDisplayedCandidates,
  getEffectiveCandidates,
  getLegalCandidates,
  isComplete,
  redo,
  transact,
  undo,
} from "../js/game/engine.js";

const BLANK_PUZZLE = "0".repeat(81);

function puzzle(entries = {}) {
  const cells = Array(81).fill("0");
  for (const [cell, digit] of Object.entries(entries)) cells[Number(cell)] = String(digit);
  return {
    puzzleId: "engine-test",
    difficulty: "初級",
    puzzle: cells.join(""),
  };
}

function blankGame() {
  return createGame({
    puzzleId: "engine-test",
    difficulty: "初級",
    puzzle: BLANK_PUZZLE,
  });
}

function exclude(game, cell, digits) {
  return digits.reduce(
    (current, value) => transact(current, { type: "toggleCandidate", cell, value }),
    game,
  );
}

function include(game, cell, digits) {
  return digits.reduce(
    (current, value) => transact(current, {
      type: "toggleCandidate",
      cell,
      value,
      autoCandidates: false,
    }),
    game,
  );
}

function maskOf(...digits) {
  return digits.reduce((mask, digit) => mask | (1 << (digit - 1)), 0);
}

function solvedGrid() {
  return Array.from({ length: 81 }, (_, cell) => {
    const row = Math.floor(cell / 9);
    const column = cell % 9;
    return ((row * 3 + Math.floor(row / 3) + column) % 9) + 1;
  });
}

test("createGame returns the shared JSON-serializable state shape", () => {
  const game = blankGame();

  assert.deepEqual(Object.keys(game), [
    "puzzleId",
    "difficulty",
    "initialBoard",
    "currentBoard",
    "manualIncludedCandidates",
    "manualExcludedCandidates",
    "sources",
    "undoStack",
    "redoStack",
    "elapsedTime",
    "startedAt",
    "lastAutoFilled",
  ]);
  assert.equal(game.initialBoard.length, 81);
  assert.equal(game.currentBoard.length, 81);
  assert.equal(game.manualIncludedCandidates.length, 81);
  assert.equal(game.manualExcludedCandidates.length, 81);
  assert.equal(game.sources.length, 81);
  assert.equal(game.elapsedTime, 0);
  assert.match(game.startedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(JSON.parse(JSON.stringify(game)), game);
});

test("legal candidates remove digits found in the row, column, and box", () => {
  const board = Array(81).fill(0);
  board[36] = 1; // Same row as cell 40.
  board[37] = 2; // Same row as cell 40.
  board[4] = 3; // Same column as cell 40.
  board[13] = 4; // Same column as cell 40.
  board[30] = 5; // Same box as cell 40.
  board[32] = 6; // Same box as cell 40.

  assert.deepEqual(getLegalCandidates(board, 40), [7, 8, 9]);
  board[40] = 7;
  assert.deepEqual(getLegalCandidates(board, 40), []);
});

test("candidate toggles follow the active display layer and exclusions restore across modes", () => {
  let game = blankGame();
  assert.deepEqual(getEffectiveCandidates(game, 0), [1, 2, 3, 4, 5, 6, 7, 8, 9]);

  game = transact(game, { type: "toggleCandidate", cell: 0, value: 4, autoCandidates: false });
  assert.deepEqual(getDisplayedCandidates(game, 0, false), [4]);
  assert.deepEqual(getDisplayedCandidates(game, 0, true), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(getEffectiveCandidates(game, 0), [1, 2, 3, 4, 5, 6, 7, 8, 9]);

  game = transact(game, { type: "toggleCandidate", cell: 0, value: 4 });
  assert.deepEqual(getDisplayedCandidates(game, 0, false), []);
  assert.deepEqual(getDisplayedCandidates(game, 0, true), [1, 2, 3, 5, 6, 7, 8, 9]);
  assert.deepEqual(getEffectiveCandidates(game, 0), [1, 2, 3, 5, 6, 7, 8, 9]);

  game = transact(game, { type: "toggleCandidate", cell: 0, value: 4, autoCandidates: false });
  assert.deepEqual(getDisplayedCandidates(game, 0, false), [4]);
  assert.deepEqual(getDisplayedCandidates(game, 0, true), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(getEffectiveCandidates(game, 0), [1, 2, 3, 4, 5, 6, 7, 8, 9]);

  game = transact(game, { type: "toggleCandidate", cell: 0, value: 4, autoCandidates: false });
  assert.deepEqual(getDisplayedCandidates(game, 0, false), []);
  assert.deepEqual(getDisplayedCandidates(game, 0, true), [1, 2, 3, 5, 6, 7, 8, 9]);
  assert.deepEqual(getEffectiveCandidates(game, 0), [1, 2, 3, 5, 6, 7, 8, 9]);
});

test("manual exclusions persist while a digit is illegal and return when it becomes legal", () => {
  let game = blankGame();
  game = transact(game, { type: "toggleCandidate", cell: 0, value: 2 });
  assert.equal(game.manualExcludedCandidates[0] & maskOf(2), maskOf(2));

  game = transact(game, { type: "set", cell: 1, value: 2 });
  assert.deepEqual(getLegalCandidates(game.currentBoard, 0), [1, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(getEffectiveCandidates(game, 0), [1, 3, 4, 5, 6, 7, 8, 9]);

  game = transact(game, { type: "delete", cell: 1 });
  assert.deepEqual(getLegalCandidates(game.currentBoard, 0), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(getEffectiveCandidates(game, 0), [1, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(game.manualExcludedCandidates[0] & maskOf(2), maskOf(2));
});

test("a single manual inclusion never becomes an effective single", () => {
  const game = transact(blankGame(), {
    type: "toggleCandidate",
    cell: 0,
    value: 3,
    autoCandidates: false,
  });

  assert.equal(game.currentBoard[0], 0);
  assert.deepEqual(game.lastAutoFilled, []);
  assert.deepEqual(getDisplayedCandidates(game, 0, false), [3]);
  assert.deepEqual(getEffectiveCandidates(game, 0), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

test("a hidden single does not auto-fill", () => {
  let game = blankGame();
  for (let cell = 1; cell <= 8; cell += 1) {
    game = transact(game, { type: "toggleCandidate", cell, value: 1 });
  }

  assert.equal(getEffectiveCandidates(game, 0).includes(1), true);
  for (let cell = 1; cell <= 8; cell += 1) {
    assert.equal(getEffectiveCandidates(game, cell).includes(1), false);
  }
  assert.deepEqual(game.currentBoard, Array(81).fill(0));
  assert.deepEqual(game.lastAutoFilled, []);
});

test("naked-single exclusions auto-fill only the last remaining legal candidate", () => {
  const game = exclude(blankGame(), 0, [2, 3, 4, 5, 6, 7, 8, 9]);

  assert.equal(game.currentBoard[0], 1);
  assert.equal(game.sources[0], "auto");
  assert.deepEqual(game.lastAutoFilled, [0]);
  assert.deepEqual(game.undoStack.at(-1).currentBoard, Array(81).fill(0));
});

test("one set action and its full naked-single chain share one undo step", () => {
  let game = blankGame();
  game = exclude(game, 1, [3, 4, 5, 6, 7, 8, 9]); // Cell 1: candidates 1 and 2.
  game = exclude(game, 2, [4, 5, 6, 7, 8, 9]); // Cell 2: candidates 1, 2, and 3.
  const historyLength = game.undoStack.length;
  const startedAt = game.startedAt;
  game = { ...game, elapsedTime: 37 };

  const filled = transact(game, { type: "set", cell: 0, value: 1 });
  assert.deepEqual(filled.currentBoard.slice(0, 3), [1, 2, 3]);
  assert.deepEqual(filled.sources.slice(0, 3), ["manual", "auto", "auto"]);
  assert.deepEqual(filled.lastAutoFilled, [1, 2]);
  assert.equal(filled.undoStack.length, historyLength + 1);

  const undone = undo(filled);
  assert.deepEqual(undone.currentBoard.slice(0, 3), [0, 0, 0]);
  assert.deepEqual(undone.sources.slice(0, 3), ["", "", ""]);
  assert.equal(undone.elapsedTime, 37);
  assert.equal(undone.startedAt, startedAt);
  assert.deepEqual(undone.lastAutoFilled, []);

  const redone = redo(undone);
  assert.deepEqual(redone.currentBoard.slice(0, 3), [1, 2, 3]);
  assert.deepEqual(redone.sources.slice(0, 3), ["manual", "auto", "auto"]);
});

test("a conflicting wrong entry is accepted and can trigger an auto-fill chain", () => {
  let game = createGame(puzzle({ 9: 9 }));
  game = exclude(game, 3, [2, 3, 4, 5, 6, 7, 8]); // Cell 3: 1 and 9.
  game = exclude(game, 4, [3, 4, 5, 6, 7, 8]); // Cell 4: 1, 2, and 9.

  const filled = transact(game, { type: "set", cell: 0, value: 9 });
  assert.equal(filled.currentBoard[0], 9);
  assert.equal(filled.sources[0], "manual");
  assert.equal(filled.currentBoard[9], 9);
  assert.equal(filled.sources[9], "given");
  assert.deepEqual(filled.currentBoard.slice(3, 5), [1, 2]);
  assert.deepEqual(filled.sources.slice(3, 5), ["auto", "auto"]);
  assert.deepEqual(getConflicts(filled.currentBoard), [0, 9]);
  assert.equal(filled.undoStack.length, game.undoStack.length + 1);
});

test("fixed puzzle digits ignore every editing action", () => {
  const game = createGame(puzzle({ 0: 5 }));
  const setResult = transact(game, { type: "set", cell: 0, value: 6 });
  const deleteResult = transact(game, { type: "delete", cell: 0 });
  const includeResult = transact(game, {
    type: "toggleCandidate",
    cell: 0,
    value: 1,
    autoCandidates: false,
  });
  const clearResult = transact(game, { type: "clearNotes", cell: 0 });

  assert.equal(setResult, game);
  assert.equal(deleteResult, game);
  assert.equal(includeResult, game);
  assert.equal(clearResult, game);
  assert.equal(game.currentBoard[0], 5);
  assert.equal(game.sources[0], "given");
  assert.equal(game.undoStack.length, 0);
});

test("delete never re-runs a naked-single closure", () => {
  let game = blankGame();
  game = exclude(game, 0, [2, 3, 4, 5, 6, 7, 8, 9]);
  game = exclude(game, 1, [3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(game.currentBoard.slice(0, 2), [1, 2]);

  const deleted = transact(game, { type: "delete", cell: 0 });
  assert.equal(deleted.currentBoard[0], 0);
  assert.equal(deleted.currentBoard[1], 2);
  assert.deepEqual(getEffectiveCandidates(deleted, 0), [1]);
  assert.deepEqual(deleted.lastAutoFilled, []);
});

test("clearNotes hides all currently legal candidates without auto-filling", () => {
  let game = blankGame();
  game = transact(game, { type: "toggleCandidate", cell: 0, value: 2 });
  game = transact(game, { type: "toggleCandidate", cell: 0, value: 7, autoCandidates: false });
  game = transact(game, { type: "set", cell: 1, value: 2 });
  game = transact(game, { type: "set", cell: 9, value: 3 });
  assert.deepEqual(getLegalCandidates(game.currentBoard, 0), [1, 4, 5, 6, 7, 8, 9]);

  const cleared = transact(game, { type: "clearNotes", cell: 0 });
  assert.equal(cleared.currentBoard[0], 0);
  assert.equal(cleared.manualIncludedCandidates[0], 0);
  assert.equal(cleared.manualExcludedCandidates[0] & maskOf(2), maskOf(2));
  assert.equal(cleared.manualExcludedCandidates[0] & maskOf(3), 0);
  assert.deepEqual(getDisplayedCandidates(cleared, 0, true), []);
  assert.deepEqual(getDisplayedCandidates(cleared, 0, false), []);
  assert.deepEqual(cleared.lastAutoFilled, []);

  const restored = transact(cleared, { type: "delete", cell: 9 });
  assert.deepEqual(getEffectiveCandidates(restored, 0), [3]);
  assert.deepEqual(getDisplayedCandidates(restored, 0, false), []);
});

test("undo, redo, and branch edits preserve immutable history semantics", () => {
  let game = blankGame();
  game = transact(game, { type: "toggleCandidate", cell: 0, value: 1, autoCandidates: false });
  const afterFirst = game;
  game = transact(game, { type: "toggleCandidate", cell: 0, value: 2, autoCandidates: false });
  const afterSecond = game;

  const undone = undo(afterSecond);
  assert.deepEqual(getDisplayedCandidates(undone, 0, false), [1]);
  assert.deepEqual(getDisplayedCandidates(afterSecond, 0, false), [1, 2]);
  const redone = redo(undone);
  assert.deepEqual(getDisplayedCandidates(redone, 0, false), [1, 2]);

  const branchBase = undo(redone);
  const branch = transact(branchBase, { type: "set", cell: 80, value: 5 });
  assert.equal(branch.redoStack.length, 0);
  assert.equal(redo(branch), branch);
  assert.deepEqual(getDisplayedCandidates(afterFirst, 0, false), [1]);
  const untouched = blankGame();
  assert.equal(undo(untouched), untouched);
});

test("history retains at most 100 undo steps", () => {
  let game = blankGame();
  for (let index = 0; index < 101; index += 1) {
    game = transact(game, {
      type: "toggleCandidate",
      cell: 0,
      value: 1,
      autoCandidates: false,
    });
  }
  assert.equal(game.undoStack.length, 100);
});

test("getConflicts marks every cell in duplicate rows, columns, and boxes", () => {
  const board = Array(81).fill(0);
  board[0] = 1;
  board[8] = 1; // Row duplicate with 0.
  board[1] = 2;
  board[73] = 2; // Column duplicate with 1.
  board[10] = 1; // Box duplicate with 0.

  assert.deepEqual(getConflicts(board), [0, 1, 8, 10, 73]);
});

test("createGame performs the initial closure and completion checks conflicts", () => {
  const solved = solvedGrid();
  const almostSolved = [...solved];
  almostSolved[80] = 0;
  const game = createGame({
    puzzleId: "almost-complete",
    difficulty: "初級",
    puzzle: almostSolved.join(""),
  });

  assert.equal(game.initialBoard[80], 0);
  assert.equal(game.currentBoard[80], solved[80]);
  assert.equal(game.sources[80], "auto");
  assert.deepEqual(game.lastAutoFilled, [80]);
  assert.deepEqual(game.undoStack, []);
  assert.equal(isComplete(game), true);

  const duplicate = [...solved];
  duplicate[80] = duplicate[79];
  const invalidComplete = createGame({
    puzzleId: "conflicting-complete",
    difficulty: "初級",
    puzzle: duplicate.join(""),
  });
  assert.equal(isComplete(invalidComplete), false);
});

test("isComplete rejects a conflict-free full board that changed a fixed given", () => {
  const solution = solvedGrid();
  const swapped = solution.map((digit) => digit === 1 ? 2 : digit === 2 ? 1 : digit);
  const game = createGame(puzzle({ 0: solution[0] }));
  const changedGiven = {
    ...game,
    currentBoard: swapped,
  };

  assert.deepEqual(getConflicts(swapped), []);
  assert.equal(isComplete(changedGiven), false);
});

test("no-op actions preserve object identity", () => {
  const game = blankGame();
  assert.equal(transact(game, { type: "delete", cell: 0 }), game);
  assert.throws(() => transact(game, { type: "toggleCandidate", cell: 0, value: 10 }), RangeError);
  assert.equal(undo(game), game);
  assert.equal(redo(game), game);
});
