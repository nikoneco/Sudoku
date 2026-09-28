#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import {
  DIFFICULTIES,
  canonicalPuzzleSignature,
  classifyPuzzle,
  countClues,
  countSolutions,
  formatClassificationNote,
  parsePuzzle,
  puzzleIdFor,
  solveNakedSingles,
} from './lib/generator.mjs';

const CLIENT_FIELDS = ['puzzleId', 'difficulty', 'puzzle'];
const ADMIN_FIELDS = [
  'puzzle_id', 'difficulty', 'puzzle', 'solution', 'difficulty_score', 'seed',
  'generator_version', 'enabled', 'daily_eligible', 'created_at', 'validated', 'note',
];

function hasExactFields(record, expected) {
  return record && typeof record === 'object' && !Array.isArray(record) &&
    JSON.stringify(Object.keys(record).sort()) === JSON.stringify([...expected].sort());
}

function parseOptions(args) {
  const options = {
    dataset: resolve('data/puzzles.json'),
    admin: resolve('.local/puzzles-admin.json'),
    minPerTier: 500,
    clientOnly: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === '--help' || flag === '-h') {
      options.help = true;
      continue;
    }
    if (flag === '--client-only') {
      options.clientOnly = true;
      continue;
    }
    const value = args[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
    if (flag === '--dataset') options.dataset = resolve(value);
    else if (flag === '--admin') options.admin = resolve(value);
    else if (flag === '--min-per-tier') options.minPerTier = Number(value);
    else throw new Error(`Unknown option: ${flag}`);
    index += 1;
  }
  if (!options.help && (!Number.isInteger(options.minPerTier) || options.minPerTier < 0)) {
    throw new Error('--min-per-tier must be a non-negative integer');
  }
  return options;
}

function requireCondition(condition, message, errors) {
  if (!condition) errors.push(message);
}

export function validateDataset(dataset, admin, {
  minPerTier = 500,
  onProgress = () => {},
  clientOnly = false,
} = {}) {
  const errors = [];
  requireCondition(dataset?.schemaVersion === 1, 'Client schemaVersion must be 1', errors);
  requireCondition(Number.isSafeInteger(dataset?.datasetVersion) && dataset.datasetVersion >= 1,
    'Client datasetVersion must be a positive integer', errors);
  requireCondition(Array.isArray(dataset?.puzzles), 'Client dataset must contain a puzzles array', errors);
  if (!clientOnly) {
    requireCondition(admin?.schema_version === 1, 'Admin schema_version must be 1', errors);
    requireCondition(admin?.dataset_version === dataset?.datasetVersion,
      'Admin dataset_version must match the client dataset', errors);
    requireCondition(Array.isArray(admin?.puzzles), 'Admin data must contain a puzzles array', errors);
  }
  if (!Array.isArray(dataset?.puzzles) || (!clientOnly && !Array.isArray(admin?.puzzles))) {
    return { errors, counts: Object.fromEntries(DIFFICULTIES.map((difficulty) => [difficulty, 0])) };
  }

  const counts = Object.fromEntries(DIFFICULTIES.map((difficulty) => [difficulty, 0]));
  const ids = new Set();
  const signatures = new Set();
  const adminById = new Map();
  if (!clientOnly) {
    for (const record of admin.puzzles) {
      requireCondition(hasExactFields(record, ADMIN_FIELDS),
        `Admin record must contain exactly the 12 Sheets fields`, errors);
      if (adminById.has(record.puzzle_id)) errors.push(`Duplicate admin puzzle_id ${record.puzzle_id}`);
      adminById.set(record.puzzle_id, record);
    }
    requireCondition(admin.puzzles.length === dataset.puzzles.length,
      `Client/admin record counts differ (${dataset.puzzles.length}/${admin.puzzles.length})`, errors);
  }

  for (let index = 0; index < dataset.puzzles.length; index += 1) {
    const record = dataset.puzzles[index];
    const location = `puzzles[${index}]`;
    try {
      requireCondition(hasExactFields(record, CLIENT_FIELDS),
        `${location}: client record must contain only puzzleId, difficulty, and puzzle`, errors);
      requireCondition(typeof record.puzzleId === 'string' && record.puzzleId.length > 0,
        `${location}: missing puzzleId`, errors);
      requireCondition(DIFFICULTIES.includes(record.difficulty),
        `${location}: unsupported difficulty ${record.difficulty}`, errors);
      if (counts[record.difficulty] !== undefined) counts[record.difficulty] += 1;
      const board = parsePuzzle(record.puzzle);
      requireCondition(countClues(record.puzzle) >= 17 && countClues(record.puzzle) <= 80,
        `${location}: clue count outside 17-80`, errors);
      if (ids.has(record.puzzleId)) errors.push(`${location}: duplicate puzzleId ${record.puzzleId}`);
      ids.add(record.puzzleId);
      requireCondition(record.puzzleId === puzzleIdFor(record.puzzle),
        `${location}: puzzleId does not match the puzzle contents`, errors);
      const signature = canonicalPuzzleSignature(board);
      if (signatures.has(signature)) errors.push(`${location}: puzzle duplicates a prior rotation/reflection/digit relabeling`);
      signatures.add(signature);

      const uniqueCount = countSolutions(board, 2);
      requireCondition(uniqueCount === 1, `${location}: expected exactly one solution, found ${uniqueCount}`, errors);
      const naked = solveNakedSingles(board);
      requireCondition(!naked.solved, `${location}: naked singles solve the puzzle at game start`, errors);
      const classification = classifyPuzzle(board);
      requireCondition(classification.difficulty === record.difficulty,
        `${location}: classified as ${classification.difficulty}, stored as ${record.difficulty}`, errors);

      const adminRecord = clientOnly ? null : adminById.get(record.puzzleId);
      if (!clientOnly) requireCondition(Boolean(adminRecord), `${location}: missing admin record`, errors);
      if (adminRecord) {
        requireCondition(adminRecord.puzzle === record.puzzle, `${location}: admin puzzle differs`, errors);
        requireCondition(adminRecord.difficulty === record.difficulty, `${location}: admin difficulty differs`, errors);
        requireCondition(adminRecord.difficulty_score === classification.score,
          `${location}: admin difficulty_score differs`, errors);
        requireCondition(adminRecord.enabled === true,
          `${location}: admin enabled must be true`, errors);
        requireCondition(adminRecord.daily_eligible === false,
          `${location}: daily_eligible must be false until separately approved`, errors);
        requireCondition(adminRecord.validated === true, `${location}: admin validated must be true`, errors);
        requireCondition(adminRecord.note === formatClassificationNote(classification),
          `${location}: admin note does not match the technique classification`, errors);
        const solution = parsePuzzle(adminRecord.solution);
        requireCondition(solution.every(Boolean), `${location}: admin solution contains blanks`, errors);
        requireCondition(solution.every((digit, cell) => !board[cell] || board[cell] === digit),
          `${location}: admin solution conflicts with a given`, errors);
        requireCondition(countSolutions(solution, 2) === 1,
          `${location}: admin solution is not a valid completed grid`, errors);
      }
    } catch (error) {
      errors.push(`${location}: ${error.message}`);
    }
    if ((index + 1) % 100 === 0 || index + 1 === dataset.puzzles.length) {
      onProgress({ checked: index + 1, total: dataset.puzzles.length, counts: { ...counts }, errors: errors.length });
    }
  }

  for (const difficulty of DIFFICULTIES) {
    requireCondition(counts[difficulty] >= minPerTier,
      `${difficulty}: expected at least ${minPerTier} puzzles, found ${counts[difficulty]}`, errors);
  }
  return { errors, counts };
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  if (options.help) {
    console.log('Usage: npm run validate -- [--client-only] [--min-per-tier N] [--dataset data/puzzles.json] [--admin .local/puzzles-admin.json]');
    console.log('The default checks 500 puzzles per tier and includes private admin records; use --client-only in a fresh checkout.');
    return;
  }
  const dataset = JSON.parse(await readFile(options.dataset, 'utf8'));
  const admin = options.clientOnly ? null : JSON.parse(await readFile(options.admin, 'utf8'));
  const result = validateDataset(dataset, admin, {
    minPerTier: options.minPerTier,
    clientOnly: options.clientOnly,
    onProgress: (event) => console.error(`Validated ${event.checked}/${event.total}; errors: ${event.errors}`),
  });
  console.log(`Counts: ${DIFFICULTIES.map((difficulty) => `${difficulty}=${result.counts[difficulty]}`).join(', ')}`);
  if (result.errors.length) {
    for (const error of result.errors.slice(0, 100)) console.error(`ERROR: ${error}`);
    if (result.errors.length > 100) console.error(`... ${result.errors.length - 100} additional errors`);
    console.error(`Validation failed with ${result.errors.length} error(s).`);
    process.exitCode = 1;
  } else {
    console.log(options.clientOnly
      ? 'Validation passed: initial naked-single closure, givens, uniqueness, and technique classification.'
      : 'Validation passed: client/admin alignment, initial naked-single closure, givens, solutions, uniqueness, and technique classification.');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.stack ?? error.message);
    process.exitCode = 1;
  });
}
