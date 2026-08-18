/**
 * Unit tests for the pure logic layer (lib/core.js).
 * Run with: npm test
 *
 * Filesystem cases build fixture trees in a temp dir; everything else is
 * pure string/structure in, structure out. The enumeration/discovery
 * functions are async (the host injects fs/promises so the event loop never
 * blocks); the default sync io works transparently under await.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdirSync, mkdtempSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import * as core from '../lib/core.js';

// ── KeyValues parser ─────────────────────────────────────────────────────────

test('parseKeyValues: nesting, escapes, comments, bare tokens', () => {
  const tree = core.parseKeyValues(`
    // a comment
    "libraryfolders"
    {
      "0"
      {
        "path"    "C:\\\\Program Files (x86)\\\\Steam"
        "label"   ""
        "apps"
        {
          "431960"   "1700000000"
        }
      }
      "1"   "D:\\\\SteamLibrary"
    }
  `);
  const root = tree.libraryfolders;
  // Parser output is the RAW VDF string with escapes unfolded — assert the
  // literal characters, NOT path.resolve() of a Windows path (resolve() only
  // behaves Windows-ly on Windows; this suite also runs in Linux CI).
  assert.equal(root['0'].path, 'C:\\Program Files (x86)\\Steam');
  assert.equal(root['0'].apps['431960'], '1700000000');
  assert.equal(root['1'], 'D:\\SteamLibrary');
});

test('parseKeyValues: later duplicate key wins; malformed input degrades', () => {
  assert.equal(core.parseKeyValues('"a" { "k" "1" "k" "2" }').a.k, '2');
  assert.deepEqual(core.parseKeyValues(''), {});
  assert.equal(typeof core.parseKeyValues('"unterminated { "x" "y"'), 'object');
});

test('librariesFromVdfText: EXACT appid match (no substring false positives)', () => {
  const libs = core.librariesFromVdfText(`
    "libraryfolders"
    {
      "0" { "path" "C:\\\\Steam" "apps" { "431960" "1" "1431960" "2" } }
      "1" { "path" "D:\\\\SteamLibrary" "apps" { "14319600" "3" } }
      "2" "E:\\\\LegacyLibrary"
    }
  `);
  // Owns 431960 exactly:
  assert.ok(libs.some((p) => p.toLowerCase().endsWith('steam')));
  // Only 14319600 / 1431960 as substrings → NOT owners:
  assert.ok(!libs.some((p) => p.toLowerCase().includes('steamlibrary')));
  // Legacy bare-string entry is included as a probe:
  assert.ok(libs.some((p) => p.toLowerCase().includes('legacylibrary')));
});

test('librariesFromVdfText: garbage in, empty out', () => {
  assert.deepEqual(core.librariesFromVdfText('not vdf at all'), []);
  assert.deepEqual(core.librariesFromVdfText('"other" { "x" "y" }'), []);
});

test('steamPathFromRegQuery: parses reg.exe output, tolerates junk', () => {
  const out = '\r\nHKEY_CURRENT_USER\\Software\\Valve\\Steam\r\n    SteamPath    REG_SZ    D:/Apps/Steam\r\n\r\n';
  // The function returns normalize()'d output (native separators per OS);
  // compare in a platform-free canonical form instead of resolve().
  const norm = (s) => String(s).toLowerCase().replace(/[\\/]/g, '');
  assert.equal(norm(core.steamPathFromRegQuery(out)), 'd:appssteam');
  assert.equal(core.steamPathFromRegQuery('ERROR: The system was unable to find the specified registry key or value.'), null);
});

// ── Discovery against fixture trees ──────────────────────────────────────────

async function withTemp(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'webg-'));
  try { return await fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

function makeInstall(dir) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'wallpaper32.exe'), '');
  return dir;
}

test('findInstallDir: first candidate containing the binary wins; dedupe', () => withTemp(async (t) => {
  const a = join(t, 'a');
  const b = join(t, 'b');
  mkdirSync(a, { recursive: true }); // no binary
  makeInstall(b);
  assert.equal(await core.findInstallDir([a, b, b, join(t, 'missing')]), b);
  assert.equal(await core.findInstallDir([a, join(t, 'missing')]), null);
}));

test('findInstallDir: async io injection (what the host passes)', () => withTemp(async (t) => {
  const yes = join(t, 'yes');
  makeInstall(yes);
  const io = { existsSync: async (p) => p.startsWith(yes) };
  assert.equal(await core.findInstallDir([join(t, 'no'), yes], io), yes);
}));

test('installDirCandidates: registry root first, standalone fallback last', () => {
  const c = core.installDirCandidates({
    registryRoot: 'D:\\Apps\\Steam',
    libraryRoots: ['E:\\SteamLibrary'],
    platform: 'win32',
    home: () => 'C:\\Users\\x',
  });
  assert.equal(c[0], join('D:\\Apps\\Steam', 'steamapps', 'common', 'wallpaper_engine'));
  assert.ok(c.some((p) => p === join('E:\\SteamLibrary', 'steamapps', 'common', 'wallpaper_engine')));
  assert.equal(c[c.length - 1], 'C:\\Program Files (x86)\\Wallpaper Engine');
});

test('workshopLibraryRoots: default library recovered by binary presence', () => withTemp(async (t) => {
  const probe = join(t, 'steam');
  makeInstall(join(probe, 'steamapps', 'common', 'wallpaper_engine'));
  const vdfLib = join(t, 'elsewhere');
  const libs = await core.workshopLibraryRoots([probe], [vdfLib]);
  assert.ok(libs.includes(vdfLib));
  assert.ok(libs.includes(probe)); // recovered despite no vdf "path" entry
}));

// ── Containment ──────────────────────────────────────────────────────────────

test('isInsideDir: containment, equality, traversal and sibling-prefix traps', () => withTemp(async (t) => {
  const root = join(t, 'proj');
  assert.ok(core.isInsideDir(root, join(root, 'a', 'b.mp4')));
  assert.ok(core.isInsideDir(root, root));
  assert.ok(!core.isInsideDir(root, join(t, 'proj2', 'x'))); // sibling-prefix trap
  assert.ok(!core.isInsideDir(root, join(root, '..', 'outside'))); // resolves out
  assert.ok(!core.isInsideDir(root, join(t, 'other')));
}));

test('isInsideDir: case-insensitive on win32, sensitive elsewhere', () => {
  assert.ok(core.isInsideDir('C:\\Root', 'c:\\root\\f.mp4', 'win32'));
  assert.ok(!core.isInsideDir('/Root', '/root/f.mp4', 'linux'));
});

test('isInsideDir: win32 sibling-prefix trap with backslash paths', () => {
  // C:\RootX must NOT be contained in C:\Root — boundary is a separator,
  // not a string prefix. (Canonicalization lowercases + normalizes slashes,
  // so this holds on any host OS.)
  assert.ok(!core.isInsideDir('C:\\Root', 'C:\\RootX\\f.mp4', 'win32'));
  assert.ok(!core.isInsideDir('C:/Root', 'C:/RootX/f.mp4', 'win32'));
  assert.ok(core.isInsideDir('C:\\Root', 'C:\\Root\\f.mp4', 'win32'));
});

// ── Project model ────────────────────────────────────────────────────────────

test('readProject: valid video project; preview containment; escaping file rejected', () => withTemp(async (t) => {
  const dir = join(t, 'proj');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'project.json'), JSON.stringify({
    title: 'Ocean', type: 'video', file: 'ocean.mp4', preview: 'preview.jpg',
  }));
  const p = await core.readProject(dir);
  assert.equal(p.id, 'proj');
  assert.equal(p.title, 'Ocean');
  assert.equal(p.type, 'video');
  assert.equal(p.fileAbs, resolve(dir, 'ocean.mp4'));
  assert.equal(p.previewAbs, resolve(dir, 'preview.jpg'));

  writeFileSync(join(dir, 'project.json'), JSON.stringify({ file: '../../secret.mp4' }));
  assert.equal(await core.readProject(dir), null); // escapes project dir → rejected

  assert.equal(await core.readProject(join(t, 'missing')), null);
}));

test('readProject: invalid declared type falls back to extension inference', () => withTemp(async (t) => {
  const dir = join(t, 'proj');
  mkdirSync(dir, { recursive: true });
  // Trailing whitespace / typo in "type" is not evidence of "scene".
  writeFileSync(join(dir, 'project.json'), JSON.stringify({ file: 'a.mp4', type: 'video ' }));
  assert.equal((await core.readProject(dir)).type, 'video');
  writeFileSync(join(dir, 'project.json'), JSON.stringify({ file: 'a.mp4', type: 'vido' }));
  assert.equal((await core.readProject(dir)).type, 'video');
  // No extension hint → scene.
  writeFileSync(join(dir, 'project.json'), JSON.stringify({ file: 'wall.pkg', type: 'nonsense' }));
  assert.equal((await core.readProject(dir)).type, 'scene');
}));

test('inferType: extension fallback', () => {
  assert.equal(core.inferType('a.mp4'), 'video');
  assert.equal(core.inferType('b.HTML'), 'web');
  assert.equal(core.inferType('c.pkg'), 'scene');
});

test('enumerateWallpapers: merges roots, first id wins, sorts by title', () => withTemp(async (t) => {
  const root1 = join(t, 'r1');
  const root2 = join(t, 'r2');
  for (const [root, id, title] of [
    [root1, 'b', 'Bravo'],
    [root1, 'a', 'alpha'],
    [root2, 'a', 'duplicate-id-loses'],
    [root2, 'c', 'Charlie'],
  ]) {
    mkdirSync(join(root, id), { recursive: true });
    writeFileSync(join(root, id, 'project.json'), JSON.stringify({ title, file: 'f.mp4' }));
  }
  writeFileSync(join(root1, 'loose-file.txt'), 'not a project');
  const all = await core.enumerateWallpapers([root1, root2, join(t, 'missing')]);
  assert.deepEqual(all.map((w) => w.title), ['alpha', 'Bravo', 'Charlie']);
  assert.equal(all.find((w) => w.id === 'a').title, 'alpha'); // first occurrence wins
}));

// ── Playlists ────────────────────────────────────────────────────────────────

test('parsePlaylists: modern schema, dedupe, defaults', () => {
  const playlists = core.parsePlaylists({
    profile1: {
      general: {
        playlists: [
          { name: 'Chill', items: ['x', 'y', 'x'], settings: { order: 'random', delay: 10 } },
          { name: 'Chill', items: ['x', 'y'], settings: { order: 'random', delay: 10 } }, // dup
          { name: '', items: ['z'] }, // unnamed + no settings
        ],
      },
    },
  });
  assert.equal(playlists.length, 2);
  assert.deepEqual(playlists[0], { name: 'Chill', items: ['x', 'y'], order: 'random', delay: 10 });
  assert.equal(playlists[1].order, 'sequence');
  assert.equal(playlists[1].delay, null);
});

test('parsePlaylists: legacy selectedwallpapers schema', () => {
  const playlists = core.parsePlaylists({
    profile: {
      general: {
        wallpaperconfig: {
          selectedwallpapers: {
            monitor0: { playlist: { name: 'Old', items: ['p'] } },
          },
        },
      },
    },
  });
  assert.equal(playlists.length, 1);
  assert.equal(playlists[0].name, 'Old');
});

test('resolvePlaylistItem: exact path, workshop fragment, trailing folder', () => {
  const byId = new Map([['projA', {}], ['1234567890', {}]]);
  const byPath = new Map([[core.pathKey('D:\\we\\projA\\f.mp4'), 'projA']]);
  assert.equal(core.resolvePlaylistItem('D:\\we\\projA\\f.mp4', byPath, byId), 'projA');
  assert.equal(
    core.resolvePlaylistItem('D:\\Steam\\steamapps\\workshop\\content\\431960\\1234567890\\scene.pkg', byPath, byId),
    '1234567890',
  );
  assert.equal(core.resolvePlaylistItem('projects\\defaultprojects\\projA\\project.json', byPath, byId), 'projA');
  assert.equal(core.resolvePlaylistItem('C:\\nothing\\here.mp4', byPath, byId), null);
});

// ── HTTP helpers ─────────────────────────────────────────────────────────────

test('parseRangeHeader: full, open-ended, suffix, clamped', () => {
  assert.equal(core.parseRangeHeader(undefined, 100), null);
  assert.deepEqual(core.parseRangeHeader('bytes=0-9', 100), { start: 0, end: 9 });
  assert.deepEqual(core.parseRangeHeader('bytes=90-', 100), { start: 90, end: 99 });
  assert.deepEqual(core.parseRangeHeader('bytes=-10', 100), { start: 90, end: 99 });
  assert.deepEqual(core.parseRangeHeader('bytes=0-999', 100), { start: 0, end: 99 }); // clamped
  assert.deepEqual(core.parseRangeHeader(' bytes=0-9 ', 100), { start: 0, end: 9 }); // padded
  assert.deepEqual(core.parseRangeHeader('bytes=-200', 100), { start: 0, end: 99 }); // suffix > size → whole
});

test('parseRangeHeader: unsatisfiable-but-valid → 416', () => {
  assert.deepEqual(core.parseRangeHeader('bytes=200-300', 100), { error: true }); // beyond EOF
  assert.deepEqual(core.parseRangeHeader('bytes=50-40', 100), { error: true }); // inverted
  assert.deepEqual(core.parseRangeHeader('bytes=5-5', 5), { error: true }); // starts at EOF
  assert.deepEqual(core.parseRangeHeader('bytes=1-', 1), { error: true }); // past the single byte
  assert.deepEqual(core.parseRangeHeader('bytes=0-0', 0), { error: true }); // empty file
});

test('parseRangeHeader: invalid/unsupported → IGNORED (200), per RFC 9110 §14.2', () => {
  assert.equal(core.parseRangeHeader('bytes=0-1,5-6', 100), null); // multi-range
  assert.equal(core.parseRangeHeader('bytes=abc', 100), null); // garbage
  assert.equal(core.parseRangeHeader('bytes=', 100), null); // empty
  assert.equal(core.parseRangeHeader('bytes=-', 100), null); // no digits
  assert.equal(core.parseRangeHeader('bytes=-0', 100), null); // zero-length suffix
  assert.equal(core.parseRangeHeader('items=0-1', 100), null); // wrong unit
});

test('mimeFor: media, web assets, fallback', () => {
  assert.equal(core.mimeFor('a.MP4'), 'video/mp4');
  assert.equal(core.mimeFor('b.html'), 'text/html; charset=utf-8');
  assert.equal(core.mimeFor('c.png'), 'image/png');
  assert.equal(core.mimeFor('d.bin'), 'application/octet-stream');
  assert.equal(core.mimeFor('noext'), 'application/octet-stream');
});

// ── Inventory assembly (pure; what the host serves over HTTP) ────────────────

async function fixtureInventory(t) {
  const installDir = join(t, 'we');
  const p1Dir = join(installDir, 'projects', 'defaultprojects', 'p1');
  mkdirSync(p1Dir, { recursive: true });
  writeFileSync(join(p1Dir, 'project.json'), JSON.stringify({ title: 'One', type: 'video', file: 'a.mp4' }));
  writeFileSync(join(p1Dir, 'a.mp4'), 'video-bytes');
  const lib = join(t, 'lib');
  const p3Dir = join(lib, 'steamapps', 'workshop', 'content', '431960', 'p3');
  mkdirSync(p3Dir, { recursive: true });
  writeFileSync(join(p3Dir, 'project.json'), JSON.stringify({ title: 'Weby', type: 'web', file: 'index.html' }));
  writeFileSync(join(p3Dir, 'index.html'), '<html></html>');
  writeFileSync(join(p3Dir, 'app.js'), '// asset');
  writeFileSync(join(installDir, 'config.json'), JSON.stringify({
    profile: { general: { playlists: [
      { name: 'Mix', items: [
        join(p1Dir, 'a.mp4'),
        join(p3Dir, 'index.html'),
        join(t, 'nowhere', 'ghost.mp4'), // never enumerated → unresolved
      ], settings: { order: 'random' } },
    ] } },
  }));
  return { installDir, lib, p1Dir, p3Dir };
}

test('buildInventoryFrom: assembles wallpapers + playlists from a fixture tree', () => withTemp(async (t) => {
  const { installDir, lib, p1Dir, p3Dir } = await fixtureInventory(t);
  const mints = [];
  const inv = await core.buildInventoryFrom(
    { installDir, libraryRoots: [lib] },
    { mint: (entry) => { mints.push(entry); return 'tok-' + mints.length; } },
  );

  assert.equal(inv.total, 2);
  assert.equal(inv.portableCount, 2);
  const [w1, w2] = inv.wallpapers;
  assert.equal(w1.id, 'p1'); assert.equal(w1.type, 'video'); assert.equal(w1.playable, true);
  assert.ok(w1.media.endsWith('/media/tok-1'));
  assert.equal(w2.id, 'p3'); assert.equal(w2.type, 'web'); assert.equal(w2.playable, true);

  // mint entries carry containment info the host needs for sub-assets,
  // plus a stable per-asset key for token reuse across rebuilds.
  assert.equal(mints[0].abs, join(p1Dir, 'a.mp4'));
  assert.equal(mints[0].rootDir, null); // video: no sub-assets
  assert.equal(mints[0].key, 'p1:media');
  assert.equal(mints[1].abs, join(p3Dir, 'index.html'));
  assert.equal(mints[1].rootDir, p3Dir); // web: sub-assets allowed inside dir

  // Playlist resolved two of three items; the ghost item counts unresolved.
  assert.equal(inv.playlists.length, 1);
  assert.deepEqual(inv.playlists[0].wallpaperIds, ['p1', 'p3']);
  assert.equal(inv.playlists[0].portableCount, 2);
  assert.equal(inv.playlists[0].unresolvedCount, 1);
}));

test('buildInventoryFrom: scene/application entries are excluded and never minted', () => withTemp(async (t) => {
  const { installDir, lib } = await fixtureInventory(t);
  const p4Dir = join(lib, 'steamapps', 'workshop', 'content', '431960', 'p4');
  mkdirSync(p4Dir, { recursive: true });
  writeFileSync(join(p4Dir, 'project.json'), JSON.stringify({
    title: 'Scene', type: 'scene', file: 'wall.pkg', preview: 'thumb.jpg',
  }));
  writeFileSync(join(p4Dir, 'wall.pkg'), 'pkg');
  writeFileSync(join(p4Dir, 'thumb.jpg'), 'jpg');

  // Fresh spy per build — never reuse an accumulating array across builds.
  const mints = [];
  const inv = await core.buildInventoryFrom(
    { installDir, libraryRoots: [lib] },
    { mint: (e) => { mints.push(e); return 'tok-' + mints.length; } },
  );
  // .pkg scenes are not browser-renderable: absent from the inventory
  // entirely (not counted, not selectable, not even minted a preview).
  assert.equal(inv.total, 2);
  assert.equal(inv.portableCount, 2);
  assert.ok(!inv.wallpapers.some((w) => w.id === 'p4'));
  assert.equal(mints.length, 2); // exactly p1:media and p3:media
}));

test('buildInventoryFrom: a falsy mint never produces "…/null" URLs', () => withTemp(async (t) => {
  const { installDir, lib } = await fixtureInventory(t);
  // No mint provided at all — the default returns null.
  const inv = await core.buildInventoryFrom({ installDir, libraryRoots: [lib] });
  for (const w of inv.wallpapers) {
    assert.equal(w.media, null);
    assert.equal(w.preview, null);
    assert.equal(w.playable, false);
  }
  assert.equal(inv.total, 2); // enumeration still works
}));

test('buildInventoryFrom: missing install yields empty structure, not an error', async () => {
  const inv = await core.buildInventoryFrom({ installDir: null, libraryRoots: [] }, { mint: () => 'x' });
  assert.equal(inv.installDir, null);
  assert.deepEqual(inv.wallpapers, []);
  assert.deepEqual(inv.playlists, []);
  assert.equal(inv.total, 0);
  assert.equal(inv.portableCount, 0);
});

test('buildInventoryFrom: scene/application entries are filtered out entirely', async () => {
  await withTemp(async (tmp) => {
    const ws = join(tmp, 'steamapps', 'workshop', 'content', '431960');
    const mk = async (id, type) => {
      const dir = join(ws, id);
      mkdirSync(dir, { recursive: true });
      const project = { title: 'W' + id, type, file: type === 'video' ? 'v.mp4' : 'index.html', preview: 'p.jpg' };
      writeFileSync(join(dir, 'project.json'), JSON.stringify(project));
      if (type === 'video') writeFileSync(join(dir, 'v.mp4'), 'x');
      else writeFileSync(join(dir, 'index.html'), '<html></html>');
      writeFileSync(join(dir, 'p.jpg'), 'jpg');
    };
    await mk('v1', 'video');
    await mk('w1', 'web');
    await mk('s1', 'scene');
    await mk('a1', 'application');
    const inv = await core.buildInventoryFrom({ installDir: null, libraryRoots: [tmp] }, { mint: () => 't' });
    const types = inv.wallpapers.map((w) => w.type).sort();
    assert.deepEqual(types, ['video', 'web']); // no scene, no application
    assert.equal(inv.total, 2);
    assert.equal(inv.portableCount, 2);
    // Previews still ship for playable entries (decode-failure fallback).
    assert.ok(inv.wallpapers.every((w) => w.preview && w.preview.startsWith('/we-background/preview/')));
  });
});
