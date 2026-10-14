const SIDE = 9;
const CELL_COUNT = SIDE * SIDE;

/** Row-major region labels for the nine ordinary 3 by 3 boxes. */
export const NORMAL_REGIONS = Array.from({ length: CELL_COUNT }, (_, cell) =>
  String(Math.floor(Math.floor(cell / SIDE) / 3) * 3 + Math.floor((cell % SIDE) / 3))).join("");

/** Each label must cover exactly nine orthogonally connected cells. */
export function isValidRegions(regions) {
  if (typeof regions !== "string" || regions.length !== CELL_COUNT || !/^[0-8]{81}$/.test(regions)) return false;
  const cellsByRegion = Array.from({ length: SIDE }, () => []);
  for (let cell = 0; cell < CELL_COUNT; cell += 1) cellsByRegion[Number(regions[cell])].push(cell);

  for (const cells of cellsByRegion) {
    if (cells.length !== SIDE) return false;
    const label = regions[cells[0]];
    const visited = new Set([cells[0]]);
    const pending = [cells[0]];
    while (pending.length > 0) {
      const cell = pending.pop();
      const row = Math.floor(cell / SIDE);
      const column = cell % SIDE;
      const neighbors = [];
      if (row > 0) neighbors.push(cell - SIDE);
      if (row < SIDE - 1) neighbors.push(cell + SIDE);
      if (column > 0) neighbors.push(cell - 1);
      if (column < SIDE - 1) neighbors.push(cell + 1);
      for (const neighbor of neighbors) {
        if (regions[neighbor] !== label || visited.has(neighbor)) continue;
        visited.add(neighbor);
        pending.push(neighbor);
      }
    }
    if (visited.size !== SIDE) return false;
  }
  return true;
}

/** Resolve rules from the puzzle/game, never from the user's current settings. */
export function getRegions(gameOrPuzzle) {
  const mode = gameOrPuzzle?.mode;
  const regions = gameOrPuzzle?.regions;
  if (mode === "jigsaw") {
    if (!isValidRegions(regions)) throw new TypeError("jigsaw regions must be nine connected groups of nine cells");
    return regions;
  }
  if (mode !== undefined && mode !== "normal") throw new TypeError("unsupported game mode");
  if (regions !== undefined && regions !== NORMAL_REGIONS) {
    throw new TypeError("normal games must use the ordinary 3 by 3 regions");
  }
  return NORMAL_REGIONS;
}

/** Return rows, columns, then the nine regions, in label order. */
export function getUnits(regions = NORMAL_REGIONS) {
  if (!isValidRegions(regions)) throw new TypeError("regions must be nine connected groups of nine cells");
  const units = [];
  for (let row = 0; row < SIDE; row += 1) {
    units.push(Array.from({ length: SIDE }, (_, column) => row * SIDE + column));
  }
  for (let column = 0; column < SIDE; column += 1) {
    units.push(Array.from({ length: SIDE }, (_, row) => row * SIDE + column));
  }
  const regionUnits = Array.from({ length: SIDE }, () => []);
  for (let cell = 0; cell < CELL_COUNT; cell += 1) regionUnits[Number(regions[cell])].push(cell);
  return [...units, ...regionUnits];
}
