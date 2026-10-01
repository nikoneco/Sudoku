import { icon } from './icons.js';
import { THEMES } from '../config.js';
import { getExperience } from '../data/experience.js';
import { getLevelTitle } from '../data/level-titles.js';

const html = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));

export function formatDuration(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = total % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}` : `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

function notices(state) {
  const items = [];
  if (state.sessionBlocked) {
    items.push(`<div class="notice notice--sync" role="alert"><span>別の画面で使用中です。そちらを閉じてから再読み込みしてください。</span><button class="notice-button" data-action="reload">再読み込み</button></div>`);
  }
  if (state.loadError) {
    items.push(`<div class="notice" role="alert"><span>保存内容を読み込めませんでした。保存データは保持されています。</span><button class="notice-button" data-action="retry-load">再試行</button></div>`);
  }
  if (state.saveError) {
    items.push(`<div class="notice" role="alert"><span>保存に失敗しました。現在の内容はこの画面に残っています。</span><button class="notice-button" data-action="retry-save">再試行</button></div>`);
  }
  if (state.syncError) {
    items.push(`<div class="notice notice--sync" role="status"><span>問題を更新できませんでした。保存済みの問題は使えます。</span><button class="notice-button" data-action="retry-sync">再試行</button></div>`);
  }
  if (state.uiError) {
    items.push(`<div class="notice" role="alert"><span>${html(state.uiError)}</span><button class="notice-button" data-action="dismiss-error" aria-label="通知を閉じる">閉じる</button></div>`);
  }
  if (state.updateWorker) {
    items.push(`<div class="notice notice--update" role="status"><span>アプリの更新があります。</span><button class="notice-button" data-action="apply-update">更新</button></div>`);
  }
  return items.length ? `<aside class="app-notices" aria-label="通知">${items.join('')}</aside>` : '';
}

function pageHeader(title, backAction = 'back', right = '') {
  return `<header class="screen-header">
    <div class="header-start"><button class="header-button header-button--back" data-action="${html(backAction)}" aria-label="戻る">${icon('back')}<span>戻る</span></button></div>
    <h1 class="screen-heading">${html(title)}</h1>
    <div class="header-end">${right}</div>
  </header>`;
}

function homeView(state, difficulties, complete) {
  const current = state.currentGame;
  const canResume = current && !complete(current);
  const experience = state.account ? getExperience(state.stats) : null;
  const difficultyRows = difficulties.map((difficulty, index) => {
    const dots = Array.from({ length: difficulties.length }, (_, dot) => `<i${dot <= index ? ' class="is-filled"' : ''}></i>`).join('');
    return `<button class="level-row" data-action="new-game" data-difficulty="${html(difficulty)}"${state.busy || !state.storageReady || state.sessionBlocked ? ' disabled' : ''}>
      <span class="level-name">${html(difficulty)}</span>
      <span class="difficulty-dots" aria-hidden="true">${dots}</span>
      ${icon('chevron')}
    </button>`;
  }).join('');
  return `<main class="screen home-screen">
    ${notices(state)}
    <header class="home-header"><h1 class="brand"><span class="brand-stamp" aria-hidden="true"></span>SUDOKU</h1></header>
    ${experience ? `<p class="home-level" aria-label="Lv${experience.level} ${html(getLevelTitle(experience.level))}"><span>Lv${experience.level}</span><span>${html(getLevelTitle(experience.level))}</span></p>` : ''}
    <div class="home-content">
      ${canResume ? `<button class="resume-card" data-action="resume">
        <span class="resume-title">つづきから</span>
        <span class="resume-meta"><strong>${html(current.difficulty)}</strong><span>${formatDuration(current.elapsedTime)}</span></span>
        ${icon('chevron')}
      </button>` : ''}
      <section class="level-section" aria-labelledby="new-puzzle-title">
        <h2 class="section-title" id="new-puzzle-title">新しい問題</h2>
        <div class="level-list">${difficultyRows}</div>
      </section>
      ${state.busy ? '<p class="busy-indicator" role="status"><span class="loading-mark" aria-hidden="true"></span>問題を準備しています</p>' : ''}
    </div>
    <nav class="home-nav" aria-label="メニュー">
      <button class="nav-action" data-action="settings"${!state.storageReady || state.sessionBlocked ? ' disabled' : ''}>${icon('settings')}<span>設定</span></button>
      <button class="nav-action" data-action="stats"${!state.storageReady || state.sessionBlocked ? ' disabled' : ''}>${icon('stats')}<span>成績</span></button>
    </nav>
  </main>`;
}

function boxOf(index) {
  return Math.floor(Math.floor(index / 9) / 3) * 3 + Math.floor((index % 9) / 3);
}

function gameView(state, difficultyList, { displayed, conflicts, elapsed, isComplete, pad: keypadState, projectedGame }) {
  const completed = isComplete(state.currentGame);
  const game = projectedGame || state.currentGame;
  const selected = Number.isInteger(state.selectedCell) ? state.selectedCell : 0;
  const selectedValue = game.currentBoard[selected] || 0;
  const selectedRow = Math.floor(selected / 9);
  const selectedCol = selected % 9;
  const selectedBox = boxOf(selected);
  const conflictSet = new Set(conflicts(game.currentBoard));
  const cells = game.currentBoard.map((value, index) => {
    const row = Math.floor(index / 9);
    const col = index % 9;
    const isGiven = game.initialBoard[index] !== 0;
    const notes = value ? [] : displayed(game, index, state.settings.autoCandidates);
    const includedMask = game.manualIncludedCandidates[index] || 0;
    const classes = ['cell', isGiven ? 'given' : 'editable'];
    if (row === selectedRow || col === selectedCol || boxOf(index) === selectedBox) classes.push('related');
    if (selectedValue && value === selectedValue) classes.push('same-number');
    if (index === selected) classes.push('selected');
    if (conflictSet.has(index)) classes.push('conflict');
    const noteGrid = notes.map((digit) => `<span class="cell-note${includedMask & (1 << (digit - 1)) ? ' manual' : ''}" data-note="${digit}" style="grid-column:${((digit - 1) % 3) + 1};grid-row:${Math.floor((digit - 1) / 3) + 1}">${digit}</span>`).join('');
    const display = value ? `<span class="cell-value">${value}</span>` : (notes.length ? `<span class="cell-notes" aria-hidden="true">${noteGrid}</span>` : '');
    const accessibleValue = value ? `数字 ${value}` : (notes.length ? `候補 ${notes.join('、')}` : '空欄');
    const accessibleFlags = [isGiven ? '固定' : '入力可能', conflictSet.has(index) ? '衝突' : ''].filter(Boolean).join('、');
    return `<button class="${classes.join(' ')}" role="gridcell" aria-selected="${index === selected}" aria-label="${row + 1}行${col + 1}列、${accessibleValue}${accessibleFlags ? `、${accessibleFlags}` : ''}" data-cell="${index}">${display}</button>`;
  }).join('');
  const pad = keypadState(game, selected, state.inputMode, state.settings.autoCandidates);
  const padByDigit = new Map(pad.map((key) => [key.digit, key]));
  const numberKey = (digit) => {
    const key = padByDigit.get(digit) || { muted: false, disabled: false };
    const classes = ['number-key'];
    if (key.muted) classes.push('is-muted');
    return `<button class="${classes.join(' ')}" data-action="digit" data-digit="${digit}" aria-label="${digit}"${state.inputMode === 'memo' ? ` aria-pressed="${!key.muted}"` : ''}${completed || key.disabled ? ' disabled title="この数字は入力できません"' : ''}>${digit}</button>`;
  };
  const digits = [1, 3, 5, 7, 9].map(numberKey).join('');
  const evens = [2, 4, 6, 8].map(numberKey).join('');
  const modeMemo = state.inputMode === 'memo';
  const difficulty = difficultyList.includes(game.difficulty) ? game.difficulty : game.difficulty;
  const canClearNotes = !completed && modeMemo && !game.currentBoard[selected];
  return `<main class="screen game-screen${modeMemo ? ' memo-mode' : ''}">
    ${notices(state)}
    <header class="screen-header game-header">
      <div class="header-start"><button class="header-button header-button--back" data-action="home" aria-label="ホームへ戻る">${icon('back')}<span>ホーム</span></button></div>
      <div class="brand" aria-label="SUDOKU">SUDOKU</div>
      <div class="header-end"><button class="header-button header-button--settings" data-action="settings" aria-label="設定を開く">${icon('settings')}</button></div>
    </header>
    <div class="game-meta"><span class="game-difficulty">${html(difficulty)}</span><time class="game-timer" aria-label="経過時間">${formatDuration(elapsed)}</time></div>
    <div class="board-stage">
      <section class="board" role="grid" aria-label="数独盤面">${cells}</section>
      ${completed && state.completionOpen ? completionOverlay(game, state.completionExperience) : ''}
    </div>
    <section class="entry-panel" aria-label="入力"${completed ? ' inert aria-disabled="true"' : ''}>
      <div class="entry-head">
        <span class="mode-label${modeMemo ? ' memo' : ''}" aria-live="polite"><i class="mode-dot"></i>${modeMemo ? '候補メモ' : '数字入力'}</span>
        ${canClearNotes ? '<button class="clear-notes" data-action="clear-notes">候補を消去</button>' : ''}
      </div>
      <div class="number-pad" aria-label="数字キー">
        <div class="number-row">${digits}</div>
        <div class="number-row number-row--even">${evens}</div>
      </div>
      <div class="utility-row" aria-label="操作">
        <button class="utility-button" data-action="undo"${!completed && game.undoStack.length ? '' : ' disabled'} aria-label="元に戻す">${icon('undo')}<span>Undo</span></button>
        <button class="utility-button" data-action="redo"${!completed && game.redoStack.length ? '' : ' disabled'} aria-label="やり直す">${icon('redo')}<span>Redo</span></button>
        <button class="utility-button memo-action${modeMemo ? ' is-active' : ''}" data-action="toggle-mode"${completed ? ' disabled' : ''} aria-pressed="${modeMemo}" aria-label="候補メモ${modeMemo ? '中' : 'に切り替え'}">${icon('memo')}<span>MEMO</span></button>
        <button class="utility-button" data-action="delete"${completed ? ' disabled' : ''} aria-label="${modeMemo && !game.currentBoard[selected] ? '選択セルの候補を消去' : '選択セルの数字を削除'}">${icon('delete')}<span>DEL</span></button>
      </div>
    </section>
    <p class="sr-only" aria-live="polite" aria-atomic="true">${html(state.announce)}</p>
  </main>`;
}

function accountSection(state) {
  const account = state.account;
  const cloud = state.cloud || { status: 'loading', busy: false };
  const labels = { loading: 'ログインを準備中', 'signed-out': 'この端末に保存', syncing: '成績と設定を同期中', synced: '成績と設定を同期済み', error: '成績と設定の同期を確認してください', offline: '端末に保存・オンラインで同期' };
  const guestCount = state.guestScoreCount ?? state.scoreProfiles?.guest?.totalClears ?? 0;
  return `<section class="account-section" aria-label="Google連携">
    <h2 class="setting-label">Google連携</h2>
    <p class="account-name">${html(account ? account.displayName || 'Googleアカウント' : 'ログインなしで利用中')}</p>
    <p class="account-status" role="status">${html(cloud.error || labels[cloud.status] || '')}</p>
    <p class="account-description">成績と設定をGoogleで同期します。途中の盤面はこの端末に保存します。</p>
    <div class="account-actions">${account
      ? `<button class="account-button" data-action="sync-scores"${cloud.busy ? ' disabled' : ''}>成績と設定を同期</button><button class="account-button account-button--quiet" data-action="sign-out"${cloud.busy ? ' disabled' : ''}>ログアウト</button>`
      : `<button class="account-button" data-action="sign-in"${cloud.busy || cloud.status === 'loading' ? ' disabled' : ''}>Googleでログイン</button>`}
    </div>
    ${account && guestCount > 0 ? `<button class="account-button account-import" data-action="import-guest-scores"${cloud.busy ? ' disabled' : ''}>この端末の成績 ${Math.max(0, Number(guestCount) || 0)}問を取り込む</button>` : ''}
  </section>`;
}

function settingsView(state) {
  const themes = THEMES.map((theme) => `<button class="theme-option" data-action="set-theme" data-theme="${html(theme.id)}" aria-pressed="${state.settings.theme === theme.id}">
    <span class="theme-swatch" style="--swatch-color:${html(theme.color)};--swatch-paper:${html(theme.paper)}" aria-hidden="true"></span>
    <span class="theme-label">${html(theme.label)}</span>
  </button>`).join('');
  return `<main class="screen simple-screen">
    ${notices(state)}
    ${pageHeader('設定')}
    <div class="simple-content">
      <div class="settings-list">
        <div class="setting-row">
          <span class="setting-label" id="auto-candidates-label">自動候補表示</span>
          <button class="switch" role="switch" aria-checked="${Boolean(state.settings.autoCandidates)}" aria-labelledby="auto-candidates-label" data-action="toggle-auto"></button>
        </div>
        <div class="setting-row">
          <span class="setting-label" id="auto-fill-label">候補が1つのとき自動入力</span>
          <button class="switch" role="switch" aria-checked="${state.settings.autoFill !== false}" aria-labelledby="auto-fill-label" data-action="toggle-auto-fill"></button>
        </div>
        <section class="theme-setting" aria-labelledby="theme-setting-label">
          <h2 class="setting-label" id="theme-setting-label">配色テーマ</h2>
          <div class="theme-options" role="group" aria-labelledby="theme-setting-label">${themes}</div>
        </section>
        <button class="settings-link" data-action="stats"><span>成績を見る</span>${icon('chevron')}</button>
        ${accountSection(state)}
      </div>
    </div>
  </main>`;
}

function statsView(state, difficulties) {
  const stats = state.stats;
  const items = difficulties.map((difficulty) => {
    const value = stats.byDifficulty?.[difficulty] || { clears: 0, bestTime: null };
    const best = Number.isFinite(value.bestTime) ? formatDuration(value.bestTime) : '—';
    return `<div class="stats-row"><span class="stats-difficulty">${html(difficulty)}</span><span class="stats-clears">${Math.max(0, Number(value.clears) || 0)} 問</span><span class="stats-best">${best}</span></div>`;
  }).join('');
  return `<main class="screen simple-screen">
    ${notices(state)}
    ${pageHeader('成績')}
    <div class="simple-content">
      <div class="stats-total"><span class="stats-total-label">クリア数</span><strong class="stats-total-value">${Math.max(0, Number(stats.totalClears) || 0)}</strong></div>
      <div class="stats-list" aria-label="難易度別成績">${items}</div>
      ${accountSection(state)}
    </div>
  </main>`;
}

function completionExperienceView(experience) {
  if (!experience || !Number.isFinite(Number(experience.level)) || !Number.isFinite(Number(experience.progress))) return '';
  const level = Math.max(1, Math.floor(Number(experience.level)));
  const progress = Math.max(0, Math.min(100, Number(experience.progress)));
  const title = getLevelTitle(level);
  return `<div class="clear-experience" data-experience-overlay>
    <div class="experience-track" data-experience-track role="progressbar" aria-label="次のレベルまで" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(progress)}"><span class="experience-fill" data-experience-fill style="width:${progress}%"></span></div>
    <div class="experience-label"><strong data-experience-level>Lv${level}</strong><span data-experience-title>${html(title)}</span></div>
  </div>`;
}

function completionOverlay(game, experience) {
  return `<section class="clear-overlay" role="status" aria-label="CLEAR">
    <span class="clear-paper-pieces" aria-hidden="true">${Array.from({ length: 6 }, (_, index) => `<i data-clear-piece style="--piece:${index}"></i>`).join('')}</span>
    <button class="clear-close" data-action="dismiss-completion" aria-label="完成表示を閉じる">×</button>
    <strong class="clear-title">CLEAR</strong>
    <p class="clear-result"><span>${html(game.difficulty)}</span><time>${formatDuration(game.elapsedTime)}</time></p>
    ${completionExperienceView(experience)}
    <button class="clear-home primary-action" data-action="home">ホームへ</button>
  </section>`;
}

export function renderApp(root, state, difficulties, helpers) {
  const previousScroll = root.scrollTop;
  const focusedTheme = root.querySelector('[data-action="set-theme"]:focus')?.dataset.theme;
  let view;
  if (state.view === 'home') view = homeView(state, difficulties, helpers.isComplete);
  else if (state.view === 'game' && state.currentGame) view = gameView(state, difficulties, helpers);
  else if (state.view === 'settings') view = settingsView(state);
  else if (state.view === 'stats') view = statsView(state, difficulties);
  else view = '<main class="screen loading-screen" aria-busy="true"><span class="brand">SUDOKU</span><span class="loading-mark" aria-hidden="true"></span></main>';
  root.innerHTML = view;
  root.scrollTop = previousScroll;
  if (state.view === 'settings' && THEMES.some(theme => theme.id === focusedTheme)) {
    root.querySelector(`[data-theme="${focusedTheme}"]`)?.focus({ preventScroll: true });
  } else if (state.view === 'game' && state.completionOpen) {
    root.querySelector('[data-action="dismiss-completion"]')?.focus({ preventScroll: true });
  } else if (state.view === 'game' && Number.isInteger(state.selectedCell)) {
    root.querySelector(`[data-cell="${state.selectedCell}"]`)?.focus({ preventScroll: true });
  }
}
