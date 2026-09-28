#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const COLUMNS = [
  'puzzle_id', 'difficulty', 'puzzle', 'solution', 'difficulty_score', 'seed',
  'generator_version', 'enabled', 'daily_eligible', 'created_at', 'validated', 'note',
];

function parseOptions(args) {
  const options = { input: resolve('.local/puzzles-admin.json'), format: 'csv' };
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === '--help' || flag === '-h') {
      options.help = true;
      continue;
    }
    const value = args[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
    if (flag === '--input') options.input = resolve(value);
    else if (flag === '--format') options.format = value;
    else throw new Error(`Unknown option: ${flag}`);
    index += 1;
  }
  if (!options.help && !['csv', 'jsonl'].includes(options.format)) {
    throw new Error('--format must be csv or jsonl');
  }
  return options;
}

function toCsv(value) {
  const serialized = value && typeof value === 'object' ? JSON.stringify(value) : String(value ?? '');
  return `"${serialized.replaceAll('"', '""')}"`;
}

export function exportAdminRecords(admin, format = 'csv') {
  if (!admin || !Array.isArray(admin.puzzles)) throw new Error('Admin data must contain a puzzles array');
  if (!['csv', 'jsonl'].includes(format)) throw new Error('Format must be csv or jsonl');
  if (format === 'jsonl') return admin.puzzles.map((record) => JSON.stringify(record)).join('\n') + '\n';
  const rows = [COLUMNS.map(toCsv).join(',')];
  for (const record of admin.puzzles) rows.push(COLUMNS.map((column) => toCsv(record[column])).join(','));
  return `${rows.join('\r\n')}\r\n`;
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  if (options.help) {
    console.error('Usage: npm run export -- [--input .local/puzzles-admin.json] [--format csv|jsonl]');
    console.error('Writes full snake_case admin records to stdout for spreadsheet import.');
    return;
  }
  const admin = JSON.parse(await readFile(options.input, 'utf8'));
  process.stdout.write(exportAdminRecords(admin, options.format));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.stack ?? error.message);
    process.exitCode = 1;
  });
}
