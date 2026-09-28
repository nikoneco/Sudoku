import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const root = process.cwd();
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/') { res.writeHead(302, { Location: '/Sudoku/' }); res.end(); return; }
    if (!url.pathname.startsWith('/Sudoku/')) throw new Error('not found');
    const relative = decodeURIComponent(url.pathname.slice(8)) || 'index.html';
    if (relative.split('/').some(p => p.startsWith('.')) || /\\/.test(relative)) throw new Error('private');
    const target = path.resolve(root, relative);
    if (!target.startsWith(root + path.sep)) throw new Error('path');
    const content = await readFile(target);
    res.writeHead(200, { 'Content-Type': mime[path.extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }); res.end(content);
  } catch { res.writeHead(404); res.end('Not found'); }
});
const port = Number(process.env.PORT || 4173);
server.listen(port, '127.0.0.1', () => console.log(`Sudoku: http://127.0.0.1:${port}/Sudoku/`));
