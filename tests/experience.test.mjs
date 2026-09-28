import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getExperience } from '../js/data/experience.js';
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
