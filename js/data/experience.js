import { DIFFICULTIES } from '../config.js';

export const EXPERIENCE_BY_DIFFICULTY = Object.freeze({
  '初級': 20,
  '中級': 30,
  '上級': 40,
  '超上級': 50,
});

const EXPERIENCE_EVENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HINT_REWARD_PERCENTAGES = Object.freeze([100, 80, 60, 40, 20, 5]);
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isDifficulty(value) {
  return DIFFICULTIES.includes(value);
}

function isHintsUsed(value) {
  return Number.isInteger(value) && value >= 0 && value <= 5;
}

function completionEvent(difficulty, hintsUsed) {
  return hintsUsed === 0 ? { difficulty } : { difficulty, hintsUsed };
}

/** Invalid input earns nothing; valid rewards retain exact half-Exp increments. */
export function getHintReward(difficulty, hintsUsed = 0) {
  if (!isDifficulty(difficulty) || !isHintsUsed(hintsUsed)) return 0;
  return EXPERIENCE_BY_DIFFICULTY[difficulty] * HINT_REWARD_PERCENTAGES[hintsUsed] / 100;
}

function compareText(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function defineMapValue(target, key, value) {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    writable: true,
    value,
  });
}

function chooseDifficulty(left, right) {
  return DIFFICULTIES.indexOf(left) <= DIFFICULTIES.indexOf(right) ? left : right;
}

export function isExperienceEventId(value) {
  return typeof value === 'string' && EXPERIENCE_EVENT_ID_PATTERN.test(value);
}

/** Keep only immutable, well-formed completion events and sort them by ID. */
export function normalizeExperienceEvents(events) {
  const normalized = {};
  if (!isObject(events)) return normalized;

  for (const eventId of Object.keys(events).sort(compareText)) {
    const event = events[eventId];
    if (!isExperienceEventId(eventId)
      || !isObject(event)
      || Object.keys(event).some(key => key !== 'difficulty' && key !== 'hintsUsed')
      || !hasOwn(event, 'difficulty')
      || !isDifficulty(event.difficulty)
      || (hasOwn(event, 'hintsUsed') && !isHintsUsed(event.hintsUsed))) continue;
    defineMapValue(normalized, eventId, completionEvent(event.difficulty, hasOwn(event, 'hintsUsed') ? event.hintsUsed : 0));
  }
  return normalized;
}

/** Union IDs; conflicts keep the earlier difficulty and greater hint count. */
export function mergeExperienceEvents(leftEvents, rightEvents) {
  const left = normalizeExperienceEvents(leftEvents);
  const right = normalizeExperienceEvents(rightEvents);
  const merged = {};
  const eventIds = new Set([...Object.keys(left), ...Object.keys(right)]);

  for (const eventId of [...eventIds].sort(compareText)) {
    const leftEvent = left[eventId];
    const rightEvent = right[eventId];
    const difficulty = leftEvent && rightEvent
      ? chooseDifficulty(leftEvent.difficulty, rightEvent.difficulty)
      : (leftEvent || rightEvent).difficulty;
    const hintsUsed = Math.max(leftEvent?.hintsUsed || 0, rightEvent?.hintsUsed || 0);
    defineMapValue(merged, eventId, completionEvent(difficulty, hintsUsed));
  }
  return merged;
}

/** XP totals come only from unique completion events; legacy clears earn no XP. */
export function getExperience(stats) {
  const events = normalizeExperienceEvents(isObject(stats) ? stats.experienceEvents : null);
  let halfExp = 0;
  for (const event of Object.values(events)) halfExp += getHintReward(event.difficulty, event.hintsUsed) * 2;
  const totalExp = halfExp / 2;

  return {
    totalExp,
    level: Math.floor(totalExp / 100) + 1,
    progress: totalExp % 100,
  };
}
