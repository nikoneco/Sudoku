import test from "node:test";
import assert from "node:assert/strict";
import { getRegions, getUnits, isValidRegions, NORMAL_REGIONS } from "../js/game/regions.js";

function irregularRegions() {
  const regions = [...NORMAL_REGIONS];
  [regions[2], regions[12]] = [regions[12], regions[2]];
  return regions.join("");
}

test("normal regions retain ordinary boxes and provide all 27 independent unit arrays", () => {
  assert.equal(NORMAL_REGIONS, "000111222".repeat(3) + "333444555".repeat(3) + "666777888".repeat(3));
  assert.equal(isValidRegions(NORMAL_REGIONS), true);
  const units = getUnits();
  assert.equal(units.length, 27);
  assert.deepEqual(units[0], [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(units[9], [0, 9, 18, 27, 36, 45, 54, 63, 72]);
  assert.deepEqual(units[18], [0, 1, 2, 9, 10, 11, 18, 19, 20]);
  for (let cell = 0; cell < 81; cell += 1) assert.equal(units.filter(unit => unit.includes(cell)).length, 3);
  units[18].pop();
  assert.equal(getUnits()[18].length, 9);
});

test("connected irregular regions use labels, not ordinary box coordinates", () => {
  const regions = irregularRegions();
  assert.equal(isValidRegions(regions), true);
  const units = getUnits(regions);
  assert.deepEqual(units[18], [0, 1, 9, 10, 11, 12, 18, 19, 20]);
  assert.deepEqual(units[19], [2, 3, 4, 5, 13, 14, 21, 22, 23]);
  assert.ok(units.every(unit => unit.length === 9 && new Set(unit).size === 9));
});

test("region validation rejects malformed strings, wrong counts, and disconnected cells", () => {
  const disconnected = [...NORMAL_REGIONS];
  [disconnected[0], disconnected[80]] = [disconnected[80], disconnected[0]];
  const diagonalOnly = [...NORMAL_REGIONS];
  // Label 0's new cell 30 only touches its old cells at a diagonal.
  [diagonalOnly[0], diagonalOnly[30]] = [diagonalOnly[30], diagonalOnly[0]];
  const rowRegions = Array.from({ length: 9 }, (_, label) => String(label).repeat(9)).join("");
  const wrappedRows = rowRegions.at(-1) + rowRegions.slice(0, -1);
  const invalid = [
    null, undefined, [], [...NORMAL_REGIONS], "", NORMAL_REGIONS.slice(1), NORMAL_REGIONS + "0", NORMAL_REGIONS + "\n",
    NORMAL_REGIONS.replace("0", "9"), NORMAL_REGIONS.replace("0", "a"),
    "0".repeat(81), NORMAL_REGIONS.replace("0", "1"),
    disconnected.join(""), diagonalOnly.join(""), wrappedRows,
  ];
  assert.equal(isValidRegions(rowRegions), true);
  for (const regions of invalid) {
    assert.equal(isValidRegions(regions), false, String(regions));
    if (regions !== undefined) assert.throws(() => getUnits(regions), TypeError);
  }
});

test("game rules default only for normal saves and never reinterpret malformed jigsaw metadata", () => {
  assert.equal(getRegions(), NORMAL_REGIONS);
  assert.equal(getRegions({}), NORMAL_REGIONS);
  assert.equal(getRegions({ mode: "normal" }), NORMAL_REGIONS);
  assert.equal(getRegions({ regions: NORMAL_REGIONS }), NORMAL_REGIONS);
  const regions = irregularRegions();
  assert.equal(getRegions({ mode: "jigsaw", regions }), regions);
  for (const value of [
    { mode: "jigsaw" }, { mode: "jigsaw", regions: "0".repeat(81) },
    { mode: "normal", regions }, { regions }, { mode: "unknown" },
  ]) assert.throws(() => getRegions(value), TypeError);
});
