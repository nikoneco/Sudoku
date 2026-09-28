/** Public API: only four read operations; no mutation endpoint. */
function doGet(e) {
  var params = e && e.parameter || {};
  var callback = params.callback;
  var result;
  if (callback && !/^sudoku_[A-Za-z0-9_]{1,100}$/.test(callback)) {
    return ContentService.createTextOutput(JSON.stringify({ error: 'INVALID_CALLBACK' })).setMimeType(ContentService.MimeType.JSON);
  }
  try {
    var action = params.action || 'health';
    if (['health', 'meta', 'sync', 'puzzles'].indexOf(action) < 0) result = { error: 'UNKNOWN_ACTION' };
    else if (action === 'health') result = { ok: true, schemaVersion: 1, service: 'sudoku' };
    else {
      var dataset = readDataset_();
      if (action === 'meta') result = { schemaVersion: 1, datasetVersion: dataset.datasetVersion, counts: dataset.counts };
      else if (action === 'sync' && String(dataset.datasetVersion) === String(params.version)) result = { schemaVersion: 1, datasetVersion: dataset.datasetVersion, unchanged: true };
      else result = { schemaVersion: 1, datasetVersion: dataset.datasetVersion, puzzles: dataset.puzzles };
    }
  } catch (error) {
    console.error(error);
    result = { error: 'DATASET_UNAVAILABLE' };
  }
  var json = JSON.stringify(result).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return ContentService.createTextOutput(callback ? callback + '(' + json + ');' : json)
    .setMimeType(callback ? ContentService.MimeType.JAVASCRIPT : ContentService.MimeType.JSON);
}

function doPost() {
  return ContentService.createTextOutput(JSON.stringify({ error: 'READ_ONLY' })).setMimeType(ContentService.MimeType.JSON);
}
