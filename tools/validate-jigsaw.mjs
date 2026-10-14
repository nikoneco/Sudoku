#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  DIFFICULTIES, GENERATOR_VERSION, canonicalJigsawSignature, classifyJigsawPuzzle,
  countClues, formatClassificationNote, irregularRegionCount, isValidJigsawRegions,
  jigsawPuzzleId, parsePuzzle, shapeSignature, solveJigsawNakedSingles,
} from './lib/jigsaw-generator.mjs';

const CLIENT_FIELDS = ['puzzleId', 'difficulty', 'puzzle', 'mode', 'regions'];
const ADMIN_FIELDS = ['puzzle_id', 'difficulty', 'puzzle', 'solution', 'difficulty_score', 'seed',
  'generator_version', 'enabled', 'daily_eligible', 'created_at', 'validated', 'note', 'regions'];
function exactFields(record, fields) {
  return record && typeof record === 'object' && !Array.isArray(record) &&
    Object.keys(record).sort().join('|') === [...fields].sort().join('|');
}

/** Independent Algorithm X / dancing-links counter. No generator search or client engine is used. */
export function countSolutionsExactCover(puzzle, regions, limit = 2) {
  const board = parsePuzzle(puzzle);
  if (!isValidJigsawRegions(regions)) throw new TypeError('Invalid regions');
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError('limit must be positive');
  const left = [], right = [], up = [], down = [], column = [], size = [];
  for (let col = 0; col <= 324; col += 1) {
    left[col] = col - 1; right[col] = col + 1; up[col] = col; down[col] = col; size[col] = 0;
  }
  left[0] = 324; right[324] = 0;
  for (let cell = 0; cell < 81; cell += 1) for (let digit = 1; digit <= 9; digit += 1) {
    if (board[cell] && board[cell] !== digit) continue;
    const row = Math.floor(cell / 9), col = cell % 9, region = Number(regions[cell]), n = digit - 1;
    const constraints = [cell + 1, 82 + row * 9 + n, 163 + col * 9 + n, 244 + region * 9 + n];
    const first = left.length;
    for (let offset = 0; offset < 4; offset += 1) {
      const node = left.length, header = constraints[offset];
      left[node] = offset === 0 ? first + 3 : node - 1;
      right[node] = offset === 3 ? first : node + 1;
      up[node] = up[header]; down[node] = header;
      down[up[header]] = node; up[header] = node;
      column[node] = header; size[header] += 1;
    }
  }
  function cover(header) {
    right[left[header]] = right[header]; left[right[header]] = left[header];
    for (let row = down[header]; row !== header; row = down[row]) {
      for (let node = right[row]; node !== row; node = right[node]) {
        down[up[node]] = down[node]; up[down[node]] = up[node]; size[column[node]] -= 1;
      }
    }
  }
  function uncover(header) {
    for (let row = up[header]; row !== header; row = up[row]) {
      for (let node = left[row]; node !== row; node = left[node]) {
        size[column[node]] += 1; down[up[node]] = node; up[down[node]] = node;
      }
    }
    right[left[header]] = header; left[right[header]] = header;
  }
  let solutions = 0;
  function search() {
    if (!right[0]) { solutions += 1; return; }
    let chosen = right[0];
    for (let header = right[chosen]; header; header = right[header]) {
      if (size[header] < size[chosen]) chosen = header;
      if (!size[chosen]) return;
    }
    cover(chosen);
    for (let row = down[chosen]; row !== chosen && solutions < limit; row = down[row]) {
      for (let node = right[row]; node !== row; node = right[node]) cover(column[node]);
      search();
      for (let node = left[row]; node !== row; node = left[node]) uncover(column[node]);
    }
    uncover(chosen);
  }
  search();
  return solutions;
}

export function validateJigsawDataset(dataset, admin, { minPerTier = 1000, clientOnly = false, onProgress = () => {} } = {}) {
  const started = Date.now(), errors = [], counts = Object.fromEntries(DIFFICULTIES.map((tier) => [tier, 0]));
  const check = (condition, message) => { if (!condition) errors.push(message); };
  check(exactFields(dataset, ['schemaVersion', 'datasetVersion', 'puzzles']), 'Client dataset must contain only schemaVersion, datasetVersion, puzzles');
  check(dataset?.schemaVersion === 1, 'Client schemaVersion must be 1');
  check(dataset?.datasetVersion === 1, 'Client datasetVersion must be 1');
  check(Array.isArray(dataset?.puzzles), 'Client puzzles must be an array');
  if (!clientOnly) {
    check(admin?.schema_version === 1, 'Admin schema_version must be 1');
    check(admin?.dataset_version === dataset?.datasetVersion, 'Admin dataset_version differs');
    check(admin?.generator_version === GENERATOR_VERSION, 'Admin generator_version differs');
    check(Array.isArray(admin?.puzzles), 'Admin puzzles must be an array');
  }
  if (!Array.isArray(dataset?.puzzles) || (!clientOnly && !Array.isArray(admin?.puzzles))) return { errors, counts, elapsedMs: Date.now() - started };
  const ids = new Set(), signatures = new Set(), shapes = new Set(), adminById = new Map();
  let minimumIrregularRegions = 9;
  if (!clientOnly) {
    check(admin.puzzles.length === dataset.puzzles.length, 'Client/admin record counts differ');
    for (const record of admin.puzzles) {
      check(exactFields(record, ADMIN_FIELDS), 'Admin record must contain exactly the 13 Sheets fields');
      if (!record || typeof record !== 'object') continue;
      check(!adminById.has(record.puzzle_id), `Duplicate admin ID ${record.puzzle_id}`);
      adminById.set(record.puzzle_id, record);
    }
  }
  for (let index = 0; index < dataset.puzzles.length; index += 1) {
    const record = dataset.puzzles[index], location = `puzzles[${index}]`;
    try {
      check(exactFields(record, CLIENT_FIELDS), `${location}: client must contain exactly the five public fields`);
      if (!record || typeof record !== 'object') continue;
      check(record.mode === 'jigsaw', `${location}: mode must be jigsaw`);
      check(DIFFICULTIES.includes(record.difficulty), `${location}: unsupported difficulty`);
      if (counts[record.difficulty] !== undefined) counts[record.difficulty] += 1;
      parsePuzzle(record.puzzle);
      if (!isValidJigsawRegions(record.regions)) throw new Error('Regions must be nine orthogonally connected groups of nine');
      const irregular = irregularRegionCount(record.regions);
      check(irregular >= 7, `${location}: fewer than seven genuinely irregular regions`);
      minimumIrregularRegions = Math.min(minimumIrregularRegions, irregular);
      shapes.add(shapeSignature(record.regions));
      check(countClues(record.puzzle) > 0 && countClues(record.puzzle) < 81, `${location}: must contain givens and blanks`);
      check(record.puzzleId === jigsawPuzzleId(record.puzzle, record.regions), `${location}: ID does not match puzzle and regions`);
      check(!ids.has(record.puzzleId), `${location}: duplicate ID`); ids.add(record.puzzleId);
      const signature = canonicalJigsawSignature(record.puzzle, record.regions);
      check(!signatures.has(signature), `${location}: duplicate under square symmetry, digit and region relabeling`); signatures.add(signature);
      const solutions = countSolutionsExactCover(record.puzzle, record.regions);
      check(solutions === 1, `${location}: expected one solution, found ${solutions}`);
      const naked = solveJigsawNakedSingles(record.puzzle, record.regions);
      check(!naked.contradiction && !naked.solved, `${location}: invalid or solved initial naked closure`);
      const classification = classifyJigsawPuzzle(record.puzzle, record.regions);
      check(classification.difficulty === record.difficulty, `${location}: stored ${record.difficulty}, classified ${classification.difficulty}`);
      if (!clientOnly) {
        const privateRecord = adminById.get(record.puzzleId);
        check(Boolean(privateRecord), `${location}: missing admin record`);
        if (privateRecord) {
          for (const field of ['difficulty', 'puzzle', 'regions']) check(privateRecord[field] === record[field], `${location}: admin ${field} differs`);
          check(privateRecord.difficulty_score === classification.score, `${location}: admin score differs`);
          check(privateRecord.note === formatClassificationNote(classification), `${location}: admin technique note differs`);
          check(privateRecord.enabled === true && privateRecord.validated === true && privateRecord.daily_eligible === false, `${location}: invalid administrative flags`);
          check(privateRecord.generator_version === GENERATOR_VERSION, `${location}: wrong generator_version`);
          check(typeof privateRecord.seed === 'string' && privateRecord.seed.length > 0, `${location}: missing generation seed`);
          check(typeof privateRecord.created_at === 'string' && Number.isFinite(Date.parse(privateRecord.created_at)), `${location}: invalid created_at`);
          const solution = parsePuzzle(privateRecord.solution);
          check(solution.every(Boolean), `${location}: solution contains blanks`);
          check(solution.every((digit, cell) => record.puzzle[cell] === '0' || Number(record.puzzle[cell]) === digit), `${location}: solution conflicts with a given`);
          check(countSolutionsExactCover(privateRecord.solution, record.regions) === 1, `${location}: invalid completed solution`);
        }
      }
    } catch (error) { errors.push(`${location}: ${error.message}`); }
    if ((index + 1) % 100 === 0 || index + 1 === dataset.puzzles.length) onProgress({ checked: index + 1, total: dataset.puzzles.length, errors: errors.length });
  }
  for (const difficulty of DIFFICULTIES) check(counts[difficulty] >= minPerTier, `${difficulty}: expected at least ${minPerTier}, found ${counts[difficulty]}`);
  return { errors, counts, checked: dataset.puzzles.length, uniqueShapes: shapes.size, minimumIrregularRegions, elapsedMs: Date.now() - started };
}

function optionsFrom(args) {
  const options = { dataset: resolve('data/puzzles-jigsaw.json'), admin: resolve('.local/jigsaw-admin.json'), minPerTier: 1000 };
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === '--help' || flag === '-h') { options.help = true; continue; }
    if (flag === '--client-only') { options.clientOnly = true; continue; }
    const value = args[++index];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
    if (flag === '--dataset') options.dataset = resolve(value);
    else if (flag === '--admin') options.admin = resolve(value);
    else if (flag === '--report') options.report = resolve(value);
    else if (flag === '--min-per-tier') options.minPerTier = Number(value);
    else throw new Error(`Unknown option ${flag}`);
  }
  if (!Number.isSafeInteger(options.minPerTier) || options.minPerTier < 0) throw new RangeError('--min-per-tier must be a nonnegative integer');
  return options;
}
async function main() {
  const options = optionsFrom(process.argv.slice(2));
  if (options.help) {
    console.log('Usage: node tools/validate-jigsaw.mjs [--client-only] [--min-per-tier N] [--dataset PATH] [--admin PATH] [--report PATH]');
    return;
  }
  const dataset = JSON.parse(await readFile(options.dataset, 'utf8'));
  const admin = options.clientOnly ? null : JSON.parse(await readFile(options.admin, 'utf8'));
  const result = validateJigsawDataset(dataset, admin, { ...options, onProgress: (event) => console.error(JSON.stringify(event)) });
  if (options.report) await writeFile(options.report, `${JSON.stringify({ ...result, clientOnly: Boolean(options.clientOnly), validatedAt: new Date().toISOString() }, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
  if (result.errors.length) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(error.stack ?? error.message); process.exitCode = 1; });
}
