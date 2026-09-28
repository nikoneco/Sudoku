import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalPuzzleSignature,
  countSolutions,
  createSeededRandom,
  generatePuzzleForDifficulty,
  generateSolvedGrid,
  parsePuzzle,
  puzzleString,
  solveNakedSingles,
} from '../tools/lib/generator.mjs';
import { exportAdminRecords } from '../tools/export-puzzles.mjs';

test('seeded solved-grid generation is reproducible and yields one valid completed grid', () => {
  const first = generateSolvedGrid(createSeededRandom('repeatable-seed'));
  const second = generateSolvedGrid(createSeededRandom('repeatable-seed'));
  assert.deepEqual(first, second);
  assert.equal(countSolutions(first), 1);
  assert.ok(first.every((digit) => digit >= 1 && digit <= 9));
});

test('independent solution counter distinguishes invalid, ambiguous, and unique boards', () => {
  assert.equal(countSolutions('0'.repeat(81), 2), 2);
  const solution = generateSolvedGrid(createSeededRandom('solution-counter'));
  assert.equal(countSolutions(solution), 1);
  const conflict = [...solution];
  conflict[1] = conflict[0];
  assert.equal(countSolutions(conflict), 0);
});

test('canonical signatures remove digit labels and the eight square symmetries', () => {
  const solved = generateSolvedGrid(createSeededRandom('symmetry'));
  const puzzle = solved.map((digit, index) => index % 4 === 0 ? 0 : digit);
  const transformed = Array(81).fill(0);
  for (let row = 0; row < 9; row += 1) {
    for (let col = 0; col < 9; col += 1) {
      const digit = puzzle[row * 9 + col];
      transformed[col * 9 + (8 - row)] = digit ? (digit % 9) + 1 : 0;
    }
  }
  assert.equal(canonicalPuzzleSignature(puzzle), canonicalPuzzleSignature(transformed));
});

test('difficulty generation is deterministic and does not start solved by naked singles', () => {
  const first = generatePuzzleForDifficulty({
    difficulty: '初級', random: createSeededRandom('beginner-repro'), maxAttempts: 500,
  });
  const second = generatePuzzleForDifficulty({
    difficulty: '初級', random: createSeededRandom('beginner-repro'), maxAttempts: 500,
  });
  assert.equal(first.puzzle, second.puzzle);
  assert.equal(first.solution, second.solution);
  assert.equal(countSolutions(first.puzzle), 1);
  assert.equal(solveNakedSingles(first.puzzle).solved, false);
  assert.equal(puzzleString(parsePuzzle(first.puzzle)), first.puzzle);
});

test('admin export matches the confirmed 12-column Sheets contract', () => {
  const record = {
    puzzle_id: 'puz_example', difficulty: '初級', puzzle: '0'.repeat(81),
    solution: '1'.repeat(81), difficulty_score: 201, seed: 'seed',
    generator_version: '1.0.0', enabled: true, daily_eligible: false,
    created_at: '2026-09-29T00:00:00.000Z', validated: true, note: 'classification',
  };
  const csv = exportAdminRecords({ puzzles: [record] }, 'csv').split('\r\n');
  assert.equal(csv[0], '"puzzle_id","difficulty","puzzle","solution","difficulty_score","seed","generator_version","enabled","daily_eligible","created_at","validated","note"');
  assert.equal(csv.length, 3);
  assert.deepEqual(JSON.parse(exportAdminRecords({ puzzles: [record] }, 'jsonl')), record);
});
