/**
 * Unit tests for the pure logic layer (lib/core.js).
 * Run with: npm test  (node --test test/)
 *
 * Filesystem cases build fixture trees in a temp dir; everything else is
 * pure string/structure in, structure out.
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
  const tree = parseVdf(`
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
  assert.equal(parseVdf('"a" { "k" "1" "k" "2" }').a.k, '2');
  assert.deepEqual(parseVdf(''), {});
  assert.equal(typeof parseVdf('"unterminated { "x" "y"'), 'object');
});

function parseVdf(text) {
  return core.parseKeyValues(text);
}

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

function withTemp(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'webg-'));
  try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

function makeInstall(dir) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'wallpaper32.exe'), '');
  return dir;
}

test('findInstallDir: first candidate containing the binary wins; dedupe', () => withTemp((t) => {
  const a = join(t, 'a');
  const b = join(t, 'b');
  mkdirSync(a, { recursive: true }); // no binary
  makeInstall(b);
  assert.equal(core.findInstallDir([a, b, b, join(t, 'missing')]), b);
  assert.equal(core.findInstallDir([a, join(t, 'missing')]), null);
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

test('workshopLibraryRoots: default library recovered by binary presence', () => withTemp((t) => {
  const probe = join(t, 'steam');
  makeInstall(join(probe, 'steamapps', 'common', 'wallpaper_engine'));
  const vdfLib = join(t, 'elsewhere');
  const libs = core.workshopLibraryRoots([probe], [vdfLib]);
  assert.ok(libs.includes(vdfLib));
  assert.ok(libs.includes(probe)); // recovered despite no vdf "path" entry
}));

// ── Containment ──────────────────────────────────────────────────────────────

test('isInsideDir: containment, equality, traversal and sibling-prefix traps', () => withTemp((t) => {
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

// ── Project model ────────────────────────────────────────────────────────────

test('readProject: valid video project; preview containment; escaping file rejected', () => withTemp((t) => {
  const dir = join(t, 'proj');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'project.json'), JSON.stringify({
    title: 'Ocean', type: 'video', file: 'ocean.mp4', preview: 'preview.jpg',
  }));
  const p = core.readProject(dir);
  assert.equal(p.id, 'proj');
  assert.equal(p.title, 'Ocean');
  assert.equal(p.type, 'video');
  assert.equal(p.fileAbs, resolve(dir, 'ocean.mp4'));
  assert.equal(p.previewAbs, resolve(dir, 'preview.jpg'));

  writeFileSync(join(dir, 'project.json'), JSON.stringify({ file: '../../secret.mp4' }));
  assert.equal(core.readProject(dir), null); // escapes project dir → rejected

  writeFileSync(join(dir, 'project.json'), JSON.stringify({ file: 'scene.pkg', type: 'unknown-kind' }));
  assert.equal(core.readProject(dir).type, 'scene'); // unknown kind falls back

  assert.equal(core.readProject(join(t, 'missing')), null);
}));

test('inferType: extension fallback', () => {
  assert.equal(core.inferType('a.mp4'), 'video');
  assert.equal(core.inferType('b.HTML'), 'web');
  assert.equal(core.inferType('c.pkg'), 'scene');
});

test('enumerateWallpapers: merges roots, first id wins, sorts by title', () => withTemp((t) => {
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
  const all = core.enumerateWallpapers([root1, root2, join(t, 'missing')]);
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

test('parseRangeHeader: full, open-ended, suffix, invalid', () => {
  assert.equal(core.parseRangeHeader(undefined, 100), null);
  assert.deepEqual(core.parseRangeHeader('bytes=0-9', 100), { start: 0, end: 9 });
  assert.deepEqual(core.parseRangeHeader('bytes=90-', 100), { start: 90, end: 99 });
  assert.deepEqual(core.parseRangeHeader('bytes=-10', 100), { start: 90, end: 99 });
  assert.deepEqual(core.parseRangeHeader('bytes=0-999', 100), { start: 0, end: 99 }); // clamped
  assert.deepEqual(core.parseRangeHeader('bytes=200-300', 100), { error: true }); // beyond EOF
  assert.deepEqual(core.parseRangeHeader('bytes=50-40', 100), { error: true }); // inverted
  assert.deepEqual(core.parseRangeHeader('bytes=-', 100), { error: true });
  assert.deepEqual(core.parseRangeHeader('items=0-1', 100), { error: true });
  assert.deepEqual(core.parseRangeHeader('bytes=0-0', 0), { error: true }); // empty file
});

test('mimeFor: media, web assets, fallback', () => {
  assert.equal(core.mimeFor('a.MP4'), 'video/mp4');
  assert.equal(core.mimeFor('b.html'), 'text/html; charset=utf-8');
  assert.equal(core.mimeFor('c.png'), 'image/png');
  assert.equal(core.mimeFor('d.bin'), 'application/octet-stream');
  assert.equal(core.mimeFor('noext'), 'application/octet-stream');
});
