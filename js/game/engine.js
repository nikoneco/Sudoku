const CELL_COUNT = 81;
const SIDE = 9;
const BOX_SIDE = 3;
const ALL_DIGITS_MASK = (1 << SIDE) - 1;
const HISTORY_LIMIT = 100;

const hasBit = (mask, digit) => (mask & (1 << (digit - 1))) !== 0;
const bitFor = (digit) => 1 << (digit - 1);

function assertCell(cell) {
  if (!Number.isInteger(cell) || cell < 0 || cell >= CELL_COUNT) {
    throw new RangeError("cell must be an integer from 0 through 80");
  }
}

function assertBoard(board) {
  if (!Array.isArray(board) || board.length !== CELL_COUNT) {
    throw new TypeError("board must be an array of 81 digits");
  }
  if (board.some((value) => !Number.isInteger(value) || value < 0 || value > 9)) {
    throw new TypeError("board cells must be integers from 0 through 9");
  }
}

function assertMaskArray(masks, name) {
  if (!Array.isArray(masks) || masks.length !== CELL_COUNT) {
    throw new TypeError(`${name} must be an array of 81 bitmasks`);
  }
  if (masks.some((mask) => !Number.isInteger(mask) || mask < 0 || mask > ALL_DIGITS_MASK)) {
    throw new TypeError(`${name} entries must be 9-bit nonnegative integers`);
  }
}

function assertSources(sources) {
  if (!Array.isArray(sources) || sources.length !== CELL_COUNT || sources.some((source) => typeof source !== "string")) {
    throw new TypeError("sources must be an array of 81 strings");
  }
}

function assertGame(game) {
  if (!game || typeof game !== "object") throw new TypeError("game must be an object");
  assertBoard(game.initialBoard);
  assertBoard(game.currentBoard);
  assertMaskArray(game.manualIncludedCandidates, "manualIncludedCandidates");
  assertMaskArray(game.manualExcludedCandidates, "manualExcludedCandidates");
  assertSources(game.sources);
  if (!Array.isArray(game.undoStack) || !Array.isArray(game.redoStack)) {
    throw new TypeError("undoStack and redoStack must be arrays");
  }
}

function digitsFromMask(mask) {
  const digits = [];
  for (let digit = 1; digit <= SIDE; digit += 1) {
    if (hasBit(mask, digit)) digits.push(digit);
  }
  return digits;
}

function peerIndices(cell) {
  const row = Math.floor(cell / SIDE);
  const column = cell % SIDE;
  const boxRow = Math.floor(row / BOX_SIDE) * BOX_SIDE;
  const boxColumn = Math.floor(column / BOX_SIDE) * BOX_SIDE;
  const peers = new Set();

  for (let offset = 0; offset < SIDE; offset += 1) {
    peers.add(row * SIDE + offset);
    peers.add(offset * SIDE + column);
  }
  for (let rowOffset = 0; rowOffset < BOX_SIDE; rowOffset += 1) {
    for (let columnOffset = 0; columnOffset < BOX_SIDE; columnOffset += 1) {
      peers.add((boxRow + rowOffset) * SIDE + boxColumn + columnOffset);
    }
  }
  peers.delete(cell);
  return peers;
}

function legalMaskForBoard(board, cell) {
  if (board[cell] !== 0) return 0;
  let occupied = 0;
  for (const peer of peerIndices(cell)) {
    const value = board[peer];
    if (value !== 0) occupied |= bitFor(value);
  }
  return ALL_DIGITS_MASK & ~occupied;
}

/** Return the legal Sudoku digits for an empty cell, in ascending order. */
export function getLegalCandidates(board, cell) {
  assertBoard(board);
  assertCell(cell);
  return digitsFromMask(legalMaskForBoard(board, cell));
}

/** Return legal candidates after explicit exclusions, regardless of display settings. */
export function getEffectiveCandidates(game, cell) {
  assertGame(game);
  assertCell(cell);
  const legal = legalMaskForBoard(game.currentBoard, cell);
  return digitsFromMask(legal & ~game.manualExcludedCandidates[cell]);
}

/**
 * Return the candidates visible in the selected display mode.
 * Automatic display uses effective candidates; manual display uses explicitly
 * included legal candidates, with exclusions taking precedence in both modes.
 */
export function getDisplayedCandidates(game, cell, autoCandidates = true) {
  assertGame(game);
  assertCell(cell);
  if (typeof autoCandidates !== "boolean") {
    throw new TypeError("autoCandidates must be a boolean");
  }
  const legal = legalMaskForBoard(game.currentBoard, cell);
  const notExcluded = ~game.manualExcludedCandidates[cell];
  const visible = autoCandidates
    ? legal & notExcluded
    : legal & game.manualIncludedCandidates[cell] & notExcluded;
  return digitsFromMask(visible);
}

function makeSnapshot(game) {
  return {
    currentBoard: [...game.currentBoard],
    manualIncludedCandidates: [...game.manualIncludedCandidates],
    manualExcludedCandidates: [...game.manualExcludedCandidates],
    sources: [...game.sources],
  };
}

function cloneSnapshot(snapshot) {
  return {
    currentBoard: [...snapshot.currentBoard],
    manualIncludedCandidates: [...snapshot.manualIncludedCandidates],
    manualExcludedCandidates: [...snapshot.manualExcludedCandidates],
    sources: [...snapshot.sources],
  };
}

function cloneHistory(stack) {
  return stack.map(cloneSnapshot);
}

function withSnapshot(game, snapshot) {
  return {
    ...game,
    currentBoard: [...snapshot.currentBoard],
    manualIncludedCandidates: [...snapshot.manualIncludedCandidates],
    manualExcludedCandidates: [...snapshot.manualExcludedCandidates],
    sources: [...snapshot.sources],
  };
}

function runNakedSingleClosure(board, excludedMasks, sources) {
  const filled = [];
  let changed = true;

  while (changed) {
    changed = false;
    for (let cell = 0; cell < CELL_COUNT; cell += 1) {
      if (board[cell] !== 0) continue;
      const candidates = legalMaskForBoard(board, cell) & ~excludedMasks[cell];
      if (candidates === 0 || (candidates & (candidates - 1)) !== 0) continue;

      let digit = 1;
      while (!hasBit(candidates, digit)) digit += 1;
      board[cell] = digit;
      sources[cell] = "auto";
      filled.push(cell);
      changed = true;
    }
  }
  return filled;
}

/** Create a serializable game and apply any initial naked-single chain. */
export function createGame(puzzle) {
  if (!puzzle || typeof puzzle !== "object") throw new TypeError("puzzle must be an object");
  if (typeof puzzle.puzzleId !== "string" || puzzle.puzzleId.length === 0) {
    throw new TypeError("puzzleId must be a nonempty string");
  }
  if (typeof puzzle.difficulty !== "string" || puzzle.difficulty.length === 0) {
    throw new TypeError("difficulty must be a nonempty string");
  }
  if (typeof puzzle.puzzle !== "string" || !/^\d{81}$/.test(puzzle.puzzle)) {
    throw new TypeError("puzzle must be an 81-character digit string using 0 for blanks");
  }

  const initialBoard = Array.from(puzzle.puzzle, Number);
  const currentBoard = [...initialBoard];
  const sources = initialBoard.map((value) => value === 0 ? "" : "given");
  const manualIncludedCandidates = Array(CELL_COUNT).fill(0);
  const manualExcludedCandidates = Array(CELL_COUNT).fill(0);
  const lastAutoFilled = runNakedSingleClosure(currentBoard, manualExcludedCandidates, sources);

  return {
    puzzleId: puzzle.puzzleId,
    difficulty: puzzle.difficulty,
    initialBoard,
    currentBoard,
    manualIncludedCandidates,
    manualExcludedCandidates,
    sources,
    undoStack: [],
    redoStack: [],
    elapsedTime: 0,
    startedAt: new Date().toISOString(),
    lastAutoFilled,
  };
}

function sameArray(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameEditableState(left, right) {
  return sameArray(left.currentBoard, right.currentBoard)
    && sameArray(left.manualIncludedCandidates, right.manualIncludedCandidates)
    && sameArray(left.manualExcludedCandidates, right.manualExcludedCandidates)
    && sameArray(left.sources, right.sources);
}

function finishTransaction(game, draft, autoFill) {
  const lastAutoFilled = autoFill
    ? runNakedSingleClosure(draft.currentBoard, draft.manualExcludedCandidates, draft.sources)
    : [];
  if (sameEditableState(game, draft)) return game;

  const undoStack = [...cloneHistory(game.undoStack), makeSnapshot(game)].slice(-HISTORY_LIMIT);
  return {
    ...game,
    initialBoard: [...game.initialBoard],
    currentBoard: draft.currentBoard,
    manualIncludedCandidates: draft.manualIncludedCandidates,
    manualExcludedCandidates: draft.manualExcludedCandidates,
    sources: draft.sources,
    undoStack,
    redoStack: [],
    lastAutoFilled,
  };
}

/** Apply one user action and any resulting naked-single chain as one history step. */
export function transact(game, action) {
  assertGame(game);
  if (!action || typeof action !== "object") throw new TypeError("action must be an object");
  if (!["set", "toggleCandidate", "delete", "clearNotes"].includes(action.type)) {
    throw new TypeError("unsupported transaction type");
  }
  assertCell(action.cell);

  if (action.type === "set" && (!Number.isInteger(action.value) || action.value < 1 || action.value > 9)) {
    throw new RangeError("set value must be an integer from 1 through 9");
  }
  if (action.type === "toggleCandidate") {
    if (!Number.isInteger(action.value) || action.value < 1 || action.value > 9) {
      throw new RangeError("candidate value must be an integer from 1 through 9");
    }
    if (action.autoCandidates !== undefined && typeof action.autoCandidates !== "boolean") {
      throw new TypeError("autoCandidates must be a boolean");
    }
  }

  const cell = action.cell;
  if (game.initialBoard[cell] !== 0) return game;

  const draft = {
    currentBoard: [...game.currentBoard],
    manualIncludedCandidates: [...game.manualIncludedCandidates],
    manualExcludedCandidates: [...game.manualExcludedCandidates],
    sources: [...game.sources],
  };

  if (action.type === "set") {
    if (draft.currentBoard[cell] === action.value) return game;
    draft.currentBoard[cell] = action.value;
    draft.sources[cell] = "manual";
    return finishTransaction(game, draft, true);
  }

  if (action.type === "delete") {
    if (draft.currentBoard[cell] === 0) return game;
    draft.currentBoard[cell] = 0;
    draft.sources[cell] = "";
    return finishTransaction(game, draft, false);
  }

  if (action.type === "clearNotes") {
    const legal = legalMaskForBoard(draft.currentBoard, cell);
    draft.manualIncludedCandidates[cell] = 0;
    draft.manualExcludedCandidates[cell] |= legal;
    return finishTransaction(game, draft, false);
  }

  const digitBit = bitFor(action.value);
  if (!hasBit(legalMaskForBoard(draft.currentBoard, cell), action.value)) return game;
  if (action.autoCandidates ?? true) {
    if (hasBit(draft.manualExcludedCandidates[cell], action.value)) {
      draft.manualExcludedCandidates[cell] &= ~digitBit;
    } else {
      draft.manualExcludedCandidates[cell] |= digitBit;
    }
  } else {
    const isDisplayed = hasBit(draft.manualIncludedCandidates[cell], action.value)
      && !hasBit(draft.manualExcludedCandidates[cell], action.value);
    if (isDisplayed) {
      draft.manualIncludedCandidates[cell] &= ~digitBit;
      draft.manualExcludedCandidates[cell] |= digitBit;
    } else {
      draft.manualIncludedCandidates[cell] |= digitBit;
      draft.manualExcludedCandidates[cell] &= ~digitBit;
    }
  }
  return finishTransaction(game, draft, true);
}

/** Restore the previous editable snapshot without changing timer fields. */
export function undo(game) {
  assertGame(game);
  if (game.undoStack.length === 0) return game;

  const undoStack = cloneHistory(game.undoStack);
  const previous = undoStack.pop();
  const redoStack = [...cloneHistory(game.redoStack), makeSnapshot(game)].slice(-HISTORY_LIMIT);
  return {
    ...game,
    ...withSnapshot(game, previous),
    undoStack,
    redoStack,
    lastAutoFilled: [],
  };
}

/** Reapply the next editable snapshot without changing timer fields. */
export function redo(game) {
  assertGame(game);
  if (game.redoStack.length === 0) return game;

  const redoStack = cloneHistory(game.redoStack);
  const next = redoStack.pop();
  const undoStack = [...cloneHistory(game.undoStack), makeSnapshot(game)].slice(-HISTORY_LIMIT);
  return {
    ...game,
    ...withSnapshot(game, next),
    undoStack,
    redoStack,
    lastAutoFilled: [],
  };
}

/** Return every cell participating in a row, column, or box duplicate. */
export function getConflicts(board) {
  assertBoard(board);
  const conflicts = new Set();
  const groups = [];

  for (let row = 0; row < SIDE; row += 1) {
    groups.push(Array.from({ length: SIDE }, (_, column) => row * SIDE + column));
  }
  for (let column = 0; column < SIDE; column += 1) {
    groups.push(Array.from({ length: SIDE }, (_, row) => row * SIDE + column));
  }
  for (let boxRow = 0; boxRow < BOX_SIDE; boxRow += 1) {
    for (let boxColumn = 0; boxColumn < BOX_SIDE; boxColumn += 1) {
      const group = [];
      for (let rowOffset = 0; rowOffset < BOX_SIDE; rowOffset += 1) {
        for (let columnOffset = 0; columnOffset < BOX_SIDE; columnOffset += 1) {
          group.push((boxRow * BOX_SIDE + rowOffset) * SIDE + boxColumn * BOX_SIDE + columnOffset);
        }
      }
      groups.push(group);
    }
  }

  for (const group of groups) {
    const cellsByDigit = new Map();
    for (const cell of group) {
      const digit = board[cell];
      if (digit === 0) continue;
      const cells = cellsByDigit.get(digit) ?? [];
      cells.push(cell);
      cellsByDigit.set(digit, cells);
    }
    for (const cells of cellsByDigit.values()) {
      if (cells.length > 1) for (const cell of cells) conflicts.add(cell);
    }
  }
  return [...conflicts].sort((left, right) => left - right);
}

/** A complete board must be full and free of Sudoku conflicts. */
export function isComplete(game) {
  assertGame(game);
  return game.currentBoard.every((value) => value !== 0)
    && game.initialBoard.every((value, cell) => value === 0 || game.currentBoard[cell] === value)
    && getConflicts(game.currentBoard).length === 0;
}
