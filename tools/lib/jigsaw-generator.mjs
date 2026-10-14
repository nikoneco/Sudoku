import { createHash } from 'node:crypto';
import {
  DIFFICULTIES, createSeededRandom, generateSolvedGrid, parsePuzzle, puzzleString,
  countClues, formatClassificationNote,
} from './generator.mjs';

export { DIFFICULTIES, createSeededRandom, parsePuzzle, puzzleString, countClues, formatClassificationNote };
export const GENERATOR_VERSION = 'jigsaw-1.0.0';
const FULL = 511;
const CELLS = Array.from({ length: 81 }, (_, cell) => cell);
const ROWS = Array.from({ length: 9 }, (_, row) => CELLS.filter((cell) => Math.floor(cell / 9) === row));
const COLS = Array.from({ length: 9 }, (_, col) => CELLS.filter((cell) => cell % 9 === col));
const NORMAL = CELLS.map((cell) => Math.floor(cell / 27) * 3 + Math.floor((cell % 9) / 3));
const NEIGHBORS = CELLS.map((cell) => [cell - 9, cell + 9,
  ...(cell % 9 ? [cell - 1] : []), ...(cell % 9 < 8 ? [cell + 1] : []),
].filter((other) => other >= 0 && other < 81));
const BITS = Array.from({ length: 512 }, (_, mask) => {
  const result = [];
  for (let digit = 1; digit <= 9; digit += 1) if (mask & (1 << (digit - 1))) result.push(digit);
  return result;
});
const TRANSFORMS = [
  (r, c) => [r, c], (r, c) => [c, 8 - r], (r, c) => [8 - r, 8 - c],
  (r, c) => [8 - c, r], (r, c) => [r, 8 - c], (r, c) => [8 - r, c],
  (r, c) => [c, r], (r, c) => [8 - c, 8 - r],
].map((transform) => CELLS.map((cell) => {
  const [r, c] = transform(Math.floor(cell / 9), cell % 9);
  return r * 9 + c;
}));

function connected(cells, labels, label) {
  if (cells.length !== 9) return false;
  const visited = new Set([cells[0]]);
  const queue = [cells[0]];
  for (let pos = 0; pos < queue.length; pos += 1) {
    for (const next of NEIGHBORS[queue[pos]]) {
      if (labels[next] === label && !visited.has(next)) { visited.add(next); queue.push(next); }
    }
  }
  return visited.size === 9;
}

/** Structural checks deliberately do not depend on the playing client. */
export function isValidJigsawRegions(regions) {
  if (typeof regions !== 'string' || !/^[0-8]{81}$/.test(regions)) return false;
  const labels = [...regions].map(Number);
  return Array.from({ length: 9 }, (_, label) =>
    connected(CELLS.filter((cell) => labels[cell] === label), labels, label)).every(Boolean);
}

function normalizeLabels(labels) {
  const map = new Map();
  return labels.map((label) => {
    if (!map.has(label)) map.set(label, map.size);
    return map.get(label);
  }).join('');
}

export function shapeSignature(regions) {
  if (!isValidJigsawRegions(regions)) throw new TypeError('Regions must be nine connected groups of nine cells');
  return TRANSFORMS.map((map) => normalizeLabels(map.map((cell) => regions[cell]))).sort()[0];
}

export function canonicalJigsawSignature(puzzle, regions) {
  const board = typeof puzzle === 'string' ? parsePuzzle(puzzle) : parsePuzzle(puzzleString(puzzle));
  if (!isValidJigsawRegions(regions)) throw new TypeError('Regions must be nine connected groups of nine cells');
  return TRANSFORMS.map((map) => {
    const digits = new Map();
    const values = map.map((cell) => {
      const digit = board[cell];
      if (!digit) return '0';
      if (!digits.has(digit)) digits.set(digit, digits.size + 1);
      return digits.get(digit);
    }).join('');
    return `${normalizeLabels(map.map((cell) => regions[cell]))}|${values}`;
  }).sort()[0];
}

export function jigsawPuzzleId(puzzle, regions) {
  parsePuzzle(puzzle);
  if (!isValidJigsawRegions(regions)) throw new TypeError('Invalid regions');
  return `jigsaw_${createHash('sha256').update(`${puzzle}|${regions}`).digest('hex').slice(0, 20)}`;
}

export function irregularRegionCount(regions) {
  return Array.from({ length: 9 }, (_, label) => {
    const cells = CELLS.filter((cell) => Number(regions[cell]) === label);
    const rows = cells.map((cell) => Math.floor(cell / 9));
    const cols = cells.map((cell) => cell % 9);
    const area = (Math.max(...rows) - Math.min(...rows) + 1) * (Math.max(...cols) - Math.min(...cols) + 1);
    return area !== 9;
  }).filter(Boolean).length;
}

/** Exchange same-digit boundary cells, retaining connectivity, size, and a valid solution. */
export function generateJigsawShape(solution, random, { swaps = 45, minIrregular = 7 } = {}) {
  const board = typeof solution === 'string' ? parsePuzzle(solution) : [...solution];
  if (board.length !== 81 || !board.every((digit) => digit >= 1 && digit <= 9)) throw new TypeError('A complete solution is required');
  const labels = [...NORMAL];
  let accepted = 0;
  for (let iteration = 0; iteration < 12_000 && accepted < swaps; iteration += 1) {
    const first = random.int(81);
    const adjacentLabels = [...new Set(NEIGHBORS[first].map((cell) => labels[cell]))]
      .filter((label) => label !== labels[first]);
    if (!adjacentLabels.length) continue;
    const target = adjacentLabels[random.int(adjacentLabels.length)];
    const second = CELLS.find((cell) => labels[cell] === target && board[cell] === board[first]);
    if (second === undefined || !NEIGHBORS[second].some((cell) => labels[cell] === labels[first])) continue;
    const source = labels[first];
    labels[first] = target; labels[second] = source;
    if (!connected(CELLS.filter((cell) => labels[cell] === source), labels, source) ||
        !connected(CELLS.filter((cell) => labels[cell] === target), labels, target)) {
      labels[first] = source; labels[second] = target;
      continue;
    }
    accepted += 1;
  }
  const regions = normalizeLabels(labels);
  return irregularRegionCount(regions) >= minIrregular ? regions : null;
}

const geometryCache = new Map();
function geometry(regions) {
  if (geometryCache.has(regions)) return geometryCache.get(regions);
  if (!isValidJigsawRegions(regions)) throw new TypeError('Regions must be nine connected groups of nine cells');
  const regionAt = [...regions].map(Number);
  const groups = Array.from({ length: 9 }, (_, label) => CELLS.filter((cell) => regionAt[cell] === label));
  const units = [...ROWS, ...COLS, ...groups];
  const peers = CELLS.map((cell) => [...new Set(units.filter((unit) => unit.includes(cell)).flat())].filter((other) => other !== cell));
  const result = { regionAt, groups, units, peers };
  // Generation can inspect thousands of shapes without retaining unbounded geometry.
  if (geometryCache.size >= 128) geometryCache.delete(geometryCache.keys().next().value);
  geometryCache.set(regions, result);
  return result;
}

function boardValue(puzzle) { return typeof puzzle === 'string' ? parsePuzzle(puzzle) : parsePuzzle(puzzleString(puzzle)); }
function validPartial(board, geo) {
  return geo.units.every((unit) => {
    let mask = 0;
    for (const cell of unit) {
      if (!board[cell]) continue;
      const bit = 1 << (board[cell] - 1);
      if (mask & bit) return false;
      mask |= bit;
    }
    return true;
  });
}
function candidateMasks(board, eliminated, geo) {
  return board.map((digit, cell) => {
    if (digit) return 0;
    let used = eliminated[cell];
    for (const peer of geo.peers[cell]) if (board[peer]) used |= 1 << (board[peer] - 1);
    return FULL & ~used;
  });
}

/** MRV solution counter; independent of all logical technique evaluation. */
export function countJigsawSolutions(puzzle, regions, limit = 2) {
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError('limit must be positive');
  const board = boardValue(puzzle);
  const geo = geometry(regions);
  const rowMasks = Array(9).fill(0), colMasks = Array(9).fill(0), groupMasks = Array(9).fill(0);
  for (const cell of CELLS) {
    if (!board[cell]) continue;
    const row = Math.floor(cell / 9), col = cell % 9, group = geo.regionAt[cell], bit = 1 << (board[cell] - 1);
    if ((rowMasks[row] | colMasks[col] | groupMasks[group]) & bit) return 0;
    rowMasks[row] |= bit; colMasks[col] |= bit; groupMasks[group] |= bit;
  }
  let count = 0;
  function search() {
    if (count >= limit) return;
    let selected = -1, options = 0, min = 10;
    const masks = Array(81).fill(0);
    for (const cell of CELLS) {
      if (board[cell]) continue;
      const mask = FULL & ~(rowMasks[Math.floor(cell / 9)] | colMasks[cell % 9] | groupMasks[geo.regionAt[cell]]);
      masks[cell] = mask;
      const size = BITS[mask].length;
      if (!size) return;
      if (size < min) { selected = cell; options = mask; min = size; if (min === 1) break; }
    }
    if (selected < 0) { count += 1; return; }
    let branches = BITS[options].map((digit) => [selected, digit]);
    // A missing unit digit is another exact constraint. Branch on it when it has
    // fewer locations than the best cell; this also detects hidden singles and
    // impossible unit digits before a large uniqueness search develops.
    if (min > 1) {
      for (let unitIndex = 0; unitIndex < 27; unitIndex += 1) {
        const used = unitIndex < 9 ? rowMasks[unitIndex] : unitIndex < 18 ? colMasks[unitIndex - 9] : groupMasks[unitIndex - 18];
        for (const digit of BITS[FULL & ~used]) {
          const bit = 1 << (digit - 1);
          const positions = geo.units[unitIndex].filter((cell) => masks[cell] & bit);
          if (!positions.length) return;
          if (positions.length < min) { min = positions.length; branches = positions.map((cell) => [cell, digit]); }
        }
      }
    }
    for (const [cell, digit] of branches) {
      const row = Math.floor(cell / 9), col = cell % 9, group = geo.regionAt[cell];
      const bit = 1 << (digit - 1);
      board[cell] = digit; rowMasks[row] |= bit; colMasks[col] |= bit; groupMasks[group] |= bit;
      search();
      rowMasks[row] ^= bit; colMasks[col] ^= bit; groupMasks[group] ^= bit; board[cell] = 0;
      if (count >= limit) return;
    }
  }
  search();
  return count;
}

export function solveJigsawNakedSingles(puzzle, regions) {
  const board = boardValue(puzzle), geo = geometry(regions), eliminated = Array(81).fill(0);
  let filled = 0;
  if (!validPartial(board, geo)) return { solved: false, contradiction: true, filled, board };
  while (true) {
    const candidates = candidateMasks(board, eliminated, geo);
    if (CELLS.some((cell) => !board[cell] && !candidates[cell])) return { solved: false, contradiction: true, filled, board };
    const cell = CELLS.find((index) => !board[index] && BITS[candidates[index]].length === 1);
    if (cell === undefined) return { solved: board.every(Boolean), contradiction: false, filled, board };
    board[cell] = BITS[candidates[cell]][0]; filled += 1;
  }
}

function hiddenSingle(board, candidates, geo) {
  for (const unit of geo.units) for (let digit = 1; digit <= 9; digit += 1) {
    const positions = unit.filter((cell) => !board[cell] && (candidates[cell] & (1 << (digit - 1))));
    if (positions.length === 1) { board[positions[0]] = digit; return true; }
  }
  return false;
}
function eliminate(candidates, eliminated, cell, bits) {
  const removed = candidates[cell] & bits;
  if (!removed) return false;
  eliminated[cell] |= removed;
  return true;
}
function lockedCandidate(board, candidates, eliminated, geo) {
  // Both pointing (region -> line) and claiming (line -> region), with arbitrary regions.
  for (const unit of geo.units) for (let digit = 1; digit <= 9; digit += 1) {
    const bit = 1 << (digit - 1);
    const positions = unit.filter((cell) => !board[cell] && (candidates[cell] & bit));
    if (positions.length < 2) continue;
    for (const other of geo.units) {
      if (other === unit || !positions.every((cell) => other.includes(cell))) continue;
      for (const cell of other) if (!board[cell] && !unit.includes(cell) && eliminate(candidates, eliminated, cell, bit)) return true;
    }
  }
  return false;
}
function pair(board, candidates, eliminated, geo, counts) {
  for (const unit of geo.units) {
    const pairs = new Map();
    for (const cell of unit) if (!board[cell] && BITS[candidates[cell]].length === 2) {
      const mask = candidates[cell];
      if (!pairs.has(mask)) pairs.set(mask, []);
      pairs.get(mask).push(cell);
    }
    for (const [mask, cells] of pairs) if (cells.length === 2) {
      for (const cell of unit) if (!board[cell] && !cells.includes(cell) && eliminate(candidates, eliminated, cell, mask)) {
        counts.naked_pairs += 1; return true;
      }
    }
    const places = Array.from({ length: 9 }, (_, digit) => unit.filter((cell) => !board[cell] && (candidates[cell] & (1 << digit))));
    for (let first = 0; first < 9; first += 1) {
      if (places[first].length !== 2) continue;
      for (let second = first + 1; second < 9; second += 1) {
        if (places[second].length !== 2 || places[first][0] !== places[second][0] || places[first][1] !== places[second][1]) continue;
        const allowed = (1 << first) | (1 << second);
        for (const cell of places[first]) if (eliminate(candidates, eliminated, cell, candidates[cell] & ~allowed)) {
          counts.hidden_pairs += 1; return true;
        }
      }
    }
  }
  return false;
}

function logicalSolve(puzzle, geo) {
  const board = [...puzzle], eliminated = Array(81).fill(0);
  const counts = { naked_singles: 0, hidden_singles: 0, locked_candidates: 0, naked_pairs: 0, hidden_pairs: 0 };
  let maxTechnique = 1;
  // Always exhaust simpler techniques first. A higher tier requires an actual effective elimination.
  while (true) {
    if (board.every(Boolean)) return { board, eliminated, solved: true, counts, maxTechnique };
    const candidates = candidateMasks(board, eliminated, geo);
    if (CELLS.some((cell) => !board[cell] && !candidates[cell])) throw new Error('Technique evaluation reached a contradiction');
    const naked = CELLS.find((cell) => !board[cell] && BITS[candidates[cell]].length === 1);
    if (naked !== undefined) { board[naked] = BITS[candidates[naked]][0]; counts.naked_singles += 1; continue; }
    if (hiddenSingle(board, candidates, geo)) { counts.hidden_singles += 1; maxTechnique = Math.max(2, maxTechnique); continue; }
    if (lockedCandidate(board, candidates, eliminated, geo)) { counts.locked_candidates += 1; maxTechnique = Math.max(3, maxTechnique); continue; }
    if (pair(board, candidates, eliminated, geo, counts)) { maxTechnique = 4; continue; }
    return { board, eliminated, solved: false, counts, maxTechnique };
  }
}
function searchForClassification(board, eliminated, geo) {
  let nodes = 0;
  function search() {
    nodes += 1;
    const candidates = candidateMasks(board, eliminated, geo);
    let best = -1, min = 10;
    for (const cell of CELLS) if (!board[cell]) {
      const count = BITS[candidates[cell]].length;
      if (!count) return false;
      if (count < min) { best = cell; min = count; }
    }
    if (best < 0) return true;
    for (const digit of BITS[candidates[best]]) { board[best] = digit; if (search()) return true; }
    board[best] = 0;
    return false;
  }
  return { solved: search(), nodes };
}
const NAMES = { naked_singles: '裸シングル', hidden_singles: '隠れシングル', locked_candidates: 'ロック候補', naked_pairs: '裸ペア', hidden_pairs: '隠れペア' };
export function classifyJigsawPuzzle(puzzle, regions) {
  const board = boardValue(puzzle), geo = geometry(regions);
  if (!validPartial(board, geo)) throw new Error('Cannot classify conflicting givens');
  const logical = logicalSolve(board, geo);
  let level = logical.maxTechnique, searchNodes = 0;
  if (!logical.solved) {
    const result = searchForClassification([...logical.board], logical.eliminated, geo);
    if (!result.solved) throw new Error('Puzzle has no solution');
    level = 5; searchNodes = result.nodes;
  }
  const difficulty = level <= 2 ? '初級' : DIFFICULTIES[level - 2];
  const used = Object.entries(logical.counts).filter(([, count]) => count > 0).map(([name, count]) => ({ name: NAMES[name], steps: count }));
  if (level === 5) used.push({ name: '探索分岐', steps: searchNodes });
  return { difficulty, level, score: level * 100 + Object.values(logical.counts).reduce((sum, count) => sum + count, 0) +
    (level === 5 ? Math.min(99, Math.floor(Math.log2(searchNodes + 1))) : 0), solved_by_logic: logical.solved,
  initial_naked_singles_solve: solveJigsawNakedSingles(board, regions).solved,
  techniques: logical.counts, search_nodes: searchNodes, used_techniques: used };
}

export function generateJigsawForDifficulty({ difficulty, random, maxAttempts = 2_000, seenSignatures = new Set(), onAttempt = () => {} }) {
  if (!DIFFICULTIES.includes(difficulty)) throw new RangeError(`Unknown difficulty: ${difficulty}`);
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const solution = generateSolvedGrid(random);
    const regions = generateJigsawShape(solution, random);
    if (!regions) { onAttempt({ attempt, reason: 'shape' }); continue; }
    const puzzle = [...solution];
    for (const cell of random.shuffle(CELLS)) {
      const previous = puzzle[cell]; puzzle[cell] = 0;
      if (countJigsawSolutions(puzzle, regions) !== 1) { puzzle[cell] = previous; continue; }
      // Most dense boards are solved by initial naked closure; avoid expensive classification there.
      if (solveJigsawNakedSingles(puzzle, regions).solved) continue;
      const classification = classifyJigsawPuzzle(puzzle, regions);
      if (classification.difficulty !== difficulty) continue;
      const value = puzzleString(puzzle);
      if (seenSignatures.has(canonicalJigsawSignature(value, regions))) continue;
      return { puzzle: value, solution: puzzleString(solution), regions, classification, attempt };
    }
    onAttempt({ attempt, reason: 'difficulty' });
  }
  throw new Error(`Could not generate jigsaw ${difficulty} within ${maxAttempts} attempts`);
}
