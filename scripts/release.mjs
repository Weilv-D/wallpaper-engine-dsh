#!/usr/bin/env node
// Gated release pipeline — policy in RELEASING.zh.md.
//
// preflight : main branch, clean tree, synced with origin/main, version
//             matches the latest tag, next tag unused (local + remote)
// gates     : npm test -> npm run build -> npm run verify
// bump      : npm version <level> -m "chore: release v%s"
// push      : git push origin main --follow-tags
// postflight: watch the publish Actions run, poll npm dist-tags,
//             print the GitHub Release URL

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const PKG = 'wallpaper-engine-dsh';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const run = (cmd) => execSync(cmd, { stdio: 'inherit' });
const capture = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim();
const tryCapture = (cmd) => {
  try { return capture(cmd); } catch { return ''; }
};
const die = (msg) => {
  console.error('release: ' + msg);
  process.exit(1);
};

function nextVersion(version, level) {
  const [x, y, z] = version.split('.').map(Number);
  if (level === 'major') return `${x + 1}.0.0`;
  if (level === 'minor') return `${x}.${y + 1}.0`;
  return `${x}.${y}.${z + 1}`;
}
function preflight() {
  const branch = capture('git rev-parse --abbrev-ref HEAD');
  if (branch !== 'main') die(`branch is "${branch}" - release only from main`);
  if (capture('git status --porcelain')) die('working tree is not clean - commit or stash first');

  run('git fetch origin --quiet');
  const behind = capture('git rev-list --count main..origin/main');
  if (behind !== '0') die(`origin/main has ${behind} newer commit(s) - git pull first`);
  const ahead = capture('git rev-list --count origin/main..main');
  if (ahead !== '0') die(`local main is ${ahead} commit(s) ahead - git push first`);
}
function planTag(level) {
  const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
  const latest = capture('git tag --sort=-v:refname').split('\n')[0];
  if (latest !== 'v' + version) die('package.json ' + version + ' does not match the latest tag ' + latest);
  const next = 'v' + nextVersion(version, level);
  if (tryCapture('git rev-parse -q --verify refs/tags/' + next)) die('tag ' + next + ' already exists locally');
  if (tryCapture('git ls-remote --tags origin refs/tags/' + next)) die('tag ' + next + ' already exists on origin');
  console.log('release: preflight ok - ' + version + ' -> ' + next);
  return next;
}

function gates() {
  run('npm test');
  run('npm run build');
  run('npm run verify');
  console.log('release: gates passed - test, build, verify');
}
function bumpAndPush(level, next) {
  // Gates ran npm run build: a stale committed lib/client.js would leave the
  // tree dirty right here and npm version would fail with a misleading
  // 'not clean' error. Point at the real cause before bumping.
  if (capture('git status --porcelain')) die('working tree became dirty during gates (stale lib/client.js? commit the rebuilt artifact or fix the source) - aborted before the version bump');
  run('npm version ' + level + ' -m "chore: release v%s"');
  run('git push origin main --follow-tags');
  console.log('release: pushed main + ' + next);
}

async function watchPublish(next) {
  let runId = null;
  for (let i = 0; i < 20; i++) {
    const raw = tryCapture('gh run list --workflow publish.yml --limit 10 --json databaseId,event,headBranch,status');
    if (raw) {
      const runs = JSON.parse(raw);
      // Match THIS tag's run only - the old fallback grabbed ANY in-flight
      // push run, which under concurrent tag pushes watched the wrong one.
      const hit = runs.find((r) => r.event === 'push' && r.headBranch === next);
      if (hit) { runId = hit.databaseId; break; }
    }
    await sleep(15000);
  }
  if (!runId) die('no publish run appeared for ' + next + ' - check the workflow triggers on GitHub');
  let done = false;
  for (let i = 0; i < 40; i++) {
    await sleep(15000);
    const raw = tryCapture('gh run view ' + runId + ' --json status,conclusion');
    if (raw) {
      const r = JSON.parse(raw);
      if (r.status === 'completed') {
        if (r.conclusion !== 'success') die('publish run concluded "' + r.conclusion + '" - https://github.com/Weilv-D/wallpaper-engine-dsh/actions/runs/' + runId);
        done = true;
        break;
      }
    }
  }
  if (!done) die('publish run did not finish within 10 min - https://github.com/Weilv-D/wallpaper-engine-dsh/actions/runs/' + runId);
  console.log('release: publish run succeeded - ' + next);
}
async function confirmNpm(next) {
  for (let i = 0; i < 30; i++) {
    const latest = tryCapture('npm view ' + PKG + ' dist-tags.latest');
    if (latest === next.slice(1)) {
      console.log('release: npm latest = ' + latest);
      console.log('release: https://github.com/Weilv-D/wallpaper-engine-dsh/releases/tag/' + next);
      return;
    }
    await sleep(10000);
  }
  console.error('release: npm dist-tags.latest did not reach ' + next + ' within 5 min - check npm manually');
  process.exitCode = 1;
}
const arg = process.argv[2] || 'patch';
if (arg === 'check') {
  preflight();
  planTag('patch');
  gates();
  console.log('release: check passed - tree untouched');
} else if (['patch', 'minor', 'major'].includes(arg)) {
  preflight();
  const next = planTag(arg);
  gates();
  bumpAndPush(arg, next);
  await watchPublish(next);
  await confirmNpm(next);
} else {
  die('unknown argument "' + arg + '" - use patch | minor | major | check');
}
