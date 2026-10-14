#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  DIFFICULTIES, GENERATOR_VERSION, canonicalJigsawSignature, createSeededRandom,
  countClues, formatClassificationNote, generateJigsawForDifficulty, jigsawPuzzleId,
} from './lib/jigsaw-generator.mjs';

export async function generateJigsawDataset({
  seed = 'sudoku-jigsaw-v1-20261014', countPerTier = 1000, maxAttemptsPerPuzzle = 2000,
  createdAt = new Date().toISOString(), onProgress = () => {},
} = {}) {
  if (!Number.isSafeInteger(countPerTier) || countPerTier < 1) throw new RangeError('countPerTier must be positive');
  if (!Number.isSafeInteger(maxAttemptsPerPuzzle) || maxAttemptsPerPuzzle < 1) throw new RangeError('maxAttemptsPerPuzzle must be positive');
  const puzzles = [], adminPuzzles = [], seenSignatures = new Set();
  for (const difficulty of DIFFICULTIES) {
    const random = createSeededRandom(`${seed}|${difficulty}`), started = Date.now();
    let totalAttempts = 0;
    for (let accepted = 0; accepted < countPerTier; accepted += 1) {
      const result = generateJigsawForDifficulty({ difficulty, random, maxAttempts: maxAttemptsPerPuzzle, seenSignatures });
      const { puzzle, regions, solution, classification } = result;
      totalAttempts += result.attempt;
      const puzzleId = jigsawPuzzleId(puzzle, regions);
      puzzles.push({ puzzleId, difficulty, puzzle, mode: 'jigsaw', regions });
      seenSignatures.add(canonicalJigsawSignature(puzzle, regions));
      adminPuzzles.push({ puzzle_id: puzzleId, difficulty, puzzle, solution,
        difficulty_score: classification.score, seed: String(seed), generator_version: GENERATOR_VERSION,
        enabled: true, daily_eligible: false, created_at: createdAt, validated: true,
        note: formatClassificationNote(classification), regions });
      onProgress({ difficulty, accepted: accepted + 1, requested: countPerTier, attempt: result.attempt,
        totalAttempts, elapsedMs: Date.now() - started, clueCount: countClues(puzzle), score: classification.score });
    }
  }
  return {
    dataset: { schemaVersion: 1, datasetVersion: 1, puzzles },
    admin: { schema_version: 1, dataset_version: 1, generator_version: GENERATOR_VERSION, puzzles: adminPuzzles },
  };
}

function optionsFrom(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === '--help' || flag === '-h') { options.help = true; continue; }
    const value = args[++index];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
    if (flag === '--seed') options.seed = value;
    else if (flag === '--count-per-tier') options.countPerTier = Number(value);
    else if (flag === '--max-attempts-per-puzzle') options.maxAttemptsPerPuzzle = Number(value);
    else if (flag === '--output') options.output = resolve(value);
    else if (flag === '--admin-output') options.adminOutput = resolve(value);
    else throw new Error(`Unknown option ${flag}`);
  }
  return options;
}
async function main() {
  const options = optionsFrom(process.argv.slice(2));
  if (options.help) {
    console.log('Usage: node tools/generate-jigsaw.mjs [--seed VALUE] [--count-per-tier N] [--max-attempts-per-puzzle N] [--output PATH] [--admin-output PATH]');
    return;
  }
  const result = await generateJigsawDataset({ ...options, onProgress: (event) => {
    if (event.accepted === 1 || event.accepted % 25 === 0 || event.accepted === event.requested) console.error(JSON.stringify(event));
  } });
  const datasetPath = options.output ?? resolve('data/puzzles-jigsaw.json');
  const adminPath = options.adminOutput ?? resolve('.local/jigsaw-admin.json');
  await mkdir(resolve(datasetPath, '..'), { recursive: true });
  await mkdir(resolve(adminPath, '..'), { recursive: true });
  await writeFile(datasetPath, `${JSON.stringify(result.dataset, null, 2)}\n`);
  await writeFile(adminPath, `${JSON.stringify(result.admin, null, 2)}\n`);
  console.error(`Wrote ${result.dataset.puzzles.length} jigsaw puzzles and matching private admin records.`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(error.stack ?? error.message); process.exitCode = 1; });
}
