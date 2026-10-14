import { getConflicts, getLegalCandidates } from "./engine.js";
import { getUnits, isValidRegions, NORMAL_REGIONS } from "./regions.js";

const SIDE = 9;
const CELL_COUNT = SIDE * SIDE;

/**
 * Find a missing digit with exactly one legal location in a row, column or region.
 * Uses only the current board, never notes, exclusions or an answer grid.
 * Does not fill cells or infer pairs. Results prefer the lowest cell index.
 * Conflict checks are immediate constraints, not a solvability search.
 */
export function findHint(board, regions = NORMAL_REGIONS) {
  if (!isValidRegions(regions)) return { status: "conflict" };
  if (!Array.isArray(board) || board.length !== CELL_COUNT) return { status: "conflict" };
  for (let cell = 0; cell < CELL_COUNT; cell += 1) {
    if (!Object.hasOwn(board, cell) || !Number.isInteger(board[cell]) || board[cell] < 0 || board[cell] > 9) {
      return { status: "conflict" };
    }
  }
  if (getConflicts(board, regions).length > 0) return { status: "conflict" };

  const candidates = Array.from({ length: CELL_COUNT }, (_, cell) => getLegalCandidates(board, cell, regions));
  const forced = Array(CELL_COUNT).fill(0);
  const hints = Array(CELL_COUNT).fill(0);
  for (let cell = 0; cell < CELL_COUNT; cell += 1) {
    if (board[cell] !== 0) continue;
    if (candidates[cell].length === 0) return { status: "conflict" };
    // A sole candidate is forced, but is not itself a unique-location hint.
    if (candidates[cell].length === 1) forced[cell] = candidates[cell][0];
  }

  for (const unit of getUnits(regions)) {
    const present = new Set(unit.map(cell => board[cell]));
    for (let digit = 1; digit <= SIDE; digit += 1) {
      if (present.has(digit)) continue;
      const locations = unit.filter(cell => candidates[cell].includes(digit));
      if (locations.length === 0) return { status: "conflict" };
      if (locations.length !== 1) continue;

      const cell = locations[0];
      if (forced[cell] !== 0 && forced[cell] !== digit) return { status: "conflict" };
      forced[cell] = digit;
      hints[cell] = digit;
    }
  }

  // All immediate forced assignments must be compatible with one another.
  const forcedBoard = board.map((digit, cell) => digit || forced[cell]);
  if (getConflicts(forcedBoard, regions).length > 0) return { status: "conflict" };

  const cell = hints.findIndex(digit => digit !== 0);
  return cell < 0 ? { status: "none" } : { status: "found", cell, digit: hints[cell] };
}
