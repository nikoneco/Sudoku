import { getLevelTitle } from '../data/level-titles.js';

const EXPERIENCE_PER_LEVEL = 100;
const LEVEL_HOLD_MS = 120;
const LEVEL_RESET_MS = 80;
const EVENT_ANIMATION_MS = 2000;
const MIN_FILL_MS = 240;

function normalizedTotal(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function buildPhases(from, to) {
  const phases = [];
  let total = from;

  while (total < to) {
    const level = Math.floor(total / EXPERIENCE_PER_LEVEL) + 1;
    const nextLevelTotal = level * EXPERIENCE_PER_LEVEL;
    const end = Math.min(to, nextLevelTotal);
    const reachesThreshold = end === nextLevelTotal;
    if (end > total) {
      phases.push({
        kind: 'fill',
        level,
        from: total % EXPERIENCE_PER_LEVEL,
        to: reachesThreshold ? EXPERIENCE_PER_LEVEL : end % EXPERIENCE_PER_LEVEL,
        amount: end - total,
        duration: 0,
      });
    }
    total = end;

    if (reachesThreshold) {
      phases.push({ kind: 'hold', level, progress: EXPERIENCE_PER_LEVEL, duration: LEVEL_HOLD_MS });
      phases.push({ kind: 'reset', level: level + 1, progress: 0, duration: LEVEL_RESET_MS });
    }
  }

  const fills = phases.filter((phase) => phase.kind === 'fill');
  const totalFilled = fills.reduce((sum, phase) => sum + phase.amount, 0);
  if (fills.length) {
    const thresholdTime = phases.reduce((sum, phase) => sum + (phase.kind === 'fill' ? 0 : phase.duration), 0);
    const duration = Math.max(EVENT_ANIMATION_MS, thresholdTime + (fills.length * MIN_FILL_MS));
    const fillBudget = duration - thresholdTime;
    const proportionalBudget = Math.max(0, fillBudget - (fills.length * MIN_FILL_MS));
    for (let index = 0; index < fills.length; index += 1) {
      const phase = fills[index];
      phase.duration = MIN_FILL_MS + (index === fills.length - 1
        ? proportionalBudget - fills.slice(0, -1).reduce((sum, prior) => sum + (proportionalBudget * prior.amount / totalFilled), 0)
        : proportionalBudget * phase.amount / totalFilled);
    }
  }

  return phases;
}

function finalFrame(total) {
  return {
    level: Math.floor(total / EXPERIENCE_PER_LEVEL) + 1,
    progress: total % EXPERIENCE_PER_LEVEL,
  };
}

function frameAt(animation, timestamp) {
  let elapsed = Math.max(0, timestamp - animation.startedAt);
  for (const phase of animation.phases) {
    if (phase.duration === 0) return { level: phase.level, progress: phase.progress };
    if (elapsed < phase.duration) {
      if (phase.kind !== 'fill') return { level: phase.level, progress: phase.progress };
      const ratio = elapsed / phase.duration;
      const eased = ratio * ratio * (3 - (2 * ratio));
      return {
        level: phase.level,
        progress: phase.from + ((phase.to - phase.from) * eased),
      };
    }
    elapsed -= phase.duration;
  }
  return finalFrame(animation.to);
}

function totalDuration(animation) {
  return animation.phases.reduce((total, phase) => total + phase.duration, 0);
}

function defaultReducedMotion() {
  return Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

/** Animate a single clear event without restarting when the app replaces its DOM. */
export function createExperienceAnimator(options = {}) {
  const now = options.now || (() => globalThis.performance?.now?.() ?? Date.now());
  const requestFrame = options.requestAnimationFrame
    || globalThis.requestAnimationFrame?.bind(globalThis)
    || ((callback) => globalThis.setTimeout(() => callback(now()), 16));
  const cancelFrame = options.cancelAnimationFrame
    || globalThis.cancelAnimationFrame?.bind(globalThis)
    || globalThis.clearTimeout?.bind(globalThis);
  const reducedMotion = options.prefersReducedMotion ?? defaultReducedMotion;

  let active = null;
  let lastEventId = null;
  let frameHandle = null;

  function shouldReduceMotion() {
    return typeof reducedMotion === 'function' ? Boolean(reducedMotion()) : Boolean(reducedMotion);
  }

  function stopFrame() {
    if (frameHandle === null) return;
    cancelFrame?.(frameHandle);
    frameHandle = null;
  }

  function setFrame(root, frame) {
    const overlay = root?.querySelector?.('[data-experience-overlay]');
    if (!overlay) return false;
    const level = Math.max(1, Math.floor(Number(frame.level) || 1));
    const progress = Math.max(0, Math.min(EXPERIENCE_PER_LEVEL, Number(frame.progress) || 0));
    const levelElement = overlay.querySelector('[data-experience-level]');
    const titleElement = overlay.querySelector('[data-experience-title]');
    const track = overlay.querySelector('[data-experience-track]');
    const fill = overlay.querySelector('[data-experience-fill]');

    if (levelElement && levelElement.textContent !== `Lv${level}`) levelElement.textContent = `Lv${level}`;
    const title = getLevelTitle(level);
    if (titleElement && titleElement.textContent !== title) titleElement.textContent = title;
    if (track) track.setAttribute('aria-valuenow', String(Math.round(progress)));
    if (fill) fill.style.width = `${progress}%`;
    return true;
  }

  function showFinal(root, total) {
    return setFrame(root, finalFrame(total));
  }

  function finish(animation) {
    showFinal(animation.root, animation.to);
    if (active === animation) active = null;
    stopFrame();
  }

  function tick() {
    frameHandle = null;
    const animation = active;
    if (!animation) return;
    if (!animation.root?.querySelector?.('[data-experience-overlay]')) return;
    if (shouldReduceMotion()) {
      finish(animation);
      return;
    }
    if (now() - animation.startedAt >= totalDuration(animation)) {
      finish(animation);
      return;
    }
    setFrame(animation.root, frameAt(animation, now()));
    scheduleFrame();
  }

  function scheduleFrame() {
    if (active && frameHandle === null) frameHandle = requestFrame(tick);
  }

  function clear() {
    stopFrame();
    active = null;
    lastEventId = null;
  }

  function sync(root, gain) {
    if (!gain) {
      clear();
      return;
    }

    const from = normalizedTotal(gain.from);
    const to = normalizedTotal(gain.to);
    if (typeof gain.eventId !== 'string' || !gain.eventId || from === null || to === null) {
      clear();
      return;
    }

    const overlay = root?.querySelector?.('[data-experience-overlay]');
    if (!overlay) {
      stopFrame();
      return;
    }

    if (gain.eventId === lastEventId && active?.eventId !== gain.eventId) {
      showFinal(root, to);
      return;
    }

    if (active?.eventId !== gain.eventId) {
      stopFrame();
      lastEventId = gain.eventId;
      active = {
        eventId: gain.eventId,
        from,
        to,
        phases: buildPhases(from, to),
        startedAt: now(),
        root,
      };
    } else {
      // Keep the original event's clock and values across unrelated rerenders.
      active.root = root;
    }

    if (shouldReduceMotion()) {
      finish(active);
      return;
    }

    const animation = active;
    if (now() - animation.startedAt >= totalDuration(animation)) {
      finish(animation);
      return;
    }
    setFrame(root, frameAt(animation, now()));
    scheduleFrame();
  }

  return { sync, cancel: clear };
}
