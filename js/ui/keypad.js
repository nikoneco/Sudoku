import { getDisplayedCandidates } from '../game/engine.js';

/** Memo colors show membership; number keys stop accepting a tenth copy. */
export function getKeypadState(game, cell, mode, autoCandidates = true) {
  const fixed = !Number.isInteger(cell) || cell < 0 || cell > 80 || Boolean(game.initialBoard[cell]);
  const notes = mode === 'memo' && !fixed ? getDisplayedCandidates(game, cell, autoCandidates) : [];
  const counts = Array(10).fill(0);
  for (const digit of game.currentBoard) counts[digit]++;
  return Array.from({ length: 9 }, (_, index) => {
    const digit = index + 1;
    const disabled = fixed || (mode !== 'memo' && counts[digit] >= 9);
    return { digit, disabled, muted: disabled || (mode === 'memo' && !notes.includes(digit)) };
  });
}
