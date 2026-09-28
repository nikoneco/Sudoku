import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('service worker reads only its named cache and bypasses stale HTTP assets during install', async () => {
  const listeners = {};
  const requestedCaches = [];
  let installRequests;
  const ownCache = { match: async () => 'current-sudoku', addAll: async requests => { installRequests = requests; } };
  const context = {
    URL, Request, Response,
    self: { registration: { scope: 'https://example.test/Sudoku/' }, location: { origin: 'https://example.test' }, addEventListener: (name, handler) => { listeners[name] = handler; } },
    caches: { open: async name => { requestedCaches.push(name); return ownCache; }, match: () => { throw new Error('Must not read another application cache'); } },
    fetch: () => { throw new Error('Cached shell should work offline'); },
  };
  vm.runInNewContext(readFileSync(new URL('../sw.js', import.meta.url), 'utf8'), context);
  let pending;
  listeners.install({ waitUntil: promise => { pending = promise; } });
  await pending;
  assert.ok(installRequests.length > 10);
  assert.ok(installRequests.every(request => request.cache === 'reload'));
  for (const mode of ['navigate', 'cors']) {
    let response;
    listeners.fetch({ request: { method: 'GET', mode, url: 'https://example.test/Sudoku/index.html' }, respondWith: promise => { response = promise; } });
    assert.equal(await response, 'current-sudoku');
  }
  assert.ok(requestedCaches.every(name => name === 'sudoku-shell-v1.1.0'));
  assert.ok(installRequests.some(request => request.url.endsWith('/js/ui/keypad.js')));
  let intercepted = false;
  listeners.fetch({ request: { method: 'GET', mode: 'cors', url: 'https://example.test/OtherApp/' }, respondWith: () => { intercepted = true; } });
  assert.equal(intercepted, false);
});
