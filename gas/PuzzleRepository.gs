/** Keep the spreadsheet identifier only in Script Properties. */
function readDataset_(mode) {
  mode = mode || 'normal';
  if (['normal', 'jigsaw'].indexOf(mode) < 0) throw new Error('Invalid mode');
  var id = PropertiesService.getScriptProperties().getProperty('SUDOKU_SPREADSHEET_ID');
  if (!id) throw new Error('Missing dataset configuration');
  // SpreadsheetApp.openById requires write scope even for reading. Advanced
  // Sheets Values API works with the explicitly granted readonly scope.
  var response = Sheets.Spreadsheets.Values.batchGet(id, {
    ranges: ['Config!A:B', mode === 'jigsaw' ? 'Puzzles_Jigsaw!A:M' : 'Puzzles!A:L'], valueRenderOption: 'UNFORMATTED_VALUE'
  });
  var ranges = response.valueRanges || [];
  if (ranges.length !== 2) throw new Error('Missing dataset sheets');
  var config = {};
  (ranges[0].values || []).forEach(function(row) { config[row[0]] = row[1]; });
  var version = Number(mode === 'jigsaw' ? (config.jigsaw_dataset_version || 1) : config.dataset_version);
  if (Number(config.schema_version) !== 1 || !Number.isInteger(version) || version < 1) throw new Error('Unsupported dataset');
  var rows = ranges[1].values || [];
  if (!rows.length) throw new Error('Missing puzzles');
  var header = rows.shift();
  var column = {};
  header.forEach(function(name, i) { column[name] = i; });
  ['puzzle_id', 'difficulty', 'puzzle', 'enabled', 'validated'].forEach(function(name) { if (column[name] === undefined) throw new Error('Missing column'); });
  if (mode === 'jigsaw' && column.regions === undefined) throw new Error('Missing regions');
  var counts = { '初級': 0, '中級': 0, '上級': 0, '超上級': 0 };
  var seen = {};
  var puzzles = [];
  rows.forEach(function(row) {
    if (row[column.enabled] !== true || row[column.validated] !== true) return;
    var puzzleId = String(row[column.puzzle_id]);
    var difficulty = String(row[column.difficulty]);
    var puzzle = String(row[column.puzzle]);
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(puzzleId) || !Object.prototype.hasOwnProperty.call(counts, difficulty) || !/^[0-9]{81}$/.test(puzzle) || seen[puzzleId]) return;
    var regions = mode === 'jigsaw' ? String(row[column.regions]) : null;
    if ((mode === 'jigsaw') !== (puzzleId.indexOf('jigsaw_') === 0)) return;
    if (mode === 'jigsaw' && !validRegions_(regions)) return;
    seen[puzzleId] = true;
    counts[difficulty]++;
    var item = { puzzleId: puzzleId, difficulty: difficulty, puzzle: puzzle };
    if (mode === 'jigsaw') { item.mode = mode; item.regions = regions; }
    puzzles.push(item);
  });
  if (Object.keys(counts).some(function(tier) { return counts[tier] === 0; })) throw new Error('Missing difficulty');
  return { datasetVersion: version, counts: counts, puzzles: puzzles };
}

function validRegions_(regions) {
  if (!/^[0-8]{81}$/.test(regions)) return false;
  for (var label = 0; label < 9; label++) {
    var target = String(label);
    var cells = [];
    for (var cell = 0; cell < 81; cell++) if (regions[cell] === target) cells.push(cell);
    if (cells.length !== 9) return false;
    var queue = [cells[0]], seen = {};
    seen[cells[0]] = true;
    for (var i = 0; i < queue.length; i++) {
      var at = queue[i];
      var adjacent = [at - 9, at + 9];
      if (at % 9 !== 0) adjacent.push(at - 1);
      if (at % 9 !== 8) adjacent.push(at + 1);
      adjacent.forEach(function(next) {
        if (next >= 0 && next < 81 && regions[next] === target && !seen[next]) { seen[next] = true; queue.push(next); }
      });
    }
    if (queue.length !== 9) return false;
  }
  return true;
}
