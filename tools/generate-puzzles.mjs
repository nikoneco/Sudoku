#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import {
  DIFFICULTIES,
  GENERATOR_VERSION,
  canonicalPuzzleSignature,
  countClues,
  createSeededRandom,
  generatePuzzleForDifficulty,
  formatClassificationNote,
  puzzleIdFor,
} from './lib/generator.mjs';

const DEFAULT_SEED = 'sudoku-v1-seed-2026';

function readOptions(args) {
  const options = { seed: DEFAULT_SEED, countPerTier: 30, maxAttempts: 2_000 };
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === '--help' || flag === '-h') {
      options.help = true;
      continue;
    }
    const value = args[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
    if (flag === '--seed') options.seed = value;
    else if (flag === '--count-per-tier') options.countPerTier = Number(value);
    else if (flag === '--max-attempts-per-puzzle') options.maxAttempts = Number(value);
    else if (flag === '--output') options.output = resolve(value);
    else if (flag === '--admin-output') options.adminOutput = resolve(value);
    else throw new Error(`Unknown option: ${flag}`);
    index += 1;
  }
  if (!options.help && (!Number.isInteger(options.countPerTier) || options.countPerTier < 1)) {
    throw new Error('--count-per-tier must be a positive integer');
  }
  if (!options.help && (!Number.isInteger(options.maxAttempts) || options.maxAttempts < 1)) {
    throw new Error('--max-attempts-per-puzzle must be a positive integer');
  }
  return options;
}

export async function generateDataset({
  seed = DEFAULT_SEED,
  countPerTier = 30,
  maxAttemptsPerPuzzle = 2_000,
  onProgress = () => {},
  createdAt = new Date().toISOString(),
} = {}) {
  const puzzles = [];
  const adminPuzzles = [];
  const seenSignatures = new Set();
  for (const difficulty of DIFFICULTIES) {
    const random = createSeededRandom(`${seed}|${difficulty}`);
    const tierStarted = Date.now();
    onProgress({ type: 'tier-start', difficulty, count: countPerTier });
    while (adminPuzzles.filter((record) => record.difficulty === difficulty).length < countPerTier) {
      const acceptedInTier = adminPuzzles.filter((record) => record.difficulty === difficulty).length;
      let lastProgressAttempt = 0;
      const generated = generatePuzzleForDifficulty({
        difficulty,
        random,
        maxAttempts: maxAttemptsPerPuzzle,
        seenSignatures,
        onAttempt: ({ attempt }) => {
          if (attempt === 1 || attempt - lastProgressAttempt >= 25) {
            lastProgressAttempt = attempt;
            onProgress({
              type: 'search-progress', difficulty, accepted: acceptedInTier,
              requested: countPerTier, attempt, elapsedMs: Date.now() - tierStarted,
            });
          }
        },
      });
      const puzzleId = puzzleIdFor(generated.puzzle);
      const puzzleRecord = {
        puzzleId,
        difficulty,
        puzzle: generated.puzzle,
      };
      puzzles.push(puzzleRecord);
      seenSignatures.add(canonicalPuzzleSignature(generated.puzzle));
      adminPuzzles.push({
        puzzle_id: puzzleId,
        difficulty,
        puzzle: generated.puzzle,
        solution: generated.solution,
        difficulty_score: generated.classification.score,
        seed: String(seed),
        generator_version: GENERATOR_VERSION,
        enabled: true,
        daily_eligible: false,
        validated: true,
        created_at: createdAt,
        note: formatClassificationNote(generated.classification),
      });
      onProgress({
        type: 'accepted', difficulty, accepted: acceptedInTier + 1,
        requested: countPerTier, attempt: generated.attempt,
        clueCount: countClues(generated.puzzle), score: generated.classification.score,
        elapsedMs: Date.now() - tierStarted,
      });
    }
  }
  return {
    dataset: { schemaVersion: 1, datasetVersion: 1, puzzles },
    admin: { schema_version: 1, dataset_version: 1, generator_version: GENERATOR_VERSION, puzzles: adminPuzzles },
  };
}

function showProgress(event) {
  if (event.type === 'tier-start') {
    console.error(`\n[${event.difficulty}] generating ${event.count} puzzles`);
  } else if (event.type === 'search-progress') {
    console.error(`[${event.difficulty}] accepted ${event.accepted}/${event.requested}; attempt ${event.attempt}; ${Math.round(event.elapsedMs / 1000)}s`);
  } else {
    console.error(`[${event.difficulty}] ${event.accepted}/${event.requested}; ${event.clueCount} clues; score ${event.score}; attempt ${event.attempt}; ${Math.round(event.elapsedMs / 1000)}s`);
  }
}

async function main() {
  const options = readOptions(process.argv.slice(2));
  if (options.help) {
    console.log('Usage: npm run generate -- [--seed VALUE] [--count-per-tier N] [--max-attempts-per-puzzle N] [--output PATH] [--admin-output PATH]');
    console.log('Defaults generate 30 puzzles per Japanese tier using a deterministic seed. Use --count-per-tier 500 for the full dataset.');
    return;
  }
  const generated = await generateDataset({
    seed: options.seed,
    countPerTier: options.countPerTier,
    maxAttemptsPerPuzzle: options.maxAttempts,
    onProgress: showProgress,
  });
  const datasetPath = options.output ?? resolve('data/puzzles.json');
  const adminPath = options.adminOutput ?? resolve('.local/puzzles-admin.json');
  await mkdir(resolve(datasetPath, '..'), { recursive: true });
  await mkdir(resolve(adminPath, '..'), { recursive: true });
  await writeFile(datasetPath, `${JSON.stringify(generated.dataset, null, 2)}\n`, 'utf8');
  await writeFile(adminPath, `${JSON.stringify(generated.admin, null, 2)}\n`, 'utf8');
  console.error(`Wrote ${generated.dataset.puzzles.length} client puzzles to ${datasetPath}`);
  console.error(`Wrote ${generated.admin.puzzles.length} admin records to ${adminPath}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.stack ?? error.message);
    process.exitCode = 1;
  });
}
