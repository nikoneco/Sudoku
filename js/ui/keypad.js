import { getLegalCandidates } from '../game/engine.js';

/** Presentation availability; number mode still permits incorrect entries. */
export function getKeypadState(game, cell, mode) {
  const fixed = !Number.isInteger(cell) || cell < 0 || cell > 80 || Boolean(game.initialBoard[cell]);
  const board = [...game.currentBoard];
  if (!fixed) board[cell] = 0; // MEMO can convert a filled editable cell back to notes.
  const legal = mode === 'memo' && !fixed ? getLegalCandidates(board, cell) : [];
  const counts = Array(10).fill(0);
  for (const digit of game.currentBoard) counts[digit]++;
  return Array.from({ length: 9 }, (_, index) => {
    const digit = index + 1;
    const disabled = fixed || (mode === 'memo' && !legal.includes(digit));
    return { digit, disabled, muted: disabled || (mode !== 'memo' && counts[digit] >= 9) };
  });
}
