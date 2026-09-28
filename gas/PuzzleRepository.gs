/** Keep the spreadsheet identifier only in Script Properties. */
function readDataset_() {
  var id = PropertiesService.getScriptProperties().getProperty('SUDOKU_SPREADSHEET_ID');
  if (!id) throw new Error('Missing dataset configuration');
  // SpreadsheetApp.openById requires write scope even for reading. Advanced
  // Sheets Values API works with the explicitly granted readonly scope.
  var response = Sheets.Spreadsheets.Values.batchGet(id, {
    ranges: ['Config!A:B', 'Puzzles!A:L'], valueRenderOption: 'UNFORMATTED_VALUE'
  });
  var ranges = response.valueRanges || [];
  if (ranges.length !== 2) throw new Error('Missing dataset sheets');
  var config = {};
  (ranges[0].values || []).forEach(function(row) { config[row[0]] = row[1]; });
  var version = Number(config.dataset_version);
  if (Number(config.schema_version) !== 1 || !Number.isInteger(version) || version < 1) throw new Error('Unsupported dataset');
  var rows = ranges[1].values || [];
  if (!rows.length) throw new Error('Missing puzzles');
  var header = rows.shift();
  var column = {};
  header.forEach(function(name, i) { column[name] = i; });
  ['puzzle_id', 'difficulty', 'puzzle', 'enabled', 'validated'].forEach(function(name) { if (column[name] === undefined) throw new Error('Missing column'); });
  var counts = { '初級': 0, '中級': 0, '上級': 0, '超上級': 0 };
  var seen = {};
  var puzzles = [];
  rows.forEach(function(row) {
    if (row[column.enabled] !== true || row[column.validated] !== true) return;
    var puzzleId = String(row[column.puzzle_id]);
    var difficulty = String(row[column.difficulty]);
    var puzzle = String(row[column.puzzle]);
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(puzzleId) || !Object.prototype.hasOwnProperty.call(counts, difficulty) || !/^[0-9]{81}$/.test(puzzle) || seen[puzzleId]) return;
    seen[puzzleId] = true;
    counts[difficulty]++;
    puzzles.push({ puzzleId: puzzleId, difficulty: difficulty, puzzle: puzzle });
  });
  if (Object.keys(counts).some(function(tier) { return counts[tier] === 0; })) throw new Error('Missing difficulty');
  return { datasetVersion: version, counts: counts, puzzles: puzzles };
}
