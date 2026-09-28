// Familiar-object lengths are illustrative; products vary.
// Keep in sync with the private Levels sheet. No sheet identifiers belong here.
export const LEVEL_TITLES = [
  {
    "level": 1,
    "title": "米粒2粒分並み"
  },
  {
    "level": 2,
    "title": "1円玉並み"
  },
  {
    "level": 3,
    "title": "クリップ並み"
  },
  {
    "level": 4,
    "title": "ペットボトルのふた並み"
  },
  {
    "level": 5,
    "title": "消しゴム並み"
  },
  {
    "level": 6,
    "title": "卵並み"
  },
  {
    "level": 7,
    "title": "つまようじ並み"
  },
  {
    "level": 8,
    "title": "リップクリーム並み"
  },
  {
    "level": 9,
    "title": "名刺並み"
  },
  {
    "level": 10,
    "title": "コースター並み"
  },
  {
    "level": 11,
    "title": "トイレットペーパー並み"
  },
  {
    "level": 12,
    "title": "CD並み"
  },
  {
    "level": 13,
    "title": "ティースプーン並み"
  },
  {
    "level": 14,
    "title": "ボールペン並み"
  },
  {
    "level": 15,
    "title": "15cm定規並み"
  },
  {
    "level": 16,
    "title": "スマートフォン並み"
  },
  {
    "level": 17,
    "title": "バターナイフ並み"
  },
  {
    "level": 18,
    "title": "はさみ並み"
  },
  {
    "level": 19,
    "title": "ケーキ皿並み"
  },
  {
    "level": 20,
    "title": "子ども用の箸並み"
  },
  {
    "level": 21,
    "title": "A4用紙の横幅並み"
  },
  {
    "level": 22,
    "title": "箸並み"
  },
  {
    "level": 23,
    "title": "スリッパ並み"
  },
  {
    "level": 24,
    "title": "フライパン並み"
  },
  {
    "level": 25,
    "title": "スニーカー並み"
  },
  {
    "level": 26,
    "title": "ディナープレート並み"
  },
  {
    "level": 27,
    "title": "雑誌並み"
  },
  {
    "level": 28,
    "title": "大きなフライパン並み"
  },
  {
    "level": 30,
    "title": "30cm定規並み"
  },
  {
    "level": 35,
    "title": "ノートパソコン並み"
  },
  {
    "level": 40,
    "title": "クッション並み"
  },
  {
    "level": 45,
    "title": "ハンガー並み"
  },
  {
    "level": 50,
    "title": "枕並み"
  },
  {
    "level": 55,
    "title": "傘の親骨並み"
  },
  {
    "level": 60,
    "title": "バスタオルの横幅並み"
  },
  {
    "level": 65,
    "title": "ミニギター並み"
  },
  {
    "level": 70,
    "title": "長傘並み"
  },
  {
    "level": 75,
    "title": "机の高さ並み"
  },
  {
    "level": 80,
    "title": "子ども用バット並み"
  },
  {
    "level": 85,
    "title": "椅子の高さ並み"
  },
  {
    "level": 90,
    "title": "玄関マット並み"
  },
  {
    "level": 95,
    "title": "ゴルフクラブ並み"
  },
  {
    "level": 100,
    "title": "1m定規並み"
  },
  {
    "level": 110,
    "title": "学習机並み"
  },
  {
    "level": 120,
    "title": "バスタオル並み"
  },
  {
    "level": 130,
    "title": "ほうき並み"
  },
  {
    "level": 140,
    "title": "フロアライト並み"
  },
  {
    "level": 150,
    "title": "30cm定規5本分並み"
  },
  {
    "level": 160,
    "title": "姿見並み"
  },
  {
    "level": 170,
    "title": "コートハンガー並み"
  },
  {
    "level": 180,
    "title": "畳並み"
  },
  {
    "level": 190,
    "title": "敷き布団並み"
  },
  {
    "level": 200,
    "title": "ドア並み"
  }
];

export function getLevelTitle(level) {
  const current = Math.max(1, Math.floor(Number(level) || 1));
  if (current > 200) return `ドア${Math.max(1, Math.round(current / 200))}枚分並み`;
  return LEVEL_TITLES.reduce((best, item) => Math.abs(item.level - current) < Math.abs(best.level - current) ? item : best).title;
}

