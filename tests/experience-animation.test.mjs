import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createExperienceAnimator } from '../js/ui/experience-animation.js';

function fakeClock() {
  let timestamp = 0;
  let nextId = 0;
  const frames = new Map();
  return {
    now: () => timestamp,
    frames,
    requestAnimationFrame(callback) {
      const id = ++nextId;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id) { frames.delete(id); },
    advance(milliseconds) {
      timestamp += milliseconds;
      const pending = [...frames.values()];
      frames.clear();
      for (const callback of pending) callback(timestamp);
    },
  };
}

function fakeRoot() {
  const values = {
    level: { textContent: 'Lv1' },
    title: { textContent: '米粒2粒分並み' },
    track: {
      attributes: {},
      setAttribute(name, value) { this.attributes[name] = value; },
    },
    fill: { style: { width: '0%' } },
  };
  const selectors = {
    '[data-experience-level]': values.level,
    '[data-experience-title]': values.title,
    '[data-experience-track]': values.track,
    '[data-experience-fill]': values.fill,
  };
  const overlay = { querySelector: (selector) => selectors[selector] || null };
  let visible = true;
  return {
    values,
    setVisible(value) { visible = value; },
    querySelector(selector) { return selector === '[data-experience-overlay]' && visible ? overlay : null; },
  };
}

function animatorFor(clock, prefersReducedMotion = false) {
  return createExperienceAnimator({
    now: clock.now,
    requestAnimationFrame: clock.requestAnimationFrame,
    cancelAnimationFrame: clock.cancelAnimationFrame,
    prefersReducedMotion,
  });
}

test('XP animation fills to 100, resets at level-up, and fills the remainder', () => {
  const clock = fakeClock();
  const root = fakeRoot();
  const animator = animatorFor(clock);
  const gain = { eventId: 'clear-1', from: 90, to: 120 };

  animator.sync(root, gain);
  assert.equal(root.values.fill.style.width, '90%');
  assert.equal(root.values.level.textContent, 'Lv1');

  clock.advance(680);
  assert.equal(root.values.fill.style.width, '100%');
  assert.equal(root.values.track.attributes['aria-valuenow'], '100');
  assert.equal(root.values.level.textContent, 'Lv1');

  clock.advance(120);
  assert.equal(root.values.fill.style.width, '0%');
  assert.equal(root.values.level.textContent, 'Lv2');
  assert.equal(root.values.title.textContent, '1円玉並み');

  clock.advance(80);
  assert.equal(root.values.level.textContent, 'Lv2');
  assert.equal(root.values.fill.style.width, '0%');

  clock.advance(1120);
  assert.equal(root.values.fill.style.width, '20%');
  assert.equal(root.values.track.attributes['aria-valuenow'], '20');
  assert.equal(root.values.level.textContent, 'Lv2');
  assert.equal(clock.frames.size, 0);

  animator.sync(root, gain);
  assert.equal(root.values.fill.style.width, '20%');
  assert.equal(clock.frames.size, 0);
});

test('same event keeps its original timeline across replacement renders', () => {
  const clock = fakeClock();
  const animator = animatorFor(clock);
  const firstRoot = fakeRoot();
  const secondRoot = fakeRoot();
  const gain = { eventId: 'clear-stable', from: 20, to: 50 };

  animator.sync(firstRoot, gain);
  clock.advance(100);
  animator.sync(secondRoot, gain);
  const afterRerender = Number.parseFloat(secondRoot.values.fill.style.width);
  assert.ok(afterRerender > 20.1, `expected elapsed animation to continue, got ${afterRerender}%`);

  clock.advance(100);
  const afterNextFrame = Number.parseFloat(secondRoot.values.fill.style.width);
  assert.ok(afterNextFrame > afterRerender);
  assert.equal(clock.frames.size, 1);
});

test('reduced motion displays the final level immediately and null gain cancels animation', () => {
  const reducedClock = fakeClock();
  const reducedRoot = fakeRoot();
  animatorFor(reducedClock, true).sync(reducedRoot, { eventId: 'clear-reduced', from: 90, to: 120 });
  assert.equal(reducedRoot.values.level.textContent, 'Lv2');
  assert.equal(reducedRoot.values.title.textContent, '1円玉並み');
  assert.equal(reducedRoot.values.fill.style.width, '20%');
  assert.equal(reducedClock.frames.size, 0);

  const clock = fakeClock();
  const root = fakeRoot();
  const animator = animatorFor(clock);
  animator.sync(root, { eventId: 'clear-cancel', from: 20, to: 50 });
  assert.equal(clock.frames.size, 1);
  animator.sync(root, null);
  assert.equal(clock.frames.size, 0);
});
