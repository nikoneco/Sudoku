import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DIFFICULTIES, canonicalJigsawSignature, classifyJigsawPuzzle, countJigsawSolutions,
  createSeededRandom, generateJigsawForDifficulty, isValidJigsawRegions,
  irregularRegionCount, jigsawPuzzleId, shapeSignature, solveJigsawNakedSingles,
} from '../tools/lib/jigsaw-generator.mjs';
import { generateJigsawDataset } from '../tools/generate-jigsaw.mjs';
import { countSolutionsExactCover, validateJigsawDataset } from '../tools/validate-jigsaw.mjs';

const fixtures = DIFFICULTIES.map((difficulty) => ({ difficulty, ...generateJigsawForDifficulty({
  difficulty, random: createSeededRandom(`pilot|${difficulty}`), maxAttempts: 100,
}) }));

test('independently generated jigsaw tiers have connected irregular geometry and unique solutions', () => {
  for (const fixture of fixtures) {
    assert.equal(isValidJigsawRegions(fixture.regions), true);
    assert.ok(irregularRegionCount(fixture.regions) >= 7);
    assert.equal(countJigsawSolutions(fixture.puzzle, fixture.regions), 1);
    assert.equal(countSolutionsExactCover(fixture.puzzle, fixture.regions), 1);
    assert.equal(countSolutionsExactCover(fixture.solution, fixture.regions), 1);
    assert.equal(solveJigsawNakedSingles(fixture.puzzle, fixture.regions).solved, false);
    const classification = classifyJigsawPuzzle(fixture.puzzle, fixture.regions);
    assert.equal(classification.difficulty, fixture.difficulty);
    if (fixture.difficulty === '初級') assert.ok(classification.techniques.hidden_singles > 0);
    if (fixture.difficulty === '中級') assert.ok(classification.techniques.locked_candidates > 0);
    if (fixture.difficulty === '上級') assert.ok(classification.techniques.naked_pairs + classification.techniques.hidden_pairs > 0);
    if (fixture.difficulty === '超上級') assert.ok(classification.search_nodes > 0);
  }
});

test('jigsaw counters agree on invalid, ambiguous, and valid boards', () => {
  const { regions, solution } = fixtures[0];
  const ambiguous = solution.replace(/[12]/g, '0');
  assert.equal(countJigsawSolutions(ambiguous, regions), 2);
  assert.equal(countSolutionsExactCover(ambiguous, regions), 2);
  const conflict = `${solution[0]}${solution[0]}${solution.slice(2)}`;
  assert.equal(countJigsawSolutions(conflict, regions), 0);
  assert.equal(countSolutionsExactCover(conflict, regions), 0);
  // This conflict shares only an irregular region, not a row, column, or classic box.
  const normalBox = (cell) => Math.floor(cell / 27) * 3 + Math.floor((cell % 9) / 3);
  let regionPair;
  for (let first = 0; first < 81 && !regionPair; first += 1) {
    for (let second = first + 1; second < 81; second += 1) {
      if (regions[first] === regions[second] && Math.floor(first / 9) !== Math.floor(second / 9) &&
          first % 9 !== second % 9 && normalBox(first) !== normalBox(second)) { regionPair = [first, second]; break; }
    }
  }
  assert.ok(regionPair);
  const regionConflict = Array(81).fill('0');
  for (const cell of regionPair) regionConflict[cell] = '1';
  assert.equal(countJigsawSolutions(regionConflict.join(''), regions), 0);
  assert.equal(countSolutionsExactCover(regionConflict.join(''), regions), 0);
  assert.equal(isValidJigsawRegions('0'.repeat(81)), false);
  const disconnected = [...regions];
  const one = 0, two = regions.split('').findIndex((label, cell) => label !== regions[one] && Math.abs(cell - one) > 20);
  [disconnected[one], disconnected[two]] = [disconnected[two], disconnected[one]];
  assert.equal(isValidJigsawRegions(disconnected.join('')), false);
});

test('canonical jigsaw duplicates normalize joint square symmetry and independent digit/region relabeling', () => {
  const { puzzle, regions } = fixtures[0];
  const transformedPuzzle = Array(81), transformedRegions = Array(81);
  for (let row = 0; row < 9; row += 1) for (let col = 0; col < 9; col += 1) {
    const src = row * 9 + col, dst = col * 9 + 8 - row;
    transformedPuzzle[dst] = puzzle[src] === '0' ? '0' : String(Number(puzzle[src]) % 9 + 1);
    transformedRegions[dst] = String((Number(regions[src]) + 4) % 9);
  }
  assert.equal(canonicalJigsawSignature(puzzle, regions), canonicalJigsawSignature(transformedPuzzle.join(''), transformedRegions.join('')));
  assert.equal(shapeSignature(regions), shapeSignature(transformedRegions.join('')));
  assert.notEqual(jigsawPuzzleId(puzzle, regions), jigsawPuzzleId(transformedPuzzle.join(''), transformedRegions.join('')));
  const sameBoardDifferentShape = fixtures[1].regions;
  assert.notEqual(canonicalJigsawSignature(puzzle, regions), canonicalJigsawSignature(puzzle, sameBoardDifferentShape));
});

test('deterministic dataset keeps private answers outside the public five-field contract', async () => {
  const options = { seed: 'jigsaw-unit', countPerTier: 1, maxAttemptsPerPuzzle: 100,
    createdAt: '2026-10-14T00:00:00.000Z' };
  const first = await generateJigsawDataset(options), second = await generateJigsawDataset(options);
  assert.deepEqual(first, second);
  assert.deepEqual(validateJigsawDataset(first.dataset, first.admin, { minPerTier: 1 }).errors, []);
  assert.deepEqual(validateJigsawDataset(first.dataset, null, { minPerTier: 1, clientOnly: true }).errors, []);
  assert.equal(first.admin.puzzles.length, 4);
  for (const record of first.dataset.puzzles) {
    assert.deepEqual(Object.keys(record).sort(), ['difficulty', 'mode', 'puzzle', 'puzzleId', 'regions']);
    assert.equal(record.puzzleId, jigsawPuzzleId(record.puzzle, record.regions));
  }
  assert.equal(Object.keys(first.admin.puzzles[0]).length, 13);
  const tampered = structuredClone(first);
  tampered.dataset.puzzles[0].solution = tampered.admin.puzzles[0].solution;
  tampered.admin.puzzles[0].regions = tampered.admin.puzzles[1].regions;
  const result = validateJigsawDataset(tampered.dataset, tampered.admin, { minPerTier: 1 });
  assert.ok(result.errors.some((error) => error.includes('five public fields')));
  assert.ok(result.errors.some((error) => error.includes('admin regions differs')));
});

test('full validator rejects symmetry duplicates even when IDs and raw strings differ', async () => {
  const generated = await generateJigsawDataset({ seed: 'jigsaw-duplicates', countPerTier: 1 });
  const original = generated.dataset.puzzles[0], copy = structuredClone(original);
  copy.regions = [...copy.regions].map((label) => (Number(label) + 1) % 9).join('');
  copy.puzzle = [...copy.puzzle].map((digit) => digit === '0' ? '0' : Number(digit) % 9 + 1).join('');
  copy.puzzleId = jigsawPuzzleId(copy.puzzle, copy.regions);
  generated.dataset.puzzles.push(copy);
  const result = validateJigsawDataset(generated.dataset, null, { minPerTier: 1, clientOnly: true });
  assert.ok(result.errors.some((error) => error.includes('duplicate under square symmetry')));
});
