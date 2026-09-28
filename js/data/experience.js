import { DIFFICULTIES } from '../config.js';

export const EXPERIENCE_BY_DIFFICULTY = Object.freeze({
  '初級': 20,
  '中級': 30,
  '上級': 40,
  '超上級': 50,
});

const EXPERIENCE_EVENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isDifficulty(value) {
  return DIFFICULTIES.includes(value);
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
      || Object.keys(event).length !== 1
      || !hasOwn(event, 'difficulty')
      || !isDifficulty(event.difficulty)) continue;
    defineMapValue(normalized, eventId, { difficulty: event.difficulty });
  }
  return normalized;
}

/** Union events by ID. Conflicts resolve by difficulty order, independent of merge order. */
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
    defineMapValue(merged, eventId, { difficulty });
  }
  return merged;
}

/** XP totals come only from unique completion events; legacy clears earn no XP. */
export function getExperience(stats) {
  const events = normalizeExperienceEvents(isObject(stats) ? stats.experienceEvents : null);
  let totalExp = 0;
  for (const event of Object.values(events)) totalExp += EXPERIENCE_BY_DIFFICULTY[event.difficulty];

  return {
    totalExp,
    level: Math.floor(totalExp / 100) + 1,
    progress: totalExp % 100,
  };
}
