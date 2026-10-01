import { AUTO_FILL_BOUNCE_MS, AUTO_FILL_GAP_MS, getFreshAutoFilled } from './auto-fill-presentation.js';

const INK_MS = 280;
const CLEAR_MS = 800;

const inkFrames = [
  { opacity: .68, transform: 'scale(.94)' },
  { opacity: 1, transform: 'scale(1.035)', offset: .45 },
  { opacity: 1, transform: 'scale(1)' },
];

const autoShape = [
  { opacity: .3, lift: 8, scale: .55 },
  { opacity: 1, lift: -8, scale: 1.4, offset: .2 },
  { opacity: 1, lift: 3, scale: .9, offset: .42 },
  { opacity: 1, lift: -3, scale: 1.13, offset: .62 },
  { opacity: 1, lift: 1, scale: .97, offset: .8 },
  { opacity: 1, lift: 0, scale: 1 },
];

function autoFrames(cell, ink) {
  const cellRect = cell?.getBoundingClientRect?.();
  const inkRect = ink?.getBoundingClientRect?.();
  const valid = rect => rect && ['left', 'right', 'top', 'bottom', 'width', 'height']
    .every(key => Number.isFinite(rect[key])) && rect.width > 0 && rect.height > 0;
  let bounds = null;
  if (valid(cellRect) && valid(inkRect)) {
    const centerX = (inkRect.left + inkRect.right) / 2;
    const centerY = (inkRect.top + inkRect.bottom) / 2;
    const left = cellRect.left + 1;
    const right = cellRect.right - 1;
    const top = cellRect.top + 1;
    const bottom = cellRect.bottom - 1;
    const maxScale = Math.min(
      (centerX - left) * 2 / inkRect.width,
      (right - centerX) * 2 / inkRect.width,
      (centerY - top) * 2 / inkRect.height,
      (bottom - centerY) * 2 / inkRect.height,
    );
    if (maxScale > 0) bounds = { top, bottom, centerY, maxScale, height: inkRect.height };
  }
  return autoShape.map(({ lift, scale, ...frame }) => {
    if (bounds) {
      scale = Math.min(scale, bounds.maxScale);
      const halfHeight = bounds.height * scale / 2;
      lift = Math.max(bounds.top - bounds.centerY + halfHeight,
        Math.min(lift, bounds.bottom - bounds.centerY - halfHeight));
    }
    return { ...frame, transform: `translateY(${lift}px) scale(${scale})` };
  });
}

/** Short, presentation-only events. DOM replacement preserves each original clock. */
export function createPlayFeedback(options = {}) {
  const now = options.now || (() => globalThis.performance?.now?.() ?? Date.now());
  const schedule = options.setTimeout || globalThis.setTimeout.bind(globalThis);
  const unschedule = options.clearTimeout || globalThis.clearTimeout.bind(globalThis);
  const reduced = options.prefersReducedMotion
    ?? (() => Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches));
  let input = null;
  let clearEvent = null;
  let timer = null;
  let generation = 0;
  let animations = [];

  function reduceMotion() {
    return typeof reduced === 'function' ? Boolean(reduced()) : Boolean(reduced);
  }

  function stopAnimations() {
    for (const animation of animations) animation.cancel();
    animations = [];
  }

  function cancel() {
    generation += 1;
    if (timer !== null) unschedule(timer);
    timer = null;
    input = null;
    clearEvent = null;
    stopAnimations();
  }

  function armExpiry() {
    if (timer !== null) unschedule(timer);
    const token = ++generation;
    const end = Math.max(input?.endsAt || 0, clearEvent?.endsAt || 0);
    timer = end ? schedule(() => {
      if (token !== generation) return;
      timer = null;
      if (input && now() >= input.endsAt) input = null;
      if (clearEvent && now() >= clearEvent.endsAt) clearEvent = null;
      // All effects have reached their normal CSS state at this deadline.
      if (!input && !clearEvent) stopAnimations();
      else armExpiry();
    }, Math.max(0, end - now())) : null;
  }

  function recordInput(previous, next, cell, digit, mode) {
    if (previous === next || !next || !Number.isInteger(cell)
      || cell < 0 || cell > 80 || next.initialBoard?.[cell] || reduceMotion()) return;
    const startedAt = now();
    const autoCells = getFreshAutoFilled(previous, next);
    input = { cell, digit, mode, autoCells, startedAt,
      endsAt: startedAt + Math.max(INK_MS, (autoCells.length ? autoCells.length * AUTO_FILL_GAP_MS + AUTO_FILL_BOUNCE_MS : 0)) };
    armExpiry();
  }

  function recordInitial(game) {
    if (reduceMotion()) return;
    const autoCells = getFreshAutoFilled(null, game);
    if (!autoCells.length) return;
    const startedAt = now();
    input = { cell: null, autoCells, startedAt,
      endsAt: startedAt + autoCells.length * AUTO_FILL_GAP_MS + AUTO_FILL_BOUNCE_MS };
    armExpiry();
  }

  function celebrate() {
    if (reduceMotion()) return;
    const startedAt = now();
    clearEvent = { startedAt, endsAt: startedAt + CLEAR_MS };
    armExpiry();
  }

  function animate(element, frames, duration, elapsed, delay = 0) {
    if (!element?.animate || elapsed >= delay + duration) return;
    const animation = element.animate(frames, { duration, delay, easing: 'ease-out', fill: 'backwards' });
    // A rerender seeks to elapsed time; it must never start the event again.
    animation.currentTime = Math.max(0, elapsed);
    animations.push(animation);
  }

  function sync(root, { visible = true, completionOpen = false } = {}) {
    stopAnimations();
    if (!visible || reduceMotion()) {
      cancel();
      return;
    }
    const timestamp = now();
    if (input && timestamp >= input.endsAt) input = null;
    if (clearEvent && (!completionOpen || timestamp >= clearEvent.endsAt)) clearEvent = null;
    if (input) {
      const elapsed = timestamp - input.startedAt;
      if (Number.isInteger(input.cell)) {
        const cell = root?.querySelector?.(`[data-cell="${input.cell}"]`);
        const ink = input.mode === 'memo'
          ? cell?.querySelector?.(`[data-note="${input.digit}"]`) || cell?.querySelector?.('.cell-notes')
          : cell?.querySelector?.('.cell-value');
        animate(ink, inkFrames, INK_MS, elapsed);
        animate(root?.querySelector?.(`[data-digit="${input.digit}"]`), [
          { transform: 'translateY(1px) scale(.97)' },
          { transform: 'translateY(0) scale(1)' },
        ], 170, elapsed);
      }
      input.autoCells.forEach((index, order) => {
        const delay = (order + 1) * AUTO_FILL_GAP_MS;
        const cell = root?.querySelector?.(`[data-cell="${index}"]`);
        const ink = cell?.querySelector?.('.cell-value');
        // sync cancelled earlier transforms before measuring this cell's resting ink.
        animate(ink, autoFrames(cell, ink), AUTO_FILL_BOUNCE_MS, elapsed, delay);
      });
    }
    if (clearEvent) {
      const elapsed = timestamp - clearEvent.startedAt;
      animate(root?.querySelector?.('.clear-title'), [
        { opacity: .3, transform: 'translateY(-5px) rotate(-7deg) scale(1.14)' },
        { opacity: 1, transform: 'translateY(1px) rotate(-2deg) scale(.98)', offset: .6 },
        { opacity: 1, transform: 'translateY(0) rotate(-3deg) scale(1)' },
      ], 360, elapsed);
      root?.querySelectorAll?.('[data-clear-piece]').forEach((piece, index) => {
        const direction = index % 2 ? 1 : -1;
        const drift = direction * (12 + index * 3);
        animate(piece, [
          { opacity: 0, transform: 'translate(0, 8px) rotate(0deg)' },
          { opacity: .8, transform: `translate(${drift * .5}px, -13px) rotate(${direction * 45}deg)`, offset: .28 },
          { opacity: 0, transform: `translate(${drift}px, 24px) rotate(${direction * 110}deg)` },
        ], 650, elapsed, index * 24);
      });
    }
  }

  return { recordInput, recordInitial, celebrate, sync, cancel };
}
