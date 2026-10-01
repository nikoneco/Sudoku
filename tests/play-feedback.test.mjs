import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlayFeedback } from '../js/ui/play-feedback.js';

function harness({ reduced = false, geometry = null } = {}) {
  let time = 0;
  let serial = 0;
  const timers = new Map();
  const effects = [];
  const nodes = new Map();
  function node(name) {
    if (!nodes.has(name)) nodes.set(name, {
      getBoundingClientRect() {
        if (!geometry) return { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 };
        assert.ok(effects.filter(effect => effect.name === name).every(effect => effect.cancelled), 'measure resting ink after cancelling its old animation');
        return name.endsWith('.cell-value') ? geometry.ink : geometry.cell;
      },
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

test('accepted inputs and ordered chains retain their 100ms clock across replaced DOM and expire after the final bounce', () => {
  const h = harness();
  const { previous, next } = games([1, 2, 3]);
  h.feedback.recordInput(previous, next, 0, 1, 'number');
  h.feedback.sync(h.root);
  assert.deepEqual(h.effects.slice(2).map(effect => effect.options.delay), [100, 200, 300]);
  assert.equal(h.effects[0].frames[1].transform, 'scale(1.035)');
  assert.equal(h.effects[2].frames[1].transform, 'translateY(-8px) scale(1.4)');
  assert.ok(h.effects.every(effect => effect.options.duration + effect.options.delay < 1000));
  h.advance(120);
  h.feedback.sync(h.root);
  assert.ok(h.effects.slice(0, 5).every(effect => effect.cancelled));
  assert.ok(h.effects.slice(5).every(effect => effect.currentTime === 120));
  h.advance(700);
  const count = h.effects.length;
  h.feedback.sync(h.root);
  assert.equal(h.effects.length, count);
  assert.equal(h.timers.size, 0);
  assert.ok(h.effects.every(effect => effect.cancelled));
});

test('auto bounce stays within 375px and 320px cell geometry without changing its WAAPI clock', () => {
  for (const { cellSize, inkWidth, inkHeight } of [
    { cellSize: 39, inkWidth: 13, inkHeight: 21.375 },
    { cellSize: 30, inkWidth: 11, inkHeight: 18.24 },
    { cellSize: 24, inkWidth: 19, inkHeight: 18.24 },
  ]) {
    const rect = (left, top, width, height) => ({ left, top, right: left + width, bottom: top + height, width, height });
    const cell = rect(11, 87, cellSize, cellSize);
    const ink = rect(cell.left + (cellSize - inkWidth) / 2, cell.top + (cellSize - inkHeight) / 2, inkWidth, inkHeight);
    const h = harness({ geometry: { cell, ink } });
    const { previous, next } = games([1]);
    h.feedback.recordInput(previous, next, 0, 1, 'number');
    h.feedback.sync(h.root);
    const auto = h.effects.at(-1);
    const centerX = (ink.left + ink.right) / 2;
    const centerY = (ink.top + ink.bottom) / 2;
    for (const frame of auto.frames) {
      const [, lift, scale] = frame.transform.match(/translateY\(([-\d.]+)px\) scale\(([-\d.]+)\)/).map(Number);
      const halfWidth = ink.width * scale / 2;
      const halfHeight = ink.height * scale / 2;
      assert.ok(centerX - halfWidth >= cell.left + 1 - 1e-9);
      assert.ok(centerX + halfWidth <= cell.right - 1 + 1e-9);
      assert.ok(centerY + lift - halfHeight >= cell.top + 1 - 1e-9);
      assert.ok(centerY + lift + halfHeight <= cell.bottom - 1 + 1e-9);
    }
    assert.ok(auto.frames[1].transform.match(/scale\(([^)]+)\)/)[1] > 1.1, 'auto peak still visibly exceeds manual ink');
    assert.ok(auto.frames[1].transform.match(/translateY\(([^p]+)px\)/)[1] > -8);
    assert.equal(auto.options.duration, 520);
    assert.equal(auto.options.delay, 100);
    h.advance(150);
    h.feedback.sync(h.root);
    assert.equal(h.effects.at(-1).currentTime, 150);
    assert.deepEqual(h.effects.at(-1).frames, auto.frames);
    h.advance(470);
    assert.ok(h.effects.every(effect => effect.cancelled));
  }
});

test('new-game and long-chain feedback uses auto-only bounce without compressing its spacing', () => {
  const h = harness();
  const { next } = games(Array.from({ length: 12 }, (_, index) => index + 1));
  h.feedback.recordInitial(next);
  h.feedback.sync(h.root);
  assert.equal(h.effects.length, 12);
  assert.deepEqual(h.effects.map(effect => effect.options.delay), Array.from({ length: 12 }, (_, index) => (index + 1) * 100));
  h.advance(1100);
  h.feedback.sync(h.root);
  const last = h.effects.at(-1);
  assert.equal(last.options.delay, 1200);
  assert.equal(last.currentTime, 1100);
  h.advance(620);
  const count = h.effects.length;
  h.feedback.sync(h.root);
  assert.equal(h.effects.length, count);
  assert.equal(h.timers.size, 0);
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
