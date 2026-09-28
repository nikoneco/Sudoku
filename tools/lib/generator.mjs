import { createHash } from 'node:crypto';

export const GENERATOR_VERSION = '1.0.0';
export const DIFFICULTIES = Object.freeze(['初級', '中級', '上級', '超上級']);
const FULL_MASK = 0x1ff;
const POPCOUNT = Array.from({ length: 1 << 9 }, (_, value) => {
  let count = 0;
  for (let bits = value; bits; bits &= bits - 1) count += 1;
  return count;
});

const ROWS = Array.from({ length: 9 }, (_, row) =>
  Array.from({ length: 9 }, (_, col) => row * 9 + col));
const COLUMNS = Array.from({ length: 9 }, (_, col) =>
  Array.from({ length: 9 }, (_, row) => row * 9 + col));
const BOXES = Array.from({ length: 9 }, (_, box) => {
  const rowStart = Math.floor(box / 3) * 3;
  const colStart = (box % 3) * 3;
  return Array.from({ length: 9 }, (_, offset) =>
    (rowStart + Math.floor(offset / 3)) * 9 + colStart + (offset % 3));
});
const UNITS = [...ROWS, ...COLUMNS, ...BOXES];
const CELL_UNITS = Array.from({ length: 81 }, (_, cell) =>
  UNITS.filter((unit) => unit.includes(cell)));

function fnv1a(value) {
  let hash = 0x811c9dc5;
  for (const character of String(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function createSeededRandom(seed) {
  let state = fnv1a(seed);
  return {
    next() {
      state = (state + 0x6d2b79f5) >>> 0;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000;
    },
    int(maxExclusive) {
      if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
        throw new RangeError('maxExclusive must be a positive integer');
      }
      return Math.floor(this.next() * maxExclusive);
    },
    shuffle(values) {
      const result = [...values];
      for (let index = result.length - 1; index > 0; index -= 1) {
        const swapIndex = this.int(index + 1);
        [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
      }
      return result;
    },
  };
}

export function puzzleString(board) {
  if (!Array.isArray(board) && !(board instanceof Uint8Array)) {
    throw new TypeError('Puzzle board must be an array of 81 digits');
  }
  if (board.length !== 81 || [...board].some((digit) =>
    !Number.isInteger(digit) || digit < 0 || digit > 9)) {
    throw new TypeError('Puzzle board must contain 81 integer digits from 0 to 9');
  }
  return [...board].join('');
}

export function parsePuzzle(value) {
  if (typeof value !== 'string' || !/^[0-9]{81}$/.test(value)) {
    throw new TypeError('Puzzle must be an 81-character string of digits 0-9');
  }
  return Array.from(value, Number);
}

function candidatesFor(board, cell, eliminated = 0) {
  const row = Math.floor(cell / 9);
  const col = cell % 9;
  let used = 0;
  for (let offset = 0; offset < 9; offset += 1) {
    if (board[row * 9 + offset]) used |= 1 << (board[row * 9 + offset] - 1);
    if (board[offset * 9 + col]) used |= 1 << (board[offset * 9 + col] - 1);
  }
  const boxRow = Math.floor(row / 3) * 3;
  const boxCol = Math.floor(col / 3) * 3;
  for (let dr = 0; dr < 3; dr += 1) {
    for (let dc = 0; dc < 3; dc += 1) {
      const digit = board[(boxRow + dr) * 9 + boxCol + dc];
      if (digit) used |= 1 << (digit - 1);
    }
  }
  return FULL_MASK & ~used & ~eliminated;
}

function buildCandidateMasks(board, eliminated) {
  return board.map((digit, cell) => digit ? 0 : candidatesFor(board, cell, eliminated[cell]));
}

function isValidPartial(board) {
  for (const unit of UNITS) {
    let used = 0;
    for (const cell of unit) {
      const digit = board[cell];
      if (!digit) continue;
      const bit = 1 << (digit - 1);
      if (used & bit) return false;
      used |= bit;
    }
  }
  return true;
}

function chooseBestCell(board) {
  let bestCell = -1;
  let bestMask = 0;
  let bestCount = 10;
  for (let cell = 0; cell < 81; cell += 1) {
    if (board[cell]) continue;
    const mask = candidatesFor(board, cell);
    const count = POPCOUNT[mask];
    if (count < bestCount) {
      bestCell = cell;
      bestMask = mask;
      bestCount = count;
      if (count <= 1) break;
    }
  }
  return { cell: bestCell, mask: bestMask, count: bestCount };
}

/** Count solutions independently of the technique evaluator, stopping at `limit`. */
export function countSolutions(puzzle, limit = 2) {
  const board = typeof puzzle === 'string' ? parsePuzzle(puzzle) : [...puzzle];
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError('limit must be positive');
  if (board.length !== 81 || !board.every((digit) => Number.isInteger(digit) && digit >= 0 && digit <= 9)) {
    throw new TypeError('Puzzle board must contain 81 integer digits from 0 to 9');
  }
  if (!isValidPartial(board)) return 0;

  let solutions = 0;
  function search() {
    if (solutions >= limit) return;
    const { cell, mask, count } = chooseBestCell(board);
    if (cell === -1) {
      solutions += 1;
      return;
    }
    if (count === 0) return;
    for (let digit = 1; digit <= 9 && solutions < limit; digit += 1) {
      const bit = 1 << (digit - 1);
      if (!(mask & bit)) continue;
      board[cell] = digit;
      search();
      board[cell] = 0;
    }
  }
  search();
  return solutions;
}

export function generateSolvedGrid(random) {
  const board = Array(81).fill(0);
  function fill() {
    const empty = [];
    let minimum = 10;
    for (let cell = 0; cell < 81; cell += 1) {
      if (board[cell]) continue;
      const mask = candidatesFor(board, cell);
      const count = POPCOUNT[mask];
      if (count < minimum) {
        minimum = count;
        empty.length = 0;
        empty.push({ cell, mask });
      } else if (count === minimum) {
        empty.push({ cell, mask });
      }
    }
    if (!empty.length) return true;
    if (minimum === 0) return false;
    const selected = empty[random.int(empty.length)];
    const digits = random.shuffle(Array.from({ length: 9 }, (_, index) => index + 1))
      .filter((digit) => selected.mask & (1 << (digit - 1)));
    for (const digit of digits) {
      board[selected.cell] = digit;
      if (fill()) return true;
      board[selected.cell] = 0;
    }
    return false;
  }
  if (!fill()) throw new Error('Unable to generate a solved Sudoku grid');
  return board;
}

export function solveNakedSingles(puzzle) {
  const board = typeof puzzle === 'string' ? parsePuzzle(puzzle) : [...puzzle];
  if (!isValidPartial(board)) return { solved: false, board, filled: 0, contradiction: true };
  let filled = 0;
  while (true) {
    let cellToFill = -1;
    let digitToFill = 0;
    for (let cell = 0; cell < 81; cell += 1) {
      if (board[cell]) continue;
      const mask = candidatesFor(board, cell);
      if (mask === 0) return { solved: false, board, filled, contradiction: true };
      if (POPCOUNT[mask] === 1) {
        cellToFill = cell;
        digitToFill = Math.log2(mask) + 1;
        break;
      }
    }
    if (cellToFill === -1) break;
    board[cellToFill] = digitToFill;
    filled += 1;
  }
  return { solved: board.every(Boolean), board, filled, contradiction: false };
}

function putSingle(board, cell, candidates, counts, technique) {
  if (cell < 0) return false;
  board[cell] = Math.log2(candidates[cell]) + 1;
  counts[technique] += 1;
  return true;
}

function findNakedSingle(board, candidates, counts) {
  for (let cell = 0; cell < 81; cell += 1) {
    if (!board[cell] && POPCOUNT[candidates[cell]] === 1) {
      return putSingle(board, cell, candidates, counts, 'naked_singles');
    }
  }
  return false;
}

function findHiddenSingle(board, candidates, counts) {
  for (const unit of UNITS) {
    for (let digit = 1; digit <= 9; digit += 1) {
      const bit = 1 << (digit - 1);
      let found = -1;
      for (const cell of unit) {
        if (!board[cell] && (candidates[cell] & bit)) {
          if (found !== -1) {
            found = -2;
            break;
          }
          found = cell;
        }
      }
      if (found >= 0) {
        board[found] = digit;
        counts.hidden_singles += 1;
        return true;
      }
    }
  }
  return false;
}

function removeCandidate(eliminated, candidates, cell, bits) {
  const removed = candidates[cell] & bits;
  if (!removed) return false;
  eliminated[cell] |= removed;
  return true;
}

function findLockedCandidate(board, candidates, eliminated, counts) {
  for (let boxIndex = 0; boxIndex < 9; boxIndex += 1) {
    const box = BOXES[boxIndex];
    for (let digit = 1; digit <= 9; digit += 1) {
      const bit = 1 << (digit - 1);
      const positions = box.filter((cell) => !board[cell] && (candidates[cell] & bit));
      if (positions.length < 2) continue;
      const rows = new Set(positions.map((cell) => Math.floor(cell / 9)));
      if (rows.size === 1) {
        const row = [...rows][0];
        for (const cell of ROWS[row]) {
          if (!box.includes(cell) && !board[cell] && removeCandidate(eliminated, candidates, cell, bit)) {
            counts.locked_candidates += 1;
            return true;
          }
        }
      }
      const cols = new Set(positions.map((cell) => cell % 9));
      if (cols.size === 1) {
        const col = [...cols][0];
        for (const cell of COLUMNS[col]) {
          if (!box.includes(cell) && !board[cell] && removeCandidate(eliminated, candidates, cell, bit)) {
            counts.locked_candidates += 1;
            return true;
          }
        }
      }
    }
  }

  for (const line of [...ROWS, ...COLUMNS]) {
    for (let digit = 1; digit <= 9; digit += 1) {
      const bit = 1 << (digit - 1);
      const positions = line.filter((cell) => !board[cell] && (candidates[cell] & bit));
      if (positions.length < 2) continue;
      const boxes = new Set(positions.map((cell) =>
        Math.floor(Math.floor(cell / 9) / 3) * 3 + Math.floor((cell % 9) / 3)));
      if (boxes.size !== 1) continue;
      const box = BOXES[[...boxes][0]];
      for (const cell of box) {
        if (!line.includes(cell) && !board[cell] && removeCandidate(eliminated, candidates, cell, bit)) {
          counts.locked_candidates += 1;
          return true;
        }
      }
    }
  }
  return false;
}

function findPair(board, candidates, eliminated, counts) {
  for (const unit of UNITS) {
    const pairCells = new Map();
    for (const cell of unit) {
      if (board[cell] || POPCOUNT[candidates[cell]] !== 2) continue;
      const mask = candidates[cell];
      const cells = pairCells.get(mask) ?? [];
      cells.push(cell);
      pairCells.set(mask, cells);
    }
    for (const [mask, cells] of pairCells) {
      if (cells.length !== 2) continue;
      for (const cell of unit) {
        if (!board[cell] && !cells.includes(cell) && removeCandidate(eliminated, candidates, cell, mask)) {
          counts.naked_pairs += 1;
          return true;
        }
      }
    }

    const locations = Array.from({ length: 9 }, (_, index) =>
      unit.filter((cell) => !board[cell] && (candidates[cell] & (1 << index))));
    for (let first = 0; first < 9; first += 1) {
      if (locations[first].length !== 2) continue;
      for (let second = first + 1; second < 9; second += 1) {
        if (locations[second].length !== 2 || locations[first][0] !== locations[second][0] ||
            locations[first][1] !== locations[second][1]) continue;
        const cells = locations[first];
        const allowed = (1 << first) | (1 << second);
        for (const cell of cells) {
          const extras = candidates[cell] & ~allowed;
          if (extras && removeCandidate(eliminated, candidates, cell, extras)) {
            counts.hidden_pairs += 1;
            return true;
          }
        }
      }
    }
  }
  return false;
}

function solveLogically(puzzle) {
  const board = typeof puzzle === 'string' ? parsePuzzle(puzzle) : [...puzzle];
  const eliminated = Array(81).fill(0);
  const counts = {
    naked_singles: 0,
    hidden_singles: 0,
    locked_candidates: 0,
    naked_pairs: 0,
    hidden_pairs: 0,
  };
  if (!isValidPartial(board)) return { solved: false, contradiction: true, board, counts, maxTechnique: 0 };
  let maxTechnique = 1;
  for (let level = 1; level <= 4;) {
    const candidates = buildCandidateMasks(board, eliminated);
    if (board.every(Boolean)) return { solved: true, contradiction: false, board, counts, maxTechnique };
    if (candidates.some((mask, cell) => !board[cell] && mask === 0)) {
      return { solved: false, contradiction: true, board, counts, maxTechnique };
    }
    let changed = findNakedSingle(board, candidates, counts);
    if (!changed && level >= 2) changed = findHiddenSingle(board, candidates, counts);
    if (!changed && level >= 3) changed = findLockedCandidate(board, candidates, eliminated, counts);
    if (!changed && level >= 4) changed = findPair(board, candidates, eliminated, counts);
    if (changed) {
      if (level >= 2 && counts.hidden_singles > 0) maxTechnique = Math.max(maxTechnique, 2);
      if (level >= 3 && counts.locked_candidates > 0) maxTechnique = Math.max(maxTechnique, 3);
      if (level >= 4 && (counts.naked_pairs > 0 || counts.hidden_pairs > 0)) maxTechnique = 4;
    } else {
      level += 1;
    }
  }
  return { solved: board.every(Boolean), contradiction: false, board, counts, maxTechnique };
}

function findSolution(board) {
  let nodes = 0;
  function search() {
    nodes += 1;
    const { cell, mask, count } = chooseBestCell(board);
    if (cell === -1) return true;
    if (count === 0) return false;
    for (let digit = 1; digit <= 9; digit += 1) {
      const bit = 1 << (digit - 1);
      if (!(mask & bit)) continue;
      board[cell] = digit;
      if (search()) return true;
      board[cell] = 0;
    }
    return false;
  }
  const solved = search();
  return { solved, board, nodes };
}

const TECHNIQUE_NAMES = Object.freeze({
  naked_singles: '裸シングル',
  hidden_singles: '隠れシングル',
  locked_candidates: 'ロック候補',
  naked_pairs: '裸ペア',
  hidden_pairs: '隠れペア',
  search: '探索分岐',
});

function levelToDifficulty(level) {
  if (level <= 2) return '初級';
  if (level === 3) return '中級';
  if (level === 4) return '上級';
  return '超上級';
}

export function classifyPuzzle(puzzle) {
  const board = typeof puzzle === 'string' ? parsePuzzle(puzzle) : [...puzzle];
  if (!isValidPartial(board)) throw new Error('Cannot classify a puzzle with conflicting givens');
  const logical = solveLogically(board);
  if (logical.contradiction) throw new Error('Technique evaluator reached a contradiction');
  let level = logical.maxTechnique;
  let searchNodes = 0;
  if (!logical.solved) {
    const search = findSolution([...logical.board]);
    if (!search.solved) throw new Error('Puzzle has no solution');
    level = 5;
    searchNodes = search.nodes;
  }
  const counts = { ...logical.counts };
  const techniqueSteps = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const score = level * 100 + techniqueSteps + (level === 5 ? Math.min(99, Math.floor(Math.log2(searchNodes + 1))) : 0);
  const usedTechniques = Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([key, count]) => ({ name: TECHNIQUE_NAMES[key], steps: count }));
  if (level === 5) usedTechniques.push({ name: TECHNIQUE_NAMES.search, steps: searchNodes });
  return {
    difficulty: levelToDifficulty(level),
    level,
    score,
    solved_by_logic: logical.solved,
    initial_naked_singles_solve: solveNakedSingles(board).solved,
    techniques: counts,
    search_nodes: searchNodes,
    used_techniques: usedTechniques,
  };
}

export function formatClassificationNote(classification) {
  const used = classification.used_techniques
    .map(({ name, steps }) => `${name}=${steps}`)
    .join(', ');
  return `分類=${classification.difficulty}; 使用手筋=${used || 'なし'}`;
}

export function canonicalPuzzleSignature(puzzle) {
  const board = typeof puzzle === 'string' ? parsePuzzle(puzzle) : [...puzzle];
  const transforms = [
    (row, col) => [row, col],
    (row, col) => [col, 8 - row],
    (row, col) => [8 - row, 8 - col],
    (row, col) => [8 - col, row],
    (row, col) => [row, 8 - col],
    (row, col) => [8 - row, col],
    (row, col) => [col, row],
    (row, col) => [8 - col, 8 - row],
  ];
  const signatures = transforms.map((transform) => {
    const digitMap = new Map();
    let nextDigit = 1;
    let signature = '';
    for (let cell = 0; cell < 81; cell += 1) {
      const [row, col] = transform(Math.floor(cell / 9), cell % 9);
      const digit = board[row * 9 + col];
      if (!digit) {
        signature += '0';
      } else {
        if (!digitMap.has(digit)) digitMap.set(digit, nextDigit++);
        signature += String(digitMap.get(digit));
      }
    }
    return signature;
  });
  return signatures.sort()[0];
}

export function puzzleIdFor(puzzle) {
  return `puz_${createHash('sha256').update(puzzleString(typeof puzzle === 'string' ? parsePuzzle(puzzle) : puzzle)).digest('hex').slice(0, 16)}`;
}

export function countClues(puzzle) {
  const value = typeof puzzle === 'string' ? puzzle : puzzleString(puzzle);
  return [...value].filter((digit) => digit !== '0').length;
}

export function generatePuzzleForDifficulty({
  difficulty,
  random,
  maxAttempts = 2_000,
  seenSignatures = new Set(),
  onAttempt,
}) {
  if (!DIFFICULTIES.includes(difficulty)) throw new RangeError(`Unknown difficulty: ${difficulty}`);
  if (!random || typeof random.next !== 'function' || typeof random.shuffle !== 'function') {
    throw new TypeError('A seeded random source is required');
  }
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const solution = generateSolvedGrid(random);
    const puzzle = [...solution];
    for (const cell of random.shuffle(Array.from({ length: 81 }, (_, index) => index))) {
      const previous = puzzle[cell];
      puzzle[cell] = 0;
      if (countSolutions(puzzle, 2) !== 1) {
        puzzle[cell] = previous;
        continue;
      }
      const value = puzzleString(puzzle);
      const signature = canonicalPuzzleSignature(puzzle);
      if (seenSignatures.has(signature)) continue;
      const classification = classifyPuzzle(puzzle);
      if (classification.difficulty === difficulty && !classification.initial_naked_singles_solve) {
        return { puzzle: value, solution: puzzleString(solution), classification, attempt };
      }
    }
    onAttempt?.({ difficulty, attempt });
  }
  throw new Error(`Could not generate ${difficulty} within ${maxAttempts} attempts`);
}
