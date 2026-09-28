const paths = {
  back: '<path d="m15 18-6-6 6-6"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.7a7.8 7.8 0 0 1-1.5.9l-.3 1.8h-2.8l-.3-1.8a7.8 7.8 0 0 1-1.5-.9l-1.7.7-1.4-2.4L7.8 15a7.9 7.9 0 0 1 0-1.8l-1.5-1.1 1.4-2.4 1.7.7a7.8 7.8 0 0 1 1.5-.9l.3-1.8H14l.3 1.8a7.8 7.8 0 0 1 1.5.9l1.7-.7 1.4 2.4-1.5 1.1a7.9 7.9 0 0 1 0 1.8Z" transform="translate(-2 -2) scale(1.16)"/>',
  stats: '<path d="M4 19V9h4v10M10 19V5h4v14M16 19V2h4v17M2 21h20"/>',
  undo: '<path d="M3 7v6h6M4 13c2-5 7-7 12-5 3 1 5 4 5 8"/>',
  redo: '<path d="M21 7v6h-6M20 13c-2-5-7-7-12-5-3 1-5 4-5 8"/>',
  memo: '<path d="m4 16.5-.8 4.3 4.3-.8L20 7.5 16.5 4 4 16.5Z"/><path d="m14.8 5.7 3.5 3.5"/>',
  delete: '<path d="M4 7h16M10 11v6m4-6v6M6 7l1 14h10l1-14M9 7V4h6v3"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  grid: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>',
};

export function icon(name, className = '') {
  const content = paths[name] || paths.grid;
  return `<svg class="icon${className ? ` ${className}` : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${content}</svg>`;
}
