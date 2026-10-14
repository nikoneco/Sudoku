import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const code = readFileSync(new URL('../gas/Code.gs', import.meta.url), 'utf8');
function api() {
  const scope = { console, ContentService: { MimeType: { JSON: 'json', JAVASCRIPT: 'js' }, createTextOutput(text) { return { text, setMimeType(type) { this.type = type; return this; } }; } }, readDataset_: () => ({ datasetVersion: 1, counts: { '初級': 500 }, puzzles: [{ puzzleId: 'p1', difficulty: '初級', puzzle: '0'.repeat(81) }] }) };
  vm.createContext(scope); vm.runInContext(code, scope); return scope;
}
test('GAS whitelist denies writes and unknown actions; health exposes no config', () => {
  const scope = api();
  for (const action of ['delete', 'setup', 'import', 'admin', 'toString', '__proto__']) assert.equal(JSON.parse(scope.doGet({ parameter: { action } }).text).error, 'UNKNOWN_ACTION');
  assert.equal(JSON.parse(scope.doPost().text).error, 'READ_ONLY');
  assert.equal(JSON.parse(scope.doGet({ parameter: {} }).text).ok, true);
});
test('GAS sync version and JSONP callback allowlist', () => {
  const scope = api();
  assert.equal(JSON.parse(scope.doGet({ parameter: { action: 'sync', version: '1' } }).text).unchanged, true);
  assert.match(scope.doGet({ parameter: { action: 'meta', callback: 'sudoku_abc123' } }).text, /^sudoku_abc123\(/);
  assert.equal(JSON.parse(scope.doGet({ parameter: { callback: 'alert(1)' } }).text).error, 'INVALID_CALLBACK');
  assert.equal(scope.doGet({ parameter: { action: 'puzzles' } }).text.includes('solution'), false);
});

test('GAS repository uses read-only Sheets API and drops disabled rows and private fields', () => {
  const scope = api();
  scope.PropertiesService = { getScriptProperties: () => ({ getProperty: () => 'test-id' }) };
  scope.Sheets = { Spreadsheets: { Values: { batchGet(id, options) {
    assert.equal(id, 'test-id'); assert.equal(options.valueRenderOption, 'UNFORMATTED_VALUE');
    return { valueRanges: [ { values: [['schema_version', 1], ['dataset_version', 2]] }, { values: [
      ['puzzle_id', 'difficulty', 'puzzle', 'enabled', 'validated', 'solution'],
      ...['初級','中級','上級','超上級'].map((d,i) => ['p'+i,d,'0'.repeat(81),true,true,'PRIVATE']),
      ['disabled','初級','0'.repeat(81),false,true,'PRIVATE']
    ] } ] };
  } } } };
  vm.runInContext(readFileSync(new URL('../gas/PuzzleRepository.gs', import.meta.url), 'utf8'), scope);
  const result = scope.readDataset_();
  assert.equal(result.datasetVersion, 2); assert.equal(result.puzzles.length, 4);
  assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
  assert.deepEqual(Object.keys(result.puzzles[0]).sort(), ['difficulty','puzzle','puzzleId']);
});

test('GAS jigsaw mode reads only Config and Puzzles_Jigsaw with public region metadata', () => {
  const scope = api();
  const regions = Array.from({ length: 81 }, (_, i) => String(Math.floor(i / 27) * 3 + Math.floor(i % 9 / 3))).join('');
  scope.PropertiesService = { getScriptProperties: () => ({ getProperty: () => 'test-id' }) };
  scope.Sheets = { Spreadsheets: { Values: { batchGet(_id, options) {
    assert.deepEqual(Array.from(options.ranges), ['Config!A:B', 'Puzzles_Jigsaw!A:M']);
    return { valueRanges: [{ values: [['schema_version', 1], ['dataset_version', 2], ['jigsaw_dataset_version', 3]] }, { values: [
      ['puzzle_id', 'difficulty', 'puzzle', 'enabled', 'validated', 'solution', 'regions'],
      ...['初級','中級','上級','超上級'].map((difficulty, i) => [`jigsaw_${i}`,difficulty,'1'+'0'.repeat(80),true,true,'PRIVATE',regions]),
      ['jigsaw_bad','初級','1'+'0'.repeat(80),true,true,'PRIVATE','0'.repeat(81)],
    ] }] };
  } } } };
  vm.runInContext(readFileSync(new URL('../gas/PuzzleRepository.gs', import.meta.url), 'utf8'), scope);
  const result = scope.readDataset_('jigsaw');
  assert.equal(result.datasetVersion, 3);
  assert.equal(result.puzzles.length, 4);
  assert.deepEqual(Object.keys(result.puzzles[0]).sort(), ['difficulty','mode','puzzle','puzzleId','regions']);
  assert.equal(result.puzzles[0].regions, regions);
  assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
  assert.equal(JSON.parse(scope.doGet({ parameter: { action: 'puzzles', mode: 'unknown' } }).text).error, 'INVALID_MODE');
  assert.throws(() => scope.readDataset_('unknown'));
});
