import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getExperience, getHintReward, normalizeExperienceEvents } from '../js/data/experience.js';
import { awardExperience, emptyStats } from '../js/data/stats.js';

const ids = Array.from({ length: 5 }, (_, index) => `018f47d2-a590-7cc2-9b60-bc5472b7d82${index}`);

test('difficulty completion events award the specified XP and advance every 100 XP', () => {
  let stats = emptyStats();
  assert.deepEqual(getExperience(stats), { totalExp: 0, level: 1, progress: 0 });

  stats = awardExperience(stats, ids[0], '初級');
  stats = awardExperience(stats, ids[1], '中級');
  stats = awardExperience(stats, ids[2], '上級');
  assert.deepEqual(getExperience(stats), { totalExp: 90, level: 1, progress: 90 });

  stats = awardExperience(stats, ids[3], '超上級');
  assert.deepEqual(getExperience(stats), { totalExp: 140, level: 2, progress: 40 });
  stats = awardExperience(stats, ids[4], '初級');
  assert.deepEqual(getExperience(stats), { totalExp: 160, level: 2, progress: 60 });
});

test('invalid events do not affect derived XP', () => {
  const stats = {
    experienceEvents: {
      'not-a-uuid': { difficulty: '超上級' },
      '018f47d2-a590-7cc2-9b60-bc5472b7d825': { difficulty: 'invalid' },
      '018f47d2-a590-7cc2-9b60-bc5472b7d826': { difficulty: '初級', puzzleId: 'old' },
    },
    records: { puzzle: { difficulty: '超上級', elapsedTime: 100 } },
    clearedIds: ['puzzle'],
  };
  assert.deepEqual(getExperience(stats), { totalExp: 0, level: 1, progress: 0 });
});

test('all four difficulty rewards follow the six hint rates exactly', () => {
  const expected = {
    '初級': [20, 16, 12, 8, 4, 1],
    '中級': [30, 24, 18, 12, 6, 1.5],
    '上級': [40, 32, 24, 16, 8, 2],
    '超上級': [50, 40, 30, 20, 10, 2.5],
  };
  for (const [difficulty, rewards] of Object.entries(expected)) {
    rewards.forEach((reward, hintsUsed) => {
      assert.equal(getHintReward(difficulty, hintsUsed), reward, `${difficulty}: ${hintsUsed} hints`);
      const stats = awardExperience(emptyStats(), ids[0], difficulty, hintsUsed);
      assert.deepEqual(getExperience(stats), { totalExp: reward, level: 1, progress: reward });
      assert.deepEqual(stats.experienceEvents[ids[0]], hintsUsed ? { difficulty, hintsUsed } : { difficulty });
    });
    assert.equal(getHintReward(difficulty), rewards[0]);
  }
});

test('half-Exp is retained below, exactly on, and beyond each fixed level threshold', () => {
  const eventId = index => `018f47d2-a590-7cc2-9b60-${index.toString(16).padStart(12, '0')}`;
  let stats = emptyStats();
  for (let index = 0; index < 39; index += 1) stats = awardExperience(stats, eventId(index), '超上級', 5);
  assert.deepEqual(getExperience(stats), { totalExp: 97.5, level: 1, progress: 97.5 });
  stats = awardExperience(stats, eventId(39), '超上級', 5);
  assert.deepEqual(getExperience(stats), { totalExp: 100, level: 2, progress: 0 });
  stats = awardExperience(stats, eventId(40), '中級', 5);
  assert.deepEqual(getExperience(stats), { totalExp: 101.5, level: 2, progress: 1.5 });

  let nearThreshold = awardExperience(emptyStats(), ids[0], '初級');
  nearThreshold = awardExperience(nearThreshold, ids[1], '中級');
  nearThreshold = awardExperience(nearThreshold, ids[2], '上級');
  nearThreshold = awardExperience(nearThreshold, ids[3], '初級', 3);
  nearThreshold = awardExperience(nearThreshold, ids[4], '中級', 5);
  assert.deepEqual(getExperience(nearThreshold), { totalExp: 99.5, level: 1, progress: 99.5 });
  nearThreshold = awardExperience(nearThreshold, eventId(41), '初級', 5);
  assert.deepEqual(getExperience(nearThreshold), { totalExp: 100.5, level: 2, progress: 0.5 });
});

test('normalization preserves legacy payloads, canonicalizes zero, and rejects invalid hint counts or extra fields', () => {
  const legacy = { [ids[0]]: { difficulty: '上級' } };
  assert.deepEqual(normalizeExperienceEvents(legacy), legacy);
  assert.deepEqual(normalizeExperienceEvents({ [ids[0]]: { difficulty: '上級', hintsUsed: 0 } }), legacy);
  const inheritedHints = Object.assign(Object.create({ hintsUsed: 5 }), { difficulty: '上級' });
  assert.deepEqual(normalizeExperienceEvents({ [ids[0]]: inheritedHints }), legacy);
  for (const hintsUsed of [-1, 6, 1.5, '1', null, undefined, NaN, Infinity, true]) {
    assert.deepEqual(normalizeExperienceEvents({ [ids[0]]: { difficulty: '上級', hintsUsed } }), {});
    assert.equal(getHintReward('上級', hintsUsed), hintsUsed === undefined ? 40 : 0);
  }
  assert.deepEqual(normalizeExperienceEvents({ [ids[0]]: { difficulty: '上級', hintsUsed: 5, reward: 2 } }), {});
  assert.equal(getHintReward('unknown'), 0);
});
