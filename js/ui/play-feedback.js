const INK_MS = 280;
const CHAIN_MS = 320;
const MAX_CHAIN_DELAY_MS = 360;
const CLEAR_MS = 800;

const inkFrames = [
  { opacity: .68, transform: 'scale(.94)' },
  { opacity: 1, transform: 'scale(1.035)', offset: .45 },
  { opacity: 1, transform: 'scale(1)' },
];

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
  let animations = [];

  function reduceMotion() {
    return typeof reduced === 'function' ? Boolean(reduced()) : Boolean(reduced);
  }

  function stopAnimations() {
    for (const animation of animations) animation.cancel();
    animations = [];
  }

  function cancel() {
    if (timer !== null) unschedule(timer);
    timer = null;
    input = null;
    clearEvent = null;
    stopAnimations();
  }

  function armExpiry() {
    if (timer !== null) unschedule(timer);
    const end = Math.max(input?.endsAt || 0, clearEvent?.endsAt || 0);
    timer = end ? schedule(() => {
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
    const autoCells = [...new Set(next.lastAutoFilled || [])].filter(index =>
      Number.isInteger(index) && index >= 0 && index < 81
      && !next.initialBoard?.[index] && next.currentBoard?.[index]
      && previous.currentBoard?.[index] !== next.currentBoard[index]);
    input = { cell, digit, mode, autoCells, startedAt,
      endsAt: startedAt + Math.max(INK_MS, (autoCells.length ? MAX_CHAIN_DELAY_MS + CHAIN_MS : 0)) };
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
      const cell = root?.querySelector?.(`[data-cell="${input.cell}"]`);
      const ink = input.mode === 'memo'
        ? cell?.querySelector?.(`[data-note="${input.digit}"]`) || cell?.querySelector?.('.cell-notes')
        : cell?.querySelector?.('.cell-value');
      animate(ink, inkFrames, INK_MS, elapsed);
      animate(root?.querySelector?.(`[data-digit="${input.digit}"]`), [
        { transform: 'translateY(1px) scale(.97)' },
        { transform: 'translateY(0) scale(1)' },
      ], 170, elapsed);
      input.autoCells.forEach((index, order) => {
        const delay = input.autoCells.length > 1 ? order * MAX_CHAIN_DELAY_MS / (input.autoCells.length - 1) : 60;
        animate(root?.querySelector?.(`[data-cell="${index}"] .cell-value`), inkFrames, CHAIN_MS, elapsed, delay);
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

  return { recordInput, celebrate, sync, cancel };
}
