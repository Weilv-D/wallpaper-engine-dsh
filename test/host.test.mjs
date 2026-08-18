/**
 * Integration tests for the host HTTP surface (lib/index.js).
 *
 * Not mocked unit tests: a REAL fixture Wallpaper Engine install in a temp
 * dir, the REAL route registrar, and a REAL loopback HTTP server — every
 * assertion goes over the wire through node:fetch. This is the security
 * boundary of the bundle (token resolution, sub-asset containment, Range
 * semantics), so it is tested exactly as the browser will consume it.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  mkdirSync, mkdtempSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createRouteRegistrar } from '../lib/index.js';

let tmp;
let server;
let port;
let disposeRoutes;
let inventory;

function mockWebServer() {
  const exact = new Map();
  const prefixes = [];
  return {
    register(route) {
      if (route.kind === 'exact') exact.set(route.path, route.handler);
      else prefixes.push(route);
      return () => {
        if (route.kind === 'exact') exact.delete(route.path);
        else prefixes.splice(prefixes.indexOf(route), 1);
      };
    },
    dispatch(req, res) {
      const path = new URL(req.url || '/', 'http://x').pathname;
      if (exact.has(path)) return exact.get(path)(req, res);
      const prefix = prefixes.find((r) => path.startsWith(r.path + '/'));
      if (prefix) return prefix.handler(req, res);
      res.statusCode = 404;
      res.end('unrouted');
    },
  };
}

function get(path, headers) {
  return fetch(`http://127.0.0.1:${port}${path}`, { headers });
}

before(async () => {
  // Fixture: one video wallpaper in defaultprojects, one web wallpaper in a
  // workshop library — plus a scene entry that must NOT surface (browsers
  // cannot render .pkg scene packages).
  tmp = mkdtempSync(join(tmpdir(), 'webg-host-'));
  const installDir = join(tmp, 'we');
  const vidDir = join(installDir, 'projects', 'defaultprojects', 'vid1');
  mkdirSync(vidDir, { recursive: true });
  writeFileSync(join(vidDir, 'project.json'), JSON.stringify({
    title: 'Clip', type: 'video', file: 'a.mp4', preview: 'p.jpg',
  }));
  writeFileSync(join(vidDir, 'a.mp4'), '0123456789');
  writeFileSync(join(vidDir, 'p.jpg'), 'jpeg-bytes');

  const lib = join(tmp, 'lib');
  const webDir = join(lib, 'steamapps', 'workshop', 'content', '431960', 'web1');
  mkdirSync(webDir, { recursive: true });
  writeFileSync(join(webDir, 'project.json'), JSON.stringify({ title: 'Webby', type: 'web', file: 'index.html' }));
  writeFileSync(join(webDir, 'index.html'), '<html><script src="app.js"></script></html>');
  writeFileSync(join(webDir, 'app.js'), 'console.log(1)');
  const sceneDir = join(lib, 'steamapps', 'workshop', 'content', '431960', 'sc1');
  mkdirSync(sceneDir, { recursive: true });
  writeFileSync(join(sceneDir, 'project.json'), JSON.stringify({ title: 'PkgScene', type: 'scene', file: 'x.pkg', preview: 'p.jpg' }));
  writeFileSync(join(sceneDir, 'p.jpg'), 'jpg');
  writeFileSync(join(tmp, 'secret.txt'), 'must-never-leak');

  const registry = mockWebServer();
  disposeRoutes = createRouteRegistrar(registry, {
    discover: async () => ({ installDir, libraryRoots: [lib] }),
    inventoryTtlMs: 0, // every request rebuilds → exercises token stability
  });

  server = http.createServer((req, res) => registry.dispatch(req, res));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;

  const res = await get('/we-background/inventory');
  inventory = await res.json();
});

after(async () => {
  disposeRoutes();
  await new Promise((r) => server.close(r));
  rmSync(tmp, { recursive: true, force: true });
});

test('inventory: fields, tokens, both renderable kinds present', () => {
  assert.equal(inventory.total, 2);
  assert.equal(inventory.portableCount, 2);
  const vid = inventory.wallpapers.find((w) => w.id === 'vid1');
  const web = inventory.wallpapers.find((w) => w.id === 'web1');
  assert.ok(vid && web);
  assert.ok(vid.playable && vid.media.startsWith('/we-background/media/'));
  assert.ok(vid.preview.startsWith('/we-background/preview/'));
  assert.ok(web.playable && web.media.startsWith('/we-background/media/'));
  // The scene fixture is filtered out: .pkg packages are not renderable.
  assert.ok(!inventory.wallpapers.some((w) => w.id === 'sc1'));
  assert.ok(!JSON.stringify(inventory).includes('PkgScene'));
});

test('media: full GET, HEAD, single range, suffix range', async () => {
  const vid = inventory.wallpapers.find((w) => w.id === 'vid1');

  const full = await get(vid.media);
  assert.equal(full.status, 200);
  assert.equal(full.headers.get('content-type'), 'video/mp4');
  assert.equal(full.headers.get('content-length'), '10');
  assert.equal(full.headers.get('accept-ranges'), 'bytes');
  assert.equal(await full.text(), '0123456789');

  const head = await fetch(`http://127.0.0.1:${port}${vid.media}`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-length'), '10');
  assert.equal(await head.text(), '');

  const range = await get(vid.media, { range: 'bytes=2-5' });
  assert.equal(range.status, 206);
  assert.equal(range.headers.get('content-range'), 'bytes 2-5/10');
  assert.equal(await range.text(), '2345');

  const suffix = await get(vid.media, { range: 'bytes=-3' });
  assert.equal(suffix.status, 206);
  assert.equal(await suffix.text(), '789');
});

test('media: unsatisfiable range 416; multi-range and garbage are IGNORED (200)', async () => {
  const vid = inventory.wallpapers.find((w) => w.id === 'vid1');
  const unsat = await get(vid.media, { range: 'bytes=99-120' });
  assert.equal(unsat.status, 416);
  assert.equal(unsat.headers.get('content-range'), 'bytes */10');

  const multi = await get(vid.media, { range: 'bytes=0-1,5-6' });
  assert.equal(multi.status, 200); // RFC 9110 §14.2: unsupported → ignore
  assert.equal(await multi.text(), '0123456789');

  const junk = await get(vid.media, { range: 'bytes=abc' });
  assert.equal(junk.status, 200);
});

test('tokens: stable across TTL rebuilds, re-minted on explicit refresh', async () => {
  const vid = inventory.wallpapers.find((w) => w.id === 'vid1');
  // inventoryTtlMs: 0 → this plain GET already rebuilt the inventory, yet
  // the token still resolves (in-flight streams are never killed).
  const stillThere = await get(vid.media);
  assert.equal(stillThere.status, 200);

  const refreshed = await (await get('/we-background/inventory?refresh=1')).json();
  const vid2 = refreshed.wallpapers.find((w) => w.id === 'vid1');
  assert.notEqual(vid2.media, vid.media); // explicit refresh re-mints
  const dead = await get(vid.media);
  assert.equal(dead.status, 404); // the stale URL dies
  inventory = refreshed; // later tests use the fresh tokens
});

test('sub-assets: contained fetch works; every escape is refused', async () => {
  const web = inventory.wallpapers.find((w) => w.id === 'web1');
  const vid = inventory.wallpapers.find((w) => w.id === 'vid1');

  const asset = await get(`${web.media}/app.js`);
  assert.equal(asset.status, 200);
  assert.equal(await asset.text(), 'console.log(1)');

  // `..` traversal (encoded or bare), backslash tricks, and sub-assets on a
  // non-web token are all refused; the secret file must never be served.
  for (const attempt of [
    `${web.media}/..%2F..%2F..%2F..%2Fsecret.txt`,
    `${web.media}/..%5C..%5Csecret.txt`,
    `${web.media}/../../secret.txt`,
    `${vid.media}/app.js`, // video token has no rootDir
    `${vid.preview}/app.js`, // preview tokens never carry sub-assets
  ]) {
    const res = await get(attempt);
    assert.ok(res.status === 403 || res.status === 404, `${attempt} → ${res.status}`);
    assert.notEqual(await res.text(), 'must-never-leak');
  }
});

test('inventory HEAD and method guards', async () => {
  const head = await fetch(`http://127.0.0.1:${port}/we-background/inventory`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.ok(Number(head.headers.get('content-length')) > 0);
  assert.equal(await head.text(), '');

  const post = await fetch(`http://127.0.0.1:${port}/we-background/inventory`, { method: 'POST' });
  assert.equal(post.status, 405);

  const unknown = await get('/we-background/media/not-a-token');
  assert.equal(unknown.status, 404);
});
