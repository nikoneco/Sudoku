export const AUTO_FILL_GAP_MS = 100;
export const AUTO_FILL_BOUNCE_MS = 520;

/** Only a fresh engine transaction (or explicit new-game call) can start a chain. */
export function getFreshAutoFilled(previous, next) {
  const before = previous?.currentBoard || next?.initialBoard;
  return [...new Set(next?.lastAutoFilled || [])].filter(cell =>
    Number.isInteger(cell) && cell >= 0 && cell < 81
    && !next.initialBoard?.[cell] && next.currentBoard?.[cell]
    && before?.[cell] !== next.currentBoard[cell]);
}

/** The saved game stays final; only the board shown by the renderer is projected. */
export function createAutoFillPresentation(options = {}) {
  const now = options.now || (() => globalThis.performance?.now?.() ?? Date.now());
  const schedule = options.setTimeout || globalThis.setTimeout.bind(globalThis);
  const unschedule = options.clearTimeout || globalThis.clearTimeout.bind(globalThis);
  const reduced = options.prefersReducedMotion
    ?? (() => Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches));
  let active = null;
  let timer = null;
  let generation = 0;

  const reduceMotion = () => typeof reduced === 'function' ? Boolean(reduced()) : Boolean(reduced);

  function cancel() {
    generation += 1;
    if (timer !== null) unschedule(timer);
    timer = null;
    const hadChain = Boolean(active);
    active = null;
    return hadChain;
  }

  function arm() {
    const chain = active;
    if (!chain) return;
    const deadline = chain.revealed < chain.cells.length
      ? (chain.revealed + 1) * AUTO_FILL_GAP_MS
      : chain.cells.length * AUTO_FILL_GAP_MS + AUTO_FILL_BOUNCE_MS;
    const token = generation;
    timer = schedule(() => {
      if (token !== generation || active !== chain) return;
      timer = null;
      const elapsed = Math.max(0, now() - chain.startedAt);
      if (reduceMotion() || elapsed >= chain.cells.length * AUTO_FILL_GAP_MS + AUTO_FILL_BOUNCE_MS) {
        active = null;
        options.onFinish?.();
        return;
      }
      const revealed = Math.min(chain.cells.length, Math.floor(elapsed / AUTO_FILL_GAP_MS));
      if (revealed !== chain.revealed) {
        chain.revealed = revealed;
        options.onChange?.();
      }
      if (active === chain && token === generation) arm();
    }, Math.max(0, chain.startedAt + deadline - now()));
  }

  function start(previous, next) {
    cancel();
    const cells = getFreshAutoFilled(previous, next);
    if (!cells.length || reduceMotion()) return false;
    active = { cells, board: next.currentBoard, startedAt: now(), revealed: 0 };
    arm();
    return true;
  }

  function project(game) {
    if (!active || active.board !== game?.currentBoard) return game;
    const currentBoard = [...game.currentBoard];
    const sources = [...game.sources];
    for (const cell of active.cells.slice(active.revealed)) {
      currentBoard[cell] = 0;
      sources[cell] = '';
    }
    return { ...game, currentBoard, sources };
  }

  return { start, project, cancel, isActive: () => Boolean(active) };
}
