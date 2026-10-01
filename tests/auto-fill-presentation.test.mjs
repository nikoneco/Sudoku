import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, getDisplayedCandidates, transact, undo } from '../js/game/engine.js';
import { AUTO_FILL_BOUNCE_MS, createAutoFillPresentation } from '../js/ui/auto-fill-presentation.js';

function harness({ reduced = false } = {}) {
  let time = 0;
  let serial = 0;
  const timers = new Map();
  const changes = [];
  let finishes = 0;
  const presentation = createAutoFillPresentation({
    now: () => time, prefersReducedMotion: () => reduced,
    setTimeout(fn, delay) { const id = ++serial; timers.set(id, { fn, at: time + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    onChange: () => changes.push(time), onFinish: () => { finishes += 1; },
  });
  return { presentation, timers, changes, get finishes() { return finishes; },
    setReduced(value) { reduced = value; },
    advance(delta) {
      const end = time + delta;
      while (true) {
        const entry = [...timers].filter(([, job]) => job.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!entry) break;
        time = entry[1].at; timers.delete(entry[0]); entry[1].fn();
      }
      time = end;
    },
  };
}

function inputChain() {
  const previous = createGame({ puzzleId: 'chain', difficulty: '初級', puzzle: '0'.repeat(81) });
  for (let cell = 1; cell <= 3; cell += 1) {
    previous.manualExcludedCandidates[cell] = 511 & ~((1 << (cell - 1)) | (1 << cell));
  }
  const next = transact(previous, { type: 'set', cell: 0, value: 1 });
  assert.deepEqual(next.lastAutoFilled, [1, 2, 3]);
  return { previous, next };
}

test('atomic closure is projected at 100ms gaps with legal candidates from each visible board', () => {
  const h = harness();
  const { previous, next } = inputChain();
  const canonical = JSON.stringify(next);
  assert.equal(h.presentation.start(previous, next), true);
  assert.deepEqual(h.presentation.project(next).currentBoard.slice(0, 4), [1, 0, 0, 0]);
  assert.deepEqual(getDisplayedCandidates(h.presentation.project(next), 8), [2, 3, 4, 5, 6, 7, 8, 9]);
  h.advance(99);
  assert.equal(h.presentation.project(next).currentBoard[1], 0);
  h.advance(1);
  assert.deepEqual(h.presentation.project(next).currentBoard.slice(0, 4), [1, 2, 0, 0]);
  assert.deepEqual(getDisplayedCandidates(h.presentation.project(next), 8), [3, 4, 5, 6, 7, 8, 9]);
  h.advance(100);
  assert.deepEqual(h.presentation.project(next).currentBoard.slice(0, 4), [1, 2, 3, 0]);
  h.advance(100);
  assert.deepEqual(h.presentation.project(next).currentBoard, next.currentBoard);
  assert.deepEqual(h.changes, [100, 200, 300]);
  assert.equal(h.finishes, 0);
  h.advance(AUTO_FILL_BOUNCE_MS);
  assert.equal(h.finishes, 1);
  assert.equal(h.presentation.isActive(), false);
  assert.equal(JSON.stringify(next), canonical);
  assert.deepEqual(undo(next).currentBoard, previous.currentBoard);
  assert.equal(next.undoStack.length, 1);
});

test('long and initial chains keep 100ms spacing with no total delay cap', () => {
  const h = harness();
  const { next } = inputChain();
  next.lastAutoFilled = Array.from({ length: 12 }, (_, index) => index + 1);
  for (const cell of next.lastAutoFilled) next.currentBoard[cell] = (cell % 9) + 1;
  assert.equal(h.presentation.start(null, next), true);
  h.advance(1199);
  assert.ok(next.lastAutoFilled.slice(0, 11).every(cell => h.presentation.project(next).currentBoard[cell]));
  assert.equal(h.presentation.project(next).currentBoard[12], 0);
  h.advance(1);
  assert.ok(h.presentation.project(next).currentBoard[12]);
  assert.deepEqual(h.changes, Array.from({ length: 12 }, (_, index) => (index + 1) * 100));
});

test('cancelled callbacks cannot mutate a later chain, and stale lastAutoFilled is not replayed', () => {
  const h = harness();
  const { previous, next } = inputChain();
  h.presentation.start(previous, next);
  const stale = [...h.timers.values()][0].fn;
  h.advance(40);
  h.presentation.cancel();
  assert.equal(h.presentation.project(next), next);
  assert.equal(h.presentation.start(next, { ...next }), false);
  h.presentation.start(previous, next);
  stale();
  assert.equal(h.presentation.project(next).currentBoard[1], 0);
  assert.equal(h.changes.length, 0);
  assert.equal(h.finishes, 0);
  h.advance(100);
  assert.equal(h.presentation.project(next).currentBoard[1], 2);
  assert.equal(h.timers.size, 1);
});

test('OFF and reduced motion stay static; reducing motion during a chain safely finishes it', () => {
  const h = harness({ reduced: true });
  const { previous, next } = inputChain();
  assert.equal(h.presentation.start(previous, next), false);
  assert.equal(h.presentation.project(next), next);
  assert.equal(h.timers.size, 0);
  h.setReduced(false);
  const manualOnly = transact(previous, { type: 'set', cell: 0, value: 1 }, { autoFill: false });
  assert.equal(h.presentation.start(previous, manualOnly), false);
  h.presentation.start(previous, next);
  h.advance(100);
  h.setReduced(true);
  h.advance(100);
  assert.equal(h.presentation.project(next), next);
  assert.equal(h.presentation.isActive(), false);
  assert.equal(h.finishes, 1);
  assert.equal(h.timers.size, 0);
});
