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
  // Fixture: one video wallpaper in defaultprojects, two web wallpapers in a
  // workshop library — one flat (index.html + relative assets, exactly what a
  // browser must resolve), one with a NESTED entry file — plus a scene entry
  // that must NOT surface (browsers cannot render .pkg scene packages).
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
  mkdirSync(join(webDir, 'js'), { recursive: true });
  writeFileSync(join(webDir, 'project.json'), JSON.stringify({ title: 'Webby', type: 'web', file: 'index.html' }));
  writeFileSync(join(webDir, 'index.html'), '<html><script src="app.js"></script><script src="js/util.js"></script></html>');
  writeFileSync(join(webDir, 'app.js'), 'console.log(1)');
  writeFileSync(join(webDir, 'js', 'util.js'), 'export const pi = Math.PI;');
  const web2Dir = join(lib, 'steamapps', 'workshop', 'content', '431960', 'web2');
  mkdirSync(join(web2Dir, 'bin'), { recursive: true });
  writeFileSync(join(web2Dir, 'project.json'), JSON.stringify({ title: 'Nested', type: 'web', file: 'bin/start.html' }));
  writeFileSync(join(web2Dir, 'bin', 'start.html'), '<html><script src="lib.js"></script></html>');
  writeFileSync(join(web2Dir, 'bin', 'lib.js'), 'nested-ok');
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
  assert.equal(inventory.total, 3);
  assert.equal(inventory.portableCount, 3);
  const vid = inventory.wallpapers.find((w) => w.id === 'vid1');
  const web = inventory.wallpapers.find((w) => w.id === 'web1');
  const web2 = inventory.wallpapers.find((w) => w.id === 'web2');
  assert.ok(vid && web && web2);
  assert.ok(vid.playable && vid.media.startsWith('/we-background/media/'));
  assert.ok(vid.preview.startsWith('/we-background/preview/'));
  // Web media URLs are addressed at the ENTRY FILE so the document URL
  // mirrors the project directory — flat entries and nested entries alike.
  assert.ok(web.playable);
  assert.match(web.media, /^\/we-background\/media\/[^/]+\/index\.html$/);
  assert.match(web2.media, /^\/we-background\/media\/[^/]+\/bin\/start\.html$/);
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
  const webRoot = web.media.slice(0, web.media.lastIndexOf('/'));

  const asset = await get(`${webRoot}/app.js`);
  assert.equal(asset.status, 200);
  assert.equal(await asset.text(), 'console.log(1)');

  // `..` traversal (encoded or bare), backslash tricks, and sub-assets on a
  // non-web token are all refused; the secret file must never be served.
  for (const attempt of [
    `${webRoot}/..%2F..%2F..%2F..%2Fsecret.txt`,
    `${webRoot}/..%5C..%5Csecret.txt`,
    `${webRoot}/index.html/../../../secret.txt`,
    `${vid.media}/app.js`, // video token has no rootDir
    `${vid.preview}/app.js`, // preview tokens never carry sub-assets
  ]) {
    const res = await get(attempt);
    assert.ok(res.status === 403 || res.status === 404, `${attempt} → ${res.status}`);
    assert.notEqual(await res.text(), 'must-never-leak');
  }
});

test('web documents: what a BROWSER resolves actually serves (the blank-wallpaper regression)', async () => {
  const web = inventory.wallpapers.find((w) => w.id === 'web1');
  const web2 = inventory.wallpapers.find((w) => w.id === 'web2');

  // The document itself.
  const doc = await get(web.media);
  assert.equal(doc.status, 200);
  assert.equal(doc.headers.get('content-type'), 'text/html; charset=utf-8');
  const html = await doc.text();
  assert.ok(html.includes('app.js'));

  // Exactly the URLs a browser resolves for the wallpaper's relative
  // references inside that document — the old bare-token URL made these
  // resolve one directory too high (…/media/app.js → 404 → blank iframe).
  for (const [base, ref, expectedBody] of [
    [web.media, 'app.js', 'console.log(1)'],
    [web.media, 'js/util.js', 'export const pi = Math.PI;'],
    [web2.media, 'lib.js', 'nested-ok'], // relative to the NESTED document dir
  ]) {
    const resolved = new URL(ref, `http://x${base}`).pathname;
    const res = await get(resolved);
    assert.equal(res.status, 200, `${ref} → ${resolved}`);
    assert.equal(await res.text(), expectedBody);
  }

  // Directory form (`…/media/<token>/`) serves the entry document itself.
  const dir = await get(web.media.slice(0, web.media.lastIndexOf('/')) + '/');
  assert.equal(dir.status, 200);
  assert.equal(await dir.text(), html);
  // …but a preview token has no directory form.
  const vid = inventory.wallpapers.find((w) => w.id === 'vid1');
  const badDir = await get(vid.preview + '/');
  assert.ok(badDir.status === 404 || badDir.status === 403, String(badDir.status));
});

test('tokens survive TTL rebuilds for entry-file URLs (prune reads the first segment)', async () => {
  const web = inventory.wallpapers.find((w) => w.id === 'web1');
  // Non-forced rebuild (TTL elapsed): tokens are reused, then pruned against
  // the payload. A prune that read the LAST path segment would take
  // `index.html` for the token, kill the live one, and blank the wallpaper.
  await get('/we-background/inventory');
  const doc = await get(web.media);
  assert.equal(doc.status, 200);
});

test('CORS: media is readable from the sandboxed iframe (opaque origin)', async () => {
  const vid = inventory.wallpapers.find((w) => w.id === 'vid1');
  const res = await get(vid.media, { range: 'bytes=0-3' });
  assert.equal(res.headers.get('access-control-allow-origin'), '*');

  const pre = await fetch(`http://127.0.0.1:${port}${vid.media}`, { method: 'OPTIONS' });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), '*');
  assert.equal(pre.headers.get('access-control-allow-methods'), 'GET, HEAD, OPTIONS');
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
