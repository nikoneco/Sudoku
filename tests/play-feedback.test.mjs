import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlayFeedback } from '../js/ui/play-feedback.js';

function harness({ reduced = false } = {}) {
  let time = 0;
  let serial = 0;
  const timers = new Map();
  const effects = [];
  const nodes = new Map();
  function node(name) {
    if (!nodes.has(name)) nodes.set(name, {
      querySelector: selector => node(`${name} ${selector}`),
      animate(frames, options) {
        const effect = { name, frames, options, currentTime: 0, cancelled: false, cancel() { this.cancelled = true; } };
        effects.push(effect);
        return effect;
      },
    });
    return nodes.get(name);
  }
  const root = { querySelector: node, querySelectorAll: () => Array.from({ length: 6 }, (_, i) => node(`piece${i}`)) };
  const feedback = createPlayFeedback({
    now: () => time, prefersReducedMotion: () => reduced,
    setTimeout(fn, delay) { const id = ++serial; timers.set(id, { fn, at: time + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  return { feedback, root, effects, timers, setReduced(value) { reduced = value; },
    advance(value) {
      time += value;
      for (const [id, timer] of timers) if (timer.at <= time) { timers.delete(id); timer.fn(); }
    },
  };
}

function games(autoCells = []) {
  const previous = { currentBoard: Array(81).fill(0), initialBoard: Array(81).fill(0) };
  const next = structuredClone(previous);
  next.currentBoard[0] = 1;
  for (const cell of autoCells) next.currentBoard[cell] = 2;
  next.lastAutoFilled = autoCells;
  return { previous, next };
}

test('accepted inputs and ordered chains retain original time across replaced DOM and expire below one second', () => {
  const h = harness();
  const { previous, next } = games([1, 2, 3]);
  h.feedback.recordInput(previous, next, 0, 1, 'number');
  h.feedback.sync(h.root);
  assert.deepEqual(h.effects.slice(2).map(effect => effect.options.delay), [0, 180, 360]);
  assert.ok(h.effects.every(effect => effect.options.duration + effect.options.delay < 1000));
  h.advance(120);
  h.feedback.sync(h.root);
  assert.ok(h.effects.slice(0, 5).every(effect => effect.cancelled));
  assert.ok(h.effects.slice(5).every(effect => effect.currentTime === 120));
  h.advance(600);
  const count = h.effects.length;
  h.feedback.sync(h.root);
  assert.equal(h.effects.length, count);
  assert.equal(h.timers.size, 0);
  assert.ok(h.effects.every(effect => effect.cancelled));
});

test('no-op, fixed cells and stale lastAutoFilled do not animate those cells', () => {
  const h = harness();
  const { previous, next } = games();
  h.feedback.recordInput(previous, previous, 0, 1, 'number');
  h.feedback.sync(h.root);
  assert.equal(h.effects.length, 0);
  next.initialBoard[0] = 1;
  h.feedback.recordInput(previous, next, 0, 1, 'number');
  h.feedback.sync(h.root);
  assert.equal(h.effects.length, 0);
  next.initialBoard[0] = 0;
  next.lastAutoFilled = [2];
  h.feedback.recordInput(previous, next, 0, 1, 'number');
  h.feedback.sync(h.root);
  assert.equal(h.effects.length, 2);
});

test('rapid input replaces its feedback immediately and cancellation suppresses later rerenders', () => {
  const h = harness();
  const { previous, next } = games();
  h.feedback.recordInput(previous, next, 0, 1, 'number');
  h.feedback.sync(h.root);
  h.advance(30);
  h.feedback.recordInput(previous, next, 1, 2, 'memo');
  h.feedback.sync(h.root);
  assert.ok(h.effects.slice(0, 2).every(effect => effect.cancelled));
  assert.ok(h.effects.slice(2).every(effect => effect.currentTime === 0));
  assert.match(h.effects[2].name, /data-note="2"/);
  h.feedback.cancel();
  const count = h.effects.length;
  h.feedback.sync(h.root);
  assert.equal(h.effects.length, count);
  assert.equal(h.timers.size, 0);
});

test('restored CLEAR is static; a new clear celebrates once through rerenders and dismissal', () => {
  const h = harness();
  h.feedback.sync(h.root, { completionOpen: true });
  assert.equal(h.effects.length, 0);
  h.feedback.celebrate();
  h.feedback.sync(h.root, { completionOpen: true });
  assert.equal(h.effects.length, 7);
  h.advance(100);
  h.feedback.sync(h.root, { completionOpen: true });
  assert.ok(h.effects.slice(7).every(effect => effect.currentTime === 100));
  h.feedback.sync(h.root, { completionOpen: false });
  const count = h.effects.length;
  h.feedback.sync(h.root, { completionOpen: true });
  assert.equal(h.effects.length, count);
  h.advance(800);
  h.feedback.sync(h.root, { completionOpen: true });
  assert.equal(h.effects.length, count);
});

test('hidden views discard feedback and reduced motion uses no animation or timers', () => {
  const h = harness();
  const { previous, next } = games([1]);
  h.feedback.recordInput(previous, next, 0, 1, 'number');
  h.feedback.celebrate();
  h.feedback.sync(h.root, { visible: false, completionOpen: true });
  h.feedback.sync(h.root, { completionOpen: true });
  assert.equal(h.effects.length, 0);
  assert.equal(h.timers.size, 0);
  h.setReduced(true);
  h.feedback.recordInput(previous, next, 0, 1, 'number');
  h.feedback.celebrate();
  h.feedback.sync(h.root, { completionOpen: true });
  assert.equal(h.effects.length, 0);
  assert.equal(h.timers.size, 0);
  h.setReduced(false);
  h.feedback.recordInput(previous, next, 0, 1, 'number');
  h.feedback.sync(h.root);
  h.setReduced(true);
  h.feedback.sync(h.root);
  assert.ok(h.effects.every(effect => effect.cancelled));
  assert.equal(h.timers.size, 0);
});
