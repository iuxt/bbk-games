import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function harness() {
  const buckets = new Map();
  const handlers = {};
  const key = req => new URL(typeof req === 'string' ? req : req.url, 'https://bbk.test').href;
  const context = {
    self: { location: { origin: 'https://bbk.test' }, addEventListener(name, fn) { handlers[name] = fn; } },
    caches: {
      async open(name) {
        if (!buckets.has(name)) buckets.set(name, new Map());
        const data = buckets.get(name);
        return { async match(req) { return data.get(key(req))?.clone(); }, async put(req, res) { data.set(key(req), res); } };
      },
    },
    fetch: async () => new Response('new'), Request, Response, URL, Set,
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('sw.js', 'utf8'), context);
  async function request(path, mode = 'cors') {
    let result;
    const waits = [];
    handlers.fetch({ request: { url: key(path), method: 'GET', mode },
      respondWith(p) { result = p; }, waitUntil(p) { waits.push(p); } });
    const response = await result;
    await Promise.all(waits);
    return response.text();
  }
  // Native Request requires a real Request; use it for stale-while-revalidate.
  context.Request = class extends Request { constructor(req, options) { super(req.url || req, options); } };
  return { context, request, seed: (name, path, body) => vm.runInContext(`caches.open(${name})`, context).then(c => c.put(path, new Response(body))) };
}

test('background refresh takes precedence over the shell copy on subsequent visits and offline', async () => {
  const h = harness();
  await h.seed('SHELL_CACHE', '/css/portal.css?v=3', 'old');
  assert.equal(await h.request('/css/portal.css?v=3'), 'old');
  assert.equal(await h.request('/css/portal.css?v=3'), 'new');
  h.context.fetch = async () => { throw new Error('offline'); };
  assert.equal(await h.request('/css/portal.css?v=3'), 'new');
});

test('offline navigation prefers the latest runtime HTML, with a shell fallback', async () => {
  const h = harness();
  await h.seed('SHELL_CACHE', '/rpg/index.html', 'old html');
  assert.equal(await h.request('/rpg/index.html', 'navigate'), 'new');
  h.context.fetch = async () => { throw new Error('offline'); };
  assert.equal(await h.request('/rpg/index.html', 'navigate'), 'new');
  await h.seed('SHELL_CACHE', '/index.html', 'portal');
  assert.equal(await h.request('/unknown', 'navigate'), 'portal');
});
