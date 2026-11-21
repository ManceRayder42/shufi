// The launcher (bin/shufi), the Node.js resolver shim (bin/shufi-node) and install.sh.
//
//   node --test test/
//
// Everything here is offline: the "Node.js download" is a tiny fake tarball served from a
// file:// mirror, and every command runs with a PATH that has no node (and no git) on it, so
// the tests exercise exactly the situation of a computer that has never had Node.js.
// The real download from nodejs.org is exercised by test/start-e2e.sh (manual, needs network).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHUFI = path.join(ROOT, 'bin', 'shufi');
const SHIM = path.join(ROOT, 'bin', 'shufi-node');
const INSTALL = path.join(ROOT, 'install.sh');

const OS = process.platform === 'darwin' ? 'darwin' : 'linux';
const ARCH = process.arch === 'arm64' ? 'arm64' : 'x64';
const PINNED = 'v26.13.1'; // keep in step with PINNED_NODE_VERSION in bin/shufi

function tmp(label = 'shufi-l') { return fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), label + '-')); }
function write(file, text, mode) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text, mode ? { mode } : undefined); }

// A PATH of symlinks to the system tools the scripts need, and deliberately not node, git or claude.
const TOOLS = ['sh', 'bash', 'env', 'uname', 'curl', 'wget', 'tar', 'gzip', 'mkdir', 'mv', 'rm', 'cat', 'grep', 'sed', 'awk', 'find',
  'date', 'ln', 'chmod', 'dirname', 'basename', 'mktemp', 'tr', 'cut', 'head', 'tail', 'sort', 'touch', 'ls', 'cp', 'id', 'wc',
  'readlink', 'shasum', 'sha256sum', 'openssl', 'sysctl', 'ldd', 'sleep', 'kill', 'nohup', 'printf', 'test', 'perl'];
function farm(extra = {}) {
  const dir = tmp('farm');
  for (const t of TOOLS) {
    for (const d of ['/usr/bin', '/bin', '/usr/sbin', '/sbin']) {
      if (fs.existsSync(path.join(d, t))) { fs.symlinkSync(path.join(d, t), path.join(dir, t)); break; }
    }
  }
  for (const [name, body] of Object.entries(extra)) write(path.join(dir, name), body, 0o755);
  return dir;
}
const fakeNode = (version) => `#!/bin/sh\ncase "$1" in -v|--version) echo ${version};; *) echo "fake-node ${version} $*"; cat;; esac\n`;

function run(cmd, args, { env = {}, input, cwd } = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', env, input, cwd, timeout: 60000 });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

// A file:// stand-in for nodejs.org/dist: <dist>/<version>/node-<version>-<os>-<arch>.tar.gz + SHASUMS256.txt
function mirror(version, { tamper = false, omitShasum = false } = {}) {
  const dist = tmp('dist');
  const base = `node-${version}-${OS}-${ARCH}`;
  const stage = tmp('stage');
  write(path.join(stage, base, 'bin', 'node'), fakeNode(version), 0o755);
  const vdir = path.join(dist, version);
  fs.mkdirSync(vdir, { recursive: true });
  const tgz = path.join(vdir, base + '.tar.gz');
  const r = spawnSync('tar', ['-czf', tgz, '-C', stage, base]);
  assert.equal(r.status, 0, 'tar built the fake release');
  const hash = crypto.createHash('sha256').update(fs.readFileSync(tgz)).digest('hex');
  if (!omitShasum) write(path.join(vdir, 'SHASUMS256.txt'), `${hash}  ${base}.tar.gz\n`);
  else write(path.join(vdir, 'SHASUMS256.txt'), `${'0'.repeat(64)}  some-other-file.tar.gz\n`);
  if (tamper) fs.appendFileSync(tgz, 'tampered after the checksum was published');
  return { url: 'file://' + dist, hash, tgz };
}

function launcherEnv(home, pathDir, extra = {}) {
  return { PATH: pathDir, HOME: home, SHELL: '/bin/zsh', ...extra };
}
const runtimeDirs = (home) => { try { return fs.readdirSync(path.join(home, '.shufi', 'runtime')); } catch { return []; } };

// ---------------------------------------------------------------- syntax

test('scripts: bin/shufi, bin/shufi-node and install.sh parse under sh (and dash when present)', () => {
  for (const f of [SHUFI, SHIM, INSTALL]) {
    assert.equal(run('sh', ['-n', f]).status, 0, f);
    if (fs.existsSync('/bin/dash')) assert.equal(run('/bin/dash', ['-n', f]).status, 0, 'dash ' + f);
    assert.ok(fs.statSync(f).mode & 0o111, f + ' is executable');
  }
});

test('plugin: every hook and every command that runs a script goes through the shim, none through a bare node', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8'));
  const cmds = [];
  for (const groups of Object.values(manifest.hooks)) for (const g of groups) for (const h of g.hooks) cmds.push(h.command);
  assert.equal(cmds.length, 5);
  for (const c of cmds) assert.match(c, /^sh "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/shufi-node" --hook "\$\{CLAUDE_PLUGIN_ROOT\}\/hooks\/[a-z-]+\.mjs"$/, c);

  const docs = [path.join(ROOT, 'commands', 'shufi-setup.md')];
  for (const d of ['skills', 'optional-skills']) for (const s of fs.readdirSync(path.join(ROOT, d))) {
    const f = path.join(ROOT, d, s, 'SKILL.md');
    if (fs.existsSync(f)) docs.push(f);
  }
  for (const f of docs) {
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      assert.doesNotMatch(line, /(^|[`\s!])node "/, `${path.relative(ROOT, f)} runs a bare node: ${line.trim()}`);
    }
  }
  assert.match(fs.readFileSync(path.join(ROOT, 'commands', 'shufi-setup.md'), 'utf8'), /allowed-tools:\n {2}- Bash\(sh:\*\)/);
});

// ---------------------------------------------------------------- the shim

test('shim: uses node from PATH when it is 18 or newer, and passes arguments and stdin through', () => {
  const bin = farm({ node: fakeNode('v20.1.0') });
  const r = run('sh', [SHIM, 'a.mjs', 'two words'], { env: { PATH: bin, HOME: tmp() }, input: 'from-stdin' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /fake-node v20\.1\.0 a\.mjs two words/);
  assert.match(r.stdout, /from-stdin/);
});

test('shim: skips a PATH node older than 18 and uses the private runtime copy', () => {
  const home = tmp();
  write(path.join(home, '.shufi', 'runtime', 'node-v99.0.0', 'bin', 'node'), fakeNode('v99.0.0'), 0o755);
  const bin = farm({ node: fakeNode('v16.20.0') });
  const r = run('sh', [SHIM, 'x.mjs'], { env: { PATH: bin, HOME: home } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /fake-node v99\.0\.0 x\.mjs/);
});

test('shim: PATH node wins over the runtime copy when both are good', () => {
  const home = tmp();
  write(path.join(home, '.shufi', 'runtime', 'node-v99.0.0', 'bin', 'node'), fakeNode('v99.0.0'), 0o755);
  const bin = farm({ node: fakeNode('v22.0.0') });
  assert.match(run('sh', [SHIM, 'x.mjs'], { env: { PATH: bin, HOME: home } }).stdout, /fake-node v22\.0\.0/);
});

test('shim: no node anywhere. A hook exits 0 and says "shufi start" (stdout only once a day); a command exits 1', () => {
  const home = tmp();
  const bin = farm();
  const env = { PATH: bin, HOME: home };
  assert.equal(run('sh', ['-c', 'command -v node'], { env }).status, 1, 'precondition: there really is no node on this PATH');
  const first = run('sh', [SHIM, '--hook', 'x.mjs'], { env });
  assert.equal(first.status, 0);
  assert.match(first.stderr, /Run: shufi start/);
  assert.match(first.stdout, /Run: shufi start/);
  const second = run('sh', [SHIM, '--hook', 'x.mjs'], { env });
  assert.equal(second.status, 0);
  assert.match(second.stderr, /Run: shufi start/);
  assert.equal(second.stdout, '', 'the context-injecting stdout nudge is rate limited');
  const cmd = run('sh', [SHIM, 'x.mjs'], { env });
  assert.equal(cmd.status, 1);
  assert.match(cmd.stderr, /Run: shufi start/);
  assert.equal(cmd.stdout, '');
});

test('shim: a real hook runs through it on a PATH with no node, using only the private runtime', () => {
  const home = tmp();
  const rt = path.join(home, '.shufi', 'runtime', 'node-v99.0.0', 'bin');
  fs.mkdirSync(rt, { recursive: true });
  fs.symlinkSync(process.execPath, path.join(rt, 'node'));
  const bin = farm();
  const env = { PATH: bin, HOME: home };
  assert.equal(run('sh', ['-c', 'command -v node'], { env }).status, 1);
  const t0 = performance.now();
  const r = run('sh', [SHIM, '--hook', path.join(ROOT, 'hooks', 'session-start.mjs')], { env, input: '{}' });
  const ms = performance.now() - t0;
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /\[shufi\] Not set up yet/);
  assert.ok(ms < 3000, `hook through the shim finished in ${ms.toFixed(0)}ms (hook timeout is 3 to 5 s)`);
});

// ---------------------------------------------------------------- the launcher: Node.js runtime

test('launcher: `shufi node` downloads the runtime, verifies the checksum, installs it, and does not download twice', () => {
  const home = tmp();
  const bin = farm();
  const m = mirror('v99.0.0');
  const env = launcherEnv(home, bin, { SHUFI_NODE_VERSION: 'v99.0.0', SHUFI_NODE_DIST_URL: m.url });
  const a = run('sh', [SHUFI, 'node'], { env });
  assert.equal(a.status, 0, a.stderr);
  assert.match(a.stderr, /checksum verified against SHASUMS256\.txt/);
  assert.ok(a.stderr.includes(m.hash), 'prints the sha256 it verified');
  assert.equal(a.stdout.trim(), path.join(home, '.shufi', 'runtime', 'node-v99.0.0', 'bin', 'node'));
  assert.deepEqual(runtimeDirs(home), ['node-v99.0.0']);
  assert.deepEqual(fs.readdirSync(path.join(home, '.shufi')).filter((n) => n.startsWith('tmp.')), [], 'no scratch left behind');
  // second run: the mirror is gone, nothing is fetched
  const b = run('sh', [SHUFI, 'node'], { env: { ...env, SHUFI_NODE_DIST_URL: 'file:///nonexistent' } });
  assert.equal(b.status, 0, b.stderr);
  assert.equal(b.stdout.trim(), a.stdout.trim());
  assert.doesNotMatch(b.stderr, /Downloading/);
});

test('launcher: a tampered tarball fails closed (exit 4, nothing installed, no scratch left)', () => {
  const home = tmp();
  const m = mirror('v99.0.0', { tamper: true });
  const r = run('sh', [SHUFI, 'node'], { env: launcherEnv(home, farm(), { SHUFI_NODE_VERSION: 'v99.0.0', SHUFI_NODE_DIST_URL: m.url }) });
  assert.equal(r.status, 4);
  assert.match(r.stderr, /CHECKSUM MISMATCH/);
  assert.deepEqual(runtimeDirs(home), []);
  assert.deepEqual(fs.readdirSync(path.join(home, '.shufi')).filter((n) => n.startsWith('tmp.')), []);
});

test('launcher: the pinned hash is enforced even when the mirror\'s SHASUMS256.txt agrees with a swapped tarball', () => {
  const home = tmp();
  const m = mirror(PINNED); // a self-consistent fake of the pinned release: SHASUMS matches the tarball, the pin does not
  const r = run('sh', [SHUFI, 'node'], { env: launcherEnv(home, farm(), { SHUFI_NODE_DIST_URL: m.url }) });
  assert.equal(r.status, 4);
  assert.match(r.stderr, /pinned in this launcher/);
  assert.deepEqual(runtimeDirs(home), []);
});

test('launcher: a release whose SHASUMS256.txt has no entry for the tarball is refused', () => {
  const home = tmp();
  const m = mirror('v99.0.0', { omitShasum: true });
  const r = run('sh', [SHUFI, 'node'], { env: launcherEnv(home, farm(), { SHUFI_NODE_VERSION: 'v99.0.0', SHUFI_NODE_DIST_URL: m.url }) });
  assert.equal(r.status, 4);
  assert.match(r.stderr, /no entry/);
  assert.deepEqual(runtimeDirs(home), []);
});

test('launcher: a download that fails exits 4 and installs nothing', () => {
  const home = tmp();
  const r = run('sh', [SHUFI, 'node'], { env: launcherEnv(home, farm(), { SHUFI_NODE_VERSION: 'v99.0.0', SHUFI_NODE_DIST_URL: 'file:///nonexistent-mirror' }) });
  assert.equal(r.status, 4);
  assert.match(r.stderr, /download failed/);
  assert.deepEqual(runtimeDirs(home), []);
});

test('launcher: uses node from PATH when it is good (no download), and uninstall-runtime removes only ~/.shufi/runtime', () => {
  const home = tmp();
  write(path.join(home, '.shufi', 'runtime', 'node-v99.0.0', 'bin', 'node'), fakeNode('v99.0.0'), 0o755);
  write(path.join(home, '.shufi', 'keep.txt'), 'x');
  const bin = farm({ node: fakeNode('v22.1.0') });
  const env = launcherEnv(home, bin);
  const r = run('sh', [SHUFI, 'node'], { env });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), path.join(bin, 'node'));
  const u = run('sh', [SHUFI, 'uninstall-runtime'], { env });
  assert.equal(u.status, 0);
  assert.equal(fs.existsSync(path.join(home, '.shufi', 'runtime')), false);
  assert.equal(fs.existsSync(path.join(home, '.shufi', 'keep.txt')), true);
});

test('launcher: help exits 0, an unknown command exits 2, doctor with nothing installed exits 1 and names the fix', () => {
  const env = launcherEnv(tmp(), farm());
  assert.equal(run('sh', [SHUFI, 'help'], { env }).status, 0);
  assert.equal(run('sh', [SHUFI, 'frobnicate'], { env }).status, 2);
  const d = run('sh', [SHUFI, 'doctor'], { env });
  assert.equal(d.status, 1);
  assert.match(d.stdout, /node\s+MISSING/);
  assert.match(d.stdout, /Fix: shufi start/);
});

test('launcher start: with no Claude Code and the installer skipped it stops with exit 5 after the Node.js step', () => {
  const home = tmp();
  const m = mirror('v99.0.0');
  const r = run('sh', [SHUFI, 'start'], { env: launcherEnv(home, farm(), { SHUFI_NODE_VERSION: 'v99.0.0', SHUFI_NODE_DIST_URL: m.url, SHUFI_SKIP_CLAUDE_INSTALL: '1' }) });
  assert.equal(r.status, 5, r.stderr);
  assert.match(r.stderr, /Claude Code is not installed/);
  assert.deepEqual(runtimeDirs(home), ['node-v99.0.0']);
});

test('launcher start: a Claude Code that is not signed in stops with exit 3 and tells the user to run claude', () => {
  const home = tmp();
  const bin = farm({
    node: fakeNode('v22.0.0'),
    claude: '#!/bin/sh\nif [ "$1" = auth ]; then echo \'{ "loggedIn": false }\'; exit 1; fi\necho "claude should not be reached: $*"; exit 9\n',
  });
  const r = run('sh', [SHUFI, 'start'], { env: launcherEnv(home, bin) });
  assert.equal(r.status, 3, r.stderr);
  assert.match(r.stderr, /not signed in/);
  assert.match(r.stderr, /Run: claude/);
  assert.match(r.stderr, /shufi start/);
});

// ---------------------------------------------------------------- shufi start with a fake `claude`

const SERVER_STUB = "console.log('Shufi setup is running:\\n  http://127.0.0.1:1234/?t=abc'); setTimeout(() => {}, 1500);\n";
// Records every call; keeps "installed" state in $FAKE_STATE; `plugin list` reports $FAKE_ROOT.
const FAKE_CLAUDE = `#!/bin/sh
echo "$*" >> "$FAKE_STATE/calls.log"
case "$1 $2 $3" in
  "auth status "*) echo '{ "loggedIn": true }' ;;
  "plugin list --json") if [ -f "$FAKE_STATE/installed" ]; then printf '[{"id":"shufi@shufi","installPath":"%s"}]\\n' "$FAKE_ROOT"; else echo '[]'; fi ;;
  "plugin install shufi@shufi") touch "$FAKE_STATE/installed"; echo installed ;;
  "plugin marketplace list") echo '[]' ;;
  *) echo ok ;;
esac
`;

function startFixture({ withGit = false, fakeBin = {} } = {}) {
  const home = tmp();
  const state = tmp('state');
  const bin = farm({ claude: FAKE_CLAUDE, ...fakeBin });
  fs.symlinkSync(process.execPath, path.join(bin, 'node')); // plugin_info parses JSON with node
  if (withGit) write(path.join(bin, 'git'), '#!/bin/sh\nexit 0\n', 0o755);
  const root = tmp('plugin-root');
  write(path.join(root, 'setup', 'server.mjs'), SERVER_STUB);
  // what the "download Shufi" fallback unpacks
  const par = tmp('apppar');
  write(path.join(par, 'shufi-main', '.claude-plugin', 'marketplace.json'), '{}');
  write(path.join(par, 'shufi-main', 'setup', 'server.mjs'), SERVER_STUB);
  const tgz = path.join(par, 'app.tgz');
  assert.equal(spawnSync('tar', ['-czf', tgz, '-C', par, 'shufi-main']).status, 0);
  const env = (extra = {}) => launcherEnv(home, bin, { FAKE_STATE: state, FAKE_ROOT: root, SHUFI_SOURCE_URL: 'file://' + tgz, ...extra });
  const calls = () => { try { return fs.readFileSync(path.join(state, 'calls.log'), 'utf8').trim().split('\n'); } catch { return []; } };
  return { home, state, bin, root, env, calls };
}

test('launcher start: no git. The plugin comes from a downloaded copy in ~/.shufi/app, installed once, and the setup server URL is printed', () => {
  const f = startFixture();
  const r = run('sh', [SHUFI, 'start', '--background', '--no-open'], { env: f.env() });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /git is not available/);
  assert.match(r.stdout, /Setup screen: http:\/\/127\.0\.0\.1:1234\/\?t=abc/);
  assert.ok(r.stdout.includes('Plugin root: ' + f.root));
  const app = path.join(f.home, '.shufi', 'app');
  assert.ok(fs.existsSync(path.join(app, 'setup', 'server.mjs')), 'unpacked the downloaded copy');
  assert.ok(f.calls().includes('plugin marketplace add ' + app), f.calls().join(' | '));
  assert.ok(f.calls().includes('plugin install shufi@shufi'));
  // the second start does not add or install again; it updates
  const again = run('sh', [SHUFI, 'start', '--background', '--no-open'], { env: f.env() });
  assert.equal(again.status, 0, again.stderr);
  assert.equal(f.calls().filter((c) => c.startsWith('plugin marketplace add')).length, 1);
  assert.equal(f.calls().filter((c) => c === 'plugin install shufi@shufi').length, 1);
  assert.ok(f.calls().includes('plugin update shufi@shufi'));
});

test('launcher start: with git it adds the GitHub marketplace, and SHUFI_SKIP_UPDATE skips the update on a later start', () => {
  const f = startFixture({ withGit: true });
  const r = run('sh', [SHUFI, 'start', '--background', '--no-open'], { env: f.env() });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(f.calls().includes('plugin marketplace add ManceRayder42/shufi'), f.calls().join(' | '));
  assert.equal(fs.existsSync(path.join(f.home, '.shufi', 'app')), false, 'no downloaded copy needed');
  run('sh', [SHUFI, 'start', '--background', '--no-open'], { env: f.env({ SHUFI_SKIP_UPDATE: '1' }) });
  assert.equal(f.calls().filter((c) => c.startsWith('plugin update')).length, 0);
});

test('launcher start: on a Mac whose /usr/bin/git is the developer-tools stub, it does not use git', { skip: !(process.platform === 'darwin' && fs.existsSync('/usr/bin/git')) }, () => {
  const f = startFixture({ fakeBin: { 'xcode-select': '#!/bin/sh\nexit 2\n' } });
  const env = f.env();
  env.PATH = f.bin + ':/usr/bin'; // /usr/bin/git is now the first git on PATH, and xcode-select says there are no tools
  const r = run('sh', [SHUFI, 'start', '--background', '--no-open'], { env });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /git is not available/);
  assert.ok(f.calls().includes('plugin marketplace add ' + path.join(f.home, '.shufi', 'app')));
});

test('launcher start: if adding from GitHub fails it falls back to the downloaded copy', () => {
  const f = startFixture({ withGit: true });
  // a claude that refuses the GitHub source but accepts a folder
  write(path.join(f.bin, 'claude'), FAKE_CLAUDE.replace('  *) echo ok ;;', '  "plugin marketplace add") if [ "$4" = ManceRayder42/shufi ]; then echo "clone failed" >&2; exit 1; fi; echo ok ;;\n  *) echo ok ;;'), 0o755);
  const r = run('sh', [SHUFI, 'start', '--background', '--no-open'], { env: f.env() });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /trying a downloaded copy/);
  assert.ok(f.calls().includes('plugin marketplace add ' + path.join(f.home, '.shufi', 'app')), f.calls().join(' | '));
});

test('server: a machine with no browser opener (no open, no xdg-open) still serves the page', async () => {
  const { spawn } = await import('node:child_process');
  const child = spawn(process.execPath, [path.join(ROOT, 'setup', 'server.mjs')], { env: { PATH: farm(), HOME: tmp() }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  let err = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { err += d; });
  try {
    for (let i = 0; i < 50 && !/http:\/\/127\.0\.0\.1:\d+\/\?t=\w+/.test(out); i++) await new Promise((r) => setTimeout(r, 100));
    const url = out.match(/http:\/\/127\.0\.0\.1:\d+\/\?t=\w+/)?.[0];
    assert.ok(url, 'printed its URL: ' + out + err);
    await new Promise((r) => setTimeout(r, 700)); // the failed opener reports ENOENT asynchronously
    assert.equal(child.exitCode, null, 'still running: ' + err);
    assert.equal((await fetch(url)).status, 200);
  } finally {
    child.kill('SIGTERM');
  }
});

// ---------------------------------------------------------------- install.sh

test('install.sh: installs the launcher, adds ~/.local/bin to PATH once, touches nothing else, and a second run changes nothing', () => {
  const home = tmp();
  const bin = farm();
  const env = launcherEnv(home, bin, { SHUFI_NO_START: '1' });
  write(path.join(home, '.zshrc'), '# mine\nexport FOO=1\n');
  const a = run('sh', [INSTALL], { env });
  assert.equal(a.status, 0, a.stderr);
  const launcher = path.join(home, '.local', 'bin', 'shufi');
  assert.ok(fs.statSync(launcher).mode & 0o100, 'launcher is executable');
  assert.equal(fs.readFileSync(launcher, 'utf8'), fs.readFileSync(SHUFI, 'utf8'));
  assert.match(a.stdout, /created .*\.local\/bin/);
  assert.match(a.stdout, /appended one PATH line to .*\.zshrc/);
  const rc1 = fs.readFileSync(path.join(home, '.zshrc'), 'utf8');
  assert.match(rc1, /^# mine\nexport FOO=1\n/);
  assert.equal(rc1.match(/\.local\/bin/g).length, 1);

  const b = run('sh', [INSTALL], { env });
  assert.equal(b.status, 0, b.stderr);
  assert.match(b.stdout, /already mentions ~\/\.local\/bin/);
  assert.equal(fs.readFileSync(path.join(home, '.zshrc'), 'utf8'), rc1, 'rc file unchanged on the second run');
  // nothing outside ~/.local/bin and the one rc file appeared in HOME
  assert.deepEqual(fs.readdirSync(home).sort(), ['.local', '.zshrc']);
});

test('install.sh: leaves shell startup files alone when ~/.local/bin is already on PATH; picks the file by shell', () => {
  const home = tmp();
  const bin = farm();
  const onPath = run('sh', [INSTALL], { env: { PATH: bin + ':' + path.join(home, '.local', 'bin'), HOME: home, SHELL: '/bin/zsh', SHUFI_NO_START: '1' } });
  assert.equal(onPath.status, 0, onPath.stderr);
  assert.match(onPath.stdout, /already on your PATH/);
  assert.deepEqual(fs.readdirSync(home), ['.local'], 'no rc file was created');

  const h2 = tmp();
  run('sh', [INSTALL, '--no-start'], { env: { PATH: bin, HOME: h2, SHELL: '/usr/bin/fish' } });
  assert.match(fs.readFileSync(path.join(h2, '.config', 'fish', 'config.fish'), 'utf8'), /fish_add_path -g "\$HOME\/\.local\/bin"/);
  const h3 = tmp();
  run('sh', [INSTALL, '--no-start'], { env: { PATH: bin, HOME: h3, SHELL: '/bin/bash' } });
  assert.ok(fs.existsSync(path.join(h3, process.platform === 'darwin' ? '.bash_profile' : '.bashrc')));
});

test('install.sh: refuses a download that is not the launcher and installs nothing', () => {
  const home = tmp();
  const raw = tmp('raw');
  write(path.join(raw, 'bin', 'shufi'), '#!/bin/sh\necho hello\n');
  // run it detached from the checkout so it fetches (from a file:// "raw" base) instead of copying
  const lone = tmp('lone');
  fs.copyFileSync(INSTALL, path.join(lone, 'piped.sh'));
  const r = run('sh', [path.join(lone, 'piped.sh')], { env: launcherEnv(home, farm(), { SHUFI_NO_START: '1', SHUFI_RAW_BASE: 'file://' + raw }) });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /not the Shufi launcher/);
  assert.equal(fs.existsSync(path.join(home, '.local', 'bin', 'shufi')), false);
});
