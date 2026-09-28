import { API_URL } from '../config.js';

/** GAS JSON with bounded timeout; JSONP is isolated to this trusted read API. */
export async function requestApi(action, params = {}) {
  if (!['health', 'meta', 'sync', 'puzzles'].includes(action)) throw new Error('不明なAPIです。');
  const url = new URL(API_URL);
  url.search = new URLSearchParams({ ...params, action }).toString();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch(url, { signal: controller.signal, credentials: 'omit', cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return check(await response.json());
  } catch (error) {
    if (typeof document === 'undefined') throw error;
    return await jsonp(url);
  } finally { clearTimeout(timeout); }
}

function check(data) {
  if (!data || data.error) throw new Error(data?.error || '問題DBから取得できませんでした。');
  return data;
}

function jsonp(url) {
  return new Promise((resolve, reject) => {
    const name = `sudoku_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const script = document.createElement('script');
    let timer;
    const cleanup = () => { clearTimeout(timer); script.remove(); delete window[name]; };
    window[name] = value => { cleanup(); try { resolve(check(value)); } catch (error) { reject(error); } };
    script.onerror = () => { cleanup(); reject(new Error('問題DBに接続できませんでした。')); };
    timer = setTimeout(() => { cleanup(); reject(new Error('問題DBの応答がありません。')); }, 10000);
    url.searchParams.set('callback', name);
    script.src = url.href;
    document.head.append(script);
  });
}
