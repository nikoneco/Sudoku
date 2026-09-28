import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderApp } from '../js/ui/render.js';

test('completion is a dismissible result over the full board, with input disabled', () => {
  const game = {
    currentBoard: Array(81).fill(1), initialBoard: Array(81).fill(0),
    manualIncludedCandidates: Array(81).fill(0), sources: Array(81).fill('manual'),
    undoStack: [], redoStack: [], difficulty: '中級', elapsedTime: 83,
  };
  const state = { view: 'game', currentGame: game, completionOpen: true, selectedCell: 0, settings: {} };
  const root = { scrollTop: 0, querySelector: () => null };
  const helpers = { isComplete: () => true, conflicts: () => [], displayed: () => [], elapsed: 83 };
  renderApp(root, state, ['中級'], helpers);
  assert.equal((root.innerHTML.match(/role="gridcell"/g) || []).length, 81);
  assert.match(root.innerHTML, /class="clear-title">CLEAR/);
  assert.match(root.innerHTML, /中級<\/span><time>01:23/);
  assert.match(root.innerHTML, /data-action="dismiss-completion"/);
  assert.match(root.innerHTML, /inert aria-disabled="true"/);
  state.completionOpen = false;
  renderApp(root, state, ['中級'], helpers);
  assert.doesNotMatch(root.innerHTML, /class="clear-overlay"/);
  assert.equal((root.innerHTML.match(/role="gridcell"/g) || []).length, 81);
});
